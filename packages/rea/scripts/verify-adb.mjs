import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { promisify } from "node:util";

import { AdbDeviceAnalysisService } from "../dist/application/adb/AdbDeviceAnalysisService.js";
import { createAdbDeviceAnalysisProvider } from "../dist/composition/adb.js";
import { closeVerifierResources } from "./lib/verifier-cleanup.mjs";

const execFileAsync = promisify(execFile);
const options = parseArguments(process.argv.slice(2));
if (options.help) {
  process.stdout.write(
    "Usage: npm run verify:adb [-- --serial SERIAL --pull PACKAGE]\n" +
      "Requires a caller-selected adb binary (REA_ADB_PATH or PATH) and a\n" +
      "connected device or emulator. Verifies all five operations against\n" +
      "the live device; --pull acquires a real package and re-digests the\n" +
      "files on disk against the returned SHA-256 values.\n",
  );
  process.exit(0);
}

const provider = createAdbDeviceAnalysisProvider(process.env);
const service = new AdbDeviceAnalysisService(provider);
let failures = 0;
const check = (name, condition, detail = "") => {
  const mark = condition ? "ok" : "FAIL";
  process.stdout.write(
    `[${mark}] ${name}${detail === "" ? "" : ` — ${detail}`}\n`,
  );
  if (!condition) failures += 1;
};

const run = async (operation, input) => {
  const result = await service.execute(operation, input);
  if (!result.ok) {
    process.stdout.write(`[FAIL] ${operation} — ${result.error.message}\n`);
    failures += 1;
    return null;
  }
  return result.value.normalized_result;
};

// Remove the verifier's own transfer probe with the provider-reported adb
// client, then confirm through the directory listing that it is gone.
const removeDeviceProbe = async (binary, serial, devicePath) => {
  const name = "verifier transfer probe removed";
  if (typeof binary !== "string" || binary === "") {
    check(name, false, `${devicePath}: adb client path unavailable`);
    return;
  }
  try {
    await execFileAsync(
      binary,
      ["-s", serial, "shell", "rm", "--", devicePath],
      {
        timeout: 30_000,
      },
    );
  } catch (cause) {
    check(name, false, `${devicePath}: ${formatFailure(cause)}`);
    return;
  }
  const listing = await run("list_adb_directory", {
    serial,
    device_path: posix.dirname(devicePath),
  });
  if (listing !== null)
    check(
      name,
      listing.coverage === "complete" &&
        !listing.entries.some(
          (entry) => entry.name === posix.basename(devicePath),
        ),
      devicePath,
    );
};

const verifyTransferRoundtrip = async ({
  adbBinary,
  serial,
  payload,
  devicePath,
  outputDirectory,
}) => {
  const pushed = await run("push_adb_file", {
    serial,
    local_path: payload,
    device_path: devicePath,
    overwrite: false,
  });
  if (pushed === null) return;
  // A successful no-overwrite push proves the verifier created this exact
  // destination; pull_adb_file deliberately retains device originals.
  try {
    check(
      "push reports matching device-side digest",
      pushed.device_digest_source === "device_sha256sum" &&
        pushed.device_sha256 === pushed.sha256,
      `${pushed.bytes} bytes`,
    );
    const pulled = await run("pull_adb_file", {
      serial,
      device_path: devicePath,
      output_directory: outputDirectory,
    });
    if (pulled !== null)
      check(
        "pulled file digest matches the pushed digest",
        pulled.sha256 === pushed.sha256,
        `${pulled.bytes} bytes`,
      );
  } finally {
    await removeDeviceProbe(adbBinary, serial, devicePath);
  }
};

let verifierFailed = false;
let verifierFailure;
try {
  const client = await run("inspect_adb_client", {});
  if (client !== null) {
    check(
      "adb client reports a version",
      typeof client.client.version === "string" && client.client.version !== "",
      `binary=${client.client.binary_path} version=${client.client.version}`,
    );
  }

  const listing = await run("list_adb_devices", {});
  let serial = options.serial ?? null;
  if (listing !== null) {
    check(
      "device listing parsed",
      Array.isArray(listing.devices),
      `${listing.devices.length} device(s)`,
    );
    const usable = listing.devices.filter(
      (device) => device.state === "device",
    );
    if (serial === null && usable.length > 0) serial = usable[0].serial;
    if (serial === null) {
      process.stdout.write(
        "[FAIL] no usable device is attached; start an emulator or connect a phone\n",
      );
      failures += 1;
    } else {
      const selected = listing.devices.find(
        (device) => device.serial === serial,
      );
      check(
        "selected device present with a kind inference",
        selected !== undefined &&
          ["emulator", "physical", "unknown"].includes(selected.kind),
        `serial=${serial} kind=${selected?.kind} basis=${selected?.kind_basis}`,
      );
    }
  }

  if (serial !== null) {
    const device = await run("inspect_adb_device", { serial });
    if (device !== null) {
      check(
        "device build identity projected",
        device.properties.some(
          (property) => property.name === "ro.build.version.sdk",
        ),
        `sdk=${
          device.properties.find((p) => p.name === "ro.build.version.sdk")
            ?.value
        } emulator_observed=${String(device.emulator_observed)}`,
      );
    }

    // Observation tools: processes, window, display, settings, logcat.
    const processes = await run("list_adb_processes", { serial });
    if (processes !== null) {
      check(
        "process listing is non-empty with a header",
        processes.processes.length > 0 && typeof processes.columns === "string",
        `${processes.processes.length} process(es)`,
      );
    }
    const window = await run("inspect_adb_window", { serial });
    if (window !== null)
      check(
        "window focus observation completed",
        typeof window.focused_window === "string" ||
          window.focused_window === null,
        `focused_window=${String(window.focused_window).slice(0, 60)} (null is legitimate on headless devices)`,
      );
    const display = await run("inspect_adb_display", { serial });
    if (display !== null)
      check(
        "display reports a physical size",
        display.physical_size !== null &&
          display.physical_size.width > 0 &&
          display.physical_size.height > 0,
        `${display.physical_size?.width}x${display.physical_size?.height} @${String(display.physical_density)}`,
      );
    const setting = await run("read_adb_setting", {
      serial,
      namespace: "global",
      key: "adb_enabled",
    });
    if (setting !== null)
      check(
        "settings read returns the device's own value",
        setting.value === "1",
        `adb_enabled=${String(setting.value)}`,
      );
    const logcat = await run("read_adb_logcat", {
      serial,
      count: 20,
      buffer: "main",
    });
    if (logcat !== null)
      check(
        "logcat dump returns bounded lines",
        logcat.lines.length <= 20,
        `${logcat.lines.length} line(s), coverage=${logcat.coverage}`,
      );
    const features = await run("list_adb_features", { serial });
    if (features !== null)
      check(
        "feature inventory is non-empty",
        features.coverage === "complete" && features.features.length > 0,
        `${features.features.length} feature(s)`,
      );
    const services = await run("list_adb_services", { serial });
    if (services !== null)
      check(
        "service inventory is non-empty",
        services.coverage === "complete" && services.services.length > 0,
        `${services.services.length} service(s)`,
      );
    const directory = await run("list_adb_directory", {
      serial,
      device_path: "/data/local/tmp",
    });
    if (directory !== null)
      check(
        "directory listing completed",
        directory.coverage === "complete",
        `${directory.entries.length} entr(ies)`,
      );

    const packages = await run("list_adb_packages", {
      serial,
      scope: "third_party",
    });
    let pullCandidate = options.pull ?? null;
    if (packages !== null) {
      // A third-party scope may legitimately be empty (clean emulator images);
      // completeness is about unparsed lines, not row count.
      check(
        "third-party package listing reports complete coverage",
        packages.coverage === "complete",
        `${packages.packages.length} package(s)`,
      );
      const allPackages = await run("list_adb_packages", {
        serial,
        scope: "all",
      });
      if (allPackages !== null) {
        check(
          "full package inventory is non-empty",
          allPackages.coverage === "complete" &&
            allPackages.packages.length > 0,
          `${allPackages.packages.length} package(s)`,
        );
      }
      if (pullCandidate === null && packages.packages.length > 0)
        pullCandidate = packages.packages[0].package_name;
    }

    if (pullCandidate !== null) {
      const directory = await mkdtemp(join(tmpdir(), "rea-adb-verify-"));
      try {
        const pull = await run("pull_adb_package", {
          serial,
          package: pullCandidate,
          output_directory: directory,
        });
        if (pull !== null) {
          // Installed /data/app packages name their APKs base.apk and
          // split_*.apk; system packages keep arbitrary names, so the lane
          // checks a non-empty artifact set and verifies each file on disk.
          check(
            "pull returned a non-empty artifact set",
            pull.artifacts.length > 0,
            `${pull.artifacts.length} artifact(s), coverage=${pull.coverage}, roles=${pull.artifacts.map((a) => a.role).join(",")}`,
          );
          for (const artifact of pull.artifacts) {
            const bytes = await stat(artifact.local_path).then(
              (info) => info.size,
            );
            const digest = createHash("sha256")
              .update(await readFile(artifact.local_path))
              .digest("hex");
            check(
              `artifact digest matches on disk: ${artifact.file_name}`,
              bytes === artifact.bytes && digest === artifact.sha256,
              `${bytes} bytes`,
            );
          }
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }

    // File transfer: push one lane-owned file, verify both digests, pull it
    // back, then clean up the device copy through the same fixed argv surface.
    const transferRoot = await mkdtemp(join(tmpdir(), "rea-adb-transfer-"));
    try {
      const payload = join(transferRoot, "rea-verify.txt");
      const payloadBytes = "rea adb transfer verification\n";
      await import("node:fs/promises").then((fs) =>
        fs.writeFile(payload, payloadBytes),
      );
      const deviceTarget = `/data/local/tmp/rea-verify-${Date.now()}.txt`;
      await verifyTransferRoundtrip({
        adbBinary: client?.client.binary_path,
        serial,
        payload,
        devicePath: deviceTarget,
        outputDirectory: transferRoot,
      });
      const screenRoot = await mkdtemp(join(tmpdir(), "rea-adb-screen-"));
      try {
        const screen = await run("capture_adb_screen", {
          serial,
          output_directory: screenRoot,
        });
        if (screen !== null)
          check(
            "screen capture is a sized PNG",
            screen.width !== null && screen.height !== null && screen.bytes > 0,
            `${screen.width}x${screen.height}, ${screen.bytes} bytes`,
          );
      } finally {
        await rm(screenRoot, { recursive: true, force: true });
      }
      if (options.pull !== null) {
        const details = await run("inspect_adb_package", {
          serial,
          package: options.pull,
        });
        if (details !== null)
          check(
            "dumpsys package projection completed",
            details.coverage === "complete",
            `versionCode=${String(details.version_code)}`,
          );
      }
      if (options.installApk !== null && options.installApk !== undefined) {
        const probePackage = "com.rea.adb.probe";
        const installedProbe = await run("install_adb_package", {
          serial,
          apk_path: options.installApk,
          replace: false,
        });
        if (installedProbe !== null) {
          check(
            "install reports the APK digest",
            typeof installedProbe.sha256 === "string" &&
              installedProbe.sha256.length === 64,
            `${installedProbe.bytes} bytes`,
          );
          const resolved = await run("resolve_adb_packages", {
            serial,
            query: "rea.adb.probe",
          });
          if (resolved !== null)
            check(
              "resolve finds the installed probe uniquely",
              resolved.matches.length === 1 &&
                resolved.matches[0]?.package_name === probePackage,
              `${resolved.matches.length} match(es)`,
            );
          const started = await run("start_adb_app", {
            serial,
            package: probePackage,
          });
          if (started !== null)
            check(
              "app start resolves and launches the launcher activity",
              typeof started.component === "string" &&
                started.component.startsWith(probePackage),
              String(started.component),
            );
          const observedProcesses = await run("list_adb_processes", { serial });
          if (observedProcesses !== null)
            check(
              "started app appears in the process listing",
              observedProcesses.processes.some(
                (process) => process.name === probePackage,
              ),
            );
          const stopped = await run("stop_adb_app", {
            serial,
            package: probePackage,
          });
          if (stopped !== null)
            check(
              "force-stop completes the dynamic-analysis run",
              stopped.package_name === probePackage,
            );
          const removed = await run("uninstall_adb_package", {
            serial,
            package: probePackage,
          });
          if (removed !== null)
            check(
              "uninstall completes the lifecycle",
              removed.package_name === probePackage,
            );
          const afterRemoval = await run("resolve_adb_packages", {
            serial,
            query: "rea.adb.probe",
          });
          if (afterRemoval !== null)
            check(
              "resolve reports zero matches after removal",
              afterRemoval.matches.length === 0,
            );
        }
      }
    } finally {
      await rm(transferRoot, { recursive: true, force: true });
    }
  }
} catch (cause) {
  verifierFailed = true;
  verifierFailure = cause;
} finally {
  try {
    await closeVerifierResources([() => provider.close()]);
  } catch (cause) {
    process.stderr.write(`[FAIL] verifier cleanup — ${formatFailure(cause)}\n`);
    failures += 1;
  }
}
if (verifierFailed) {
  process.stderr.write(
    `[FAIL] verifier aborted — ${formatFailure(verifierFailure)}\n`,
  );
  failures += 1;
}

if (failures > 0) {
  process.stdout.write(`\n${failures} check(s) failed\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("\nall adb device checks passed\n");
}

function parseArguments(argv) {
  const parsed = { help: false, serial: null, pull: null, installApk: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") parsed.help = true;
    else if (argument === "--serial") {
      parsed.serial = argv[index + 1] ?? null;
      index += 1;
    } else if (argument === "--pull") {
      parsed.pull = argv[index + 1] ?? null;
      index += 1;
    } else if (argument === "--install-apk") {
      parsed.installApk = argv[index + 1] ?? null;
      index += 1;
    } else {
      process.stderr.write(`unknown argument: ${argument}\n`);
      process.exit(2);
    }
  }
  return parsed;
}

function formatFailure(cause) {
  if (cause instanceof AggregateError)
    return `${cause.message}: ${cause.errors.map(formatFailure).join("; ")}`;
  if (cause instanceof Error) {
    const resources = cause.cleanupResources ?? cause.resources;
    const details = Array.isArray(resources)
      ? ` resources=${resources.join(", ")}`
      : "";
    const reason = cause.diagnostics?.reason;
    return `${cause.name}: ${cause.message}${details}${typeof reason === "string" ? ` reason=${reason}` : ""}`;
  }
  return String(cause);
}

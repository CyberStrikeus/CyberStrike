import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { expect, onTestFinished, test, vi } from "vitest";

const adbTestHooks = vi.hoisted(() => ({
  afterScreencap: undefined as (() => void) | undefined,
}));

vi.mock("../process/ExecFileOutput.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../process/ExecFileOutput.js")>();
  return {
    ...actual,
    execFileBytes: async (
      ...arguments_: Parameters<typeof actual.execFileBytes>
    ) => {
      const result = await actual.execFileBytes(...arguments_);
      if (arguments_[1].includes("exec-out")) adbTestHooks.afterScreencap?.();
      return result;
    },
  };
});

import { AdbProvider } from "./AdbProvider.js";
import { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { parseEvidence } from "../domain/evidence.js";
import type { AdbRequest } from "../domain/adb/adbDeviceAnalysis.js";

const it = test.skipIf(process.platform === "win32");

const SCREEN_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

const VERSION_BLOCK =
  "printf 'Android Debug Bridge version 1.0.41\\nVersion 34.0.5-stub\\nInstalled as %s\\n' \"$0\"";

const writeAdbStub = async (
  body: (root: string) => string,
): Promise<{ readonly binary: string; readonly root: string }> => {
  const root = await mkdtemp(join("/tmp", "rea-adb-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const binary = join(root, "adb");
  await writeFile(binary, `#!/bin/sh\n${body(root)}\n`, { mode: 0o755 });
  await chmod(binary, 0o755);
  return { binary, root };
};

const providerOver = (binary: string): AdbProvider =>
  new AdbProvider({ environment: { REA_ADB_PATH: binary } });

const evidenceResult = async (
  provider: AdbProvider,
  request: AdbRequest,
): Promise<Record<string, unknown>> => {
  const result = await provider.execute(request);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.result as Record<string, unknown>;
};

const refusedBy = async (
  provider: AdbProvider,
  request: AdbRequest,
): Promise<ReturnType<typeof projectAnalysisError>> => {
  const result = await provider.execute(request);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a refusal");
  return projectAnalysisError(result.error);
};

const namesAliasOnVolume = async (
  parent: string,
  firstName: string,
  secondName: string,
): Promise<boolean> => {
  const probe = join(parent, "destination-name-probe");
  await mkdir(probe);
  try {
    await mkdir(join(probe, firstName));
    try {
      await mkdir(join(probe, secondName));
      return false;
    } catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "EEXIST")
        return true;
      throw cause;
    }
  } finally {
    await rm(probe, { recursive: true, force: true });
  }
};

it("inspects the adb client without contacting the server", async () => {
  const { binary } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; fi`,
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "inspect_adb_client",
    input: {},
  });
  expect(result.client).toMatchObject({
    path_source: "environment",
    version: "34.0.5-stub",
    installed_path: binary,
  });
  expect(result.contacted_adb_server).toBe(false);
});

it("fails closed when adb exits successfully without a recognized version", async () => {
  const stdout = `unexpected adb output ${"x".repeat(700)}\n`;
  const stderr = `probe stderr ${"y".repeat(700)}\n`;
  const { binary } = await writeAdbStub(
    () => `printf '%s' '${stdout}'; printf '%s' '${stderr}' >&2; exit 0`,
  );
  await expect(
    providerOver(binary).inspectAvailability(),
  ).resolves.toMatchObject({
    status: "unavailable",
    code: "version_unresolved",
    diagnostics: {
      version_probe: "unrecognized_output",
      stdout,
      stderr,
    },
  });
});

it("accepts adb's recognized protocol version when the build version is absent", async () => {
  const { binary } = await writeAdbStub(
    () => `printf 'Android Debug Bridge version 1.0.41\\n'`,
  );
  await expect(
    providerOver(binary).inspectAvailability(),
  ).resolves.toMatchObject({
    status: "available",
  });
});

it("lists devices with inferred kinds and observed daemon startup", async () => {
  const { binary } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "devices" ]; then
  printf '* daemon not running; starting now at tcp:5037\\n* daemon started successfully\\n'
  printf 'List of devices attached\\n'
  printf 'emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1\\n'
  exit 0
fi`,
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "list_adb_devices",
    input: {},
  });
  expect(result.may_have_started_adb_server).toBe(true);
  expect(result.devices).toEqual([
    {
      serial: "emulator-5554",
      state: "device",
      transport: "tcp",
      product: "sdk_gphone64_x86_64",
      model: "sdk_gphone64_x86_64",
      device: "emu64xa",
      transport_id: 1,
      kind: "emulator",
      kind_basis: "emulator_serial_prefix",
    },
  ]);
});

it("observes daemon startup when notices are printed to stderr", async () => {
  const { binary } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "devices" ]; then
  printf '* daemon not running; starting now at tcp:5037\\n* daemon started successfully\\n' >&2
  printf 'List of devices attached\\n'
  printf 'emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1\\n'
  exit 0
fi`,
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "list_adb_devices",
    input: {},
  });
  expect(result.may_have_started_adb_server).toBe(true);
  expect(result.devices).toEqual([
    {
      serial: "emulator-5554",
      state: "device",
      transport: "tcp",
      product: "sdk_gphone64_x86_64",
      model: "sdk_gphone64_x86_64",
      device: "emu64xa",
      transport_id: 1,
      kind: "emulator",
      kind_basis: "emulator_serial_prefix",
    },
  ]);
});

it("refuses device listings with an invalid state token", async () => {
  const malformedLine = "serial deviceXYZ  ";
  const { binary } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "devices" ]; then
  printf 'List of devices attached\\n${malformedLine}\\n'
  exit 0
fi`,
  );
  const result = await providerOver(binary).execute({
    operation: "list_adb_devices",
    input: {},
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error._tag).toBe("AnalysisProtocolError");
  expect(result.error.message).toContain(malformedLine);
});

it("lists rescue and detached transports alongside online devices", async () => {
  const { binary } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "devices" ]; then
  printf 'List of devices attached\\n'
  printf 'serial-online          device transport_id:1\\n'
  printf 'serial-rescue          rescue transport_id:2\\n'
  printf 'serial-detached        detached transport_id:3\\n'
  exit 0
fi`,
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "list_adb_devices",
    input: {},
  });
  expect(result.devices).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ serial: "serial-online", state: "device" }),
      expect.objectContaining({ serial: "serial-rescue", state: "rescue" }),
      expect.objectContaining({
        serial: "serial-detached",
        state: "detached",
      }),
    ]),
  );
});

it("inspects a device through the getprop whitelist", async () => {
  const { binary } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "shell" ] && [ "$4" = "getprop" ]; then
  printf '[ro.build.version.sdk]: [34]\\n[ro.kernel.qemu]: [1]\\n[sys.private]: [x]\\n'
  exit 0
fi`,
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "inspect_adb_device",
    input: { serial: "emulator-5554" },
  });
  expect(result.emulator_observed).toBe(true);
  expect(result.properties).toEqual([
    { name: "ro.build.version.sdk", value: "34" },
    { name: "ro.kernel.qemu", value: "1" },
  ]);
});

it("passes the caller scope as an exact fixed argv vector", async () => {
  const { binary, root } = await writeAdbStub(
    (root) => `printf '%s\\n' "$@" >> ${join(root, "argv.log")}
if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "shell" ]; then printf 'package:/data/app/x/base.apk=com.example\\n'; exit 0; fi`,
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "list_adb_packages",
    input: { serial: "emulator-5554", scope: "third_party" },
  });
  expect(result.coverage).toBe("complete");
  expect(result.packages).toEqual([
    {
      package_name: "com.example",
      base_apk_device_path: "/data/app/x/base.apk",
    },
  ]);
  const logged = (await readFile(join(root, "argv.log"), "utf8"))
    .trim()
    .split("\n");
  expect(logged).toEqual([
    "version",
    "-s",
    "emulator-5554",
    "shell",
    "pm",
    "list",
    "packages",
    "-f",
    "-3",
  ]);
});

const pullStub = (
  paths: string,
  pullBody: string,
): string => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "pm" ] && [ "$5" = "path" ]; then
  printf '%s\\n' ${paths}
  exit 0
fi
if [ "$1" = "-s" ] && [ "$3" = "pull" ]; then
${pullBody}
  exit 0
fi
printf 'unexpected arguments: %s\\n' "$@"
exit 1`;

/** Stub dispatching one canned stdout per first shell word (and optional second). */
const shellStub = (
  dispatch: Readonly<Record<string, string>>,
): ((root: string) => string) => {
  const cases = Object.entries(dispatch)
    .map(([key, output]) => {
      const [first, second, third] = key.split(":");
      const guard = [
        `[ "$4" = "${first}" ]`,
        ...(second === undefined ? [] : [`[ "$5" = "${second}" ]`]),
        ...(third === undefined ? [] : [`[ "$6" = "${third}" ]`]),
      ].join(" && ");
      return `  if ${guard}; then printf '%b' '${output.replaceAll("\\", "\\\\").replaceAll("\0", "\\000").replace(/'/gu, "'\\''")}'; exit 0; fi`;
    })
    .join("\n");
  return () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "shell" ]; then
${cases}
  printf 'unexpected shell command: %s %s %s\\n' "$4" "$5" "$6" >&2
  exit 1
fi
printf 'unexpected arguments: %s\\n' "$@"
exit 1`;
};

it("pulls a complete split set with digests into a new package directory", async () => {
  const { binary, root } = await writeAdbStub(() =>
    pullStub(
      "'package:/data/app/~~a==/com.example.b==/base.apk' 'package:/data/app/~~a==/com.example.b==/split_config.en.apk'",
      `  printf 'apk-bytes-for-testing' > "$5"
  printf '1 file pulled, 0 skipped.\\n'`,
    ),
  );
  const output = join(root, "pulls");
  const result = await evidenceResult(providerOver(binary), {
    operation: "pull_adb_package",
    input: {
      serial: "emulator-5554",
      package: "com.example",
      output_directory: output,
    },
  });
  expect(result.coverage).toBe("complete");
  expect(result.failures).toEqual([]);
  const artifacts = result.artifacts as {
    file_name: string;
    local_path: string;
    sha256: string;
    role: string;
  }[];
  expect(
    artifacts.map((artifact) => [artifact.file_name, artifact.role]),
  ).toEqual([
    ["base.apk", "base"],
    ["split_config.en.apk", "split"],
  ]);
  const digest = createHash("sha256")
    .update("apk-bytes-for-testing")
    .digest("hex");
  for (const artifact of artifacts) expect(artifact.sha256).toBe(digest);
  const pulled = await readFile(
    join(output, "com.example", "base.apk"),
    "utf8",
  );
  expect(pulled).toBe("apk-bytes-for-testing");
});

it("keeps successful artifacts when one split pull fails", async () => {
  const { binary, root } = await writeAdbStub(() =>
    pullStub(
      "'package:/data/app/y/base.apk' 'package:/data/app/y/split_dpi.apk'",
      `case "$4" in
    */split_dpi.apk) printf 'error: closed\\n' >&2; exit 1;;
    *) printf 'apk-bytes-for-testing' > "$5"; printf '1 file pulled.\\n';;
  esac`,
    ),
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "pull_adb_package",
    input: {
      serial: "emulator-5554",
      package: "com.partial",
      output_directory: join(root, "pulls"),
    },
  });
  expect(result.coverage).toBe("partial");
  expect(result.artifacts).toHaveLength(1);
  expect(result.failures).toEqual([
    {
      device_path: "/data/app/y/split_dpi.apk",
      stage: "pull",
      message: expect.stringContaining("closed") as unknown,
    },
  ]);
});

it("refuses to reuse an existing package output directory", async () => {
  const { binary, root } = await writeAdbStub(() =>
    pullStub("'package:/data/app/z/base.apk'", `  printf 'x' > "$5"`),
  );
  const output = join(root, "existing");
  await mkdir(join(output, "com.example"), { recursive: true });
  const provider = providerOver(binary);
  const result = await provider.execute({
    operation: "pull_adb_package",
    input: {
      serial: "emulator-5554",
      package: "com.example",
      output_directory: output,
    },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "unreadable_output",
  });
  expect(result.error.message).toContain("already exists");
});

it.each([
  ["an empty filename", "package:/data/app/x/"],
  [
    "duplicate local filenames",
    "package:/data/app/x/base.apk\npackage:/data/app/y/base.apk",
  ],
])("refuses %s before creating output or pulling", async (_, pmOutput) => {
  const { binary, root } = await writeAdbStub(
    (root) => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "pm" ]; then printf '%b' '${pmOutput.replaceAll("'", "'\\''").replaceAll("\n", "\\n")}\\n'; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "pull" ]; then : > '${join(root, "pull-ran")}'; exit 0; fi
exit 1`,
  );
  const output = join(root, "pulls");
  const result = await providerOver(binary).execute({
    operation: "pull_adb_package",
    input: {
      serial: "emulator-5554",
      package: "com.example",
      output_directory: output,
    },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.capturedOutput?.stdout).toContain(
    pmOutput.split("\n")[0],
  );
  const projected = projectAnalysisError(result.error);
  const duplicate = pmOutput.includes("\n");
  expect(projected).toMatchObject({
    code: "unreadable_output",
    message: expect.stringContaining("pm path for com.example"),
    remediation: { action: expect.stringContaining("details.diagnostics") },
    details: {
      reason: duplicate ? "duplicate_local_destination" : "unsafe_device_path",
      diagnostics: {
        package_name: "com.example",
        ...(duplicate
          ? { device_paths: ["/data/app/x/base.apk", "/data/app/y/base.apk"] }
          : {
              rejected_paths: [
                {
                  device_path: "/data/app/x/",
                  reason: "empty_file_name",
                },
              ],
            }),
      },
      captured_output: { stdout: expect.stringContaining("package:") },
    },
  });
  await expect(readFile(join(root, "pull-ran"))).rejects.toThrow();
  await expect(lstat(output)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([
  ["case-only names", "base.apk", "BASE.APK"],
  ["normalization-equivalent names", "caf\u00e9.apk", "cafe\u0301.apk"],
])(
  "checks %s against the actual destination filesystem before pulling",
  async (_, firstName, secondName) => {
    const { binary, root } = await writeAdbStub((root) =>
      pullStub(
        `'package:/data/app/x/${firstName}' 'package:/data/app/y/${secondName}'`,
        `printf 'pulled\\n' >> '${join(root, "pull.log")}'
  printf 'apk' > "$5"`,
      ),
    );
    const aliases = await namesAliasOnVolume(root, firstName, secondName);
    const result = await providerOver(binary).execute({
      operation: "pull_adb_package",
      input: {
        serial: "emulator-5554",
        package: "com.example",
        output_directory: root,
      },
    });
    const pullLog = join(root, "pull.log");
    const packageDirectory = join(root, "com.example");
    if (aliases) {
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(projectAnalysisError(result.error)).toMatchObject({
        message: expect.stringContaining("unique local destination"),
        details: {
          reason: "local_destination_unavailable",
          diagnostics: {
            device_path: `/data/app/y/${secondName}`,
          },
        },
      });
      await expect(readFile(pullLog)).rejects.toThrow();
      await expect(lstat(packageDirectory)).rejects.toThrow();
      return;
    }
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(
      (
        result.value.result as { artifacts: { file_name: string }[] }
      ).artifacts.map((artifact) => artifact.file_name),
    ).toEqual([firstName, secondName]);
    expect((await readFile(pullLog, "utf8")).trim().split("\n")).toHaveLength(
      2,
    );
  },
);

it("reports an uninstalled package from empty pm path output", async () => {
  const { binary } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "pm" ] && [ "$5" = "path" ]; then exit 0; fi`,
  );
  const projected = await refusedBy(providerOver(binary), {
    operation: "pull_adb_package",
    input: {
      serial: "emulator-5554",
      package: "com.absent",
      output_directory: "/tmp/rea-adb-absent",
    },
  });
  expect(projected).toMatchObject({ code: "unsupported_target" });
  expect(projected.message).toContain("no APK paths");
});

it.each([
  ["not found", "error: device 'emulator-9' not found", "not found"],
  ["offline", "error: device offline", "offline"],
  ["unauthorized", "error: device unauthorized", "unauthorized"],
] as const)(
  "reports the %s device state as a target refusal",
  async (_, stderr, excerpt) => {
    const { binary } = await writeAdbStub(
      () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ]; then printf '%s\\n' "${stderr}" >&2; exit 1; fi`,
    );
    const projected = await refusedBy(providerOver(binary), {
      operation: "inspect_adb_device",
      input: { serial: "emulator-5554" },
    });
    expect(projected).toMatchObject({ code: "unsupported_target" });
    expect(projected.message).toContain(excerpt);
  },
);

it("reports a missing selected binary as a capability gap with recovery", async () => {
  const provider = new AdbProvider({
    environment: { REA_ADB_PATH: "/nonexistent/adb" },
  });
  const availability = await provider.inspectAvailability();
  expect(availability).toMatchObject({ status: "unavailable" });
  if (availability.status !== "unavailable") return;
  expect(availability.diagnostics.remediation).toContain("REA_ADB_PATH");
  const result = await provider.execute({
    operation: "list_adb_devices",
    input: {},
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const projected = projectAnalysisError(result.error);
  expect(projected).toMatchObject({ code: "capability_unavailable" });
  expect(projected.message).toContain("REA_ADB_PATH");
  expect(projected.remediation).toMatchObject({
    action: expect.stringContaining("REA_ADB_PATH") as unknown,
  });
  expect(projected.details).toMatchObject({
    provider_id: "adb",
    reason: expect.stringContaining("not found") as unknown,
  });
});

it("reports relative adb configuration as an actionable refusal", async () => {
  const provider = new AdbProvider({
    environment: { REA_ADB_PATH: "relative/adb" },
  });
  const availability = await provider.inspectAvailability();
  expect(availability).toMatchObject({
    status: "unavailable",
    reason: expect.stringContaining("REA_ADB_PATH") as unknown,
  });
  const projected = await refusedBy(provider, {
    operation: "list_adb_devices",
    input: {},
  });
  expect(projected).toMatchObject({
    code: "capability_unavailable",
    message: expect.stringContaining("REA_ADB_PATH") as unknown,
    remediation: {
      action: expect.stringContaining("REA_ADB_PATH") as unknown,
    },
  });
});

it("cancels before spawning anything", async () => {
  const { binary, root } = await writeAdbStub(
    (root) => `: > ${join(root, "spawned")}
if [ "$1" = "version" ]; then ${VERSION_BLOCK}; fi`,
  );
  const controller = new AbortController();
  controller.abort();
  const cancelled = await providerOver(binary).execute(
    { operation: "list_adb_devices", input: {} },
    { signal: controller.signal },
  );
  expect(cancelled.ok).toBe(false);
  if (cancelled.ok) return;
  expect(projectAnalysisError(cancelled.error)).toMatchObject({
    code: "cancelled",
  });
  expect(
    await readFile(join(root, "spawned")).then(
      () => true,
      () => false,
    ),
  ).toBe(false);
});

it("reads a bounded logcat dump with the caller count and buffer", async () => {
  const { binary } = await writeAdbStub(
    shellStub({
      logcat:
        "08-10 13:00:00.000 I/Tag( 123): first\n08-10 13:00:01.000 I/Tag( 123): second\n",
    }),
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "read_adb_logcat",
    input: { serial: "emulator-5554", count: 500, buffer: "main" },
  });
  expect(result.lines).toEqual([
    "08-10 13:00:00.000 I/Tag( 123): first",
    "08-10 13:00:01.000 I/Tag( 123): second",
  ]);
});

it("reports UTF-8 byte counts in total_bytes for non-ASCII logcat output", async () => {
  const { binary } = await writeAdbStub(
    shellStub({
      logcat:
        "08-10 13:00:00.000 I/Tag( 1): 中文\n08-10 13:00:00.000 I/Tag( 1): 😀\n",
    }),
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "read_adb_logcat",
    input: { serial: "emulator-5554", count: 500, buffer: "main" },
  });
  expect(result.lines).toEqual([
    "08-10 13:00:00.000 I/Tag( 1): 中文",
    "08-10 13:00:00.000 I/Tag( 1): 😀",
  ]);
  // 30-byte prefix + 6-byte CJK + LF = 37; 30-byte prefix + 4-byte emoji + LF = 35.
  expect(result.total_bytes).toBe(72);
});

it("counts raw captured bytes in total_bytes for malformed UTF-8 logcat output", async () => {
  const { binary } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "shell" ]; then
  printf '%b' '08-10 13:00:00.000 I/Tag( 1): A\\377B\\n'
  exit 0
fi
printf 'unexpected arguments: %s\\n' "$@"
exit 1`,
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "read_adb_logcat",
    input: { serial: "emulator-5554", count: 500, buffer: "main" },
  });
  // 30-byte prefix + "A" + one raw 0xff byte + "B" + LF = 34 captured bytes.
  // Re-encoding the decoded U+FFFD replacement would report 36.
  expect(result.total_bytes).toBe(34);
});

it("marks coverage partial when `pkg=null` leaves permissions unknown", async () => {
  const { binary } = await writeAdbStub(
    shellStub({
      "dumpsys:package": `Packages:
  Package [com.example] (abcdef):
    userId=10234
    pkg=null
    versionCode=45 minSdk=24 targetSdk=34
    codePath=/data/app/com.example
`,
    }),
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "inspect_adb_package",
    input: { serial: "emulator-5554", package: "com.example" },
  });
  expect(result).toMatchObject({
    requested_permissions_count: null,
    coverage: "partial",
  });
});

it("keeps permission counts unknown when package state is not established", async () => {
  const { binary } = await writeAdbStub(
    shellStub({
      "dumpsys:package": `Packages:
  Package [com.example] (abcdef):
    appId=10234
    codePath=/data/app/com.example
    versionCode=45 minSdk=24 targetSdk=34
`,
    }),
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "inspect_adb_package",
    input: { serial: "emulator-5554", package: "com.example" },
  });
  expect(result).toMatchObject({
    version_code: "45",
    requested_permissions_count: null,
    coverage: "partial",
  });
});

it("projects package details from dumpsys package output", async () => {
  const { binary } = await writeAdbStub(
    shellStub({
      "dumpsys:package": `Packages:
  Package [com.example] (abcdef):
    userId=10234
    versionName=1.2.3
    versionCode=45 minSdk=24 targetSdk=34
    firstInstallTime=2026-01-02 03:04:05
    lastUpdateTime=2026-02-03 04:05:06
    installerPackageName=com.android.vending
    pkgFlags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]
    requested permissions:
      android.permission.INTERNET
      android.permission.CAMERA
`,
    }),
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "inspect_adb_package",
    input: { serial: "emulator-5554", package: "com.example" },
  });
  expect(result).toMatchObject({
    version_name: "1.2.3",
    version_code: "45",
    first_install_time: "2026-01-02 03:04:05",
    last_update_time: "2026-02-03 04:05:06",
    installer_package_name: "com.android.vending",
    user_id: 10234,
    requested_permissions_count: 2,
    coverage: "complete",
  });
});

// Package Manager prints an absent installer as the text "null"; the
// normalized result must report the absence, not a package named "null"
// (morluto/rea#3943).
it("reports a null installer declaration as an absent installer", async () => {
  const { binary } = await writeAdbStub(
    shellStub({
      "dumpsys:package": `Packages:
  Package [com.example] (abcdef):
    versionName=1.2.3
    installerPackageName=null
    requested permissions:
      android.permission.INTERNET
`,
    }),
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "inspect_adb_package",
    input: { serial: "emulator-5554", package: "com.example" },
  });
  expect(result).toMatchObject({
    version_name: "1.2.3",
    installer_package_name: null,
    requested_permissions_count: 1,
    coverage: "complete",
  });
});

// PackageInfo.getLongVersionCode() combines versionCodeMajor and versionCode
// into a signed 64-bit long, which JSON numbers cannot hold exactly.
it.each(["9007199254740993", "-4294967296"])(
  "keeps the long version code %s exactly as dumpsys prints it",
  async (versionCode) => {
    const { binary } = await writeAdbStub(
      shellStub({
        "dumpsys:package": `Packages:
  Package [com.example] (abcdef):
    pkg=Package{abcdef com.example}
    versionCode=${versionCode} minSdk=24 targetSdk=34
`,
      }),
    );
    const result = await evidenceResult(providerOver(binary), {
      operation: "inspect_adb_package",
      input: { serial: "emulator-5554", package: "com.example" },
    });
    expect(result).toMatchObject({
      version_code: versionCode,
      requested_permissions_count: 0,
      coverage: "complete",
    });
  },
);

// Android 10 and 11 append ": restricted=true" to hard- and soft-restricted
// entries of the requested-permissions list (Settings.dumpPackageLPr).
it("counts requested permissions that the device marks as restricted", async () => {
  const { binary } = await writeAdbStub(
    shellStub({
      "dumpsys:package": `Packages:
  Package [com.example] (abcdef):
    userId=10234
    versionName=1.2.3
    requested permissions:
      android.permission.INTERNET
      android.permission.WRITE_EXTERNAL_STORAGE: restricted=true
      android.permission.CAMERA
    install permissions:
      android.permission.INTERNET: granted=true
`,
    }),
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "inspect_adb_package",
    input: { serial: "emulator-5554", package: "com.example" },
  });
  expect(result).toMatchObject({
    requested_permissions_count: 3,
    coverage: "complete",
  });
});

it("counts Unicode requested-permission names and continues through the section", async () => {
  const { binary } = await writeAdbStub(
    shellStub({
      "dumpsys:package": `Packages:
  Package [com.example] (abcdef):
    pkg=Package{abcdef com.example}
    versionCode=45 minSdk=24 targetSdk=34
    requested permissions:
      com.example.permission.FIRST
      com.example.permission.ÉCRIRE WITH SPACE
      android.permission.CAMERA
    install permissions:
      android.permission.CAMERA: granted=true
`,
    }),
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "inspect_adb_package",
    input: { serial: "emulator-5554", package: "com.example" },
  });
  expect(result).toMatchObject({
    requested_permissions_count: 3,
    coverage: "complete",
  });
});

it("ends requested permissions at a same-indent dumpsys field", async () => {
  const { binary } = await writeAdbStub(
    shellStub({
      "dumpsys:package": `Packages:
  Package [com.example] (abcdef):
    pkg=Package{abcdef com.example}
    versionCode=45 minSdk=24 targetSdk=34
    requested permissions:
      android.permission.INTERNET
    gids=[1000]
      android.permission.CAMERA
`,
    }),
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "inspect_adb_package",
    input: { serial: "emulator-5554", package: "com.example" },
  });
  expect(result).toMatchObject({
    requested_permissions_count: 1,
    coverage: "complete",
  });
});

it("reports an uninstalled package from dumpsys refusal output", async () => {
  const { binary } = await writeAdbStub(
    shellStub({ "dumpsys:package": "Unable to find package: com.absent\n" }),
  );
  const projected = await refusedBy(providerOver(binary), {
    operation: "inspect_adb_package",
    input: { serial: "emulator-5554", package: "com.absent" },
  });
  expect(projected).toMatchObject({ code: "unsupported_target" });
});

it("pulls one device file with a digest", async () => {
  const { binary, root } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "pull" ]; then printf 'file-bytes' > "$5"; exit 0; fi
exit 1`,
  );
  const output = join(root, "pulls");
  const result = await evidenceResult(providerOver(binary), {
    operation: "pull_adb_file",
    input: {
      serial: "emulator-5554",
      device_path: "/data/local/tmp/My Notes:r*sumé.txt",
      output_directory: output,
    },
  });
  const digest = createHash("sha256").update("file-bytes").digest("hex");
  expect(result).toMatchObject({
    device_path: "/data/local/tmp/My Notes:r*sumé.txt",
    local_path: join(output, "My Notes:r*sumé.txt"),
    bytes: 10,
    sha256: digest,
  });
});

it.each([
  [
    "pull_adb_file",
    "adb: error: failed to stat remote object /sdcard/unauthorized.bin: No such file or directory",
    "/sdcard/unauthorized.bin",
  ],
  [
    "pull_adb_file",
    "adb: error: failed to open /sdcard/unauthorized.bin: Permission denied",
    "/sdcard/unauthorized.bin",
  ],
  [
    "pull_adb_file",
    "* daemon not running; starting now at tcp:5037\n* daemon started successfully\nadb: error: device offline",
    "emulator-5554",
  ],
  ["pull_adb_file", "error: device unauthorized", "emulator-5554"],
  [
    "pull_adb_file",
    "* daemon not running. starting it now on port 5037 *\r\n* daemon started successfully *\r\nerror: device offline",
    "emulator-5554",
  ],
  [
    "pull_adb_file",
    "* daemon started successfully *\r\nerror: device 'emulator-5554' not found",
    "emulator-5554",
  ],
  [
    "push_adb_file",
    "adb: error: connect failed: device offline",
    "emulator-5554",
  ],
  ["push_adb_file", "error: device unauthorized", "emulator-5554"],
  ["push_adb_file", "Permission denied", "/sdcard/unauthorized.bin"],
] as const)(
  "attributes %s refusal %s to %s",
  async (operation, reason, path) => {
    const { binary, root } = await writeAdbStub(
      () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" != "-s" ] || [ "$2" != "emulator-5554" ]; then exit 91; fi
if [ "$3" = "shell" ] && [ "$4" = "test" ] && [ "$6" = "/sdcard/unauthorized.bin" ]; then exit 1; fi
if [ "$3:$4" = "pull:/sdcard/unauthorized.bin" ] || [ "$3:$5" = "push:/sdcard/unauthorized.bin" ]; then
  printf '%s\\n' '${reason.replaceAll("'", "'\\''")}' >&2
  exit 1
fi
exit 91`,
    );
    const localPath = join(root, "payload.bin");
    await writeFile(localPath, "payload");
    const input = {
      serial: "emulator-5554",
      device_path: "/sdcard/unauthorized.bin",
    };
    const projected = await refusedBy(
      providerOver(binary),
      operation === "pull_adb_file"
        ? {
            operation,
            input: { ...input, output_directory: join(root, "pulls") },
          }
        : {
            operation,
            input: { ...input, local_path: localPath, overwrite: false },
          },
    );
    expect(projected).toMatchObject({
      code: "unsupported_target",
      details: { operation, path, reason },
      message: `Unsupported target for ${operation} at ${path}: ${reason}`,
    });
  },
);

it.each([
  ["pull_adb_file", "cannot create '%s': Permission denied"],
  ["pull_adb_file", "cannot create file/directory '%s': Permission denied"],
  ["pull_adb_file", "cannot write '%s': Permission denied"],
  ["push_adb_file", "cannot stat '%s': No such file or directory"],
  ["push_adb_file", "opening '%s' locally failed: Permission denied"],
  ["push_adb_file", "reading '%s' locally failed: Permission denied"],
  ["push_adb_file", "failed to read all of '%s': Permission denied"],
] as const)(
  "keeps the actual host file identity for %s refusal %s",
  async (operation, diagnostic) => {
    const { binary, root } = await writeAdbStub(
      (stubRoot) => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" != "-s" ] || [ "$2" != "emulator-5554" ]; then exit 91; fi
if [ "$3" = "shell" ] && [ "$4" = "test" ]; then exit 1; fi
if [ "$3" = "pull" ]; then
  printf '%s' "$5" > '${stubRoot}/host-path'
  printf "adb: error: ${diagnostic}\\n" "$5" >&2
  exit 1
fi
if [ "$3" = "push" ]; then
  printf '%s' "$4" > '${stubRoot}/host-path'
  printf "adb: error: ${diagnostic}\\n" "$4" >&2
  exit 1
fi
exit 91`,
    );
    const localPath = join(root, "payload.bin");
    await writeFile(localPath, "payload");
    const input = {
      serial: "emulator-5554",
      device_path: "/sdcard/sample.bin",
    };
    const projected = await refusedBy(
      providerOver(binary),
      operation === "pull_adb_file"
        ? {
            operation,
            input: { ...input, output_directory: join(root, "pulls") },
          }
        : {
            operation,
            input: { ...input, local_path: localPath, overwrite: false },
          },
    );
    const hostPath = await readFile(join(root, "host-path"), "utf8");
    expect(projected).toMatchObject({
      code: "unsupported_target",
      details: {
        operation,
        path: hostPath,
        reason: expect.stringContaining(hostPath),
      },
    });
    expect(projected.message).toContain(`at ${hostPath}:`);
  },
);

it.each([
  ["/data/local/tmp/..", "dot_segment"],
  ["/data/local/tmp/", "empty_file_name"],
] as const)(
  "refuses the unsafe device path %s before pulling",
  async (devicePath, reason) => {
    const { binary, root } = await writeAdbStub(
      (root) => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
: > "${join(root, "pull-ran")}"
exit 0`,
    );
    const output = join(root, "pulls");
    const result = await providerOver(binary).execute({
      operation: "pull_adb_file",
      input: {
        serial: "emulator-5554",
        device_path: devicePath,
        output_directory: output,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({ code: "invalid_request" });
    expect(projected.details).toMatchObject({
      issues: [
        {
          path: ["device_path"],
          reason: "invalid_value",
          message: expect.stringContaining(
            `${JSON.stringify(devicePath)} does not name`,
          ),
        },
      ],
    });
    expect(
      (projected.details as { issues: { message: string }[] }).issues[0]!
        .message,
    ).toContain(reason);
    // No host directory and no adb invocation are effects of a refused pull.
    await expect(readFile(join(root, "pull-ran"))).rejects.toThrow();
    await expect(lstat(output)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

const PUSHED_DIGEST =
  "8748b5d17d1ebcec7d46674fa6a8b92c0f95598a552f27c1c8a132eb58c04043";

it.each([
  {
    answer: "a digest line",
    stdout: `${PUSHED_DIGEST}  /data/local/tmp/payload.bin\n`,
    exit: 0,
    verified: true,
  },
  {
    // GNU sha256sum prefixes a line whose echoed name it escaped.
    answer: "an escaped digest line",
    stdout: `\\${PUSHED_DIGEST}  /data/local/tmp/pay\\\\load.bin\n`,
    exit: 0,
    verified: true,
  },
  { answer: "empty output", stdout: "", exit: 0, verified: false },
  {
    answer: "a malformed line",
    stdout: `${PUSHED_DIGEST.slice(1)}  /data/local/tmp/payload.bin\n`,
    exit: 0,
    verified: false,
  },
  { answer: "a failed command", stdout: "", exit: 127, verified: false },
])(
  "derives the push digest source from $answer",
  async ({ stdout, exit, verified }) => {
    const { binary, root } = await writeAdbStub(
      (stubRoot) => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "test" ]; then exit 1; fi
if [ "$1" = "-s" ] && [ "$3" = "push" ]; then exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "sha256sum" ]; then cat "${join(stubRoot, "sha256sum.out")}"; exit ${exit}; fi
exit 1`,
    );
    await writeFile(join(root, "sha256sum.out"), stdout);
    const localFile = join(root, "payload.bin");
    await writeFile(localFile, "push-payload");
    const result = await providerOver(binary).execute({
      operation: "push_adb_file",
      input: {
        serial: "emulator-5554",
        local_path: localFile,
        device_path: "/data/local/tmp/payload.bin",
        overwrite: false,
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.result).toMatchObject({
      bytes: 12,
      sha256: PUSHED_DIGEST,
      overwritten: false,
      ...(verified
        ? {
            device_sha256: PUSHED_DIGEST,
            device_digest_source: "device_sha256sum",
          }
        : { device_sha256: null, device_digest_source: "unavailable" }),
    });
    expect(
      result.value.limitations.some((line) =>
        line.includes("not device-side verified"),
      ),
    ).toBe(!verified);
    // Unrecognized checksum output stays inspectable instead of being dropped.
    expect(result.value.rawResult).toEqual(
      !verified && exit === 0
        ? { device_sha256sum: { stdout, stderr: "" } }
        : null,
    );
  },
);

it("pushes the same private bytes that its reported digest identifies", async () => {
  const { binary, root } = await writeAdbStub(
    (stubRoot) => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "test" ]; then exit 1; fi
if [ "$1" = "-s" ] && [ "$3" = "push" ]; then
  printf 'replacement' > "${join(stubRoot, "payload.bin")}"
  cat "$4" > "${join(stubRoot, "consumed-push.bin")}"
  exit 0
fi
if [ "$1" = "-s" ] && [ "$4" = "sha256sum" ]; then exit 1; fi
exit 1`,
  );
  const localFile = join(root, "payload.bin");
  await writeFile(localFile, "original-push");
  const digest = createHash("sha256").update("original-push").digest("hex");
  const pushed = await evidenceResult(providerOver(binary), {
    operation: "push_adb_file",
    input: {
      serial: "emulator-5554",
      local_path: localFile,
      device_path: "/data/local/tmp/payload.bin",
      overwrite: false,
    },
  });
  expect(await readFile(join(root, "consumed-push.bin"), "utf8")).toBe(
    "original-push",
  );
  expect(await readFile(localFile, "utf8")).toBe("replacement");
  expect(pushed).toMatchObject({
    local_path: localFile,
    bytes: 13,
    sha256: digest,
    device_sha256: null,
    device_digest_source: "unavailable",
  });
});

it("preserves executable bits on the private snapshot consumed by adb push", async () => {
  const { binary, root } = await writeAdbStub(
    (stubRoot) => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "test" ]; then exit 1; fi
if [ "$1" = "-s" ] && [ "$3" = "push" ]; then ls -ld "$4" | cut -c1-10 > "${join(stubRoot, "staged-mode")}"; exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "sha256sum" ]; then exit 1; fi
exit 1`,
  );
  const localFile = join(root, "executable");
  await writeFile(localFile, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await chmod(localFile, 0o755);
  const result = await providerOver(binary).execute({
    operation: "push_adb_file",
    input: {
      serial: "emulator-5554",
      local_path: localFile,
      device_path: "/data/local/tmp/executable",
      overwrite: false,
    },
  });
  expect(result.ok).toBe(true);
  expect(await readFile(join(root, "staged-mode"), "utf8")).toBe(
    "-r-x--x--x\n",
  );
});

it("reports and verifies the effective file path when adb targets a directory", async () => {
  const { binary, root } = await writeAdbStub(
    (stubRoot) => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "test" ]; then
  if [ "$5" = "-d" ] && [ "$6" = "/data/local/tmp/drop/" ]; then exit 0; fi
  if [ "$5" = "-e" ] && [ "$6" = "/data/local/tmp/drop/payload.bin" ]; then exit 1; fi
fi
if [ "$1" = "-s" ] && [ "$3" = "push" ]; then printf '%s' "$5" > "${join(stubRoot, "pushed-destination")}"; exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "sha256sum" ]; then printf '%s  %s\\n' '${PUSHED_DIGEST}' "$5"; exit 0; fi
exit 1`,
  );
  const localFile = join(root, "payload.bin");
  await writeFile(localFile, "push-payload");
  const result = await providerOver(binary).execute({
    operation: "push_adb_file",
    input: {
      serial: "emulator-5554",
      local_path: localFile,
      device_path: "/data/local/tmp/drop/",
      overwrite: false,
    },
  });
  if (!result.ok) throw new Error(result.error.message);
  expect(await readFile(join(root, "pushed-destination"), "utf8")).toBe(
    "/data/local/tmp/drop/",
  );
  expect(result.value.result).toMatchObject({
    device_path: "/data/local/tmp/drop/payload.bin",
    overwritten: false,
    device_sha256: PUSHED_DIGEST,
  });
});

it("retains failed snapshot cleanup with completed push Evidence until close retries", async () => {
  const { binary, root } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "test" ]; then exit 1; fi
if [ "$1" = "-s" ] && [ "$3" = "push" ]; then exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "sha256sum" ]; then exit 1; fi
exit 1`,
  );
  const localFile = join(root, "cleanup-payload.bin");
  await writeFile(localFile, "payload");
  let closeAttempts = 0;
  const provider = new AdbProvider({
    environment: { REA_ADB_PATH: binary },
    createRuntimeRoot: async (options) => {
      const runtime = await PrivateRuntimeRoot.create(options);
      return {
        path: runtime.path,
        close: async () => {
          closeAttempts += 1;
          if (closeAttempts === 1) throw new Error("controlled cleanup fault");
          await runtime.close();
        },
      };
    },
  });
  const result = await provider.execute({
    operation: "push_adb_file",
    input: {
      serial: "emulator-5554",
      local_path: localFile,
      device_path: "/data/local/tmp/cleanup-payload.bin",
      overwrite: false,
    },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected snapshot cleanup to be reported");
  expect(result.error.cleanupResources).toHaveLength(1);
  expect(result.error.partialObservation).toMatchObject({
    operation: "push_adb_file",
    normalized_result: { bytes: 7 },
  });
  await provider.close();
  expect(closeAttempts).toBe(2);
});

it("verifies the device-side digest for a long device path", async () => {
  const { binary, root } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "test" ]; then exit 1; fi
if [ "$1" = "-s" ] && [ "$3" = "push" ]; then exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "sha256sum" ]; then printf '%s  %s\\n' "8748b5d17d1ebcec7d46674fa6a8b92c0f95598a552f27c1c8a132eb58c04043" "$5"; exit 0; fi
exit 1`,
  );
  const localFile = join(root, "payload.bin");
  await writeFile(localFile, "push-payload");
  const digest = createHash("sha256").update("push-payload").digest("hex");
  const pushed = await evidenceResult(providerOver(binary), {
    operation: "push_adb_file",
    input: {
      serial: "emulator-5554",
      local_path: localFile,
      // Each component stays within the usual 255-byte limit; the whole
      // path still makes the digest line exceed the former 1 KiB budget.
      device_path: `/data/local/tmp/${Array.from({ length: 5 }, (_, index) =>
        String(index).padEnd(220, "d"),
      ).join("/")}/payload.bin`,
      overwrite: false,
    },
  });
  expect(pushed).toMatchObject({
    device_sha256: digest,
    device_digest_source: "device_sha256sum",
  });
});

it("reports a digest mismatch after push as a changed artifact", async () => {
  const { binary, root } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "test" ]; then exit 1; fi
if [ "$1" = "-s" ] && [ "$3" = "push" ]; then exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "sha256sum" ]; then printf '%s  %s\\n' "$(printf 'a%.0s' 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64)" "$5"; exit 0; fi
exit 1`,
  );
  const localFile = join(root, "payload.bin");
  await writeFile(localFile, "push-payload");
  const result = await providerOver(binary).execute({
    operation: "push_adb_file",
    input: {
      serial: "emulator-5554",
      local_path: localFile,
      device_path: "/data/local/tmp/payload.bin",
      overwrite: false,
    },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a changed-artifact result");
  const evidence = parseEvidence(result.error.partialObservation);
  expect(evidence).toMatchObject({
    operation: "push_adb_file",
    normalized_result: {
      local_path: localFile,
      device_path: "/data/local/tmp/payload.bin",
      bytes: Buffer.byteLength("push-payload"),
      sha256: createHash("sha256").update("push-payload").digest("hex"),
      device_digest_source: "device_sha256sum",
    },
  });
  const projected = projectAnalysisError(result.error);
  expect(projected).toMatchObject({ code: "artifact_changed" });
});

it("refuses a push onto an existing device path without overwrite", async () => {
  const { binary, root } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$4" = "test" ]; then exit 0; fi
exit 1`,
  );
  const localFile = join(root, "payload.bin");
  await writeFile(localFile, "x");
  const result = await providerOver(binary).execute({
    operation: "push_adb_file",
    input: {
      serial: "emulator-5554",
      local_path: localFile,
      device_path: "/data/local/tmp/exists.bin",
      overwrite: false,
    },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "unreadable_output",
  });
  expect(result.error.message).toContain("overwrite");
});

it.each([
  ["offline", false, "error: device offline"],
  ["unauthorized", false, "error: device unauthorized"],
  ["offline", true, "error: device offline"],
] as const)(
  "reports the %s device state when the push existence probe cannot run (overwrite %s)",
  async (state, overwrite, stderr) => {
    const { binary, root } = await writeAdbStub(
      (stubRoot) => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ]; then printf '%s\\n' "$3" >> "${stubRoot}/calls"; printf '%s\\n' "${stderr}" >&2; exit 1; fi`,
    );
    const localFile = join(root, "payload.bin");
    await writeFile(localFile, "x");
    const projected = await refusedBy(providerOver(binary), {
      operation: "push_adb_file",
      input: {
        serial: "emulator-5554",
        local_path: localFile,
        device_path: "/data/local/tmp/payload.bin",
        overwrite,
      },
    });
    // Existence is unknown, so nothing is claimed about the path and no push runs.
    expect(projected).toMatchObject({
      code: "unsupported_target",
      details: { path: "emulator-5554", reason: stderr },
    });
    expect(projected.message).toContain(state);
    expect(projected.message).not.toContain("already exists");
    expect(await readFile(join(root, "calls"), "utf8")).toBe("shell\n");
  },
);

it("reports a local push source that does not exist", async () => {
  const { binary } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
exit 1`,
  );
  const projected = await refusedBy(providerOver(binary), {
    operation: "push_adb_file",
    input: {
      serial: "emulator-5554",
      local_path: "/nonexistent/payload.bin",
      device_path: "/data/local/tmp/payload.bin",
      overwrite: false,
    },
  });
  expect(projected).toMatchObject({ code: "invalid_request" });
});

it("captures the screen as a digested PNG with its dimensions", async () => {
  const { binary, root } = await writeAdbStub(
    (root) => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "exec-out" ]; then
  cat "${join(root, "screen-fixture.png")}"
  exit 0
fi
exit 1`,
  );
  await writeFile(join(root, "screen-fixture.png"), SCREEN_PNG);
  const output = join(root, "captures");
  const result = await evidenceResult(providerOver(binary), {
    operation: "capture_adb_screen",
    input: { serial: "emulator-5554", output_directory: output },
  });
  expect(result).toMatchObject({ width: 1, height: 1 });
  expect(
    await readFile(join(output, "screen.png")).then(
      (bytes) => bytes.subarray(1, 4).toString("latin1") === "PNG",
      () => false,
    ),
  ).toBe(true);
});

it("stops a screen capture aborted after adb returns but before publication", async () => {
  const { binary, root } = await writeAdbStub(
    (root) => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "exec-out" ]; then
  cat "${join(root, "screen-fixture.png")}"
  exit 0
fi
exit 1`,
  );
  await writeFile(join(root, "screen-fixture.png"), SCREEN_PNG);
  const output = join(root, "cancelled-capture");
  const controller = new AbortController();
  adbTestHooks.afterScreencap = () => controller.abort();
  try {
    const result = await providerOver(binary).execute(
      {
        operation: "capture_adb_screen",
        input: { serial: "emulator-5554", output_directory: output },
      },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(projectAnalysisError(result.error).code).toBe("cancelled");
    await expect(readFile(join(output, "screen.png"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    adbTestHooks.afterScreencap = undefined;
  }
});

it("preserves process names printed by Toybox without treating their whitespace as column padding", async () => {
  // Toybox's final NAME column is left justified without padding; only the
  // single separator after S belongs to the table (toys/posix/ps.c show_ps).
  const name = " native tool ";
  const { binary } = await writeAdbStub(
    shellStub({
      ps: `USER PID PPID VSZ RSS WCHAN ADDR S NAME\nroot 1234 567 123456 7890 0 0 S ${name}\r\n`,
    }),
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "list_adb_processes",
    input: { serial: "emulator-5554" },
  });
  expect(result.processes).toEqual([
    { user: "root", pid: 1234, ppid: 567, rss: 7890, state: "S", name },
  ]);
});

it("lists processes, features, and services through fixed commands", async () => {
  const { binary } = await writeAdbStub(
    shellStub({
      ps: "USER PID PPID VSZ RSS WCHAN ADDR S NAME\nu0_a1 1234 567 123456 7890 0 0 S com.example.app\n",
      "pm:list":
        "feature:android.hardware.camera\nfeature:android.hardware.nfc=1\n",
      "service:list":
        "Found 2 services:\n  1 package: [android.content.pm.IPackageManager]\n  2 activity: [android.app.IActivityManager]\n",
    }),
  );
  const processes = await evidenceResult(providerOver(binary), {
    operation: "list_adb_processes",
    input: { serial: "emulator-5554" },
  });
  expect(processes.processes).toEqual([
    {
      user: "u0_a1",
      pid: 1234,
      ppid: 567,
      rss: 7890,
      state: "S",
      name: "com.example.app",
    },
  ]);
  const features = await evidenceResult(providerOver(binary), {
    operation: "list_adb_features",
    input: { serial: "emulator-5554" },
  });
  expect(features.features).toEqual([
    { name: "android.hardware.camera", version: null },
    { name: "android.hardware.nfc", version: 1 },
  ]);
  const services = await evidenceResult(providerOver(binary), {
    operation: "list_adb_services",
    input: { serial: "emulator-5554" },
  });
  expect(services.services).toEqual([
    { name: "package", interface: "android.content.pm.IPackageManager" },
    { name: "activity", interface: "android.app.IActivityManager" },
  ]);
});

it.each(["complete", "truncated"] as const)(
  "preserves framed directory identities with %s output",
  async (variant) => {
    const date = "2026-01-02 11:00:00.000000000 +0000";
    const names = [
      "app.db",
      " app.db ",
      "   ",
      "one -> two -> three",
      "line\r",
      "line\u2028break",
      "foo\n-rw-rw---- root root 0 2026-01-01 10:00 ghost",
      "literal\\n",
    ];
    const links = [
      ["lib", "/apex/com.android.art/lib"],
      [" lib ", " /apex/lib "],
      ["one -> two\n", "three -> four\n\n"],
    ] as const;
    const truncated = `-rw-rw----|u0_a1|u0_a1|4096|${date}\0unfinished`;
    const output = [
      ...names.map(
        (name) => `-rw-rw----|u0_a1|u0_a1|4096|${date}\0${name}\0\0`,
      ),
      ...links.map(
        ([name, target]) =>
          `lrwxrwxrwx|root|root|${Buffer.byteLength(target)}|${date}\0${name}\0${target}\0`,
      ),
      ...(variant === "truncated" ? [truncated] : []),
    ].join("");
    const { binary } = await writeAdbStub(shellStub({ sh: output }));
    const result = await evidenceResult(providerOver(binary), {
      operation: "list_adb_directory",
      input: {
        serial: "emulator-5554",
        device_path: "/data/data/com.example.app",
      },
    });
    expect(result.entries).toEqual([
      ...names.map((name) => ({
        name,
        kind: "file",
        permissions: "-rw-rw----",
        owner: "u0_a1",
        group: "u0_a1",
        bytes: 4096,
        date,
        link_target: null,
      })),
      ...links.map(([name, target]) => ({
        name,
        kind: "symlink",
        permissions: "lrwxrwxrwx",
        owner: "root",
        group: "root",
        bytes: Buffer.byteLength(target),
        date,
        link_target: target,
      })),
    ]);
    expect(result.unparsed_lines).toEqual(
      variant === "truncated" ? [truncated] : [],
    );
    expect(result.coverage).toBe(
      variant === "truncated" ? "partial" : "complete",
    );
  },
);

it("inspects the display and window focus", async () => {
  const { binary } = await writeAdbStub(
    shellStub({
      "wm:size": "Physical size: 1080x2340\n",
      "wm:density": "Physical density: 420\n",
      "dumpsys:window":
        "  mCurrentFocus=Window{abcdef u0 com.example.app/com.example.app.MainActivity}\n",
    }),
  );
  const display = await evidenceResult(providerOver(binary), {
    operation: "inspect_adb_display",
    input: { serial: "emulator-5554" },
  });
  expect(display.physical_size).toEqual({ width: 1080, height: 2340 });
  expect(display.physical_density).toBe(420);
  const window = await evidenceResult(providerOver(binary), {
    operation: "inspect_adb_window",
    input: { serial: "emulator-5554" },
  });
  expect(window.focused_window).toBe(
    "Window{abcdef u0 com.example.app/com.example.app.MainActivity}",
  );
});

// Older builds print `wm density` as a bare number; the display projection
// must keep it as the physical density (morluto/rea#3942).
it("keeps a bare numeric wm density as the physical density", async () => {
  const { binary } = await writeAdbStub(
    shellStub({
      "wm:size": "Physical size: 1080x2340\n",
      "wm:density": "420\n",
    }),
  );
  const display = await evidenceResult(providerOver(binary), {
    operation: "inspect_adb_display",
    input: { serial: "emulator-5554" },
  });
  expect(display).toMatchObject({
    physical_size: { width: 1080, height: 2340 },
    physical_density: 420,
    override_density: null,
  });
});

it("reads Android 16 focus declarations from displays when windows omits them", async () => {
  const { binary } = await writeAdbStub(
    shellStub({
      "dumpsys:window:windows": "Window state has no focus fields\\n",
      "dumpsys:window:displays":
        "mCurrentFocus=Window{abc u0 com.example/.Main}\nmFocusedApp=ActivityRecord{def u0 com.example/.Main t1}\n",
    }),
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "inspect_adb_window",
    input: { serial: "emulator-5554" },
  });
  expect(result).toMatchObject({
    focused_window: "Window{abc u0 com.example/.Main}",
    focused_app: "ActivityRecord{def u0 com.example/.Main t1}",
    observed_lines: [
      "mCurrentFocus=Window{abc u0 com.example/.Main}",
      "mFocusedApp=ActivityRecord{def u0 com.example/.Main t1}",
    ],
  });
  const execution = await providerOver(binary).execute({
    operation: "inspect_adb_window",
    input: { serial: "emulator-5554" },
  });
  expect(execution.ok).toBe(true);
  if (!execution.ok) throw execution.error;
  expect(execution.value.limitations).toContainEqual(
    expect.stringContaining("dumpsys window displays"),
  );
});

it("describes missing window focus as unknown after both sections omit declarations", async () => {
  const { binary } = await writeAdbStub(
    shellStub({
      "dumpsys:window:windows": "no focus\\n",
      "dumpsys:window:displays": "no focus\\n",
    }),
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "inspect_adb_window",
    input: { serial: "emulator-5554" },
  });
  expect(result).toMatchObject({ focused_window: null, focused_app: null });
  const execution = await providerOver(binary).execute({
    operation: "inspect_adb_window",
    input: { serial: "emulator-5554" },
  });
  expect(execution.ok).toBe(true);
  if (!execution.ok) throw execution.error;
  expect(execution.value.limitations).toContainEqual(
    expect.stringContaining("focus is unknown"),
  );
});

it.each(["windows", "displays"])(
  "preserves explicitly absent focus from %s without another fallback",
  async (section) => {
    const declarations = "  mCurrentFocus=null\n  mFocusedApp=null\n";
    const { binary } = await writeAdbStub(
      shellStub({
        "dumpsys:window:windows":
          section === "windows" ? declarations : "no focus\n",
        ...(section === "displays"
          ? { "dumpsys:window:displays": declarations }
          : {}),
      }),
    );
    const execution = await providerOver(binary).execute({
      operation: "inspect_adb_window",
      input: { serial: "emulator-5554" },
    });
    expect(execution.ok).toBe(true);
    if (!execution.ok) throw execution.error;
    expect(execution.value.result).toMatchObject({
      focused_window: null,
      focused_app: null,
      observed_lines: ["  mCurrentFocus=null", "  mFocusedApp=null"],
    });
    expect(execution.value.limitations).toContain(
      `Focus declarations were read from \`dumpsys window ${section}\``,
    );
    expect(
      execution.value.limitations.some((line) =>
        line.includes("focus is unknown"),
      ),
    ).toBe(false);
  },
);

it("reads one settings value and reports device-side nulls", async () => {
  const { binary } = await writeAdbStub(shellStub({ "settings:get": "1\n" }));
  const enabled = await evidenceResult(providerOver(binary), {
    operation: "read_adb_setting",
    input: {
      serial: "emulator-5554",
      namespace: "secure",
      key: "adb_enabled",
    },
  });
  expect(enabled.value).toBe("1");
  const { binary: nullBinary } = await writeAdbStub(
    shellStub({ "settings:get": "null\n" }),
  );
  const absent = await evidenceResult(providerOver(nullBinary), {
    operation: "read_adb_setting",
    input: {
      serial: "emulator-5554",
      namespace: "global",
      key: "absent_key",
    },
  });
  expect(absent.value).toBeNull();
  expect(absent.device_reported_null).toBe(true);
});

it("resolves packages by case-insensitive substring", async () => {
  const { binary } = await writeAdbStub(
    shellStub({
      "pm:list":
        "package:/data/app/x/base.apk=com.whatsapp\npackage:/data/app/y/base.apk=com.whatsapp.w4b\npackage:/data/app/z/base.apk=com.example\n",
    }),
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "resolve_adb_packages",
    input: { serial: "emulator-5554", query: "WhatsApp" },
  });
  expect(result.matches).toEqual([
    {
      package_name: "com.whatsapp",
      base_apk_device_path: "/data/app/x/base.apk",
    },
    {
      package_name: "com.whatsapp.w4b",
      base_apk_device_path: "/data/app/y/base.apk",
    },
  ]);
  expect(result.exact_match).toBe(false);
  expect(result.unparsed_lines).toEqual([]);
  expect(result.coverage).toBe("complete");
});

it("installs a local APK and preserves the device's failure verdict", async () => {
  const { binary, root } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "install" ]; then printf 'Success\\n'; exit 0; fi
exit 1`,
  );
  const apk = join(root, "app.apk");
  await writeFile(apk, "apk");
  const digest = createHash("sha256").update("apk").digest("hex");
  const execution = await providerOver(binary).execute({
    operation: "install_adb_package",
    input: { serial: "emulator-5554", apk_path: apk, replace: false },
  });
  expect(execution.ok).toBe(true);
  if (!execution.ok) throw execution.error;
  expect(execution.value.result).toMatchObject({
    bytes: 3,
    sha256: digest,
    replace_requested: false,
    replaced: null,
  });
  expect(execution.value.limitations).toContain(
    "Whether an existing package was replaced is unknown; replace_requested records only the adb install mode",
  );

  const { binary: failing } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "install" ]; then printf 'Failure [INSTALL_FAILED_ALREADY_EXISTS]\\n'; exit 0; fi
exit 1`,
  );
  const projected = await refusedBy(providerOver(failing), {
    operation: "install_adb_package",
    input: {
      serial: "emulator-5554",
      apk_path: apk,
      replace: false,
    },
  });
  expect(projected).toMatchObject({ code: "unsupported_target" });
  expect(projected.message).toContain("INSTALL_FAILED_ALREADY_EXISTS");
});

it("installs the same private APK bytes that its reported digest identifies", async () => {
  const { binary, root } = await writeAdbStub(
    (stubRoot) => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "install" ]; then
  case "$4" in *.apk) ;; *) printf 'install input needs an APK suffix\\n' >&2; exit 1 ;; esac
  printf 'replacement-apk' > "${join(stubRoot, "app.apk")}"
  cat "$4" > "${join(stubRoot, "consumed-app.apk")}"
  printf 'Success\\n'
  exit 0
fi
exit 1`,
  );
  const apk = join(root, "app.apk");
  await writeFile(apk, "original-apk");
  const digest = createHash("sha256").update("original-apk").digest("hex");
  const installed = await evidenceResult(providerOver(binary), {
    operation: "install_adb_package",
    input: { serial: "emulator-5554", apk_path: apk, replace: false },
  });
  expect(await readFile(join(root, "consumed-app.apk"), "utf8")).toBe(
    "original-apk",
  );
  expect(await readFile(apk, "utf8")).toBe("replacement-apk");
  expect(installed).toMatchObject({
    apk_path: apk,
    bytes: 12,
    sha256: digest,
  });
});

it("uninstalls a package and reports the device's refusal for absent ones", async () => {
  const { binary } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$#" = 8 ] && [ "$1" = "-s" ] && [ "$3" = "shell" ] && [ "$4" = "pm" ] && [ "$5" = "uninstall" ] && [ "$6" = "--user" ] && [ "$7" = 0 ]; then printf 'Success\\n'; exit 0; fi
exit 1`,
  );
  const removed = await evidenceResult(providerOver(binary), {
    operation: "uninstall_adb_package",
    input: { serial: "emulator-5554", package: "com.example" },
  });
  expect(removed.package_name).toBe("com.example");

  const { binary: refusing } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$#" = 8 ] && [ "$1" = "-s" ] && [ "$3" = "shell" ] && [ "$4" = "pm" ] && [ "$5" = "uninstall" ] && [ "$6" = "--user" ] && [ "$7" = 0 ]; then printf 'Failure [not installed for 0]\\n'; exit 0; fi
exit 1`,
  );
  const projected = await refusedBy(providerOver(refusing), {
    operation: "uninstall_adb_package",
    input: { serial: "emulator-5554", package: "com.absent" },
  });
  expect(projected).toMatchObject({ code: "unsupported_target" });
  expect(projected.message).toContain("not installed for 0");
});

// adb exits 1 on a refused package change: `adb install` after printing the
// status line to stderr, `cmd package uninstall` after printing it to stdout.
it("preserves the device's install refusal when adb exits nonzero", async () => {
  const { binary, root } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "install" ]; then
  printf 'Performing Streamed Install\\n'
  printf 'adb: failed to install app.apk: Failure [INSTALL_FAILED_ALREADY_EXISTS: Attempt to re-install com.example without first uninstalling.]\\n' >&2
  exit 1
fi
exit 1`,
  );
  const apk = join(root, "app.apk");
  await writeFile(apk, "apk");
  const projected = await refusedBy(providerOver(binary), {
    operation: "install_adb_package",
    input: { serial: "emulator-5554", apk_path: apk, replace: false },
  });
  expect(projected).toMatchObject({
    code: "unsupported_target",
    details: {
      reason:
        "INSTALL_FAILED_ALREADY_EXISTS: Attempt to re-install com.example without first uninstalling.",
    },
  });
  expect(projected.message).toContain(
    "INSTALL_FAILED_ALREADY_EXISTS: Attempt to re-install com.example without first uninstalling.",
  );
});

it("preserves the device's uninstall refusal when adb exits nonzero", async () => {
  const { binary } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$#" = 8 ] && [ "$1" = "-s" ] && [ "$3" = "shell" ] && [ "$4" = "pm" ] && [ "$5" = "uninstall" ] && [ "$6" = "--user" ] && [ "$7" = 0 ]; then printf 'Failure [not installed for 0]\\n'; exit 1; fi
exit 1`,
  );
  const projected = await refusedBy(providerOver(binary), {
    operation: "uninstall_adb_package",
    input: { serial: "emulator-5554", package: "com.absent" },
  });
  expect(projected).toMatchObject({
    code: "unsupported_target",
    details: { reason: "not installed for 0" },
  });
  expect(projected.message).toContain("not installed for 0");
});

it("keeps a nonzero install without a device verdict as an unreadable result", async () => {
  const { binary, root } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "install" ]; then printf 'adb: failed to install app.apk: closed\\n' >&2; exit 1; fi
exit 1`,
  );
  const apk = join(root, "app.apk");
  await writeFile(apk, "apk");
  const projected = await refusedBy(providerOver(binary), {
    operation: "install_adb_package",
    input: { serial: "emulator-5554", apk_path: apk, replace: false },
  });
  expect(projected).toMatchObject({ code: "unreadable_output" });
});

it("starts an app through resolved launcher component and force-stops it", async () => {
  const { binary } = await writeAdbStub(
    shellStub({
      "cmd:package":
        "priority=0 preferredOrder=0 match=0x00108000 specificIndex=-1 isDefault=true\ncom.example/.Main",
      "am:start":
        "Starting: Intent { act=android.intent.action.MAIN cat=[android.intent.category.LAUNCHER] cmp=com.example/.Main }\n",
      "am:force-stop": "",
    }),
  );
  const provider = providerOver(binary);
  const started = await evidenceResult(provider, {
    operation: "start_adb_app",
    input: { serial: "emulator-5554", package: "com.example" },
  });
  expect(started).toMatchObject({
    package_name: "com.example",
    component: "com.example/.Main",
    started_activity: expect.stringContaining(
      "cmp=com.example/.Main",
    ) as unknown,
  });
  const stopped = await evidenceResult(provider, {
    operation: "stop_adb_app",
    input: { serial: "emulator-5554", package: "com.example" },
  });
  expect(stopped.package_name).toBe("com.example");
});

it("reports an app without a launcher activity as unsupported", async () => {
  const { binary } = await writeAdbStub(
    shellStub({ "cmd:package": "No activity found\n" }),
  );
  const projected = await refusedBy(providerOver(binary), {
    operation: "start_adb_app",
    input: { serial: "emulator-5554", package: "com.library.only" },
  });
  expect(projected).toMatchObject({ code: "unsupported_target" });
  expect(projected.message).toContain("No launcher activity");
});

it("starts an intent with typed extras as a fixed argv vector", async () => {
  const { binary, root } = await writeAdbStub(
    (root) => `printf '%s\\n' "$@" >> ${join(root, "argv.log")}
${shellStub({ "am:start": "Starting: Intent { act=android.intent.action.VIEW dat=https://example.com/ }\n" })(root)}`,
  );
  const started = await evidenceResult(providerOver(binary), {
    operation: "start_adb_activity",
    input: {
      serial: "emulator-5554",
      action: "android.intent.action.VIEW",
      data_uri: "https://example.com/",
      extras: [
        { key: "level", type: "int", value: "010" },
        { key: "negative", type: "int", value: "-010" },
        { key: "eight", type: "int", value: "08" },
        { key: "label", type: "string", value: "probe" },
      ],
    },
  });
  expect(started.action).toBe("android.intent.action.VIEW");
  expect(started.extras).toEqual([
    { key: "level", type: "int", value: "010" },
    { key: "negative", type: "int", value: "-010" },
    { key: "eight", type: "int", value: "08" },
    { key: "label", type: "string", value: "probe" },
  ]);
  const logged = (await readFile(join(root, "argv.log"), "utf8"))
    .trim()
    .split("\n");
  expect(logged).toEqual([
    "version",
    "-s",
    "emulator-5554",
    "shell",
    "am",
    "start",
    "-W",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    "https://example.com/",
    "--ei",
    "level",
    "10",
    "--ei",
    "negative",
    "-10",
    "--ei",
    "eight",
    "8",
    "--es",
    "label",
    "probe",
  ]);
});

it.each([
  { value: "10", operand: "10" },
  { value: "010", operand: "10" },
  { value: "-010", operand: "-10" },
  { value: "08", operand: "8" },
  { value: "000", operand: "0" },
])(
  "passes int extra $value to am as decimal $operand",
  async ({ value, operand }) => {
    const { binary, root } = await writeAdbStub(
      (root) => `printf '%s\\n' "$@" >> ${join(root, "argv.log")}
${shellStub({ "am:start": "Starting: Intent { act=android.intent.action.VIEW }\n" })(root)}`,
    );
    await evidenceResult(providerOver(binary), {
      operation: "start_adb_activity",
      input: {
        serial: "emulator-5554",
        action: "android.intent.action.VIEW",
        extras: [
          { key: "count", type: "int", value },
          // `--el` is read with Long.valueOf, which is always decimal.
          { key: "total", type: "long", value },
        ],
      },
    });
    const logged = (await readFile(join(root, "argv.log"), "utf8"))
      .trim()
      .split("\n");
    // am reads `--ei` with Integer.decode, where a leading zero means octal.
    expect(logged.slice(-6)).toEqual([
      "--ei",
      "count",
      operand,
      "--el",
      "total",
      value,
    ]);
  },
);

it("collects a device bugreport archive with its digest", async () => {
  const { binary, root } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "bugreport" ]; then
  printf 'bugreport-bytes' > "$4/bugreport test.zip"
  printf 'Bug report copied to %s/bugreport test.zip\\n' "$4"
  exit 0
fi
exit 1`,
  );
  const result = await evidenceResult(providerOver(binary), {
    operation: "collect_adb_bugreport",
    input: { serial: "emulator-5554", output_directory: root },
  });
  const digest = createHash("sha256").update("bugreport-bytes").digest("hex");
  expect(result).toMatchObject({
    local_path: join(root, "bugreport test.zip"),
    bytes: 15,
    sha256: digest,
    adb_reported_path: expect.stringContaining(".rea-bugreport-"),
  });
});

it("quotes caller text before adb joins the remote shell command", async () => {
  const { binary, root } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
shift 3
# Model adb's remote command joining, then execute the resulting shell string.
sh -c "$*"
`,
  );
  const value = join(root, `device 'quoted'; touch ${join(root, "injected")}`);
  await mkdir(value, { recursive: true });
  const result = await evidenceResult(providerOver(binary), {
    operation: "list_adb_directory",
    input: { serial: "device", device_path: value },
  });
  expect(result).toMatchObject({
    device_path: value,
    entries: [],
    coverage: "complete",
  });
  await expect(readFile(join(root, "injected"))).rejects.toThrow();
});

it("preserves a screen output created while capture is running", async () => {
  const { binary, root } = await writeAdbStub(
    (root) => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
printf 'existing evidence' > "${join(root, "captures", "screen.png")}"
printf '\\211PNG\\r\\n\\032\\n\\0\\0\\0\\rIHDR\\0\\0\\0\\004\\0\\0\\0\\003'
`,
  );
  const result = await providerOver(binary).execute({
    operation: "capture_adb_screen",
    input: { serial: "device", output_directory: join(root, "captures") },
  });
  expect(result.ok).toBe(false);
  expect(await readFile(join(root, "captures", "screen.png"), "utf8")).toBe(
    "existing evidence",
  );
});

it("reports cancellation arriving during the version probe", async () => {
  const { binary } = await writeAdbStub(() => "exec sleep 30");
  const controller = new AbortController();
  const pending = providerOver(binary).execute(
    { operation: "inspect_adb_client", input: {} },
    { signal: controller.signal },
  );
  const timer = setTimeout(() => controller.abort(), 50);
  try {
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(projectAnalysisError(result.error).code).toBe("cancelled");
  } finally {
    clearTimeout(timer);
  }
});

it("preserves the typed offline failure and failed paths when every package pull fails", async () => {
  const { binary, root } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$3" = "shell" ]; then printf 'package:/data/app/base.apk\\n'; exit 0; fi
if [ "$3" = "pull" ]; then printf 'error: device offline\\n' >&2; exit 1; fi
exit 1`,
  );
  const result = await providerOver(binary).execute({
    operation: "pull_adb_package",
    input: {
      serial: "emulator-5554",
      package: "com.example",
      output_directory: join(root, "pulls"),
    },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "unsupported_target",
    details: { reason: "error: device offline" },
  });
  expect(result.error.partialObservation).toMatchObject({
    result: {
      artifacts: [],
      failures: [{ device_path: "/data/app/base.apk", stage: "pull" }],
      coverage: "partial",
    },
  });
});

it("retains a completed push when checksum capture exceeds its budget", async () => {
  const { binary, root } = await writeAdbStub(
    () => `if [ "$1" = "version" ]; then ${VERSION_BLOCK}; exit 0; fi
if [ "$3" = "push" ]; then exit 0; fi
if [ "$4" = "sha256sum" ]; then head -c 2048 /dev/zero | tr '\\000' a; exit 0; fi
exit 1`,
  );
  const local = join(root, "payload.bin");
  await writeFile(local, "payload");
  const result = await providerOver(binary).execute({
    operation: "push_adb_file",
    input: {
      serial: "emulator-5554",
      local_path: local,
      device_path: "/data/local/tmp/payload.bin",
      overwrite: true,
    },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "resource_constraint",
    details: { operation: "push_adb_file" },
  });
  expect(result.error.partialObservation).toBeDefined();
});

it("attributes version capture failures to the public operation and retains the prerequisite", async () => {
  const { binary } = await writeAdbStub(
    () => "head -c 70000 /dev/zero | tr '\\000' a",
  );
  const result = await providerOver(binary).execute({
    operation: "list_adb_devices",
    input: {},
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "resource_constraint",
    details: {
      operation: "list_adb_devices",
      diagnostics: { prerequisite_operation: "inspect_adb_client" },
    },
  });
});

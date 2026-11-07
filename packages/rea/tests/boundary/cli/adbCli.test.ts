import { chmod, lstat, readFile, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { basename, dirname, join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { adbResultSchemas } from "../../../src/domain/adb/adbDeviceAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  execFileOutput,
  execFileOutputFailure,
} from "../../../src/process/ExecFileOutput.js";
import {
  expectConfigurationRefusal,
  serveCli as serve,
} from "./cliServeHarness.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

it
  .skipIf(process.platform === "win32")
  .each([
    "zero width",
    "zero height",
    "invalid chunk type",
    "invalid checksum",
    "truncated header",
    "valid",
  ] as const)(
  "validates the screencap PNG header before publishing: %s",
  async (kind) => {
    const workspace = await createTestWorkspace("rea-adb-screen-cli-");
    onTestFinished(() => removeTestWorkspace(workspace.root));
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64",
    );
    if (kind === "zero width") png.writeUInt32BE(0, 16);
    if (kind === "zero height") png.writeUInt32BE(0, 20);
    if (kind === "invalid chunk type") png[12] = 0xc9;
    if (kind !== "invalid checksum")
      png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
    else png[29] = png[29]! ^ 0xff;
    const frame = kind === "truncated header" ? png.subarray(0, 24) : png;
    await writeFile(workspace.path("frame.png"), frame);
    const adb = await workspace.write(
      "adb",
      `#!/bin/sh
if [ "$1" = version ]; then printf 'Android Debug Bridge version 1.0.41\\nVersion 34.0.5-cli\\n'; exit 0; fi
if [ "$1" = -s ] && [ "$3" = exec-out ]; then /bin/cat "$(dirname "$0")/frame.png"; exit 0; fi
exit 1
`,
    );
    await chmod(adb, 0o755);
    const outputPath = workspace.path("captures");
    const result = await execFileOutput(
      process.execPath,
      [
        "scripts/rea.mjs",
        "capture-adb-screen",
        "device",
        "--output-directory",
        outputPath,
        "--json",
      ],
      {
        env: { ...process.env, REA_ADB_PATH: adb },
        timeout: 20_000,
        stopSignal: "SIGTERM",
        maxBuffer: 1024 * 1024,
      },
    ).then(
      (output) => ({ exitCode: 0, stdout: output.stdout }),
      (cause: unknown) => {
        const failure = execFileOutputFailure(cause);
        if (failure === undefined) throw cause;
        return { exitCode: failure.code, stdout: failure.stdout };
      },
    );
    if (kind === "valid") {
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout) as {
        normalized_result: unknown;
        limitations: string[];
      };
      expect(
        adbResultSchemas.capture_adb_screen.parse(output.normalized_result),
      ).toMatchObject({ width: 1, height: 1 });
      expect(output.limitations).toContain(
        "PNG signature, IHDR framing, checksum, and dimensions are validated; encoding and image contents are not validated",
      );
      expect(
        (await readFile(join(outputPath, "screen.png"))).equals(frame),
      ).toBe(true);
    } else {
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        code: "unreadable_output",
      });
      await expect(
        readFile(join(outputPath, "screen.png")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
  },
);

it.skipIf(process.platform === "win32").each([
  { exit: 1, stdout: "", stderr: "adb: error: closed", overwrite: false },
  { exit: 1, stdout: "", stderr: "adb: error: closed", overwrite: true },
  { exit: 1, stdout: "unexpected probe output", stderr: "", overwrite: false },
  { exit: 2, stdout: "", stderr: "", overwrite: false },
])("refuses an ambiguous destination probe before push: %j", async (probe) => {
  const workspace = await createTestWorkspace("rea-adb-probe-cli-");
  onTestFinished(() => removeTestWorkspace(workspace.root));
  const source = await workspace.write("payload.bin", "replacement");
  await workspace.write("device-file", "original");
  const adb = await workspace.write(
    "adb",
    `#!/bin/sh
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '%s\\n' "$3" >> "$root/calls"
if [ "$1" = version ]; then
  printf 'Android Debug Bridge version 1.0.41\\nVersion 34.0.5-cli\\nInstalled as %s\\n' "$0"
  exit 0
fi
if [ "$3" = shell ] && [ "$4" = test ]; then
  printf '%s' '${probe.stdout}'
  printf '%s' '${probe.stderr}' >&2
  exit ${String(probe.exit)}
fi
if [ "$3" = push ]; then cp "$4" "$root/device-file"; exit 0; fi
exit 1
`,
  );
  await chmod(adb, 0o755);
  const result = await execFileOutput(
    process.execPath,
    [
      "scripts/rea.mjs",
      "push-adb-file",
      "device",
      source,
      "/data/local/tmp/payload.bin",
      ...(probe.overwrite ? ["--overwrite"] : []),
      "--json",
    ],
    {
      env: { ...process.env, REA_ADB_PATH: adb },
      timeout: 20_000,
      stopSignal: "SIGTERM",
      maxBuffer: 1024 * 1024,
    },
  ).then(
    (output) => ({ exitCode: 0, stdout: output.stdout }),
    (cause: unknown) => {
      const failure = execFileOutputFailure(cause);
      if (failure === undefined) throw cause;
      return { exitCode: failure.code, stdout: failure.stdout };
    },
  );
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    code: "unreadable_output",
  });
  if (probe.stderr !== "") expect(result.stdout).toContain(probe.stderr);
  expect(await readFile(workspace.path("device-file"), "utf8")).toBe(
    "original",
  );
  expect(await readFile(workspace.path("calls"), "utf8")).toBe("\nshell\n");
});

it.skipIf(process.platform === "win32")(
  "reports the file placed inside a push destination directory and preserves executable staging",
  async () => {
    const workspace = await createTestWorkspace("rea-adb-directory-push-cli-");
    onTestFinished(() => removeTestWorkspace(workspace.root));
    const source = await workspace.write("payload.bin", "#!/bin/sh\n");
    await chmod(source, 0o755);
    const digest = createHash("sha256").update("#!/bin/sh\n").digest("hex");
    const adb = await workspace.write(
      "adb",
      `#!/bin/sh
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$1" = version ]; then printf 'Android Debug Bridge version 1.0.41\\nVersion 34.0.5-cli\\n'; exit 0; fi
if [ "$1" = -s ] && [ "$3" = shell ] && [ "$4" = test ]; then
  if [ "$5" = -d ] && [ "$6" = /data/local/tmp/drop/ ]; then exit 0; fi
  if [ "$5" = -e ]; then exit 1; fi
fi
if [ "$1" = -s ] && [ "$3" = push ]; then ls -ld "$4" | cut -c1-10 > "$root/staged-mode"; printf '%s' "$5" > "$root/push-target"; exit 0; fi
if [ "$1" = -s ] && [ "$4" = sha256sum ]; then printf '%s  %s\\n' '${digest}' "$5"; exit 0; fi
exit 1
`,
    );
    await chmod(adb, 0o755);
    const output = await serve(
      ["push-adb-file", "device", source, "/data/local/tmp/drop/", "--json"],
      { REA_ADB_PATH: adb },
    );
    expect(output.exitCode).toBe(0);
    const evidence = JSON.parse(output.stdout) as {
      parameters: { device_path: string };
      normalized_result: { device_path: string };
    };
    expect(evidence.parameters.device_path).toBe("/data/local/tmp/drop/");
    expect(evidence.normalized_result.device_path).toBe(
      "/data/local/tmp/drop/payload.bin",
    );
    expect(await readFile(workspace.path("staged-mode"), "utf8")).toBe(
      "-r-x--x--x\n",
    );
    expect(await readFile(workspace.path("push-target"), "utf8")).toBe(
      "/data/local/tmp/drop/",
    );
  },
);

it.each([
  [
    ["inspect-adb-client", "--json"],
    "/nonexistent/adb",
    "The selected adb binary was not found: /nonexistent/adb. Set REA_ADB_PATH",
  ],
  [
    ["list-adb-devices", "--json"],
    "/nonexistent/adb",
    "The selected adb binary was not found: /nonexistent/adb. Set REA_ADB_PATH",
  ],
  [
    ["list-adb-devices", "--json"],
    "relative/adb",
    "REA_ADB_PATH must be an absolute path to the adb binary.",
  ],
])(
  "%j with REA_ADB_PATH=%s names the host requirement",
  async (argv, binary, reason) => {
    const result = await serve(argv, { REA_ADB_PATH: binary });
    expectConfigurationRefusal(result, reason);
  },
);

it("validates device serials before contacting any device", async () => {
  const result = await serve(["inspect-adb-device", "bad serial", "--json"]);
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    code: "VALIDATION_ERROR",
  });
});

it("retains safe structured constraints for ADB selectors", async () => {
  const cases = [
    {
      argv: ["inspect-adb-device", "bad serial"],
      path: "serial",
      expected: "regex",
    },
    {
      argv: ["inspect-adb-device", "S".repeat(257)],
      path: "serial",
      maximum: 256,
    },
    {
      argv: ["inspect-adb-package", "S", "bad package"],
      path: "package",
      expected: "regex",
    },
    {
      argv: ["inspect-adb-package", "S", "a".repeat(257)],
      path: "package",
      maximum: 256,
    },
    {
      argv: ["start-adb-activity", "S", "bad action"],
      path: "action",
      expected: "regex",
    },
    {
      argv: ["start-adb-activity", "S", "a".repeat(257)],
      path: "action",
      maximum: 256,
    },
    {
      argv: ["start-adb-activity", "S", "x", "--component", "bad component"],
      path: "component",
      expected: "regex",
    },
    {
      argv: ["start-adb-activity", "S", "x", "--component", "a".repeat(513)],
      path: "component",
      maximum: 512,
    },
    {
      argv: ["start-adb-activity", "S", "x", "--data-uri", "bad uri"],
      path: "data-uri",
      expected: "regex",
    },
    {
      argv: ["start-adb-activity", "S", "x", "--data-uri", "a".repeat(2049)],
      path: "data-uri",
      maximum: 2048,
    },
  ];
  for (const { argv, path, expected, maximum } of cases) {
    const result = await serve([...argv, "--json"], {
      REA_ADB_PATH: "/path/that/does/not/exist",
    });
    expect(result.exitCode, path).toBe(1);
    expect(JSON.parse(result.stdout), path).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: [
        expect.objectContaining({
          path,
          ...(expected === undefined ? { maximum } : { expected }),
        }),
      ],
    });
    expect(result.stdout).not.toContain(argv.at(-1));
  }
  const both = await serve(
    ["start-adb-activity", "bad serial", "bad action", "--json"],
    { REA_ADB_PATH: "/path/that/does/not/exist" },
  );
  expect(both.exitCode).toBe(1);
  expect(JSON.parse(both.stdout)).toMatchObject({
    code: "VALIDATION_ERROR",
    fieldErrors: expect.arrayContaining([
      expect.objectContaining({ path: "serial", expected: "regex" }),
      expect.objectContaining({ path: "action", expected: "regex" }),
    ]),
  });
  expect(both.stdout).not.toContain("bad serial");
  expect(both.stdout).not.toContain("bad action");
});

it.each(["string:key", ":", "string"])(
  "classifies malformed activity extra %j before contacting adb",
  async (extra) => {
    const result = await serve(
      [
        "start-adb-activity",
        "emulator-5554",
        "android.intent.action.VIEW",
        "--extra",
        extra,
        "--format",
        "json",
      ],
      { REA_ADB_PATH: "/path/that/does/not/exist" },
    );

    const error = JSON.parse(result.stdout);
    expect(error).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      retryable: false,
      remediation: { action: expect.any(String) },
    });
    expect(error.remediation.action).not.toBe("");
    expect(error.message).not.toBe("");
  },
);

it.each([16, 17])(
  "enforces the activity extra count before host admission: %d entries",
  async (count) => {
    const root = await createTestTempDirectory("rea-adb-extra-limit-");
    const missingAdb = join(root, "missing-adb");
    const extras = Array.from({ length: count }, (_, index) => [
      "--extra",
      `string:key${index}:value${index}`,
    ]).flat();
    const result = await execFileOutput(
      process.execPath,
      [
        "scripts/rea.mjs",
        "start-adb-activity",
        "emulator-5554",
        "android.intent.action.VIEW",
        ...extras,
        "--json",
      ],
      {
        env: { ...process.env, REA_ADB_PATH: missingAdb },
        timeout: 20_000,
        stopSignal: "SIGTERM",
        maxBuffer: 1024 * 1024,
      },
    ).then(
      (output) => ({ exitCode: 0, stdout: output.stdout }),
      (cause: unknown) => {
        const failure = execFileOutputFailure(cause);
        if (failure === undefined || typeof failure.code !== "number")
          throw cause;
        return { exitCode: failure.code, stdout: failure.stdout };
      },
    );
    if (count === 16) {
      expectConfigurationRefusal(
        result,
        `The selected adb binary was not found: ${missingAdb}. Set REA_ADB_PATH`,
      );
    } else {
      expect(JSON.parse(result.stdout)).toMatchObject({
        code: "VALIDATION_ERROR",
        fieldErrors: [{ code: "too_big", path: "extra" }],
      });
    }
    expect(result.exitCode, result.stdout).toBe(1);
  },
);

it.skipIf(process.platform === "win32")(
  "starts an explicitly selected nested Android activity through the CLI",
  async () => {
    const workspace = await createTestWorkspace("rea-adb-nested-activity-cli-");
    onTestFinished(() => removeTestWorkspace(workspace.root));
    const adb = await workspace.write(
      "adb",
      `#!/bin/sh
if [ "$1" = version ]; then
  printf 'Android Debug Bridge version 1.0.41\\nVersion 34.0.5-cli\\n'
  exit 0
fi
if [ "$1" = -s ] && [ "$3" = shell ]; then
  printf '%s\\n' 'Starting: Intent { act=android.intent.action.MAIN cmp=com.example/.Outer$InnerActivity }' 'Status: ok' 'Activity: com.example/.Outer$InnerActivity' 'Complete'
  exit 0
fi
exit 1
`,
    );
    await chmod(adb, 0o755);

    const result = await serve(
      [
        "start-adb-activity",
        "emulator-5554",
        "android.intent.action.MAIN",
        "--component",
        "com.example/.Outer$InnerActivity",
        "--format",
        "json",
        "--full-output",
      ],
      { REA_ADB_PATH: adb },
    );
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.ok).toBe(true);
    expect(
      toolContract("start_adb_activity").outputSchema.parse(output.data)
        .normalized_result,
    ).toMatchObject({
      component: "com.example/.Outer$InnerActivity",
      started_activity:
        "act=android.intent.action.MAIN cmp=com.example/.Outer$InnerActivity",
    });
  },
);

it.each([
  ["bogus:key:value", "invalid_request"],
  ["string:key:value", "capability_unavailable"],
  ["string:key:", "capability_unavailable"],
  ["int:key:", "invalid_request"],
  ["boolean:key:yes", "invalid_request"],
  ["int:key:1.5", "invalid_request"],
  ["long:key:1.5", "invalid_request"],
  ["float:key:garbage", "invalid_request"],
  ["float:key:1e-3", "capability_unavailable"],
  ["float:key:1E-3", "capability_unavailable"],
  ["float:key:.5", "capability_unavailable"],
  ["float:key:1.", "capability_unavailable"],
  ["boolean:key:false", "capability_unavailable"],
  ["int:key:-3", "capability_unavailable"],
  ["long:key:9007199254740993", "capability_unavailable"],
  ["float:key:-1.25", "capability_unavailable"],
] as const)(
  "preserves downstream validation for well-delimited activity extra %j",
  async (extra, code) => {
    const result = await serve(
      [
        "start-adb-activity",
        "emulator-5554",
        "android.intent.action.VIEW",
        "--extra",
        extra,
        "--format",
        "json",
      ],
      { REA_ADB_PATH: "/path/that/does/not/exist" },
    );

    expect(JSON.parse(result.stdout)).toMatchObject({ code });
  },
);

it.skipIf(process.platform === "win32")(
  "preserves requested reinstall mode without claiming prior package state",
  async () => {
    const workspace = await createTestWorkspace("rea-adb-install-state-");
    onTestFinished(() => removeTestWorkspace(workspace.root));
    const apk = await workspace.write("app with spaces.apk", "apk");
    const adb = await workspace.write(
      "adb",
      `#!/bin/sh
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '%s\\n' "$*" >> "$root/calls"
if [ "$1" = version ]; then
  printf 'Android Debug Bridge version 1.0.41\\nVersion 34.0.5-cli\\nInstalled as %s\\n' "$0"
  exit 0
fi
if [ "$1" = -s ] && [ "$3" = install ]; then
  if [ "$4" = -r ]; then selected="$5"; else selected="$4"; fi
  cmp "$selected" "$root/app with spaces.apk" || exit 1
  printf '%s\\n' "$selected" >> "$root/snapshots"
  if [ -f "$root/installed" ]; then
    if [ "$4" != -r ]; then
      printf 'Failure [INSTALL_FAILED_ALREADY_EXISTS]\\n'
      exit 0
    fi
    printf 'replacement\\n' >> "$root/events"
  else
    printf 'fresh-install\\n' >> "$root/events"
  fi
  : > "$root/installed"
  printf 'Performing Streamed Install\\nSuccess\\n'
  exit 0
fi
exit 1
`,
    );
    await chmod(adb, 0o755);

    const installEnvelope = z.object({
      ok: z.literal(true),
      data: toolContract("install_adb_package").outputSchema,
    });
    const install = async (replace: boolean) => {
      const result = await serve(
        [
          "install-adb-package",
          "emulator-5554",
          apk,
          ...(replace ? ["--replace"] : []),
          "--format",
          "json",
          "--full-output",
        ],
        { REA_ADB_PATH: adb },
      );
      expect(result.exitCode).toBe(0);
      return installEnvelope.parse(JSON.parse(result.stdout));
    };

    const freshReplace = await install(true);
    expect(freshReplace).toMatchObject({
      ok: true,
      data: {
        parameters: { replace: true },
        normalized_result: { replace_requested: true, replaced: null },
        confidence: "observed",
      },
    });
    expect(freshReplace.data.limitations.join("\n")).toContain(
      "Whether an existing package was replaced is unknown",
    );

    const existingReplace = await install(true);
    expect(existingReplace).toMatchObject({
      ok: true,
      data: {
        parameters: { replace: true },
        normalized_result: { replace_requested: true, replaced: null },
      },
    });

    await unlink(workspace.path("installed"));
    const freshDefault = await install(false);
    expect(freshDefault).toMatchObject({
      ok: true,
      data: {
        parameters: { replace: false },
        normalized_result: { replace_requested: false, replaced: null },
      },
    });
    expect(await readFile(workspace.path("events"), "utf8")).toBe(
      "fresh-install\nreplacement\nfresh-install\n",
    );
    const snapshots = (await readFile(workspace.path("snapshots"), "utf8"))
      .trim()
      .split("\n");
    expect(snapshots).toHaveLength(3);
    expect(new Set(snapshots).size).toBe(3);
    for (const snapshot of snapshots) {
      expect(snapshot).not.toBe(apk);
      expect(basename(snapshot)).toBe(basename(apk));
      await expect(lstat(dirname(snapshot))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
    expect(await readFile(apk, "utf8")).toBe("apk");
    for (const receipt of [freshReplace, existingReplace, freshDefault])
      expect(receipt.data.normalized_result).toMatchObject({
        apk_path: apk,
        bytes: 3,
        sha256: createHash("sha256").update("apk").digest("hex"),
      });
    const calls = await readFile(workspace.path("calls"), "utf8");
    expect(calls.split("\n").filter((line) => line !== "")).toEqual([
      "version",
      `-s emulator-5554 install -r ${snapshots[0]}`,
      "version",
      `-s emulator-5554 install -r ${snapshots[1]}`,
      "version",
      `-s emulator-5554 install ${snapshots[2]}`,
    ]);
  },
);

it("requires the output directory option on pull", async () => {
  const result = await serve([
    "pull-adb-package",
    "emulator-5554",
    "com.example",
    "--json",
  ]);
  expect(result.exitCode).not.toBe(0);
});

it.skipIf(process.platform === "win32")(
  "refuses a trailing device separator through the CLI before adb or output effects",
  async () => {
    const workspace = await createTestWorkspace("rea-adb-cli-pull-");
    onTestFinished(() => removeTestWorkspace(workspace.root));
    const adb = await workspace.write(
      "adb",
      `#!/bin/sh
if [ "$1" = "version" ]; then
  printf 'Android Debug Bridge version 1.0.41\\nVersion 34.0.5-cli\\nInstalled as %s\\n' "$0"
  exit 0
fi
: > '${workspace.path("invoked")}'
exit 0
`,
    );
    await chmod(adb, 0o755);
    const output = workspace.path("pulls");
    const result = await serve(
      [
        "pull-adb-file",
        "emulator-5554",
        "/data/local/tmp/",
        "--output-directory",
        output,
        "--json",
      ],
      { REA_ADB_PATH: adb },
    );
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: "invalid_request",
    });
    await expect(readFile(workspace.path("invoked"))).rejects.toThrow();
    await expect(lstat(output)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

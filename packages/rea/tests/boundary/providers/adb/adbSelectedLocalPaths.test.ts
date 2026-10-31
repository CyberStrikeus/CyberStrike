import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, onTestFinished, test, vi } from "vitest";

import { AdbProvider } from "../../../../src/adb/AdbProvider.js";
import { AdbDeviceAnalysisService } from "../../../../src/application/adb/AdbDeviceAnalysisService.js";
import { PrivateRuntimeRoot } from "../../../../src/process/PrivateRuntimeRoot.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

const it = test.skipIf(process.platform === "win32");
const sourceBytes = "selected native bytes";
const pulledBytes = "pulled fixture";
const bugreportBytes = "bugreport fixture";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);
const digest = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

it.each(["path", "explicit"] as const)(
  "uses the captured %s launcher environment for both ADB probing and device queries",
  async (source) => {
    const root = await createTestTempDirectory("rea-adb-selected-environment-");
    const selectedDirectory = join(root, "selected");
    const ambientDirectory = join(root, "ambient");
    const sourceCode = `#!/bin/sh
printf '%s|%s|%s|%s\\n' "$1" "$ADB_SERVER_SOCKET" "$CALLER_EMPTY" "\${CALLER_ABSENT-unset}" >> "$0.calls"
if [ "$1" = version ]; then
  printf 'Android Debug Bridge version 1.0.41\\nVersion 35.0.1-fixture\\nInstalled as %s\\n' "$0"
elif [ "$1" = devices ]; then
  printf 'List of devices attached\\n%s device model:fixture transport_id:1\\n' "$ANDROID_SERIAL"
else exit 1; fi
`;
    for (const directory of [selectedDirectory, ambientDirectory]) {
      await mkdir(directory);
      await writeFile(join(directory, "adb"), sourceCode, { mode: 0o755 });
    }
    const selected: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: selectedDirectory,
      ADB_SERVER_SOCKET: "tcp:localhost:5041",
      ANDROID_SERIAL: "selected-device",
      CALLER_EMPTY: "",
      ...(source === "explicit"
        ? { REA_ADB_PATH: join(selectedDirectory, "adb") }
        : {}),
    };
    delete selected.CALLER_ABSENT;
    if (source === "path") delete selected.REA_ADB_PATH;
    const provider = new AdbProvider({ environment: selected });
    onTestFinished(async () => {
      try {
        await provider.close();
      } finally {
        vi.unstubAllEnvs();
      }
    });
    selected.ADB_SERVER_SOCKET = "tcp:localhost:5042";
    selected.ANDROID_SERIAL = "later-selected-device";
    vi.stubEnv("PATH", ambientDirectory);
    vi.stubEnv("ADB_SERVER_SOCKET", "tcp:localhost:5043");
    vi.stubEnv("ANDROID_SERIAL", "ambient-device");
    vi.stubEnv("CALLER_EMPTY", "ambient-value");
    vi.stubEnv("CALLER_ABSENT", "ambient-only");
    const service = new AdbDeviceAnalysisService(provider);
    const result = await service.execute("list_adb_devices", {});
    if (!result.ok) throw result.error;
    expect(result.value.normalized_result).toMatchObject({
      devices: [{ serial: "selected-device" }],
    });
    expect(JSON.stringify(result.value)).not.toContain("tcp:localhost:");
    expect(await readFile(join(selectedDirectory, "adb.calls"), "utf8")).toBe(
      "version|tcp:localhost:5041||unset\ndevices|tcp:localhost:5041||unset\n",
    );
    await expect(
      access(join(ambientDirectory, "adb.calls")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

// All ADB commands run a selected local script. No device, server or real adb
// executable participates; file snapshots, publication and Evidence are real.
const fixture = async () => {
  const root = await createTestTempDirectory("rea-adb-selected-path-");
  const physical = join(root, "physical");
  await mkdir(join(physical, "nested"), { recursive: true });
  await symlink(join(physical, "nested"), join(root, "alias"));
  const binary = join(root, "adb");
  await writeFile(join(root, "screen-fixture.png"), png);
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(
    binary,
    `#!/bin/sh
if [ "$1" = version ]; then printf 'Android Debug Bridge version 1.0.41\\nVersion 34.0.5-stub\\nInstalled as %s\\n' "$0"; exit 0; fi
if [ "$3" = shell ] && [ "$4" = pm ] && [ "$5" = path ]; then printf 'package:/data/app/fixture/base.apk\\n'; exit 0; fi
if [ "$3" = shell ]; then exit 1; fi
if [ "$3" = push ] || [ "$3" = install ]; then
  printf '%s' "$4" > ${quote(join(root, "snapshot-path"))}
  /bin/cat "$4" > ${quote(join(root, "consumed"))}
  printf 'Success\\n'; exit 0
fi
if [ "$3" = pull ]; then printf '${pulledBytes}' > "$5"; exit 0; fi
if [ "$3" = exec-out ]; then /bin/cat ${quote(join(root, "screen-fixture.png"))}; exit 0; fi
if [ "$3" = bugreport ]; then
  printf '${bugreportBytes}' > "$4/bugreport.zip"
  printf 'Bug report copied to %s/bugreport.zip\\n' "$4"; exit 0
fi
exit 1
`,
    { mode: 0o755 },
  );
  const runtimePaths: string[] = [];
  const provider = new AdbProvider({
    environment: { REA_ADB_PATH: binary },
    createRuntimeRoot: async (options) => {
      const runtime = await PrivateRuntimeRoot.create(options);
      runtimePaths.push(runtime.path);
      return runtime;
    },
  });
  onTestFinished(() => provider.close());
  return {
    root,
    physical,
    runtimePaths,
    service: new AdbDeviceAnalysisService(provider),
  };
};

it.each(["push_adb_file", "install_adb_package"] as const)(
  "preserves native symlink traversal in %s snapshots and Evidence",
  async (operation) => {
    const f = await fixture();
    await writeFile(join(f.physical, "payload.apk"), sourceBytes);
    await writeFile(join(f.root, "payload.apk"), "wrong lexical bytes");
    const selected = `${f.root}/alias/../payload.apk`;
    const result = await f.service.execute(
      operation,
      operation === "push_adb_file"
        ? {
            serial: "fixture",
            local_path: selected,
            device_path: "/data/local/tmp/payload.apk",
            overwrite: false,
          }
        : { serial: "fixture", apk_path: selected, replace: false },
    );
    if (!result.ok) throw result.error;
    expect(await readFile(join(f.root, "consumed"), "utf8")).toBe(sourceBytes);
    const field = operation === "push_adb_file" ? "local_path" : "apk_path";
    expect(result.value.parameters).toMatchObject({ [field]: selected });
    expect(result.value.normalized_result).toMatchObject({
      [field]: selected,
      bytes: Buffer.byteLength(sourceBytes),
      sha256: digest(sourceBytes),
    });
    const snapshot = await readFile(join(f.root, "snapshot-path"), "utf8");
    expect(snapshot).not.toBe(selected);
    await expect(access(dirname(snapshot))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.each([
  "pull_adb_file",
  "pull_adb_package",
  "capture_adb_screen",
  "collect_adb_bugreport",
] as const)(
  "publishes %s through the selected output traversal and cleans owned staging",
  async (operation) => {
    const f = await fixture();
    const selected = `${f.root}/alias/../out`;
    const input = {
      serial: "fixture",
      output_directory: selected,
      ...(operation === "pull_adb_file"
        ? { device_path: "/data/local/tmp/pulled.bin" }
        : {}),
      ...(operation === "pull_adb_package"
        ? { package: "com.example.fixture" }
        : {}),
    };
    const result = await f.service.execute(operation, input);
    if (!result.ok) throw result.error;
    expect(result.value.parameters).toMatchObject({
      output_directory: selected,
    });
    const relative =
      operation === "pull_adb_package"
        ? "com.example.fixture/base.apk"
        : operation === "pull_adb_file"
          ? "pulled.bin"
          : operation === "capture_adb_screen"
            ? "screen.png"
            : "bugreport.zip";
    const expectedBytes =
      operation === "capture_adb_screen"
        ? png
        : Buffer.from(
            operation === "collect_adb_bugreport"
              ? bugreportBytes
              : pulledBytes,
          );
    expect(
      (await readFile(join(f.physical, "out", relative))).equals(expectedBytes),
    ).toBe(true);
    const file = {
      local_path: `${selected}/${relative}`,
      bytes: expectedBytes.byteLength,
      sha256: digest(expectedBytes),
    };
    expect(result.value.normalized_result).toMatchObject(
      operation === "pull_adb_package"
        ? {
            output_directory: selected,
            artifacts: [file],
            coverage: "complete",
          }
        : file,
    );
    await expect(access(join(f.root, "out"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      (await readdir(join(f.physical, "out"))).filter((name) =>
        name.startsWith(".rea-"),
      ),
    ).toEqual([]);
    for (const path of f.runtimePaths) {
      if (operation === "capture_adb_screen")
        expect(dirname(path)).toBe(join(f.physical, "out"));
      await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
    }
  },
);

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.skipIf(process.platform === "win32")(
  "keeps device, remote file and host file refusals distinct through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-adb-error-identity-");
    const binary = join(root, "adb");
    const source = join(root, "source.bin");
    await writeFile(source, "caller bytes");
    await writeFile(
      binary,
      `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === 'version') {
  console.log('Android Debug Bridge version 1.0.41\\nVersion 34.0.5-fixture\\nInstalled as ' + process.argv[1]);
  process.exit(0);
}
if (args[0] !== '-s' || args[1] !== 'device') process.exit(91);
if (args[2] === 'shell') console.error('adb: error: connect failed: device offline');
else if (args[2] === 'pull' && args[3] === '/sdcard/host.bin')
  console.error("adb: error: cannot write '" + args[4] + "': Permission denied");
else if (args[2] === 'pull')
  console.error("adb: error: failed to stat remote object '" + args[3] + "': No such file or directory");
else process.exit(91);
process.exit(1);
`,
      { mode: 0o700 },
    );
    const environment = {
      HOME: root,
      USERPROFILE: root,
      REA_ADB_PATH: binary,
      REA_LOG_LEVEL: "silent",
    };
    const { client, call } = await connectLocalToolsMcp(environment);
    for (const scenario of [
      {
        file: "missing.bin",
        operation: "pull_adb_file",
        path: "/sdcard/missing.bin",
      },
      {
        file: `${"directory/".repeat(60)}long.bin`,
        operation: "pull_adb_file",
        path: `/sdcard/${"directory/".repeat(60)}long.bin`,
      },
      {
        file: "host.bin",
        operation: "pull_adb_file",
        path: join(root, "host.bin"),
      },
      { file: "offline.bin", operation: "push_adb_file", path: "device" },
    ] as const) {
      const devicePath = `/sdcard/${scenario.file}`;
      const transfer =
        scenario.operation === "pull_adb_file"
          ? {
              arguments: [devicePath, "--output-directory", root],
              input: { output_directory: root },
            }
          : { arguments: [source, devicePath], input: { local_path: source } };
      const output = await cli.run({
        arguments: [
          scenario.operation.replaceAll("_", "-"),
          "device",
          ...transfer.arguments,
          "--json",
        ],
        environment,
      });
      expect(output.exitCode, output.stderr).toBe(1);
      expect(output.json).toMatchObject({
        code: "unsupported_target",
        details: { operation: scenario.operation, path: scenario.path },
      });
      const reply = await call(scenario.operation, {
        serial: "device",
        device_path: devicePath,
        ...transfer.input,
      });
      expect(reply.isError).toBe(true);
      const content = reply.content.find((item) => item.type === "text");
      if (content?.type !== "text") throw new Error("Missing error response");
      expect(JSON.parse(content.text)).toEqual({ error: output.json });
      await client.ping();
    }
    expect(await readFile(source, "utf8")).toBe("caller bytes");
  },
);

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { spawnSync } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { AdbProvider } from "../../../src/adb/AdbProvider.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32")(
  "classifies output paths blocked by a file before device commands",
  async () => {
    const root = await createTestTempDirectory("rea-adb-output-refusal-");
    const adb = join(root, "adb");
    const calls = join(root, "calls");
    const file = join(root, "file");
    await writeFile(file, "untouched");
    await writeFile(
      adb,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\nif [ "$1" = version ]; then printf 'Android Debug Bridge version 1.0.41\\nVersion 34.0.5-fixture\\n'; exit 0; fi\nexit 97\n`,
    );
    await chmod(adb, 0o755);
    const server = createServer(
      {
        kind: "session",
        session: createTestBinarySession(() => {
          throw new Error("unexpected provider");
        }),
      },
      {
        adbDeviceAnalysis: new AdbProvider({
          environment: { REA_ADB_PATH: adb },
        }),
      },
    );
    onTestFinished(() => server.close());
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "adb-output-refusal", version: "1" });
    onTestFinished(() => client.close());
    await client.connect(clientTransport);
    for (const { output, hostCode } of [
      { output: relative(process.cwd(), file), hostCode: "EEXIST" },
      { output: join(file, "child"), hostCode: "ENOTDIR" },
    ]) {
      for (const name of [
        "pull_adb_file",
        "capture_adb_screen",
        "collect_adb_bugreport",
      ] as const) {
        const args = {
          serial: "device",
          output_directory: output,
          ...(name === "pull_adb_file" ? { device_path: "/sdcard/file" } : {}),
        };
        const { error } = parseMcpToolError(
          await client.callTool({ name, arguments: args }),
        );
        expect(error).toMatchObject({
          code: "invalid_request",
          details: {
            issues: [
              {
                path: ["output_directory"],
                reason: "invalid_value",
                observed: { path: output, code: hostCode },
                message: expect.any(String),
              },
            ],
          },
        });
        const cli = spawnSync(
          process.execPath,
          [
            "scripts/rea.mjs",
            name.replaceAll("_", "-"),
            "device",
            ...(name === "pull_adb_file" ? ["/sdcard/file"] : []),
            "--output-directory",
            output,
            "--json",
          ],
          {
            encoding: "utf8",
            env: { ...process.env, REA_ADB_PATH: adb },
            timeout: 20_000,
          },
        );
        expect(cli.status).toBe(1);
        expect(cli.stderr).toBe("");
        expect(JSON.parse(cli.stdout)).toMatchObject({
          code: "invalid_request",
          details: {
            issues: [
              {
                path: ["output_directory"],
                reason: "invalid_value",
                observed: { path: output, code: hostCode },
              },
            ],
          },
        });
      }
    }
    expect(await readFile(file, "utf8")).toBe("untouched");
    expect(
      (await readFile(calls, "utf8"))
        .trim()
        .split("\n")
        .every((call) => call === "version"),
    ).toBe(true);
  },
);

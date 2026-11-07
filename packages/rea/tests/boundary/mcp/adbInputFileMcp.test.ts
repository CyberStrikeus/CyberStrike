import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { AdbProvider } from "../../../src/adb/AdbProvider.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32")(
  "reports each refused local file before device commands",
  async () => {
    const root = await createTestTempDirectory("rea-adb-input-refusal-");
    const adb = join(root, "adb");
    const calls = join(root, "calls");
    await mkdir(join(root, "directory"));
    await symlink("loop", join(root, "loop"));
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
    const client = new Client({ name: "adb-input-refusal", version: "1" });
    onTestFinished(() => client.close());
    await client.connect(clientTransport);
    for (const { selected, hostCode } of [
      {
        selected: relative(process.cwd(), join(root, "missing")),
        hostCode: "ENOENT",
      },
      { selected: join(root, "directory"), hostCode: undefined },
      { selected: join(root, "loop"), hostCode: "ELOOP" },
    ]) {
      for (const [name, field] of [
        ["push_adb_file", "local_path"],
        ["install_adb_package", "apk_path"],
      ] as const) {
        const result = await client.callTool({
          name,
          arguments: {
            serial: "device",
            [field]: selected,
            ...(name === "push_adb_file"
              ? { device_path: "/sdcard/file" }
              : {}),
          },
        });
        const { error } = parseMcpToolError(result);
        expect(error).toMatchObject({
          code: "invalid_request",
          details: {
            issues: [
              {
                path: [field],
                reason: "invalid_value",
                observed: {
                  path: selected,
                  ...(hostCode === undefined ? {} : { code: hostCode }),
                },
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
            selected,
            ...(name === "push_adb_file" ? ["/sdcard/file"] : []),
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
                path: [field],
                reason: "invalid_value",
                observed: {
                  path: selected,
                  ...(hostCode === undefined ? {} : { code: hostCode }),
                },
              },
            ],
          },
        });
      }
    }
    expect(
      (await readFile(calls, "utf8"))
        .trim()
        .split("\n")
        .every((call) => call === "version"),
    ).toBe(true);
  },
);

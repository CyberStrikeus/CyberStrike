import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const encodingFixture = () => {
  const xml =
    '<?xml version="1.0" encoding="UTF-16"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>App</string><key>CFBundleIdentifier</key><string>dev.rea.encoding</string></dict></plist>';
  const utf16 = Buffer.from(xml, "utf16le");
  const utf8 = xml.replace("UTF-16", "UTF-8");
  const cases = [
    {
      name: "UTF-8 BOM",
      bytes: Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(utf8),
      ]),
      valid: true,
    },
    {
      name: "UTF-16 LE",
      bytes: Buffer.concat([Buffer.from([0xff, 0xfe]), utf16]),
      valid: true,
    },
    {
      name: "UTF-16 BE",
      bytes: Buffer.concat([
        Buffer.from([0xfe, 0xff]),
        Buffer.from(utf16).swap16(),
      ]),
      valid: true,
    },
    {
      name: "unsupported declaration",
      bytes: Buffer.from(utf8.replace("UTF-8", "Shift_JIS")),
      valid: false,
    },
    {
      name: "declaration mismatch",
      bytes: Buffer.from(xml),
      valid: false,
    },
    {
      name: "truncated UTF-16",
      bytes: Buffer.concat([Buffer.from([0xff, 0xfe]), utf16.subarray(0, -1)]),
      valid: false,
    },
    {
      name: "malformed UTF-8 executable",
      bytes: Buffer.concat([
        Buffer.from(utf8.split("<string>App</string>")[0] + "<string>"),
        Buffer.from([0xff]),
        Buffer.from("</string>" + utf8.split("<string>App</string>")[1]),
      ]),
      valid: false,
    },
  ];
  return cases;
};

describe.skipIf(process.platform !== "darwin")(
  "app bundle XML byte boundaries",
  () => {
    cliTest(
      "resolves real compiled bundles without changing executable names during decoding",
      async ({ cli, processes }) => {
        const directory = await createTestTempDirectory("rea-bundle-encoding-");
        const app = join(directory, "Example.app");
        const contents = join(app, "Contents");
        await mkdir(join(contents, "MacOS"), { recursive: true });
        const compiled = await processes.run("/usr/bin/xcrun", [
          "clang",
          resolve("tests/conformance/interface-builder/fixture.c"),
          "-o",
          join(contents, "MacOS", "App"),
        ]);
        expect(compiled.exitCode, compiled.stderr).toBe(0);
        const cases = encodingFixture();
        const { call } = await connectLocalToolsMcp({
          PATH: "/usr/bin:/bin",
        });
        const cliFailureReasons: Readonly<Record<string, string>> = {
          "declaration mismatch":
            "XML encoding declaration disagrees with its bytes",
          "truncated UTF-16":
            "XML text bytes are invalid for the detected encoding",
          "malformed UTF-8 executable":
            "XML text bytes are invalid for the detected encoding",
        };
        for (const { name, bytes, valid } of cases) {
          await writeFile(join(contents, "Info.plist"), bytes);
          const opened = await call("open_binary", { path: app });
          if (valid) {
            expect(
              opened.isError,
              `${name}: ${JSON.stringify(opened)}`,
            ).not.toBe(true);
            expect(opened.structuredContent, name).toMatchObject({
              result: {
                path: join(contents, "MacOS", "App"),
                format: "mach-o",
              },
            });
            const result = await cli.run({
              arguments: ["inspect-plist", app, "--json"],
              environment: { REA_LOG_LEVEL: "silent" },
            });
            expect(
              result.exitCode,
              `${name}: ${result.stdout}\n${result.stderr}`,
            ).toBe(0);
            expect(result.json).toMatchObject({
              normalized_result: {
                value: {
                  CFBundleExecutable: "App",
                  CFBundleIdentifier: "dev.rea.encoding",
                },
                bundle: { executable: "App" },
              },
            });
            const inspected = await call("inspect_plist", {});
            expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
            expect(inspected.structuredContent).toMatchObject({
              normalized_result: {
                value: {
                  CFBundleExecutable: "App",
                  CFBundleIdentifier: "dev.rea.encoding",
                },
              },
            });
            const closed = await call("close_binary", {});
            expect(closed.isError, JSON.stringify(closed)).not.toBe(true);
          } else {
            expect(opened.isError, name).toBe(true);
            expect(parseMcpToolError(opened), name).toMatchObject({
              error: {
                details: {
                  path: join(contents, "Info.plist"),
                  reason: expect.stringContaining(
                    "app Info.plist is malformed, unsupported, or lacks CFBundleExecutable",
                  ),
                },
              },
            });
            const cliFailureReason = cliFailureReasons[name];
            if (cliFailureReason !== undefined) {
              const result = await cli.run({
                arguments: ["inspect-plist", app, "--json"],
                environment: { REA_LOG_LEVEL: "silent" },
              });
              expect(result.exitCode, result.stdout + result.stderr).toBe(1);
              expect(result.json).toMatchObject({
                code: "capability_unavailable",
                details: {
                  provider_id: "native-macos",
                  operation: "inspect_plist",
                  reason: expect.stringContaining(join(contents, "Info.plist")),
                },
              });
              expect(result.json).toMatchObject({
                details: {
                  reason: expect.stringContaining(cliFailureReason),
                },
              });
            }
          }
        }
      },
      45_000,
    );
  },
);

import { join } from "node:path";
import { writeFile } from "node:fs/promises";

import { describe, expect } from "vitest";

import {
  machoImage,
  segmentCommand,
} from "../../../src/artifacts/apple/MachoImage.fixture.js";
import { inspectMachoSchema } from "../../../src/domain/native/nativeInspection.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { cliTest } from "../../support/cli/cliFixture.js";

/** Match the readable synthetic CORE/header fixture reported in #5708. */
const refusedFileTypeImage = (fileType: 3 | 4): Buffer => {
  const segment = Buffer.from(
    segmentCommand({
      name: "__TEXT",
      vmaddr: 0x100000000n,
      vmsize: 0x4000n,
    }),
  );
  segment.writeBigUInt64LE(4096n, 48);
  segment.writeUInt32LE(7, 56);
  segment.writeUInt32LE(5, 60);
  const uuid = Buffer.alloc(24);
  uuid.writeUInt32LE(0x1b, 0);
  uuid.writeUInt32LE(uuid.length, 4);
  uuid.set(
    Array.from({ length: 16 }, (_, index) => index),
    8,
  );
  const image = Buffer.alloc(4096);
  image.set(machoImage({ fileType, commands: [segment, uuid] }));
  return image;
};

describe.skipIf(process.platform !== "darwin")(
  "native Mach-O CLI without LC_UUID",
  () => {
    cliTest(
      "returns readable facts with partial dyld coverage and preserves controls",
      async ({ cli, processes }) => {
        const directory = await createTestTempDirectory("rea-macho-no-uuid-");
        const source = join(directory, "probe.c");
        const probe = join(directory, "probe");
        const control = join(directory, "control");
        const object = join(directory, "probe.o");
        await writeFile(
          source,
          "int exported_add(int a, int b) { return a + b; }\nint main(void) { return exported_add(1, 2); }\n",
        );
        for (const arguments_ of [
          ["clang", "-Wl,-no_uuid", "-o", probe, source],
          ["clang", "-o", control, source],
          ["clang", "-c", source, "-o", object],
        ]) {
          const compiled = await processes.run("/usr/bin/xcrun", arguments_, {
            timeoutMs: 30_000,
          });
          expect(compiled.exitCode, compiled.stderr).toBe(0);
        }

        const inspect = async (path: string) => {
          const result = await cli.run({
            arguments: ["inspect-macho", path, "--json"],
            environment: { REA_LOG_LEVEL: "silent" },
          });
          expect(result.exitCode, result.stdout + result.stderr).toBe(0);
          return inspectMachoSchema.parse(
            (result.json as { normalized_result?: unknown }).normalized_result,
          );
        };

        const missingUuid = await inspect(probe);
        expect(missingUuid).toMatchObject({
          uuid: null,
          load_commands: { exhaustive: true },
          imports: {
            items: [],
            total: null,
            exhaustive: false,
            limitations: expect.arrayContaining([
              expect.stringContaining(
                "dyld_info -imports reported 'missing LC_UUID load command'",
              ),
            ]),
          },
          exports: {
            items: expect.arrayContaining([
              expect.objectContaining({ name: "_exported_add", source: "nm" }),
              expect.objectContaining({ name: "_main", source: "nm" }),
            ]),
            total: null,
            exhaustive: false,
          },
          provenance: expect.arrayContaining([
            expect.objectContaining({
              tool: "dyld_info",
              exit: { code: 1, signal: null },
            }),
          ]),
        });
        expect(missingUuid.limitations).toContain(
          "dyld_info -exports reported 'missing LC_UUID load command'; exports include nm symbol-table observations only.",
        );

        const normalControl = await inspect(control);
        expect(normalControl.uuid).not.toBeNull();
        expect(normalControl.load_commands.exhaustive).toBe(true);

        const objectControl = await inspect(object);
        expect(objectControl.uuid).toBeNull();
        expect(objectControl.load_commands.exhaustive).toBe(true);

        const { call } = await connectLocalToolsMcp({ HOME: directory });
        const opened = await call("open_binary", { path: probe });
        expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
        const mcp = await call("inspect_macho", { detail: "complete" });
        expect(mcp.isError, JSON.stringify(mcp)).not.toBe(true);
        const report = inspectMachoSchema.parse(
          parseEvidence(mcp.structuredContent).normalized_result,
        );
        expect(report.uuid).toBeNull();
        expect(report.imports).toEqual(missingUuid.imports);
        expect(report.exports).toEqual(missingUuid.exports);
        expect(report.load_commands).toEqual(missingUuid.load_commands);
        expect((await call("close_binary", {})).isError).not.toBe(true);

        // These are synthetic readable headers, not an OS core dump or a
        // conforming historical FVMLIB (the latter omits LC_IDFVMLIB).
        for (const [name, fileType] of [
          ["core", 4],
          ["fvmlib", 3],
        ] as const) {
          const path = join(directory, name);
          await writeFile(path, refusedFileTypeImage(fileType));
          const diagnosticPattern = new RegExp(
            `unknown (?:mh\\.)?filetype ${fileType}(?:\\r?\\n|$)`,
            "u",
          );
          const expectedRefusal = {
            code: "unsupported_target",
            category: "unsupported_target",
            remediation: { action: expect.stringContaining("linked Mach-O") },
            details: {
              path,
              reason: expect.stringMatching(diagnosticPattern),
              captured_output: {
                stdout: expect.stringMatching(diagnosticPattern),
                exit_code: 1,
                signal: null,
                truncated: false,
              },
            },
          };
          const refused = await cli.run({
            arguments: ["inspect-macho", path, "--json"],
            environment: { REA_LOG_LEVEL: "silent" },
          });
          expect(refused.exitCode, refused.stdout + refused.stderr).toBe(1);
          expect(refused.json, JSON.stringify(refused.json)).toMatchObject(
            expectedRefusal,
          );

          expect((await call("open_binary", { path })).isError).not.toBe(true);
          const inspected = await call("inspect_macho", {});
          expect(inspected.isError).toBe(true);
          expect(parseMcpToolError(inspected)).toMatchObject({
            error: expectedRefusal,
          });
          expect((await call("close_binary", {})).isError).not.toBe(true);
        }
      },
    );
  },
);

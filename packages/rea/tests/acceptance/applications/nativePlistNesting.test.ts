import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildBinary, type PlistValue } from "plist";
import { describe, expect } from "vitest";

import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { inspectPlistSchema } from "../../../src/domain/native/nativeInspection.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const lintXmlPlist = (path: string) =>
  new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolve, reject) => {
      execFile(
        "/usr/bin/plutil",
        ["-lint", "--", path],
        { timeout: 10_000 },
        (error, stdout, stderr) => {
          const exitCode = error === null ? 0 : error.code;
          if (typeof exitCode !== "number") {
            reject(error);
            return;
          }
          resolve({ exitCode, stdout, stderr });
        },
      );
    },
  );

describe.skipIf(process.platform !== "darwin")(
  "ordinary plist source nesting",
  () => {
    cliTest(
      "retains depth-129 data and depth-200 integers through CLI and MCP",
      async ({ cli }) => {
        const root = await createTestTempDirectory("rea-plist-nesting-");
        const target = join(root, "target");
        await writeFile(target, thinMach(0xfeedfacf, 0x0100000c));
        const environment = {
          HOME: root,
          USERPROFILE: root,
          REA_LOG_LEVEL: "silent",
          REA_ANALYSIS_PROVIDER: "auto",
        };
        const { call } = await connectLocalToolsMcp(environment);
        expect((await call("open_binary", { path: target })).isError).not.toBe(
          true,
        );
        for (const fixture of [
          { format: "binary", depth: 129, data: true },
          { format: "xml", depth: 129, data: true },
          { format: "binary", depth: 200, data: false },
          { format: "xml", depth: 200, data: false },
          { format: "json", depth: 200, data: false },
          { format: "binary", depth: 998, data: true },
          { format: "binary", depth: 999, data: true },
          { format: "xml", depth: 998, data: true },
          { format: "xml", depth: 999, data: true },
          { format: "json", depth: 998, data: false },
          { format: "json", depth: 999, data: false },
        ] as const) {
          const { format, depth, data } = fixture;
          const path = join(root, `${format}-${depth}.plist`);
          let value: PlistValue = data ? Buffer.from([0, 1]) : 1;
          for (let level = 0; level < depth; level += 1)
            value = { level: value };
          const bytes =
            format === "binary"
              ? Buffer.from(buildBinary(value))
              : Buffer.from(
                  format === "json"
                    ? JSON.stringify(value)
                    : `<plist>${"<dict><key>level</key>".repeat(depth)}${data ? "<data>AAE=</data>" : "<integer>1</integer>"}${"</dict>".repeat(depth)}</plist>`,
                );
          await writeFile(path, bytes);
          // The decoder ceiling does not override native XML admission.
          // Compare its upper-edge admission with the actual utility, while
          // requiring the historical depth-129/200 controls to succeed below.
          const native =
            format === "xml" && depth === 998
              ? await lintXmlPlist(path)
              : undefined;
          const output = await cli.run({
            arguments: ["inspect-plist", path, "--json"],
            environment,
          });
          const response = await call("inspect_plist", { path });
          expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
          if (depth === 999) {
            expect(output.exitCode, output.stderr).toBe(1);
            const expectedFailure = {
              code: "resource_constraint",
              category: "resource_constraint",
              retryable: false,
              details: {
                resource: "memory",
                reported_limits: { maximum_nesting_depth: 998 },
              },
              remediation: {
                action: expect.stringMatching(/\S/u),
              },
            };
            expect(output.json).toMatchObject(expectedFailure);
            expect(parseMcpToolError(response).error).toMatchObject(
              expectedFailure,
            );
            continue;
          }
          if (native !== undefined && native.exitCode !== 0) {
            expect(output.exitCode, output.stderr).toBe(1);
            const expectedFailure = {
              code: "invalid_request",
              retryable: false,
              details: {
                operation: "inspect_plist",
                captured_output: {
                  exit_code: native.exitCode,
                  stdout: native.stdout,
                  stderr: native.stderr,
                },
              },
            };
            expect(output.json).toMatchObject(expectedFailure);
            expect(parseMcpToolError(response).error).toMatchObject(
              expectedFailure,
            );
            continue;
          }
          expect(
            output.exitCode,
            JSON.stringify({
              format,
              depth,
              stderr: output.stderr,
              failure: output.exitCode === 0 ? undefined : output.json,
            }),
          ).toBe(0);
          const cliResult = inspectPlistSchema.parse(
            parseEvidence(output.json).normalized_result,
          );
          expect(response.isError, JSON.stringify(response)).not.toBe(true);
          const mcpResult = inspectPlistSchema.parse(
            parseEvidence(response.structuredContent).normalized_result,
          );
          expect(mcpResult).toEqual(cliResult);
          // Generic JSON text remains unclassified; a JSON conversion alone
          // does not establish a source-format observation.
          expect(cliResult.format).toBe(format === "json" ? "unknown" : format);
          expect(cliResult.provenance.map((item) => item.tool)).toEqual([
            "file",
            ...(format === "xml" ? ["plutil"] : []),
          ]);
          let leaf: unknown = cliResult.value;
          for (let level = 0; level < depth; level += 1) {
            expect(leaf).toHaveProperty("level");
            leaf = (leaf as Record<string, unknown>).level;
          }
          expect(leaf).toEqual(
            data ? { $plist_type: "data", base64: "AAE=" } : 1,
          );
          expect(
            cliResult.limitations.some((item) =>
              item.includes("XML conversion"),
            ),
          ).toBe(false);
        }
      },
      60_000,
    );
  },
);

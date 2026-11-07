import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { nativeExportsSchema } from "../../../src/domain/native/nativeExports.js";
import { elfExportImage } from "../../fixtures/binaryDiagnostics/nativeExports.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "keeps unenumerated ELF dynamic exports unsupported through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-elf-dynamic-exports-");
    const mcp =
      surface === "stdio MCP" ? await connectLocalToolsMcp() : undefined;
    for (const encoding of [
      { bits: 64, little: true },
      { bits: 32, little: false },
    ] as const) {
      for (const sectionHeaders of ["null-only", false, true] as const) {
        const path = join(
          root,
          `exports-${encoding.bits}-${sectionHeaders}.so`,
        );
        const bytes = elfExportImage({
          ...encoding,
          symbols: [{ name: "exported_answer" }],
          dynamicSegment: true,
          sectionHeaders,
        });
        await writeFile(path, bytes);
        let document: unknown;
        if (surface === "CLI") {
          const response = await cli.run({
            arguments: ["inspect-native-exports", path, "--json"],
          });
          expect(response.exitCode, response.stderr).toBe(0);
          document = response.json;
        } else {
          const response = await mcp!.call("inspect_native_exports", { path });
          expect(response.isError, JSON.stringify(response)).not.toBe(true);
          document = response.structuredContent;
        }
        const evidence = toolContract(
          "inspect_native_exports",
        ).outputSchema.parse(document);
        const result = nativeExportsSchema.parse(evidence.normalized_result);
        expect(result).toMatchObject({
          format: "elf",
          coverage: {
            status: sectionHeaders === true ? "complete" : "unsupported",
            exports: sectionHeaders === true ? 1 : 0,
          },
          issues: [],
        });
        if (sectionHeaders === true) {
          expect(result.exports).toMatchObject([{ name: "exported_answer" }]);
        } else {
          expect(result.exports).toEqual([]);
          expect(result.coverage.reason).toContain("dynamic segment");
          expect(result.limitations.join(" ")).not.toContain(
            "so it exports no dynamic symbols",
          );
        }
      }
    }
  },
);

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect } from "vitest";
import { createEvidence, parseEvidence } from "../../src/domain/evidence.js";
import { wasmInterfaceComparisonSchema } from "../../src/contracts/wasm/wasmComparisonContracts.js";
import { composeBinarySession } from "../../src/application/binary/BinarySessionComposition.js";
import { AnalysisProviderRegistry } from "../../src/application/binary/AnalysisProviderRegistry.js";
import { parseWabtWat } from "../../src/wasm/WabtWat.js";
import { createServer } from "../../src/server/createServer.js";
import { wasmArtifactFixture } from "../fixtures/wasm/artifact.js";
import { cliTest } from "../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

cliTest(
  "compares portable Evidence identically through CLI and retained MCP with schema/provenance",
  async ({ cli }) => {
    const sources = (["i32", "i64"] as const).map((parameter, index) => {
      const report = wasmArtifactFixture();
      report.interface = {
        state: "complete",
        issues: [],
        entries: [
          {
            direction: "export",
            module: null,
            name: 'quoted"\ufeffname',
            kind: "func",
            index: 0,
            signature: { kind: "func", params: [parameter], results: [] },
            wat_form: '(export "quoted\\22\\ef\\bb\\bfname" (func 0))',
            issue: null,
          },
        ],
      };
      // The left source predates optional-metadata coverage fields and the
      // tolerant custom-section profile. Portable Evidence remains readable.
      const {
        debug_name_metadata: _debugNames,
        custom_section_warnings: _warnings,
        ...legacyReport
      } = report;
      if (index === 0)
        for (const command of legacyReport.tool_profile.commands)
          command.arguments = command.arguments.filter(
            (argument) => argument !== "--ignore-custom-section-errors",
          );
      return createEvidence(
        {
          path: report.artifact.path,
          sha256: report.artifact.sha256,
          format: "file",
        },
        { id: "typed-fixture", name: "Typed fixture", version: "1" },
        {
          operation: "inspect_wasm_artifact",
          parameters: { path: report.artifact.path },
          result: index === 0 ? legacyReport : report,
          confidence: "observed",
        },
      );
    });
    const [left, right] = sources;
    if (left === undefined || right === undefined)
      throw new Error("Missing paired fixture");
    const root = await createTestTempDirectory("rea-wasm-comparison-");
    const path = join(root, "input.json");
    const input = { left, right, scope: "both" };
    await writeFile(path, JSON.stringify(input));
    const cliResult = await cli.run({
      arguments: ["compare-wasm-interfaces", path, "--json"],
    });
    expect(cliResult.exitCode).toBe(0);
    const cliEvidence = parseEvidence(cliResult.json);
    const cliReport = wasmInterfaceComparisonSchema.parse(
      cliEvidence.normalized_result,
    );
    expect(cliReport).toMatchObject({
      coverage: "complete-within-inputs",
      changes: [{ name: 'quoted"\ufeffname', state: "changed" }],
      left: {
        evidence_id: left.evidence_id,
        artifact: {
          path: "/artifacts/module.wasm",
          sha256: "a".repeat(64),
          bytes: 8,
        },
      },
    });
    const session = composeBinarySession(new AnalysisProviderRegistry([]));
    const server = createServer({ kind: "session", session });
    const client = new Client({ name: "wasm-interface-parity", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(st);
      await client.connect(ct);
      const tool = (await client.listTools()).tools.find(
        (t) => t.name === "compare_wasm_interfaces",
      );
      if (tool?.outputSchema === undefined)
        throw new Error("Missing comparison schema");
      const outputSchema: Record<string, unknown> = tool.outputSchema;
      const ajv = new Ajv2020({ strict: false, validateFormats: false });
      expect(ajv.validate(tool.inputSchema, input)).toBe(true);
      expect(ajv.validate(tool.inputSchema, { left, right })).toBe(false);
      const mcp = await client.callTool(
        { name: tool.name, arguments: input },
        { toolDefinition: tool },
      );
      expect(mcp.isError, JSON.stringify(mcp)).not.toBe(true);
      expect(
        ajv.validate(outputSchema, mcp.structuredContent),
        JSON.stringify(ajv.errors),
      ).toBe(true);
      const mcpEvidence = parseEvidence(mcp.structuredContent);
      expect(mcpEvidence.normalized_result).toEqual(cliReport);
      expect(mcpEvidence.evidence_id).toBe(cliEvidence.evidence_id);
      expect(mcpEvidence.evidence_links).toEqual([
        left.evidence_id,
        right.evidence_id,
      ]);
      const retained = await client.callTool(
        {
          name: tool.name,
          arguments: {
            scope: "both",
            left: { kind: "retained-evidence", evidence_id: left.evidence_id },
            right: {
              kind: "retained-evidence",
              evidence_id: right.evidence_id,
            },
          },
        },
        { toolDefinition: tool },
      );
      expect(retained.isError).not.toBe(true);
      expect(parseEvidence(retained.structuredContent).evidence_id).toBe(
        mcpEvidence.evidence_id,
      );
      const invalid = await client.callTool(
        {
          name: tool.name,
          arguments: { ...input, scope: "all" },
        },
        { toolDefinition: tool },
      );
      expect(invalid.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
      await session.close();
    }
  },
);

cliTest(
  "does not report colliding debug identifiers as unchanged after a signature change",
  async ({ cli }) => {
    const input = (parameter: string) => {
      const report = wasmArtifactFixture();
      report.interface = parseWabtWat(
        `(module (func $same (param i32)) (func $same (param ${parameter})) (export "first" (func $same)) (export "second" (func $same)))`,
      ).interface;
      return createEvidence(
        {
          path: report.artifact.path,
          sha256: report.artifact.sha256,
          format: "file",
        },
        { id: "fixture", name: "typed fixture", version: "1" },
        {
          operation: "inspect_wasm_artifact",
          parameters: { path: report.artifact.path },
          result: report,
          confidence: "observed",
        },
      );
    };
    const root = await createTestTempDirectory("rea-wasm-colliding-names-");
    const path = join(root, "input.json");
    await writeFile(
      path,
      JSON.stringify({
        left: input("i32"),
        right: input("i64"),
        scope: "both",
      }),
    );
    const result = await cli.run({
      arguments: ["compare-wasm-interfaces", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const report = wasmInterfaceComparisonSchema.parse(
      parseEvidence(result.json).normalized_result,
    );
    expect(report.changes.map(({ state }) => state)).toEqual([
      "unknown",
      "unknown",
    ]);
    expect(report.summary.unchanged).toBe(0);
  },
);

import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect } from "vitest";
import type { Client } from "@modelcontextprotocol/client";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../../src/domain/evidence.js";
import { goBinarySchema } from "../../../src/domain/go/goBinary.js";
import {
  analysisViewResultSchema,
  goBinarySummaryViewResultSchema,
} from "../../../src/domain/analysisView/analysisView.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import {
  createGoBinaryFixture,
  GO_MODULE_TEXT,
} from "../../fixtures/go/image.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";

type Operation = "inspect_go_binary" | "inspect_analysis_view";
const schemaValidation = createMcpSchemaValidation();
afterAll(() => schemaValidation.clear());
const goViewTest = mcpTest.extend<{
  goViews: {
    client: Client;
    root: string;
    path: string;
    bytes: Buffer;
    call: (
      name: Operation,
      input: Record<string, unknown>,
    ) => Promise<Evidence>;
  };
}>({
  goViews: async ({ mcp }, use) => {
    const root = await createTestTempDirectory("rea-go-views-");
    const path = join(root, "application");
    const fixture = createGoBinaryFixture({
      goVersion: "go1.26.0",
      moduleText:
        GO_MODULE_TEXT +
        "dep\texample.com/dependency\tv2.0.0\th1:second\nfuture\tunknown\n",
    });
    await writeFile(path, fixture.bytes);
    const session = createTestBinarySession(() => {
      throw new Error("No disassembler for Go views");
    });
    try {
      const client = await mcp.connect(
        createServer({ kind: "session", session }),
        undefined,
        schemaValidation,
      );
      const catalog = await client.listTools();
      const schemas = new Map(
        catalog.tools
          .filter(
            (tool) =>
              tool.name === "inspect_go_binary" ||
              tool.name === "inspect_analysis_view",
          )
          .map((tool) => {
            const output = tool.outputSchema;
            if (output === undefined)
              throw new Error(`Missing ${tool.name} output schema`);
            expect(output.$schema).toBe(
              "https://json-schema.org/draft/2020-12/schema",
            );
            expect(schemaValidation.assertions.validateSchema(output)).toBe(
              true,
            );
            expect(
              schemaValidation.assertions.validateSchema(tool.inputSchema),
            ).toBe(true);
            return [tool.name, tool] as const;
          }),
      );
      const call = async (name: Operation, input: Record<string, unknown>) => {
        const tool = schemas.get(name);
        if (tool === undefined) throw new Error(`Missing ${name} tool`);
        expect(
          schemaValidation.getValidator(tool.inputSchema)(input).valid,
          `${name} rejected its valid input`,
        ).toBe(true);
        const reply = await client.callTool(
          { name, arguments: input },
          { toolDefinition: tool },
        );
        expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
        return parseEvidence(reply.structuredContent);
      };
      await use({ client, root, path, bytes: fixture.bytes, call });
    } finally {
      await session.close();
    }
  },
});

const goPage = (evidence: Evidence) => {
  const view = analysisViewResultSchema.parse(evidence.normalized_result);
  if (view.kind !== "go") throw new Error("Expected a Go row page");
  return view;
};

goViewTest(
  "rejects authenticated inline and file parents with conflicting architecture",
  async ({ goViews: { client, root, path, call } }) => {
    const complete = await call("inspect_go_binary", { path });
    const report = goBinarySchema.parse(complete.normalized_result);
    const conflicting = createEvidence(
      {
        path,
        sha256: report.artifact.sha256,
        format: "elf",
        architecture: "arm64",
      },
      { id: "go-build-info", name: "Go metadata test fixture", version: "1" },
      {
        operation: "inspect_go_binary",
        parameters: { path },
        result: report,
        confidence: "observed",
      },
    );
    const evidencePath = join(root, "conflicting.json");
    await writeFile(evidencePath, JSON.stringify(conflicting));
    for (const source of [
      { kind: "inline", evidence: conflicting },
      { kind: "evidence-file", path: evidencePath },
    ]) {
      for (const view of [
        { kind: "summary" },
        { kind: "go", collection: "dependencies" },
      ]) {
        const reply = await client.callTool({
          name: "inspect_analysis_view",
          arguments: { source, view },
        });
        expect(parseMcpToolError(reply).error).toMatchObject({
          code: "invalid_request",
          details: {
            operation: "inspect_analysis_view",
            issues: [{ path: ["source", "subject"], reason: "invalid_value" }],
          },
        });
      }
    }
  },
);

goViewTest(
  "retains exact Go rows and complete Evidence after source removal",
  async ({ goViews: { client, root, path, bytes, call } }) => {
    const complete = await call("inspect_go_binary", { path });
    const report = goBinarySchema.parse(complete.normalized_result);
    const summary = await call("inspect_go_binary", {
      path,
      detail: "summary",
    });
    expect(summary).toMatchObject({
      raw_result: null,
      normalized_result: {
        kind: "summary",
        parent_evidence_id: complete.evidence_id,
        source_coverage: {
          build_info_available: true,
          module_parse_complete: false,
          runtime_dependencies: "unknown",
        },
        summary: {
          build_info: {
            go_version: "go1.26.0",
            module: {
              available_counts: {
                dependencies: 2,
                settings: 3,
                unparsed_lines: 1,
              },
            },
          },
        },
      },
    });
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    await unlink(path);
    const source = {
      kind: "retained-evidence",
      evidence_id: complete.evidence_id,
    };
    const view = {
      kind: "go",
      collection: "dependencies",
      paths: ["example.com/dependency"],
      fields: ["version", "replacement"],
      offset: 0,
      limit: 1,
    };
    const first = goPage(await call("inspect_analysis_view", { source, view }));
    expect(first.page.rows).toEqual([
      {
        index: 0,
        version: "v1.2.3",
        replacement: report.build_info!.module.dependencies[0]!.replacement,
      },
    ]);
    expect(first.coverage).toMatchObject({
      total: 2,
      next_offset: 1,
      exhausted: false,
    });
    const second = goPage(
      await call("inspect_analysis_view", {
        source,
        view: { ...view, offset: 1 },
      }),
    );
    expect(second.page.rows).toEqual([
      { index: 1, version: "v2.0.0", replacement: null },
    ]);
    expect(second.coverage).toMatchObject({
      total: 2,
      next_offset: null,
      exhausted: true,
    });
    const bundlePath = join(root, "evidence.json");
    const exported = await client.callTool({
      name: "export_evidence_bundle",
      arguments: { path: bundlePath },
    });
    expect(exported.isError, JSON.stringify(exported)).not.toBe(true);
    const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as {
      records: unknown[];
    };
    expect(
      bundle.records
        .map((record) => parseEvidence(record))
        .find((record) => record.evidence_id === complete.evidence_id),
    ).toEqual(complete);
    await client.ping();
  },
);

goViewTest(
  "intersects exact Go selections and keeps row identity with no selected fields",
  async ({ goViews: { client, path, call } }) => {
    const summary = goBinarySummaryViewResultSchema.parse(
      (await call("inspect_go_binary", { path, detail: "summary" }))
        .normalized_result,
    );
    const source = {
      kind: "retained-evidence",
      evidence_id: summary.parent_evidence_id,
    };
    const identity = goPage(
      await call("inspect_analysis_view", {
        source,
        view: { kind: "go", collection: "dependencies", fields: [] },
      }),
    );
    expect(identity.page.rows).toEqual([{ index: 0 }, { index: 1 }]);
    for (const selection of [
      { paths: [] },
      { indices: [] },
      { paths: ["other"], indices: [1] },
      { offset: 99 },
    ]) {
      const empty = goPage(
        await call("inspect_analysis_view", {
          source,
          view: { kind: "go", collection: "dependencies", ...selection },
        }),
      );
      expect(empty.page.rows).toEqual([]);
      expect(empty.coverage).toMatchObject({
        next_offset: null,
        exhausted: true,
      });
    }
    const selected = goPage(
      await call("inspect_analysis_view", {
        source,
        view: {
          kind: "go",
          collection: "dependencies",
          paths: ["example.com/dependency"],
          indices: [1],
          fields: ["version"],
        },
      }),
    );
    expect(selected.page.rows).toEqual([{ index: 1, version: "v2.0.0" }]);
    const setting = goPage(
      await call("inspect_analysis_view", {
        source,
        view: {
          kind: "go",
          collection: "settings",
          keys: ["GOOS"],
          fields: ["value"],
        },
      }),
    );
    expect(setting.page.rows).toEqual([{ index: 1, value: "linux" }]);
    expect(setting.coverage.total).toBe(1);
    const invalid = await client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source,
        view: {
          kind: "go",
          collection: "dependencies",
          fields: ["module_bytes_base64"],
        },
      },
    });
    expect(parseMcpToolError(invalid).error).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
    });
  },
);

mcpTest(
  "keeps unavailable Go metadata unknown in summaries and empty pages",
  async ({ mcp }) => {
    const root = await createTestTempDirectory("rea-go-absent-view-");
    const path = join(root, "application");
    await writeFile(path, createGoBinaryFixture({ omitBuildInfo: true }).bytes);
    const session = createTestBinarySession(() => {
      throw new Error("No deep provider");
    });
    try {
      const client = await mcp.connect(
        createServer({ kind: "session", session }),
      );
      const reply = await client.callTool({
        name: "inspect_go_binary",
        arguments: { path, detail: "summary" },
      });
      expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
      const summary = goBinarySummaryViewResultSchema.parse(
        parseEvidence(reply.structuredContent).normalized_result,
      );
      expect(summary).toMatchObject({
        summary: { build_info: null },
        source_coverage: {
          build_info_available: false,
          module_parse_complete: null,
          runtime_dependencies: "unknown",
        },
      });
      const source = {
        kind: "retained-evidence",
        evidence_id: summary.parent_evidence_id,
      };
      const empty = await client.callTool({
        name: "inspect_analysis_view",
        arguments: { source, view: { kind: "go", collection: "dependencies" } },
      });
      expect(empty.isError, JSON.stringify(empty)).not.toBe(true);
      const page = goPage(parseEvidence(empty.structuredContent));
      expect(page).toMatchObject({
        page: { rows: [] },
        coverage: { total: 0 },
        source_coverage: {
          build_info_available: false,
          module_parse_complete: null,
          runtime_dependencies: "unknown",
        },
      });
      expect(page.unknowns.join(" ")).toContain("remain unknown");
      const incompatible = await client.callTool({
        name: "inspect_analysis_view",
        arguments: { source, view: { kind: "native", facet: "procedure" } },
      });
      expect(parseMcpToolError(incompatible).error.code).toBe(
        "invalid_request",
      );
    } finally {
      await session.close();
    }
  },
);

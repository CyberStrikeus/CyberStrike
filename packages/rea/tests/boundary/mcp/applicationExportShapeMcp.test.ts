import { describe, expect, it, onTestFinished } from "vitest";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";
import { compareJavaScriptExportShapesEvidence } from "../../../src/application/javascript/JavaScriptApplicationWorkflowService.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { APPLICATION_TOOL_CONTRACTS } from "../../../src/contracts/applicationToolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE } from "../../../src/contracts/javascript/javascriptExportShapeComparisonExample.js";

it("executes the advertised export presence example with matching analyzed Evidence", async () => {
  const contract = APPLICATION_TOOL_CONTRACTS.find(
    ({ name }) => name === "compare_javascript_export_shapes",
  );
  const example = contract?.examples.find(
    ({ title }) =>
      title ===
      "Report observed return-property presence when static values stay unknown",
  );
  if (example === undefined)
    throw new Error("Missing advertised presence example");
  const { client, close } = await createApplicationMcpHarness({
    serverOptions: {
      environment: { ...process.env, REA_MCP_INPUT_SCHEMA_PROFILE: "full" },
    },
  });
  onTestFinished(close);
  const listing = await client.listTools();
  const advertised = listing.tools.find(
    ({ name }) => name === "compare_javascript_export_shapes",
  );
  const examples = z.array(z.unknown()).parse(advertised?.inputSchema.examples);
  expect(new Set(examples.map((input) => JSON.stringify(input))).size).toBe(
    examples.length,
  );
  const response = await client.callTool({
    name: "compare_javascript_export_shapes",
    arguments: example.input,
  });
  expect(response.isError).not.toBe(true);
  expect(response.structuredContent).toMatchObject({
    normalized_result: {
      left: { status: "selected" },
      right: { status: "selected" },
      summary: { added: 1, removed: 1, changed: 0, unknown: 0 },
      property_inventories: expect.arrayContaining([
        expect.objectContaining({
          side: "left",
          paired: true,
          properties: ["/count", "/kind"],
        }),
        expect.objectContaining({
          side: "right",
          paired: true,
          properties: ["/kind", "/total"],
        }),
      ]),
      changes: expect.arrayContaining([
        expect.objectContaining({
          path: "/count",
          status: "removed",
          presence: { left: "present", right: "absent" },
          left: { availability: "unknown", reason: expect.any(String) },
        }),
        expect.objectContaining({
          path: "/total",
          status: "added",
          presence: { left: "absent", right: "present" },
          right: { availability: "unknown", reason: expect.any(String) },
        }),
      ]),
    },
  });
});

it("traces example semantic modules with their parsed artifact digests", async () => {
  const { client, close } = await createApplicationMcpHarness();
  onTestFinished(close);
  for (const application of [
    JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE.left,
    JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE.right,
  ]) {
    const analysis = javascriptApplicationAnalysisResultSchema.parse(
      application.normalized_result,
    );
    const module = analysis.semantic_graph.nodes.find(
      ({ kind }) => kind === "module",
    );
    const evidenceContext = analysis.semantic_graph.evidence_contexts.find(
      ({ context_id }) => context_id === module?.evidence.context_id,
    );
    if (module === undefined || !evidenceContext?.artifact.available)
      throw new Error("Example must retain an artifact-backed semantic module");
    const response = await client.callTool({
      name: "trace_javascript_semantics",
      arguments: {
        application,
        query: {
          seed: { kind: "semantic-node", node_id: module.node_id },
          direction: "ownership",
        },
      },
    });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      normalized_result: {
        evidence_contexts: expect.arrayContaining([
          expect.objectContaining({
            context_id: module.evidence.context_id,
            artifact: expect.objectContaining({
              sha256: evidenceContext.artifact.sha256,
            }),
          }),
        ]),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            node_id: module.node_id,
            identity: expect.objectContaining({
              artifact_sha256: evidenceContext.artifact.sha256,
            }),
          }),
        ]),
      },
    });
  }
});

describe("application workflow MCP parity", () => {
  it("compares exact parser export shapes with inline Evidence", async () => {
    const root = await createTestTempDirectory("rea-export-shape-mcp-");
    const leftRoot = join(root, "left");
    const rightRoot = join(root, "right");
    await Promise.all([mkdir(leftRoot), mkdir(rightRoot)]);
    await Promise.all([
      copyFile(
        resolve("tests/fixtures/replay/parser.mjs"),
        join(leftRoot, "parser.mjs"),
      ),
      copyFile(
        resolve("tests/fixtures/replay/parser-v2.mjs"),
        join(rightRoot, "parser.mjs"),
      ),
    ]);
    const [left, right] = await Promise.all([
      analyzeJavaScriptApplication({
        input_path: leftRoot,
      }),
      analyzeJavaScriptApplication({
        input_path: rightRoot,
      }),
    ]);
    if (!left.ok) throw left.error;
    if (!right.ok) throw right.error;
    const harness = await createApplicationMcpHarness();
    const { client, session } = harness;
    const selectors = {
      left_module_path: "parser.mjs",
      left_export_name: "default",
      right_module_path: "parser.mjs",
      right_export_name: "default",
    };
    try {
      const selectedPath = `${leftRoot}${sep}.`;
      const selectedApplication = await client.callTool({
        name: "analyze_javascript_application",
        arguments: { input_path: selectedPath },
      });
      expect(selectedApplication.isError).not.toBe(true);
      const selectedEvidence = parseEvidence(
        selectedApplication.structuredContent,
      );
      expect(selectedEvidence.parameters.input_path).toBe(selectedPath);
      expect(left.value.parameters.input_path).toBe(leftRoot);
      expect(selectedEvidence.normalized_result).toEqual(
        left.value.normalized_result,
      );
      expect(selectedEvidence.subject).toEqual(left.value.subject);
      expect(selectedEvidence.evidence_id).not.toBe(left.value.evidence_id);
      const full = await client.callTool({
        name: "compare_javascript_export_shapes",
        arguments: { left: left.value, right: right.value, ...selectors },
      });
      expect(full.isError).not.toBe(true);
      expect(full.structuredContent).toMatchObject({
        normalized_result: {
          summary: { added: 1, removed: 0, changed: 0, unknown: 0 },
          property_inventories: expect.arrayContaining([
            expect.objectContaining({
              side: "right",
              paired: true,
              properties: expect.arrayContaining(["/depth"]),
            }),
          ]),
          changes: [
            {
              status: "added",
              path: "/depth",
              presence: { left: "absent", right: "present" },
              right: { availability: "literal", value: 1 },
            },
          ],
        },
      });
      const advertised = (await client.listTools()).tools.find(
        ({ name }) => name === "compare_javascript_export_shapes",
      );
      if (advertised?.outputSchema === undefined)
        throw new Error("Missing advertised export-shape output schema");
      const validate = new Ajv2020({
        strict: false,
        validateFormats: false,
      }).compile(
        z.record(z.string(), z.unknown()).parse(advertised.outputSchema),
      );
      expect(validate(full.structuredContent)).toBe(true);
      expect(session.exportEvidenceBundle().records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "compare_javascript_export_shapes",
            predicate_type: "rea.javascript-export-shape-comparison",
          }),
        ]),
      );

      const analyzed = javascriptApplicationAnalysisResultSchema.parse(
        left.value.normalized_result,
      );
      const seed = analyzed.semantic_graph.relations[0]?.source_node_id;
      if (seed === undefined)
        throw new TypeError("Expected at least one semantic relation");
      const semantic = await client.callTool({
        name: "trace_javascript_semantics",
        arguments: {
          application: left.value,
          query: {
            seed: { kind: "semantic-node", node_id: seed },
            direction: "forward-influence",
            include_ambiguous_dynamic_edges: true,
          },
        },
      });
      expect(semantic.isError).not.toBe(true);
      expect(semantic.structuredContent).toMatchObject({
        normalized_result: {
          source_evidence_id: left.value.evidence_id,
          source_graph_id: analyzed.semantic_graph.graph_id,
          summary: { total_seed_matches: 1 },
        },
      });
    } finally {
      await harness.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("repeated partial export comparisons", () => {
  it.each(["inline", "retained"] as const)(
    "retains distinct partial comparisons and idempotent concurrent repeats with %s Evidence",
    async (mode) => {
      const pairs = await Promise.all(
        Array.from({ length: 4 }, async (_, index) => {
          const source = `export default function make() {
            const result = { kind: "record-${index}", count: 1 };
            delete result.count;
            return result;
          }
          export { make as named };`;
          const [left, right] = await Promise.all([
            analyzeSourceEvidence(source),
            analyzeSourceEvidence(source),
          ]);
          return { left, right };
        }),
      );
      const { client, session, close } = await createApplicationMcpHarness();
      onTestFinished(close);
      if (mode === "retained")
        for (const { left, right } of pairs)
          for (const evidence of [left, right])
            expect(session.recordEvidence(evidence).ok).toBe(true);
      const compare = async (
        pair: (typeof pairs)[number],
        exportName = "default",
      ) => {
        const response = await client.callTool({
          name: "compare_javascript_export_shapes",
          arguments: {
            left:
              mode === "inline"
                ? pair.left
                : {
                    kind: "retained-evidence",
                    evidence_id: pair.left.evidence_id,
                  },
            right:
              mode === "inline"
                ? pair.right
                : {
                    kind: "retained-evidence",
                    evidence_id: pair.right.evidence_id,
                  },
            left_module_path: "parser.mjs",
            left_export_name: exportName,
            right_module_path: "parser.mjs",
            right_export_name: exportName,
          },
        });
        expect(response.isError, JSON.stringify(response)).not.toBe(true);
        const evidence = parseEvidence(response.structuredContent);
        expect(evidence.normalized_result).toMatchObject({
          changes: [],
          coverage: { status: "partial" },
        });
        return evidence.evidence_id;
      };
      const [firstPair, secondPair, ...remaining] = pairs;
      if (firstPair === undefined || secondPair === undefined)
        throw new Error("Expected distinct comparison fixtures");
      const firstId = await compare(firstPair);
      const firstUnknowns = session.listUnknowns({
        domain: "javascript-export-shape",
      });
      expect(firstUnknowns).toHaveLength(1);
      const secondId = await compare(secondPair);
      expect(secondId).not.toBe(firstId);
      const selectedId = await compare(firstPair, "named");
      expect(selectedId).not.toBe(firstId);
      const concurrentIds = await Promise.all(
        [firstPair, secondPair, ...remaining, ...remaining].map((pair) =>
          compare(pair),
        ),
      );
      expect(concurrentIds.slice(0, 2)).toEqual([firstId, secondId]);
      const evidenceIds = new Set([
        firstId,
        secondId,
        selectedId,
        ...concurrentIds,
      ]);
      expect(evidenceIds.size).toBe(pairs.length + 1);
      const unknowns = session.listUnknowns({
        domain: "javascript-export-shape",
      });
      expect(unknowns).toHaveLength(pairs.length + 1);
      expect(unknowns).toEqual(expect.arrayContaining(firstUnknowns));
      expect(
        new Set(
          unknowns.flatMap(
            ({ supporting_evidence_ids }) => supporting_evidence_ids,
          ),
        ),
      ).toEqual(evidenceIds);
      expect(unknowns.every(({ revision }) => revision === 1)).toBe(true);
      const records = session.exportEvidenceBundle().records;
      for (const id of evidenceIds)
        expect(records.some(({ evidence_id }) => evidence_id === id)).toBe(
          true,
        );
      const retained = session.exportEvidenceBundle();
      await Promise.all(pairs.map((pair) => compare(pair)));
      expect(session.exportEvidenceBundle()).toEqual(retained);
    },
  );
});

describe("source-produced export comparison inventories", () => {
  it("records partial comparison coverage even when matching unknown projections produce no changes", async () => {
    const source = `export default function make() {
      const result = { kind: "record", count: 1 };
      delete result.count;
      return result;
    }`;
    const [left, right] = await Promise.all([
      analyzeSourceEvidence(source),
      analyzeSourceEvidence(source),
    ]);
    const { client, session, close } = await createApplicationMcpHarness();
    onTestFinished(close);
    const response = await client.callTool({
      name: "compare_javascript_export_shapes",
      arguments: {
        left,
        right,
        left_module_path: "parser.mjs",
        left_export_name: "default",
        right_module_path: "parser.mjs",
        right_export_name: "default",
      },
    });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      normalized_result: {
        changes: [],
        summary: { added: 0, removed: 0, changed: 0, unknown: 0 },
        coverage: { status: "partial" },
      },
    });
    const { evidence_id: evidenceId } = z
      .object({ evidence_id: z.string() })
      .parse(response.structuredContent);
    expect(session.exportEvidenceBundle().unknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: "javascript-export-shape",
          supporting_evidence_ids: [evidenceId],
        }),
      ]),
    );
  });

  it("retains large source-produced export inventories through comparison schemas", async () => {
    const fields = Array.from(
      { length: 64 },
      (_, index) => `field${String(index)}: ${String(index)}`,
    ).join(", ");
    const returnSites = Array.from(
      { length: 33 },
      (_, index) =>
        `if (value === ${String(index)}) return { type: "variant-${String(index)}", ${fields} };`,
    ).join("\n");
    const extraExports = Array.from(
      { length: 1_000 },
      (_, index) =>
        `export const candidate${String(index)} = ${String(index)};`,
    ).join("\n");
    const inventorySource = `export default function parse(value) {\n${returnSites}\n  throw new Error("no match");\n}\n${extraExports}`;
    const pairedVariantsSource = `export default function parse(value) {
${returnSites}
  throw new Error("no match");
}`;
    const [inventoryLeft, inventoryRight] = await Promise.all([
      analyzeSourceEvidence(inventorySource),
      analyzeSourceEvidence(pairedVariantsSource),
    ]);
    const variants = compareEvidence(inventoryLeft, inventoryRight);
    expect(variants.left).toMatchObject({ status: "selected" });
    expect(variants.coverage).toMatchObject({
      paired_variants: 33,
      unpaired_left_variants: 0,
      unpaired_right_variants: 0,
      left_source_omitted_variants: 0,
      right_source_omitted_variants: 0,
      left_omitted_fields: 0,
      right_omitted_fields: 0,
    });

    const missing = compareEvidence(inventoryLeft, inventoryRight, {
      leftExportName: "missing",
    });
    expect(missing.left).toMatchObject({
      status: "missing",
      omitted_candidates: 0,
    });
    expect(missing.left.candidates).toHaveLength(1_001);

    const changedFieldsLeft = Array.from(
      { length: 10_001 },
      (_, index) => `field${String(index)}: ${String(index)}`,
    ).join(", ");
    const changedFieldsRight = Array.from(
      { length: 10_001 },
      (_, index) => `field${String(index)}: ${String(index + 1)}`,
    ).join(", ");
    const [changeLeft, changeRight] = await Promise.all([
      analyzeSourceEvidence(
        `export default () => ({ type: "record", ${changedFieldsLeft} });`,
      ),
      analyzeSourceEvidence(
        `export default () => ({ type: "record", ${changedFieldsRight} });`,
      ),
    ]);
    const changes = compareEvidence(changeLeft, changeRight);
    expect(changes.changes).toHaveLength(10_001);
    expect(changes.summary).toEqual({
      added: 0,
      removed: 0,
      changed: 10_001,
      unknown: 0,
    });
    expect(changes.coverage).toMatchObject({
      status: "complete-within-inputs",
      omitted_changes: 0,
      left_omitted_fields: 0,
      right_omitted_fields: 0,
    });
  }, 30_000);
});

const analyzeSourceEvidence = async (source: string) => {
  const root = await createTestTempDirectory("rea-export-shape-inventory-");
  await writeFile(join(root, "parser.mjs"), source);
  const analyzed = await analyzeJavaScriptApplication({ input_path: root });
  if (!analyzed.ok) throw analyzed.error;
  return analyzed.value;
};

const compareEvidence = (
  left: Awaited<ReturnType<typeof analyzeSourceEvidence>>,
  right: Awaited<ReturnType<typeof analyzeSourceEvidence>>,
  selectors: { readonly leftExportName?: string } = {},
) => {
  const compared = compareJavaScriptExportShapesEvidence({
    left,
    right,
    left_module_path: "parser.mjs",
    left_export_name: selectors.leftExportName ?? "default",
    right_module_path: "parser.mjs",
    right_export_name: "default",
  });
  if (!compared.ok) throw compared.error;
  return compared.value.result;
};

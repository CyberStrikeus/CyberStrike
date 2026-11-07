import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { sourceToBundleComparisonResultSchema } from "../../../src/domain/javascript/sourceToBundleComparisonSchemas.js";
import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { importReferenceSource } from "../../support/referenceSourceResourceScope.js";
import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";

const schemaValidation = createMcpSchemaValidation();
afterAll(() => schemaValidation.clear());

it.each(["full", "compact"] as const)(
  "selects real source-map correspondence with stable identities and full parent retention (%s)",
  async (profile) => {
    const { root, path, reference, session, client, inputs, call } =
      await comparisonFixture(profile);
    const parent = await call("compare_source_to_bundle", inputs);
    const full = sourceToBundleComparisonResultSchema.parse(
      parent.normalized_result,
    );
    expect(full.summary).toMatchObject({ split: 1, unknown: 2 });
    // Static source-to-bundle mappings are inferences; no view may strengthen them.
    expect(parent.confidence).toBe("inferred");
    const fileParent = await call("compare_source_to_bundle", {
      ...inputs,
      reference: { kind: "file", path },
    });
    expect(fileParent.normalized_result).toEqual(parent.normalized_result);
    expect(fileParent.parameters.reference_source).toEqual({
      kind: "file",
      path,
      requested_path: path,
    });
    expect(fileParent.evidence_id).not.toBe(parent.evidence_id);
    const secondPath = join(root, "same-graph.json");
    await writeFile(secondPath, JSON.stringify(reference.value));
    const secondParent = await call("compare_source_to_bundle", {
      ...inputs,
      reference: { kind: "file", path: secondPath },
    });
    expect(secondParent.normalized_result).toEqual(parent.normalized_result);
    expect(secondParent.evidence_id).not.toBe(fileParent.evidence_id);
    const summary = await call("compare_source_to_bundle", {
      ...inputs,
      view: { kind: "summary" },
    });
    expect(summary.confidence).toBe("inferred");
    expect(summary.normalized_result).toMatchObject({
      kind: "summary",
      parent_evidence_id: parent.evidence_id,
      summary: { summary: full.summary, source_coverage: full.coverage },
    });
    const { tools } = await client.listTools();
    const ajv = schemaValidation.assertions;
    const comparisonTool = tools.find(
      (tool) => tool.name === "compare_source_to_bundle",
    )!;
    const viewTool = tools.find(
      (tool) => tool.name === "inspect_analysis_view",
    )!;
    for (const tool of [comparisonTool, viewTool]) {
      expect(ajv.validateSchema(tool.inputSchema)).toBe(true);
      const outputSchema: Record<string, unknown> = tool.outputSchema!;
      expect(ajv.validateSchema(outputSchema)).toBe(true);
    }
    const request = {
      kind: "source-to-bundle",
      collection: "mappings",
      source_paths: ["src/a.js"],
      fields: ["status", "candidate_count"],
      limit: 1,
    };
    expect(
      ajv.validate(comparisonTool.inputSchema, { ...inputs, view: request }),
    ).toBe(true);
    const selected = await call("compare_source_to_bundle", {
      ...inputs,
      reference: { kind: "file", path },
      view: request,
    });
    const outputSchema: Record<string, unknown> = comparisonTool.outputSchema!;
    expect(ajv.validate(outputSchema, selected)).toBe(true);
    expect(selected.confidence).toBe("inferred");
    const page = analysisViewResultSchema.parse(selected.normalized_result);
    expect(page).toMatchObject({
      kind: "source-to-bundle",
      parent_evidence_id: fileParent.evidence_id,
      source_coverage: full.coverage,
      items: [
        {
          mapping_id: full.items[0]!.mapping_id,
          source_index: 0,
          source_path: "src/a.js",
          status: "split",
          candidate_count: 2,
        },
      ],
      coverage: { total: 1, exhausted: true },
    });
    expect(session.evidenceById(fileParent.evidence_id)).toEqual(fileParent);
    const source = {
      kind: "retained-evidence",
      evidence_id: fileParent.evidence_id,
    };
    for (const view of [{ kind: "summary" }, request])
      expect(
        (await call("inspect_analysis_view", { source, view })).confidence,
      ).toBe("inferred");
    await assertRetainedPages(call, source, request, full);
    await writeFile(
      path,
      JSON.stringify({ ...reference.value, root_sha256: "0".repeat(64) }),
    );
    expect(
      (
        await client.callTool({
          name: "compare_source_to_bundle",
          arguments: { ...inputs, reference: { kind: "file", path } },
        })
      ).isError,
    ).toBe(true);
    for (const value of [
      { kind: "file", path: "relative.json" },
      { kind: "file", path: root },
      { kind: "file", path: join(root, "missing.json") },
    ])
      expect(
        (
          await client.callTool({
            name: "compare_source_to_bundle",
            arguments: { ...inputs, reference: value },
          })
        ).isError,
      ).toBe(true);
    expect(
      (
        await client.callTool({
          name: "inspect_analysis_view",
          arguments: { source, view: { ...request, fields: ["not_a_field"] } },
        })
      ).isError,
    ).toBe(true);
  },
);

const comparisonFixture = async (profile: "full" | "compact") => {
  const root = await createTestTempDirectory("rea-source-view-");
  const previous = join(root, "previous"),
    current = join(root, "current");
  await mkdir(join(previous, "src"), { recursive: true });
  await mkdir(join(previous, "src/other"), { recursive: true });
  await writeFile(
    join(previous, "src/other/a.js"),
    "export const unrelated = 3;\n",
  );
  await mkdir(join(current, "dist"), { recursive: true });
  await writeFile(join(previous, "src/a.js"), "export const value = 1;\n");
  await writeFile(
    join(previous, "src/unseen.js"),
    "export const unseen = 1;\n",
  );
  for (const name of ["one", "two"]) {
    await writeFile(
      join(current, `dist/${name}.js`),
      `var value = 2;\n//# sourceMappingURL=${name}.js.map\n`,
    );
    await writeFile(
      join(current, `dist/${name}.js.map`),
      JSON.stringify({
        version: 3,
        file: `${name}.js`,
        sources: ["../src/a.js"],
        sourcesContent: ["export const value = 2;\n"],
        names: [],
        mappings: "AAAA",
      }),
    );
  }
  await writeFile(join(previous, "src/b.js"), "export const other = 1;\n");
  await writeFile(
    join(current, "dist/three.js"),
    "var other = 2;\n//# sourceMappingURL=three.js.map\n",
  );
  await writeFile(
    join(current, "dist/three.js.map"),
    JSON.stringify({
      version: 3,
      file: "three.js",
      sources: ["../src/b.js"],
      sourcesContent: ["export const other = 2;\n"],
      names: [],
      mappings: "AAAA",
    }),
  );
  const reference = await importReferenceSource({
    root: previous,
    caller: "source-view-test",
    policy: { secretPatterns: [] },
  });
  if (!reference.ok) throw reference.error;
  const application = await analyzeJavaScriptApplication({
    input_path: current,
    max_semantic_nodes: 1,
    max_semantic_nodes_per_file: 1,
  });
  if (!application.ok) throw application.error;
  const path = join(root, "reference.json");
  await writeFile(path, JSON.stringify(reference.value));
  const session = createTestBinarySession(() => {
    throw new Error("Views must not open a native provider");
  });
  const { client } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "source-view", version: "1" },
    schemaValidator: schemaValidation,
    serverOptions: {
      environment: { ...process.env, REA_MCP_INPUT_SCHEMA_PROFILE: profile },
    },
  });
  expect(session.recordEvidence(application.value).ok).toBe(true);
  const inputs = {
    reference: reference.value,
    application: {
      kind: "retained-evidence",
      evidence_id: application.value.evidence_id,
    },
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const reply = await client.callTool({ name, arguments: args });
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    return parseEvidence(reply.structuredContent);
  };
  return { root, path, reference, session, client, inputs, call };
};

const assertRetainedPages = async (
  call: Awaited<ReturnType<typeof comparisonFixture>>["call"],
  source: Record<string, unknown>,
  request: Record<string, unknown>,
  full: ReturnType<typeof sourceToBundleComparisonResultSchema.parse>,
) => {
  const view = async (value: Record<string, unknown>) =>
    analysisViewResultSchema.parse(
      (await call("inspect_analysis_view", { source, view: value }))
        .normalized_result,
    );
  for (const selector of [
    { source_paths: [] },
    { mapping_ids: [] },
    { statuses: [] },
    { source_paths: ["Src/a.js"] },
    { offset: 100 },
  ])
    expect(
      await view({
        kind: "source-to-bundle",
        collection: "mappings",
        ...selector,
      }),
    ).toMatchObject({ items: [], coverage: { exhausted: true } });
  const identity = await view({ ...request, fields: [] });
  expect(identity).toMatchObject({
    items: [
      {
        mapping_id: full.items[0]!.mapping_id,
        source_path: "src/a.js",
        source_index: 0,
      },
    ],
  });
  if (identity.kind !== "source-to-bundle") throw new Error("Expected page");
  expect(Object.keys(identity.items[0]!)).toEqual([
    "mapping_id",
    "source_path",
    "source_index",
  ]);
  for (let offset = 0; offset < 2; offset++) {
    const candidate = full.items[0]!.candidates[offset]!;
    expect(
      await view({
        kind: "source-to-bundle",
        collection: "candidates",
        mapping_ids: [full.items[0]!.mapping_id],
        fields: ["signals"],
        offset,
        limit: 1,
      }),
    ).toMatchObject({
      items: [
        {
          mapping_id: full.items[0]!.mapping_id,
          candidate_index: offset,
          current_node_id: candidate.current_node_id,
          mapped: full.items[0]!.current_node_ids.includes(
            candidate.current_node_id,
          ),
          signals: candidate.signals,
        },
      ],
      coverage: { total: 2, next_offset: offset === 0 ? 1 : null },
    });
  }
  await assertCandidateBoundaryPages(view);
  const weak = await view({
    kind: "source-to-bundle",
    collection: "candidates",
    source_paths: ["src/other/a.js"],
    fields: ["confidence"],
  });
  expect(weak).toMatchObject({
    items: [
      { source_path: "src/other/a.js", mapped: false, confidence: "low" },
      { source_path: "src/other/a.js", mapped: false, confidence: "low" },
    ],
    coverage: { total: 2, exhausted: true },
  });
  expect(await view({ kind: "summary" })).toMatchObject({
    summary: {
      summary: full.summary,
      source_coverage: full.coverage,
      unmapped_current_node_count: full.unmapped_current_node_ids.length,
    },
  });
};

const assertCandidateBoundaryPages = async (
  view: (
    value: Record<string, unknown>,
  ) => Promise<ReturnType<typeof analysisViewResultSchema.parse>>,
) => {
  const boundary = await view({
    kind: "source-to-bundle",
    collection: "candidates",
    fields: [],
    offset: 1,
    limit: 3,
  });
  expect(boundary).toMatchObject({
    items: [
      {
        source_path: "src/a.js",
        source_index: 0,
        candidate_index: 1,
        mapped: true,
      },
      {
        source_path: "src/b.js",
        source_index: 1,
        candidate_index: 0,
        mapped: true,
      },
      {
        source_path: "src/other/a.js",
        source_index: 2,
        candidate_index: 0,
        mapped: false,
      },
    ],
    coverage: { total: 5, next_offset: 4, exhausted: false },
  });
  expect(
    await view({
      kind: "source-to-bundle",
      collection: "candidates",
      source_paths: ["src/a.js", "src/b.js"],
      fields: [],
      offset: 1,
      limit: 2,
    }),
  ).toMatchObject({
    items: [
      { source_path: "src/a.js", source_index: 0, candidate_index: 1 },
      { source_path: "src/b.js", source_index: 1, candidate_index: 0 },
    ],
    coverage: { total: 3, next_offset: null, exhausted: true },
  });
};

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";

import { createApplicationMcpHarness } from "../fixtures/applicationMcpHarness.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { closeCliResources, createCli } from "../../src/cli.js";
import { createEvidence, parseEvidence } from "../../src/domain/evidence.js";
import type { JsonValue } from "../../src/domain/jsonValue.js";
import { analysisCliErrorEnvelopeSchema } from "../../src/contracts/errorSchemas.js";
import { toolContract } from "../../src/contracts/toolContracts.js";
import { javascriptApplicationAnalysisResultSchema } from "../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { javaScriptSemanticTraceResultSchema } from "../../src/domain/javascript/javascriptSemanticTraceSchemas.js";
import { resolveJavaScriptSemanticEvidence } from "../../src/domain/javascript/javascriptSemanticGraph.js";

const SEMANTIC_GRAPH_ID = `jsrg_${"0".repeat(64)}`;

// In-process serve keeps the CLI worker for this file. Stop it before the
// worker process exits so the private runtime root is not left behind.
afterAll(closeCliResources);

it("reports invalid nested semantic graph Evidence as caller input through CLI and SDK MCP", async () => {
  const root = await createTestTempDirectory("rea-semantic-trace-input-");
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src", "main.js"),
    "export function parse(value) { return JSON.parse(value); }\n",
  );

  const cli = createCli({});
  const analyzed = await serveCli(cli, [
    "analyze-javascript-application",
    root,
    "--json",
  ]);
  expect(analyzed.exitCode).toBe(0);
  const sourceEvidence = parseEvidence(JSON.parse(analyzed.stdout));
  const normalizedResult = structuredClone(sourceEvidence.normalized_result);
  if (!isJsonObject(normalizedResult))
    throw new Error("CLI analysis result must be an object");
  const semanticGraph = normalizedResult.semantic_graph;
  if (!isJsonObject(semanticGraph))
    throw new Error("CLI analysis must include a semantic graph");
  const firstNode = semanticGraph.nodes;
  if (!Array.isArray(firstNode) || !isJsonObject(firstNode[0]))
    throw new Error("CLI semantic graph must include a node");
  const seedNodeId = firstNode[0].node_id;
  if (typeof seedNodeId !== "string")
    throw new Error("CLI semantic graph node must have an identifier");
  semanticGraph.graph_id = SEMANTIC_GRAPH_ID;

  const subject = sourceEvidence.subject;
  if (subject === null) throw new Error("CLI Evidence must include a subject");
  const malformedEvidence = createEvidence(
    {
      path: subject.local_path,
      sha256: subject.digest.sha256,
      format: subject.format,
      ...(subject.architecture === null
        ? {}
        : { architecture: subject.architecture }),
    },
    sourceEvidence.provider,
    {
      predicateType: sourceEvidence.predicate_type,
      operation: sourceEvidence.operation,
      parameters: sourceEvidence.parameters,
      result: normalizedResult,
      confidence: sourceEvidence.confidence,
      authority: sourceEvidence.authority,
    },
  );
  expect(malformedEvidence.evidence_id).not.toBe(sourceEvidence.evidence_id);

  const arguments_ = {
    application: malformedEvidence,
    query: {
      seed: { kind: "semantic-node", node_id: seedNodeId },
      direction: "backward-provenance",
    },
  };
  const cliTrace = await serveCli(cli, [
    "trace-javascript-semantics",
    JSON.stringify(arguments_),
    "--json",
  ]);
  const cliEnvelope = analysisCliErrorEnvelopeSchema.parse(
    JSON.parse(cliTrace.stdout),
  );
  const { error: _label, ...cliError } = cliEnvelope;
  expect(cliError).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    details: {
      issues: [
        {
          path: [
            "application",
            "normalized_result",
            "semantic_graph",
            "graph_id",
          ],
          reason: "invalid_value",
        },
      ],
    },
  });

  const harness = await createApplicationMcpHarness();
  try {
    await assertSuccessfulTraceParity(
      cli,
      harness,
      sourceEvidence,
      arguments_.query,
    );

    const mcpTrace = await harness.client.callTool({
      name: "trace_javascript_semantics",
      arguments: arguments_,
    });
    const { error: mcpError } = parseMcpToolError(mcpTrace);
    expect(mcpError).toEqual(cliError);
  } finally {
    await harness.close();
  }
});

it("excludes local exports from writes-only traces through CLI and MCP", async () => {
  const root = await createTestTempDirectory("rea-semantic-export-trace-");
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src", "main.js"),
    [
      "const answer = 42;",
      "export { answer, answer as result };",
      "let mutable = 0;",
      "mutable = 1;",
      "export { mutable };",
    ].join("\n"),
  );

  const cli = createCli({});
  const analyzed = await serveCli(cli, [
    "analyze-javascript-application",
    root,
    "--json",
  ]);
  expect(analyzed.exitCode).toBe(0);
  const application = parseEvidence(JSON.parse(analyzed.stdout));
  const analysisResult = javascriptApplicationAnalysisResultSchema.parse(
    application.normalized_result,
  );
  const bindingId = (label: string): string => {
    const binding = analysisResult.semantic_graph.nodes.find(
      (node) => node.kind === "binding" && node.label === label,
    );
    if (binding === undefined)
      throw new Error(`CLI semantic graph must include the ${label} binding`);
    return binding.node_id;
  };

  const harness = await createApplicationMcpHarness();
  try {
    const exportTrace = await assertSuccessfulTraceParity(
      cli,
      harness,
      application,
      {
        seed: { kind: "semantic-node", node_id: bindingId("answer") },
        direction: "backward-provenance",
        allowed_relations: ["writes"],
      },
    );
    expect(exportTrace.summary).toMatchObject({
      total_seed_matches: 1,
      traversed_relations: 0,
    });
    expect(exportTrace.relations).toEqual([]);

    const assignmentTrace = await assertSuccessfulTraceParity(
      cli,
      harness,
      application,
      {
        seed: { kind: "semantic-node", node_id: bindingId("mutable") },
        direction: "backward-provenance",
        allowed_relations: ["writes"],
      },
    );
    expect(assignmentTrace.summary).toMatchObject({
      total_seed_matches: 1,
      traversed_relations: 1,
    });
    expect(assignmentTrace.relations).toHaveLength(1);
  } finally {
    await harness.close();
  }
});

it("traces exact empty property names through CLI and MCP", async () => {
  const root = await createTestTempDirectory("rea-semantic-empty-property-");
  await writeFile(
    join(root, "main.js"),
    "const routes = {'': 'HOME', x: 'NAMED'}; const root = routes['']; const named = routes.x;\n",
  );
  const cli = createCli({});
  const analyzed = await serveCli(cli, [
    "analyze-javascript-application",
    root,
    "--json",
  ]);
  expect(analyzed.exitCode).toBe(0);
  const application = parseEvidence(JSON.parse(analyzed.stdout));
  const { semantic_graph: graph } =
    javascriptApplicationAnalysisResultSchema.parse(
      application.normalized_result,
    );
  const harness = await createApplicationMcpHarness();
  try {
    for (const name of ["", "x"]) {
      const slots = graph.nodes.filter(
        (node) =>
          node.kind === "property-slot" && node.properties.name === name,
      );
      expect(slots).toHaveLength(1);
      const slot = slots[0];
      if (slot === undefined)
        throw new Error("Expected retained property slot");
      const exact = await assertSuccessfulTraceParity(
        cli,
        harness,
        application,
        {
          seed: { kind: "semantic-node", node_id: slot.node_id },
          direction: "forward-influence",
        },
      );
      const selected = await assertSuccessfulTraceParity(
        cli,
        harness,
        application,
        {
          seed: { kind: "property", name },
          direction: "forward-influence",
        },
      );
      expect(selected.seed_node_ids).toEqual([slot.node_id]);
      expect(selected.nodes).toEqual(exact.nodes);
      expect(selected.relations).toEqual(exact.relations);
      expect(selected.nodes).toHaveLength(2);
      expect(selected.relations).toHaveLength(1);
      expect(selected.coverage.status).toBe("partial");
    }
    const absent = await assertSuccessfulTraceParity(
      cli,
      harness,
      application,
      {
        seed: { kind: "property", name: "missing" },
        direction: "forward-influence",
      },
    );
    expect(absent.seed_node_ids).toEqual([]);
    expect(absent.nodes).toEqual([]);
    expect(absent.relations).toEqual([]);
    expect(absent.coverage.status).toBe("partial");
  } finally {
    await harness.close();
  }
});

it("traces transformed operands through CLI and advertised MCP output", async () => {
  const root = await createTestTempDirectory("rea-semantic-expression-trace-");
  await writeFile(
    join(root, "main.js"),
    'const base = "https://example.test"; const url = base + "/x"; fetch(url); consume("only-direct"); const nested = "nested-token"; const box = { url: wrap(nested + "/x") };',
  );
  const cli = createCli({});
  const analyzed = await serveCli(cli, [
    "analyze-javascript-application",
    root,
    "--json",
  ]);
  expect(analyzed.exitCode, analyzed.stdout).toBe(0);
  const application = parseEvidence(JSON.parse(analyzed.stdout));
  const harness = await createApplicationMcpHarness();
  try {
    const result = await assertSuccessfulTraceParity(
      cli,
      harness,
      application,
      {
        seed: { kind: "literal", value: "https://example.test" },
        direction: "forward-influence",
      },
    );
    expect(result.nodes.map((node) => node.label)).toContain("argument 0");
    expect(
      result.relations.some((edge) => edge.relation === "influences"),
    ).toBe(true);
    const direct = await assertSuccessfulTraceParity(
      cli,
      harness,
      application,
      {
        seed: { kind: "literal", value: "only-direct" },
        direction: "forward-influence",
      },
    );
    expect(direct.summary.total_seed_matches).toBe(1);
    expect(
      direct.nodes.find((node) => node.node_id === direct.seed_node_ids[0])
        ?.label,
    ).toBe("argument 0");
    const nested = await assertSuccessfulTraceParity(
      cli,
      harness,
      application,
      {
        seed: { kind: "literal", value: "nested-token" },
        direction: "forward-influence",
      },
    );
    expect(nested.status).not.toBe("found");
    expect(nested.unknowns.map((unknown) => unknown.detail)).toContain(
      "The dynamic call's return dependency on this argument is unknown.",
    );
  } finally {
    await harness.close();
  }
});

it("reports offered semantic capacity when a large template exceeds it", async () => {
  const root = await createTestTempDirectory("rea-semantic-expression-budget-");
  const expressions = Array.from({ length: 500 }, () => "${base}").join("");
  await writeFile(
    join(root, "main.js"),
    `const base = "token"; const value = \`${expressions}\`;`,
  );
  const analyzed = await serveCli(createCli({}), [
    "analyze-javascript-application",
    root,
    "--max-semantic-nodes-per-file",
    "4",
    "--json",
  ]);
  expect(analyzed.exitCode, analyzed.stdout).toBe(0);
  const application = parseEvidence(JSON.parse(analyzed.stdout));
  const result = javascriptApplicationAnalysisResultSchema.parse(
    application.normalized_result,
  );
  expect(result.semantic_graph.coverage.truncated).toBe(true);
  expect(result.semantic_graph.coverage.status).toBe("partial");
});

const assertSuccessfulTraceParity = async (
  cli: ReturnType<typeof createCli>,
  harness: Awaited<ReturnType<typeof createApplicationMcpHarness>>,
  application: ReturnType<typeof parseEvidence>,
  query: {
    readonly seed: unknown;
    readonly direction: string;
    readonly allowed_relations?: readonly string[];
  },
): Promise<ReturnType<typeof javaScriptSemanticTraceResultSchema.parse>> => {
  const arguments_ = { application, query };
  const cliResponse = await serveCli(cli, [
    "trace-javascript-semantics",
    JSON.stringify(arguments_),
    "--json",
  ]);
  expect(cliResponse.exitCode, cliResponse.stdout).toBe(0);
  expect(JSON.parse(cliResponse.stdout), cliResponse.stdout).not.toHaveProperty(
    "error",
  );
  const cliEvidence = parseEvidence(JSON.parse(cliResponse.stdout));
  const cliResult = javaScriptSemanticTraceResultSchema.parse(
    cliEvidence.normalized_result,
  );
  expect(cliEvidence.parameters.query).toMatchObject({
    seed: query.seed,
    direction: query.direction,
    include_ambiguous_dynamic_edges: false,
    expected: null,
  });
  if (query.allowed_relations === undefined)
    expect(cliEvidence.parameters.query).not.toHaveProperty(
      "allowed_relations",
    );
  else
    expect(cliEvidence.parameters.query).toHaveProperty(
      "allowed_relations",
      query.allowed_relations,
    );

  assertTraceContextsResolve(cliResult);

  const mcpResponse = await harness.client.callTool({
    name: "trace_javascript_semantics",
    arguments: arguments_,
  });
  expect(mcpResponse.isError).not.toBe(true);
  const { tools } = await harness.client.listTools();
  const advertised = tools.find(
    ({ name }) => name === "trace_javascript_semantics",
  );
  if (advertised?.outputSchema === undefined)
    throw new Error("Semantic trace SDK output schema is missing");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const outputSchema: Record<string, unknown> = advertised.outputSchema;
  expect(ajv.validateSchema(outputSchema)).toBe(true);
  expect(ajv.validate(outputSchema, mcpResponse.structuredContent)).toBe(true);
  const mcpEvidence = toolContract(
    "trace_javascript_semantics",
  ).outputSchema.parse(mcpResponse.structuredContent);
  expect(mcpEvidence.normalized_result).toEqual(cliResult);
  expect(mcpEvidence).toEqual(cliEvidence);
  return cliResult;
};

const assertTraceContextsResolve = (
  result: ReturnType<typeof javaScriptSemanticTraceResultSchema.parse>,
): void => {
  const contexts = new Map(
    result.evidence_contexts.map((context) => [context.context_id, context]),
  );
  const references = [
    ...result.nodes.map(({ evidence }) => evidence),
    ...result.relations.map(({ evidence }) => evidence),
    ...result.unknowns.map(({ evidence }) => evidence),
  ];
  const referencedIds = new Set<string>();
  for (const reference of references) {
    const context = contexts.get(reference.context_id);
    expect(context, reference.context_id).toBeDefined();
    if (context === undefined) continue;
    referencedIds.add(reference.context_id);
    expect(
      resolveJavaScriptSemanticEvidence(
        { evidence_contexts: result.evidence_contexts },
        reference,
      ),
    ).toMatchObject({
      ...Object.fromEntries(
        Object.entries(context).filter(([key]) => key !== "context_id"),
      ),
      location: reference.location,
    });
  }
  expect([...referencedIds].toSorted()).toEqual(
    [...contexts.keys()].toSorted(),
  );
};

const serveCli = async (
  cli: ReturnType<typeof createCli>,
  arguments_: readonly string[],
): Promise<{ readonly stdout: string; readonly exitCode: number }> => {
  let stdout = "";
  let exitCode = 0;
  await cli.serve([...arguments_], {
    env: {},
    exit: (code) => {
      exitCode = code;
    },
    stdout: (text) => {
      stdout += text;
    },
  });
  return { stdout, exitCode };
};

const isJsonObject = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

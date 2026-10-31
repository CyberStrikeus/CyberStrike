import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import {
  applicationFeatureSeedSchema,
  applicationFeatureTraceResultSchema,
} from "../../../src/domain/javascript/javascriptFeatureTraceSchemas.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { findApplicationFeatureSeeds } from "../../../src/domain/javascript/javascriptFeatureSeed.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  cliTest,
  runFileCli,
  type SharedMcpCall,
  type TestCli,
} from "../../support/cli/cliFixture.js";

type FeatureSeed = z.input<typeof applicationFeatureSeedSchema>;
type Trace = z.infer<typeof applicationFeatureTraceResultSchema>;
type SeedScenario = {
  readonly name: string;
  readonly seed: FeatureSeed;
  readonly expected: {
    readonly nodeId: string;
    readonly basis: "node-id" | "property";
  } | null;
};

const createSeedScenarios = (
  graph: z.infer<typeof javascriptApplicationAnalysisResultSchema>["graph"],
): SeedScenario[] => {
  const notificationRoute = graph.nodes.find(
    (node) =>
      node.kind === "endpoint" &&
      node.observations.some(
        ({ properties }) =>
          properties.endpoint_kind === "route" &&
          properties.value === "/accounts/preferences/notifications",
      ),
  );
  const tinyRoute = graph.nodes.find(
    (node) =>
      node.kind === "endpoint" &&
      node.observations.some(
        ({ properties }) =>
          properties.endpoint_kind === "route" && properties.value === "/tiny",
      ),
  );
  const labeledNode = graph.nodes.find((node) =>
    node.observations.some(
      ({ label }) => label !== null && label !== node.node_id,
    ),
  );
  if (notificationRoute === undefined || tinyRoute === undefined)
    throw new Error(
      "Expected literal route endpoints in the application graph",
    );
  if (labeledNode === undefined)
    throw new Error("Expected a labeled node in the application graph");
  const label = labeledNode.observations.find(
    ({ label: value }) => value !== null && value !== labeledNode.node_id,
  )?.label;
  if (label === undefined || label === null)
    throw new Error("Expected the selected graph node to have a display label");

  const id = labeledNode.node_id;
  return [
    {
      name: "node ID contains prefix",
      seed: { kind: "node-id", value: id.slice(0, 24), match: "contains" },
      expected: { nodeId: id, basis: "node-id" },
    },
    {
      name: "node ID exact ignores case by default",
      seed: { kind: "node-id", value: id.toUpperCase(), match: "exact" },
      expected: { nodeId: id, basis: "node-id" },
    },
    {
      name: "node ID exact can be case sensitive",
      seed: {
        kind: "node-id",
        value: id.toUpperCase(),
        match: "exact",
        case_sensitive: true,
      },
      expected: null,
    },
    {
      name: "node ID never falls back to a display label",
      seed: { kind: "node-id", value: label, match: "exact" },
      expected: null,
    },
    {
      name: "generated route label exact",
      seed: {
        kind: "route",
        value: "route endpoint",
        match: "exact",
        case_sensitive: true,
      },
      expected: null,
    },
    {
      name: "generated route label substring",
      seed: { kind: "route", value: "route", match: "contains" },
      expected: null,
    },
    {
      name: "preserved long route exact",
      seed: {
        kind: "route",
        value: "/accounts/preferences/notifications",
        match: "exact",
      },
      expected: { nodeId: notificationRoute.node_id, basis: "property" },
    },
    {
      name: "preserved route substring",
      seed: {
        kind: "route",
        value: "/accounts/preferences",
        match: "contains",
      },
      expected: { nodeId: notificationRoute.node_id, basis: "property" },
    },
    {
      name: "short preserved route exact",
      seed: { kind: "route", value: "/tiny", match: "exact" },
      expected: { nodeId: tinyRoute.node_id, basis: "property" },
    },
  ];
};

const analyzeFixture = async (cli: TestCli, root: string) => {
  const response = await cli.run({
    arguments: [
      "analyze-javascript-application",
      root,
      "--artifact-format",
      "directory",
      "--json",
    ],
  });
  expect(response.exitCode).toBe(0);
  const evidence = toolContract(
    "analyze_javascript_application",
  ).outputSchema.parse(response.json);
  return {
    evidence,
    result: javascriptApplicationAnalysisResultSchema.parse(
      evidence.normalized_result,
    ),
  };
};

const traceThroughCli = async (
  cli: TestCli,
  application: unknown,
  scenario: Pick<SeedScenario, "name" | "seed">,
) => {
  const root = await createTestTempDirectory("rea-feature-seed-request-");
  const input = join(root, "trace.json");
  await writeFile(
    input,
    JSON.stringify({ application, seed: scenario.seed, direction: "both" }),
  );
  const invocation = {
    arguments: ["trace-application-feature", input, "--json"],
  };
  const response = await runFileCli(cli, invocation);
  expect(response.exitCode, `${scenario.name} via CLI`).toBe(0);
  const evidence = toolContract("trace_application_feature").outputSchema.parse(
    response.json,
  );
  return {
    evidence,
    result: applicationFeatureTraceResultSchema.parse(
      evidence.normalized_result,
    ),
  };
};

const traceThroughMcp = async (
  call: SharedMcpCall,
  application: unknown,
  scenario: Pick<SeedScenario, "name" | "seed">,
) => {
  const response = await call("trace_application_feature", {
    application,
    seed: scenario.seed,
    direction: "both",
  });
  expect(response.isError, `${scenario.name} via MCP`).not.toBe(true);
  const evidence = toolContract("trace_application_feature").outputSchema.parse(
    response.structuredContent,
  );
  return {
    evidence,
    result: applicationFeatureTraceResultSchema.parse(
      evidence.normalized_result,
    ),
  };
};

const expectTrace = (trace: Trace, scenario: SeedScenario): void => {
  if (scenario.expected === null) {
    expect(trace.seed_matches).toEqual([]);
    expect(trace.summary.matched_seeds).toBe(0);
    expect(trace.coverage.status).toBe("no-match");
    return;
  }
  expect(trace.seed_matches).toHaveLength(1);
  expect(trace.seed_matches[0]).toMatchObject({
    node_id: scenario.expected.nodeId,
    basis: scenario.expected.basis,
  });
  expect(trace.summary.matched_seeds).toBe(1);
  expect(trace.coverage.status).toBe("complete-within-source");
  if (scenario.seed.kind === "node-id")
    expect(trace.seed_matches[0]).toMatchObject({
      basis: "node-id",
      field: "node_id",
    });
  else
    expect(trace.seed_matches[0]?.field).toMatch(
      /\.properties\.(value|path)$/u,
    );
};

cliTest(
  "discovers and traces direct call argument literals",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-call-literal-");
    await writeFile(
      join(root, "module.js"),
      'client.rpc("proc_named", 7, false, unknown);\n',
    );
    const { evidence, result } = await analyzeFixture(cli, root);
    const callSite = result.semantic_graph.nodes.find(
      (node) =>
        node.kind === "call-site" &&
        Array.isArray(node.properties.arguments) &&
        node.properties.arguments.some(
          (entry) =>
            entry !== null &&
            typeof entry === "object" &&
            !Array.isArray(entry) &&
            entry.value === "proc_named",
        ),
    );
    if (callSite === undefined)
      throw new Error("Expected retained call argument");
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected MCP session");
    const feature = await call("trace_application_feature", {
      application: evidence,
      seed: { kind: "string", value: "proc_named", match: "exact" },
      direction: "both",
    });
    expect(feature.isError).not.toBe(true);
    const featureEvidence = toolContract(
      "trace_application_feature",
    ).outputSchema.parse(feature.structuredContent);
    const trace = applicationFeatureTraceResultSchema.parse(
      featureEvidence.normalized_result,
    );
    expect(trace.semantic_discovery?.matches).toContainEqual({
      node_id: callSite.node_id,
      kind: "call-site",
      trace_seed: { kind: "semantic-node", node_id: callSite.node_id },
    });
    const semantic = await call("trace_javascript_semantics", {
      application: evidence,
      query: {
        seed: { kind: "literal", value: "proc_named" },
        direction: "forward-influence",
      },
    });
    expect(semantic.isError).not.toBe(true);
    const semanticEvidence = toolContract(
      "trace_javascript_semantics",
    ).outputSchema.parse(semantic.structuredContent);
    const argument = result.semantic_graph.nodes.find(
      (node) =>
        node.kind === "expression" &&
        node.properties.literal_argument_value === "proc_named" &&
        node.properties.literal_argument_call_site_node_id === callSite.node_id,
    );
    if (argument === undefined)
      throw new Error("Expected literal argument node");
    expect(semanticEvidence.normalized_result).toMatchObject({
      seed_node_ids: expect.arrayContaining([argument.node_id]),
      nodes: expect.arrayContaining([
        expect.objectContaining({ node_id: callSite.node_id }),
      ]),
    });
  },
);

cliTest(
  "discovers semantic-only labels with paged CLI and MCP follow-up",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-feature-semantic-label-");
    await writeFile(
      join(root, "module.js"),
      "function uniqueSemanticCandidate(uniqueSemanticCandidate) { return uniqueSemanticCandidate; }\nuniqueSemanticCandidate(1);\n",
    );
    const { evidence, result } = await analyzeFixture(cli, root);
    const seed = applicationFeatureSeedSchema.parse({
      kind: "string",
      value: "uniqueSemanticCandidate",
      match: "exact",
      case_sensitive: true,
    });
    expect(findApplicationFeatureSeeds(result.graph.nodes, seed)).toEqual([]);
    const expected = result.semantic_graph.nodes.filter(
      (node) => node.label === seed.value,
    );
    expect(expected.length).toBeGreaterThan(0);
    const request = {
      application: evidence,
      seed,
      direction: "both",
      semantic_page: { offset: 0, limit: 1 },
    };
    const input = join(root, "request.json");
    await writeFile(input, JSON.stringify(request));
    const cliResult = await cli.run({
      arguments: ["trace-application-feature", input, "--json"],
    });
    expect(cliResult.exitCode).toBe(0);
    const cliEvidence = toolContract(
      "trace_application_feature",
    ).outputSchema.parse(cliResult.json);
    const trace = applicationFeatureTraceResultSchema.parse(
      cliEvidence.normalized_result,
    );
    expect(trace.coverage.status).toBe("no-match");
    expect(trace.semantic_discovery).toMatchObject({
      source_graph_id: result.semantic_graph.graph_id,
      source_coverage: result.semantic_graph.coverage.status,
      total: expected.length,
      offset: 0,
      limit: 1,
      next_offset: expected.length > 1 ? 1 : null,
      matches: [{ node_id: expected[0]?.node_id, kind: expected[0]?.kind }],
    });
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected file MCP session");
    const mcpResult = await call("trace_application_feature", request);
    expect(mcpResult.isError).not.toBe(true);
    const mcpEvidence = toolContract(
      "trace_application_feature",
    ).outputSchema.parse(mcpResult.structuredContent);
    expect(mcpEvidence.normalized_result).toEqual(trace);
    const afterFirst = await call("trace_application_feature", {
      ...request,
      semantic_page: { offset: 1, limit: 1 },
    });
    expect(afterFirst.isError).not.toBe(true);
    const afterFirstEvidence = toolContract(
      "trace_application_feature",
    ).outputSchema.parse(afterFirst.structuredContent);
    const afterFirstTrace = applicationFeatureTraceResultSchema.parse(
      afterFirstEvidence.normalized_result,
    );
    expect(afterFirstTrace.semantic_discovery).toMatchObject({
      total: expected.length,
      offset: 1,
      matches: expected
        .slice(1, 2)
        .map(({ node_id, kind }) => ({ node_id, kind })),
    });
    const match = trace.semantic_discovery?.matches[0];
    if (match === undefined) throw new Error("Expected semantic match");
    const semantic = await call("trace_javascript_semantics", {
      application: evidence,
      query: { seed: match.trace_seed, direction: "backward-provenance" },
    });
    expect(semantic.isError).not.toBe(true);
    const semanticEvidence = toolContract(
      "trace_javascript_semantics",
    ).outputSchema.parse(semantic.structuredContent);
    expect(semanticEvidence.normalized_result).toMatchObject({
      seed_node_ids: [match.node_id],
    });
  },
);

cliTest(
  "matches feature seeds against node IDs and preserved route values through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-feature-seed-selection-");
    await writeFile(
      join(root, "routes.js"),
      `const notificationRoute = { path: "/accounts/preferences/notifications" };\nconst tinyRoute = { path: "/tiny" };\nmodule.exports = { notificationRoute, tinyRoute };\n`,
    );
    const { evidence, result } = await analyzeFixture(cli, root);
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected file MCP session");
    for (const scenario of createSeedScenarios(result.graph)) {
      const { result: cliTrace } = await traceThroughCli(
        cli,
        evidence,
        scenario,
      );
      const { result: mcpTrace } = await traceThroughMcp(
        call,
        evidence,
        scenario,
      );
      expectTrace(cliTrace, scenario);
      expectTrace(mcpTrace, scenario);
      expect(mcpTrace.seed_matches).toEqual(cliTrace.seed_matches);
      expect(mcpTrace.coverage).toEqual(cliTrace.coverage);
    }
  },
);

cliTest(
  "normalizes API seed defaults before deriving matching and missing trace identities through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-feature-seed-defaults-");
    await writeFile(
      join(root, "preload.js"),
      `
      const { contextBridge } = require("electron");
      contextBridge.exposeInMainWorld("desktop", { openProject: () => true });
    `,
    );
    const { evidence } = await analyzeFixture(cli, root);
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected file MCP session");
    for (const value of ["openProject", "missingProject"]) {
      const omitted = { name: value, seed: { kind: "api" as const, value } };
      const explicit = {
        ...omitted,
        seed: { ...omitted.seed, match: null, case_sensitive: false },
      };
      const omittedCli = await traceThroughCli(cli, evidence, omitted);
      const explicitCli = await traceThroughCli(cli, evidence, explicit);
      const omittedMcp = await traceThroughMcp(call, evidence, omitted);
      const explicitMcp = await traceThroughMcp(call, evidence, explicit);
      expect(omittedCli, value).toEqual(explicitCli);
      expect(omittedMcp, value).toEqual(explicitMcp);
      expect(omittedMcp, value).toEqual(omittedCli);
      expect(omittedCli.result.seed).toEqual(explicit.seed);
      if (value === "openProject")
        expect(omittedCli.result.summary.matched_seeds).toBeGreaterThan(0);
      else {
        expect(omittedCli.result.summary.matched_seeds).toBe(0);
        expect(omittedCli.result.coverage.status).toBe("no-match");
      }
    }
  },
);

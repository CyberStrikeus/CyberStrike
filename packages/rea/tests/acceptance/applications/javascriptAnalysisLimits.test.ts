import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";

import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";
import { parseEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type SharedMcpCall } from "../../support/cli/cliFixture.js";

const cases = [
  {
    name: "both limits",
    args: ["--max-heap-mb", "128", "--analysis-timeout-ms", "30000"],
    controls: { max_heap_mb: 128, analysis_timeout_ms: 30000 },
  },
  {
    name: "heap limit alone",
    args: ["--max-heap-mb", "256"],
    controls: { max_heap_mb: 256 },
  },
  {
    name: "timeout alone",
    args: ["--analysis-timeout-ms", "40000"],
    controls: { analysis_timeout_ms: 40000 },
  },
  {
    name: "omitted limits",
    args: [],
    controls: {},
  },
];

cliTest(
  "names the server deadline control in CLI timeout recovery",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-js-cli-timeout-recovery-");
    await writeFile(join(root, "main.js"), "export const observed = 7;\n");
    const response = await cli.run({
      arguments: [
        "analyze-javascript-application",
        root,
        "--max-heap-mb",
        "128",
        "--analysis-timeout-ms",
        "1",
        "--format",
        "json",
      ],
      environment: { NODE_OPTIONS: "--max-old-space-size=512" },
    });
    expect(response.exitCode).not.toBe(0);
    expect(response.json).toMatchObject({
      error: "JavaScript application analysis failed",
      code: "provider_timeout",
      message: expect.stringContaining("analysis_timeout_ms"),
      remediation: {
        action: expect.stringContaining(
          "rea analyze-javascript-application <input_path> --analysis-timeout-ms",
        ),
      },
      recovery: { kind: "inspect_timeout_state", timeout_ms: 1 },
    });
  },
);

cliTest.for(cases)(
  "preserves $name in CLI Evidence without adding ambient defaults",
  async ({ args, controls }, { cli }) => {
    const root = await createTestTempDirectory("rea-js-limit-provenance-");
    await writeFile(join(root, "main.js"), "export const observed = 7;\n");
    const response = await cli.run({
      arguments: [
        "analyze-javascript-application",
        root,
        ...args,
        "--format",
        "json",
      ],
      environment: { NODE_OPTIONS: "--max-old-space-size=512" },
    });
    expect(response.exitCode, response.stdout + response.stderr).toBe(0);
    const evidence = parseEvidence(response.json);
    expect(evidence.parameters).toEqual({
      input_path: root,
      format: "auto",
      integrity_policy: "fail",
      ...controls,
    });
  },
);

it("preserves MCP analysis limits in retained Evidence and an exported bundle round trip", async () => {
  const root = await createTestTempDirectory("rea-js-limit-mcp-");
  await writeFile(join(root, "main.js"), "export const observed = 7;\n");
  const bundleRoot = await createTestTempDirectory("rea-js-limit-bundle-");
  const path = join(bundleRoot, "evidence.json");
  const { call } = await connectLocalToolsMcp({
    NODE_OPTIONS: "--max-old-space-size=512",
  });
  const expected = new Map<string, unknown>();
  for (const { controls } of cases) {
    const response = await call("analyze_javascript_application", {
      input_path: root,
      ...controls,
      detail: "summary",
    });
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    const { parent_evidence_id } = z
      .object({
        normalized_result: z.object({ parent_evidence_id: z.string() }),
      })
      .parse(response.structuredContent).normalized_result;
    expected.set(parent_evidence_id, {
      input_path: root,
      format: "auto",
      integrity_policy: "fail",
      ...controls,
    });
  }
  expect(expected.size).toBe(cases.length);
  const retained = await getBundle(call);
  for (const [evidence_id, parameters] of expected)
    expect(
      retained.records.find((record) => record.evidence_id === evidence_id)
        ?.parameters,
    ).toEqual(parameters);
  const exported = await call("export_evidence_bundle", { path });
  expect(exported.isError).not.toBe(true);
  expect(parseEvidenceBundle(JSON.parse(await readFile(path, "utf8")))).toEqual(
    retained,
  );
  const closed = await call("close_binary", {});
  expect(closed.isError).not.toBe(true);
  expect((await getBundle(call)).records).toEqual([]);
  const imported = await call("import_evidence_bundle", { path });
  expect(imported.isError, JSON.stringify(imported.content)).not.toBe(true);
  expect(await getBundle(call)).toEqual(retained);
}, 60_000);

cliTest(
  "retains caller limits and applicable file scopes after an actual analysis timeout",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-js-limit-timeout-");
    const sourcePaths = [
      "a.js",
      "a.js.map",
      "data.json",
      "index.html",
      "package.json",
      "z.node",
    ];
    await Promise.all(
      (
        [
          ["a.js", "export const observed = 7;\n"],
          [
            "a.js.map",
            JSON.stringify({
              version: 3,
              sources: [],
              names: [],
              mappings: "",
            }),
          ],
          ["data.json", '{"observed":7}'],
          ["index.html", '<script src="./a.js"></script>'],
          ["package.json", '{"name":"file-scope-control","main":"a.js"}'],
          ["z-excluded.js", "export const excluded = true;\n"],
          ["z.node", Buffer.from([0, 1, 2, 3])],
          ["zz-excluded.node", Buffer.from([3, 2, 1, 0])],
        ] as const
      ).map(([path, content]) => writeFile(join(root, path), content)),
    );
    const { client, call } = await connectLocalToolsMcp({
      NODE_OPTIONS: "--max-old-space-size=512",
    });
    const response = await call("analyze_javascript_application", {
      input_path: root,
      max_heap_mb: 128,
      analysis_timeout_ms: 1,
      source_paths: sourcePaths,
    });
    expect(parseMcpToolError(response)).toMatchObject({
      error: {
        code: "provider_timeout",
        message: expect.stringContaining("server/provider deadline"),
        remediation: {
          action: expect.stringContaining("MCP client"),
        },
        recovery: {
          kind: "inspect_timeout_state",
          operation: "analyze_javascript_application",
          timeout_ms: 1,
        },
      },
    });
    const bundle = await getBundle(call);
    const partial = bundle.records.find(
      (record) => record.operation === "analyze_javascript_application",
    );
    expect(partial?.parameters).toEqual({
      input_path: root,
      format: "auto",
      integrity_policy: "fail",
      max_heap_mb: 128,
      analysis_timeout_ms: 1,
      source_paths: sourcePaths,
    });
    if (partial === undefined)
      throw new Error("Timeout Evidence was not retained");
    const cliArguments = [
      "analyze-javascript-application",
      root,
      "--max-heap-mb",
      "128",
      ...sourcePaths.flatMap((path) => ["--source-path", path]),
      "--format",
      "json",
    ];
    const cliTimeout = await cli.run({
      arguments: [...cliArguments, "--analysis-timeout-ms", "1"],
    });
    expect(cliTimeout.exitCode).toBe(1);
    const cliFailure = z
      .object({
        code: z.literal("provider_timeout"),
        details: z.object({ partial_observation: z.unknown() }),
      })
      .parse(cliTimeout.json);
    const cliPartial = parseEvidence(cliFailure.details.partial_observation);
    const control = await call("analyze_javascript_application", {
      input_path: root,
      max_heap_mb: 128,
      source_paths: sourcePaths,
    });
    expect(control.isError).not.toBe(true);
    const controlEvidence = parseEvidence(control.structuredContent);
    const cliControl = await cli.run({ arguments: cliArguments });
    expect(cliControl.exitCode, cliControl.stderr).toBe(0);
    const cliControlEvidence = parseEvidence(cliControl.json);
    expect(cliControlEvidence.evidence_id).toBe(controlEvidence.evidence_id);
    // Observe both adapters and successful controls before testing applicability.
    for (const [evidence, interrupted] of [
      [partial, true],
      [cliPartial, true],
      [controlEvidence, false],
      [cliControlEvidence, false],
    ] as const)
      expectFileAnalysisApplicability(evidence, interrupted);
    await client.ping();
  },
  60_000,
);

async function getBundle(call: SharedMcpCall) {
  const response = await call("get_evidence_bundle", { detail: "complete" });
  expect(response.isError).not.toBe(true);
  return parseEvidenceBundle(
    z.object({ result: z.unknown() }).parse(response.structuredContent).result,
  );
}

function expectFileAnalysisApplicability(
  evidence: Evidence,
  interrupted: boolean,
) {
  const result = javascriptApplicationAnalysisResultSchema.parse(
    evidence.normalized_result,
  );
  const scopeObservations = result.graph.nodes
    .filter(({ kind }) => kind === "unknown")
    .flatMap(({ observations }) => observations);
  const scopes = (path: string) =>
    scopeObservations.filter(({ properties }) => properties.path === path);
  expect(result.graph.nodes.some(({ kind }) => kind === "native-addon")).toBe(
    true,
  );
  for (const path of ["z.node", "zz-excluded.node"])
    expect(scopes(path), path).toEqual([]);
  const excluded = scopes("z-excluded.js");
  expect(excluded).toHaveLength(1);
  expect(excluded[0]).toMatchObject({
    properties: { operation: "select-javascript-sources" },
    evidence: {
      authority: "ast-static-analysis",
      state: "unavailable",
      confidence: "unknown",
    },
  });
  expect(excluded[0]?.properties).not.toHaveProperty("analysis_failure");
  for (const [path, operation] of [
    ["a.js", "analyze-javascript-source"],
    ["a.js.map", "parse-local-source-map"],
    ["data.json", "parse-json-module"],
    ["index.html", "parse-html-script-references"],
    ["package.json", "parse-package-json"],
  ] as const) {
    if (!interrupted) expect(scopes(path), path).toEqual([]);
    else {
      expect(scopes(path), path).toHaveLength(1);
      expect(scopes(path)[0]).toMatchObject({
        properties: {
          operation,
          analysis_status: path === "a.js" ? "interrupted" : "not-started",
        },
        evidence: {
          authority: path === "a.js" ? "ast-static-analysis" : "artifact-bytes",
          state: "unavailable",
          confidence: "unknown",
          coverage: { status: "partial" },
        },
      });
    }
  }
  if (interrupted) expect(result.graph.coverage.status).toBe("partial");
  else expect(result.statistics.parsed_javascript_files).toBe(1);
}

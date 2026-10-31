#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createEvidence } from "../../../dist/domain/evidence.js";
import { PrivateRuntimeRoot } from "../../../dist/process/PrivateRuntimeRoot.js";
import {
  OwnedCommandFailure,
  runOwnedCommand,
} from "../../../dist/process/OwnedCommand.js";
import { withVerifierCleanup } from "../../lib/verifier-cleanup.mjs";
import { importVerifierSource } from "../../lib/verifier-source-loader.mjs";

const { matchesStructuredScopeExpectation, structuredScopeExpectationsSchema } =
  await importVerifierSource(
    new URL("../../lib/javascript-file-scope-oracle.mts", import.meta.url).href,
  );

const { values } = parseArgs({
  options: {
    artifact: { type: "string" },
    "addon-path": { type: "string" },
    "native-sha256": { type: "string" },
    "source-path": { type: "string", multiple: true },
    "structured-path": { type: "string", multiple: true },
    "structured-expectations": { type: "string" },
    "validate-structured-from-export": { type: "boolean", default: false },
    "analysis-timeout-ms": { type: "string" },
    "expect-timeout": { type: "boolean", default: false },
    rounds: { type: "string", default: "3" },
    "cli-parity": { type: "boolean", default: false },
    "tokenizer-python": { type: "string" },
    "require-safe": { type: "boolean", default: false },
  },
  strict: true,
});
assert.ok(
  values.artifact && isAbsolute(values.artifact),
  "--artifact must be absolute",
);
assert.ok(
  values["addon-path"] &&
    !isAbsolute(values["addon-path"]) &&
    values["addon-path"]
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== ".."),
  "--addon-path must be a normalized archive-relative path",
);
assert.match(
  values["native-sha256"] ?? "",
  /^[a-f0-9]{64}$/,
  "--native-sha256 pins prior native bytes; it does not prove availability",
);
const rounds = Number(values.rounds);
assert.ok(Number.isSafeInteger(rounds) && rounds > 0);
const analysisTimeoutMs =
  values["analysis-timeout-ms"] === undefined
    ? undefined
    : Number(values["analysis-timeout-ms"]);
assert.ok(
  analysisTimeoutMs === undefined ||
    (Number.isSafeInteger(analysisTimeoutMs) && analysisTimeoutMs > 0),
);
assert.ok(!values["expect-timeout"] || analysisTimeoutMs !== undefined);
assert.ok(!values["validate-structured-from-export"] || values["cli-parity"]);
const structuredExpectations = structuredScopeExpectationsSchema.parse(
  JSON.parse(values["structured-expectations"] ?? "{}"),
);
for (const path of Object.keys(structuredExpectations))
  assert.ok(
    values["structured-path"]?.includes(path),
    `Expected structured path was not selected for verification: ${path}`,
  );
if (values["expect-timeout"])
  for (const path of values["structured-path"] ?? [])
    assert.ok(
      Object.hasOwn(structuredExpectations, path),
      `--structured-expectations must name the expected operation/status for ${path}`,
    );
const environment = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  REA_LOG_LEVEL: "silent",
  REA_ANALYSIS_PROVIDER: "auto",
  HOPPER_LAUNCHER_PATH: "/rea-unconfigured-deep-provider/hopper",
};
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../../rea.mjs", import.meta.url)), "mcp"],
  env: environment,
  stderr: "pipe",
});
const client = new Client({
  name: "javascript-native-handoff-verifier",
  version: "1",
});
const serialize = (value) => JSON.stringify(value);
const digest = (value) =>
  createHash("sha256").update(serialize(value)).digest("hex");
const fileDigest = async (path) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};
const simulatedNativeEvidence = (path, sha256) =>
  createEvidence(
    { path, sha256, format: "raw-binary" },
    { id: "ghidra", name: "Ghidra", version: "simulated" },
    {
      operation: "binary_overview",
      parameters: {},
      result: {
        summary:
          "Simulated subject-linkage input; no native provider executed.",
      },
      limitations: ["No native provider behavior is established."],
    },
  );
let temporary;
let retainTemporary = false;
let report;
const ownedCommand = async (command, arguments_, timeoutMs = 60_000) => {
  try {
    return await runOwnedCommand(
      {
        command,
        arguments: arguments_,
        cwd: temporary.path,
        env: environment,
        runId: `rea-native-handoff-${randomUUID()}`,
        expectedCommand: command === process.execPath ? process.execPath : null,
        sweepTokenOwnedProcesses: true,
      },
      { timeoutMs, diagnosticBytes: 16 * 1024 * 1024 },
    );
  } catch (cause) {
    retainTemporary ||=
      cause instanceof OwnedCommandFailure && cause.cleanupOwner !== undefined;
    throw cause;
  }
};
await withVerifierCleanup(async () => {
  const archiveSha256 = await fileDigest(values.artifact);
  const companion = join(`${values.artifact}.unpacked`, values["addon-path"]);
  let companionSha256 = null;
  try {
    companionSha256 = await fileDigest(companion);
  } catch (cause) {
    if (cause?.code !== "ENOENT") throw cause;
  }
  if (companionSha256 !== null)
    assert.equal(companionSha256, values["native-sha256"]);
  const native = simulatedNativeEvidence(companion, values["native-sha256"]);
  const container = simulatedNativeEvidence(values.artifact, archiveSha256);
  await client.connect(transport);
  transport.stderr?.on("data", () => undefined);
  const tools = (await client.listTools()).tools;
  const catalog = tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
  const selected = catalog.filter(({ name }) =>
    ["analyze_javascript_application", "trace_application_feature"].includes(
      name,
    ),
  );
  assert.equal(selected.length, 2);
  const call = async (name, arguments_, allowTimeout = false) => {
    const response = await client.callTool(
      { name, arguments: arguments_ },
      { timeout: 360_000 },
    );
    let projection = response.structuredContent;
    if (response.isError === true) {
      assert.ok(
        allowTimeout,
        serialize({ name, arguments: arguments_, response }),
      );
      const text = response.content.find(({ type }) => type === "text");
      assert.ok(text?.type === "text");
      projection = JSON.parse(text.text);
      assert.equal(projection.error.code, "provider_timeout");
      assert.equal(
        projection.error.details.partial_observation.kind,
        "retained-evidence",
      );
    } else assert.ok(projection?.evidence_id);
    return {
      request: { name, arguments: arguments_ },
      response: projection,
      wire_response: response,
    };
  };
  const prepStart = performance.now();
  const preparation = await call(
    "analyze_javascript_application",
    {
      input_path: values.artifact,
      detail: "summary",
      ...(analysisTimeoutMs === undefined
        ? {}
        : { analysis_timeout_ms: analysisTimeoutMs }),
      ...(values["source-path"] === undefined
        ? {}
        : { source_paths: values["source-path"] }),
    },
    values["expect-timeout"],
  );
  const preparationMs = performance.now() - prepStart;
  const timedOut = preparation.wire_response.isError === true;
  assert.equal(timedOut, values["expect-timeout"]);
  if (!timedOut)
    assert.equal(preparation.response.subject.digest.sha256, archiveSha256);
  const sourceId = timedOut
    ? preparation.response.error.details.partial_observation.evidence_id
    : preparation.response.normalized_result.parent_evidence_id;
  assert.match(sourceId, /^ev_[a-f0-9]{64}$/);
  const query = {
    application: { kind: "retained-evidence", evidence_id: sourceId },
    native_observations: [container, native],
    seed: {
      kind: "string",
      value: values["addon-path"],
      match: "exact",
      case_sensitive: true,
    },
    direction: "outgoing",
  };
  const samples = [];
  let first;
  for (let round = 0; round < rounds; round++) {
    const start = performance.now();
    const result = await call("trace_application_feature", query);
    const elapsedMs = performance.now() - start;
    if (first === undefined) first = result;
    else assert.equal(result.response.evidence_id, first.response.evidence_id);
    samples.push({
      round,
      elapsed_ms: elapsedMs,
      structured_reply_bytes: Buffer.byteLength(serialize(result.response)),
      full_tool_reply_bytes: Buffer.byteLength(serialize(result.wire_response)),
    });
  }
  const trace = first.response.normalized_result;
  const addons = trace.graph.nodes.filter(
    ({ kind }) => kind === "native-addon",
  );
  assert.equal(
    addons.length,
    1,
    "The selected native add-on must remain visible",
  );
  const addon = addons[0];
  const unavailable = addon.observations.some(
    ({ properties }) => properties.availability === "unavailable",
  );
  const expectedLinks = [
    sourceId,
    ...(companionSha256 === null ? [] : [native.evidence_id]),
  ].sort();
  const safeIdentity =
    serialize(trace.evidence_links) === serialize(expectedLinks) &&
    (companionSha256 === null
      ? unavailable &&
        addon.identity.strategy !== "content-digest" &&
        trace.coverage.status === "partial" &&
        trace.native_handoffs.length === 0
      : addon.identity.strategy === "content-digest" &&
        addon.identity.sha256 === companionSha256 &&
        trace.native_handoffs.length === 1 &&
        trace.native_handoffs[0].artifact_sha256 === companionSha256 &&
        trace.native_handoffs[0].status === "evidence-linked" &&
        serialize(trace.native_handoffs[0].evidence_ids) ===
          serialize([native.evidence_id]));
  const analysisScopes = (result, path) =>
    result.graph.nodes.flatMap((node) =>
      node.kind !== "unknown"
        ? []
        : node.observations.flatMap((observation) =>
            observation.properties.path === path &&
            observation.properties.analysis_failure !== undefined
              ? [{ node_id: node.node_id, ...observation }]
              : [],
          ),
    );
  const nativeScopes = analysisScopes(trace, values["addon-path"]);
  const structuredQueries = [];
  const structuredScopes = [];
  for (const path of values["validate-structured-from-export"]
    ? []
    : (values["structured-path"] ?? [])) {
    const result = await call("trace_application_feature", {
      ...query,
      native_observations: [],
      seed: { ...query.seed, value: path },
    });
    structuredQueries.push(result);
    structuredScopes.push({
      source: "retained-feature-trace",
      path,
      scopes: analysisScopes(result.response.normalized_result, path),
      evidence_id: result.response.evidence_id,
      source_coverage: result.response.normalized_result.coverage,
      graph_coverage: result.response.normalized_result.graph.coverage,
    });
  }
  let cliParity = null;
  if (values["cli-parity"]) {
    temporary = await PrivateRuntimeRoot.create({
      prefix: "rea-native-handoff-verifier-",
    });
    const bundlePath = join(temporary.path, "bundle.json");
    const exported = await client.callTool({
      name: "export_evidence_bundle",
      arguments: { path: bundlePath },
    });
    assert.notEqual(exported.isError, true, serialize(exported));
    const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
    const parent = bundle.records.find(
      ({ evidence_id }) => evidence_id === sourceId,
    );
    assert.ok(parent, "Export omitted the retained parent");
    assert.equal(parent.normalized_result.root_artifact_sha256, archiveSha256);
    if (values["validate-structured-from-export"])
      for (const path of values["structured-path"] ?? []) {
        const retained = parent.normalized_result;
        const matchingNodes = retained.graph.nodes.filter((node) =>
          node.observations.some(({ properties }) => properties.path === path),
        );
        assert.ok(matchingNodes.length > 0, `Missing retained path: ${path}`);
        // Diagnostic validation of the complete backend record is distinct
        // from the inline native analyst task used by this control's tokens.
        structuredScopes.push({
          source: "exported-parent-validation",
          path,
          scopes: analysisScopes(retained, path),
          source_evidence_id: parent.evidence_id,
          retained_matching_nodes: matchingNodes.length,
          graph_coverage: retained.graph.coverage,
        });
      }
    const request = join(temporary.path, "trace.json");
    // The CLI's portable file contract takes complete Evidence; MCP resolves a
    // same-session reference into the same shared application workflow.
    await writeFile(request, serialize({ ...query, application: parent }));
    const result = await ownedCommand(
      process.execPath,
      [
        fileURLToPath(new URL("../../rea.mjs", import.meta.url)),
        "trace-application-feature",
        request,
        "--json",
      ],
      120_000,
    );
    const evidence = JSON.parse(result.stdout.text);
    assert.deepEqual(evidence.normalized_result, trace);
    assert.equal(evidence.evidence_id, first.response.evidence_id);
    cliParity = {
      exact_cli_mcp_trace_parity: true,
      evidence_id: evidence.evidence_id,
    };
  }
  const safeApplicability =
    nativeScopes.length === 0 &&
    structuredScopes.every(({ path, scopes }) =>
      timedOut
        ? matchesStructuredScopeExpectation(
            scopes,
            structuredExpectations[path],
          )
        : scopes.length === 0,
    );
  let tokenCosts = null;
  if (values["tokenizer-python"]) {
    temporary ??= await PrivateRuntimeRoot.create({
      prefix: "rea-native-handoff-verifier-",
    });
    const input = join(temporary.path, "token-input.json");
    await writeFile(
      input,
      serialize({
        catalog,
        selected,
        preparation,
        queries: [first, ...structuredQueries],
      }),
    );
    const result = await ownedCommand(values["tokenizer-python"], [
      "-c",
      `import json,sys,tiktoken
with open(sys.argv[1],encoding='utf-8') as f:d=json.load(f)
enc=tiktoken.get_encoding('cl100k_base')
def n(v):return len(enc.encode(json.dumps(v,ensure_ascii=False,separators=(',',':')),disallowed_special=()))
requests=n(d['preparation']['request'])+sum(n(q['request']) for q in d['queries'])
structured=n(d['preparation']['response'])+sum(n(q['response']) for q in d['queries'])
full_reply=n(d['preparation']['wire_response'])+sum(n(q['wire_response']) for q in d['queries'])
s=n(d['selected']);a=n(d['catalog'])
print(json.dumps(dict(tokenizer='cl100k_base',tiktoken_version=tiktoken.__version__,selected_catalog=s,full_catalog=a,requests=requests,structured_replies=structured,full_tool_replies=full_reply,selected_catalog_structured_task=s+requests+structured,full_catalog_structured_task=a+requests+structured,selected_catalog_full_reply_task=s+requests+full_reply,full_catalog_full_reply_task=a+requests+full_reply)))`,
      input,
    ]);
    tokenCosts = JSON.parse(result.stdout.text);
  }
  report = {
    scope:
      "Real shipped-ASAR native identity through public CLI/stdio MCP; simulated native Evidence only, no provider/application executed",
    artifact: { path: values.artifact, sha256: archiveSha256 },
    addon_path: values["addon-path"],
    companion_sha256_observed: companionSha256,
    prior_native_sha256_supplied: values["native-sha256"],
    source_paths: values["source-path"] ?? null,
    preparation_outcome: timedOut ? "provider_timeout" : "completed",
    analysis_timeout_ms: analysisTimeoutMs ?? null,
    parent_evidence_id: sourceId,
    trace_evidence_id: first.response.evidence_id,
    trace_subject: first.response.subject,
    preparation_ms: preparationMs,
    samples,
    safe_identity: safeIdentity,
    safe_applicability: safeApplicability,
    native_analysis_scopes: nativeScopes,
    structured_scopes: structuredScopes,
    structured_expectations: structuredExpectations,
    modeled_structured_trace_count: structuredQueries.length,
    node: {
      node_id: addon.node_id,
      identity: addon.identity,
      unavailable_observed: unavailable,
      basis: addon.observations.map(({ evidence }) => ({
        authority: evidence.authority,
        state: evidence.state,
        confidence: evidence.confidence,
        artifact: evidence.artifact,
        location: evidence.location,
      })),
    },
    native_handoffs: trace.native_handoffs,
    evidence_links: trace.evidence_links,
    source_coverage: trace.coverage,
    graph_coverage: trace.graph.coverage,
    facts_sha256: digest({
      node: addon,
      native_handoffs: trace.native_handoffs,
      evidence_links: trace.evidence_links,
      coverage: trace.coverage,
    }),
    cli_parity: cliParity,
    token_costs: tokenCosts,
    conditions:
      "Fresh MCP session, selected analysis followed by retained traces. Task token counts include one analysis summary or parsed timeout error, one native trace and each requested structured-path trace, with name/description/inputSchema catalog projections. Structured Evidence/parsed error and complete-tool-reply projections are alternatives, not billing. Repeated native rounds, export, CLI parity and tokenizer are validation overhead outside task tokens but inside total resource receipts. Filesystem/build caches uncontrolled. Incorrect identity/applicability is not a successful equivalent task or efficiency credit.",
  };
  if (values["require-safe"]) {
    assert.ok(safeIdentity, "Native identity/linkage oracle failed");
    assert.ok(safeApplicability, "File analysis applicability oracle failed");
  }
}, [
  () => client.close(),
  () => transport.close(),
  async () => {
    if (retainTemporary)
      throw new Error(
        `Command cleanup incomplete; retaining owned inputs at ${temporary?.path}.`,
      );
    await temporary?.close();
  },
]);
console.log(serialize(report));

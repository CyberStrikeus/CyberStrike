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
import { PrivateRuntimeRoot } from "../../../dist/process/PrivateRuntimeRoot.js";
import {
  OwnedCommandFailure,
  runOwnedCommand,
} from "../../../dist/process/OwnedCommand.js";
import { withVerifierCleanup } from "../../lib/verifier-cleanup.mjs";
import { selectExportedJavaScriptFacts } from "../../lib/javascript-facts-reference.mjs";

const { values } = parseArgs({
  options: {
    artifact: { type: "string" },
    mode: { type: "string" },
    query: { type: "string" },
    "source-path": { type: "string", multiple: true },
    "analysis-timeout-ms": { type: "string" },
    rounds: { type: "string", default: "3" },
    "cli-parity": { type: "boolean", default: false },
    "tokenizer-python": { type: "string" },
  },
});
assert.ok(values.artifact && isAbsolute(values.artifact));
assert.ok(values.mode === "export" || values.mode === "view");
const query = JSON.parse(values.query ?? "null");
assert.equal(query?.kind, "javascript-facts");
assert.ok(Array.isArray(query.property_keys));
const rounds = Number(values.rounds);
assert.ok(Number.isSafeInteger(rounds) && rounds > 0);
const timeout = values["analysis-timeout-ms"];
assert.ok(timeout === undefined || Number(timeout) === 1);
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
  name: "javascript-retained-facts-verifier",
  version: "1",
});
let temporary;
let retainTemporary = false;
let report;
const serialize = (value) => JSON.stringify(value);
const digest = (value) =>
  createHash("sha256").update(serialize(value)).digest("hex");
const ownedCommand = async (command, arguments_) => {
  try {
    return await runOwnedCommand(
      {
        command,
        arguments: arguments_,
        cwd: temporary.path,
        env: environment,
        runId: `rea-retained-facts-${randomUUID()}`,
        expectedCommand: command === process.execPath ? process.execPath : null,
        sweepTokenOwnedProcesses: true,
      },
      { timeoutMs: 120_000, diagnosticBytes: 16 * 1024 * 1024 },
    );
  } catch (cause) {
    retainTemporary ||=
      cause instanceof OwnedCommandFailure && cause.cleanupOwner !== undefined;
    throw cause;
  }
};

// The external observer supplies this isolated scope; ordinary runs report null.
const resourceSnapshot = async () => {
  if (process.platform !== "linux") return null;
  const membership = await readFile("/proc/self/cgroup", "utf8");
  const group = membership
    .split("\n")
    .find((line) => line.startsWith("0::"))
    ?.slice(3);
  if (!group || !/\/rea-efficiency-[a-f0-9]{32}\.scope$/u.test(group))
    return null;
  const [cpu, peak] = await Promise.all([
    readFile(join("/sys/fs/cgroup", group, "cpu.stat"), "utf8"),
    readFile(join("/sys/fs/cgroup", group, "memory.peak"), "utf8"),
  ]);
  const usage = /^usage_usec (\d+)$/mu.exec(cpu);
  assert.ok(usage);
  return {
    control_group: group,
    cpu_seconds_since_scope_start: Number(usage[1]) / 1e6,
    peak_cgroup_bytes: Number(peak.trim()),
  };
};

await withVerifierCleanup(async () => {
  const start = performance.now();
  const artifactHash = createHash("sha256");
  for await (const chunk of createReadStream(values.artifact))
    artifactHash.update(chunk);
  const artifactSha256 = artifactHash.digest("hex");
  temporary = await PrivateRuntimeRoot.create({
    prefix: "rea-retained-facts-verifier-",
  });
  await client.connect(transport);
  transport.stderr?.on("data", () => undefined);
  const catalog = (await client.listTools()).tools.map(
    ({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }),
  );
  const taskCalls = [];
  const call = async (name, arguments_, allowTimeout = false, task = false) => {
    const request = { name, arguments: arguments_ };
    const wire = await client.callTool(request, { timeout: 360_000 });
    let response = wire.structuredContent;
    if (wire.isError) {
      assert.ok(allowTimeout);
      const text = wire.content.find((item) => item.type === "text");
      assert.ok(text?.type === "text");
      response = JSON.parse(text.text);
      assert.equal(response.error.code, "provider_timeout");
      assert.equal(
        response.error.details.partial_observation.kind,
        "retained-evidence",
      );
    } else if (name !== "export_evidence_bundle")
      assert.ok(response?.evidence_id);
    else assert.ok(response);
    const result = { request, response, wire };
    if (task) taskCalls.push(result);
    return result;
  };
  const prepStart = performance.now();
  const preparation = await call(
    "analyze_javascript_application",
    {
      input_path: values.artifact,
      detail: "summary",
      ...(values["source-path"] === undefined
        ? {}
        : { source_paths: values["source-path"] }),
      ...(timeout === undefined
        ? {}
        : { analysis_timeout_ms: Number(timeout) }),
    },
    timeout !== undefined,
    true,
  );
  assert.equal(preparation.wire.isError === true, timeout !== undefined);
  const preparationMs = performance.now() - prepStart;
  const sourceId =
    timeout === undefined
      ? preparation.response.normalized_result.parent_evidence_id
      : preparation.response.error.details.partial_observation.evidence_id;
  assert.match(sourceId, /^ev_[a-f0-9]{64}$/u);
  const bundlePath = join(temporary.path, "bundle.json");
  let exported;
  let exportMs;
  const exportParent = async (task) => {
    const began = performance.now();
    exported = await call(
      "export_evidence_bundle",
      { path: bundlePath },
      false,
      task,
    );
    exportMs = performance.now() - began;
  };
  const projectionProgram = `import {readFile} from 'node:fs/promises';\nconst selectExportedJavaScriptFacts = ${selectExportedJavaScriptFacts.toString()};\nconst [bundlePath, evidenceId, rawQuery] = process.argv.slice(2);\nconst bundle = JSON.parse(await readFile(bundlePath, 'utf8'));\nconst parent = bundle.records.find(record => record.evidence_id === evidenceId);\nif (!parent) throw new Error('Retained parent missing');\nconsole.log(JSON.stringify(selectExportedJavaScriptFacts(parent, JSON.parse(rawQuery))));\n`;
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const baselineCommand = `${[process.execPath, "--input-type=module", "-", bundlePath, sourceId, serialize(query)].map(quote).join(" ")} <<'REA_FACTS_PROGRAM'\n${projectionProgram}REA_FACTS_PROGRAM`;
  const samples = [];
  let first;
  let firstWire;
  let answerResources;
  let answerElapsedMs;
  if (values.mode === "export") await exportParent(true);
  for (let round = 0; round < rounds; round++) {
    const began = performance.now();
    let answer;
    if (values.mode === "export") {
      const result = await ownedCommand("/bin/sh", ["-c", baselineCommand]);
      answer = JSON.parse(result.stdout.text);
      if (round === 0)
        taskCalls.push({
          request: {
            name: "exec_command",
            arguments: {
              cmd: baselineCommand,
              workdir: temporary.path,
            },
          },
          response: answer,
          wire: { stdout: result.stdout.text, exit_code: result.exitCode },
        });
    } else {
      const result = await call(
        "inspect_analysis_view",
        {
          source: { kind: "retained-evidence", evidence_id: sourceId },
          view: query,
        },
        false,
        round === 0,
      );
      answer = {
        parent_evidence_id:
          result.response.normalized_result.parent_evidence_id,
        source_coverage: result.response.normalized_result.source_coverage,
        total: result.response.normalized_result.coverage.total,
        rows: result.response.normalized_result.rows,
      };
      if (round === 0) firstWire = result.response;
    }
    const elapsedMs = performance.now() - began;
    if (round === 0) {
      first = answer;
      answerResources = await resourceSnapshot();
      answerElapsedMs = performance.now() - start;
    } else assert.deepEqual(answer, first);
    samples.push({
      round,
      elapsed_ms:
        elapsedMs + (values.mode === "export" && round === 0 ? exportMs : 0),
      answer_bytes: Buffer.byteLength(serialize(answer)),
    });
  }
  if (exported === undefined) await exportParent(false);
  const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
  const parent = bundle.records.find(
    (record) => record.evidence_id === sourceId,
  );
  assert.equal(parent?.normalized_result.root_artifact_sha256, artifactSha256);
  const expected = selectExportedJavaScriptFacts(parent, query);
  assert.deepEqual(first, expected);
  assert.ok(
    first.rows.length > 0,
    "The real scenario must select retained facts",
  );
  const matchedPaths = new Set(
    first.rows.map(({ evidence }) =>
      evidence.location.available &&
      evidence.location.value.kind === "artifact-path"
        ? evidence.location.value.path
        : evidence.location.available &&
            evidence.location.value.kind === "source-range"
          ? evidence.location.value.source
          : null,
    ),
  );
  for (const path of query.where?.paths ?? [])
    assert.ok(matchedPaths.has(path), `Missing actual scenario path ${path}`);
  let cliParity = null;
  if (values["cli-parity"]) {
    assert.equal(values.mode, "view");
    const requestPath = join(temporary.path, "view.json");
    await writeFile(
      requestPath,
      serialize({ source: { kind: "inline", evidence: parent }, view: query }),
    );
    const cli = await ownedCommand(process.execPath, [
      fileURLToPath(new URL("../../rea.mjs", import.meta.url)),
      "inspect-analysis-view",
      requestPath,
      "--json",
    ]);
    const evidence = JSON.parse(cli.stdout.text);
    assert.deepEqual(evidence, firstWire);
    cliParity = {
      exact_evidence_parity: true,
      evidence_id: evidence.evidence_id,
    };
  }
  let tokenCosts = null;
  if (values["tokenizer-python"]) {
    const taskTools = new Set(taskCalls.map(({ request }) => request.name));
    const selectedCatalog = catalog.filter(({ name }) => taskTools.has(name));
    const tokenInput = join(temporary.path, "tokens.json");
    await writeFile(
      tokenInput,
      serialize({
        selected_catalog: selectedCatalog,
        full_catalog: catalog,
        requests: taskCalls.map(({ request }) => request),
        structured_replies: taskCalls.map(({ response }) => response),
        full_tool_replies: taskCalls.map(({ wire }) => wire),
      }),
    );
    const tokenized = await ownedCommand(values["tokenizer-python"], [
      "-c",
      "import json,sys,tiktoken\nx=json.load(open(sys.argv[1]));e=tiktoken.get_encoding('cl100k_base')\nr={k:len(e.encode(json.dumps(v,separators=(',',':'),ensure_ascii=False))) for k,v in x.items()}\nr.update(tokenizer='cl100k_base',tiktoken_version=tiktoken.__version__)\nprint(json.dumps(r))",
      tokenInput,
    ]);
    tokenCosts = JSON.parse(tokenized.stdout.text);
    tokenCosts.structured_task =
      tokenCosts.selected_catalog +
      tokenCosts.requests +
      tokenCosts.structured_replies;
    tokenCosts.complete_reply_task =
      tokenCosts.selected_catalog +
      tokenCosts.requests +
      tokenCosts.full_tool_replies;
    tokenCosts.full_catalog_structured_task =
      tokenCosts.full_catalog +
      tokenCosts.requests +
      tokenCosts.structured_replies;
  }
  report = {
    artifact_sha256: artifactSha256,
    mode: values.mode,
    source_paths: values["source-path"],
    query,
    analysis_timeout_ms: timeout === undefined ? null : Number(timeout),
    parent_evidence_id: sourceId,
    preparation_ms: preparationMs,
    samples,
    answer_elapsed_ms: answerElapsedMs,
    resources_at_first_answer: answerResources,
    answer: first,
    answer_sha256: digest(first),
    export_ms: exportMs,
    cli_parity: cliParity,
    analysis_fingerprints: {
      semantic_graph_sha256: digest(parent.normalized_result.semantic_graph),
      summary: parent.normalized_result.summary,
    },
    token_costs: tokenCosts,
    conditions:
      "Fresh MCP and input hashing (file cache warmed); build/OS caches uncontrolled. First export sample includes export plus caller projection code, later samples reuse that immutable export. View samples precede diagnostic export. Task token projections include preparation, first answer, selected/full name/description/inputSchema catalog and the exact baseline program; exec tool schema, host rendering, output schemas, reasoning and billing unmeasured. At-answer cgroup counters include observer/startup overhead, before repeats/export diagnostics/parity/tokenization; final external observer measures all validation work. No application or native provider executes.",
  };
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

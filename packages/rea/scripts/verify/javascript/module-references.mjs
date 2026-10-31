#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { artifactCliEvidence } from "../../lib/artifact-e2e.mjs";
import { withVerifierCleanup } from "../../lib/verifier-cleanup.mjs";
import { PrivateRuntimeRoot } from "../../../dist/process/PrivateRuntimeRoot.js";
import {
  OwnedCommandFailure,
  runOwnedCommand,
} from "../../../dist/process/OwnedCommand.js";

const { values } = parseArgs({
  options: {
    artifact: { type: "string" },
    "source-path": { type: "string", multiple: true },
    path: { type: "string" },
    kind: { type: "string" },
    rounds: { type: "string", default: "3" },
    mode: { type: "string", default: "parity" },
    "cli-parity": { type: "boolean", default: false },
    "tokenizer-python": { type: "string" },
    "tokenizer-timeout-ms": { type: "string", default: "60000" },
  },
  strict: true,
});
assert.ok(values.artifact?.startsWith("/"), "--artifact must be absolute");
assert.ok(["parity", "legacy", "references"].includes(values.mode));
const rounds = Number(values.rounds);
assert.ok(Number.isSafeInteger(rounds) && rounds > 0);
const tokenizerTimeoutMs = Number(values["tokenizer-timeout-ms"]);
assert.ok(
  Number.isSafeInteger(tokenizerTimeoutMs) && tokenizerTimeoutMs > 0,
  "--tokenizer-timeout-ms must be a positive safe integer",
);
const where = {
  ...(values.path === undefined ? {} : { path: values.path }),
  ...(values.kind === undefined ? {} : { kind: values.kind }),
};
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../../rea.mjs", import.meta.url)), "mcp"],
  env: {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    REA_LOG_LEVEL: "silent",
    REA_ANALYSIS_PROVIDER: "auto",
  },
  stderr: "pipe",
});
const client = new Client({
  name: "javascript-module-reference-verifier",
  version: "1",
});
const serialize = (value) => JSON.stringify(value);
const bytes = (value) => Buffer.byteLength(serialize(value));
const digest = (value) =>
  createHash("sha256").update(serialize(value)).digest("hex");
const support = (observations) => [
  ...new Map(
    observations.map(({ evidence }) => {
      const basis = {
        authority: evidence.authority,
        state: evidence.state,
        confidence: evidence.confidence,
      };
      return [serialize(basis), basis];
    }),
  ).values(),
];
const normalize = (rows) =>
  rows.map((row) => ({
    ...row,
    basis: [...row.basis].sort((a, b) =>
      serialize(a).localeCompare(serialize(b)),
    ),
  }));
let temporary;
let retainTemporary = false;
await withVerifierCleanup(async () => {
  await client.connect(transport);
  transport.stderr?.resume();
  const tools = (await client.listTools()).tools;
  const relevant = tools.filter(({ name }) =>
    ["analyze_javascript_application", "inspect_analysis_view"].includes(name),
  );
  assert.equal(relevant.length, 2);
  const call = async (name, args, transcript) => {
    const response = await client.callTool(
      { name, arguments: args },
      { timeout: 360_000 },
    );
    if (response.isError) throw new Error(serialize(response));
    const evidence = response.structuredContent;
    assert.ok(evidence?.evidence_id && evidence.normalized_result);
    transcript?.push({
      request: { name, arguments: args },
      response: evidence,
    });
    return evidence;
  };
  const preparationStart = performance.now();
  const preparationRequest = {
    input_path: values.artifact,
    detail: "summary",
    ...(values["source-path"] === undefined
      ? {}
      : { source_paths: values["source-path"] }),
  };
  const summary = await call(
    "analyze_javascript_application",
    preparationRequest,
  );
  const source = {
    kind: "retained-evidence",
    evidence_id: summary.normalized_result.parent_evidence_id,
  };
  const preparationMs = performance.now() - preparationStart;
  const samples = [];
  const costInputs = {};
  let canonical;
  for (let round = 0; round < rounds; round += 1) {
    const modes =
      values.mode === "parity"
        ? round % 2 === 0
          ? ["legacy", "references"]
          : ["references", "legacy"]
        : [values.mode];
    for (const mode of modes) {
      const transcript = [];
      const started = performance.now();
      let rows;
      let coverage;
      if (mode === "legacy") {
        const page = await call(
          "inspect_analysis_view",
          {
            source,
            view: {
              kind: "page",
              collection: "modules",
              offset: 0,
              limit: Number.MAX_SAFE_INTEGER,
            },
          },
          transcript,
        );
        assert.equal(page.normalized_result.coverage.exhausted, true);
        rows = [];
        for (const row of page.normalized_result.items) {
          if (where.path !== undefined && row.path !== where.path) continue;
          if (where.kind !== undefined && row.kind !== where.kind) continue;
          const itemEvidence = await call(
            "inspect_analysis_view",
            {
              source,
              view: {
                kind: "item",
                collection: "modules",
                selector: { node_id: row.node_id },
              },
            },
            transcript,
          );
          const item = itemEvidence.normalized_result.item;
          rows.push({
            node_id: item.node_id,
            kind: item.kind,
            path: item.path,
            identity: item.identity,
            retained_source_range_count: item.source_ranges.length,
            basis: support(item.observations),
          });
        }
        coverage = page.normalized_result.coverage;
      } else {
        const references = await call(
          "inspect_analysis_view",
          {
            source,
            view: {
              kind: "javascript",
              collection: "modules",
              projection: "references",
              where,
              offset: 0,
              limit: Number.MAX_SAFE_INTEGER,
            },
          },
          transcript,
        );
        const result = references.normalized_result;
        rows = result.rows;
        coverage = result.coverage;
        assert.equal(coverage.exhausted, true);
        assert.deepEqual(
          result.source_coverage.application,
          summary.normalized_result.summary.coverage.application,
        );
        assert.deepEqual(
          result.source_coverage.source_selection,
          summary.normalized_result.summary.source_selection,
        );
        assert.equal(
          result.source_coverage.semantic.status,
          summary.normalized_result.summary.coverage.semantic.status,
        );
        assert.equal(
          result.source_coverage.application_unknown_count,
          summary.normalized_result.summary.coverage.application_unknowns,
        );
        assert.equal(
          result.source_coverage.semantic_unknown_count,
          summary.normalized_result.summary.coverage.semantic_unknowns,
        );
      }
      assert.ok(
        rows.length > 0,
        "No matching modules; select a representative nonempty task",
      );
      const normalized = normalize(rows);
      canonical ??= normalized;
      assert.deepEqual(
        normalized,
        canonical,
        "Module facts changed across workflows/rounds",
      );
      samples.push({
        round,
        mode,
        elapsed_ms: performance.now() - started,
        calls: transcript.length,
        structured_reply_bytes: transcript.reduce(
          (total, entry) => total + bytes(entry.response),
          0,
        ),
        facts_sha256: digest(normalized),
        matching_modules: rows.length,
        coverage,
      });
      costInputs[mode] ??= {
        catalog: relevant.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
        full_catalog: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
        common_summary: summary,
        common_request: {
          name: "analyze_javascript_application",
          arguments: preparationRequest,
        },
        transcript,
      };
    }
  }
  let cliParity = null;
  if (values["cli-parity"]) {
    temporary = await PrivateRuntimeRoot.create({
      prefix: "rea-module-reference-verifier-",
    });
    const bundlePath = join(temporary.path, "bundle.json");
    const exported = await client.callTool({
      name: "export_evidence_bundle",
      arguments: { path: bundlePath },
    });
    if (exported.isError) throw new Error(serialize(exported));
    const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
    const parent = bundle.records.find(
      ({ evidence_id }) => evidence_id === source.evidence_id,
    );
    assert.ok(parent, "Export omitted the retained analysis parent");
    const request = join(temporary.path, "view.json");
    await writeFile(
      request,
      serialize({
        source: { kind: "inline", evidence: parent },
        view: {
          kind: "javascript",
          collection: "modules",
          projection: "references",
          where,
          offset: 0,
          limit: Number.MAX_SAFE_INTEGER,
        },
      }),
    );
    const cli = await artifactCliEvidence("inspect-analysis-view", request);
    assert.deepEqual(normalize(cli.normalized_result.rows), canonical);
    assert.equal(cli.normalized_result.parent_evidence_id, parent.evidence_id);
    const retained = await call("inspect_analysis_view", {
      source,
      view: cli.normalized_result.view,
    });
    assert.deepEqual(cli.normalized_result, retained.normalized_result);
    assert.equal(cli.evidence_id, retained.evidence_id);
    cliParity = {
      evidence_id: cli.evidence_id,
      facts_sha256: digest(canonical),
      exact_cli_mcp_view_parity: true,
    };
  }
  let tokenCosts = null;
  if (values["tokenizer-python"]) {
    temporary ??= await PrivateRuntimeRoot.create({
      prefix: "rea-module-reference-verifier-",
    });
    const input = join(temporary.path, "token-input.json");
    await writeFile(input, serialize(costInputs));
    let result;
    try {
      result = await runOwnedCommand(
        {
          command: values["tokenizer-python"],
          arguments: [
            "-c",
            `
import json, sys, tiktoken
with open(sys.argv[1], encoding='utf-8') as source:
    data=json.load(source)
enc=tiktoken.get_encoding('cl100k_base')
def count(value):
    return len(enc.encode(json.dumps(value,ensure_ascii=False,separators=(',',':')),disallowed_special=()))
out={}
for mode, task in data.items():
    replies=sum(count(entry['response']) for entry in task['transcript'])
    requests=sum(count(entry['request']) for entry in task['transcript'])
    common=count(task['common_summary'])
    common_request=count(task['common_request'])
    selected=count(task['catalog'])
    full=count(task['full_catalog'])
    out[mode]=dict(selected_catalog=selected,full_catalog=full,common_request=common_request,common_summary=common,requests=requests,structured_replies=replies,selected_catalog_task_total=selected+common_request+common+requests+replies,full_catalog_task_total=full+common_request+common+requests+replies)
print(json.dumps(dict(tokenizer='cl100k_base',tiktoken_version=tiktoken.__version__,costs=out)))
`,
            input,
          ],
          cwd: temporary.path,
          runId: `rea-module-token-${randomUUID()}`,
          // An interpreter wrapper may exec another command. The shared owner
          // still verifies native identities and the exact inherited run token.
          expectedCommand: null,
          sweepTokenOwnedProcesses: true,
        },
        { timeoutMs: tokenizerTimeoutMs, diagnosticBytes: 1024 * 1024 },
      );
    } catch (cause) {
      // An incomplete cleanup carries its supervisor and identity resources in
      // the error. Preserve its private files for that owner instead of erasing
      // recovery data while a command may still be using it.
      retainTemporary =
        cause instanceof OwnedCommandFailure &&
        cause.cleanupOwner !== undefined;
      throw new Error(
        "Token accounting failed; inspect the owned-command outcome and cleanup status.",
        { cause },
      );
    }
    assert.notEqual(
      result.stdout.invalidUtf8,
      true,
      "Tokenizer output must be UTF-8 JSON",
    );
    tokenCosts = JSON.parse(result.stdout.text);
  }
  process.stdout.write(
    `${serialize({
      scope:
        "Completed module-fact reads from identical retained Evidence; no hosted-model performance claim",
      artifact: {
        path: values.artifact,
        sha256: summary.normalized_result.artifact.sha256,
      },
      parent_evidence_id: source.evidence_id,
      source_selection: summary.normalized_result.summary.source_selection,
      source_coverage: summary.normalized_result.summary.coverage,
      where,
      preparation_ms: preparationMs,
      samples,
      token_costs: tokenCosts,
      cli_parity: cliParity,
      conditions:
        "First query is after shared artifact analysis; subsequent queries share one MCP session. Legacy item reads are serial; a concurrent legacy baseline is unmeasured. Filesystem/build warmness uncontrolled. Token costs count one post-change catalog, preparation request/summary and each request/structured reply once; client rendering, replay, reasoning, final answer and model latency are unmeasured. Preparation and parity/tokenization overhead are outside per-query elapsed times; external family-resource receipts include the complete verifier and children.",
    })}\n`,
  );
}, [
  () => client.close(),
  () => transport.close(),
  async () => {
    if (temporary === undefined) return;
    if (retainTemporary)
      throw new Error(
        `Command cleanup is incomplete; retaining its private input/Evidence files at ${temporary.path}.`,
      );
    await temporary.close();
  },
]);

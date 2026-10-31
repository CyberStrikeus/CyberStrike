/** Equivalent model tasks; inputs, expected reports and raw receipts stay outside Git. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createRetainedQueryCaller } from "./retained-query-calls.mjs";
import {
  finalizeRetainedQueryReceipt,
  publishRetainedQueryReceipt,
} from "./retained-query-finalization.mjs";

const { values } = parseArgs({
  options: {
    ...Object.fromEntries(
      ["runtime", "artifact", "expected", "output"].map((name) => [
        name,
        { type: "string" },
      ]),
    ),
    phase: { type: "boolean", default: false },
  },
});
for (const name of ["runtime", "artifact", "expected", "output"])
  assert.ok(values[name] && values[name] === resolve(values[name]), name);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const expected = JSON.parse(await readFile(values.expected, "utf8"));
assert.equal(expected.artifact.path, values.artifact);
await mkdir(values.output, { mode: 0o700 });
const report = {
  artifact_sha256: hash(await readFile(values.artifact)),
  normalized_sha256: hash(JSON.stringify(expected)),
  calls: [],
  answers: [],
};

if (values.phase) {
  const { ModelArtifactProvider } = await import(
    pathToFileURL(join(values.runtime, "dist/model/ModelArtifactProvider.js"))
  );
  const provider = new ModelArtifactProvider();
  try {
    for (let index = 0; index < 7; index++) {
      const sample = {
        phase: index === 0 ? "fresh" : "repeat",
        is_error: true,
      };
      const start = performance.now();
      try {
        const result = await provider.inspect({
          path: values.artifact,
          hash: "header",
        });
        sample.elapsed_ms = performance.now() - start;
        assert.ok(result.ok, JSON.stringify(result));
        assert.deepEqual(result.value, expected);
        sample.is_error = false;
      } catch (cause) {
        sample.elapsed_ms ??= performance.now() - start;
        sample.failure = String(cause?.stack ?? cause);
        throw cause;
      } finally {
        report.calls.push(sample);
      }
    }
    report.status = "passed";
  } catch (cause) {
    report.status = "failed";
    report.failure = String(cause?.stack ?? cause);
    process.exitCode = 1;
  } finally {
    report.cleanup_failures = [];
    try {
      await provider.close();
    } catch (cause) {
      report.cleanup_failures.push(`provider: ${String(cause)}`);
      report.status = "failed";
    }
    if (!(await publishRetainedQueryReceipt({ report, output: values.output })))
      process.exitCode = 1;
  }
} else {
  await runMcpTask();
}

async function runMcpTask() {
  const account = await mkdtemp(join(tmpdir(), "rea-model-utf8-"));
  const client = new Client({ name: "model-utf8-validation", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(values.runtime, "scripts/rea.mjs"), "mcp"],
    env: {
      HOME: account,
      PATH: process.env.PATH,
      NODE_OPTIONS: "--max-old-space-size=2048",
      UV_THREADPOOL_SIZE: "1",
      REA_LOG_LEVEL: "silent",
      TMPDIR: account,
    },
    stderr: "pipe",
  });
  const serverLog = createWriteStream(join(values.output, "server.log"));
  const serverLogFinished = finished(serverLog);
  serverLogFinished.catch(() => {});
  transport.stderr?.pipe(serverLog);
  const transcript = [];
  const call = createRetainedQueryCaller(client, (receipt, event) => {
    report.calls.push(receipt);
    transcript.push(event);
  });
  const observe = async (name, input, phase) => {
    const reply = await call(name, input, phase);
    assert.notEqual(reply.isError, true, JSON.stringify(reply));
    assert.ok(reply.structuredContent);
    return reply.structuredContent;
  };
  try {
    await client.connect(transport);
    const catalog = await client.listTools();
    assert.equal(catalog.nextCursor, undefined);
    await writeFile(
      join(values.output, "catalog.json"),
      JSON.stringify(catalog),
    );
    report.catalog_sha256 = hash(JSON.stringify(catalog));
    report.catalog_tools = catalog.tools.length;
    const definitions = new Map(catalog.tools.map((tool) => [tool.name, tool]));
    const originalCall = client.callTool.bind(client);
    client.callTool = (input, options) =>
      originalCall(input, {
        ...options,
        toolDefinition: definitions.get(input.name),
      });
    const keys = [
      ...new Set(expected.metadata.slice(0, 2).map((row) => row.key)),
    ];
    const names = expected.tensors.slice(0, 2).map((row) => row.name);
    const fields = [
      "key",
      "type",
      "value",
      "element_count",
      "preview_complete",
    ];
    const tensorFields = [
      "name",
      "type",
      "shape",
      "file_offset",
      "byte_length",
    ];
    const select = (rows, selectedFields) =>
      rows.map((row) =>
        Object.fromEntries(
          ["index", ...selectedFields].map((key) => [key, row[key]]),
        ),
      );
    const observations = [];
    for (const phase of ["fresh", "repeat"]) {
      const metadata = await observe(
        "inspect_model_artifact",
        {
          path: values.artifact,
          view: { collection: "metadata", keys, fields },
        },
        phase,
      );
      const parentId = metadata.normalized_result.parent_evidence_id;
      assert.equal(typeof parentId, "string");
      assert.deepEqual(
        metadata.normalized_result.items,
        select(
          expected.metadata.filter((row) => keys.includes(row.key)),
          fields,
        ),
      );
      const tensors = await observe(
        "inspect_analysis_view",
        {
          source: { kind: "retained-evidence", evidence_id: parentId },
          view: {
            kind: "model-artifact",
            collection: "tensors",
            names,
            fields: tensorFields,
          },
        },
        `${phase}:tensors`,
      );
      assert.equal(tensors.normalized_result.parent_evidence_id, parentId);
      assert.deepEqual(
        tensors.normalized_result.items,
        select(expected.tensors.slice(0, 2), tensorFields),
      );
      observations.push(parentId);
      report.answers.push({
        parent_evidence_id: parentId,
        metadata: metadata.normalized_result.items,
        tensors: tensors.normalized_result.items,
      });
    }
    await observe(
      "export_evidence_bundle",
      { path: join(values.output, "evidence.json") },
      "export",
    );
    const bundle = JSON.parse(
      await readFile(join(values.output, "evidence.json"), "utf8"),
    );
    for (const id of observations) {
      const parent = bundle.records.find((record) => record.evidence_id === id);
      assert.ok(parent);
      assert.deepEqual(parent.normalized_result, expected);
    }
    assert.deepEqual(report.answers[0], report.answers[1]);
    assert.equal(hash(await readFile(values.artifact)), report.artifact_sha256);
    report.status = "passed";
  } catch (cause) {
    report.status = "failed";
    report.failure = String(cause?.stack ?? cause);
    process.exitCode = 1;
  } finally {
    if (
      !(await finalizeRetainedQueryReceipt({
        report,
        client,
        transport,
        account,
        serverLog,
        serverLogFinished,
        output: values.output,
        transcript,
      }))
    )
      process.exitCode = 1;
  }
}

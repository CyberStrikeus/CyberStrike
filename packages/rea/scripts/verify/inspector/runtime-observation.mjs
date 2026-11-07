import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const execute = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const root = await realpath(await mkdtemp(join(tmpdir(), "rea-inspector-")));
const environment = {
  ...process.env,
};
const client = new Client({
  name: "rea-inspector-conformance",
  version: "1.0.0",
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["scripts/rea.mjs", "mcp"],
  cwd: repository,
  env: environment,
  stderr: "pipe",
});
const names = [
  "node-target.mjs",
  "plain.cjs",
  "with space.cjs",
  "with_under_score.cjs",
  "with#hash.cjs",
  "with%percent.cjs",
  "with%23hash.cjs",
  ...(process.platform === "win32" ? [] : ['with"quote.cjs']),
];

try {
  await client.connect(transport);
  for (const name of names) {
    const targetPath =
      name === "node-target.mjs"
        ? await realpath(join(repository, "tests/conformance/inspector", name))
        : join(root, name);
    if (name !== "node-target.mjs")
      await writeFile(targetPath, "setInterval(() => {}, 1000);\n");
    const child = spawn(
      process.execPath,
      ["--inspect=127.0.0.1:0", targetPath],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    try {
      await verifyTarget(child, targetPath, name);
    } finally {
      await terminate(child);
    }
  }
} finally {
  try {
    await client.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function verifyTarget(child, targetPath, name) {
  const socket = new URL(await inspectorUrl(child));
  const endpoint = `http://127.0.0.1:${socket.port}`;
  const response = await fetch(`${endpoint}/json/list`);
  assert.equal(response.ok, true);
  const discovery = await response.json();
  assert.equal(discovery.length, 1);
  const raw = discovery[0];
  assert.equal(typeof raw.id, "string");
  const expectedAttached =
    typeof raw.attached === "boolean" ? raw.attached : null;
  // Independent oracle: the fixture owns the pathname, and Node's discovery
  // serialization loses quotes/backslashes. Never decode underscores into it.
  const unresolved = process.platform === "win32" || /[_"\\]/u.test(targetPath);
  const expectedLocation = unresolved
    ? {
        kind: "unresolved",
        reported_url: raw.url,
        reason: "unverifiable-file-location",
      }
    : { kind: "file", file_path: targetPath };
  const listed = await runCli([
    "list-javascript-runtime-targets",
    endpoint,
    "--json",
  ]);
  assert.equal(listed.operation, "list_javascript_runtime_targets");
  const inventory = listed.normalized_result;
  assert.equal(inventory.targets.length, 1);
  assert.equal(inventory.targets[0].target_id, raw.id);
  assert.equal(inventory.targets[0].attached, expectedAttached);
  assert.deepEqual(inventory.targets[0].location, expectedLocation);
  assert.equal(inventory.excluded.unsupported_location, 0);
  const mcpList = await runMcp("list_javascript_runtime_targets", {
    inspector_endpoint: endpoint,
  });
  assert.deepEqual(mcpList, inventory);

  const observed = await runCli([
    "observe-javascript-runtime",
    endpoint,
    raw.id,
    "--runtime-kind",
    "node",
    "--observation-ms",
    "100",
    "--json",
  ]);
  assert.equal(observed.operation, "observe_javascript_runtime");
  assert.equal(observed.provider.id, "rea-v8-inspector");
  const mcpObservation = await runMcp("observe_javascript_runtime", {
    inspector_endpoint: endpoint,
    target_id: raw.id,
    runtime_kind: "node",
    observation_ms: 100,
  });
  for (const result of [observed.normalized_result, mcpObservation])
    verifyObservation(
      result,
      raw.id,
      expectedLocation,
      targetPath,
      expectedAttached,
    );
  assert.deepEqual(mcpObservation.target, observed.normalized_result.target);
  process.stdout.write(
    `${JSON.stringify({
      status: "pass",
      platform: process.platform,
      node: process.version,
      fixture: name,
      target_id: raw.id,
      discovery_url: raw.url,
      target_location: expectedLocation,
      attached: inventory.targets[0].attached,
      cli_scripts: observed.normalized_result.scripts.items.length,
      mcp_scripts: mcpObservation.scripts.items.length,
      listed_evidence_id: listed.evidence_id,
      observation_evidence_id: observed.evidence_id,
    })}\n`,
  );
}

function verifyObservation(
  result,
  targetId,
  expectedLocation,
  targetPath,
  expectedAttached,
) {
  assert.equal(result.target.target_id, targetId);
  assert.equal(result.target.runtime_kind, "node");
  assert.equal(result.target.attached, expectedAttached);
  assert.deepEqual(result.target.location, expectedLocation);
  assert.equal(result.capture.truncated, false);
  assert.ok(Array.isArray(result.directly_observed));
  assert.ok(Array.isArray(result.unavailable_without_instrumentation));
  assert.ok(
    result.scripts.items.some(
      ({ location }) =>
        location.kind === "file" && location.file_path === targetPath,
    ),
    `Actual entry script was not independently resolved: ${targetPath}`,
  );
  if (expectedLocation.kind === "unresolved")
    assert.ok(
      result.unknowns.includes(
        "The discovery-reported file location cannot be verified; loaded script locations are resolved independently from Debugger.scriptParsed.",
      ),
    );
}

async function runMcp(name, arguments_) {
  const response = await client.callTool({ name, arguments: arguments_ });
  assert.notEqual(
    response.isError,
    true,
    JSON.stringify(response.structuredContent),
  );
  assert.ok(response.structuredContent?.normalized_result);
  return response.structuredContent.normalized_result;
}

async function inspectorUrl(process_) {
  let captured = "";
  for await (const chunk of process_.stderr) {
    captured += chunk.toString("utf8");
    const match = /Debugger listening on (ws:\/\/[^\s]+)/u.exec(captured);
    if (match?.[1] !== undefined) return match[1];
    if (captured.length > 64 * 1_024)
      throw new Error("Inspector startup output exceeded its bound");
  }
  throw new Error("Node exited before reporting its Inspector URL");
}

async function runCli(arguments_) {
  const { stdout } = await execute(
    process.execPath,
    ["scripts/rea.mjs", ...arguments_],
    {
      cwd: repository,
      env: environment,
      maxBuffer: 16 * 1_024 * 1_024,
      timeout: 30_000,
    },
  );
  return JSON.parse(stdout);
}

async function terminate(process_) {
  if (process_.exitCode !== null || process_.signalCode !== null) return;
  const exited = once(process_, "exit");
  process_.kill("SIGTERM");
  let timer;
  try {
    const terminated = await Promise.race([
      exited.then(() => true),
      new Promise((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(false), 2_000);
      }),
    ]);
    if (
      terminated ||
      process_.exitCode !== null ||
      process_.signalCode !== null
    )
      return;
    process_.kill("SIGKILL");
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

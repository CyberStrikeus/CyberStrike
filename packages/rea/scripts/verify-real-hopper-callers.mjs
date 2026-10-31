// Run from the repository root after `npm run build:cached` on macOS arm64,
// with Hopper and the Xcode command-line tools installed. No target is executed.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { artifactMcpCall } from "./lib/artifact-e2e.mjs";
import { snapshotHopperRuntime } from "./lib/real-hopper-cleanup.mjs";
import { HOPPER_TARGET_LEASE_DIRECTORY } from "../dist/process/HopperLease.js";

assert.equal(process.platform, "darwin", "requires macOS");
assert.equal(
  process.arch,
  "arm64",
  "requires macOS arm64 (fixture tail branch is ARM64)",
);
const root = process.cwd();
const require = createRequire(join(root, "package.json"));
const { Client } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/client"))
);
const { StdioClientTransport } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/client/stdio"))
);
const { parseConfig } = await import(
  pathToFileURL(join(root, "dist/config/parseConfig.js"))
);
const config = parseConfig(process.env);
if (!config.ok) throw config.error;
await access(config.value.hopperLauncherPath, constants.X_OK);
const run = promisify(execFile);
const clang = (await run("xcrun", ["--find", "clang"])).stdout.trim();
const sdk = (
  await run("xcrun", ["--sdk", "macosx", "--show-sdk-path"])
).stdout.trim();
const directory = await mkdtemp(join("/tmp", "rea-hopper-callers-verifier-"));
const fixture = join(directory, "tail-call");
const large = join(directory, "long-scan");
const source = fileURLToPath(
  new URL("./fixtures/hopper-tail-call.c", import.meta.url),
);
const digest = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const sessionsBefore = await snapshotHopperRuntime(
  "/tmp",
  HOPPER_TARGET_LEASE_DIRECTORY,
);
const ownedProcessIds = new Set();
const client = new Client({ name: "hopper-callers-verifier", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/main.js"],
  cwd: root,
  env: {
    ...process.env,
    REA_ANALYSIS_PROVIDER: "hopper",
    REA_LOG_LEVEL: "silent",
    REA_HOPPER_CALLER_SCAN_BUDGET_MS: "5000",
  },
  stderr: "pipe",
});
let stderr = "";
transport.stderr?.on("data", (chunk) => {
  stderr += chunk.toString();
});
const call = async (name, args, options = {}) => {
  process.stderr.write(`calling ${name}\n`);
  const result = await artifactMcpCall(
    client,
    { name, arguments: args },
    { timeout: 120000, ...options },
  );
  assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result)}`);
  return (
    result.structuredContent ??
    JSON.parse(result.content.find((x) => x.type === "text").text)
  );
};
const address = (result) => {
  const match = result.normalized_result.match(/^(0x[0-9a-f]+):/mu);
  assert(match, "Hopper assembly has no instruction address");
  return match[1];
};
const matchingRef = (ref, site, from, to) =>
  ref.source_address === site &&
  ref.source_procedure?.address === from &&
  ref.target_procedure?.address === to &&
  ref.call?.classification === "direct";
try {
  await run(clang, [
    "-isysroot",
    sdk,
    "-arch",
    "arm64",
    "-O1",
    source,
    "-o",
    fixture,
  ]);
  const lines = ["#include <stdio.h>"];
  for (let i = 0; i < 4000; i++) {
    const id = String(i).padStart(4, "0");
    lines.push(
      `__attribute__((noinline, used)) int rea_progress_${id}(void) { puts("REA_PROGRESS_${id}"); return ${i}; }`,
    );
  }
  lines.push("int main(void) { return rea_progress_0000(); }");
  const largeSource = join(directory, "long-scan.c");
  await writeFile(largeSource, lines.join("\n"));
  await run(clang, [
    "-isysroot",
    sdk,
    "-arch",
    "arm64",
    "-O1",
    largeSource,
    "-o",
    large,
  ]);
  const before = await digest(fixture),
    beforeLarge = await digest(large);
  await client.connect(transport);
  if (transport.pid === null)
    throw new Error("MCP process identity unavailable");
  ownedProcessIds.add(transport.pid);
  let notifications = 0;
  const original = transport.onmessage;
  transport.onmessage = (message) => {
    if (message.method === "notifications/progress") notifications++;
    original?.(message);
  };
  await call("open_binary", { path: fixture });
  const assembly = await call("procedure_assembly", {
    procedure: "_call_direct",
  });
  const branch = assembly.normalized_result.match(
    /^(0x[0-9a-f]+):\s+b\s+_target_fn\s*$/mu,
  );
  assert(
    branch,
    `compiler did not produce expected tail branch: ${assembly.normalized_result}`,
  );
  const site = branch[1],
    from = address(assembly);
  const to = address(
    await call("procedure_assembly", { procedure: "_target_fn" }),
  );
  assert(
    (
      await call("procedure_callees", { procedure: from })
    ).normalized_result.includes(to),
  );
  const callers = await call("procedure_callers", {
    procedure: to,
    detail: "complete",
  });
  assert(callers.normalized_result.includes(from), "tail caller missing");
  assert.equal(callers.relationship_coverage.status, "unknown");
  assert(
    callers.raw_result.forward_observations.callee_inventory_callers.some(
      (x) => x.address === from,
    ),
    "forward caller provenance missing",
  );
  const refs = (
    await call("procedure_references", { procedure: to, direction: "incoming" })
  ).normalized_result.references;
  assert(
    refs.some((x) => matchingRef(x, site, from, to)),
    "exact incoming tail reference missing",
  );
  const dossier = (
    await call("analyze_function", { procedure: to, detail: "complete" })
  ).normalized_result;
  assert(
    dossier.callers.some((x) => x.address === from),
    "dossier caller missing",
  );
  assert(
    dossier.incoming_references.some((x) => matchingRef(x, site, from, to)),
    "dossier reference missing",
  );
  const graph = (
    await call("get_call_graph", {
      address: to,
      direction: "backward",
      detail: "complete",
    })
  ).normalized_result.graph;
  assert(
    Object.values(graph)
      .flat()
      .some((x) => x.address === to && x.calls.includes(from)),
    "backward graph edge missing",
  );
  const path = (
    await call("trace_call_path", {
      start: to,
      goal: from,
      direction: "backward",
    })
  ).normalized_result;
  assert.equal(path.goal_status, "reached");
  assert(
    path.edges.some(
      (x) => x.source_address === from && x.target_address === to,
    ),
  );
  await call("close_binary", {});
  assert.equal(await digest(fixture), before);
  console.log(
    JSON.stringify({
      event: "tail_call_verified",
      from,
      site,
      to,
      sha256: before,
    }),
  );
  await call("open_binary", { path: large });
  await call("procedure_assembly", { procedure: "_rea_progress_0000" });
  const query = {
    address: "_rea_progress_0000",
    direction: "backward",
    detail: "complete",
  };
  const count = notifications;
  await call("get_call_graph", query);
  assert.equal(notifications, count, "unsolicited progress without token");
  const progress = [];
  await call("get_call_graph", query, { onprogress: (x) => progress.push(x) });
  assert(
    progress.every((x, i) => i === 0 || x.progress > progress[i - 1].progress),
    "progress not monotonic",
  );
  assert(
    progress.some((x) =>
      x.message?.includes("hopper_caller_reconciliation: Examined"),
    ),
    "missing examined-count progress",
  );
  const controller = new AbortController();
  let partial = false;
  let resolved = false;
  try {
    await artifactMcpCall(
      client,
      { name: "get_call_graph", arguments: query },
      {
        timeout: 120000,
        signal: controller.signal,
        onprogress: (x) => {
          const match = x.message?.match(
            /hopper_caller_reconciliation: Examined (\d+) of (\d+) procedures/u,
          );
          if (match && Number(match[1]) < Number(match[2])) {
            partial = true;
            controller.abort("cancel during real scan");
          }
        },
      },
    );
    resolved = true;
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  }
  assert(
    partial && !resolved,
    "did not observe cancellation after partial scan progress; cancellation coverage unavailable on this host",
  );
  await client.ping();
  const retry = await call("get_call_graph", query);
  assert(retry.normalized_result.graph, "retry did not return graph");
  await call("close_binary", {});
  assert.equal(await digest(large), beforeLarge);
  console.log(
    JSON.stringify({
      event: "progress_cancel_retry_verified",
      progress,
      sha256: beforeLarge,
    }),
  );
} finally {
  await client.close();
  await transport.close();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const leaked = [
    ...(await snapshotHopperRuntime(
      "/tmp",
      HOPPER_TARGET_LEASE_DIRECTORY,
      ownedProcessIds,
    )),
  ].filter((path) => !sessionsBefore.has(path));
  if (leaked.length === 0)
    await rm(directory, { recursive: true, force: true });
  if (stderr) process.stderr.write(stderr);
  assert.deepEqual(
    leaked,
    [],
    `Hopper resources remain: ${leaked.join(", ")}; fixture retained at ${directory}`,
  );
}

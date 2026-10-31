import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { combineFunctionRelationshipCoverage } from "../../dist/domain/functionCallCoverage.js";

const entries = async (path) => {
  try {
    return (await readdir(path)).sort();
  } catch (cause) {
    if (cause.code === "ENOENT") return [];
    throw cause;
  }
};

/** Verify selected public reference answers without requesting source text. */
export const verifyKunaReferences = async ({
  call,
  cacheRoot,
  name,
  address,
  expectedCaller,
  nativeIncoming,
}) => {
  const before = await Promise.all([
    entries(join(cacheRoot, "projects")),
    entries(join(cacheRoot, "staging")),
  ]);
  const callers = await call("procedure_callers", { procedure: address });
  const callees = await call("procedure_callees", { procedure: address });
  const incoming = await call("xrefs", { address });
  for (const [label, result] of [
    ["callers", callers],
    ["callees", callees],
    ["xrefs", incoming],
  ]) {
    assert.ok(
      Array.isArray(result.value),
      `${name} ${label} omitted its address list`,
    );
    assert.equal(
      new Set(result.value).size,
      result.value.length,
      `${label} repeats an address`,
    );
    assert.ok(
      result.value.every((value) =>
        /^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/u.test(value),
      ),
      `${label} returned a noncanonical u64 address`,
    );
    assert.equal(result.structured.provider.id, "kuna");
    const source = result.structured.raw_result.references;
    assert.match(source.sha256, /^[0-9a-f]{64}$/u);
    assert.ok(source.bytes > 0);
  }
  let composed;
  if (expectedCaller !== undefined) {
    assert.ok(
      callers.value.includes(expectedCaller),
      `${name} lost its source-owned caller`,
    );
    assert.ok(
      incoming.value.length > 0,
      `${name} lost its source-owned call site`,
    );
    assert.deepEqual(
      [...incoming.value].sort(),
      await nativeIncoming(address),
      `${name} incoming references differ from exact-target native sites`,
    );
    const graph = await call("get_call_graph", {
      address: expectedCaller,
      direction: "forward",
    });
    assert.ok(graph.value.graph["0"][0].calls.includes(address));
    const path = await call("trace_call_path", {
      start: expectedCaller,
      goal: address,
      direction: "forward",
    });
    assert.equal(path.value.goal_status, "reached");
    composed = { graph_ms: graph.ms, path_ms: path.ms };
  }
  assert.deepEqual(
    await Promise.all([
      entries(join(cacheRoot, "projects")),
      entries(join(cacheRoot, "staging")),
    ]),
    before,
    "A reference-only workflow started a C project export",
  );
  const repeated = await call("procedure_callees", { procedure: address });
  assert.deepEqual(repeated.value, callees.value);
  return {
    callers: callers.value.length,
    callees: callees.value.length,
    xrefs: incoming.value.length,
    first_graph_ms: callers.ms,
    warm_graph_ms: repeated.ms,
    xrefs_ms: incoming.ms,
    response_bytes: callers.bytes + callees.bytes + incoming.bytes,
    relationship_coverage: combineFunctionRelationshipCoverage(
      callers.structured.relationship_coverage,
      callees.structured.relationship_coverage,
    ),
    ...composed,
  };
};

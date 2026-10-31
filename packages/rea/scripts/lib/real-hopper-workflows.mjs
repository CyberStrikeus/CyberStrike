import assert from "node:assert/strict";

/** Ground literal matching and graph identity in a real provider's function chain. */
export async function verifyHopperWorkflows(call, invalid, procedure) {
  const address = procedure.address;
  const originalName = await call("address_name", { address });
  const callees = await call("procedure_callees", { procedure: address });
  assert.ok(callees.length > 0, "fixture omitted a reachable call target");
  const goal = callees[0];
  const goalName = await call("address_name", { address: goal });
  assert.equal(typeof goalName, "string");
  const canonicalPath = await call("trace_call_path", { start: address, goal });
  assert.equal(canonicalPath.goal_status, "reached");
  assert.deepEqual(
    await call("trace_call_path", { start: originalName, goal: goalName }),
    canonicalPath,
  );
  assert.deepEqual(
    await call("trace_call_path", {
      start: address.toUpperCase(),
      goal: `0x${(BigInt(goal) + 1n).toString(16)}`,
    }),
    canonicalPath,
  );
  const graph = await call("get_call_graph", { address });
  assert.deepEqual(
    await call("get_call_graph", { address: originalName }),
    graph,
  );
  assert.deepEqual(
    await call("get_call_graph", { address: address.toUpperCase() }),
    graph,
  );
  const procedures = await call("list_procedures");
  const cycle = procedures.filter((item) =>
    /rea_cycle_[ab]$/u.test(item.value),
  );
  assert.equal(cycle.length, 2, "fixture omitted its source-owned call cycle");
  const cycleGraph = await call("get_call_graph", { address: cycle[0].value });
  const cycleNodes = Object.values(cycleGraph.graph).flat();
  assert.equal(cycleNodes.length, 2);
  assert.deepEqual(
    cycleNodes.map((node) => node.address).sort(),
    cycle.map((item) => item.address).sort(),
  );
  for (const node of cycleNodes) {
    assert.equal(node.status, "ok");
    assert.deepEqual(
      node.calls,
      cycle
        .filter((item) => item.address !== node.address)
        .map((item) => item.address),
    );
  }
  await invalid(
    "trace_call_path",
    { start: "__rea_missing_procedure__", goal: "__rea_missing_procedure__" },
    /Unknown Hopper address or name/u,
    "procedure_address",
  );
  const missingPhrase = await call("trace_feature", {
    query: "REA_C_LEAF __rea_missing_phrase__",
  });
  assert.deepEqual(missingPhrase.matches, []);
  assert.deepEqual(missingPhrase.references, []);
  const phrase = "REA boundary phrase";
  try {
    await call("set_address_name", { address, name: phrase });
    const traced = await call("trace_feature", { query: phrase });
    assert.deepEqual(traced.matches, [
      { type: "procedure", address, value: phrase },
    ]);
    const spaced = await call("trace_feature", { query: ` ${phrase} ` });
    assert.deepEqual(spaced.matches, []);
    assert.deepEqual(spaced.references, []);
  } finally {
    await call("set_address_name", { address, name: originalName });
  }
  return {
    canonicalGraphIdentities: true,
    sourceOwnedCallCycle: true,
    symbolAndInteriorGoalParity: true,
    invalidSelfPathRejected: true,
    completeLiteralQueryPreserved: true,
  };
}

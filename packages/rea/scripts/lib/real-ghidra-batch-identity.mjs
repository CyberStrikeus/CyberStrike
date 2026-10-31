import assert from "node:assert/strict";

/** Verify batch selector/entry separation against real source-owned Ghidra functions. */
export async function verifyGhidraBatchIdentity(call, names) {
  const leaf = names.find((item) =>
    item.value.endsWith("rea_ghidra_inventory_leaf"),
  );
  assert.ok(leaf, "Source fixture lacks a leaf procedure");
  const listing = await call("read_function_instructions", {
    procedure: leaf.address,
  });
  const interior = listing.instructions[1]?.split(": ")[0];
  assert.ok(interior, "Source fixture lacks an interior instruction");
  const name = await call("address_name", { address: leaf.address });
  const selectors = [leaf.address, interior, leaf.value, "0x0"];
  const result = await call("batch_decompile", { addresses: selectors });
  assert.equal(result.total, 4);
  assert.equal(result.succeeded, 3);
  assert.equal(result.failed, 1);
  for (let index = 0; index < 3; index++) {
    const item = result.items[index];
    assert.equal(item.address, selectors[index]);
    assert.equal(item.status, "ok");
    assert.deepEqual(item.procedure, {
      status: "resolved",
      address: leaf.address,
      name,
    });
    assert.equal(item.pseudocode, result.items[0].pseudocode);
  }
  assert.equal(result.items[3].status, "error");
  assert.equal(result.items[3].procedure.status, "unknown");
  assert.ok(result.items[3].procedure.error.code);
  return {
    entry: leaf.address,
    interior,
    selectors_preserved: true,
    identical_resolved_code: true,
    partial_failure_retained: true,
  };
}

import assert from "node:assert/strict";

const NEGATIVE_REASONS = new Set(["not_in_procedure", "outside_segments"]);

/**
 * Assert the `trace_feature` result of the real IDA lane for one selected
 * procedure. The query is a substring search, so the trace may also match other
 * procedures and strings; each reference is checked against its own matched
 * target, and a source outside every function (a data reference) is valid.
 */
export function assertFeatureTrace(trace, procedure) {
  assert.ok(
    trace.matches.some(
      ({ type, address }) =>
        type === "procedure" && address === procedure.address,
    ),
    "The trace omitted the selected procedure's match.",
  );
  assert.equal(typeof trace.truncated, "boolean");
  const matched = new Set(trace.matches.map(({ address }) => address));
  for (const reference of trace.references) {
    assert.ok(
      matched.has(reference.target_address),
      `A reference targets ${reference.target_address}, which is not a match.`,
    );
    const { containing_procedure: containing } = reference;
    if (containing.found)
      assert.equal(typeof containing.procedure.address, "string");
    else assert.ok(NEGATIVE_REASONS.has(containing.reason));
  }
}

/**
 * Find a string that IDA maps outside every function. A string inside a
 * function chunk (inline data in code) is valid and skipped, so the strings are
 * tried in order. Any other answer must be "not in a procedure": IDA lists only
 * mapped strings, so an unmapped answer is a containment defect and fails the
 * lane. Returns the address, or undefined when every string is inside a function.
 */
export async function findMappedNonFunction(strings, resolveAt) {
  for (const { address } of strings) {
    const resolved = await resolveAt(address);
    if (resolved.found) continue;
    assert.equal(
      resolved.reason,
      "not_in_procedure",
      `The listed string at ${address} resolved as ${resolved.reason}.`,
    );
    return address;
  }
  return undefined;
}

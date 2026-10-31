import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const input = JSON.parse(process.env.REA_TEST_EVIDENCE_COMPLETION ?? "null");
assert.ok(input && typeof input.marker === "string");
assert.ok(
  ["inspect_managed_members", "inspect_analysis_view"].includes(
    input.operation,
  ),
);
assert.ok(["SIGINT", "SIGTERM"].includes(input.signal));
assert.ok(["event", "os"].includes(input.delivery));
assert.ok(
  input.operation === "inspect_managed_members"
    ? typeof input.target_path === "string"
    : typeof input.parent_evidence_id === "string",
);
const freeze = Object.freeze;
let queued = false;
Object.freeze = (value) => {
  const frozen = freeze(value);
  if (
    !queued &&
    value &&
    typeof value === "object" &&
    value.operation === input.operation &&
    typeof value.evidence_id === "string" &&
    /^ev_[a-f0-9]{64}$/.test(value.evidence_id) &&
    (input.operation === "inspect_managed_members"
      ? value.subject?.local_path === input.target_path
      : Array.isArray(value.evidence_links) &&
        value.evidence_links.includes(input.parent_evidence_id))
  ) {
    queued = true;
    setImmediate(() => {
      writeFileSync(
        input.marker,
        JSON.stringify({
          operation: input.operation,
          evidence_id: value.evidence_id,
          signal: input.signal,
          delivery: input.delivery,
          listeners: process.listenerCount(input.signal),
        }),
      );
      if (input.delivery === "os") process.kill(process.pid, input.signal);
      else process.emit(input.signal);
    });
  }
  return frozen;
};

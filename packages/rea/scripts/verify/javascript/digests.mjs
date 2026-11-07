#!/usr/bin/env node

import assert from "node:assert/strict";
import { constants } from "node:buffer";
import { createHash } from "node:crypto";

import { digestCanonicalValue } from "../../../dist/domain/canonicalDigest.js";
import {
  createEvidence,
  parseEvidence,
} from "../../../dist/domain/evidence.js";

// This opt-in check crosses the actual engine string limit; keep it outside
// routine source tests. Build first, then run this script with the local Node.
const leaf = "x".repeat(1024 * 1024);
const encodedLeaf = JSON.stringify(leaf);
const count = Math.ceil(constants.MAX_STRING_LENGTH / encodedLeaf.length) + 1;
const value = { payload: Array.from({ length: count }, () => leaf) };
const expected = createHash("sha256");
expected.update('{"payload":[');
for (let index = 0; index < count; index += 1) {
  if (index > 0) expected.update(",");
  expected.update(encodedLeaf);
}
expected.update("]}");
assert.equal(digestCanonicalValue(value), expected.digest("hex"));

const evidence = createEvidence(
  undefined,
  { id: "large-json-fixture", name: "Large JSON fixture", version: "1" },
  { operation: "inspect_fixture", parameters: {}, result: value },
);
assert.equal(parseEvidence(evidence).evidence_id, evidence.evidence_id);
process.stdout.write(
  `${JSON.stringify({
    verified: true,
    serialized_value_bytes: count * encodedLeaf.length + count - 1 + 14,
    engine_string_limit: constants.MAX_STRING_LENGTH,
    evidence_id: evidence.evidence_id,
  })}\n`,
);

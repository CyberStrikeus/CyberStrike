// Reproducible parser/query stress diagnostic; no providers or target execution.
// Run under a process-family resource guard; --parser selects a built revision.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    parser: { type: "string" },
    scenario: { type: "string" },
    count: { type: "string" },
  },
});
assert.ok(
  values.parser?.startsWith("/"),
  "select an absolute built parser path",
);
const count = Number(values.count);
assert.ok(Number.isSafeInteger(count) && count > 0 && count <= 40_000);
assert.ok(["aliases", "signatures"].includes(values.scenario));
const path = resolve(values.parser);
const source = await readFile(path);
const { parseProguardMapping, resolveProguardMethod, resolveProguardClass } =
  await import(pathToFileURL(path).href);
let text;
let descriptor;
if (values.scenario === "aliases") {
  const parameters = Array.from({ length: 255 }, () => "T").join(",");
  text = [
    ...Array.from({ length: count }, () => "T -> t:"),
    "Owner -> a:",
    ...Array.from(
      { length: 1_000 },
      (_, index) => `    void candidate${index}(${parameters}) -> m`,
    ),
  ].join("\n");
  descriptor = `(${"Lt;".repeat(255)})V`;
} else {
  text = [
    "Owner -> a:",
    ...Array.from(
      { length: count },
      (_, index) =>
        `    void run() -> m\n    # {"id":"com.android.tools.r8.residualsignature","signature":"()Lr${index};"}`,
    ),
  ].join("\n");
  descriptor = `()Lr${count - 1};`;
}
const start = performance.now();
const parsed = parseProguardMapping(text);
const parsedAt = performance.now();
assert.ok(parsed.ok, JSON.stringify(parsed));
const answer = resolveProguardMethod(parsed.value, {
  className: "a",
  name: "m",
  descriptor,
});
const completedAt = performance.now();
if (values.scenario === "aliases") {
  assert.equal(answer.status, "ambiguous");
  assert.equal(answer.candidate_count, 1_000);
  const classes = resolveProguardClass(parsed.value, "t");
  assert.equal(classes.status, count === 1 ? "mapped" : "ambiguous");
  if (count > 1) assert.equal(classes.candidate_count, count);
} else {
  assert.equal(answer.status, "mapped");
  const unmatched = resolveProguardMethod(parsed.value, {
    className: "a",
    name: "m",
    descriptor: "()V",
  });
  assert.equal(unmatched.status, "ambiguous");
  assert.equal(unmatched.candidate_count, count);
}
console.log(
  JSON.stringify({
    parser: path,
    parser_sha256: createHash("sha256").update(source).digest("hex"),
    node: process.version,
    scenario: values.scenario,
    count,
    input_bytes: Buffer.byteLength(text),
    parse_ms: parsedAt - start,
    lookup_ms: completedAt - parsedAt,
    answer_sha256: createHash("sha256")
      .update(JSON.stringify(answer))
      .digest("hex"),
    records: parsed.value.records,
  }),
);

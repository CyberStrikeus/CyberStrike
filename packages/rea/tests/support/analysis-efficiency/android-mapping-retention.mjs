#!/usr/bin/env node
// Engine-specific diagnostic; run separately from expensive repository checks.
// Example (parent chooses an allowed CPU):
// taskset -c CPU node --expose-gc --max-old-space-size=256 \
//   tests/support/analysis-efficiency/android-mapping-retention.mjs --repo /absolute/caller/selected/worktree
// No providers, target execution, repository writes, or subprocesses are used.
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setImmediate as immediate } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import v8 from "node:v8";

const argv = process.argv.slice(2);
assert.equal(
  argv.length,
  2,
  "usage: --repo /absolute/caller/selected/worktree",
);
assert.equal(argv[0], "--repo");
const selectedRepo = argv[1];
assert.ok(
  selectedRepo?.startsWith("/"),
  "repo must be explicitly selected and absolute",
);
assert.equal(typeof global.gc, "function", "run node --expose-gc");
assert.ok(
  process.execArgv.includes("--max-old-space-size=256"),
  "use --max-old-space-size=256; this is an old-space bound, not an RSS bound",
);

const COUNT = 4;
const INPUT_BYTES = 10 * 1024 * 1024;
const paths = {
  parser: resolve(selectedRepo, "dist/domain/android/proguardMapping.js"),
  evidence: resolve(selectedRepo, "dist/domain/evidence.js"),
  ledger: resolve(
    selectedRepo,
    "dist/application/investigation/EvidenceLedger.js",
  ),
};
const fingerprints = {};
for (const [name, path] of Object.entries(paths)) {
  const bytes = await readFile(path);
  fingerprints[name] = {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
const { parseProguardMapping, resolveProguardClass, resolveProguardMethod } =
  await import(pathToFileURL(paths.parser).href);
const { createEvidence } = await import(pathToFileURL(paths.evidence).href);
const { EvidenceLedger } = await import(pathToFileURL(paths.ledger).href);

// This explicit UTF-16 byte roundtrip owns new string storage. Concatenation,
// slice(0), substring, template literals and structuredClone are not the control.
function detach(value) {
  if (typeof value === "string")
    return Buffer.from(value, "utf16le").toString("utf16le");
  if (Array.isArray(value)) return value.map(detach);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, detach(child)]),
    );
  }
  return value;
}

function makeInput(paddingBytes, nonce) {
  // Separate inputs have different valid names AND different ignored content;
  // no shared giant literal, interned name, or same-input deduplication oracle.
  const pattern = Buffer.from(
    `# ignored_${nonce}_${"q".repeat(4000)}\n`,
    "ascii",
  );
  const padding = Buffer.alloc(paddingBytes);
  padding.fill(pattern);
  if (padding.length > 0) padding[padding.length - 1] = 10;
  const originalClass = `fixture.OriginalClass_${nonce}`;
  const residualClass = `ResidualClass_${nonce}`;
  const originalMethod = `originalMethod_${nonce}`;
  const residualMethod = `residualMethod_${nonce}`;
  const suffix = Buffer.from(
    `${originalClass} -> ${residualClass}:\n` +
      `    int ${originalMethod}() -> ${residualMethod}\n`,
    "ascii",
  );
  // One decoded flat source, as in a file-buffer decode. Buffer storage itself
  // is not retained; report external/arrayBuffers separately from heapUsed.
  return {
    text: Buffer.concat([padding, suffix]).toString("utf8"),
    originalClass,
    residualClass,
    originalMethod,
    residualMethod,
  };
}

// All text, index, query and assertion temporaries die on returning this frame.
function selectedClaim(selection, detached, paddingBytes = INPUT_BYTES) {
  const nonce = randomBytes(20).toString("hex");
  const input = makeInput(paddingBytes, nonce);
  const parsed = parseProguardMapping(input.text);
  assert.equal(
    parsed.ok,
    true,
    `parse failed: ${JSON.stringify(parsed.error)}`,
  );
  assert.deepEqual(parsed.value.records, {
    classes: 1,
    fields: 0,
    methods: 1,
    malformed: 0,
  });
  const classClaim = resolveProguardClass(parsed.value, input.residualClass);
  const methodClaim = resolveProguardMethod(parsed.value, {
    className: input.residualClass,
    name: input.residualMethod,
    descriptor: "()I",
  });
  assert.deepEqual(classClaim, {
    status: "mapped",
    verified_by: "class",
    mapped: { name: input.originalClass },
  });
  assert.deepEqual(methodClaim, {
    status: "mapped",
    verified_by: "descriptor",
    mapped: {
      class: input.originalClass,
      name: input.originalMethod,
      return_type: "int",
      parameter_types: [],
    },
  });
  const selected =
    selection === "class"
      ? classClaim
      : selection === "method"
        ? methodClaim
        : {
            class: classClaim,
            method: methodClaim,
          };
  const result = detached ? detach(selected) : selected;
  if (detached)
    assert.deepEqual(result, selected, "detachment must preserve exact claims");
  return result;
}

const PROVIDER = {
  id: "string-retention-probe",
  name: "Local GC probe",
  version: "1",
};
function recordSelected(holder, detached, paddingBytes = INPUT_BYTES) {
  const claim = selectedClaim("both", detached, paddingBytes);
  // Real production createEvidence -> immutable snapshot -> real ledger record.
  // There is no JSON stringify/parse inserted as an artificial detachment.
  const evidence = createEvidence(
    undefined,
    PROVIDER,
    {
      operation: "string-retention-probe",
      parameters: {},
      result: claim,
      confidence: "derived",
    },
    { immutable: true },
  );
  assert.ok(Object.isFrozen(evidence));
  assert.ok(Object.isFrozen(evidence.normalized_result));
  assert.deepEqual(evidence.normalized_result, claim);
  assert.deepEqual(holder.ledger.record(evidence), {
    ok: true,
    value: "added",
  });
}

function clearRegexLastMatch() {
  // V8 legacy RegExp statics must not leave the last source as a separate root.
  /^(x)$/.exec("x");
  assert.equal(RegExp.input, "x");
}

async function settledMemory() {
  clearRegexLastMatch();
  // Cross an event-loop checkpoint so completed per-input frames and buffers
  // are dead, then collect repeatedly. No arbitrary wall-clock sleep ordering.
  for (let pass = 0; pass < 4; pass++) {
    await immediate();
    global.gc();
  }
  const { heapUsed, external, arrayBuffers, rss } = process.memoryUsage();
  return { heapUsed, external, arrayBuffers, rss };
}

function delta(after, before) {
  return Object.fromEntries(
    Object.keys(before).map((key) => [key, after[key] - before[key]]),
  );
}

async function phase(label, selection, detached, ledger) {
  const baseline = await settledMemory();
  let holder = ledger ? { ledger: new EvidenceLedger() } : { claims: [] };
  const increments = [];
  for (let index = 0; index < COUNT; index++) {
    if (ledger) recordSelected(holder, detached);
    else holder.claims.push(selectedClaim(selection, detached));
    const current = await settledMemory();
    increments.push({ selected: index + 1, ...delta(current, baseline) });
  }
  if (ledger)
    assert.equal(holder.ledger.immutableBundle().records.length, COUNT);
  else assert.equal(holder.claims.length, COUNT);
  const retained = await settledMemory();
  if (ledger) holder.ledger.clear();
  else holder.claims.length = 0;
  holder = undefined;
  const released = await settledMemory();
  return {
    label,
    selected_packets: COUNT,
    resolved_claims_per_packet: ledger ? 2 : 1,
    ignored_bytes_per_input: INPUT_BYTES,
    baseline,
    increments,
    retained,
    released,
    retained_delta: delta(retained, baseline),
    released_delta: delta(released, baseline),
    released_from_retained: delta(released, retained),
  };
}

// Warm every exact operation before measuring, using only tiny unique inputs.
function warm() {
  selectedClaim("class", false, 0);
  selectedClaim("method", true, 0);
  const holder = { ledger: new EvidenceLedger() };
  recordSelected(holder, false, 0);
  recordSelected(holder, true, 0);
  holder.ledger.clear();
}
warm();
await settledMemory();
console.log(
  JSON.stringify({
    kind: "metadata",
    node: process.version,
    v8: process.versions.v8,
    execArgv: process.execArgv,
    selected_repo: selectedRepo,
    fingerprints,
    heap_size_limit: v8.getHeapStatistics().heap_size_limit,
    note: "Engine-dependent heapUsed experiment; old-space cap is not a process-family/RSS guarantee. No universal string-backing claim follows.",
  }),
);

const results = [];
for (const [label, selection, detached, ledger] of [
  ["bare-class", "class", false, false],
  ["detached-class-control", "class", true, false],
  ["bare-method", "method", false, false],
  ["detached-method-control", "method", true, false],
  ["real-sealed-evidence-ledger", "both", false, true],
  ["detached-real-sealed-evidence-ledger-control", "both", true, true],
]) {
  const result = await phase(label, selection, detached, ledger);
  results.push(result);
  console.log(JSON.stringify({ kind: "phase", ...result }));
}
const byLabel = new Map(results.map((result) => [result.label, result]));
console.log(
  JSON.stringify({
    kind: "comparisons",
    expected_if_four_full_one_byte_sources_remain: COUNT * INPUT_BYTES,
    direct_minus_detached_heap_bytes: Object.fromEntries(
      [
        ["class", "bare-class", "detached-class-control"],
        ["method", "bare-method", "detached-method-control"],
        [
          "ledger",
          "real-sealed-evidence-ledger",
          "detached-real-sealed-evidence-ledger-control",
        ],
      ].map(([name, direct, control]) => [
        name,
        byLabel.get(direct).retained_delta.heapUsed -
          byLabel.get(control).retained_delta.heapUsed,
      ]),
    ),
    direct_minus_detached_external_bytes: Object.fromEntries(
      [
        ["class", "bare-class", "detached-class-control"],
        ["method", "bare-method", "detached-method-control"],
        [
          "ledger",
          "real-sealed-evidence-ledger",
          "detached-real-sealed-evidence-ledger-control",
        ],
      ].map(([name, direct, control]) => [
        name,
        byLabel.get(direct).retained_delta.external -
          byLabel.get(control).retained_delta.external,
      ]),
    ),
    interpretation:
      "Require growth near one complete source per selected packet, substantially smaller detached controls, AND corresponding release-phase drops. If bare values retain but real sealed ledger does not, the ledger hypothesis is disproven here. If neither does, do not propose a detachment fix. Unexpected residual growth or an inconclusive contrast needs investigation, not an assertion of leakage.",
  }),
);

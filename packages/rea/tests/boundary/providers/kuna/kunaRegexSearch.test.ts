import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, it as test } from "vitest";

import { session } from "./kunaSessionFixture.js";

const it = test.skipIf(process.platform === "win32");

it.each([
  { mode: "cancel", operation: "search_procedures" },
  { mode: "deadline", operation: "search_procedures" },
  { mode: "cancel", operation: "search_strings" },
  { mode: "deadline", operation: "search_strings" },
  { mode: "close", operation: "search_strings" },
])(
  "bounds $operation regex $mode and settles its worker",
  async ({ mode, operation }) => {
    const { kuna, target, cacheRoot, profile } = await session(
      "rea-kuna-regex-",
      {
        stringRows: [
          { text: `${"a".repeat(40)}!`, address: 4096 },
          { text: "Δelta", address: 4160, encoding: "utf8" },
        ],
        functions: [
          { name: `${"a".repeat(40)}!`, addr: "0x1000" },
          { name: "Δelta", addr: "0x1040" },
        ],
      },
    );
    // A parent watchdog bounds this regression even if matching freezes the
    // child's event loop. All Kuna commands finish before adversarial matching.
    const script = `
import assert from "node:assert/strict";
import { KunaProvider } from ${JSON.stringify(pathToFileURL(resolve("dist/kuna/KunaProvider.js")).href)};
const provider = new KunaProvider(${JSON.stringify({ REA_KUNA_COMMAND: kuna, REA_KUNA_CACHE_DIR: cacheRoot })});
const client = provider.createClient(${JSON.stringify(target)}, ${JSON.stringify(profile)});
try {
  assert.equal((await client.execute(${JSON.stringify(operation === "search_strings" ? "list_strings" : "procedure_assembly")}, ${operation === "search_strings" ? "{}" : '{procedure:"0x1000"}'})).ok, true);
  const options = ${mode === "cancel" ? "{signal:AbortSignal.timeout(100)}" : "{}"};
  let closing;
  if (${JSON.stringify(mode)} === "close") setTimeout(() => { closing = client.close(); }, 100);
  const matched = await client.execute(${JSON.stringify(operation)}, {pattern:"^(a+)+$",mode:"regex"}, options);
  assert.equal(matched.ok, false);
  assert.equal(matched.error._tag, ${JSON.stringify(mode !== "deadline" ? "AnalysisCancelledError" : "AnalysisResourceConstraintError")});
  if (${JSON.stringify(mode)} === "deadline") {
    assert.equal(matched.error.resource, "cpu");
    assert.equal(matched.error.reportedLimits.matching_deadline_ms, 5000);
    assert.equal(matched.error.reportedLimits.matching_deadline_source, "default");
    assert.equal(matched.error.reason.includes("REA_REGEX_MATCHING_DEADLINE_MS"), true);
    assert.equal(matched.error.remediationAction.includes("REA_REGEX_MATCHING_DEADLINE_MS"), true);
    assert.equal(matched.error.reason.includes("no runtime override"), false);
    assert.equal(matched.error.remediationAction.includes("no runtime override"), false);
    const limitation = provider.capabilities().find((capability) => capability.operation === ${JSON.stringify(operation)}).limitations.join(" ");
    assert.equal(limitation.includes("REA_REGEX_MATCHING_DEADLINE_MS"), true);
    assert.equal(limitation.includes("source default"), true);
    assert.equal(limitation.includes("no runtime override"), false);
  }
  if (${JSON.stringify(mode)} === "close") {
    assert.equal((await closing).ok, true);
    assert.equal((await client.execute("health", {})).ok, false);
  } else {
  assert.equal((await client.execute("health", {})).ok, true);
  const unicode = await client.execute(${JSON.stringify(operation)}, {pattern:"^δ",mode:"regex"});
  assert.equal(unicode.ok, true);
  assert.deepEqual(unicode.value.result.map(({address,value}) => ({address,value})), [{address:"0x1040",value:"Δelta"}]);
  const invalid = await client.execute(${JSON.stringify(operation)}, {pattern:"[",mode:"regex"});
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error._tag, "AnalysisInputError");
  const literal = await client.execute(${JSON.stringify(operation)}, {pattern:"^(a+)+$"});
  assert.equal(literal.ok, true);
  assert.deepEqual(literal.value.result, []);
  }
} finally {
  assert.equal((await client.close()).ok, true);
}
console.log("bounded and healthy");
`;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        encoding: "utf8",
        timeout: 25_000,
        killSignal: "SIGKILL",
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("bounded and healthy");
  },
);

it("uses REA_REGEX_MATCHING_DEADLINE_MS from the selected environment", async () => {
  const { kuna, target, cacheRoot, profile } = await session(
    "rea-kuna-regex-deadline-",
    {
      functions: [
        { name: `${"a".repeat(40)}!`, addr: "0x1000" },
        { name: "Δelta", addr: "0x1040" },
      ],
    },
  );
  const script = `
import assert from "node:assert/strict";
import { KunaProvider } from ${JSON.stringify(pathToFileURL(resolve("dist/kuna/KunaProvider.js")).href)};
process.env.REA_REGEX_MATCHING_DEADLINE_MS = "10000";
const provider = new KunaProvider(${JSON.stringify({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: cacheRoot,
    REA_REGEX_MATCHING_DEADLINE_MS: "200",
  })});
const limitation = provider.capabilities().find((capability) => capability.operation === "search_procedures").limitations.join(" ");
assert.equal(limitation.includes("REA_REGEX_MATCHING_DEADLINE_MS"), true);
assert.equal(limitation.includes("200"), true);
assert.equal(limitation.includes("source setting"), true);
assert.equal(limitation.includes("no runtime override"), false);
const client = provider.createClient(${JSON.stringify(target)}, ${JSON.stringify(profile)});
try {
  assert.equal((await client.execute("procedure_assembly", {procedure:"0x1000"})).ok, true);
  const started = performance.now();
  const matched = await client.execute("search_procedures", {pattern:"^(a+)+$",mode:"regex"});
  assert.ok(performance.now() - started < 4000, "deadline stayed at the 5000 ms default");
  assert.equal(matched.ok, false);
  assert.equal(matched.error._tag, "AnalysisResourceConstraintError");
  assert.equal(matched.error.resource, "cpu");
  assert.equal(matched.error.reportedLimits.matching_deadline_ms, 200);
  assert.equal(matched.error.reportedLimits.matching_deadline_source, "setting");
  assert.equal(matched.error.reason.includes("REA_REGEX_MATCHING_DEADLINE_MS"), true);
  assert.equal(matched.error.remediationAction.includes("REA_REGEX_MATCHING_DEADLINE_MS"), true);
  assert.equal(matched.error.reason.includes("source setting"), true);
  assert.equal(matched.error.reason.includes("no runtime override"), false);
} finally {
  assert.equal((await client.close()).ok, true);
}
console.log("override applied");
`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      encoding: "utf8",
      timeout: 25_000,
      killSignal: "SIGKILL",
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("override applied");
});

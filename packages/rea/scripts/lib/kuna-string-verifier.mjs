import assert from "node:assert/strict";
import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { runKunaCommand } from "../../dist/kuna/KunaCommand.js";
import { kunaProjectDeadline } from "../../dist/kuna/KunaConfiguration.js";
import { inspectKunaInstallation } from "../../dist/kuna/KunaInstallation.js";

const entries = (path) =>
  readdir(path).catch((cause) => {
    if (cause.code === "ENOENT") return [];
    throw cause;
  });

/** Independent native oracle; uses source hex fields rather than JS numeric addresses. */
export const nativeKunaStrings = async ({
  executable,
  cacheRoot,
  workspace,
  binary,
  retain,
  resourceScope,
}) => {
  const installed = await inspectKunaInstallation(
    {
      REA_KUNA_COMMAND: executable,
      REA_KUNA_CACHE_DIR: cacheRoot,
    },
    { resourceScope },
  );
  assert.ok(installed.ok, "Native string oracle could not inspect Kuna");
  const input = await realpath(binary);
  const outcome = await runKunaCommand({
    installation: installed.value,
    arguments: [
      "strings",
      input,
      "--json",
      "--encoding",
      "all",
      "--min-length",
      "5",
      "--termination",
      "any",
      "--no-xrefs",
    ],
    workspace,
    operation: "verify:kuna-native-strings",
    timeoutMs: installed.value.configuration.projectTimeoutMs,
    deadline: kunaProjectDeadline(installed.value.configuration),
    outputBytes: 16 * 1024 * 1024,
    signal: new AbortController().signal,
    retainFailedFileClose: (owner, resource) =>
      resourceScope.retain(owner, resource),
  });
  if (outcome.kind === "retained") retain(outcome);
  if (outcome.kind !== "ok") throw outcome.error;
  const document = JSON.parse(outcome.snapshot.stdout.text);
  assert.equal(document.binary, input);
  assert.equal(document.count, document.strings.length);
  assert.equal(document.xrefs, false);
  return document.strings
    .map((row) => ({
      address: row.address_hex,
      value: row.text,
      string: {
        encoding: row.encoding,
        encoding_status: "observed",
        termination: row.nul_terminated ? "present_or_not_required" : "missing",
        byte_length: row.byte_length,
      },
    }))
    .sort((left, right) => {
      const a = BigInt(left.address),
        b = BigInt(right.address);
      return a < b
        ? -1
        : a > b
          ? 1
          : left.string.encoding.localeCompare(right.string.encoding, "en");
    });
};

/** Verify focused/complete string operations before any procedure analysis starts. */
export const verifyKunaStrings = async ({
  call,
  cacheRoot,
  nativeStrings,
  expectedStrings = [],
}) => {
  const expected = await nativeStrings();
  if (expectedStrings.length > 0)
    assert.ok(
      expected.length > 0,
      "Source-owned string fixture did not exercise a positive result",
    );
  const pattern =
    expected.find(({ value }) => value.length >= 8 && value.length <= 100)
      ?.value ??
    expected[0]?.value ??
    "REA-empty-string-inventory";
  const selected = expected.filter(({ value }) =>
    value.toLowerCase().includes(pattern.toLowerCase()),
  );
  const before = await Promise.all([
    entries(join(cacheRoot, "projects")),
    entries(join(cacheRoot, "staging")),
  ]);
  const cold = await call("search_strings", { pattern });
  assert.deepEqual(
    cold.value,
    selected,
    "String search differs from native scan",
  );
  const source = cold.structured.raw_result.strings;
  assert.equal(source.inventory_count, expected.length);
  assert.equal(source.selected_count, selected.length);
  assert.equal(source.xrefs, false);
  assert.match(source.sha256, /^[0-9a-f]{64}$/u);
  assert.ok(source.bytes > 0);
  assert.equal(cold.structured.provider.id, "kuna");
  assert.ok(cold.structured.evidence_id);
  const complete = await call("list_strings");
  assert.deepEqual(complete.value, expected);
  for (const value of expectedStrings)
    assert.ok(
      complete.value.some((row) => row.value === value),
      `Required string ${JSON.stringify(value)} was not recovered`,
    );
  assert.equal(complete.structured.raw_result.strings.sha256, source.sha256);
  const repeated = await call("search_strings", { pattern });
  assert.deepEqual(repeated.value, selected);
  let exact;
  if (selected.length > 0) {
    const address = selected[0].address;
    exact = await call("list_strings", { address });
    assert.deepEqual(
      exact.value,
      expected.filter((item) => item.address === address),
    );
  }
  const regex = await call("search_strings", {
    pattern: "^.{5,12}$",
    mode: "regex",
    case_sensitive: true,
  });
  assert.deepEqual(
    regex.value,
    expected.filter(({ value }) => /^.{5,12}$/u.test(value)),
  );
  const missing = await call("search_strings", {
    pattern: "\u0000REA-negative-string-query\u0000",
  });
  assert.deepEqual(missing.value, []);
  assert.deepEqual(
    await Promise.all([
      entries(join(cacheRoot, "projects")),
      entries(join(cacheRoot, "staging")),
    ]),
    before,
    "String reads started a project export",
  );
  return {
    inventory_count: expected.length,
    selected_count: selected.length,
    cold_scan_ms: cold.ms,
    warm_search_ms: repeated.ms,
    exact_address_ms: exact?.ms ?? null,
    cold_response_bytes: cold.bytes,
    complete_response_bytes: complete.bytes,
    regex_response_bytes: regex.bytes,
  };
};

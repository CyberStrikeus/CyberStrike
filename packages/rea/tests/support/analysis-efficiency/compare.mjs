import { isDeepStrictEqual, parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PACKET_ARTIFACTS } from "./packet-entry.mjs";
import { SIGNAL_ARTIFACTS } from "./signal-entry.mjs";

const { values } = parseArgs({
  options: {
    left: { type: "string" },
    right: { type: "string" },
    output: { type: "string" },
  },
});
if (!values.left || !values.right)
  throw new Error(
    "Use --left MEASUREMENT_DIR --right MEASUREMENT_DIR [--output JSON]",
  );
const read = async (directory, name) =>
  JSON.parse(await readFile(resolve(directory, name), "utf8"));
const left = await read(values.left, "summary.json");
const right = await read(values.right, "summary.json");
const leftAnswer = await read(values.left, "answer.json");
const rightAnswer = await read(values.right, "answer.json");
const sameSettings = [
  "artifact",
  "artifact_sha256",
  "artifact_sha256_after",
  "retained_verification",
  "native_question",
  "javascript_question",
  "managed_question",
  "provider_settings_sha256",
  "provider_search_path_sha256",
  "provider_environment_policy_sha256",
  "measure_source_sha256",
  "native_workflow_source_sha256",
  "packet_workflow_source_sha256",
  "packet_oracle_source_sha256",
  "signal_workflow_source_sha256",
  "signal_oracle_source_sha256",
  "package_lock_sha256",
  "node_version",
  "sdk_client_version",
  "sdk_server_version",
  "platform",
  "architecture",
];
const settingDifferences = sameSettings.filter(
  (key) =>
    !isDeepStrictEqual(left[key], right[key]) ||
    ((key === "provider_search_path_sha256" ||
      (key === "native_workflow_source_sha256" &&
        typeof left.native_question === "string")) &&
      !/^[a-f0-9]{64}$/.test(left[key] ?? "")),
);
// Producer/view IDs identify different delivery observations; a named recovery
// describes the delivery path. All selected analyst facts still must agree.
const facts = (answer) =>
  Object.fromEntries(
    Object.entries(answer).filter(
      ([key]) => key !== "evidence_ids" && key !== "recovery",
    ),
  );
const a = facts(leftAnswer);
const b = facts(rightAnswer);
const runSpecific = [];
for (const [side, answer] of [
  ["left", leftAnswer],
  ["right", rightAnswer],
]) {
  if (Object.hasOwn(answer, "evidence_ids"))
    runSpecific.push({
      side,
      path: ["evidence_ids"],
      value: answer.evidence_ids,
    });
}
// Recording delivery observations preserve each actual receipt's identity, limitations
// and view coverage. Summary/page scopes differ from complete source scope;
// retain them separately rather than equating page exhaustion with capture
// coverage. Repeated equivalent deliveries must also match every observation
// field except the receipt and parent IDs, which identify their own invocations.
if (
  Object.hasOwn(PACKET_ARTIFACTS, left.artifact) ||
  Object.hasOwn(SIGNAL_ARTIFACTS, left.artifact) ||
  ["wireshark-http.cap", "wireshark-http_redirects.pcapng"].includes(
    left.artifact,
  )
) {
  for (const [side, answer] of [
    ["left", a],
    ["right", b],
  ]) {
    if (
      !Array.isArray(answer.delivery_observations) ||
      !answer.delivery_observations.length
    )
      throw new Error("Missing original recording delivery observations");
    runSpecific.push({
      side,
      path: ["delivery_observations"],
      value: answer.delivery_observations,
    });
    if (
      left.delivery === right.delivery &&
      (!Object.hasOwn(PACKET_ARTIFACTS, left.artifact) ||
        left.packet_selection === right.packet_selection) &&
      (!Object.hasOwn(SIGNAL_ARTIFACTS, left.artifact) ||
        left.signal_selection === right.signal_selection)
    ) {
      answer.delivery_observations = answer.delivery_observations.map(
        (observation) =>
          Object.fromEntries(
            Object.entries(observation).filter(
              ([key]) => key !== "evidence_id" && key !== "parent_evidence_id",
            ),
          ),
      );
    } else {
      delete answer.delivery_observations;
    }
  }
}
// Binwalk assigns a new opaque region UUID in each invocation. Preserve both
// original lookup values in this report; compare the observed region facts
// separately. The product and original replies retain those IDs unchanged.
if (left.artifact === "openwrt.bin") {
  for (const [side, answer] of [
    ["left", a],
    ["right", b],
  ]) {
    for (const [index, region] of answer.result.regions.entries()) {
      runSpecific.push({
        side,
        path: ["result", "regions", index, "provider_id"],
        value: region.provider_id,
      });
      delete region.provider_id;
    }
  }
}
// JavaScript result budgets depend on observed parent heap availability.
// Preserve their exact values on both sides, then compare the coverage facts
// and fixed worker limits. Never exclude status, omitted counts or families.
if (
  left.artifact === "obsidian.asar" &&
  left.javascript_question === "selected"
) {
  const dynamicBudgets = new Set([
    "javascript_analysis_parent_available_result_budget_bytes",
    "javascript_analysis_parent_result_budget_bytes",
  ]);
  for (const [side, answer] of [
    ["left", a],
    ["right", b],
  ]) {
    for (const layer of ["application", "semantic"]) {
      for (const [index, limit] of answer.coverage[layer].limits.entries()) {
        if (!dynamicBudgets.has(limit.name) || limit.unit !== "bytes") continue;
        runSpecific.push({
          side,
          path: ["coverage", layer, "limits", index, "value"],
          name: limit.name,
          unit: limit.unit,
          value: limit.value,
        });
        delete limit.value;
      }
    }
  }
}
const factDifferences = [
  ...new Set([...Object.keys(a), ...Object.keys(b)]),
].filter((key) => !isDeepStrictEqual(a[key], b[key]));
const cost = (report) => ({
  revision: report.revision,
  runtime_files_sha256: report.runtime_files_sha256,
  delivery: report.delivery,
  sdk_schema_mode: report.sdk_schema_mode,
  elapsed_ms: report.elapsed_ms,
  catalog_json_utf8_bytes: report.catalog_json_utf8_bytes,
  calls: report.calls.length,
  observed_tool_errors: report.calls.filter((call) => call.is_error).length,
  client_result_json_utf8_bytes: report.calls.reduce(
    (sum, call) => sum + (call.client_result_json_utf8_bytes ?? 0),
    0,
  ),
  client_before_send_ms: report.calls.reduce(
    (sum, call) => sum + (call.client_before_send_ms ?? 0),
    0,
  ),
  transport_roundtrip_ms: report.calls.reduce(
    (sum, call) => sum + (call.transport_roundtrip_ms ?? 0),
    0,
  ),
  client_after_receive_ms: report.calls.reduce(
    (sum, call) => sum + (call.client_after_receive_ms ?? 0),
    0,
  ),
});
const comparison = {
  artifact: left.artifact,
  artifact_sha256: left.artifact_sha256,
  settings_match: settingDifferences.length === 0,
  setting_differences: settingDifferences,
  facts_match: factDifferences.length === 0,
  fact_differences: factDifferences,
  preserved_run_specific_values: runSpecific,
  workflow_failures: [left.failure, right.failure],
  left: cost(left),
  right: cost(right),
  scope:
    "Same selected analyst facts; includes extra view calls and preserves observed tool errors. Result JSON bytes exclude file exports, catalog responses and raw wire framing. This is one paired observation, not a statistical speedup or independent ground-truth proof.",
};
const text = JSON.stringify(comparison, null, 2) + "\n";
if (values.output) await writeFile(values.output, text, { flag: "wx" });
process.stdout.write(text);
if (
  settingDifferences.length ||
  factDifferences.length ||
  left.failure ||
  right.failure
)
  process.exitCode = 1;

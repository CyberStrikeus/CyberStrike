import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_CHECKS = [
  "positive_decimal",
  "unsigned32_literal_not_rewritten",
  "negative_embedded_token_sign",
  "negative_hex",
  "zero",
  "magnitude_mismatch_unknown",
  "signed_encoding_is_not_magnitude",
  "symbol_label_unknown",
  "compound_label_unknown",
  "safe_positive_boundary",
  "safe_negative_boundary",
  "safe_hex_boundary",
  "unsafe_positive_unknown",
  "unsafe_negative_unknown",
  "unsigned64_unknown",
  "no_dispatch_not_attributed",
  "unique_dispatch_block_start",
  "instruction_offset_is_not_destination",
  "wrong_dispatch_not_attributed",
  "target_not_in_table_not_attributed",
  "signed_and_positive_distinct",
  "shared_destination_keeps_all_labels",
  "default_ordinary_off_is_role",
  "default_and_numeric_can_share_target",
  "unsafe64_target_preserved_unknown",
  "magnitude_mismatch_target_preserved_unknown",
  "conflicting_value_retracted",
  "conflicting_destinations_preserved_unknown",
  "api_first_dispatch_is_insufficient",
  "multiple_dispatches_rejected",
  "multiple_dispatch_target_preserved_unknown",
  "multiple_dispatch_rejected_for_other_table",
];

/** Exercise actual bridge methods on detached Ghidra objects with owned process cleanup. */
export async function verifySwitchEvidenceControls({
  installation,
  entrypoint,
  target,
  workspace,
  runId,
}) {
  const { spawnOwnedProviderProcess, ProviderProcessSupervisor } =
    await import("../dist/process/ProviderProcess.js");
  const { cleanupOwnedProcessGroup } =
    await import("../dist/process/ProcessOwnership.js");
  const bridge = await realpath(
    join(dirname(entrypoint), "../bridge/ghidra/ReaGhidraBridge.java"),
  );
  const fixtures = fileURLToPath(
    new URL("../tests/conformance/ghidra", import.meta.url),
  );
  const project = join(workspace, "guard-project");
  await mkdir(project);
  const sourceDigest = digest(await readFile(bridge));
  const targetDigest = digest(await readFile(target));
  const launch = await spawnOwnedProviderProcess({
    command: installation.analyzeHeadlessPath,
    arguments: [
      project,
      "SwitchEvidence",
      "-import",
      target,
      "-noanalysis",
      "-readOnly",
      "-scriptPath",
      `${fixtures};${dirname(bridge)}`,
      "-postScript",
      "ReaSwitchEvidenceProbe.java",
      bridge,
      "-deleteProject",
    ],
    runId,
    expectedCommand: null,
  });
  const supervisor = new ProviderProcessSupervisor({
    ...launch,
    ownsProcessLifetime: true,
    cleanup: () => cleanupOwnedProcessGroup(launch.ownership),
  });
  try {
    assert.ok(
      await supervisor.waitForExit(120000),
      "Production switch guard lane exceeded its 120-second headless deadline",
    );
    const snapshot = supervisor.snapshot();
    const output = `${snapshot.stdout.text}\n${snapshot.stderr.text}`;
    assert.equal(snapshot.exitCode, 0, output);
    const reports = [
      ...output.matchAll(/REA_SWITCH_EVIDENCE_PROBE_JSON (\{[^\r\n]*\})/gu),
    ];
    assert.equal(
      reports.length,
      1,
      `Expected one production guard report: ${output}`,
    );
    assert.ok(output.includes("REA_SWITCH_EVIDENCE_PROBE_COMPLETE"), output);
    const report = JSON.parse(reports[0][1]);
    assertControlReport(
      report,
      bridge,
      sourceDigest,
      installation.providerVersion,
    );
    assert.equal(
      digest(await readFile(bridge)),
      sourceDigest,
      "Guard modified bridge source",
    );
    assert.equal(
      digest(await readFile(target)),
      targetDigest,
      "Guard modified imported fixture bytes",
    );
    return report;
  } finally {
    const stopped = await supervisor.stop();
    supervisor.dispose();
    assert.notEqual(stopped.status, "incomplete", JSON.stringify(stopped));
  }
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertControlReport(report, bridge, sourceDigest, version) {
  assert.ok(
    typeof report === "object" && report !== null && !Array.isArray(report),
  );
  assert.equal(report.schema_version, 1);
  assert.equal(report.status, "passed");
  assert.equal(report.ghidra_version, version);
  assert.equal(report.bridge_source_path, bridge);
  assert.equal(report.bridge_source_sha256, sourceDigest);
  assert.ok(Array.isArray(report.checks));
  assert.deepEqual(
    [...report.checks].sort(),
    [...EXPECTED_CHECKS].sort(),
    "Production guard did not execute every required case",
  );
  assert.equal(report.check_count, EXPECTED_CHECKS.length);
  assert.ok(
    typeof report.scope === "string" &&
      report.scope.includes("detached Ghidra model objects"),
  );
}

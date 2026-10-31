#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  spawnOwnedProviderProcess,
  ProviderProcessSupervisor,
} from "../../../dist/process/ProviderProcess.js";
import { cleanupOwnedProcessGroup } from "../../../dist/process/ProcessOwnership.js";
import { createVerifierRun } from "../../lib/verifier-run.mjs";

const installation = process.env.GHIDRA_INSTALL_DIR;
assert.ok(
  installation && isAbsolute(installation),
  "Set GHIDRA_INSTALL_DIR to a local Ghidra installation",
);
assert.notEqual(
  process.platform,
  "win32",
  "This direct headless regression requires a POSIX host; Windows uses its controlled provider lane",
);
const workspace = await mkdtemp(join(tmpdir(), "rea-ghidra-seed-regression-"));
const run = createVerifierRun();
let supervisor;
try {
  const target = join(workspace, "seed-functions.bin");
  const seeds = join(workspace, "seeds.tsv");
  // Falling through from the lower entry reaches the higher entry. Creating
  // the higher function first is what keeps the two function bodies separate.
  await writeFile(target, Buffer.from([0x90, 0x90, 0xc3]));
  await writeFile(
    seeds,
    [
      "0x0\tfunction\tseed_low",
      "0x100000000\tfunction\tout_of_range",
      "0x1\tfunction\tseed_high",
      "0x1000\tlabel\tseed_global",
      "0x1000\tcode",
      "",
    ].join("\n"),
  );
  const output = await runHeadless(target, "seed-regression", [
    "-postScript",
    "ReaSeedRegressionProbe.java",
    seeds,
  ]);
  // Headless can exit zero after a script fails, so require the probe's marker.
  assert.ok(output.includes("REA_SEED_REGRESSION_OK "), output);

  const analyzer = "Decompiler Switch Analysis";
  const disabled = await runHeadless(target, "analyzer-regression-valid", [
    "-preScript",
    "ReaGhidraAnalysisOptions.java",
    analyzer,
    "-postScript",
    "ReaAnalyzerOptionsRegressionProbe.java",
    analyzer,
  ]);
  assert.ok(
    disabled.includes(`REA_ANALYZER_OPTIONS_DISABLED_OK ${analyzer}`),
    disabled,
  );

  // Installed, but Ghidra registers it only for Objective-C 2 Mach-O programs.
  const formatSpecificAnalyzer = "Objective-C Message Analyzer";
  const notApplicable = await runHeadless(
    target,
    "analyzer-regression-not-applicable",
    [
      "-preScript",
      "ReaGhidraAnalysisOptions.java",
      `${analyzer},${formatSpecificAnalyzer}`,
      "-postScript",
      "ReaAnalyzerOptionsRegressionProbe.java",
      analyzer,
    ],
  );
  assert.ok(
    notApplicable.includes(
      `REA_ANALYZER_OPTIONS_REPORT ${JSON.stringify({
        format: "rea-ghidra-disabled-analyzers-v1",
        analyzers: [
          { name: analyzer, status: "disabled" },
          { name: formatSpecificAnalyzer, status: "not_applicable" },
        ],
      })}`,
    ),
    notApplicable,
  );

  const unknownAnalyzer = "REA Unknown Analyzer";
  const rejected = await runHeadless(target, "analyzer-regression-unknown", [
    "-preScript",
    "ReaGhidraAnalysisOptions.java",
    `${analyzer},${unknownAnalyzer}`,
    "-postScript",
    "ReaAnalyzerOptionsRegressionProbe.java",
    analyzer,
  ]);
  assert.ok(
    rejected.includes(
      `REA_GHIDRA_DISABLED_ANALYZERS names ${unknownAnalyzer}, which is not an analyzer in this Ghidra installation`,
    ),
    rejected,
  );
  assert.ok(
    rejected.includes("Processing aborted as a result of pre-script."),
    rejected,
  );
  assert.ok(!rejected.includes("REA_ANALYZER_OPTIONS_DISABLED_OK"), rejected);
} finally {
  if (supervisor !== undefined) {
    const stopped = await supervisor.stop();
    assert.notEqual(stopped.status, "incomplete", JSON.stringify(stopped));
    supervisor.dispose();
  }
  await rm(workspace, { recursive: true, force: true });
}
console.log(
  "Real Ghidra pre-script regression passed: descending function order, out-of-range seed, BSS label, BSS code rejection, analyzer option readback, not-applicable analyzer report, unknown-analyzer abort before post-scripts, and owned-process cleanup.",
);

async function runHeadless(target, project, scriptArguments) {
  const launch = await spawnOwnedProviderProcess({
    command: join(installation, "support", "analyzeHeadless"),
    arguments: [
      workspace,
      project,
      "-import",
      target,
      "-loader",
      "BinaryLoader",
      "-processor",
      "x86:LE:32:default",
      "-noanalysis",
      "-readOnly",
      "-deleteProject",
      "-scriptPath",
      [
        fileURLToPath(new URL("../../../bridge/ghidra", import.meta.url)),
        fileURLToPath(
          new URL("../../../tests/conformance/ghidra", import.meta.url),
        ),
      ].join(";"),
      ...scriptArguments,
    ],
    runId: run.run_id,
    expectedCommand: null,
  });
  supervisor = new ProviderProcessSupervisor({
    ...launch,
    ownsProcessLifetime: true,
    cleanup: () => cleanupOwnedProcessGroup(launch.ownership),
  });
  assert.ok(
    await supervisor.waitForExit(180_000),
    "Ghidra seed regression exceeded its startup deadline",
  );
  const snapshot = supervisor.snapshot();
  const output = `${snapshot.stdout.text}\n${snapshot.stderr.text}`;
  assert.equal(snapshot.exitCode, 0, output);
  const stopped = await supervisor.stop();
  assert.notEqual(stopped.status, "incomplete", JSON.stringify(stopped));
  supervisor.dispose();
  supervisor = undefined;
  return output;
}

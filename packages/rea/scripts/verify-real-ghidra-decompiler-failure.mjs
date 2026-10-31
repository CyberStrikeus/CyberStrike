import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseBinaryTarget } from "../dist/application/BinaryTargetResolver.js";
import { parseConfig } from "../dist/config/parseConfig.js";
import { GhidraClient } from "../dist/ghidra/GhidraClient.js";
import { parseGhidraFunctionResult } from "../dist/ghidra/GhidraFunctionValues.js";
import { inspectVerifierGhidraInstallation } from "./lib/ghidra-installation-inspection.mjs";
import { SUPPORTED_GHIDRA_VERSION } from "../dist/ghidra/GhidraReleasePolicy.js";
import { GhidraProvider } from "../dist/ghidra/GhidraProvider.js";
import { silentLogger } from "../dist/logger.js";
import { cleanupOwnedProcessGroup } from "../dist/process/ProcessOwnership.js";
import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
} from "../dist/process/ProviderProcess.js";
import {
  OwnedCommandFailure,
  runOwnedCommand,
} from "../dist/process/OwnedCommand.js";
import {
  assertVerifierCleanupComplete,
  completeVerifierRun,
  createVerifierRun,
} from "./lib/verifier-run.mjs";

const run = createVerifierRun();
assert.ok(
  process.platform === "linux" || process.platform === "darwin",
  "This regression lane requires Linux or macOS",
);
assert.ok(
  process.arch === "x64" || process.arch === "arm64",
  "This regression lane requires x86-64 or arm64",
);
const config = parseConfig(process.env);
if (!config.ok) throw config.error;
const installation = await inspectVerifierGhidraInstallation({
  environment: process.env,
  installDir: config.value.ghidraInstallDir,
  javaHome: config.value.ghidraJavaHome,
});
assert.equal(installation.status, "available", JSON.stringify(installation));
assert.equal(installation.providerVersion, SUPPORTED_GHIDRA_VERSION);
const fixtures = fileURLToPath(
  new URL("../tests/conformance/ghidra", import.meta.url),
);
const bridge = fileURLToPath(new URL("../bridge/ghidra", import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), "rea-ghidra-decompiler-"));
let cleaned = true;
let report;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const injected = "Ghidra decompilation failed: Injected backend failure";
try {
  const targetPath = join(
    workspace,
    process.platform === "darwin" ? "cross-format.dylib" : "cross-format.so",
  );
  const compiler = {
    command: process.env.REA_CC ?? "cc",
    arguments: [
      ...(process.platform === "darwin" ? ["-dynamiclib"] : ["-shared"]),
      "-fPIC",
      "-O0",
      // Bind this source-owned fixture's calls to its own definitions on ELF.
      ...(process.platform === "linux" ? ["-Wl,-Bsymbolic"] : []),
      join(fixtures, "cross-format.c"),
      "-o",
      targetPath,
    ],
  };
  cleaned = false;
  try {
    await runOwnedCommand(
      {
        ...compiler,
        runId: run.run_id,
        expectedCommand: null,
      },
      { timeoutMs: 60_000, diagnosticBytes: 1024 * 1024 },
    );
    cleaned = true;
  } catch (cause) {
    cleaned =
      cause instanceof OwnedCommandFailure && cause.cleanupOwner === undefined;
    throw cause;
  }
  const targetDigest = digest(await readFile(targetPath));
  const bridgeDigest = digest(
    await readFile(join(bridge, "ReaGhidraBridge.java")),
  );
  const project = join(workspace, "project");
  await mkdir(project);
  cleaned = false;
  const launch = await spawnOwnedProviderProcess({
    command: installation.analyzeHeadlessPath,
    arguments: [
      project,
      "DecompilerFailure",
      "-import",
      targetPath,
      "-readOnly",
      "-deleteProject",
      "-scriptPath",
      `${fixtures};${bridge}`,
      "-postScript",
      join(fixtures, "ReaDecompilerFailureProbe.java"),
      bridge,
    ],
    runId: run.run_id,
    expectedCommand: null,
  });
  const supervisor = new ProviderProcessSupervisor({
    ...launch,
    ownsProcessLifetime: true,
    cleanup: () => cleanupOwnedProcessGroup(launch.ownership),
  });
  let probe;
  try {
    assert.ok(
      await supervisor.waitForExit(180000),
      "Decompiler failure probe timed out",
    );
    assert.ok(
      await supervisor.waitForOutputClose(1000),
      "Decompiler failure probe output did not close",
    );
    const snapshot = supervisor.snapshot();
    const output = `${snapshot.stdout.text}\n${snapshot.stderr.text}`;
    assert.equal(snapshot.exitCode, 0, output);
    const reports = [
      ...output.matchAll(/REA_DECOMPILER_FAILURE_PROBE_JSON (\{[^\r\n]*\})/gu),
    ];
    assert.equal(reports.length, 1, output);
    probe = JSON.parse(reports[0][1]);
    assert.equal(probe.status, "passed");
    assert.equal(probe.ghidra_version, SUPPORTED_GHIDRA_VERSION);
    assert.equal(probe.target_sha256, targetDigest);
    assert.equal(probe["ReaGhidraBridge.java"], bridgeDigest);
    for (const check of [
      "regex_failure_preserves_stage_and_pattern",
      "regex_failure_leaves_lifecycle_to_provider",
      "pseudocode_unavailable_with_failure",
      "native_api_unavailable_with_failure",
      "native_value_flow_unavailable_with_failure",
      "listing_facet_unchanged_assembly",
      "listing_facet_unchanged_callers",
      "listing_facet_unchanged_callees",
      "listing_facet_unchanged_basic_blocks",
      "relationship_coverage_unchanged",
      "failure_limitation_named",
      "pseudocode_request_still_fails",
      "cancellation_still_ends_request",
      "timed_out_decompile_is_live",
      "timed_out_pseudocode_names_limit",
      "timed_out_native_api_names_limit",
      "timed_out_listing_unchanged",
      "timed_out_pseudocode_request_names_limit",
      "session_recovers_after_failure",
    ])
      assert.ok(probe.checks.includes(check), check);
  } finally {
    const stopped = await supervisor.stop();
    cleaned = stopped.status === "verified-cleanup";
    assert.ok(
      cleaned,
      `Owned cleanup incomplete; retained ${workspace}: ${JSON.stringify(stopped)}`,
    );
  }

  // The degraded dossier must satisfy the same provider output contract REA
  // applies to every bridge reply.
  const degraded = parseGhidraFunctionResult(
    "analyze_function",
    probe.degraded,
  );
  if (!degraded.ok) throw degraded.error;
  assert.equal(degraded.value.cachePolicy, "live");
  const dossier = degraded.value.value;
  assert.deepEqual(dossier.facet_availability.pseudocode, {
    available: false,
    reason: injected,
  });
  assert.equal(dossier.pseudocode, "");
  assert.equal(dossier.native_api.available, false);
  assert.equal(dossier.native_value_flow.available, false);
  assert.ok(dossier.assembly.length > 0);
  assert.ok(dossier.callers.length > 0 && dossier.callees.length > 0);
  const baseline = parseGhidraFunctionResult(
    "analyze_function",
    probe.baseline,
  );
  if (!baseline.ok) throw baseline.error;
  assert.equal(baseline.value.cachePolicy, undefined);
  assert.deepEqual(dossier.basic_blocks, baseline.value.value.basic_blocks);

  // The healthy path through the real provider and authenticated transport
  // keeps its pseudocode and native API boundary.
  const provider = new GhidraProvider(
    config.value,
    silentLogger,
    process.env,
    undefined,
    (options) =>
      new GhidraClient({ ...options, transport: "authenticated-loopback-tcp" }),
  );
  const target = await parseBinaryTarget(targetPath);
  if (!target.ok) throw target.error;
  const profile = await provider.resolveAnalysisProfile(target.value);
  if (!profile.ok) throw profile.error;
  assert.ok(profile.value.profile);
  const client = provider.createClient(target.value, profile.value.profile);
  cleaned = false;
  const failures = [];
  let healthy;
  try {
    const result = await client.execute("analyze_function", {
      procedure: dossier.procedure.address,
    });
    if (!result.ok) throw result.error;
    const value = result.value.result;
    assert.deepEqual(value.facet_availability.pseudocode, { available: true });
    assert.equal(value.native_api.available, true);
    assert.ok(
      !result.value.limitations.some((item) => item.includes(injected)),
    );
    const functionLimitCapability = result.value.limitations.find((item) =>
      item.includes("REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS"),
    );
    assert.ok(functionLimitCapability?.includes("per-function limit"));
    assert.ok(
      functionLimitCapability.includes(
        "caller cancellation requests session closure",
      ),
    );
    assert.ok(
      !result.value.limitations.some((item) =>
        item.includes(
          "lets each decompilation run until it completes or the caller cancels",
        ),
      ),
    );
    healthy = {
      function_limit_capability: functionLimitCapability,
      pseudocode_available: true,
      native_api_available: value.native_api.available,
    };
  } catch (cause) {
    failures.push(cause);
  }
  const closed = await client.close();
  cleaned = closed.ok;
  if (!closed.ok) failures.push(closed.error);
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      "Decompiler failure provider verification failed",
    );
  assert.equal(digest(await readFile(targetPath)), targetDigest);
  cleaned = false;
  const verifierRun = await completeVerifierRun(run);
  try {
    assertVerifierCleanupComplete(verifierRun.process_lineage);
  } catch (cause) {
    throw new Error(
      `Verifier cleanup unresolved; retained ${workspace}; run ${run.run_id}`,
      { cause },
    );
  }
  cleaned = true;
  report = {
    status: "passed",
    target_sha256: targetDigest,
    source_sha256: digest(await readFile(join(fixtures, "cross-format.c"))),
    compiler,
    bridge_sha256: bridgeDigest,
    provider: profile.value.profile.provider,
    analysis_profile_digest: profile.value.profile.digest,
    checks: probe.checks,
    degraded: {
      pseudocode: dossier.facet_availability.pseudocode,
      native_api_available: dossier.native_api.available,
      native_value_flow_available: dossier.native_value_flow.available,
      assembly_lines: dossier.assembly.length,
      callers: dossier.callers.length,
      callees: dossier.callees.length,
      basic_blocks: dossier.basic_blocks.length,
    },
    healthy,
    verifier_run: verifierRun,
    scope:
      "Real Ghidra ELF or Mach-O analysis with an injected decompiler failure; output-contract parsing of the degraded dossier; real read-only TCP provider projection of the healthy path. No target execution; natural decompiler failures, degraded CLI/MCP projection and Windows are unverified.",
  };
} finally {
  if (cleaned) await rm(workspace, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    ...report,
    cleanup: "complete",
  }),
);

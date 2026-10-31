import { AnalysisSettings } from "../dist/application/AnalysisSettings.js";
import { runtimeAnalysisConfig } from "../dist/config/runtimeAnalysisSettings.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseBinaryTarget } from "../dist/application/BinaryTargetResolver.js";
import { parseConfig } from "../dist/config/parseConfig.js";
import { projectAnalysisError } from "../dist/domain/analysisErrorProjection.js";
import { GhidraClient } from "../dist/ghidra/GhidraClient.js";
import { inspectVerifierGhidraInstallation } from "./lib/ghidra-installation-inspection.mjs";
import { SUPPORTED_GHIDRA_VERSION } from "../dist/ghidra/GhidraReleasePolicy.js";
import { GhidraProvider } from "../dist/ghidra/GhidraProvider.js";
import { silentLogger } from "../dist/logger.js";
import {
  OwnedCommandFailure,
  runOwnedCommand,
} from "../dist/process/OwnedCommand.js";
import {
  assertVerifierCleanupComplete,
  completeVerifierRun,
  createVerifierRun,
} from "./lib/verifier-run.mjs";

// A natural slow decompile: one function with many independent branches on
// volatile state. Ghidra decompiles it correctly but takes far longer than the
// configured limit, so the limit, not an injected result, stops it.
const LIMIT_SECONDS = 1;
// This verifier budgets one MiB for its generated C source. Bound the number
// of lines before allocating them, including the largest admitted integer's
// decimal representation; the joined source and line array remain bounded.
const FIXTURE_SOURCE_BYTES = 1024 * 1024;
const FIXTURE_PREFIX = [
  "volatile unsigned rea_state[64];",
  "__attribute__((noinline, used)) unsigned rea_slow(unsigned x) {",
  "  unsigned a = x;",
];
const FIXTURE_SUFFIX = [
  "  return a;",
  "}",
  "__attribute__((noinline, used)) int rea_small(int v) {",
  "  return v + (int)rea_state[0];",
  "}",
  "",
];
const MAX_BRANCH_LINE_BYTES = Buffer.byteLength(
  `  if (rea_state[63] & 1073741824u) a = a * 31u + ${Number.MAX_SAFE_INTEGER}u; else a ^= rea_state[63];\n`,
);
const FIXTURE_FIXED_BYTES = Buffer.byteLength(
  [...FIXTURE_PREFIX, ...FIXTURE_SUFFIX].join("\n"),
);
const MAX_BRANCHES = Math.floor(
  (FIXTURE_SOURCE_BYTES - FIXTURE_FIXED_BYTES) / MAX_BRANCH_LINE_BYTES,
);
const BRANCHES = Number(process.env.REA_DECOMPILE_TIMEOUT_BRANCHES ?? 6000);
assert.ok(
  Number.isSafeInteger(BRANCHES) && BRANCHES > 0 && BRANCHES <= MAX_BRANCHES,
  `REA_DECOMPILE_TIMEOUT_BRANCHES must be an integer from 1 to ${MAX_BRANCHES} (generated source budget: ${FIXTURE_SOURCE_BYTES} bytes)`,
);

const run = createVerifierRun();
assert.ok(
  process.platform === "linux" || process.platform === "darwin",
  "This regression lane requires Linux or macOS",
);
const environment = {
  ...process.env,
  REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS: String(LIMIT_SECONDS),
};
const settings = new AnalysisSettings(environment);
const config = parseConfig(environment);
if (!config.ok) throw config.error;
assert.equal(config.value.ghidraDecompileTimeoutSeconds, LIMIT_SECONDS);
const installation = await inspectVerifierGhidraInstallation({
  environment,
  installDir: config.value.ghidraInstallDir,
  javaHome: config.value.ghidraJavaHome,
});
assert.equal(installation.status, "available", JSON.stringify(installation));
assert.equal(installation.providerVersion, SUPPORTED_GHIDRA_VERSION);

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fixtureSource = () => {
  const lines = [...FIXTURE_PREFIX];
  for (let index = 0; index < BRANCHES; index += 1)
    lines.push(
      `  if (rea_state[${index % 64}] & ${(1 << (index % 31)) >>> 0}u) a = a * 31u + ${index}u; else a ^= rea_state[${(index * 7) % 64}];`,
    );
  lines.push(...FIXTURE_SUFFIX);
  const source = lines.join("\n");
  assert.ok(Buffer.byteLength(source) <= FIXTURE_SOURCE_BYTES);
  return source;
};

const workspace = await mkdtemp(
  join(tmpdir(), "rea-ghidra-decompile-timeout-"),
);
let cleaned = true;
let report;
try {
  const sourcePath = join(workspace, "slow-decompile.c");
  const source = fixtureSource();
  await writeFile(sourcePath, source);
  const targetPath = join(
    workspace,
    process.platform === "darwin"
      ? "slow-decompile.dylib"
      : "slow-decompile.so",
  );
  const compiler = {
    command: process.env.REA_CC ?? "cc",
    arguments: [
      ...(process.platform === "darwin" ? ["-dynamiclib"] : ["-shared"]),
      "-fPIC",
      "-O0",
      sourcePath,
      "-o",
      targetPath,
    ],
  };
  cleaned = false;
  try {
    await runOwnedCommand(
      { ...compiler, runId: run.run_id, expectedCommand: null },
      { timeoutMs: 300_000, diagnosticBytes: 1024 * 1024 },
    );
    cleaned = true;
  } catch (cause) {
    cleaned =
      cause instanceof OwnedCommandFailure && cause.cleanupOwner === undefined;
    throw cause;
  }
  const targetDigest = digest(await readFile(targetPath));

  // One real provider session over the read-only authenticated TCP bridge.
  let bridgeClient;
  const provider = new GhidraProvider(
    runtimeAnalysisConfig(config.value, settings.read),
    silentLogger,
    environment,
    undefined,
    (options) => {
      // This verifier has no caller-selected run ID: each new launch receives
      // a fresh owner-generated identity, so equality detects session restarts.
      assert.equal(options.runId, undefined);
      bridgeClient = new GhidraClient({
        ...options,
        transport: "authenticated-loopback-tcp",
      });
      return bridgeClient;
    },
  );
  const target = await parseBinaryTarget(targetPath);
  if (!target.ok) throw target.error;
  const profile = await provider.resolveAnalysisProfile(target.value);
  if (!profile.ok) throw profile.error;
  assert.ok(profile.value.profile);
  const client = provider.createClient(target.value, profile.value.profile);
  cleaned = false;
  const failures = [];
  const observed = {};
  try {
    // Mach-O symbols carry a leading underscore; address the functions by
    // their entry instead of guessing the recovered name.
    const listed = await client.execute("list_procedures", {});
    if (!listed.ok) throw listed.error;
    const entry = (name) => {
      const found = listed.value.result.find(
        (item) => item.value === name || item.value === `_${name}`,
      );
      assert.ok(found, `Missing fixture function ${name}`);
      return found.address;
    };
    const slowEntry = entry("rea_slow");
    const smallEntry = entry("rea_small");
    assert.ok(bridgeClient);
    const initialSession = await bridgeClient.ping();
    if (!initialSession.ok) throw initialSession.error;
    assert.equal(initialSession.value.target.sha256, targetDigest);
    observed.initial_session_run_id = initialSession.value.run_id;
    const limitText = `exceeded the ${String(LIMIT_SECONDS)}-second configured decompilation limit (ghidra.decompile_timeout_seconds; launch seed REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS)`;
    let started = performance.now();
    const slow = await client.execute("analyze_function", {
      procedure: slowEntry,
    });
    observed.analyze_seconds = (performance.now() - started) / 1000;
    if (!slow.ok) throw slow.error;
    const dossier = slow.value.result;
    assert.equal(dossier.facet_availability.pseudocode.available, false);
    assert.ok(
      dossier.facet_availability.pseudocode.reason.endsWith(limitText),
      dossier.facet_availability.pseudocode.reason,
    );
    assert.equal(dossier.native_api.available, false);
    assert.equal(dossier.native_value_flow.available, false);
    assert.ok(dossier.assembly.length > BRANCHES);
    assert.ok(dossier.basic_blocks.length > 0);
    assert.equal(slow.value.cachePolicy, "live");
    observed.degraded = {
      pseudocode: dossier.facet_availability.pseudocode,
      assembly_lines: dossier.assembly.length,
      basic_blocks: dossier.basic_blocks.length,
      cache_policy: slow.value.cachePolicy,
    };

    started = performance.now();
    const pseudocode = await client.execute("procedure_pseudo_code", {
      procedure: slowEntry,
    });
    observed.pseudocode_seconds = (performance.now() - started) / 1000;
    assert.equal(pseudocode.ok, false);
    const projected = projectAnalysisError(pseudocode.error);
    assert.equal(pseudocode.error._tag, "AnalysisTimeoutError");
    assert.equal(projected.code, "provider_timeout");
    assert.equal(projected.retryable, true);
    assert.equal(projected.details.timeout_ms, LIMIT_SECONDS * 1000);
    assert.ok(projected.message.includes(limitText), projected.message);
    assert.ok(
      projected.remediation.action.includes(
        "REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS",
      ),
    );
    observed.pseudocode_error = {
      code: projected.code,
      retryable: projected.retryable,
      message: projected.message,
    };

    const changed = settings.update({
      changes: [
        {
          setting: "ghidra.decompile_timeout_seconds",
          action: "set",
          value: 60,
        },
      ],
    });
    assert.equal(changed.ok, true);
    const recovered = await settings.run(() =>
      client.execute("procedure_pseudo_code", { procedure: slowEntry }),
    );
    if (!recovered.ok) throw recovered.error;
    assert.ok(String(recovered.value.result).includes("rea_state"));
    observed.runtime_recovery = {
      timeout_seconds: 60,
      pseudocode_bytes: Buffer.byteLength(String(recovered.value.result)),
    };

    // The same session decompiles the next function with a fresh decompiler.
    const small = await client.execute("procedure_pseudo_code", {
      procedure: smallEntry,
    });
    if (!small.ok) throw small.error;
    assert.ok(String(small.value.result).includes("rea_state"));
    const continuedSession = await bridgeClient.ping();
    if (!continuedSession.ok) throw continuedSession.error;
    assert.equal(continuedSession.value.run_id, initialSession.value.run_id);
    assert.equal(continuedSession.value.target.sha256, targetDigest);
    observed.final_session_run_id = continuedSession.value.run_id;
    observed.same_session_next_decompile = "succeeded";
  } catch (cause) {
    failures.push(cause);
  }
  const closed = await client.close();
  if (!closed.ok) failures.push(closed.error);
  if (failures.length > 0)
    throw new AggregateError(failures, "Decompile timeout verification failed");
  assert.equal(digest(await readFile(targetPath)), targetDigest);
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
    limit_seconds: LIMIT_SECONDS,
    branches: BRANCHES,
    target_sha256: targetDigest,
    source_sha256: digest(Buffer.from(source)),
    compiler,
    provider: profile.value.profile.provider,
    analysis_profile_digest: profile.value.profile.digest,
    ...observed,
    verifier_run: verifierRun,
    scope:
      "Real Ghidra ELF or Mach-O analysis of a generated slow function through the read-only TCP provider: the decompile limit stops it, analyze_function degrades, procedure_pseudo_code names the setting, a runtime update recovers the same slow function on the same Program, and the same session decompiles the next function. No target execution; Windows is unverified.",
  };
} finally {
  if (cleaned) await rm(workspace, { recursive: true, force: true });
}
console.log(JSON.stringify({ ...report, cleanup: "complete" }));

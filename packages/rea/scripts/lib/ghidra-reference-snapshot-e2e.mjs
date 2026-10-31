import {
  requireMcpEvidenceBundle,
  requireMcpToolError,
  requireMcpLifecycleResult,
  requireMcpEvidenceResult,
} from "./mcp-verifier-results.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseBinaryTarget } from "../../dist/application/BinaryTargetResolver.js";
import { createAnalysisProfile } from "../../dist/domain/analysisProfile.js";
import {
  createAnalysisSnapshotEntry,
  parseAnalysisSnapshot,
  serializeAnalysisSnapshot,
  snapshotBinding,
  snapshotTarget,
} from "../../dist/domain/analysisSnapshot.js";
import { createEvidence } from "../../dist/domain/evidence.js";
import { createEvidenceBundle } from "../../dist/domain/evidenceBundle.js";

/** Reject a valid older snapshot whose instruction-only collector omitted a real edge. */
export async function verifyLegacyGhidraReferenceSnapshot(
  client,
  { target, procedure, omittedEdge, entrypoint, env },
) {
  const bundle = requireMcpEvidenceBundle(
    await client.callTool({
      name: "get_evidence_bundle",
      arguments: {},
    }),
  );
  const observed = bundle.records.find(
    (record) =>
      record.operation === "analyze_function" &&
      record.parameters.procedure === procedure,
  );
  assert.ok(observed);
  const { function_references: coverage, ...legacyParameters } =
    observed.analysis_profile.parameters;
  assert.equal(
    typeof coverage,
    "string",
    "Reference semantics must participate in snapshot identity",
  );
  const legacyProfile = createAnalysisProfile(
    observed.provider,
    legacyParameters,
  );
  assert.notEqual(legacyProfile.digest, observed.analysis_profile.digest);
  const parsed = await parseBinaryTarget(target.path, {
    cwd: process.cwd(),
    hostArchitecture: process.arch,
  });
  if (!parsed.ok) throw parsed.error;
  const nativeTarget = parsed.value;
  const result = structuredClone(observed.normalized_result);
  // Reconstruct the observed pre-fix omission; all other data
  // comes from the real provider and the file has a fully valid Evidence binding.
  result.incoming_references = result.incoming_references.filter(
    (edge) =>
      edge.source_address !== omittedEdge.source_address ||
      edge.target_address !== omittedEdge.target_address,
  );
  assert.equal(
    result.incoming_references.length,
    observed.normalized_result.incoming_references.length - 1,
  );
  const evidence = createEvidence(nativeTarget, observed.provider, {
    operation: observed.operation,
    parameters: observed.parameters,
    result,
    rawResult: result,
    analysisProfile: legacyProfile,
    limitations: observed.limitations,
    locations: observed.locations,
  });
  const binding = snapshotBinding(legacyProfile);
  const identity = snapshotTarget(nativeTarget);
  const snapshot = parseAnalysisSnapshot({
    target: identity,
    binding,
    entries: [
      createAnalysisSnapshotEntry({
        target: identity,
        binding,
        operation: observed.operation,
        parameters: observed.parameters,
        execution: {
          result,
          rawResult: result,
          provider: observed.provider,
          analysisProfile: legacyProfile,
          limitations: observed.limitations,
          locations: observed.locations,
          subject: nativeTarget,
        },
      }),
    ],
    workflow_entries: [],
    evidence_bundle: createEvidenceBundle([evidence]),
  });
  assert.equal(
    snapshot.entries.length,
    1,
    "The legacy query must remain valid and replayable under its own profile",
  );
  const path = join(env.TMPDIR, `legacy-reference-${randomUUID()}.json`);
  await writeFile(path, serializeAnalysisSnapshot(snapshot), { flag: "wx" });
  try {
    const session = requireMcpLifecycleResult(
      await client.callTool({ name: "binary_session", arguments: {} }),
      "binary_session",
    );
    const reply = await client.callTool({
      name: "open_binary",
      arguments: {
        path: target.path,
        provider_id: "ghidra",
        snapshot_path: path,
      },
    });
    assert.equal(reply.isError, true);
    const mcpRejection = requireMcpToolError(reply);
    assert.equal(mcpRejection.code, "evidence_integrity_mismatch");
    assert.match(mcpRejection.details.reason, /profile_mismatch/u);
    assert.match(
      mcpRejection.remediation.action,
      /without this snapshot.*fresh snapshot/u,
    );
    assert.deepEqual(
      requireMcpLifecycleResult(
        await client.callTool({ name: "binary_session", arguments: {} }),
        "binary_session",
      ),
      session,
      "A rejected snapshot must preserve the selected session",
    );
    const retained = requireMcpEvidenceResult(
      await client.callTool({
        name: "analyze_function",
        arguments: { procedure, detail: "complete" },
      }),
      "analyze_function",
    );
    assert.ok(
      retained.incoming_references.some(
        (edge) =>
          edge.source_address === omittedEdge.source_address &&
          edge.target_address === omittedEdge.target_address,
      ),
      "A rejected legacy snapshot must not replace complete live analysis",
    );
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        [
          entrypoint,
          "function",
          target.path,
          procedure,
          "--provider",
          "ghidra",
          "--snapshot",
          path,
          "--json",
        ],
        { env, timeout: 240000, maxBuffer: 72 * 1024 * 1024 },
      ),
      (error) => {
        assert.equal(error.code, 1);
        const rejection = JSON.parse(error.stdout);
        assert.equal(rejection.code, "evidence_integrity_mismatch");
        assert.equal(rejection.details.reason, mcpRejection.details.reason);
        assert.equal(
          rejection.remediation.action,
          mcpRejection.remediation.action,
        );
        return true;
      },
    );
  } finally {
    await rm(path);
  }
}

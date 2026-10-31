import {
  requireMcpToolError,
  requireMcpOperationResult,
} from "./mcp-verifier-results.mjs";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAnalysisSnapshot } from "../../dist/domain/analysisSnapshot.js";
import { parseEvidenceBundle } from "../../dist/domain/evidenceBundle.js";

/** Keep mutable Ghidra observations out of immutable snapshots across target opens. */
export async function verifyGhidraSnapshotLifecycle(
  client,
  target,
  edited,
  cli,
) {
  const workspace = await mkdtemp(join(tmpdir(), "rea-ghidra-snapshot-proof-"));
  let successfulCalls = 0;
  let rejectedCalls = 0;
  const call = async (name, args = {}) => {
    const result = requireMcpOperationResult(
      await client.callTool({ name, arguments: args }, { timeout: 180000 }),
      name,
    );
    successfulCalls++;
    return result;
  };
  const rejectSnapshot = async (name, args) => {
    const reply = await client.callTool({ name, arguments: args });
    assert.equal(
      reply.isError,
      true,
      `${name} accepted a mutated snapshot binding`,
    );
    const error = requireMcpToolError(reply);
    assert.equal(
      error.code,
      "evidence_integrity_mismatch",
      JSON.stringify(reply),
    );
    assert.equal(error.retryable, false);
    rejectedCalls++;
  };
  try {
    const entry = edited.procedure.address;
    const snapshotPath = join(workspace, "original.json");
    // The CLI has its own unmodified database and writes the production snapshot format.
    const original = await cli("function", entry, ["--snapshot", snapshotPath]);
    const snapshotBytes = await readFile(snapshotPath);
    const snapshot = parseAnalysisSnapshot(
      JSON.parse(snapshotBytes.toString("utf8")),
    );
    assert.equal(snapshot.target.sha256, target.sha256);
    assert.notEqual(original.procedure.name, edited.procedure.name);
    const runId = (await call("binary_session")).analysis_run.run_id;
    const api = await call("inspect_native_api", { procedure: entry });
    assert.equal(api.procedure.name, edited.procedure.name);
    for (const repeatedOpen of [false, true]) {
      if (repeatedOpen)
        await call("open_binary", { path: target.path, provider_id: "ghidra" });
      const destination = join(
        workspace,
        repeatedOpen ? "repeated.json" : "edited.json",
      );
      await rejectSnapshot("close_binary", { snapshot_path: destination });
      await assert.rejects(access(destination), { code: "ENOENT" });
      assert.equal((await call("binary_session")).analysis_run.run_id, runId);
      assert.deepEqual(
        await call("analyze_function", {
          procedure: entry,
          detail: "complete",
        }),
        edited,
      );
    }
    await rejectSnapshot("open_binary", {
      path: target.path,
      provider_id: "ghidra",
      snapshot_path: snapshotPath,
    });
    assert.deepEqual(await readFile(snapshotPath), snapshotBytes);
    assert.equal((await call("binary_session")).analysis_run.run_id, runId);
    assert.deepEqual(
      await call("analyze_function", { procedure: entry, detail: "complete" }),
      edited,
    );

    // Mutable results remain exportable as observations, with their mutation Evidence.
    const bundlePath = join(workspace, "observations.json");
    await call("export_evidence_bundle", { path: bundlePath });
    const bundle = parseEvidenceBundle(
      JSON.parse(await readFile(bundlePath, "utf8")),
    );
    assert.ok(
      bundle.records.some(
        (record) => record.operation === "annotate_native_function",
      ),
    );
    assert.ok(
      bundle.records.some(
        (record) =>
          record.operation === "inspect_native_api" &&
          record.normalized_result.procedure.name === edited.procedure.name,
      ),
    );

    await call("close_binary");
    await call("open_binary", {
      path: target.path,
      provider_id: "ghidra",
      snapshot_path: snapshotPath,
    });
    const restored = await call("analyze_function", {
      procedure: entry,
      detail: "complete",
    });
    assert.deepEqual(restored.procedure, original.procedure);
    assert.deepEqual(restored.comments, original.comments);
    assert.notEqual((await call("binary_session")).analysis_run.run_id, runId);
    const freshPath = join(workspace, "fresh.json");
    await call("close_binary", { snapshot_path: freshPath });
    const fresh = parseAnalysisSnapshot(
      JSON.parse(await readFile(freshPath, "utf8")),
    );
    assert.ok(
      !fresh.evidence_bundle.records.some(
        (record) =>
          record.operation === "annotate_native_function" ||
          (record.operation === "inspect_native_api" &&
            record.normalized_result.procedure.name === edited.procedure.name),
      ),
    );
    await call("open_binary", {
      path: target.path,
      provider_id: "ghidra",
      snapshot_path: freshPath,
    });
    await verifyConcurrentSnapshotClose({
      call,
      rejectSnapshot,
      workspace,
      target,
      entry,
      original,
    });
    return { successfulCalls, rejectedCalls };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function verifyConcurrentSnapshotClose({
  call,
  rejectSnapshot,
  workspace,
  target,
  entry,
  original,
}) {
  const destination = join(workspace, "concurrent.json");
  const annotation = call("annotate_native_function", {
    procedure: entry,
    name: "rea_concurrent_snapshot_edit",
    comment:
      "A successful edit must invalidate a concurrently requested snapshot.",
  });
  const close = rejectSnapshot("close_binary", { snapshot_path: destination });
  const [updated] = await Promise.all([annotation, close]);
  await assert.rejects(access(destination), { code: "ENOENT" });
  assert.equal((await call("binary_session")).open, true);
  assert.deepEqual(
    await call("analyze_function", { procedure: entry, detail: "complete" }),
    updated.dossier,
  );
  // Discard the ephemeral edit and leave the caller with a pristine database.
  await call("close_binary");
  await call("open_binary", { path: target.path, provider_id: "ghidra" });
  assert.deepEqual(
    (await call("analyze_function", { procedure: entry, detail: "complete" }))
      .procedure,
    original.procedure,
  );
}

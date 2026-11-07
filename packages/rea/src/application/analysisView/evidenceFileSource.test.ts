import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  analysisViewCaptureEvidence,
  analysisViewNativeEvidence,
} from "../../../tests/fixtures/analysisView.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { AnalysisCancelledError } from "../../domain/analysisErrorCore.js";
import { JsonInputPhysicalReadFailure } from "../JsonInputFile.js";
import { failFileReadAfterAbort } from "../../../tests/support/failFileReadAfterAbort.js";
import { holdFirstFileRead } from "../../../tests/support/holdFirstFileRead.js";
import { createEvidence } from "../../domain/evidence.js";
import { readEvidence } from "../../domain/evidenceValidation.js";
import { isImmutableJsonSnapshot } from "../../domain/immutableJson.js";
import { ok } from "../../domain/result.js";
import { createEvidenceBundle } from "../../domain/evidenceBundle.js";
import { readEvidenceFileSource } from "./evidenceFileSource.js";

describe("evidence-file source reads", () => {
  it("owns immutable authentication proofs for selected records and related bundle parents", async () => {
    const root = await createTestTempDirectory("rea-evidence-file-proof-");
    const single = join(root, "single.json");
    const source = analysisViewNativeEvidence();
    const related = analysisViewCaptureEvidence();
    await writeFile(single, JSON.stringify(source));
    const selected = await readEvidenceFileSource(single);
    if (!selected.ok) throw selected.error;
    expect(isImmutableJsonSnapshot(selected.value)).toBe(true);
    const checked = readEvidence(selected.value);
    if (!checked.ok) throw checked.error;
    expect(checked.value).toBe(selected.value);

    const bundle = join(root, "bundle.json");
    await writeFile(
      bundle,
      JSON.stringify(createEvidenceBundle([source, related])),
    );
    let parentChecked = false;
    const fromBundle = await readEvidenceFileSource(
      bundle,
      {},
      source.evidence_id,
      {
        operation: "compare_artifacts",
        path: ["left"],
        resolveSelected: (record, lookup) => {
          const parent = lookup(related.evidence_id);
          if (parent === undefined)
            throw new Error("Missing admitted related record");
          expect(isImmutableJsonSnapshot(record)).toBe(true);
          expect(isImmutableJsonSnapshot(parent)).toBe(true);
          const authenticated = readEvidence(parent);
          if (!authenticated.ok) throw authenticated.error;
          expect(authenticated.value).toBe(parent);
          parentChecked = true;
          return ok(record);
        },
      },
    );
    if (!fromBundle.ok) throw fromBundle.error;
    expect(parentChecked).toBe(true);

    // A later read must authenticate new bytes rather than reuse a path-based proof.
    await writeFile(
      single,
      JSON.stringify({ ...source, normalized_result: { changed: true } }),
    );
    expect(await readEvidenceFileSource(single)).toMatchObject({
      ok: false,
      error: { _tag: "EvidenceFileError", reason: "wrong-kind" },
    });
  });

  it("refuses a cancelled request before reading and reads within the caller's resource scope", async () => {
    const controller = new AbortController();
    const reason = new JsonInputPhysicalReadFailure(
      new Error("opaque caller reason with physical-failure shape"),
    );
    controller.abort(reason);
    const cancelled = await readEvidenceFileSource(
      "/nonexistent/capture.json",
      {
        signal: controller.signal,
      },
    );
    expect(cancelled).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    if (cancelled.ok || !(cancelled.error instanceof AnalysisCancelledError))
      throw new Error("Expected cancelled analysis-view read");
    expect(cancelled.error.cause).toBe(reason);
    const path = join(
      await createTestTempDirectory("rea-evidence-file-source-"),
      "capture.json",
    );
    const parent = analysisViewCaptureEvidence();
    await writeFile(path, JSON.stringify(parent));
    const resources = new ArtifactResourceScope();
    const read = await readEvidenceFileSource(path, { resources });
    await resources.close();
    if (!read.ok) throw read.error;
    expect(read.value).toEqual(JSON.parse(JSON.stringify(parent)));
  });

  it("projects the selected or only record of an Evidence bundle file", async () => {
    const root = await createTestTempDirectory("rea-evidence-bundle-source-");
    const native = analysisViewNativeEvidence();
    const capture = analysisViewCaptureEvidence();
    const single = join(root, "single.json");
    await writeFile(single, JSON.stringify(createEvidenceBundle([native])));
    const only = await readEvidenceFileSource(single);
    if (!only.ok) throw only.error;
    expect(only.value.evidence_id).toBe(native.evidence_id);

    const several = join(root, "several.json");
    await writeFile(
      several,
      JSON.stringify(createEvidenceBundle([native, capture])),
    );
    const selected = await readEvidenceFileSource(
      several,
      {},
      capture.evidence_id,
    );
    if (!selected.ok) throw selected.error;
    expect(selected.value.evidence_id).toBe(capture.evidence_id);

    // Ambiguity and a missing selection are input errors that name the records held.
    const ambiguous = await readEvidenceFileSource(several);
    expect(ambiguous).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisInputError",
        issues: [{ path: ["source", "evidence_id"], reason: "invalid_value" }],
      },
    });
    if (ambiguous.ok) throw new Error("Expected an ambiguous bundle");
    expect(ambiguous.error.userMessage).toContain(native.evidence_id);
    expect(ambiguous.error.userMessage).toContain("analyze_function");
    const absent = "ev_" + "f".repeat(64);
    const missing = await readEvidenceFileSource(several, {}, absent);
    expect(missing).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisInputError",
        userMessage: expect.stringContaining(absent),
      },
    });

    // Bundle authentication uses the same integrity classification as bundle import.
    const invalid = join(root, "invalid.json");
    await writeFile(invalid, JSON.stringify({ records: [{ hello: 1 }] }));
    expect(await readEvidenceFileSource(invalid)).toMatchObject({
      ok: false,
      error: {
        _tag: "EvidenceIntegrityError",
        userMessage: expect.stringContaining("Evidence bundle"),
      },
    });
  });
});

describe("evidence-file read failure provenance", () => {
  it("keeps a physical null read cause after the analysis-view request aborts", async () => {
    const root = await createTestTempDirectory("rea-view-late-io-");
    const path = join(root, "capture.json");
    await writeFile(path, JSON.stringify(analysisViewCaptureEvidence()));
    const controller = new AbortController();
    await failFileReadAfterAbort(
      path,
      controller,
      new Error("later abort"),
      null,
    );
    try {
      const result = await readEvidenceFileSource(path, {
        signal: controller.signal,
      });
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "EvidenceFileError", reason: "io", path },
      });
      if (result.ok) throw new Error("Expected physical JSON read failure");
      expect(result.error.cause).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("preserves identical physical and abort causes for analysis-view reads", async () => {
    const root = await createTestTempDirectory("rea-view-identical-abort-");
    const path = join(root, "capture.json");
    await writeFile(path, JSON.stringify(analysisViewCaptureEvidence()));
    const controller = new AbortController();
    const physical = Object.assign(new Error("descriptor EIO"), {
      code: "EIO",
    });
    await failFileReadAfterAbort(path, controller, physical, physical);
    try {
      const result = await readEvidenceFileSource(path, {
        signal: controller.signal,
      });
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "EvidenceFileError", reason: "io" },
      });
      if (result.ok) throw new Error("Expected physical JSON read failure");
      expect(result.error.cause).toBe(physical);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("preserves the caller cancellation reason during an analysis-view read", async () => {
    const root = await createTestTempDirectory("rea-view-read-cancel-");
    const path = join(root, "capture.json");
    await writeFile(path, JSON.stringify(analysisViewCaptureEvidence()));
    const reader = await holdFirstFileRead(path);
    const controller = new AbortController();
    const reason = new Error("stop analysis-view read");
    try {
      const pending = readEvidenceFileSource(path, {
        signal: controller.signal,
      });
      await reader.firstRead;
      controller.abort(reason);
      reader.release();
      const result = await pending;
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisCancelledError",
          operation: "inspect_analysis_view",
        },
      });
      if (result.ok || !(result.error instanceof AnalysisCancelledError))
        throw new Error("Expected cancelled analysis-view read");
      expect(result.error.cause).toBe(reason);
    } finally {
      controller.abort(reason);
      reader.release();
      vi.restoreAllMocks();
    }
  });

  it("does not treat a caller reason with physical-read shape as a physical read", async () => {
    const root = await createTestTempDirectory("rea-view-opaque-cancel-");
    const path = join(root, "capture.json");
    await writeFile(path, JSON.stringify(analysisViewCaptureEvidence()));
    const reader = await holdFirstFileRead(path);
    const controller = new AbortController();
    const reason = new JsonInputPhysicalReadFailure(
      new Error("opaque caller reason with physical-failure shape"),
    );
    try {
      const pending = readEvidenceFileSource(path, {
        signal: controller.signal,
      });
      await reader.firstRead;
      controller.abort(reason);
      reader.release();
      const result = await pending;
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisCancelledError", cause: reason },
      });
      if (result.ok || !(result.error instanceof AnalysisCancelledError))
        throw new Error(
          "Expected caller cancellation, not physical I/O failure",
        );
      expect(result.error.cause).toBe(reason);
    } finally {
      controller.abort(reason);
      reader.release();
      vi.restoreAllMocks();
    }
  });
});

it("honors an explicit identity for a single-record Evidence file", async () => {
  const root = await createTestTempDirectory("rea-evidence-file-selection-");
  const path = join(root, "record.json");
  const record = analysisViewNativeEvidence();
  const other = analysisViewCaptureEvidence();
  await writeFile(path, JSON.stringify(record));
  expect(
    await readEvidenceFileSource(path, {}, record.evidence_id),
  ).toMatchObject({ ok: true });
  expect(
    await readEvidenceFileSource(path, {}, other.evidence_id),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisInputError",
      issues: [{ path: ["source", "evidence_id"] }],
    },
  });
});

it("keeps bundle-selection errors useful when operation labels exceed the reply budget", async () => {
  const root = await createTestTempDirectory("rea-evidence-file-labels-");
  const path = join(root, "records.json");
  const operation = '\u0000"'.repeat(50_000);
  const records = [1, 2].map((ordinal) =>
    createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation,
        parameters: {},
        result: { ordinal },
      },
    ),
  );
  await writeFile(path, JSON.stringify(createEvidenceBundle(records)));
  const read = await readEvidenceFileSource(path);
  expect(read).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisInputError" },
  });
  if (read.ok) throw new Error("Expected a record-selection error");
  const encoded = JSON.stringify(read);
  expect(Buffer.byteLength(encoded, "utf8")).toBeLessThan(8192);
  for (const record of records)
    expect(read.error.userMessage).toContain(
      `${record.evidence_id} (operation omitted)`,
    );
  expect(encoded).not.toContain(operation);
});

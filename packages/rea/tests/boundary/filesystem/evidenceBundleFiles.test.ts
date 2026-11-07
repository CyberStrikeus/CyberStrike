import {
  lstat,
  mkdir,
  readdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  inventoryArtifact,
  withArtifactResourceScope,
} from "../../fixtures/artifactInventory.js";
import { createArtifactInspection } from "../../../src/domain/artifactInspection.js";

import {
  readEvidenceBundle,
  readImmutableEvidenceBundle,
  writeEvidenceBundle,
} from "../../../src/application/EvidenceBundleFiles.js";
import {
  compareEvidenceBundlesCommand,
  deliverAnalysisEvidence,
} from "../../../src/application/EvidenceBundleCommands.js";
import { EvidenceLedger } from "../../../src/application/investigation/EvidenceLedger.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { OwnedStagedOutput } from "../../../src/filesystem/OwnedStagedOutput.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import {
  createEvidence,
  parseEvidence,
  withEvidenceCallerInputPath,
} from "../../../src/domain/evidence.js";
import { writeTextParts } from "../../../src/application/JsonFiles.js";
import { JSON_BYTE_ORDER_MARK_MESSAGE } from "../../../src/application/Utf8JsonInput.js";
import { failFileReadAfterAbort } from "../../support/failFileReadAfterAbort.js";
import { holdFirstFileRead } from "../../support/holdFirstFileRead.js";
import { JsonInputPhysicalReadFailure } from "../../../src/application/JsonInputFile.js";
import {
  createEvidenceBundle,
  parseEvidenceBundle,
  serializeEvidenceBundle,
  DuplicateEvidenceRecordError,
} from "../../../src/domain/evidenceBundle.js";
import { analysisViewLayoutEvidence } from "../../fixtures/analysisView.js";
import { publishCliAnalysisEvidence } from "../../../src/cli/analysisEvidenceDelivery.js";
import { EMPTY_PROCESS_CAPTURE_EXAMPLE } from "../../../src/domain/process/processCaptureExample.js";
import { PROCESS_PROVIDER } from "../../../src/domain/process/processEvidenceProvider.js";

const bundle = (result = true) =>
  createEvidenceBundle([
    createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      { operation: "health", parameters: {}, result },
    ),
  ]);

it("preserves tagged refusal JSON without interpreting Evidence-shaped fields", async () => {
  const root = await createTestTempDirectory("rea-refused-delivery-");
  const refusal = {
    code: "unreadable_output",
    evidence_id: "caller-selected diagnostic",
    normalized_result: { partial: true },
  };
  const delivered = await publishCliAnalysisEvidence(
    { ok: false, error: refusal },
    {
      providerId: "fixture",
      operation: "inspect_artifact",
      signal: new AbortController().signal,
      detail: "summary",
      evidenceOutput: join(root, "refused.json"),
    },
  );
  expect(delivered).toBe(refusal);
  expect(await readdir(root)).toEqual([]);
});

it("preserves direct duplicate rejection and CLI identity merging for repeated inspection sources", async () => {
  const root = await createTestTempDirectory("rea-repeated-delivery-");
  const input = join(root, "input.txt");
  await writeFile(input, "artifact contents");
  const inventory = await inventoryArtifact(input);
  const source = createEvidence(
    undefined,
    { id: "fixture", name: "Fixture", version: "1" },
    {
      operation: "inventory_artifact",
      parameters: {},
      result: inventory,
    },
  );
  const inspection = createArtifactInspection(source);
  const complete = withEvidenceCallerInputPath(
    createEvidence(undefined, source.provider, {
      operation: "inspect_artifact",
      parameters: {},
      result: {
        ...inspection,
        substeps: [...inspection.substeps, ...inspection.substeps],
      },
    }),
    "./selected",
  );
  await expect(
    deliverAnalysisEvidence(complete, join(root, "direct.json")),
  ).rejects.toBeInstanceOf(DuplicateEvidenceRecordError);
  const path = join(root, "cli.json");
  const delivered = await publishCliAnalysisEvidence(
    { ok: true, value: complete },
    {
      providerId: "fixture",
      operation: "inspect_artifact",
      signal: new AbortController().signal,
      detail: "complete",
      evidenceOutput: path,
      sourceEvidence: [withEvidenceCallerInputPath(complete, "./old"), source],
    },
  );
  expect(delivered).toEqual(complete);
  const saved = await readEvidenceBundle(path);
  if (!saved.ok) throw saved.error;
  expect(saved.value.records).toHaveLength(2);
  expect(
    saved.value.records.find(
      (record) => record.evidence_id === complete.evidence_id,
    )?.caller_input_path,
  ).toBe("./selected");
  await expect(stat(join(root, "direct.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("retains a malformed artifact parent and refuses publication through both delivery paths", async () => {
  const root = await createTestTempDirectory("rea-malformed-delivery-");
  const evidence = createEvidence(
    undefined,
    { id: "fixture", name: "Fixture", version: "1" },
    { operation: "inspect_artifact", parameters: {}, result: {} },
  );
  const direct = await deliverAnalysisEvidence(
    evidence,
    join(root, "direct.json"),
  );
  if (direct.ok) throw new Error("Expected invalid artifact closure");
  const projected = projectAnalysisError(direct.error);
  const cli = await publishCliAnalysisEvidence(
    { ok: true, value: evidence },
    {
      providerId: "fixture",
      operation: "inspect_artifact",
      signal: new AbortController().signal,
      detail: "complete",
      evidenceOutput: join(root, "cli.json"),
    },
  );
  expect(cli).toEqual(projected);
  expect(JSON.stringify(projected)).toContain(evidence.evidence_id);
  expect(await readdir(root)).toEqual([]);
});

it.each([undefined, "../selected-link/./artifact"])(
  "keeps same-invocation caller input on delivered summary and saved parent (%s)",
  async (callerInputPath) => {
    const root = await createTestTempDirectory("rea-delivery-input-path-");
    const path = join(root, "bundle.json");
    const original = analysisViewLayoutEvidence();
    const parent =
      callerInputPath === undefined
        ? original
        : withEvidenceCallerInputPath(original, callerInputPath);
    const delivered = await deliverAnalysisEvidence(parent, path, "summary");
    if (!delivered.ok) throw delivered.error;
    expect(delivered.value.caller_input_path).toBe(callerInputPath);
    expect(delivered.value.evidence_links).toContain(parent.evidence_id);
    expect(original.caller_input_path).toBeUndefined();
    const saved = await readEvidenceBundle(path);
    if (!saved.ok) throw saved.error;
    const savedParent = saved.value.records.find(
      (record) => record.evidence_id === parent.evidence_id,
    );
    expect(savedParent?.caller_input_path).toBe(callerInputPath);
  },
);

it.each([0, 9 * 1024 * 1024])(
  "preserves the format owner's BOM recovery with %i bytes of padding",
  async (padding) => {
    const root = await createTestTempDirectory("rea-bundle-bom-");
    const path = join(root, "bundle.json");
    await writeFile(
      path,
      `\uFEFF${" ".repeat(padding)}${JSON.stringify(bundle())}`,
    );
    const result = await readEvidenceBundle(path);
    if (result.ok) throw new Error("Expected strict JSON BOM rejection");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "evidence_integrity_mismatch",
      message: JSON_BYTE_ORDER_MARK_MESSAGE,
      remediation: { action: JSON_BYTE_ORDER_MARK_MESSAGE },
      details: {
        path,
        reason: "invalid-json",
        content_issues: [
          { reason: "invalid_format", message: JSON_BYTE_ORDER_MARK_MESSAGE },
        ],
      },
    });
    // Ordinary malformed JSON keeps its distinct parser diagnostic and the
    // existing general recovery; consumers do not infer BOMs from text.
    await writeFile(path, `${" ".repeat(padding)}{`);
    const malformed = await readEvidenceBundle(path);
    if (malformed.ok) throw new Error("Expected malformed JSON rejection");
    expect(projectAnalysisError(malformed.error).message).toContain(
      "Repair or recreate",
    );
  },
);

it.each([
  ["immutable", readImmutableEvidenceBundle],
  ["mutable", readEvidenceBundle],
] as const)(
  "cancels a %s bundle read before opening its selected path",
  async (_, read) => {
    const root = await createTestTempDirectory("rea-bundle-pre-cancel-");
    const controller = new AbortController();
    const reason = new Error("cancel before bundle read");
    controller.abort(reason);
    const result = await read(join(root, "missing.json"), controller.signal);
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation: "import_evidence_bundle",
        cause: controller.signal.reason,
      },
    });
    if (result.ok) throw new Error("Expected cancelled bundle read");
    expect(result.error.cause).toBe(reason);
    expect(await readdir(root)).toEqual([]);
  },
);

it.each([
  ["mutable", readEvidenceBundle],
  ["immutable", readImmutableEvidenceBundle],
] as const)(
  "preserves the caller cancellation reason during %s read",
  async (_, read) => {
    const root = await createTestTempDirectory("rea-bundle-read-cancel-");
    const path = join(root, "bundle.json");
    await writeFile(path, JSON.stringify(bundle()));
    const reader = await holdFirstFileRead(path);
    const controller = new AbortController();
    const reason = new Error("stop bundle import");
    try {
      const pending = read(path, controller.signal);
      await reader.firstRead;
      controller.abort(reason);
      reader.release();
      const result = await pending;
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisCancelledError",
          operation: "import_evidence_bundle",
        },
      });
      if (result.ok) throw new Error("Expected cancelled bundle read");
      expect(result.error.cause).toBe(reason);
    } finally {
      controller.abort(reason);
      reader.release();
      vi.restoreAllMocks();
    }
  },
);

it.each([
  ["mutable", readEvidenceBundle],
  ["immutable", readImmutableEvidenceBundle],
] as const)(
  "keeps the physical null read cause for %s import after cancellation",
  async (_, read) => {
    const root = await createTestTempDirectory("rea-bundle-late-io-");
    const path = join(root, "bundle.json");
    await writeFile(path, JSON.stringify(bundle()));
    const controller = new AbortController();
    await failFileReadAfterAbort(
      path,
      controller,
      new Error("later abort"),
      null,
    );
    try {
      const result = await read(path, controller.signal);
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "EvidenceFileError", reason: "io", path },
      });
      if (result.ok) throw new Error("Expected physical JSON read failure");
      expect(result.error.cause).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  },
);

it.each([
  ["mutable", readEvidenceBundle],
  ["immutable", readImmutableEvidenceBundle],
] as const)(
  "keeps an identical physical and abort reason for %s import",
  async (_, read) => {
    const root = await createTestTempDirectory("rea-bundle-identical-abort-");
    const path = join(root, "bundle.json");
    await writeFile(path, JSON.stringify(bundle()));
    const controller = new AbortController();
    const physical = new JsonInputPhysicalReadFailure(
      Object.assign(new Error("physical EIO"), { code: "EIO" }),
    );
    await failFileReadAfterAbort(path, controller, physical, physical);
    try {
      const result = await read(path, controller.signal);
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "EvidenceFileError", reason: "io" },
      });
      if (result.ok) throw new Error("Expected physical JSON read failure");
      expect(result.error.cause).toBe(physical);
    } finally {
      vi.restoreAllMocks();
    }
  },
);

it("preserves the failed-close owner when import is also cancelled", async () => {
  const root = await createTestTempDirectory("rea-import-cancel-cleanup-");
  const path = join(root, "bundle.json");
  await writeFile(path, JSON.stringify(bundle()));
  const controller = new AbortController();
  const cleanupCause = new Error("fixture close failure");
  const cancellationReason = new JsonInputPhysicalReadFailure(
    new Error("opaque cancellation reason"),
  );
  let owner: OwnedFileHandle | undefined;
  const resources = new ArtifactResourceScope();
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      owner = this;
      controller.abort(cancellationReason);
      throw cleanupCause;
    });
  try {
    const result = await readImmutableEvidenceBundle(
      path,
      controller.signal,
      resources,
    );
    if (result.ok) throw new Error("Expected failed finalization");
    expect(result.error).toMatchObject({
      _tag: "EvidenceFileError",
      cleanupIncomplete: true,
      cleanupPrimary: {
        _tag: "AnalysisCancelledError",
        cause: cancellationReason,
      },
    });
    expect(owner?.handle.fd).toBeGreaterThanOrEqual(0);
    close.mockRestore();
    await resources.close();
    expect(owner?.handle.fd).toBe(-1);
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    close.mockRestore();
    await resources.close();
  }
  expect(await readEvidenceBundle(path)).toMatchObject({ ok: true });
});

describe("evidence bundle export cancellation", () => {
  it("retains the completed parent and exact reason when delivery is cancelled before publication", async () => {
    const root = await createTestTempDirectory("rea-delivery-cancel-");
    const parent = analysisViewLayoutEvidence();
    const controller = new AbortController();
    const reason = new Error("cancel before bundle publication");
    controller.abort(reason);
    const result = await deliverAnalysisEvidence(
      parent,
      join(root, "bundle.json"),
      "summary",
      controller.signal,
    );
    if (result.ok) throw new Error("Cancelled delivery reported success");
    expect(result.error).toMatchObject({
      _tag: "AnalysisCancelledError",
      operation: parent.operation,
    });
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cancelled",
      details: { operation: parent.operation },
    });
    expect(result.error.cause).toBe(reason);
    expect(result.error.partialObservation).toBe(parent);
    expect(await readdir(root)).toEqual([]);
  });

  it("does not inspect the path or advance a source cancelled before writing", async () => {
    const root = await createTestTempDirectory("rea-export-pre-cancel-");
    const controller = new AbortController();
    controller.abort();
    let advanced = false;
    function* parts() {
      advanced = true;
      yield "unused";
    }
    expect(
      await writeParts(parts(), join(root, "missing", "bundle.json"), false, {
        signal: controller.signal,
        operation: "export_evidence_bundle",
      }),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation: "export_evidence_bundle",
        cause: controller.signal.reason,
      },
    });
    expect(advanced).toBe(false);
    expect(await readdir(root)).toEqual([]);
    expect(
      await writeBundle(
        bundle(),
        join(root, "bundle.json"),
        false,
        controller.signal,
      ),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        cause: controller.signal.reason,
      },
    });
    expect(await readdir(root)).toEqual([]);
  });

  it.each([false, true])(
    "closes a cancelled source and preserves the destination (overwrite: %s)",
    async (overwrite) => {
      const root = await createTestTempDirectory("rea-export-cancel-");
      const path = join(root, "bundle.json");
      if (overwrite) await writeFile(path, "original");
      const controller = new AbortController();
      const cancellationReason = new Error("cancel staged publication");
      let closed = false;
      let continued = false;
      function* parts() {
        try {
          yield "staged partial data";
          controller.abort(cancellationReason);
          yield "cancelled data";
          continued = true;
          yield "unreachable";
        } finally {
          closed = true;
        }
      }
      expect(
        await writeParts(parts(), path, overwrite, {
          signal: controller.signal,
          operation: "export_evidence_bundle",
        }),
      ).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisCancelledError",
          operation: "export_evidence_bundle",
          cause: cancellationReason,
        },
      });
      expect(closed).toBe(true);
      expect(continued).toBe(false);
      expect(await readdir(root)).toEqual(overwrite ? ["bundle.json"] : []);
      if (overwrite) expect(await readFile(path, "utf8")).toBe("original");
      expect(await writeBundle(bundle(), path, overwrite)).toMatchObject({
        ok: true,
      });
      expect(await readEvidenceBundle(path)).toEqual({
        ok: true,
        value: bundle(),
      });
    },
  );

  it("does not publish when cancellation arrives at source exhaustion", async () => {
    const root = await createTestTempDirectory("rea-export-final-cancel-");
    const path = join(root, "bundle.json");
    await writeFile(path, "original");
    const controller = new AbortController();
    function* parts() {
      yield "complete replacement";
      controller.abort();
    }
    expect(
      await writeParts(parts(), path, true, {
        signal: controller.signal,
        operation: "export_evidence_bundle",
      }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisCancelledError" } });
    expect(await readFile(path, "utf8")).toBe("original");
    expect(await readdir(root)).toEqual(["bundle.json"]);
  });
});

it.each([1, 2])(
  "reports only unresolved cancellation cleanup after %s failed close attempts",
  async (failedAttempts) => {
    const root = await createTestTempDirectory("rea-delivery-cleanup-retry-");
    const parent = analysisViewLayoutEvidence();
    const controller = new AbortController();
    const reason = new Error("cancel before bundle publication");
    const cleanupCause = new Error("fixture staged-output close failure");
    const ready = OwnedStagedOutput.prototype.assertReadyForPublication;
    const close = OwnedStagedOutput.prototype.close;
    let owner: OwnedStagedOutput | undefined;
    let attempts = 0;
    const publication = vi
      .spyOn(OwnedStagedOutput.prototype, "assertReadyForPublication")
      .mockImplementationOnce(async function (this: OwnedStagedOutput, staged) {
        await ready.call(this, staged);
        controller.abort(reason);
      });
    const cleanup = vi
      .spyOn(OwnedStagedOutput.prototype, "close")
      .mockImplementation(async function (this: OwnedStagedOutput) {
        owner = this;
        if (++attempts <= failedAttempts) throw cleanupCause;
        await close.call(this);
      });
    try {
      const result = await deliverAnalysisEvidence(
        parent,
        join(root, "bundle.json"),
        "summary",
        controller.signal,
      );
      if (result.ok) throw new Error("Cancelled delivery reported success");
      expect(attempts).toBe(2);
      expect(result.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.partialObservation).toBe(parent);
      expect(result.error.cause).toBe(reason);
      expect(result.error.cleanupPrimary).toMatchObject({
        operation: parent.operation,
      });
      expect(result.error.cleanupPrimary?.cause).toBe(reason);
      expect(result.error.cleanup?.reason).toBe(cleanupCause.message);
      const incomplete = failedAttempts === 2;
      expect(result.error.cleanupIncomplete).toBe(incomplete);
      expect(result.error.cleanupResources).toEqual(
        incomplete ? [owner?.directory] : [],
      );
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: incomplete ? "cleanup_incomplete" : "cancelled",
        details: { operation: parent.operation },
      });
      expect((await readdir(root)).map((entry) => join(root, entry))).toEqual(
        incomplete ? [owner?.directory] : [],
      );
    } finally {
      publication.mockRestore();
      cleanup.mockRestore();
      await owner?.close();
    }
  },
);

const writeBundle = (
  value: ReturnType<typeof bundle>,
  path: string,
  overwrite: boolean,
  signal?: AbortSignal,
) =>
  withArtifactResourceScope((resources) =>
    writeEvidenceBundle(value, path, overwrite, resources, signal),
  );

const writeParts = (
  parts: Iterable<string>,
  path: string,
  overwrite: boolean,
  cancellation?: {
    readonly signal: AbortSignal;
    readonly operation: string;
  },
) =>
  withArtifactResourceScope((resources) =>
    writeTextParts(parts, path, overwrite, resources, cancellation),
  );

describe("evidence bundle publication", () => {
  it("retains the committed bundle receipt when cancellation arrives during final cleanup", async () => {
    const root = await createTestTempDirectory(
      "rea-delivery-published-cancel-",
    );
    const path = join(root, "bundle.json");
    const parent = analysisViewLayoutEvidence();
    const controller = new AbortController();
    const reason = new Error("cancel after actual staged-output cleanup");
    const close = OwnedStagedOutput.prototype.close;
    const seam = vi
      .spyOn(OwnedStagedOutput.prototype, "close")
      .mockImplementationOnce(async function (this: OwnedStagedOutput) {
        await close.call(this);
        controller.abort(reason);
      });
    let result: Awaited<ReturnType<typeof deliverAnalysisEvidence>>;
    try {
      result = await deliverAnalysisEvidence(
        parent,
        path,
        "summary",
        controller.signal,
      );
    } finally {
      seam.mockRestore();
    }
    if (result.ok) throw new Error("Cancelled delivery reported success");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(result.error.cause).toBe(reason);
    const bytes = await readFile(path);
    expect(result.error.diagnostics?.evidence_bundle).toEqual({
      path,
      bytes: bytes.length,
    });
    expect(
      parseEvidence(result.error.partialObservation).evidence_links,
    ).toEqual([parent.evidence_id]);
    expect(
      parseEvidenceBundle(JSON.parse(bytes.toString("utf8"))).records[0]
        ?.evidence_id,
    ).toBe(parent.evidence_id);
    expect(await readdir(root)).toEqual(["bundle.json"]);
  });

  it.each([false, true])(
    "never publishes a partial streamed file (overwrite: %s)",
    async (overwrite) => {
      const root = await createTestTempDirectory("rea-stream-publication-");
      const path = join(root, "bundle.json");
      if (overwrite) await writeFile(path, "original");
      function* brokenParts() {
        yield "partial";
        throw new Error("Source stream failed");
      }
      expect(await writeParts(brokenParts(), path, overwrite)).toMatchObject({
        ok: false,
        error: { _tag: "EvidenceFileError", reason: "io" },
      });
      expect(await readdir(root)).toEqual(overwrite ? ["bundle.json"] : []);
      if (overwrite) expect(await readFile(path, "utf8")).toBe("original");
    },
  );

  it("counts complete Unicode bytes and publishes a private file", async () => {
    const root = await createTestTempDirectory("rea-stream-bytes-");
    const path = join(root, "bundle.json");
    const parts = ["雪", "😀", "\n"];
    expect(await writeParts(parts, path, false)).toEqual({
      ok: true,
      value: { path, bytes: Buffer.byteLength(parts.join("")) },
    });
    expect(await readFile(path, "utf8")).toBe(parts.join(""));
    if (process.platform !== "win32")
      expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
  it("allows only one simultaneous export without overwrite approval", async () => {
    const root = await createTestTempDirectory("rea-evidence-exclusive-");
    const path = join(root, "bundle.json");
    const candidates = [bundle(), bundle(false)];
    const results = await Promise.all(
      candidates.map((value) => writeBundle(value, path, false)),
    );
    expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    expect(results.filter(({ ok }) => !ok)).toMatchObject([
      { ok: false, error: { _tag: "EvidenceFileError", reason: "exists" } },
    ]);
    const winner = candidates[results.findIndex(({ ok }) => ok)];
    expect(await readEvidenceBundle(path)).toEqual({
      ok: true,
      value: winner,
    });
    expect(await readdir(root)).toEqual(["bundle.json"]);
  });

  it("round trips caller-selected paths without configured roots", async () => {
    const root = await createTestTempDirectory("rea-evidence-dot-child-");
    const directory = join(root, "..cache");
    await mkdir(directory);
    const path = join(directory, "bundle.json");
    const value = bundle();
    expect(await writeBundle(value, path, false)).toMatchObject({
      ok: true,
    });
    expect(await readEvidenceBundle(path)).toEqual({
      ok: true,
      value,
    });
  });
});

it("reuses authenticated file snapshots while isolating mutable public reads", async () => {
  const directory = await createTestTempDirectory("rea-evidence-owned-");
  const path = join(directory, "bundle.json");
  const evidence = createEvidence(
    {
      path: "/local/observed-target",
      sha256: "a".repeat(64),
      format: "file",
    },
    { id: "fixture", name: "Fixture", version: "1" },
    { operation: "health", parameters: {}, result: { nested: [true] } },
  );
  const source = serializeEvidenceBundle(createEvidenceBundle([evidence]));
  await writeFile(path, source);
  const mutable = await readEvidenceBundle(path);
  if (!mutable.ok) throw mutable.error;
  expect(Object.isFrozen(mutable.value.records[0])).toBe(false);
  const loaded = await readImmutableEvidenceBundle(path);
  if (!loaded.ok) throw loaded.error;
  const record = loaded.value.records[0];
  if (record === undefined) throw new Error("Expected an imported record");
  expect(record).toEqual(evidence);
  expect(Object.isFrozen(loaded.value)).toBe(true);
  expect(Object.isFrozen(record.normalized_result)).toBe(true);
  expect(Reflect.set(record, "operation", "forged")).toBe(false);

  const ledger = new EvidenceLedger();
  const imported = ledger.import(loaded.value);
  if (!imported.ok) throw imported.error;
  expect(imported.value).toMatchObject({ recordsAdded: 1, changed: true });
  expect(ledger.forAnalysis(evidence.evidence_id)).toBe(record);
  const detached = ledger.get(evidence.evidence_id);
  if (detached === undefined) throw new Error("Expected a detached record");
  expect(Reflect.set(detached, "normalized_result", false)).toBe(true);
  expect(ledger.record(detached).ok).toBe(false);
  expect(ledger.export()).toEqual(loaded.value);
  expect(await readFile(path, "utf8")).toBe(source);
  ledger.clear();
});

it.skipIf(process.platform === "win32")(
  "rejects a regular-file parent traversal without writing to its lexical sibling",
  async () => {
    const directory = await createTestTempDirectory("rea-evidence-parent-");
    const blocker = join(directory, "file");
    await writeFile(blocker, "unchanged");
    const selected = `${blocker}/../bundle.json`;
    expect(await writeBundle(bundle(), selected, false)).toMatchObject({
      ok: false,
      error: { _tag: "EvidenceFileError", path: selected },
    });
    expect(await readdir(directory)).toEqual(["file"]);
    expect(await readFile(blocker, "utf8")).toBe("unchanged");
    const corrected = join(directory, "bundle.json");
    expect(await writeBundle(bundle(), corrected, false)).toMatchObject({
      ok: true,
      value: { path: corrected },
    });
    expect(await readEvidenceBundle(corrected)).toEqual({
      ok: true,
      value: bundle(),
    });
  },
);

describe("evidence bundle process-capture payloads", () => {
  it.each([false, true])(
    "rejects semantically invalid capture export before publication (overwrite: %s)",
    async (overwrite) => {
      const directory = await createTestTempDirectory(
        "rea-invalid-capture-bundle-",
      );
      const path = join(directory, "bundle.json");
      if (overwrite) await writeFile(path, "original");
      // Authenticate the enclosing Evidence correctly while breaking its
      // capture commitment, so generic bundle authentication still succeeds.
      const capture = EMPTY_PROCESS_CAPTURE_EXAMPLE;
      const record = createEvidence(undefined, PROCESS_PROVIDER, {
        predicateType: "rea.process-capture",
        operation: "capture_process_scenario",
        parameters: {},
        result: {
          ...capture,
          manifest: {
            ...capture.manifest,
            full_scenario_sha256: "0".repeat(64),
          },
        },
      });
      const value = createEvidenceBundle([record]);
      const rejected = await writeBundle(value, path, overwrite);
      if (rejected.ok) throw new Error("Expected invalid capture rejection");
      expect(rejected.error).toMatchObject({
        _tag: "EvidenceIntegrityError",
        userMessage: expect.stringContaining(
          `Process capture record ${record.evidence_id} has an invalid normalized_result`,
        ),
      });
      expect(await readdir(directory)).toEqual(
        overwrite ? ["bundle.json"] : [],
      );
      if (overwrite) expect(await readFile(path, "utf8")).toBe("original");
      // Existing files and inline authentication use the same rejection facts.
      await writeFile(path, serializeEvidenceBundle(value));
      for (const read of [readEvidenceBundle, readImmutableEvidenceBundle]) {
        const loaded = await read(path);
        if (loaded.ok) throw new Error("Expected invalid capture rejection");
        expect(projectAnalysisError(loaded.error)).toEqual(
          projectAnalysisError(rejected.error),
        );
      }
    },
  );

  it.each([
    {
      label: "current provider",
      provider: PROCESS_PROVIDER,
      operation: "capture_process_scenario",
      predicateType: "rea.process-capture",
      result: EMPTY_PROCESS_CAPTURE_EXAMPLE,
    },
    {
      label: "historical provider name",
      provider: {
        ...PROCESS_PROVIDER,
        name: "REA deterministic process harness",
      },
      operation: "capture_process_scenario",
      predicateType: "rea.process-capture",
      result: EMPTY_PROCESS_CAPTURE_EXAMPLE,
    },
    {
      label: "foreign provider and operation",
      provider: { id: "foreign", name: "Foreign capture", version: "1" },
      operation: "historical_capture",
      predicateType: "rea.process-capture",
      result: EMPTY_PROCESS_CAPTURE_EXAMPLE,
    },
    {
      label: "unrelated predicate",
      provider: PROCESS_PROVIDER,
      operation: "capture_process_scenario",
      predicateType: "foreign.payload",
      result: {},
    },
  ])(
    "round trips capture-related records without narrowing their identities ($label)",
    async ({ provider, operation, predicateType, result }) => {
      const directory = await createTestTempDirectory(
        "rea-capture-bundle-identity-",
      );
      const path = join(directory, "bundle.json");
      const value = createEvidenceBundle([
        createEvidence(undefined, provider, {
          operation,
          predicateType,
          result,
          parameters: {},
        }),
      ]);
      expect(await writeBundle(value, path, false)).toMatchObject({ ok: true });
      for (const read of [readEvidenceBundle, readImmutableEvidenceBundle])
        expect(await read(path)).toEqual({ ok: true, value });
    },
  );
});

it.each([true, false])(
  "refuses symlink exports in both overwrite modes (target exists: %s)",
  async (targetExists) => {
    const directory = await createTestTempDirectory("rea-evidence-link-");
    const outside = join(directory, "outside");
    await mkdir(outside);
    const outsidePath = join(outside, "bundle.json");
    const encoded = serializeEvidenceBundle(bundle());
    if (targetExists) await writeFile(outsidePath, encoded);
    const link = join(directory, "escaped.json");
    await symlink(outsidePath, link);
    if (targetExists)
      expect(await readEvidenceBundle(link)).toMatchObject({
        ok: true,
        value: bundle(),
      });
    for (const overwrite of [false, true]) {
      expect(await writeBundle(bundle(), link, overwrite)).toMatchObject({
        ok: false,
        error: { _tag: "EvidenceFileError", reason: "not-file", path: link },
      });
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
      expect((await readdir(directory)).sort()).toEqual([
        "escaped.json",
        "outside",
      ]);
      expect(await readdir(outside)).toEqual(
        targetExists ? ["bundle.json"] : [],
      );
      if (targetExists)
        expect(await readFile(outsidePath, "utf8")).toBe(encoded);
    }
  },
);

describe("evidence bundle filesystem adapter", () => {
  it.skipIf(process.platform === "win32").each(["/", "/."])(
    "preserves the directory requirement of a missing output ending in %s",
    async (suffix) => {
      const directory = await createTestTempDirectory(
        "rea-evidence-directory-",
      );
      const selected = `${join(directory, "report.json")}${suffix}`;
      expect(await writeBundle(bundle(), selected, false)).toMatchObject({
        ok: false,
        error: { _tag: "EvidenceFileError", reason: "not-file" },
      });
      expect(await readdir(directory)).toEqual([]);
    },
  );

  it("round trips canonical bytes and requires explicit overwrite", async () => {
    const directory = await createTestTempDirectory("rea-evidence-");
    const path = join(directory, "bundle.json");
    const evidenceBundle = bundle();
    const first = await writeBundle(evidenceBundle, path, false);
    expect(first).toMatchObject({ ok: true, value: { path } });
    expect(await readFile(path, "utf8")).toBe(
      serializeEvidenceBundle(evidenceBundle),
    );
    expect(await readEvidenceBundle(path)).toEqual({
      ok: true,
      value: evidenceBundle,
    });
    expect(
      await compareEvidenceBundlesCommand({
        leftPath: path,
        rightPath: path,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        status: "unchanged",
        summary: { records_unchanged: 1 },
      },
    });
    expect(await writeBundle(evidenceBundle, path, false)).toMatchObject({
      ok: false,
      error: { _tag: "EvidenceFileError", reason: "exists" },
    });
    expect(await writeBundle(evidenceBundle, path, true)).toMatchObject({
      ok: true,
    });
  });

  it("reports a missing file or output directory with the selected path", async () => {
    const directory = await createTestTempDirectory("rea-evidence-");
    const absent = join(directory, "absent.json");
    const read = await readEvidenceBundle(absent);
    expect(read).toMatchObject({
      ok: false,
      error: { _tag: "EvidenceFileError", reason: "missing", path: absent },
    });
    if (read.ok) throw new Error("Expected a missing-file failure");
    expect(projectAnalysisError(read.error)).toMatchObject({
      message: expect.stringContaining("does not exist at the selected path"),
      details: { operation: "read", reason: "missing", path: absent },
    });

    const orphan = join(directory, "absent", "bundle.json");
    const written = await writeBundle(bundle(), orphan, false);
    expect(written).toMatchObject({
      ok: false,
      error: { _tag: "EvidenceFileError", reason: "missing", path: orphan },
    });
    if (written.ok) throw new Error("Expected a missing-directory failure");
    expect(projectAnalysisError(written.error).message).toContain(
      "output directory does not exist",
    );
  });

  it.each([readEvidenceBundle, readImmutableEvidenceBundle])(
    "rejects malformed and tampered input (%s)",
    async (readBundle) => {
      const directory = await createTestTempDirectory("rea-evidence-");
      const malformed = join(directory, "malformed.json");
      await writeFile(malformed, "{");
      expect(await readBundle(malformed)).toMatchObject({
        ok: false,
        error: { _tag: "EvidenceFileError", reason: "invalid-json" },
      });

      const tampered = bundle();
      const tamperedPath = join(directory, "tampered.json");
      await writeFile(
        tamperedPath,
        JSON.stringify({
          ...tampered,
          records: [{ ...tampered.records[0], normalized_result: "changed" }],
        }),
      );
      expect(await readBundle(tamperedPath)).toMatchObject({
        ok: false,
        error: {
          _tag: "EvidenceIntegrityError",
          userMessage: expect.stringContaining(
            "at records.0.evidence_id: Evidence semantic identifier does not match its record",
          ),
        },
      });
    },
  );

  it("names schema mismatches that prevent bundle parsing", async () => {
    const directory = await createTestTempDirectory("rea-evidence-");
    const partial = join(directory, "partial.json");
    await writeFile(partial, JSON.stringify({ evidence_id: "typo" }));
    const rejected = await readEvidenceBundle(partial);
    expect(rejected).toMatchObject({
      ok: false,
      error: {
        userMessage: expect.stringContaining(
          "does not match the bundle schema",
        ),
      },
    });
    expect(rejected).not.toMatchObject({
      error: { userMessage: expect.stringContaining("one Evidence record") },
    });

    const mismatched = join(directory, "mismatched.json");
    await writeFile(mismatched, JSON.stringify({ ...bundle(), records: {} }));
    expect(await readEvidenceBundle(mismatched)).toMatchObject({
      ok: false,
      error: {
        _tag: "EvidenceIntegrityError",
        userMessage: expect.stringContaining(
          "does not match the bundle schema at records:",
        ),
      },
    });
  });
});

describe("standalone Evidence bundle inputs", () => {
  it("classifies a record only after authenticating it", async () => {
    const directory = await createTestTempDirectory("rea-evidence-");
    const record = bundle().records[0];
    const single = join(directory, "record.json");
    await writeFile(single, JSON.stringify(record));
    expect(await readEvidenceBundle(single)).toMatchObject({
      ok: false,
      error: {
        _tag: "EvidenceFileError",
        reason: "wrong-kind",
        path: single,
        userMessage: expect.stringContaining(
          `this JSON is one Evidence record (${String(record?.evidence_id)})`,
        ),
      },
    });

    const tamperedRecord = join(directory, "tampered-record.json");
    await writeFile(
      tamperedRecord,
      JSON.stringify({ ...record, normalized_result: "changed" }),
    );
    expect(await readEvidenceBundle(tamperedRecord)).toMatchObject({
      ok: false,
      error: {
        _tag: "EvidenceIntegrityError",
        userMessage: expect.stringContaining(
          "does not match the bundle schema",
        ),
      },
    });
  });
});

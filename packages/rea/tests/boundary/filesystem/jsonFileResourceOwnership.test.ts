import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { readJsonFile } from "../../../src/application/JsonFiles.js";
import { RegularFileCleanupFailure } from "../../../src/filesystem/OwnedRegularFile.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { EvidenceFileError } from "../../../src/domain/evidenceErrors.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("keeps a cleanup-shaped caller cancellation opaque before JSON admission", async () => {
  const root = await createTestTempDirectory("rea-json-opaque-cancel-");
  const path = join(root, "input.json");
  await writeFile(path, "{}");
  const owner = new OwnedFileHandle(await open(path, "r"));
  const reason = new RegularFileCleanupFailure({
    path,
    owner,
    outcome: { kind: "completed", value: null },
    cleanupCause: new Error("foreign owner"),
  });
  const controller = new AbortController();
  controller.abort(reason);
  const close = vi.spyOn(owner, "close");
  try {
    const result = await readJsonFile(path, controller.signal);
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error).toMatchObject({
      _tag: "AnalysisCancelledError",
      cleanupIncomplete: false,
    });
    expect(result.error.cause).toBe(reason);
    expect(close).not.toHaveBeenCalled();
    expect(owner.handle.fd).toBeGreaterThanOrEqual(0);
  } finally {
    close.mockRestore();
    await owner.close();
  }
});

it("retains and retries a JSON file owner after a persistent close failure", async () => {
  const root = await createTestTempDirectory("rea-json-file-owner-");
  const path = join(root, "input.json");
  await writeFile(path, '{"value":"retained"}');
  const resources = new ArtifactResourceScope();
  const closeFailure = new Error("injected persistent close failure");
  let attempts = 0;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async () => {
      attempts += 1;
      throw closeFailure;
    });
  try {
    const result = await readJsonFile(path, undefined, resources);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a typed JSON cleanup failure");
    expect(result.error).toBeInstanceOf(EvidenceFileError);
    expect(result.error.cleanupIncomplete).toBe(true);
    const failure = result.error.cause;
    expect(failure).toBeInstanceOf(RegularFileCleanupFailure);
    if (!(failure instanceof RegularFileCleanupFailure))
      throw new Error("Expected the failed file owner to remain visible");
    expect(failure.cleanupCause).toBe(closeFailure);
    expect(failure.outcome).toMatchObject({
      kind: "completed",
      value: { ok: true, value: { value: "retained" } },
    });
    expect(failure.owner.handle.fd).toBeGreaterThanOrEqual(0);
    expect(attempts).toBe(2);
    const blocked = await readJsonFile(path, undefined, resources);
    if (blocked.ok)
      throw new Error("Expected retained cleanup to block admission");
    expect(attempts).toBe(3);
    expect(blocked.error.cleanupIncomplete).toBe(true);
    close.mockRestore();
    await resources.close();
    expect(failure.owner.handle.fd).toBe(-1);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(blocked.error.cleanupIncomplete).toBe(false);
  } finally {
    close.mockRestore();
    await resources.close();
  }
});

it("retains malformed JSON over cancellation during failed final close", async () => {
  const root = await createTestTempDirectory("rea-json-invalid-close-");
  const path = join(root, "input.json");
  await writeFile(path, '{"unterminated":');
  const resources = new ArtifactResourceScope();
  const controller = new AbortController();
  const reason = { caller: "stop after parsing" };
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async () => {
      controller.abort(reason);
      throw new Error("controlled close failure");
    });
  try {
    const result = await readJsonFile(path, controller.signal, resources);
    if (result.ok) throw new Error("Expected invalid JSON and cleanup failure");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        diagnostics: {
          primary_error: {
            code: "evidence_integrity_mismatch",
            details: { reason: "invalid-json" },
          },
        },
      },
    });
    close.mockRestore();
    await resources.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupPrimary).toMatchObject({
      reason: "invalid-json",
    });
  } finally {
    close.mockRestore();
    await resources.close();
  }
});

it("returns parsed JSON when a failed file close is recovered by the resource scope", async () => {
  const root = await createTestTempDirectory("rea-json-file-close-retry-");
  const path = join(root, "input.json");
  await writeFile(path, '{"value":"retained"}');
  const resources = new ArtifactResourceScope();
  const closeFailure = new Error("injected transient close failure");
  const originalClose = OwnedFileHandle.prototype.close;
  let attempts = 0;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      attempts += 1;
      if (attempts === 1) throw closeFailure;
      await originalClose.call(this);
    });
  try {
    const parsed = await readJsonFile(path, undefined, resources);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value).toEqual({ value: "retained" });
    expect(attempts).toBe(2);
  } finally {
    close.mockRestore();
    await resources.close();
  }
});

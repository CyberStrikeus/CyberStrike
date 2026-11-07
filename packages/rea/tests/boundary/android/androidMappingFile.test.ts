import { createHash } from "node:crypto";
import { stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { readAndroidMapping } from "../../../src/android/AndroidMappingFile.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { ANDROID_MAPPING_LIMITS } from "../../../src/domain/android/androidMapping.js";
import { resolveProguardClass } from "../../../src/domain/android/proguardMapping.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const SOURCE = "# compiler: R8\nexample.Old -> a:\n    int value -> b\n";
const OPERATION = "inspect_android_class";
const digest = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

const fixture = async (text = SOURCE) => {
  const root = await createTestTempDirectory("rea-android-mapping-file-");
  const resources = new ArtifactResourceScope();
  onTestFinished(() => resources.close());
  const path = join(root, "mapping.txt");
  await writeFile(path, text);
  return { root, path, resources };
};

it("reuses parsed facts for re-read identical bytes while preserving each selected path", async () => {
  const { root, path, resources } = await fixture();
  const signal = new AbortController().signal;
  const first = await readAndroidMapping(path, OPERATION, resources, signal);
  if (!first.ok) throw first.error;
  const warm = await readAndroidMapping(
    path,
    OPERATION,
    resources,
    signal,
    first.value,
  );
  if (!warm.ok) throw warm.error;
  expect(warm.value.mapping).toBe(first.value.mapping);
  expect(warm.value.file).toEqual({
    path,
    sha256: digest(SOURCE),
    bytes: Buffer.byteLength(SOURCE),
  });

  const selected = join(root, "selected-相同 mapping.txt");
  await writeFile(selected, SOURCE);
  const moved = await readAndroidMapping(
    selected,
    OPERATION,
    resources,
    signal,
    first.value,
  );
  if (!moved.ok) throw moved.error;
  expect(moved.value.mapping).toBe(first.value.mapping);
  expect(moved.value.file).toEqual({ ...first.value.file, path: selected });
  expect(first.value.file.path).toBe(path);
  expect(resources.hasPending).toBe(false);
});

it("invalidates cached facts after a same-length rewrite with restored modification time", async () => {
  const { path, resources } = await fixture();
  const fixed = new Date("2024-01-01T00:00:00Z");
  await utimes(path, fixed, fixed);
  const before = await stat(path);
  const signal = new AbortController().signal;
  const first = await readAndroidMapping(path, OPERATION, resources, signal);
  if (!first.ok) throw first.error;
  const changed = SOURCE.replace("example.Old", "example.New");
  await writeFile(path, changed);
  await utimes(path, before.atime, before.mtime);
  const after = await stat(path);
  expect({
    dev: after.dev,
    ino: after.ino,
    size: after.size,
    mtime: after.mtimeMs,
  }).toEqual({
    dev: before.dev,
    ino: before.ino,
    size: before.size,
    mtime: before.mtimeMs,
  });
  const refreshed = await readAndroidMapping(
    path,
    OPERATION,
    resources,
    signal,
    first.value,
  );
  if (!refreshed.ok) throw refreshed.error;
  expect(refreshed.value.mapping).not.toBe(first.value.mapping);
  expect(refreshed.value.file.sha256).toBe(digest(changed));
  expect(refreshed.value.file.sha256).not.toBe(first.value.file.sha256);
  expect(resolveProguardClass(refreshed.value.mapping, "a")).toMatchObject({
    status: "mapped",
    mapped: { name: "example.New" },
  });
  expect(resolveProguardClass(first.value.mapping, "a")).toMatchObject({
    status: "mapped",
    mapped: { name: "example.Old" },
  });
  expect(resources.hasPending).toBe(false);
});

it("rejects a deleted selected file even when parsed mapping facts are cached", async () => {
  const { path, resources } = await fixture();
  const signal = new AbortController().signal;
  const first = await readAndroidMapping(path, OPERATION, resources, signal);
  if (!first.ok) throw first.error;
  await unlink(path);
  const deleted = await readAndroidMapping(
    path,
    OPERATION,
    resources,
    signal,
    first.value,
  );
  if (deleted.ok)
    throw new Error("A deleted mapping must not be served from cache");
  expect(deleted.error).toBeInstanceOf(AnalysisInputError);
  expect(deleted.error).toMatchObject({
    issues: [{ path: ["mapping_path"], reason: "invalid_value" }],
    cleanupIncomplete: false,
  });
  expect(projectAnalysisError(deleted.error).code).toBe("invalid_request");
  expect(resources.hasPending).toBe(false);
});

it("preserves the caller cancellation cause instead of returning a cached mapping", async () => {
  const { path, resources } = await fixture();
  const first = await readAndroidMapping(
    path,
    OPERATION,
    resources,
    new AbortController().signal,
  );
  if (!first.ok) throw first.error;
  const controller = new AbortController();
  const reason = {
    caller: "mapping-read-cancellation",
    publicDetail: "keep this exact cause",
  };
  controller.abort(reason);
  const cancelled = await readAndroidMapping(
    path,
    OPERATION,
    resources,
    controller.signal,
    first.value,
  );
  if (cancelled.ok)
    throw new Error("Cancellation must win over parsed-cache reuse");
  expect(cancelled.error).toBeInstanceOf(AnalysisCancelledError);
  expect(cancelled.error.cause).toBe(reason);
  expect(cancelled.error.cleanupIncomplete).toBe(false);
  const retried = await readAndroidMapping(
    path,
    OPERATION,
    resources,
    new AbortController().signal,
    first.value,
  );
  if (!retried.ok) throw retried.error;
  expect(retried.value.mapping).toBe(first.value.mapping);
  expect(resources.hasPending).toBe(false);
});

it("refuses expanded shared-name claims from a small mapping with auditable nonretryable capacity facts", async () => {
  // One source name expands into every mapped field claim. Eight fields are
  // enough to cross the projection bound without a large record inventory.
  const owner = `example.${"X".repeat(1024 * 1024)}`;
  const text = [
    `${owner} -> a:`,
    ...Array.from(
      { length: 8 },
      (_, index) => `    int field${index} -> f${index}`,
    ),
  ].join("\n");
  expect(Buffer.byteLength(text)).toBeLessThan(1100 * 1024);
  const { path, resources } = await fixture(text);
  const result = await readAndroidMapping(
    path,
    OPERATION,
    resources,
    new AbortController().signal,
  );
  if (result.ok)
    throw new Error("Shared-name projection expansion must be refused");
  expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
  expect(result.error).toMatchObject({
    resource: "transport",
    retryable: false,
    reportedLimits: {
      limit_bytes: ANDROID_MAPPING_LIMITS.projectionBytes,
      line: expect.any(Number),
    },
    diagnostics: { mapping_path: path, mapping_sha256: digest(text) },
    cleanupIncomplete: false,
  });
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "resource_constraint",
    retryable: false,
    details: {
      resource: "transport",
      diagnostics: { mapping_path: path, mapping_sha256: digest(text) },
    },
  });
  expect(resources.hasPending).toBe(false);
});

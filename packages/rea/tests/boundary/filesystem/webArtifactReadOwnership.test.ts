import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";

const injected = vi.hoisted(() => ({
  sourcePath: undefined as string | undefined,
  abortController: undefined as AbortController | undefined,
  abortDuringClose: false,
  abortReason: undefined as unknown,
  readFailure: undefined as Error | undefined,
  failClose: false,
  closeAttempts: 0,
  sourceHandle: undefined as import("node:fs/promises").FileHandle | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (args[0] !== injected.sourcePath) return handle;
      injected.sourceHandle = handle;
      const read = handle.read.bind(handle);
      Object.defineProperty(handle, "read", {
        value: async (
          buffer: Buffer,
          offset: number,
          length: number,
          position: number,
        ) => {
          if (injected.readFailure !== undefined) throw injected.readFailure;
          const result = await read(buffer, offset, length, position);
          if (!injected.abortDuringClose)
            injected.abortController?.abort(injected.abortReason);
          return result;
        },
      });
      const close = handle.close.bind(handle);
      handle.close = async () => {
        injected.closeAttempts += 1;
        if (injected.abortDuringClose)
          injected.abortController?.abort(injected.abortReason);
        if (injected.failClose) throw new Error("fixture close refusal");
        await close();
      };
      return handle;
    },
  };
});

import { WebModuleTraceService } from "../../../src/application/WebModuleTraceService.js";
import { finishAnalysisCommand } from "../../../src/cli/finishAnalysisCommand.js";
import { LocalWebModuleArtifacts } from "../../../src/browser/modules/WebModuleArtifacts.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import {
  webArtifactAcquisitionSchema,
  type WebArtifactAcquisition,
} from "../../../src/domain/webArtifactAcquisition.js";
import { primaryAnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { webModuleArtifactsFixture } from "../../fixtures/webModuleTrace.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const sourceFixture = async (source: string) => {
  const root = await createTestTempDirectory("rea-web-artifact-read-owner-");
  const fixture = webModuleArtifactsFixture(source);
  const manifestPath = join(root, "manifest.json");
  const sourcePath = join(root, "files", "modules", "main.js");
  await mkdir(join(root, "files", "modules"), { recursive: true });
  const sourceBytes = Buffer.from(source);
  const manifestBytes = Buffer.from(JSON.stringify(fixture.manifest));
  await writeFile(sourcePath, sourceBytes);
  await writeFile(manifestPath, manifestBytes);
  return {
    input: { manifest_path: manifestPath, script_index: 0 },
    sourcePath,
    sourceBytes,
    manifestBytes,
  };
};

const fileIdentity = (path: string, bytes: Buffer) => ({
  path,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  bytes: bytes.length,
});

it("retains cancelled source read ownership until service close retries it", async () => {
  onTestFinished(() => {
    injected.sourcePath = undefined;
    injected.abortController = undefined;
    injected.abortDuringClose = false;
    injected.abortReason = undefined;
    injected.readFailure = undefined;
    injected.failClose = false;
    injected.closeAttempts = 0;
    injected.sourceHandle = undefined;
  });
  const { input, sourcePath, manifestBytes } =
    await sourceFixture('import "./dep.js";');

  injected.sourcePath = sourcePath;
  injected.failClose = true;
  const controller = new AbortController();
  injected.abortController = controller;
  injected.abortReason = { request: "cancel after source read" };
  const resolver = {
    resolve: vi.fn(),
    close: vi.fn(async () => undefined),
  };
  const service = new WebModuleTraceService(
    new LocalWebModuleArtifacts(),
    resolver,
  );
  onTestFinished(async () => {
    injected.failClose = false;
    injected.abortController = undefined;
    await service.close();
  });

  const cancelled = await service.trace(input, { signal: controller.signal });
  expect(cancelled.ok).toBe(false);
  if (cancelled.ok) throw new Error("Expected cancelled source read");
  const expectedAcquisition: WebArtifactAcquisition = {
    kind: "web-artifact-acquisition",
    analysis: "not-performed",
    files: [
      {
        role: "manifest",
        file: fileIdentity(input.manifest_path, manifestBytes),
        admission: "manifest-validated",
      },
    ],
  };
  expect(
    webArtifactAcquisitionSchema.parse(cancelled.error.partialObservation),
  ).toEqual(expectedAcquisition);
  expect(
    projectAnalysisError(cancelled.error).details?.partial_observation,
  ).toEqual(expectedAcquisition);
  expect(cancelled.error.cleanupIncomplete).toBe(true);
  expect(cancelled.error.cleanupResources).toContain(sourcePath);
  expect(resolver.resolve).not.toHaveBeenCalled();
  expect(primaryAnalysisError(cancelled.error).cause).toBe(
    injected.abortReason,
  );

  injected.abortController = undefined;
  const blocked = await service.trace(input);
  expect(blocked.ok).toBe(false);
  if (blocked.ok) throw new Error("Expected retained cleanup to block load");
  expect(blocked.error.cleanupIncomplete).toBe(true);
  expect(injected.closeAttempts).toBe(2);

  let cleanupFailure: unknown;
  try {
    await service.close();
  } catch (cause) {
    cleanupFailure = cause;
  }
  expect(cleanupFailure).toBeInstanceOf(ProviderCleanupError);
  expect(cleanupFailure).toMatchObject({
    operation: "trace_web_module_imports",
    cleanupResources: [sourcePath],
    diagnostics: { reason: expect.stringContaining("fixture close refusal") },
  });
  expect((cleanupFailure as ProviderCleanupError).cause).toBeInstanceOf(Error);
  expect(resolver.close).toHaveBeenCalledTimes(1);
  expect(injected.closeAttempts).toBe(3);

  const finalized = await finishAnalysisCommand(
    () => service.trace(input),
    service,
    "web-module-artifacts",
    "trace_web_module_imports",
    new AbortController().signal,
  ).then(projectCliAnalysisResult);
  expect(finalized).toMatchObject({
    code: "cleanup_incomplete",
    details: { resources: [sourcePath] },
  });
  expect(resolver.close).toHaveBeenCalledTimes(2);

  injected.failClose = false;
  const attemptsBeforeRetry = injected.closeAttempts;
  await service.close();
  expect(injected.closeAttempts).toBeGreaterThan(attemptsBeforeRetry);
  expect(resolver.close).toHaveBeenCalledTimes(3);
  expect(injected.sourceHandle?.fd).toBe(-1);
  expect(primaryAnalysisError(cancelled.error).partialObservation).toEqual(
    expectedAcquisition,
  );
  expect(
    projectAnalysisError(primaryAnalysisError(cancelled.error)).details
      ?.partial_observation,
  ).toEqual(expectedAcquisition);
  for (const error of [cancelled.error, blocked.error, cleanupFailure]) {
    expect(error).toMatchObject({
      cleanupIncomplete: false,
      cleanupResources: [],
    });
  }
});

it.each([
  { readFails: true, closeFails: false, cancel: true },
  { readFails: true, closeFails: true, cancel: true },
  { readFails: true, closeFails: true, cancel: false },
  { readFails: false, closeFails: false, cancel: true },
  { readFails: false, closeFails: true, cancel: true },
  { readFails: false, closeFails: false, cancel: false },
])(
  "keeps physical source read failure and exact cleanup ownership %j",
  async ({ readFails, closeFails, cancel }) => {
    const { input, sourcePath, sourceBytes, manifestBytes } =
      await sourceFixture("export const value = 1;");
    const physical = Object.assign(new Error("fixture descriptor EIO"), {
      code: "EIO",
      syscall: "read",
    });
    const reason = { request: "cancel during failed source finalization" };
    const controller = new AbortController();
    injected.sourcePath = sourcePath;
    injected.readFailure = readFails ? physical : undefined;
    injected.failClose = closeFails;
    injected.abortController = cancel ? controller : undefined;
    injected.abortDuringClose = true;
    injected.abortReason = reason;
    injected.closeAttempts = 0;
    const service = new WebModuleTraceService(new LocalWebModuleArtifacts(), {
      resolve: vi.fn(),
    });
    onTestFinished(async () => {
      injected.failClose = false;
      injected.abortController = undefined;
      await service.close();
      injected.sourcePath = undefined;
      injected.readFailure = undefined;
      injected.abortDuringClose = false;
      injected.abortReason = undefined;
      injected.closeAttempts = 0;
      injected.sourceHandle = undefined;
    });
    const result = await service.trace(input, { signal: controller.signal });
    expect(controller.signal.aborted).toBe(cancel);
    if (cancel) expect(controller.signal.reason).toBe(reason);
    if (!readFails && !cancel) {
      if (!result.ok) throw result.error;
      expect(result.value.normalized_result).toMatchObject({
        source: {
          path: sourcePath,
          sha256: fileIdentity(sourcePath, sourceBytes).sha256,
        },
        manifest: { path: input.manifest_path },
      });
      await service.close();
      expect(injected.sourceHandle?.fd).toBe(-1);
      expect(injected.closeAttempts).toBe(1);
      return;
    }
    if (result.ok) throw new Error("Expected source read failure");
    const primary = primaryAnalysisError(result.error);
    if (readFails)
      expect(primary).toMatchObject({
        _tag: "ArtifactOperationError",
        reason: "io",
      });
    else expect(primary).toBeInstanceOf(AnalysisCancelledError);
    expect(primary.cause).toBe(readFails ? physical : reason);
    const expectedAcquisition: WebArtifactAcquisition = {
      kind: "web-artifact-acquisition",
      analysis: "not-performed",
      files: [
        {
          role: "manifest",
          file: fileIdentity(input.manifest_path, manifestBytes),
          admission: "manifest-validated",
        },
        // Descriptor-finalization cancellation precedes selected-source digest/length admission.
        ...(!readFails
          ? [
              {
                role: "source" as const,
                file: fileIdentity(sourcePath, sourceBytes),
                admission: "read" as const,
              },
            ]
          : []),
      ],
    };
    expect(
      webArtifactAcquisitionSchema.parse(result.error.partialObservation),
    ).toEqual(expectedAcquisition);
    expect(primary.partialObservation).toEqual(expectedAcquisition);
    expect(
      projectAnalysisError(result.error).details?.partial_observation,
    ).toEqual(expectedAcquisition);
    expect(result.error.cleanupIncomplete).toBe(closeFails);
    if (closeFails) {
      expect(result.error.cleanupResources).toEqual([sourcePath]);
      expect(injected.sourceHandle?.fd).toBeGreaterThanOrEqual(0);
    }
    injected.failClose = false;
    await service.close();
    expect(injected.sourceHandle?.fd).toBe(-1);
    expect(injected.closeAttempts).toBe(closeFails ? 2 : 1);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    expect(primaryAnalysisError(result.error)).toBe(primary);
    expect(primary.partialObservation).toEqual(expectedAcquisition);
    expect(projectAnalysisError(primary).details?.partial_observation).toEqual(
      expectedAcquisition,
    );
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: readFails ? "artifact_operation_failed" : "cancelled",
      ...(readFails
        ? {
            details: {
              reason: "io",
              detail: expect.stringContaining("EIO"),
            },
          }
        : {}),
    });
  },
);

it("preserves both web cleanup owners' resources, diagnostics and recovery actions", async () => {
  const artifacts = new ProviderCleanupError(
    "web-artifacts",
    ["artifact-root", "shared-resource"],
    { reason: "artifact cleanup denied" },
    { remediationAction: "Release the retained artifact lease." },
  );
  const resolver = new AnalysisCancelledError("web-resolution", {
    cleanup: {
      reason: "resolver shutdown unconfirmed",
      resources: ["resolver-root", "shared-resource"],
    },
  });
  const service = new WebModuleTraceService(
    {
      load: vi.fn(),
      close: async () => {
        throw artifacts;
      },
    },
    {
      resolve: vi.fn(),
      close: async () => {
        throw resolver;
      },
    },
  );
  const projected = [artifacts, resolver].map(projectAnalysisError);
  await expect(service.close()).rejects.toMatchObject({
    cleanupResources: ["artifact-root", "shared-resource", "resolver-root"],
    diagnostics: { failures: projected },
    remediationAction: projected
      .map(({ remediation }) => remediation.action)
      .join("; "),
  });
});

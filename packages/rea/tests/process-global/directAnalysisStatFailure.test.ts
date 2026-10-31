import { projectCliAnalysisResult } from "../../src/cli/projectCliAnalysisResult.js";
import { afterEach, expect, it, vi } from "vitest";

const statFailures = vi.hoisted(() => new Map<string, unknown>());

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    stat: vi.fn(async (...args: Parameters<typeof original.stat>) => {
      const failure = statFailures.get(String(args[0]));
      if (failure !== undefined) throw failure;
      return original.stat(...args);
    }),
  };
});

import { parseConfig } from "../../src/config/parseConfig.js";
import { classifyBinaryTargetFilesystemFailure } from "../../src/application/BinaryTargetResolver.js";
import type { BinarySession } from "../../src/application/binary/BinarySession.js";
import type { DirectAnalysisDependencies } from "../../src/application/DirectAnalysisDependencies.js";
import { runProviderAnalysis } from "../../src/application/DirectAnalysis.js";

afterEach(() => statFailures.clear());

it("retains the original filesystem cause on the shared typed error", () => {
  const cause = Object.assign(new Error("permission denied"), {
    code: "EACCES",
  });
  const failure = classifyBinaryTargetFilesystemFailure(
    "/tmp/rea-stat-failure-cause.app",
    cause,
  );

  expect(failure?.cause).toBe(cause);
  expect(failure?.systemCode).toBe("EACCES");
});

it.each([
  { code: "ENOENT", projectedCode: "target_unavailable" },
  { code: "ENOTDIR", projectedCode: "target_unavailable" },
  { code: "EACCES", projectedCode: "access_denied", systemCode: "EACCES" },
  { code: "EPERM", projectedCode: "access_denied", systemCode: "EPERM" },
  { code: "EIO", projectedCode: "target_unavailable" },
])(
  "stops CLI resource dispatch on stat failure $code and preserves its path",
  async ({ code, projectedCode, systemCode }) => {
    const path = `/tmp/rea-stat-failure-${code}.app`;
    const cause = Object.assign(new Error(`${code}: injected stat failure`), {
      code,
    });
    statFailures.set(path, cause);
    const session = {
      close: vi.fn(async () => ({ ok: true as const, value: null })),
      open: vi.fn(),
      openBundleResources: vi.fn(),
      execute: vi.fn(),
    } as unknown as BinarySession;
    const dependencies: DirectAnalysisDependencies = {
      readConfiguration: () => parseConfig({}),
      createBinarySession: () => session,
      createNativeDispatchBinarySession: () => session,
      createArtifactBinarySession: () => session,
      createNativeBinarySession: () => session,
      createManagedBinarySession: () => session,
    };

    const output = await runProviderAnalysis(
      dependencies,
      path,
      "inspect_keyed_archive",
      { path: "Resources/Archive.plist" },
    ).then(projectCliAnalysisResult);

    expect(output).toMatchObject({
      code: projectedCode,
      details: {
        path,
        reason: expect.stringContaining(cause.message),
        ...(systemCode === undefined ? {} : { system_code: systemCode }),
      },
    });
    expect(session.open).not.toHaveBeenCalled();
    expect(session.openBundleResources).not.toHaveBeenCalled();
    expect(session.execute).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
  },
);

it("rethrows an unclassified stat failure instead of treating it as a file", async () => {
  const path = "/tmp/rea-stat-failure-opaque.app";
  const cause = new Error("opaque filesystem failure");
  statFailures.set(path, cause);
  const session = {
    close: vi.fn(async () => ({ ok: true as const, value: null })),
    open: vi.fn(),
    openBundleResources: vi.fn(),
    execute: vi.fn(),
  } as unknown as BinarySession;
  const dependencies: DirectAnalysisDependencies = {
    readConfiguration: () => parseConfig({}),
    createBinarySession: () => session,
    createNativeDispatchBinarySession: () => session,
    createArtifactBinarySession: () => session,
    createNativeBinarySession: () => session,
    createManagedBinarySession: () => session,
  };

  await expect(
    runProviderAnalysis(dependencies, path, "inspect_keyed_archive", {
      path: "Resources/Archive.plist",
    }).then(projectCliAnalysisResult),
  ).rejects.toBe(cause);
  expect(session.open).not.toHaveBeenCalled();
  expect(session.openBundleResources).not.toHaveBeenCalled();
  expect(session.execute).not.toHaveBeenCalled();
  expect(session.close).toHaveBeenCalledOnce();
});

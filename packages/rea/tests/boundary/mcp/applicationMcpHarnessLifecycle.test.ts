import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import type { AnalysisClient } from "../../../src/application/AnalysisProvider.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { err, ok } from "../../../src/domain/result.js";
import {
  createApplicationMcpHarness,
  type ApplicationMcpHarness,
} from "../../fixtures/applicationMcpHarness.js";
import {
  createCacheProvider,
  createDeferred,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const failureLeaves = (reason: unknown): unknown[] =>
  reason instanceof AggregateError
    ? reason.errors.flatMap(failureLeaves)
    : [reason];

const acquireProvider = async (
  close: AnalysisClient["close"],
  serverOptions?: NonNullable<
    Parameters<typeof createApplicationMcpHarness>[0]
  >["serverOptions"],
) => {
  const directory = await createTestTempDirectory("rea-mcp-harness-close-");
  const path = join(directory, "target.hop");
  await writeFile(path, "fixture database bytes");
  const operations: string[] = [];
  const provider = createCacheProvider(operations);
  const createClient = vi.fn(provider.createClient);
  provider.createClient = (...args) => ({ ...createClient(...args), close });
  const harness = await createApplicationMcpHarness({
    serverOptions,
    session: createTestBinarySession(provider),
  });
  expect(
    (
      await harness.client.callTool({
        name: "open_binary",
        arguments: { path },
      })
    ).isError,
  ).not.toBe(true);
  expect(
    (
      await harness.client.callTool({
        name: "address_name",
        arguments: { address: "0x1000", document: "fixture" },
      })
    ).isError,
  ).not.toBe(true);
  expect(operations).toEqual(["address_name"]);
  expect(createClient).toHaveBeenCalledTimes(1);
  return { harness, createClient };
};

it("reports a failed session close, joins concurrent attempts and retries the retained provider", async () => {
  const failure = new ProviderCleanupError("fixture", ["binary-owner"], {
    reason: "controlled binary close denial",
  });
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  let allowClose = false;
  const closeProvider = vi.fn(async () => {
    entered.resolve();
    await release.promise;
    if (!allowClose) return err(failure);
    failure.resolveCleanup();
    return ok(null);
  });
  let harness: ApplicationMcpHarness | undefined;
  try {
    const acquired = await acquireProvider(closeProvider);
    harness = acquired.harness;
    const closing = harness.close();
    const outcome = closing.catch((reason: unknown) => reason);
    await entered.promise;
    const concurrent = harness.close();
    const concurrentOutcome = concurrent.catch((reason: unknown) => reason);
    expect(closeProvider).toHaveBeenCalledTimes(1);
    release.resolve();
    const reason: unknown = await outcome;
    expect(reason).toBeInstanceOf(AggregateError);
    if (!(reason instanceof AggregateError))
      throw new Error("Harness ignored the session close failure");
    expect(reason.errors).toContain(failure);
    expect(concurrent).toBe(closing);
    expect(await concurrentOutcome).toBe(reason);
    expect(failure.cleanupIncomplete).toBe(true);
    expect(await harness.session.status()).toMatchObject({
      cleanup_pending: true,
    });

    allowClose = true;
    await harness.close();
    expect(acquired.createClient).toHaveBeenCalledTimes(1);
    expect(closeProvider).toHaveBeenCalledTimes(2);
    expect(failure.cleanupIncomplete).toBe(false);
    expect(await harness.session.status()).toMatchObject({
      cleanup_pending: false,
    });
    await harness.close();
    expect(closeProvider).toHaveBeenCalledTimes(2);
  } finally {
    allowClose = true;
    release.resolve();
    await harness?.close();
  }
});

it("preserves independent MCP provider and session close failures and releases each owner once", async () => {
  const binaryFailure = new ProviderCleanupError("fixture", ["binary-owner"], {
    reason: "controlled binary close denial",
  });
  const adbFailure = new Error("controlled ADB close denial");
  let allowBinaryClose = false;
  let allowAdbClose = false;
  const closeBinary = vi.fn(async () => {
    if (!allowBinaryClose) return err(binaryFailure);
    binaryFailure.resolveCleanup();
    return ok(null);
  });
  const closeAdb = vi.fn(async () => {
    if (!allowAdbClose) throw adbFailure;
  });
  let harness: ApplicationMcpHarness | undefined;
  try {
    const acquired = await acquireProvider(closeBinary, {
      adbDeviceAnalysis: {
        inspectAvailability: async () => ({
          status: "available",
          code: null,
          reason: null,
          diagnostics: {},
        }),
        execute: async () => {
          throw new Error("This fixture must not execute ADB operations");
        },
        close: closeAdb,
      },
    });
    harness = acquired.harness;
    const reason: unknown = await harness
      .close()
      .catch((cause: unknown) => cause);
    expect(reason).toBeInstanceOf(AggregateError);
    if (!(reason instanceof AggregateError))
      throw new Error("Harness lost independent cleanup failures");
    expect(failureLeaves(reason)).toEqual(
      expect.arrayContaining([binaryFailure, adbFailure]),
    );
    expect(failureLeaves(reason)).toHaveLength(2);
    expect(closeBinary).toHaveBeenCalledTimes(1);
    expect(closeAdb).toHaveBeenCalled();
    expect(await harness.session.status()).toMatchObject({
      cleanup_pending: true,
    });

    allowAdbClose = true;
    await expect(harness.close()).rejects.toMatchObject({
      errors: [binaryFailure],
    });
    const completedAdbCloses = closeAdb.mock.calls.length;
    expect(closeBinary).toHaveBeenCalledTimes(2);
    allowBinaryClose = true;
    await harness.close();
    expect(acquired.createClient).toHaveBeenCalledTimes(1);
    expect(closeBinary).toHaveBeenCalledTimes(3);
    expect(closeAdb).toHaveBeenCalledTimes(completedAdbCloses);
    expect(binaryFailure.cleanupIncomplete).toBe(false);
    expect(await harness.session.status()).toMatchObject({
      cleanup_pending: false,
    });
    await harness.close();
    expect(closeBinary).toHaveBeenCalledTimes(3);
    expect(closeAdb).toHaveBeenCalledTimes(completedAdbCloses);
  } finally {
    allowBinaryClose = true;
    allowAdbClose = true;
    await harness?.close();
  }
});

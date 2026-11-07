import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import type { AnalysisOperation } from "../../../src/application/AnalysisProvider.js";
import { RetainedRegularFileCleanupFailure } from "../../../src/application/RegularFileRead.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import type { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { ok, err } from "../../../src/domain/result.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import {
  createCacheProvider,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { observed } from "../../fixtures/analysisExecution.js";

it.each(
  [true, false].flatMap((supported) =>
    [true, false].map((cancel) => ({ supported, cancel })),
  ),
)(
  "retains target admission and one descriptor through failed close (supported=$supported, cancelled=$cancel)",
  async ({ supported, cancel }) => {
    const directory = await createTestTempDirectory("rea-target-close-");
    const path = join(directory, supported ? "target.hop" : "target.bin");
    const bytes = Buffer.from("target source bytes");
    await writeFile(path, bytes);
    const resources = new ArtifactResourceScope();
    const controller = new AbortController();
    const reason = { caller: "cancel during target close" };
    const nativeClose = OwnedFileHandle.prototype.close;
    let denied = true;
    const owners: OwnedFileHandle[] = [];
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        owners.push(this);
        if (cancel) controller.abort(reason);
        if (denied) throw new Error("controlled target close denial");
        await nativeClose.call(this);
      });
    try {
      const result = await parseBinaryTarget(path, {
        resources,
        signal: controller.signal,
      });
      if (result.ok) throw new Error("Expected retained target cleanup");
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cause).toBeInstanceOf(
        RetainedRegularFileCleanupFailure,
      );
      const failure = result.error.cause as RetainedRegularFileCleanupFailure;
      expect(failure.owner).toBe(owners[0]);
      if (supported) {
        expect(result.error.diagnostics).toMatchObject({
          completed_target: {
            path,
            format: "analysis-database",
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        });
        if (cancel) {
          expect(result.error.cleanupPrimary).toMatchObject({
            _tag: "AnalysisCancelledError",
          });
          expect(result.error.cleanupPrimary?.cause).toBe(reason);
        }
      } else {
        expect(result.error.cleanupPrimary).toMatchObject({
          _tag: "BinaryTargetError",
          constraint: "file_format_rejected",
        });
      }
      const blocked = await parseBinaryTarget(path, { resources });
      if (blocked.ok)
        throw new Error(
          "Expected unresolved cleanup to block another admission",
        );
      expect(owners).toHaveLength(3);
      expect(owners.every((owner) => owner === failure.owner)).toBe(true);
      denied = false;
      await resources.retryCleanup();
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(blocked.error.cleanupIncomplete).toBe(false);
      expect(failure.owner.handle.fd).toBe(-1);
      if (supported && cancel)
        expect(result.error.cleanupPrimary?.diagnostics).toMatchObject({
          completed_target: { path },
        });
      expect((await parseBinaryTarget(path, { resources })).ok).toBe(supported);
    } finally {
      denied = false;
      await resources.close();
      close.mockRestore();
    }
  },
);

it.each([true, false])(
  "keeps target completion or refusal when cancellation arrives during confirmed close (supported=%s)",
  async (supported) => {
    const directory = await createTestTempDirectory("rea-target-final-cancel-");
    const path = join(directory, supported ? "target.hop" : "target.bin");
    await writeFile(path, "target source bytes");
    const controller = new AbortController();
    const reason = "caller stopped after reading";
    const nativeClose = OwnedFileHandle.prototype.close;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        await nativeClose.call(this);
        controller.abort(reason);
      });
    try {
      const result = await parseBinaryTarget(path, {
        signal: controller.signal,
      });
      if (result.ok) throw new Error("Expected refusal or cancellation");
      expect(result.error.cleanupIncomplete).toBe(false);
      if (supported) {
        expect(result.error).toMatchObject({
          _tag: "AnalysisCancelledError",
          cause: reason,
          diagnostics: { completed_target: { path } },
        });
      } else {
        expect(result.error).toMatchObject({
          _tag: "BinaryTargetError",
          constraint: "file_format_rejected",
        });
      }
    } finally {
      close.mockRestore();
    }
  },
);

it("retries target and provider owners independently through the same MCP connection", async () => {
  const directory = await createTestTempDirectory("rea-target-mcp-close-");
  const first = join(directory, "first.hop");
  const second = join(directory, "second.hop");
  await writeFile(first, "first database bytes");
  await writeFile(second, "second database bytes");
  const provider = createCacheProvider([]);
  const providerFailure = new ProviderCleanupError(
    "fixture",
    ["provider-owned-resource"],
    { reason: "controlled provider close denial" },
  );
  let providerAllowed = false;
  const execute = vi.fn(async (operation: AnalysisOperation) => {
    if (operation === "health") return observed(null);
    if (operation === "address_name") return observed("fixture-name");
    throw new Error("Unexpected fixture operation");
  });
  provider.createClient = vi.fn(() => ({
    execute,
    close: async () => {
      if (!providerAllowed) return err(providerFailure);
      providerFailure.resolveCleanup();
      return ok(null);
    },
  }));
  const session = createTestBinarySession(provider);
  const opened = await session.open(first);
  if (!opened.ok) throw opened.error;
  const harness = await createApplicationMcpHarness({ session });
  const closeErrors: AnalysisError[] = [];
  const sessionClose = session.close.bind(session);
  vi.spyOn(session, "close").mockImplementation(async (...args) => {
    const result = await sessionClose(...args);
    if (!result.ok) closeErrors.push(result.error);
    return result;
  });
  const nativeClose = OwnedFileHandle.prototype.close;
  let fileAllowed = false;
  const owners: OwnedFileHandle[] = [];
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      owners.push(this);
      if (!fileAllowed) throw new Error("controlled target close denial");
      await nativeClose.call(this);
    });
  try {
    // Opening a composed session checks only already-instantiated children.
    // Invoke the selected operation to acquire the provider owner before the
    // next target admission creates its independently retained descriptor.
    const acquired = await harness.client.callTool({
      name: "address_name",
      arguments: { address: "0x1000", document: "fixture" },
    });
    expect(acquired.isError).not.toBe(true);
    expect(provider.createClient).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toBe("address_name");
    const refused = await harness.client.callTool({
      name: "open_binary",
      arguments: { path: second },
    });
    expect(parseMcpToolError(refused).error).toMatchObject({
      code: "cleanup_incomplete",
      details: { diagnostics: { completed_target: { path: second } } },
    });
    expect(provider.createClient).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toBe("address_name");
    expect(await session.status()).toMatchObject({ cleanup_pending: true });
    await harness.client.ping();
    const firstClose = await harness.client.callTool({
      name: "close_binary",
      arguments: {},
    });
    expect(parseMcpToolError(firstClose).error.code).toBe("cleanup_incomplete");
    const aggregate = closeErrors[0];
    if (aggregate === undefined)
      throw new Error("Expected mixed cleanup aggregate");
    expect(aggregate.cleanupResources).toEqual(
      expect.arrayContaining([second, "provider-owned-resource"]),
    );
    fileAllowed = true;
    const secondClose = await harness.client.callTool({
      name: "close_binary",
      arguments: {},
    });
    expect(parseMcpToolError(secondClose).error.code).toBe(
      "cleanup_incomplete",
    );
    expect(aggregate.cleanupIncomplete).toBe(true);
    expect(aggregate.cleanupResources).toEqual(["provider-owned-resource"]);
    const completedFileCalls = owners.length;
    providerAllowed = true;
    const released = await harness.client.callTool({
      name: "close_binary",
      arguments: {},
    });
    expect(released.isError).not.toBe(true);
    expect(owners).toHaveLength(completedFileCalls);
    expect(owners.every((owner) => owner === owners[0])).toBe(true);
    expect(owners[0]?.handle.fd).toBe(-1);
    expect(aggregate.cleanupIncomplete).toBe(false);
    expect(await session.status()).toMatchObject({ cleanup_pending: false });
  } finally {
    fileAllowed = true;
    providerAllowed = true;
    close.mockRestore();
    await harness.close();
    vi.restoreAllMocks();
  }
});

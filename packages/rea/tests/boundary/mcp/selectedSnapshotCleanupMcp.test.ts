import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseAnalysisSnapshot } from "../../../src/domain/analysisSnapshot.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { createCacheProvider } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  createSessionMcpHarness,
  type SessionMcpHarness,
} from "./sessionMcpHarness.js";

const query = {
  name: "address_name",
  arguments: { address: "0x1000", document: "fixture" },
};

const saveSelectedSnapshot = async (
  mcp: SessionMcpHarness["mcp"],
  path: string,
  snapshotPath: string,
) => {
  const opened = await mcp.callTool({
    name: "open_binary",
    arguments: { path },
  });
  expect(opened.isError, JSON.stringify(opened.content)).not.toBe(true);
  const original = await mcp.callTool(query);
  expect(original.isError, JSON.stringify(original.content)).not.toBe(true);
  const evidence = parseEvidence(original.structuredContent);
  const saved = await mcp.callTool({
    name: "close_binary",
    arguments: { snapshot_path: snapshotPath },
  });
  expect(saved.isError, JSON.stringify(saved.content)).not.toBe(true);
  return evidence;
};

it("retains a selected snapshot descriptor through MCP cleanup discovery and same-connection recovery", async () => {
  const root = await createTestTempDirectory("rea-mcp-snapshot-read-cleanup-");
  const resources: Array<{ close(): Promise<unknown> }> = [];
  const calls: string[] = [];
  let starts = 0;
  const { mcp, first, second } = await createSessionMcpHarness(
    root,
    () => {
      const provider = createCacheProvider(calls);
      return {
        ...provider,
        createClient: (...args) => {
          starts += 1;
          return provider.createClient(...args);
        },
      };
    },
    resources,
  );
  const snapshotPath = join(root, "selected-snapshot.json");
  let retained: OwnedFileHandle | undefined;
  let restoreClose = () => {};
  try {
    const originalEvidence = await saveSelectedSnapshot(
      mcp,
      first,
      snapshotPath,
    );
    const snapshotBytes = await readFile(snapshotPath);
    const snapshot = parseAnalysisSnapshot(
      JSON.parse(snapshotBytes.toString("utf8")),
    );
    expect(snapshot.entries).toHaveLength(1);
    const targetBytes = await readFile(first);
    const selectedIdentity = await stat(snapshotPath);
    const priorCalls = [...calls];
    const priorStarts = starts;
    const nativeClose = OwnedFileHandle.prototype.close;
    const closeFailure = new Error("Selected snapshot close refused");
    let denied = true;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        if (this.handle.fd >= 0) {
          const identity = await this.handle.stat();
          if (
            identity.dev === selectedIdentity.dev &&
            identity.ino === selectedIdentity.ino &&
            denied
          ) {
            retained ??= this;
            expect(this).toBe(retained);
            throw closeFailure;
          }
        }
        return nativeClose.call(this);
      });
    restoreClose = () => close.mockRestore();
    const failed = parseMcpToolError(
      await mcp.callTool({
        name: "open_binary",
        arguments: { path: first, snapshot_path: snapshotPath },
      }),
    );
    expect(failed.error).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        resources: [snapshotPath],
        cleanup_reason: expect.stringContaining(closeFailure.message),
      },
    });
    if (retained === undefined)
      throw new Error("Selected snapshot owner was not retained");
    const descriptor = retained.handle.fd;
    expect(descriptor).toBeGreaterThanOrEqual(0);
    expect(await retained.handle.stat()).toMatchObject({
      dev: selectedIdentity.dev,
      ino: selectedIdentity.ino,
    });
    const pending = toolContract("binary_session").outputSchema.parse(
      (await mcp.callTool({ name: "binary_session", arguments: {} }))
        .structuredContent,
    );
    expect(pending.result).toMatchObject({
      open: false,
      cleanup_pending: true,
    });
    const blocked = parseMcpToolError(
      await mcp.callTool({ name: "open_binary", arguments: { path: second } }),
    );
    expect(blocked.error.code).toBe("cleanup_incomplete");
    expect(starts).toBe(priorStarts);
    expect(calls).toEqual(priorCalls);
    const stillBlocked = parseMcpToolError(
      await mcp.callTool({ name: "close_binary", arguments: {} }),
    );
    expect(stillBlocked.error).toMatchObject({
      code: "cleanup_incomplete",
      details: { resources: [snapshotPath] },
    });
    expect(retained.handle.fd).toBe(descriptor);
    denied = false;
    const recovered = await mcp.callTool({
      name: "close_binary",
      arguments: {},
    });
    expect(recovered.isError, JSON.stringify(recovered.content)).not.toBe(true);
    expect(retained.handle.fd).toBe(-1);
    const cleared = toolContract("binary_session").outputSchema.parse(
      (await mcp.callTool({ name: "binary_session", arguments: {} }))
        .structuredContent,
    );
    expect(cleared.result).toMatchObject({
      open: false,
      cleanup_pending: false,
    });
    const replayed = await mcp.callTool({
      name: "open_binary",
      arguments: { path: first, snapshot_path: snapshotPath },
    });
    expect(replayed.isError, JSON.stringify(replayed.content)).not.toBe(true);
    const replayEvidence = parseEvidence(
      (await mcp.callTool(query)).structuredContent,
    );
    expect(replayEvidence).toEqual({
      ...originalEvidence,
      evidence_id: expect.any(String),
      limitations: [
        ...originalEvidence.limitations,
        "Loaded from a local REA analysis snapshot; this call did not re-run the provider.",
      ],
    });
    expect(replayEvidence.evidence_id).not.toBe(originalEvidence.evidence_id);
    expect(starts).toBe(priorStarts);
    expect(calls).toEqual(priorCalls);
    expect(Buffer.compare(await readFile(snapshotPath), snapshotBytes)).toBe(0);
    expect(Buffer.compare(await readFile(first), targetBytes)).toBe(0);
  } finally {
    restoreClose();
    try {
      await mcp.callTool({ name: "close_binary", arguments: {} });
    } finally {
      try {
        await Promise.all(resources.map((resource) => resource.close()));
      } finally {
        await retained?.close();
      }
    }
  }
});

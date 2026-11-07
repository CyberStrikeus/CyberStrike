import { Client } from "@modelcontextprotocol/client";
import { expect, it, vi } from "vitest";

import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { err, ok } from "../../../src/domain/result.js";
import { connectGhidraMcp } from "./ghidraMcpHarness.js";

const failureLeaves = (reason: unknown): unknown[] =>
  reason instanceof AggregateError
    ? reason.errors.flatMap(failureLeaves)
    : [reason];

it("reports independent cleanup failures and retries only retained owners", async () => {
  const sdkFailure = new Error("controlled client close failure");
  const providerFailure = new ProviderCleanupError("ghidra", ["fixture"], {
    reason: "controlled provider close failure",
  });
  let allowProviderClose = false;
  const closeProvider = vi.fn(async () => {
    if (!allowProviderClose) return err(providerFailure);
    providerFailure.resolveCleanup();
    return ok(null);
  });
  const harness = await connectGhidraMcp("ghidra-harness-close", undefined, {
    close: closeProvider,
  });
  expect(
    (
      await harness.mcp.callTool({
        name: "address_name",
        arguments: { address: "0x401000", document: "fixture" },
      })
    ).isError,
  ).not.toBe(true);
  const closeClient = vi
    .spyOn(harness.mcp, "close")
    .mockRejectedValueOnce(sdkFailure);
  try {
    const first = harness.close();
    expect(harness.close()).toBe(first);
    const failure: unknown = await first.catch((cause: unknown) => cause);
    expect(failureLeaves(failure)).toEqual(
      expect.arrayContaining([
        sdkFailure,
        expect.objectContaining({ cause: providerFailure }),
      ]),
    );
    expect(failureLeaves(failure)).toHaveLength(2);
    expect(await harness.session.status()).toMatchObject({
      cleanup_pending: true,
    });

    const second: unknown = await harness
      .close()
      .catch((cause: unknown) => cause);
    expect(failureLeaves(second)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cause: providerFailure }),
      ]),
    );
    expect(closeClient).toHaveBeenCalledTimes(2);
    expect(closeProvider).toHaveBeenCalledTimes(2);

    allowProviderClose = true;
    await harness.close();
    expect(closeClient).toHaveBeenCalledTimes(2);
    expect(closeProvider).toHaveBeenCalledTimes(3);
    expect(providerFailure.cleanupIncomplete).toBe(false);
    expect(await harness.session.status()).toMatchObject({
      cleanup_pending: false,
    });
    await harness.close();
    expect(closeProvider).toHaveBeenCalledTimes(3);
  } finally {
    allowProviderClose = true;
    await harness.close();
    closeClient.mockRestore();
  }
});

it("preserves startup and cleanup failures while retrying the retained endpoint", async () => {
  const startup = new Error("controlled handshake failure");
  const cleanup = new Error("controlled client close failure");
  const connect = vi
    .spyOn(Client.prototype, "connect")
    .mockRejectedValueOnce(startup);
  const close = vi
    .spyOn(Client.prototype, "close")
    .mockRejectedValueOnce(cleanup);
  try {
    const failure: unknown = await connectGhidraMcp(
      "ghidra-harness-startup",
    ).catch((cause: unknown) => cause);
    expect(failureLeaves(failure)).toEqual(
      expect.arrayContaining([startup, cleanup]),
    );
    expect(failureLeaves(failure)).toHaveLength(2);
    expect(close).toHaveBeenCalledTimes(2);
  } finally {
    connect.mockRestore();
    close.mockRestore();
  }
});

it("preserves an open failure when endpoint cleanup also fails", async () => {
  const startup = new Error("controlled open failure");
  const cleanup = new Error("controlled client close failure");
  const callTool = vi
    .spyOn(Client.prototype, "callTool")
    .mockRejectedValueOnce(startup);
  const close = vi
    .spyOn(Client.prototype, "close")
    .mockRejectedValueOnce(cleanup);
  try {
    const failure: unknown = await connectGhidraMcp(
      "ghidra-harness-open",
    ).catch((cause: unknown) => cause);
    expect(failureLeaves(failure)).toEqual(
      expect.arrayContaining([startup, cleanup]),
    );
    expect(failureLeaves(failure)).toHaveLength(2);
  } finally {
    callTool.mockRestore();
    close.mockRestore();
  }
});

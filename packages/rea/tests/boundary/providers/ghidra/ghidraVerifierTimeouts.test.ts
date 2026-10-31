import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGhidraVerifierMcpOperations,
  resolveGhidraVerifierTimeouts,
} from "../../../../scripts/lib/ghidra-verifier-timeouts.mjs";
import { verifyGhidraFileOffsets } from "../../../../scripts/lib/real-ghidra-file-offsets.mjs";

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const FILE_OFFSET_OPERATION_TIMEOUT_MS = 240_000;

afterEach(() => vi.unstubAllEnvs());

describe("Ghidra verifier timeout ownership", () => {
  it("preserves the selected startup budget for the direct client and public requests", () => {
    expect(
      resolveGhidraVerifierTimeouts({
        REA_GHIDRA_STARTUP_TIMEOUT_MS: "600000",
      }),
    ).toEqual({
      clientOptions: { startupTimeoutMs: 600_000 },
      requestOptions: { timeout: 840_000 },
    });
  });

  it("accepts the exact combined Node timer limit", () => {
    const startupTimeoutMs =
      MAX_TIMER_DELAY_MS - FILE_OFFSET_OPERATION_TIMEOUT_MS;
    expect(
      resolveGhidraVerifierTimeouts({
        REA_GHIDRA_STARTUP_TIMEOUT_MS: String(startupTimeoutMs),
      }),
    ).toEqual({
      clientOptions: { startupTimeoutMs },
      requestOptions: { timeout: MAX_TIMER_DELAY_MS },
    });
  });

  it("uses the public request budget for initialization and every tool call", async () => {
    const transport = { name: "transport" };
    const request = { name: "procedure_pseudo_code" };
    const response = { content: [] };
    const connect = vi.fn(async () => undefined);
    const callTool = vi.fn(async () => response);
    const requestOptions = { timeout: 840_000 };
    const operations = createGhidraVerifierMcpOperations(
      { connect, callTool },
      requestOptions,
    );

    await operations.connect(transport);
    await expect(operations.callTool(request)).resolves.toBe(response);

    expect(connect).toHaveBeenCalledWith(transport, requestOptions);
    expect(callTool).toHaveBeenCalledWith(request, requestOptions);
  });

  it("rejects a combined timer overflow before reading the target", async () => {
    vi.stubEnv(
      "REA_GHIDRA_STARTUP_TIMEOUT_MS",
      String(MAX_TIMER_DELAY_MS - FILE_OFFSET_OPERATION_TIMEOUT_MS + 1),
    );
    const absentTarget = join(tmpdir(), `rea-absent-${randomUUID()}`);
    await expect(
      verifyGhidraFileOffsets(absentTarget, "absent", "0x0"),
    ).rejects.toThrow(
      "The Ghidra startup and verification operation budgets exceed the Node.js timer limit.",
    );
  });
});

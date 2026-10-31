import type { Socket } from "node:net";

import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import type { BridgeMaxRequestBytes } from "../config/bridgeMaxRequestBytes.js";
import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { ok, type Result } from "../domain/result.js";
import { PendingOperations } from "../process/PendingOperations.js";
import { GhidraWire } from "./GhidraClientWire.js";
import {
  bindGhidraSessionFailure,
  type GhidraSessionError,
} from "./GhidraSessionError.js";

const failure = bindGhidraSessionFailure(() => ({
  target_path: "/tmp/wire-fixture",
}));

const limit = (maximumBytes: number): BridgeMaxRequestBytes => ({
  maximumBytes,
  source: "setting",
});

type WireHarness = {
  readonly writes: string[];
  readonly pending: PendingOperations<
    number,
    Result<JsonValue, GhidraSessionError>
  >;
  readonly wire: GhidraWire;
};

const harness = (ceiling: BridgeMaxRequestBytes): WireHarness => {
  const writes: string[] = [];
  const socket = {
    destroyed: false,
    write: (payload: string, callback?: (cause?: Error | null) => void) => {
      writes.push(payload);
      callback?.(null);
      return true;
    },
  } as unknown as Socket;
  const pending = new PendingOperations<
    number,
    Result<JsonValue, GhidraSessionError>
  >();
  return {
    writes,
    pending,
    wire: new GhidraWire({
      getSocket: () => socket,
      getToken: () => "b".repeat(64),
      nextId: () => 1,
      pending,
      logger: pino({ level: "silent" }),
      failure,
      bridgeMaxRequestBytes: ceiling,
    }),
  };
};

describe("GhidraWire request ceiling", () => {
  it("refuses escaped oversized input before encoding, pending registration or write", async () => {
    const { writes, pending, wire } = harness(limit(8192));
    const params = { pattern: "\u0000".repeat(1500) };
    const payloadBytes = Buffer.byteLength(
      JSON.stringify({
        id: 1,
        token: "b".repeat(64),
        method: "search_strings",
        params,
      }),
    );
    expect(Buffer.byteLength(params.pattern)).toBeLessThan(8192);
    expect(payloadBytes).toBeGreaterThan(8192);
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      const refused = await wire.request("search_strings", params, {});
      if (refused.ok) throw new Error("Expected a request ceiling refusal");
      expect(refused.error.message).toContain("REA_BRIDGE_MAX_REQUEST_BYTES");
      expect(refused.error.message).toContain("8192");
      expect(refused.error.message).toContain("Ghidra request exceeds");
      const constraint = refused.error.cause;
      if (!(constraint instanceof AnalysisResourceConstraintError))
        throw new Error("Expected the typed transport constraint");
      expect(constraint.reportedLimits).toMatchObject({
        max_request_bytes: 8192,
        payload_bytes: payloadBytes,
      });
      expect(constraint.retryable).toBe(false);
      expect(writes.length).toBe(0);
      expect(pending.has(1)).toBe(false);
      const encodings = stringify.mock.calls.filter(
        ([value]: readonly unknown[]) =>
          typeof value === "object" &&
          value !== null &&
          "params" in value &&
          value.params === params,
      ).length;
      expect(encodings).toBe(0);
    } finally {
      stringify.mockRestore();
    }
  });

  it.each([true, false])(
    "enforces the exact UTF-8 JSON payload boundary (admitted: %s)",
    async (admitted) => {
      const params = { pattern: '前缀"\\\u0000😀\ud800'.repeat(1024) };
      const encoded = JSON.stringify({
        id: 1,
        token: "b".repeat(64),
        method: "search_strings",
        params,
      });
      const payloadBytes = Buffer.byteLength(encoded);
      const { writes, pending, wire } = harness(
        limit(payloadBytes - (admitted ? 0 : 1)),
      );
      const dispatched = wire.request("search_strings", params, {});
      pending.settle(1, ok("ok"));
      const result = await dispatched;
      if (admitted) {
        if (!result.ok) throw result.error;
        expect(result.value).toBe("ok");
        expect(writes.length).toBe(1);
        expect(Buffer.byteLength(writes[0] ?? "")).toBe(payloadBytes + 1);
        expect(writes[0] === encoded + "\n").toBe(true);
      } else {
        if (result.ok) throw new Error("Expected a request ceiling refusal");
        expect(result.error.cause).toBeInstanceOf(
          AnalysisResourceConstraintError,
        );
        expect(writes.length).toBe(0);
      }
      expect(pending.has(1)).toBe(false);
    },
  );
});

it.each([null, 7])(
  "sends the accepted decompile budget %s in the request envelope",
  async (budget) => {
    const { wire, writes, pending } = harness(limit(8192));
    const result = wire.request(
      "procedure_pseudo_code",
      { procedure: "0x1000" },
      { decompileTimeoutSeconds: budget },
    );
    expect(JSON.parse(writes[0]!)).toMatchObject({
      decompile_timeout_seconds: budget,
    });
    pending.settle(1, ok("pseudocode"));
    expect(await result).toEqual(ok("pseudocode"));
  },
);

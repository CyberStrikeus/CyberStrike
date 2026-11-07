import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, it } from "vitest";
import { z } from "zod";

const execute = promisify(execFile);

const bridgePath = new URL(
  "../../../../bridge/hopper_bridge.py",
  import.meta.url,
);
const probePath = new URL(
  "../../../fixtures/hopperBridgeFrameLimitProbe.py",
  import.meta.url,
);

/** Mirrors the Cutter bridge's frame ceiling so both bridges bound identically. */
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;

const exchangeSchema = z.strictObject({
  reply: z.unknown(),
  next: z.unknown().optional(),
  thread_released: z.boolean(),
  dispatch_calls: z.number().int().nonnegative(),
});

const probeResultSchema = z.strictObject({
  limit: z.number().int().positive(),
  source: z.enum(["default", "setting"]),
  minimum: z.literal(7464),
  maximum: z.literal(536870887),
  legit: exchangeSchema,
  at_limit: exchangeSchema,
  past_limit: exchangeSchema,
  stalled_line: exchangeSchema,
  eof_partial: exchangeSchema,
});

it("serves requests up to the frame limit and refuses a line that exceeds it", async () => {
  const { stdout } = await execute("python3", [
    fileURLToPath(probePath),
    fileURLToPath(bridgePath),
  ]);
  const result = probeResultSchema.parse(JSON.parse(stdout));
  expect(result.limit).toBe(MAX_REQUEST_BYTES);
  expect(result.source).toBe("default");

  // Legitimate traffic is unaffected, including a request that fills the limit.
  for (const exchange of [result.legit, result.at_limit])
    expect(exchange.reply).toMatchObject({
      result: { run_id: "owned-run", ready: true },
    });

  // A peer that keeps a line open past the limit is answered without reading
  // the line to completion. The refusal can be consumed by the peer's own
  // reset, so this asserts boundedness rather than the diagnostic's arrival.
  expect(result.past_limit.reply).not.toEqual({
    socket_error: "TimeoutError",
  });
  expect(result.past_limit.thread_released).toBe(true);

  // An unterminated payload one byte over the limit is refused with a typed
  // diagnostic naming the limit and the connection is closed, instead of
  // resynchronizing mid-line. The peer stays connected, so this pins the
  // payload ceiling without charging the LF against it.
  expect(result.stalled_line.reply).toMatchObject({
    error: {
      code: -32000,
      type: "invalid_request",
      message: expect.stringContaining(String(MAX_REQUEST_BYTES)),
    },
  });
  expect(result.stalled_line.reply).toMatchObject({
    error: {
      message: expect.stringContaining("REA_BRIDGE_MAX_REQUEST_BYTES"),
    },
  });
  expect(result.stalled_line.next).toEqual({ closed: true });
  expect(result.stalled_line.thread_released).toBe(true);

  // A valid authenticated payload without LF is still an incomplete frame.
  // Half-closing the write side supplies EOF; the bridge rejects without
  // dispatching the operation, then closes its response connection.
  expect(result.eof_partial.reply).toMatchObject({
    error: {
      code: -32000,
      type: "invalid_request",
      message: "Incomplete bridge request frame",
    },
  });
  expect(result.eof_partial.next).toEqual({ closed: true });
  expect(result.eof_partial.dispatch_calls).toBe(0);
  expect(result.eof_partial.thread_released).toBe(true);
});

const runProbe = async (...arguments_: readonly string[]): Promise<unknown> => {
  const { stdout } = await execute("python3", [
    fileURLToPath(probePath),
    fileURLToPath(bridgePath),
    ...arguments_,
  ]);
  return JSON.parse(stdout) as unknown;
};

it.each([8192, 17 * 1024 * 1024])(
  "serves a caller-selected ceiling of %d bytes",
  async (limit) => {
    const result = probeResultSchema.parse(
      await runProbe("bytes", String(limit)),
    );
    expect(result.limit).toBe(limit);
    expect(result.source).toBe("setting");
    expect(result.at_limit.reply).toMatchObject({
      result: { run_id: "owned-run", ready: true },
    });
    expect(result.stalled_line.reply).toMatchObject({
      error: {
        type: "invalid_request",
        message: expect.stringContaining("REA_BRIDGE_MAX_REQUEST_BYTES"),
      },
    });
    expect(result.eof_partial.reply).toMatchObject({
      error: { message: "Incomplete bridge request frame" },
    });
  },
);

it("prefers the injected bootstrap ceiling over the process environment", async () => {
  const result = probeResultSchema.parse(await runProbe("inject", "8192"));
  expect(result).toMatchObject({ limit: 8192, source: "setting" });
});

it.each(["7463", "536870888", "0", "-1", "abc", "016777216", "٨١٩٢"])(
  "refuses invalid bridge ceiling %j without falling back",
  async (value) => {
    const result = z
      .object({ error: z.string() })
      .parse(await runProbe("invalid", value));
    expect(result.error).toContain("REA_BRIDGE_MAX_REQUEST_BYTES");
    expect(result.error).not.toContain("was accepted");
  },
);

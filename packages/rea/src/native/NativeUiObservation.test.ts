import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";

import { describe, expect, it } from "vitest";
import { observeNativeUi } from "./NativeUiObservation.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  AnalysisCancelledError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";
import { ExecFileOutputCancelledError } from "../process/ExecFileOutput.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";

const target: BinaryTarget = {
  path: "/fixture/App",
  sha256: "a".repeat(64),
  kind: "executable",
  format: "mach-o",
  architecture: "arm64",
  availableArchitectures: ["arm64"],
};
const scope = {
  pid: 123,
  window_id: 456,
  screenshot: false,
};
const snapshot = {
  window: {
    pid: 123,
    window_id: 456,
    executable: target.path,
    launch_time: 1,
    title: "Fixture",
  },
  nodes: [],
  screenshot: null,
  gaps: [],
  truncated: false,
};

const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv4sAAAAASUVORK5CYII=",
  "base64",
);

/** Screenshot payload as the native helper reports one PNG buffer. */
const screenshotOf = (bytes: Buffer) => ({
  mime_type: "image/png",
  base64: bytes.toString("base64"),
  sha256: createHash("sha256").update(bytes).digest("hex"),
  width: bytes.readUInt32BE(16),
  height: bytes.readUInt32BE(20),
});

/** Observe the fixture snapshot carrying one screenshot payload. */
const observeWithScreenshot = (screenshot: Record<string, unknown>) =>
  observeNativeUi(
    target,
    "observe_native_ui",
    { ...scope, screenshot: true },
    {
      environment: {},
      invoke: async () => ({ ok: true, result: { ...snapshot, screenshot } }),
    },
  );

it.each([
  { offset: 8, value: 12 },
  { offset: 16, value: 0x8000_0000 },
  { offset: 20, value: 0x8000_0000 },
])(
  "rejects invalid IHDR metadata with a matching digest",
  async ({ offset, value }) => {
    const bytes = Buffer.from(validPng);
    bytes.writeUInt32BE(value, offset);
    bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
    const result = await observeWithScreenshot(screenshotOf(bytes));
    expect(result.ok).toBe(false);
  },
);
describe("native UI screenshot validation", () => {
  it.each([24, 32, "crc"])(
    "rejects incomplete or corrupt IHDR despite matching native digest: %s",
    async (kind) => {
      const bytes = Buffer.from(validPng);
      if (kind === "crc") bytes[29] = (bytes[29] ?? 0) ^ 1;
      const payload =
        typeof kind === "number" ? bytes.subarray(0, kind) : bytes;
      expect((await observeWithScreenshot(screenshotOf(payload))).ok).toBe(
        false,
      );
    },
  );
  it("rejects malformed or mismatched screenshot bytes from the helper", async () => {
    const result = await observeWithScreenshot({
      ...screenshotOf(validPng),
      sha256: "0".repeat(64),
    });
    expect(result.ok).toBe(false);
  });

  it.each([
    { base64: "%%%=" },
    { base64: Buffer.from("not a PNG").toString("base64") },
    { width: 2 },
  ])(
    "rejects invalid screenshot field variants from the helper",
    async (change) => {
      const result = await observeWithScreenshot({
        ...screenshotOf(validPng),
        ...change,
      });
      expect(result.ok).toBe(false);
    },
  );

  it("rejects a PNG whose IHDR type only matches after ASCII folding", async () => {
    const bytes = Buffer.from(validPng);
    const type = bytes.subarray(12, 16);
    type[0] = (type[0] ?? 0) | 0x80;
    expect(type.toString("ascii")).toBe("IHDR");
    const result = await observeWithScreenshot(screenshotOf(bytes));
    expect(result.ok).toBe(false);
  });

  it("accepts a self-consistent PNG screenshot from the helper", async () => {
    const result = await observeWithScreenshot(screenshotOf(validPng));
    expect(result.ok).toBe(true);
  });

  it("preserves an unknown AX child count and its truncation gap", async () => {
    const partial = {
      ...snapshot,
      nodes: [
        {
          path: [],
          role: "AXWindow",
          title: "Fixture",
          value: null,
          actions: [],
          children_count: null,
        },
      ],
      truncated: true,
      gaps: ["AX child count unavailable at path []: AXError -25204"],
    };
    const result = await observeNativeUi(
      target,
      "observe_native_ui",
      { ...scope, accessibility: true },
      { environment: {}, invoke: async () => ({ ok: true, result: partial }) },
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.initial).toMatchObject({
        truncated: true,
        gaps: ["AX child count unavailable at path []: AXError -25204"],
        nodes: [{ children_count: null }],
      });
  });
});

describe("native UI capture selection and budgets", () => {
  it("accepts observations and scenarios without compatibility flags", async () => {
    let calls = 0;
    const invoke = async () => {
      calls++;
      return { ok: true, result: snapshot };
    };
    const observed = await observeNativeUi(
      target,
      "observe_native_ui",
      { pid: 123, window_id: 456, screenshot: false, accessibility: true },
      { environment: {}, invoke },
    );
    expect(observed.ok).toBe(true);
    const captured = await observeNativeUi(
      target,
      "capture_native_ui_scenario",
      {
        pid: 123,
        window_id: 456,
        screenshot: false,
        accessibility: true,
        steps: [{ kind: "click", path: [] }],
      },
      { environment: {}, invoke },
    );
    expect(captured.ok).toBe(true);
    expect(calls).toBe(3);
  });
  it("returns caller-selected large observations and complete action lists", async () => {
    const nodeLimits: unknown[] = [];
    const steps = Array.from({ length: 17 }, () => ({
      kind: "wait" as const,
      milliseconds: 0,
    }));
    const result = await observeNativeUi(
      target,
      "capture_native_ui_scenario",
      {
        pid: 123,
        window_id: 456,
        screenshot: false,
        accessibility: true,
        max_nodes: 2_001,
        steps,
      },
      {
        environment: {},
        invoke: async (parameters) => {
          nodeLimits.push(parameters.max_nodes);
          return { ok: true, result: snapshot };
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(nodeLimits).toEqual(Array.from({ length: 18 }, () => 2_001));
    if (result.ok) {
      expect(result.value.steps).toHaveLength(17);
      expect(
        result.value.steps.every(({ outcome }) => outcome === "completed"),
      ).toBe(true);
    }
  });
  it("accepts caller-selected waits beyond the old aggregate cutoff", async () => {
    const controller = new AbortController();
    const result = await observeNativeUi(
      target,
      "capture_native_ui_scenario",
      {
        pid: 123,
        window_id: 456,
        screenshot: false,
        accessibility: true,
        steps: Array.from({ length: 4 }, () => ({
          kind: "wait" as const,
          milliseconds: 10_001,
        })),
      },
      {
        environment: {},
        signal: controller.signal,
        invoke: async () => {
          controller.abort();
          return { ok: true, result: snapshot };
        },
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected scenario cancellation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(result.error.cause).toBe(controller.signal.reason);
    expect(result.error.partialObservation).toMatchObject({
      initial: snapshot,
      steps: [{ kind: "wait", outcome: "cancelled" }],
    });
  });
  it("reports aggregate output exhaustion after individually valid captures", async () => {
    const largeSnapshot = {
      ...snapshot,
      window: { ...snapshot.window, title: "x".repeat(17 * 1024 * 1024) },
    };
    const result = await observeNativeUi(
      target,
      "capture_native_ui_scenario",
      {
        ...scope,
        steps: [{ kind: "wait", milliseconds: 0 }],
      },
      {
        environment: {},
        invoke: async () => ({ ok: true, result: largeSnapshot }),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected scenario output limit failure");
    expect(result.error._tag).toBe("AnalysisCapabilityUnavailableError");
    expect(result.error.partialObservation).toMatchObject({
      initial: largeSnapshot,
      steps: [
        {
          outcome: "failed",
          reason: expect.stringContaining("64 MiB output budget"),
        },
      ],
    });
  });
});

describe("native UI deadline execution", () => {
  it("states the selected deadline and the fixed wait-step cap", async () => {
    const result = await observeNativeUi(
      target,
      "capture_native_ui_scenario",
      {
        ...scope,
        native_ui_deadline_ms: 2_500,
        steps: [{ kind: "wait", milliseconds: 0 }],
      },
      {
        environment: {},
        runtime: {
          signal: new AbortController().signal,
          deadlineMs: 2_500,
          invoke: async () => ({ ok: true, result: snapshot }),
          cleanupLease: new AnalysisCleanupLease(async () => undefined),
          close: async () => undefined,
          resources: () => [],
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a completed scenario");
    const limitation = result.value.limitations.join("\n");
    expect(limitation).toContain("selected native_ui_deadline_ms of 2500 ms");
    expect(limitation).toContain("omitted means 180000");
    expect(limitation).toContain(
      "One wait step stays capped at 180000 ms and that cap has no runtime override.",
    );
    expect(limitation).not.toContain("180-second");
  });

  it("states the omitted 180000 ms deadline separately from the wait-step cap", async () => {
    const result = await observeNativeUi(target, "observe_native_ui", scope, {
      environment: {},
      invoke: async () => ({ ok: true, result: snapshot }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a completed observation");
    const limitation = result.value.limitations.join("\n");
    expect(limitation).toContain("selected native_ui_deadline_ms of 180000 ms");
    expect(limitation).toContain(
      "One wait step stays capped at 180000 ms and that cap has no runtime override.",
    );
    expect(limitation).not.toContain("180-second");
  });

  it("reports the owned deadline as a timeout during helper execution", async () => {
    const deadline = new AbortController();
    const reason = new DOMException("deadline elapsed", "TimeoutError");
    const result = await observeNativeUi(target, "observe_native_ui", scope, {
      environment: {},
      runtime: {
        signal: deadline.signal,
        invoke: async () => ({ ok: true, result: snapshot }),
        cleanupLease: new AnalysisCleanupLease(async () => undefined),
        close: async () => undefined,
        resources: () => [],
      },
      invoke: async () => {
        deadline.abort(reason);
        throw new ExecFileOutputCancelledError(reason);
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected deadline timeout");
    expect(result.error).toBeInstanceOf(AnalysisTimeoutError);
    expect(result.error.cause).toBe(reason);
  });

  it("preserves an independent producer cancellation when the deadline fires", async () => {
    const deadline = new AbortController();
    const producerReason = { phase: "producer" };
    const result = await observeNativeUi(target, "observe_native_ui", scope, {
      environment: {},
      runtime: {
        signal: deadline.signal,
        invoke: async () => ({ ok: true, result: snapshot }),
        cleanupLease: new AnalysisCleanupLease(async () => undefined),
        close: async () => undefined,
        resources: () => [],
      },
      invoke: async () => {
        deadline.abort({ phase: "late-deadline" });
        throw new ExecFileOutputCancelledError(producerReason);
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected producer cancellation");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(producerReason);
  });

  it("keeps deadline failure in a scenario report as failed, not cancelled", async () => {
    const deadline = new AbortController();
    const reason = { phase: "scenario-deadline" };
    let calls = 0;
    const result = await observeNativeUi(
      target,
      "capture_native_ui_scenario",
      { ...scope, steps: [{ kind: "click", path: [1] }] },
      {
        environment: {},
        runtime: {
          signal: deadline.signal,
          invoke: async () => ({ ok: true, result: snapshot }),
          cleanupLease: new AnalysisCleanupLease(async () => undefined),
          close: async () => undefined,
          resources: () => [],
        },
        invoke: async () => {
          if (++calls === 1) {
            deadline.abort(reason);
            return { ok: true, result: snapshot };
          }
          throw new Error("unexpected second capture");
        },
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected deadline timeout");
    expect(result.error).toBeInstanceOf(AnalysisTimeoutError);
    expect(result.error.cause).toBe(reason);
    expect(result.error.partialObservation).toMatchObject({
      steps: [{ outcome: "failed", after: null }],
    });
    expect(calls).toBe(1);
  });
});

it("classifies a helper subprocess timeout as the selected UI deadline", async () => {
  const result = await observeNativeUi(
    target,
    "observe_native_ui",
    { ...scope, native_ui_deadline_ms: 2_500 },
    {
      environment: {},
      runtime: {
        signal: new AbortController().signal,
        deadlineMs: 2_500,
        invoke: async () => ({ ok: true, result: snapshot }),
        cleanupLease: new AnalysisCleanupLease(async () => undefined),
        close: async () => undefined,
        resources: () => [],
      },
      invoke: async () => {
        throw Object.assign(new Error("helper subprocess timed out"), {
          code: "ETIMEDOUT",
        });
      },
    },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected helper deadline timeout");
  expect(result.error).toBeInstanceOf(AnalysisTimeoutError);
  const projected = projectAnalysisError(result.error);
  expect(projected.code).toBe("provider_timeout");
  expect(projected.message).toContain("of 2500 ms");
  expect(projected.message).toContain("native_ui_deadline_ms");
  expect(projected.remediation.action).toContain("above 2500");
  expect(projected.message).not.toContain("of 30000 ms");
  expect(projected.message).not.toContain("of 60000 ms");
});

describe("native UI interruption provenance", () => {
  it("reports an owned deadline during a scenario wait as a failed step", async () => {
    const deadline = new AbortController();
    const reason = { phase: "wait-deadline" };
    const timer = setTimeout(() => deadline.abort(reason), 0);
    const result = await observeNativeUi(
      target,
      "capture_native_ui_scenario",
      { ...scope, steps: [{ kind: "wait", milliseconds: 100 }] },
      {
        environment: {},
        runtime: {
          signal: deadline.signal,
          invoke: async () => ({ ok: true, result: snapshot }),
          cleanupLease: new AnalysisCleanupLease(async () => undefined),
          close: async () => undefined,
          resources: () => [],
        },
        invoke: async () => ({ ok: true, result: snapshot }),
      },
    );
    clearTimeout(timer);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected deadline timeout");
    expect(result.error).toBeInstanceOf(AnalysisTimeoutError);
    expect(result.error.cause).toBe(reason);
    expect(result.error.partialObservation).toMatchObject({
      steps: [{ outcome: "failed", reason: expect.any(String) }],
    });
  });

  it("treats a caller TimeoutError-shaped reason as caller cancellation", async () => {
    const caller = new AbortController();
    const reason = new DOMException("caller stopped", "TimeoutError");
    caller.abort(reason);
    const result = await observeNativeUi(target, "observe_native_ui", scope, {
      environment: {},
      signal: caller.signal,
      invoke: async () => ({ ok: true, result: snapshot }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected caller cancellation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(result.error.cause).toBe(reason);
  });

  it("preserves a physical helper failure even if the owned deadline fires", async () => {
    const deadline = new AbortController();
    const failure = new Error("physical helper failure");
    const result = await observeNativeUi(target, "observe_native_ui", scope, {
      environment: {},
      runtime: {
        signal: deadline.signal,
        invoke: async () => ({ ok: true, result: snapshot }),
        cleanupLease: new AnalysisCleanupLease(async () => undefined),
        close: async () => undefined,
        resources: () => [],
      },
      invoke: async () => {
        deadline.abort({ phase: "late-deadline" });
        throw failure;
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected helper failure");
    expect(result.error._tag).toBe("ProviderAdapterError");
    expect(result.error.cause).toBe(failure);
  });

  it("preserves schema failure even if the owned deadline fires", async () => {
    const deadline = new AbortController();
    const result = await observeNativeUi(target, "observe_native_ui", scope, {
      environment: {},
      runtime: {
        signal: deadline.signal,
        invoke: async () => ({ ok: true, result: snapshot }),
        cleanupLease: new AnalysisCleanupLease(async () => undefined),
        close: async () => undefined,
        resources: () => [],
      },
      invoke: async () => {
        deadline.abort({ phase: "late-deadline" });
        return { ok: true, result: { malformed: true } };
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected schema failure");
    expect(result.error._tag).toBe("ProviderAdapterError");
    expect(result.error.cause).toMatchObject({ name: "ZodError" });
  });
});

describe("native UI target and cancellation failures", () => {
  it.each([
    "accessibility-denied",
    "screen-recording-denied",
    "ambiguous-window",
  ])("preserves actionable %s without fallback", async (code) => {
    const result = await observeNativeUi(target, "observe_native_ui", scope, {
      environment: {},
      invoke: async () => ({
        ok: false,
        code,
        message: "Grant permission or select an unambiguous window",
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const projected = projectAnalysisError(result.error);
      expect(projected.message).toBe(
        "Grant permission or select an unambiguous window",
      );
      if (code === "ambiguous-window")
        expect(projected).toMatchObject({
          code: "invalid_request",
          details: {
            issues: [
              { path: ["window_id"], message: expect.stringContaining(code) },
            ],
          },
        });
      else expect(projected.details?.reason).toContain(code);
    }
  });
  it("preserves the underlying helper failure reason in diagnostics", async () => {
    const result = await observeNativeUi(target, "observe_native_ui", scope, {
      environment: {},
      invoke: async () => {
        throw new Error(
          "Native helper returned invalid JSON: Unexpected token",
        );
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      diagnostics: {
        reason: "Native helper returned invalid JSON: Unexpected token",
        remediation:
          "Native helper failed, timed out, or returned malformed capture data; install compatible Xcode command-line tools and inspect local OS permissions",
      },
    });
  });
  it("stops on a failed action and returns ordered before/capture-gap evidence", async () => {
    const calls: Readonly<Record<string, unknown>>[] = [];
    const result = await observeNativeUi(
      target,
      "capture_native_ui_scenario",
      {
        ...scope,
        steps: [
          { kind: "scroll", path: [1], direction: "increment" },
          { kind: "click", path: [2] },
        ],
      },
      {
        environment: {},
        invoke: async (parameters) => {
          calls.push(parameters);
          return calls.length === 1
            ? { ok: true, result: snapshot }
            : {
                ok: false,
                code: "action-failed",
                message: "AXIncrement unsupported",
              };
        },
      },
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      launch_time: 1,
      action: { kind: "scroll", path: [1] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failed action");
    expect(result.error._tag).toBe("AnalysisCapabilityUnavailableError");
    expect(result.error.partialObservation).toMatchObject({
      initial: snapshot,
      steps: [{ index: 0, outcome: "failed", before: snapshot, after: null }],
    });
  });
  it("rejects target replacement and stops subsequent actions after cancellation", async () => {
    const controller = new AbortController();
    let calls = 0;
    const result = await observeNativeUi(
      target,
      "capture_native_ui_scenario",
      {
        ...scope,
        steps: [
          { kind: "wait", milliseconds: 1000 },
          { kind: "click", path: [] },
        ],
      },
      {
        environment: {},
        signal: controller.signal,
        invoke: async () => {
          calls++;
          controller.abort();
          return { ok: true, result: snapshot };
        },
      },
    );
    expect(calls).toBe(1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected scenario cancellation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(result.error.cause).toBe(controller.signal.reason);
    expect(result.error.partialObservation).toMatchObject({
      initial: snapshot,
      steps: [{ outcome: "cancelled" }],
    });
    const replaced = await observeNativeUi(target, "observe_native_ui", scope, {
      environment: {},
      invoke: async () => ({
        ok: true,
        result: { ...snapshot, window: { ...snapshot.window, pid: 999 } },
      }),
    });
    expect(replaced.ok).toBe(false);
  });
});

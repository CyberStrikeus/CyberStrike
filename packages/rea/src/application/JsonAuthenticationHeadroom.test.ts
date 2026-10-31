import { describe, expect, it } from "vitest";
import { requireAuthenticationHeadroom } from "./JsonAuthenticationHeadroom.js";
import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
describe("JSON authentication headroom", () => {
  it("does not queue every row while deciding whether a wide report can fit", () => {
    let pending = 0;
    let peak = 0;
    const rows: { admission_probe: boolean }[] = [];
    for (let index = 0; index < 512; index++) {
      const row = {
        get admission_probe() {
          pending--;
          return true;
        },
      };
      // Observe reading a row separately from examining its scalar. A width
      // queue reads every row first; an iterator finishes each row before advancing.
      Object.defineProperty(rows, index, {
        enumerable: true,
        get: () => {
          peak = Math.max(peak, ++pending);
          if (pending > 32)
            throw new Error(
              "Admission queued report rows before refusing their allocation",
            );
          return row;
        },
      });
    }
    const value = { rows };
    const result = requireAuthenticationHeadroom(value, {
      operation: "inspect_managed_members",
      path: "/tmp/parent.json",
      description: "Cannot authenticate",
      availableBytes: 0,
    });
    expect(pending).toBe(0);
    expect(peak).toBe(1);
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisResourceConstraintError",
        reportedLimits: {
          serialized_json_utf16_bytes: JSON.stringify(value).length * 2,
        },
      },
    });
  });
  it("reports parsed storage in authentication refusals", () => {
    const text = "x".repeat(1000);
    const projectedBytes: number[] = [];
    for (const value of [text, { outer: [text, { inner: text }] }]) {
      const result = requireAuthenticationHeadroom(value, {
        operation: "inspect_analysis_view",
        path: "/tmp/bundle.json",
        description: "Cannot authenticate bundle",
        availableBytes: 0,
      });
      if (result.ok) throw new Error("Expected authentication refusal");
      expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
      const bytes = result.error.reportedLimits?.projected_value_bytes;
      if (typeof bytes !== "number")
        throw new Error("Expected parsed storage bytes in refusal diagnostics");
      projectedBytes.push(bytes);
    }
    const [scalar, nested] = projectedBytes;
    if (scalar === undefined || nested === undefined)
      throw new Error("Expected scalar and nested refusal diagnostics");
    expect(scalar).toBeGreaterThanOrEqual(2000);
    expect(nested).toBeGreaterThan(2 * scalar);
  });

  it("refuses authentication when live heap headroom cannot hold its copies", () => {
    const value = { normalized_result: "y".repeat(10_000) };
    expect(
      requireAuthenticationHeadroom(value, {
        operation: "compare_source_to_bundle",
        path: "/tmp/capture.json",
        description: "Cannot authenticate graph",
        availableBytes: 1024,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisResourceConstraintError",
        resource: "memory",
        reportedLimits: {
          input_path: "/tmp/capture.json",
          available_heap_bytes: 1024,
        },
      },
    });
    expect(
      requireAuthenticationHeadroom(value, {
        operation: "compare_source_to_bundle",
        path: "/tmp/capture.json",
        description: "Cannot authenticate graph",
        availableBytes: 1 << 30,
      }),
    ).toEqual({ ok: true, value: undefined });
  });
});

it.each([
  ["control characters", { text: "\u0000\u0001\b\t\n\f\r".repeat(2000) }],
  [
    "escaped keys",
    { ['\u0000\\"'.repeat(2000)]: [true, false, null, -0, 1e30] },
  ],
  ["surrogate boundaries", { text: "😀\ud800x\udfff".repeat(2000) }],
])("reserves actual escaped JSON storage for %s", (_label, value) => {
  const allowance = 64 * 1024;
  const result = requireAuthenticationHeadroom(value, {
    operation: "inspect_analysis_view",
    path: "/tmp/bundle.json",
    description: "Cannot authenticate bundle",
    availableBytes: allowance,
  });
  if (result.ok) throw new Error("Expected authentication refusal");
  expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
  expect(result.error.reportedLimits?.projected_value_bytes).toBeLessThan(
    allowance / 2,
  );
  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisResourceConstraintError",
      reportedLimits: {
        available_heap_bytes: allowance,
        serialized_json_utf16_bytes: JSON.stringify(value).length * 2,
      },
    },
  });
});

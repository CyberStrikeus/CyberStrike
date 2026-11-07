import { describe, expect, it } from "vitest";

import {
  cdpCleanupGraceExpired,
  cdpCommandDeadlineRecovery,
} from "./browserDeadline.js";
import { listBrowserTargetsInputSchema } from "./browserObservation.js";
import {
  analyzeWebBundleInputSchema,
  webBundleHeapExhaustedReason,
  webBundleHeapExhaustedRemediation,
  webBundleMemoryExhaustion,
  webBundleResultAdmissionFailure,
  webBundleScriptTimeoutRecovery,
} from "./webBundleAnalysis.js";
import {
  inspectWebNetworkCaptureInputSchema,
  webNetworkCaptureTimeoutRecovery,
} from "./webNetworkCapture.js";
import {
  webSourceLocationInputSchema,
  webSourceMapDecodeTimeoutRecovery,
} from "./webSourceLocation.js";

const bundle = {
  cdp_endpoint: "http://127.0.0.1:9222",
  target_id: "page",
};

describe("web deadline controls", () => {
  it("rejects a per-script deadline above the total", () => {
    const parsed = analyzeWebBundleInputSchema.safeParse({
      ...bundle,
      analysis_timeout_ms: 40_000,
      total_analysis_timeout_ms: 30_000,
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.map((issue) => issue.message).join(" "),
    ).toContain("analysis_timeout_ms");
  });

  it("keeps omitted web-bundle deadlines at today's defaults", () => {
    const parsed = analyzeWebBundleInputSchema.parse(bundle);
    expect(parsed.analysis_timeout_ms).toBeUndefined();
    expect(parsed.total_analysis_timeout_ms).toBeUndefined();
    expect(parsed.max_heap_mb).toBeUndefined();
    expect(parsed.source_map_fetch_timeout_ms).toBeUndefined();
    expect(parsed.command_timeout_ms).toBeUndefined();
  });

  it("accepts the promoted deadlines inside 1..2147483647", () => {
    expect(
      analyzeWebBundleInputSchema.safeParse({
        ...bundle,
        command_timeout_ms: 2_147_483_647,
      }).success,
    ).toBe(true);
    expect(
      listBrowserTargetsInputSchema.safeParse({
        cdp_endpoint: "http://127.0.0.1:9222",
        command_timeout_ms: 1_500,
      }).success,
    ).toBe(false);
    expect(
      inspectWebNetworkCaptureInputSchema.safeParse({
        capture_path: "/tmp/capture.har",
        format: "har",
        capture_timeout_ms: 0,
      }).success,
    ).toBe(false);
    expect(
      webSourceLocationInputSchema.safeParse({
        manifest_path: "/tmp/manifest.json",
        script_index: 0,
        source_map: {
          path: "/tmp/app.js.map",
          url: "https://example.test/app.js.map",
        },
        generated_position: { line: 1, column: 0 },
        decode_timeout_ms: 20_000,
      }).success,
    ).toBe(true);
  });

  it("names each deadline and the fixed budgets it does not raise", () => {
    expect(webBundleScriptTimeoutRecovery(30_000).userMessage).toContain(
      "analysis_timeout_ms",
    );
    expect(
      webNetworkCaptureTimeoutRecovery(30_000).remediationAction,
    ).toContain("no runtime override");
    expect(webSourceMapDecodeTimeoutRecovery(20_000).userMessage).toContain(
      "decode_timeout_ms",
    );
    expect(
      cdpCommandDeadlineRecovery(20_000, "handshake").userMessage,
    ).toContain("command_timeout_ms");
    expect(cdpCleanupGraceExpired()).toContain("5000 ms");
    expect(cdpCleanupGraceExpired()).toContain("no runtime override");
    const inspector = cdpCommandDeadlineRecovery(
      20_000,
      "handshake",
      undefined,
      false,
    );
    expect(inspector.userMessage).not.toContain("command_timeout_ms");
    expect(inspector.remediationAction).not.toContain("--command-timeout-ms");
    expect(inspector.remediationAction).toContain("no runtime override");
  });
});

it("names web-bundle exhaustion by the runtime that enforced it", () => {
  const node = webBundleMemoryExhaustion({
    runtime: "node",
    heapMb: 1024,
    memoryLimitReached: true,
    processMemoryLimitBytes: 99,
  });
  expect(node.kind).toBe("v8-heap");
  expect(webBundleHeapExhaustedReason(node)).toContain(
    "exhausted its max_heap_mb V8 old-space heap of 1024 MiB",
  );
  expect(webBundleHeapExhaustedRemediation(node)).toContain(
    "Increase max_heap_mb above 1024",
  );

  const commitBytes = 1024 * 1024 * 1024 + 512 * 1024 * 1024;
  const windows = webBundleMemoryExhaustion({
    runtime: "bun",
    heapMb: 1024,
    memoryLimitReached: true,
    processMemoryLimitBytes: commitBytes,
  });
  const windowsReason = webBundleHeapExhaustedReason(windows);
  expect(windows.kind).toBe("process-commit");
  expect(windowsReason).toContain(
    `${String(commitBytes)}-byte process commit limit`,
  );
  expect(windowsReason).toContain("512 MiB Bun runtime reserve");
  expect(windowsReason).not.toContain("V8 old-space heap of");
  const windowsRemediation = webBundleHeapExhaustedRemediation(windows);
  expect(windowsRemediation).toContain("Increase max_heap_mb above 1024");
  expect(windowsRemediation).toContain("Windows process commit limit");
  expect(windowsRemediation).toContain("not a V8 old-space heap");
  expect(windowsRemediation).not.toContain(
    "exhausted its max_heap_mb V8 old-space heap",
  );

  const bun = webBundleMemoryExhaustion({
    runtime: "bun",
    heapMb: 1024,
    memoryLimitReached: false,
    processMemoryLimitBytes: null,
  });
  expect(bun.kind).toBe("bun-allocation");
  expect(webBundleHeapExhaustedReason(bun)).toContain(
    "Bun ignores the V8 old-space flag",
  );
  expect(webBundleHeapExhaustedReason(bun)).not.toContain(
    "V8 old-space heap of",
  );
  expect(webBundleHeapExhaustedRemediation(bun)).not.toContain(
    "Increase max_heap_mb",
  );
  expect(webBundleHeapExhaustedRemediation(bun)).toContain(
    "does not change this exit",
  );

  const beforeLimit = webBundleMemoryExhaustion({
    runtime: "bun",
    heapMb: 1024,
    memoryLimitReached: false,
    processMemoryLimitBytes: commitBytes,
  });
  expect(beforeLimit.kind).toBe("bun-allocation");
  const beforeLimitReason = webBundleHeapExhaustedReason(beforeLimit);
  expect(beforeLimitReason).toContain(
    `${String(commitBytes)}-byte process commit limit was reported as reached`,
  );
  expect(beforeLimitReason).not.toContain(
    "enforces no analyzer process commit limit",
  );
  expect(webBundleHeapExhaustedRemediation(beforeLimit)).toContain(
    "was not reported as reached",
  );
  expect(webBundleHeapExhaustedRemediation(beforeLimit)).not.toContain(
    "Increase max_heap_mb",
  );
  expect(webBundleHeapExhaustedReason(bun)).toContain(
    "enforces no analyzer process commit limit",
  );
  expect(
    webBundleHeapExhaustedRemediation({
      kind: "v8-heap",
      heapMb: 16_384,
    }),
  ).toContain("already at the maximum 16384 MiB");
});

it("names host heap pressure only while the fixed result budget still has room", () => {
  const host = webBundleResultAdmissionFailure({
    fixedBudgetBytes: 8_388_608,
    fixedRemainingBytes: 8_388_608,
    hostCapacityBytes: 0,
  });
  expect(host.kind).toBe("host-capacity");
  expect(host.reason).toContain("host result capacity 0 bytes");
  expect(host.reason).toContain("still has 8388608 bytes available");
  expect(host.reason).not.toContain("has no further room");
  if (host.kind !== "host-capacity") return;
  expect(host.remediationAction).not.toContain("has no further room");
  expect(host.remediationAction).toContain("NODE_OPTIONS");
  expect(host.reportedLimits).toEqual({
    result_bytes: 8_388_608,
    result_budget_remaining_bytes: 8_388_608,
    host_result_capacity_bytes: 0,
  });

  const fixed = webBundleResultAdmissionFailure({
    fixedBudgetBytes: 8_388_608,
    fixedRemainingBytes: 0,
    hostCapacityBytes: 0,
  });
  expect(fixed.kind).toBe("fixed-budget");
  expect(fixed.reason).toContain(
    "8388608-byte web-bundle result budget has no further room",
  );
  expect(fixed.reason).toContain("no runtime override");
  expect(fixed.reason).not.toContain("host result capacity");
});

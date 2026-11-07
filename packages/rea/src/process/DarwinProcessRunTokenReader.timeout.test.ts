import { describe, expect, it } from "vitest";

import {
  resolveSwiftcCompileTimeoutMs,
  swiftcCompileTimeoutRecovery,
} from "./DarwinProcessRunTokenReader.js";
import { MAX_NODE_TIMER_DELAY_MS } from "../domain/analysisResourceLimits.js";

describe("resolveSwiftcCompileTimeoutMs", () => {
  it("keeps the historical default when unset", () => {
    expect(resolveSwiftcCompileTimeoutMs({ environment: {} })).toBe(120_000);
  });

  it("prefers an explicit compileTimeoutMs over the environment", () => {
    expect(
      resolveSwiftcCompileTimeoutMs({
        compileTimeoutMs: 12_000,
        environment: { REA_SWIFTC_COMPILE_TIMEOUT_MS: "300000" },
      }),
    ).toBe(12_000);
  });

  it("reads a valid REA_SWIFTC_COMPILE_TIMEOUT_MS value", () => {
    expect(
      resolveSwiftcCompileTimeoutMs({
        environment: { REA_SWIFTC_COMPILE_TIMEOUT_MS: "300000" },
      }),
    ).toBe(300_000);
  });

  it("falls back to the default for a malformed environment value", () => {
    expect(
      resolveSwiftcCompileTimeoutMs({
        environment: { REA_SWIFTC_COMPILE_TIMEOUT_MS: "loud" },
      }),
    ).toBe(120_000);
  });

  it("names the launch-environment deadline, range, and restart on a timeout", () => {
    const recovery = swiftcCompileTimeoutRecovery(300_000);
    expect(recovery).toContain("REA_SWIFTC_COMPILE_TIMEOUT_MS");
    expect(recovery).toContain("300000 ms");
    expect(recovery).toContain(`1..${String(MAX_NODE_TIMER_DELAY_MS)}`);
    expect(recovery).toContain("120000 ms");
    expect(recovery).toContain("restart REA");
    expect(recovery).toContain("next ownership-helper compile");
  });
});

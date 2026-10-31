import { describe, expect, it } from "vitest";

import { pwntoolsInputBytes } from "./PwntoolsInputLimit.js";
import { pwntoolsUnavailable } from "./PwntoolsFailures.js";
import {
  PWNTOOLS_LIMITS,
  PWNTOOLS_PROVIDER_IDENTITY,
} from "./PwntoolsRelease.js";

const CONSTRAINT =
  "REA_PWNTOOLS_MAX_INPUT_BYTES must be a decimal integer from 1 to " +
  "1073741824 bytes, and REA never installs Python or packages.";

describe("pwntools input bound", () => {
  it("keeps the shipped default when the override is absent", () => {
    expect(pwntoolsInputBytes({})).toEqual({
      configured: true,
      bytes: PWNTOOLS_LIMITS.inputBytes,
    });
    expect(PWNTOOLS_LIMITS.inputBytes).toBe(32 * 1024 * 1024);
  });

  it.each([
    ["1", 1],
    ["67108864", 64 * 1024 * 1024],
    ["172879872", 172_879_872],
    ["1073741824", 1024 * 1024 * 1024],
  ] as const)("accepts %s as %s bytes", (value, expected) => {
    expect(pwntoolsInputBytes({ REA_PWNTOOLS_MAX_INPUT_BYTES: value })).toEqual(
      { configured: true, bytes: expected },
    );
  });

  it.each([
    "",
    "0",
    "-1",
    "33554432.0",
    "1e8",
    " 67108864",
    "67_108_864",
    "0x2000000",
    "1073741825",
    "99999999999999999999",
    "not-a-number",
  ])("rejects %s instead of widening the bound silently", (value) => {
    expect(pwntoolsInputBytes({ REA_PWNTOOLS_MAX_INPUT_BYTES: value })).toEqual(
      {
        configured: false,
        error: CONSTRAINT,
      },
    );
  });

  it("rejects a value above the ceiling that a float would round", () => {
    const ceiling = pwntoolsInputBytes({
      REA_PWNTOOLS_MAX_INPUT_BYTES: "1073741824",
    });
    const above = pwntoolsInputBytes({
      REA_PWNTOOLS_MAX_INPUT_BYTES: "10737418241",
    });
    expect(ceiling.configured).toBe(true);
    expect(above).toEqual({ configured: false, error: CONSTRAINT });
  });

  it("never narrows the bound below the shipped default implicitly", () => {
    const accepted = [1, 1024, PWNTOOLS_LIMITS.inputBytes].map((bytes) =>
      pwntoolsInputBytes({ REA_PWNTOOLS_MAX_INPUT_BYTES: String(bytes) }),
    );
    expect(accepted.every((limit) => limit.configured)).toBe(true);
  });
});

describe("pwntools unavailability configuration key", () => {
  const context = {
    operation: "inspect_binary_layout",
    providerId: PWNTOOLS_PROVIDER_IDENTITY.id,
  };
  const reportedKey = (configurationKey?: string) =>
    pwntoolsUnavailable(
      CONSTRAINT,
      "/caller-selected/python",
      undefined,
      undefined,
      configurationKey === undefined
        ? context
        : { ...context, configurationKey },
    ).rejections[0]?.diagnostics["configuration_key"];

  it("keeps the engine key unless the failure is about the bound", () => {
    expect(reportedKey()).toBe("REA_PWNTOOLS_PYTHON");
    expect(reportedKey("REA_PWNTOOLS_MAX_INPUT_BYTES")).toBe(
      "REA_PWNTOOLS_MAX_INPUT_BYTES",
    );
  });
});

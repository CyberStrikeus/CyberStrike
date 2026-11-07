import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { expect, it } from "vitest";
import { ConfigurationError } from "../domain/configurationErrors.js";
import { parseEnvironment } from "./environment.js";
import { runtimeNativeMatchingAllowance } from "./runtimeAnalysisSettings.js";
import {
  DEFAULT_NATIVE_MATCHING_ALLOWANCE,
  NATIVE_MATCHING_ALLOWANCE_SETTING,
  nativeMatchingRepresentationBytesConstraint,
  parseNativeMatchingAllowance,
} from "./nativeMatchingAllowance.js";
import { launchAnalysisSetting } from "./analysisSettings.js";
import { explicitSetupRegistrationEnvironment } from "../application/SetupRegistrationEnvironment.js";

it("keeps the 96 MiB allowance when the launch setting is unset", () => {
  expect(parseNativeMatchingAllowance({})).toEqual({
    ok: true,
    value: DEFAULT_NATIVE_MATCHING_ALLOWANCE,
  });
  expect(DEFAULT_NATIVE_MATCHING_ALLOWANCE.maximumBytes).toBe(96 * 1024 * 1024);
  expect(
    launchAnalysisSetting("native.matching_representation_bytes", {}),
  ).toEqual({
    ok: true,
    value: { value: 96 * 1024 * 1024, source: "default" },
  });
});

it("accepts decimal byte counts from 1 byte to 1 GiB as a launch setting", () => {
  for (const bytes of [1, 268_435_456, 1024 * 1024 * 1024]) {
    const environment = { [NATIVE_MATCHING_ALLOWANCE_SETTING]: String(bytes) };
    expect(parseNativeMatchingAllowance(environment)).toEqual({
      ok: true,
      value: { maximumBytes: bytes, source: "setting" },
    });
    expect(
      launchAnalysisSetting(
        "native.matching_representation_bytes",
        environment,
      ),
    ).toEqual({ ok: true, value: { value: bytes, source: "setting" } });
  }
  // rea setup forwards the launch seed into client registrations.
  expect(
    explicitSetupRegistrationEnvironment({
      [NATIVE_MATCHING_ALLOWANCE_SETTING]: "268435456",
      UNRELATED: "x",
    }),
  ).toEqual({ [NATIVE_MATCHING_ALLOWANCE_SETTING]: "268435456" });
});

it("refuses invalid launch values instead of falling back to the default", () => {
  for (const value of ["0", "-1", "01", "1.5", "96MiB", "", "1073741825"]) {
    const environment = { [NATIVE_MATCHING_ALLOWANCE_SETTING]: value };
    const parsed = parseNativeMatchingAllowance(environment);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) continue;
    expect(parsed.error).toBeInstanceOf(ConfigurationError);
    expect(parsed.error.message).toBe(
      nativeMatchingRepresentationBytesConstraint,
    );
    expect(
      launchAnalysisSetting("native.matching_representation_bytes", environment)
        .ok,
    ).toBe(false);
    // Operation-local: global startup parsing is unaffected, and a runtime
    // override repairs the effective allowance without editing the seed.
    expect(parseEnvironment(environment).ok).toBe(true);
    expect(runtimeNativeMatchingAllowance(environment)().ok).toBe(false);
    const overridden = runtimeNativeMatchingAllowance(environment, () => ({
      revision: 1,
      overrides: { "native.matching_representation_bytes": 4096 },
    }))();
    expect(overridden).toEqual({
      ok: true,
      value: { maximumBytes: 4096, source: "runtime" },
    });
  }
});

it("advertises current-session repair for an invalid native matching launch seed", () => {
  const parsed = parseNativeMatchingAllowance({
    [NATIVE_MATCHING_ALLOWANCE_SETTING]: "0",
  });
  if (parsed.ok) throw new Error("Invalid seed was accepted");
  const projection = projectAnalysisError(parsed.error);
  expect(projection.code).toBe("configuration_invalid");
  expect(projection.remediation.action).toContain("update_analysis_settings");
  expect(projection.remediation.action).toContain(
    "native.matching_representation_bytes",
  );
  expect(projection.remediation.action).toContain(
    NATIVE_MATCHING_ALLOWANCE_SETTING,
  );
});

it("uses the native setting owner for the complete launch-snapshot error", () => {
  const environment = { [NATIVE_MATCHING_ALLOWANCE_SETTING]: "0" };
  const owned = parseNativeMatchingAllowance(environment);
  const snapshot = launchAnalysisSetting(
    "native.matching_representation_bytes",
    environment,
  );
  if (owned.ok || snapshot.ok) throw new Error("Invalid seed was accepted");
  expect(projectAnalysisError(snapshot.error)).toEqual(
    projectAnalysisError(owned.error),
  );
});

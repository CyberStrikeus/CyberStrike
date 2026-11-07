import { expect, it } from "vitest";

import {
  mergeEnvironmentOverrides,
  snapshotEnvironment,
} from "./snapshotEnvironment.js";

it.each(["win32", "linux", "darwin"] as const)(
  "merges explicit environment layers using %s key identity before sorting",
  (platform) => {
    const existing = {
      rea_analysis_provider: "hopper",
      CallerSetting: "retain",
    };
    const overrides = { REA_ANALYSIS_PROVIDER: "ghidra", Path: "chosen" };
    const merged = mergeEnvironmentOverrides(existing, overrides, platform);
    expect(merged).toEqual(
      platform === "win32"
        ? {
            REA_ANALYSIS_PROVIDER: "ghidra",
            CallerSetting: "retain",
            Path: "chosen",
          }
        : { ...existing, ...overrides },
    );
    expect(Object.isFrozen(merged)).toBe(true);
    expect(existing.rea_analysis_provider).toBe("hopper");
    expect(overrides.REA_ANALYSIS_PROVIDER).toBe("ghidra");
  },
);

it.each(["linux", "darwin"] as const)(
  "preserves case-sensitive %s variables in an immutable snapshot",
  (platform) => {
    const selected = { PATH: "/chosen/bin", Path: "/other/bin" };
    const snapshot = snapshotEnvironment(selected, platform);
    selected.PATH = "/later/bin";
    expect(snapshot).toEqual({ PATH: "/chosen/bin", Path: "/other/bin" });
    expect(Object.isFrozen(snapshot)).toBe(true);
  },
);

it("canonicalizes selected Windows variables without inheriting ambient values", () => {
  const snapshot = snapshotEnvironment(
    { Path: "C:\\selected", ComSpec: "C:\\selected\\cmd.exe" },
    "win32",
  );
  expect(snapshot).toEqual({
    PATH: "C:\\selected",
    COMSPEC: "C:\\selected\\cmd.exe",
  });
  expect(Object.isFrozen(snapshot)).toBe(true);
});

it("keeps the last caller value for Windows aliases, including undefined", () => {
  const snapshot = snapshotEnvironment(
    {
      PATH: "upper",
      path: "lower",
      COMSPEC: "upper-cmd",
      ComSpec: "mixed-cmd",
      TEMP: "ambient-temp",
      temp: undefined,
    },
    "win32",
  );

  expect(snapshot).toEqual({
    COMSPEC: "mixed-cmd",
    PATH: "lower",
    TEMP: undefined,
  });
  expect(Object.keys(snapshot)).toEqual(["COMSPEC", "PATH", "TEMP"]);
  expect(Object.isFrozen(snapshot)).toBe(true);
});

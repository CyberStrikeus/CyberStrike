import { describe, expect, it } from "vitest";

import {
  ghidraDisabledAnalyzersSchema,
  MAX_GHIDRA_DISABLED_ANALYZER_NAMES,
} from "../config/ghidraDisabledAnalyzers.js";
import { parseConfig } from "../config/parseConfig.js";

const INSTALL = "/opt/ghidra_12.1.4_PUBLIC";

const configured = (setting?: string) => {
  const config = parseConfig({
    GHIDRA_INSTALL_DIR: INSTALL,
    ...(setting === undefined
      ? {}
      : { REA_GHIDRA_DISABLED_ANALYZERS: setting }),
  });
  if (!config.ok) throw config.error;
  return config.value.ghidraDisabledAnalyzers;
};

describe("REA_GHIDRA_DISABLED_ANALYZERS", () => {
  it("stays unset without the setting", () => {
    expect(configured(undefined)).toBeUndefined();
  });

  it("splits a comma-separated list and trims each name", () => {
    expect(
      configured(" Objective-C Message Analyzer,Decompiler Switch Analysis "),
    ).toEqual(["Objective-C Message Analyzer", "Decompiler Switch Analysis"]);
  });

  it("treats an empty or blank list as unset", () => {
    expect(configured("")).toBeUndefined();
    expect(configured(" , ")).toBeUndefined();
  });

  it("keeps empty names out of the list instead of failing", () => {
    expect(
      configured("Objective-C Message Analyzer,,Decompiler Switch Analysis"),
    ).toEqual(["Objective-C Message Analyzer", "Decompiler Switch Analysis"]);
  });

  it.each([
    ["a leading flag name", "-Decompiler Switch Analysis"],
    ["a name with command metacharacters", "Analyzer(&calc)"],
    ["a non-ASCII name", "分析器"],
    ["an over-long name", "A".repeat(121)],
  ])("rejects %s", (_label, setting) => {
    const config = parseConfig({
      GHIDRA_INSTALL_DIR: INSTALL,
      REA_GHIDRA_DISABLED_ANALYZERS: setting,
    });
    expect(config.ok).toBe(false);
    if (!config.ok)
      expect(config.error).toMatchObject({
        settings: [
          expect.objectContaining({
            setting: "REA_GHIDRA_DISABLED_ANALYZERS",
          }),
        ],
      });
  });

  it("rejects more than the admitted analyzer count", () => {
    const setting = Array.from(
      { length: MAX_GHIDRA_DISABLED_ANALYZER_NAMES + 1 },
      (_, index) => `Analyzer ${index}`,
    ).join(",");
    const config = parseConfig({
      GHIDRA_INSTALL_DIR: INSTALL,
      REA_GHIDRA_DISABLED_ANALYZERS: setting,
    });
    expect(config.ok).toBe(false);
    if (!config.ok)
      expect(config.error).toMatchObject({
        settings: [
          expect.objectContaining({
            setting: "REA_GHIDRA_DISABLED_ANALYZERS",
          }),
        ],
      });
  });

  it("admits the documented Objective-C analyzer name", () => {
    expect(
      ghidraDisabledAnalyzersSchema.parse("Objective-C Message Analyzer"),
    ).toEqual(["Objective-C Message Analyzer"]);
  });
});

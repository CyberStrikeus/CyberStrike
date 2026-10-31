import { describe, expect, it } from "vitest";

import {
  javaScriptRuntime,
  supportsJavaScriptRuntime,
  supportsNodeVersion,
} from "./runtimeVersion.js";

describe("supported Node.js versions", () => {
  it.each([
    ["20.0.0", false],
    ["22.19.0", false],
    ["22.23.3", false],
    ["22.23.4", true],
    ["22.99.0", true],
    ["23.0.0", false],
    ["24.11.0", false],
    ["24.22.0", false],
    ["24.22.1", true],
    ["24.99.0", true],
    ["25.1.0", false],
    ["26.0.0", false],
    ["26.12.0", false],
    ["26.12.1", true],
    ["26.13.0", true],
    ["27.0.0", true],
    ["24.22.1-rc.1", false],
    ["26.12.1-nightly.20261022", false],
    ["24.22", false],
    ["24.22.invalid", false],
    ["invalid", false],
  ])("classifies %s as supported=%s", (version, expected) => {
    expect(supportsNodeVersion(version)).toBe(expected);
  });
});

describe("JavaScript runtime identity", () => {
  it("distinguishes Bun from Node.js by its own version", () => {
    expect(javaScriptRuntime({ node: "24.18.0" })).toEqual({
      id: "node",
      version: "24.18.0",
    });
    expect(javaScriptRuntime({ node: "26.3.0", bun: "1.4.2" })).toEqual({
      id: "bun",
      version: "1.4.2",
      nodeCompatibilityVersion: "26.3.0",
    });
  });
});

describe("supported JavaScript runtimes", () => {
  it.each([
    [{ id: "node", version: "24.22.1" }, true],
    [{ id: "node", version: "24.18.0" }, false],
    // Bun is judged by its Node.js compatibility version, not its own.
    [
      { id: "bun", version: "1.4.2", nodeCompatibilityVersion: "26.12.1" },
      true,
    ],
    [
      { id: "bun", version: "99.0.0", nodeCompatibilityVersion: "24.18.0" },
      false,
    ],
  ] as const)("classifies %o as supported=%s", (runtime, expected) => {
    expect(supportsJavaScriptRuntime(runtime)).toBe(expected);
  });
});

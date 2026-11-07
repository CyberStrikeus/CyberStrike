import { describe, expect, it } from "vitest";

import {
  admitsCanonicalPathSyntax,
  hasScheme,
  looksExternal,
  stripQueryAndFragment,
} from "./artifactPathSyntax.js";

describe("artifact path syntax", () => {
  it("detects URI schemes without matching bare paths", () => {
    expect(hasScheme("https://example.test/app.js")).toBe(true);
    expect(hasScheme("file:///app.js")).toBe(true);
    expect(hasScheme("node:fs")).toBe(true);
    expect(hasScheme("web3:app.js")).toBe(true);
    expect(hasScheme("h323:user@example.test")).toBe(true);
    expect(hasScheme("x1+custom.v2-test:asset")).toBe(true);
    expect(hasScheme("3web:app.js")).toBe(false);
    expect(hasScheme("./web3:app.js")).toBe(false);
    expect(hasScheme("./relative.js")).toBe(false);
    expect(hasScheme("/absolute.js")).toBe(false);
    expect(hasScheme("app.js")).toBe(false);
  });

  it("flags scheme-qualified and protocol-relative references as external", () => {
    expect(looksExternal("https://example.test/app.js")).toBe(true);
    expect(looksExternal("//example.test/app.js")).toBe(true);
    expect(looksExternal("./app.js")).toBe(false);
    expect(looksExternal("/app.js")).toBe(false);
  });

  it("strips queries and fragments in fragment-first order", () => {
    expect(stripQueryAndFragment("./app.js?token=secret#hash")).toBe(
      "./app.js",
    );
    expect(stripQueryAndFragment("./app.js#hash?token=secret")).toBe(
      "./app.js",
    );
    expect(stripQueryAndFragment("./app.js")).toBe("./app.js");
  });

  it("rejects NUL, backslash, and encoded dot/separator bytes", () => {
    expect(admitsCanonicalPathSyntax("./app.js")).toBe(true);
    expect(admitsCanonicalPathSyntax("dir\\app.js")).toBe(false);
    expect(admitsCanonicalPathSyntax("dir\0app.js")).toBe(false);
    expect(admitsCanonicalPathSyntax("./%2e%2e/secret.js")).toBe(false);
    expect(admitsCanonicalPathSyntax("./%2Fapp.js")).toBe(false);
    expect(admitsCanonicalPathSyntax("./%5capp.js")).toBe(false);
  });
});

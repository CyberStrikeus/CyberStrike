import { describe, expect, it } from "vitest";

import { err, ok } from "../domain/result.js";
import { safeParseJson } from "../domain/safeJson.js";
import { PRODUCT_IDENTITY } from "../identity.js";
import {
  npmLatestVersionCommand,
  npmReleaseLookup,
  parseNpmLatestVersion,
} from "./UpdateRuntime.js";

const installation = {
  manager: "npm",
  prefix: "/opt/rea",
  packageRoot: "/opt/rea/lib/node_modules/rea-agents",
} as const;

describe("npm latest release metadata", () => {
  it("accepts npm 11's scalar JSON response", () => {
    expect(parseNpmLatestVersion('"6.0.0"')).toEqual(ok("6.0.0"));
  });

  it("accepts npm 12's singleton-array JSON response", () => {
    expect(parseNpmLatestVersion('[\n  "6.0.0"\n]\n')).toEqual(ok("6.0.0"));
  });

  it.each([
    ["empty array", "[]"],
    ["multiple versions", '["6.0.0", "6.0.1"]'],
    ["empty version", '[""]'],
    ["number", "6"],
    ["object", '{"version":"6.0.0"}'],
    ["null", "null"],
  ])("rejects %s response data", (_description, metadata) => {
    expect(parseNpmLatestVersion(metadata)).toEqual(
      err(
        "Invalid npm release metadata: expected a version string or a single-element version array.",
      ),
    );
  });

  it("preserves malformed JSON separately from a wrong metadata shape", () => {
    const metadata = '"6.0.0';
    const decoded = safeParseJson(metadata);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(parseNpmLatestVersion(metadata)).toEqual(err(decoded.error));
    expect(decoded.error).not.toContain("single-element version array");
  });

  it("keeps command failures distinct from rejected metadata", () => {
    expect(npmReleaseLookup(err("npm registry returned HTTP 503"))).toEqual(
      err({ kind: "unavailable", detail: "npm registry returned HTTP 503" }),
    );
    expect(npmReleaseLookup(ok("[]"))).toEqual(
      err({
        kind: "invalid-metadata",
        detail:
          "Invalid npm release metadata: expected a version string or a single-element version array.",
      }),
    );
    expect(npmReleaseLookup(ok('["6.0.0"]'))).toEqual(ok("6.0.0"));
  });

  it("keeps the global registry query and adds the owning prefix", () => {
    expect(npmLatestVersionCommand(installation)).toEqual([
      "npm",
      "view",
      "--global",
      "--prefix",
      installation.prefix,
      PRODUCT_IDENTITY.packageName,
      "dist-tags.latest",
      "--json",
      "--fetch-retries=0",
      "--fetch-timeout=10000",
    ]);
    expect(npmLatestVersionCommand(undefined)).toEqual([
      "npm",
      "view",
      "--global",
      PRODUCT_IDENTITY.packageName,
      "dist-tags.latest",
      "--json",
      "--fetch-retries=0",
      "--fetch-timeout=10000",
    ]);
  });
});

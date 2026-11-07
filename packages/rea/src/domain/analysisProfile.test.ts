import { describe, expect, it } from "vitest";

import {
  analysisProfileSchema,
  createAnalysisProfile,
} from "./analysisProfile.js";
import type { JsonValue } from "./jsonValue.js";

const PROVIDER = {
  id: "fixture",
  name: "Fixture analysis provider",
  version: "1.2.3",
} as const;

describe("analysis profile commitments", () => {
  it("separates provider builds and semantic parameters", () => {
    const baseline = createAnalysisProfile(PROVIDER, { loader: "default" });
    const changedBuild = createAnalysisProfile(
      { ...PROVIDER, version: "1.2.4" },
      { loader: "default" },
    );
    const changedParameters = createAnalysisProfile(PROVIDER, {
      loader: "override",
    });
    expect(
      new Set([baseline.digest, changedBuild.digest, changedParameters.digest])
        .size,
    ).toBe(3);
  });

  it("commits parameter objects larger than the former byte ceiling", () => {
    const parameters = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [
        `parameter-${String(index)}`,
        "x".repeat(16 * 1024),
      ]),
    );
    expect(Buffer.byteLength(JSON.stringify(parameters))).toBeGreaterThan(
      64 * 1024,
    );

    const profile = createAnalysisProfile(PROVIDER, parameters);

    expect(analysisProfileSchema.parse(profile)).toEqual(profile);
  });

  it("accepts deep, large, and long-string profile parameters", () => {
    let nested: JsonValue = "leaf";
    for (let index = 0; index < 24; index += 1)
      nested = { [`level-${String(index)}`]: nested };
    const parameters = {
      nested,
      entries: Array.from({ length: 5_000 }, (_, index) => index),
      long_value: "x".repeat(20 * 1024),
    };

    const profile = createAnalysisProfile(PROVIDER, parameters);

    expect(analysisProfileSchema.parse(profile)).toEqual(profile);
  });

  it("rejects digest tampering", () => {
    const profile = createAnalysisProfile(PROVIDER, { loader: "default" });
    expect(() =>
      analysisProfileSchema.parse({ ...profile, digest: "0".repeat(64) }),
    ).toThrow(/digest/u);
  });

  it("projects known provider identity fields at construction", () => {
    const liveProvider = { ...PROVIDER, transient_status: "starting" };
    const profile = createAnalysisProfile(liveProvider, { loader: "default" });
    expect(profile.provider).toEqual(PROVIDER);
    expect(analysisProfileSchema.parse(profile)).toEqual(profile);
  });
});

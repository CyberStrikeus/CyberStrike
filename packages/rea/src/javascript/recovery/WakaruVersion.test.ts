import { describe, expect, it } from "vitest";
import { admitWakaruVersion } from "./WakaruVersion.js";
import { WAKARU_RELEASE } from "./WakaruRelease.js";

describe("Wakaru release range", () => {
  it("accepts the verified banner without an extra limitation", () => {
    expect(admitWakaruVersion(`wakaru ${WAKARU_RELEASE.version}`)).toEqual({
      status: "verified",
      version: WAKARU_RELEASE.version,
    });
  });

  it.each([
    ["wakaru 1.13.0", "1.13.0"],
    ["wakaru 1.15.2", "1.15.2"],
  ])("accepts %s as compatible", (banner, version) => {
    const admitted = admitWakaruVersion(banner);
    expect(admitted).toMatchObject({ status: "compatible", version });
    if (admitted.status !== "compatible")
      throw new Error("expected a compatible release");
    expect(admitted.limitation).toContain(version);
    expect(admitted.limitation).toContain(WAKARU_RELEASE.version);
  });

  it.each([
    ["wakaru 1.12.0", "wakaru 1.12.0"],
    ["wakaru 2.0.0", "wakaru 2.0.0"],
    ["wakaru 1.15.0-rc.1", "wakaru 1.15.0-rc.1"],
    ["wakaru v1.14.0", "wakaru v1.14.0"],
    ["1.14.0", "1.14.0"],
    ["", "missing"],
  ])("rejects banner %j", (banner, detail) => {
    const admitted = admitWakaruVersion(banner);
    if (admitted.status !== "unsupported")
      throw new Error("expected a rejected banner");
    expect(admitted.message).toContain(detail);
    expect(admitted.message).toContain("^1.13.0");
  });
});

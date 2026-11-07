import { describe, expect, it } from "vitest";
import {
  SUPPORTED_GHIDRA_VERSION,
  ghidraReleaseAccepted,
  ghidraReleaseCompatibility,
  ghidraReleaseLine,
  ghidraVersionDetail,
  unverifiedGhidraBuildLimitation,
} from "./GhidraReleasePolicy.js";

describe("ghidraReleaseCompatibility", () => {
  it("marks the verified build", () => {
    const compatibility = ghidraReleaseCompatibility("12.1.4");
    expect(compatibility.status).toBe("verified");
    if (compatibility.status !== "verified") return;
    expect(compatibility.raw).toBe("12.1.4");
  });

  it("marks the rest of the verified line compatible", () => {
    expect(ghidraReleaseCompatibility("12.1.2").status).toBe("compatible");
  });

  it("admits a newer minor release as compatible", () => {
    const compatibility = ghidraReleaseCompatibility("12.2");
    expect(compatibility.status).toBe("compatible");
    if (compatibility.status !== "compatible") return;
    expect(compatibility.raw).toBe("12.2");
  });

  it("rejects other majors and older minors", () => {
    expect(ghidraReleaseCompatibility("12.0.4").status).toBe("unsupported");
    expect(ghidraReleaseCompatibility("11.4").status).toBe("unsupported");
    expect(ghidraReleaseCompatibility("13.0").status).toBe("unsupported");
  });

  it("leaves unparseable releases unresolved", () => {
    expect(ghidraReleaseCompatibility("latest").status).toBe("unresolved");
    expect(ghidraReleaseCompatibility(null).status).toBe("unresolved");
  });
});

describe("ghidraReleaseAccepted", () => {
  it("accepts the verified build and newer compatible releases", () => {
    expect(ghidraReleaseAccepted("12.1.4")).toBe(true);
    expect(ghidraReleaseAccepted("12.2")).toBe(true);
  });

  it("rejects unsupported releases", () => {
    expect(ghidraReleaseAccepted("13.0")).toBe(false);
    expect(ghidraReleaseAccepted("latest")).toBe(false);
  });
});

describe("unverifiedGhidraBuildLimitation", () => {
  it("reports a newer compatible build against the verified build", () => {
    const limitation = unverifiedGhidraBuildLimitation("12.2");
    expect(limitation).toBeDefined();
    expect(limitation).toContain("12.2");
    expect(limitation).toContain(SUPPORTED_GHIDRA_VERSION);
  });

  it("stays silent for the verified build and unsupported releases", () => {
    expect(unverifiedGhidraBuildLimitation("12.1.4")).toBeUndefined();
    expect(unverifiedGhidraBuildLimitation("13.0")).toBeUndefined();
  });
});

describe("ghidraReleaseLine", () => {
  it("names the accepted release floor", () => {
    expect(ghidraReleaseLine()).toBe("12.x (>=12.1)");
  });
});

describe("ghidraVersionDetail", () => {
  it("describes a newer compatible release against the verified build", () => {
    const detail = ghidraVersionDetail("12.2");
    expect(detail).toContain("compatible");
    expect(detail).toContain(SUPPORTED_GHIDRA_VERSION);
  });
});

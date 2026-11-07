import { describe, expect, it } from "vitest";
import { admitFirmwareVersion } from "./FirmwareVersion.js";

describe("firmware release lines", () => {
  it("accepts the verified banners without an extra limitation", () => {
    expect(admitFirmwareVersion("binwalk", "binwalk 3.1.0")).toEqual({
      status: "verified",
      version: "3.1.0",
    });
    expect(admitFirmwareVersion("unblob", "26.6.4")).toEqual({
      status: "verified",
      version: "26.6.4",
    });
  });

  it.each([
    ["binwalk", "binwalk 3.1.2", "3.1.2"],
    ["binwalk", "binwalk 3.1.0-1", "3.1.0-1"],
    ["unblob", "26.6.5", "26.6.5"],
  ] as const)(
    "accepts %s %s on the verified line",
    (engine, banner, version) => {
      const admitted = admitFirmwareVersion(engine, banner);
      expect(admitted).toMatchObject({ status: "compatible", version });
      if (admitted.status !== "compatible")
        throw new Error("expected a compatible release");
      expect(admitted.limitation).toContain(version);
      expect(admitted.limitation).toContain(
        engine === "binwalk" ? "3.1.0" : "26.6.4",
      );
    },
  );

  it.each([
    ["binwalk", "binwalk 3.2.0", "Binwalk 3.1.x"],
    ["binwalk", "unsupported", "Binwalk 3.1.x"],
    ["binwalk", "3.1.2", "Binwalk 3.1.x"],
    ["unblob", "26.7.0", "Unblob 26.6.x"],
    ["unblob", "unblob 26.6.4", "Unblob 26.6.x"],
    ["unblob", "", "missing"],
  ] as const)("rejects %s banner %j", (engine, banner, detail) => {
    const admitted = admitFirmwareVersion(engine, banner);
    expect(
      admitted.status === "verified" || admitted.status === "compatible",
    ).toBe(false);
    if (admitted.status === "verified" || admitted.status === "compatible")
      throw new Error("expected a rejected banner");
    expect(admitted.message).toContain(detail);
  });
});

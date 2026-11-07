import { describe, expect, it } from "vitest";

import { parseTarListing } from "../../../scripts/lib/verify-package-listing.mjs";

/**
 * `verify-packed-bridge.mjs` compares these members exactly
 * (`packedFiles.includes(path)`), so a retained `\r` reports a shipped bridge
 * as omitted. See issue #4128.
 */
const packedBridges = [
  "package/bridge/hopper_bridge.py",
  "package/bridge/cutter/rea_bridge.py",
  "package/bridge/ghidra/ReaGhidraBridge.java",
  "package/bridge/ghidra/ReaGhidraBundleActivator.java",
];

const listing = (lineEnding: string) =>
  ["package/package.json", ...packedBridges, "package/skills/rea/SKILL.md"]
    .map((member) => `${member}${lineEnding}`)
    .join("");

describe("packed tar listing", () => {
  it("keeps exact member identities when Windows tar emits CRLF", () => {
    const packedFiles = parseTarListing(listing("\r\n"));
    for (const path of packedBridges) expect(packedFiles).toContain(path);
    expect(packedFiles.some((member) => member.includes("\r"))).toBe(false);
  });

  it("keeps exact member identities on POSIX listings", () => {
    const packedFiles = parseTarListing(listing("\n"));
    for (const path of packedBridges) expect(packedFiles).toContain(path);
  });

  it("drops the empty member left by the trailing line ending", () => {
    expect(parseTarListing(listing("\r\n"))).toHaveLength(6);
    expect(parseTarListing(listing("\n"))).toHaveLength(6);
    expect(parseTarListing("")).toEqual([]);
  });

  it("preserves member strings beyond the line ending", () => {
    expect(parseTarListing("package/a b/c d.py\r\npackage/e.py\r\n")).toEqual([
      "package/a b/c d.py",
      "package/e.py",
    ]);
  });

  it("keeps a literal CR at the end of a filename in an LF listing", () => {
    // One listing has one separator; a bare LF makes CR bytes filename bytes.
    expect(parseTarListing("package/a\r\npackage/b\n")).toEqual([
      "package/a\r",
      "package/b",
    ]);
  });

  it("splits a bare newline listing the way the Windows bug appeared", () => {
    // Guard the reported regression: the previous parse kept `\r` on members.
    const naive = listing("\r\n").split("\n");
    expect(naive).not.toContain(packedBridges[0]);
    expect(parseTarListing(listing("\r\n"))).toContain(packedBridges[0]);
  });
});

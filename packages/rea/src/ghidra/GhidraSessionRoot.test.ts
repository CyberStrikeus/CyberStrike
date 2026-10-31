import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { ghidraSessionRoot } from "./GhidraSessionRoot.js";

const POSIX = process.platform !== "win32";
const posixFallback = join(resolve(sep), "tmp");
const posixBase = (...segments: string[]) => join(resolve(sep), ...segments);

describe("ghidraSessionRoot", () => {
  it("keeps an inherited base that Ghidra accepts", () => {
    const base = posixBase("var", "tmp", "rea-run");
    expect(ghidraSessionRoot({ base, fallback: posixFallback })).toBe(base);
  });

  it("keeps a base whose elements only contain an interior dot", () => {
    const base = posixBase("opt", "rea.run", "session");
    expect(ghidraSessionRoot({ base, fallback: posixFallback })).toBe(base);
  });

  it("relocates a dot-prefixed base to the supplied dot-free fallback", () => {
    const base = posixBase("home", "operator", ".cache", "scratch");
    expect(ghidraSessionRoot({ base, fallback: posixFallback })).toBe(
      posixFallback,
    );
  });

  it("ignores a fallback that is itself dotted", () => {
    const base = posixBase("home", "operator", ".cache", "scratch");
    expect(
      ghidraSessionRoot({
        base,
        fallback: posixBase("home", "operator", ".tmp"),
      }),
    ).toBe(posixBase("home", "operator"));
  });

  it("uses the nearest safe ancestor when the platform has no fallback", () => {
    expect(
      ghidraSessionRoot({
        base: posixBase("Users", "operator", ".cache", "scratch"),
        platform: "win32",
      }),
    ).toBe(posixBase("Users", "operator"));
  });

  it("can select a filesystem root when the inherited temp starts with a dot-prefixed element", () => {
    expect(
      ghidraSessionRoot({
        base: posixBase(".Tmp", "scratch"),
        platform: "win32",
      }),
    ).toBe(resolve(sep));
  });

  it.skipIf(!POSIX)("prefers the platform temp directory by default", () => {
    expect(
      ghidraSessionRoot({ base: posixBase("home", "operator", ".cache") }),
    ).toBe(posixBase("tmp"));
  });
});

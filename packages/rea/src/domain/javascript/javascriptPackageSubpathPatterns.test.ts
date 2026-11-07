import { expect, it } from "vitest";
import {
  packageSubpathPatternMatches,
  selectPackageSubpathPattern,
} from "./javascriptPackageSubpathPatterns.js";

it.each([
  ["./*", "./window", true],
  ["./*end", "./end", false],
  ["./*.js", "./nested/a.js", true],
  ["./*.js", "./a.cjs", false],
  ["./*/*", "./nested/a", false],
  ["./other/*", "./window", false],
] as const)(
  "matches only the selected package pattern %s against %s",
  (pattern, subpath, expected) => {
    expect(packageSubpathPatternMatches(pattern, subpath)).toBe(expected);
  },
);

it.each([
  [["./*", "./private/*"], "./private/window", "./private/*"],
  [["./*", "./*.hidden"], "./window.hidden", "./*.hidden"],
  [["./private/*", "./*"], "./private/window", "./private/*"],
] as const)(
  "selects the most specific pattern independently of declaration order: %j",
  (patterns, subpath, expected) => {
    expect(selectPackageSubpathPattern(patterns, subpath)).toBe(expected);
  },
);

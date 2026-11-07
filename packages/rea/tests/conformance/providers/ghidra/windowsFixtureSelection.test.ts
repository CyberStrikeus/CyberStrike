import assert from "node:assert/strict";
import { it } from "vitest";

import { windowsGhidraFixtureOptions } from "../../../../scripts/lib/ghidra-windows-fixture-options.mjs";

it("architecture selectors cannot silently choose a different fixture", () => {
  for (const arguments_ of [
    ["--x86", "--arm"],
    ["--x86", "--arm64"],
    ["--arm", "--arm64"],
  ])
    assert.throws(() => windowsGhidraFixtureOptions(arguments_));
  assert.equal(
    windowsGhidraFixtureOptions(["D:/tmp/rea/--arm"]).architecture,
    "x86_64",
  );
});

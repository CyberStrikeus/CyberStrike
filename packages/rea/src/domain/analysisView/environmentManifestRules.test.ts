import { expect, it, vi } from "vitest";
import { toolName, toolNameRegistry } from "./environmentManifestNames.js";

it("shares suffix work when distinct names truncate to the same suffixed prefix", () => {
  const registry = toolNameRegistry();
  const has = vi.spyOn(registry.used, "has");
  const names: string[] = [];
  for (let index = 0; index < 256; index += 1) {
    const literal = "a".repeat(53) + index.toString(36).padStart(3, "0");
    for (const suffix of ["", ".json"])
      names.push(
        toolName(
          "GET",
          [{ kind: "literal", value: literal + suffix }],
          [],
          registry,
        ),
      );
  }
  expect(new Set(names).size).toBe(512);
  expect(names.every((name) => name.length <= 60)).toBe(true);
  // Counts the owner operation directly, independent of host timing or GC.
  expect(has.mock.calls.length).toBeLessThanOrEqual(names.length * 2);
});

it("keeps free shorter suffixes and skips occupied names across suffix widths", () => {
  const registry = toolNameRegistry();
  const stem = "a".repeat(53);
  const allocate = (literal: string) =>
    toolName("GET", [{ kind: "literal", value: literal }], [], registry);
  expect(allocate(`${stem}_10`)).toBe(`get_${stem}_10`);
  const longCollisions: string[] = [];
  for (let index = 0; index < 9; index += 1) {
    const literal = stem + index.toString(36).padStart(3, "0");
    allocate(literal);
    longCollisions.push(allocate(`${literal}.json`));
  }
  expect(longCollisions[0]).toBe(`get_${stem}0_2`);
  expect(longCollisions[7]).toBe(`get_${stem}0_9`);
  expect(longCollisions[8]).toBe(`get_${stem}_11`);
  expect(allocate(stem)).toBe(`get_${stem}`);
  for (let suffix = 2; suffix <= 9; suffix += 1)
    expect(allocate(`${stem}.json`)).toBe(`get_${stem}_${String(suffix)}`);
  expect(allocate(`${stem}.json`)).toBe(`get_${stem}_12`);
});

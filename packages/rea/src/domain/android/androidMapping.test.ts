import { expect, it } from "vitest";
import {
  projectAndroidMapping,
  type AndroidMappingSource,
} from "./androidMapping.js";
import { parseProguardMapping } from "./proguardMapping.js";

const source = (text: string): AndroidMappingSource => {
  const parsed = parseProguardMapping(text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return {
    file: {
      path: "/mapping.txt",
      sha256: "a".repeat(64),
      bytes: Buffer.byteLength(text),
    },
    mapping: parsed.value,
  };
};

it("admits combined outer and inner claims while retaining every observation on overflow", () => {
  const mapping = source(
    [
      "Owner -> a:",
      ...Array.from(
        { length: 3 },
        (_, index) => `${"X".repeat(200)}${index} -> a$${index}:`,
      ),
      "Later -> b:",
    ].join("\n"),
  );
  const queries = ["a", "a$0", "a$1", "a$2", "b", "missing"].map(
    (raw_name) =>
      ({ kind: "class", name: `display.${raw_name}`, raw_name }) as const,
  );
  const complete = projectAndroidMapping(mapping, queries);
  expect(complete.coverage).toEqual({
    symbols: 6,
    mapped: 5,
    ambiguous: 0,
    unmapped: 1,
  });
  const limited = projectAndroidMapping(mapping, queries, 700);
  expect(limited.coverage).toEqual({
    symbols: 6,
    mapped: 2,
    ambiguous: 0,
    unmapped: 1,
    unknown: 3,
  });
  expect(
    limited.symbols.map(({ resolution: _resolution, ...observed }) => observed),
  ).toEqual(queries);
  expect(
    limited.symbols.slice(1, 4).map((symbol) => symbol.resolution),
  ).toEqual(
    Array.from({ length: 3 }, () => ({
      status: "unknown",
      reason: "projection-budget",
    })),
  );
  expect(limited.symbols[4]?.resolution).toMatchObject({
    status: "mapped",
    mapped: { name: "Later" },
  });
  expect(limited.symbols[5]?.resolution).toEqual({ status: "unmapped" });
  expect(limited.file).toEqual(mapping.file);
});

it("admits bounded ambiguous samples as one claim without relabelling omitted claims as unmapped", () => {
  const mapping = source(
    `First${"X".repeat(200)} -> a:\nSecond${"X".repeat(200)} -> a:\n`,
  );
  const queries = [{ kind: "class", name: "a", raw_name: "a" }] as const;
  expect(
    projectAndroidMapping(mapping, queries).symbols[0]?.resolution,
  ).toMatchObject({ status: "ambiguous", candidate_count: 2 });
  expect(projectAndroidMapping(mapping, queries, 700)).toMatchObject({
    coverage: { symbols: 1, mapped: 0, ambiguous: 0, unmapped: 0, unknown: 1 },
    symbols: [
      {
        kind: "class",
        raw_name: "a",
        resolution: { status: "unknown", reason: "projection-budget" },
      },
    ],
  });
});

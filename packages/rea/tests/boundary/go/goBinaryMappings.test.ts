import { expect, it } from "vitest";
import { mappedFileOffset } from "../../../src/native/metadata/BinaryContainer.js";

const selected = { address: 100n, offset: 16, size: 64 };

it.each([
  { address: 132n, offset: 4, size: 4 },
  { address: 112n, offset: 4, size: 12 },
])(
  "rejects a contradictory alias overlapping only part of the selected bytes",
  (alias) => {
    expect(() => mappedFileOffset([selected, alias], 120n, 24)).toThrowError(
      /ambiguous/i,
    );
  },
);

it("accepts overlapping aliases that identify exactly the same file bytes", () => {
  expect(
    mappedFileOffset(
      [selected, { address: 132n, offset: 48, size: 4 }],
      120n,
      24,
    ),
  ).toBe(36);
});

it("does not confuse adjacent mappings with overlapping byte spans", () => {
  const adjacent = { address: 164n, offset: 80, size: 32 };
  expect(mappedFileOffset([selected, adjacent], 140n, 24)).toBe(56);
  expect(mappedFileOffset([selected, adjacent], 164n, 0)).toBe(80);
});

it("maps a split span across unsorted adjacent and agreeing overlapping ranges", () => {
  expect(
    mappedFileOffset(
      [
        { address: 164n, offset: 80, size: 32 },
        { address: 156n, offset: 72, size: 12 },
        selected,
      ],
      156n,
      24,
    ),
  ).toBe(72);
});

it.each([
  { address: 165n, offset: 81, size: 32 }, // One virtual byte is unbacked.
  { address: 164n, offset: 96, size: 32 }, // Virtual adjacency, different file translation.
])(
  "refuses a split span with a gap or discontinuous file bytes",
  (adjacent) => {
    expect(() => mappedFileOffset([selected, adjacent], 156n, 24)).toThrowError(
      /mapped|ambiguous/i,
    );
  },
);

it("checks aliases and zero-fill inside the later part of a split span", () => {
  const adjacent = { address: 164n, offset: 80, size: 32 };
  expect(() =>
    mappedFileOffset(
      [selected, adjacent, { address: 170n, offset: 4, size: 4 }],
      156n,
      24,
    ),
  ).toThrowError(/ambiguous/i);
  expect(() =>
    mappedFileOffset([selected, adjacent], 156n, 24, [
      { address: 170n, size: 4n },
    ]),
  ).toThrowError(/ambiguous/i);
});

it("keeps ambiguous zero-length endpoints invalid", () => {
  expect(() =>
    mappedFileOffset(
      [selected, { address: 164n, offset: 96, size: 32 }],
      164n,
      0,
    ),
  ).toThrowError(/ambiguous/i);
});

it.each([
  { address: 132n, size: 4n },
  { address: 112n, size: 12n },
])(
  "rejects zero-fill aliases overlapping part of file-backed bytes",
  (zeroFill) => {
    expect(() =>
      mappedFileOffset([selected], 120n, 24, [zeroFill]),
    ).toThrowError(/ambiguous/i);
  },
);

it("keeps adjacent zero-filled memory outside the selected file span", () => {
  expect(
    mappedFileOffset([selected], 140n, 24, [{ address: 164n, size: 32n }]),
  ).toBe(56);
});

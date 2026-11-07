import { expect, it } from "vitest";
import {
  computeBlockEntropy,
  inspectByteEntropyInputSchema,
  mergeEntropyRuns,
} from "./byteEntropy.js";

it("computes known Shannon answers including partial and empty blocks", () => {
  expect(computeBlockEntropy(new Uint8Array(4096))).toBe(0);
  expect(
    computeBlockEntropy(Uint8Array.from({ length: 256 }, (_, i) => i)),
  ).toBe(8);
  expect(computeBlockEntropy(Uint8Array.of(0, 1))).toBe(1);
  expect(computeBlockEntropy(Uint8Array.of(0, 0, 0, 1))).toBe(0.8113);
  expect(computeBlockEntropy(new Uint8Array())).toBe(0);
});

it("merges adjacent threshold edges but not unclassified blocks or gaps", () => {
  expect(
    mergeEntropyRuns(
      [
        { offset: 7, length: 256, entropy: 1 },
        { offset: 263, length: 256, entropy: 0 },
        { offset: 519, length: 256, entropy: 7.2 },
        { offset: 775, length: 256, entropy: 7.1999 },
        { offset: 1031, length: 256, entropy: 8 },
        { offset: 1400, length: 2, entropy: 8 },
      ],
      { high: 7.2, low: 1 },
    ),
  ).toEqual([
    { offset: 7, length: 512, classification: "low" },
    { offset: 519, length: 256, classification: "high" },
    { offset: 1031, length: 256, classification: "high" },
    { offset: 1400, length: 2, classification: "high" },
  ]);
});

it("rejects unsafe windows, unknown fields and unsupported block sizes", () => {
  for (const options of [
    { block_size: 257 },
    { block_size: 128 },
    { block_size: 131072 },
    { offset: -1 },
    { length: Number.MAX_SAFE_INTEGER + 1 },
    { extra: true },
  ]) {
    expect(
      inspectByteEntropyInputSchema.safeParse({ path: "/file", ...options })
        .success,
    ).toBe(false);
  }
});

import { expect, it } from "vitest";
import { decodeLz4Block } from "./Lz4Block.js";
it("decodes overlapping matches by repeating the newly produced pattern", async () => {
  // The initial match is the same overlap shape observed in nvcc 12.9 speed-mode PTX.
  const input = Buffer.from("3c0a2f2f0300504142434445", "hex");
  expect((await decodeLz4Block(input, 24)).toString()).toBe(
    "\n//".repeat(6) + "\nABCDE",
  );
});
it.each(["10000000", "10000100", "f0ff", "f001", "00"])(
  "rejects malformed or mismatched block %s",
  async (hex) => {
    await expect(decodeLz4Block(Buffer.from(hex, "hex"), 8)).rejects.toThrow();
  },
);
it("preserves caller cancellation before allocation work continues", async () => {
  const signal = AbortSignal.abort("caller stopped");
  await expect(
    decodeLz4Block(Buffer.from("10aa", "hex"), 1, signal),
  ).rejects.toMatchObject({ reason: "cancelled" });
});

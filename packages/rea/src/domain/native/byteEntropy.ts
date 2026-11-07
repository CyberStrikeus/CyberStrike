import { z } from "zod";
import { localPathStringSchema } from "../localPath.js";

const offsetSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const entropySchema = z.number().min(0).max(8);

/** Select blocks relative to an explicit byte window; identity remains file-wide. */
export const inspectByteEntropyInputSchema = z.strictObject({
  path: localPathStringSchema,
  block_size: z
    .number()
    .int()
    .min(256)
    .max(65536)
    .refine(
      (value) => (value & (value - 1)) === 0,
      "Block size must be a power of two.",
    )
    .default(4096),
  offset: offsetSchema.default(0),
  length: offsetSchema.optional(),
});
const blockSchema = z.strictObject({
  offset: offsetSchema,
  length: offsetSchema,
  entropy: entropySchema,
});
const runSchema = z.strictObject({
  offset: offsetSchema,
  length: offsetSchema,
  classification: z.enum(["high", "low"]),
});
export const byteEntropySchema = z.strictObject({
  artifact: z.strictObject({
    path: z.string(),
    bytes: offsetSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  block_size: z.number().int().min(256).max(65536),
  window: z.strictObject({ offset: offsetSchema, length: offsetSchema }),
  file_entropy: entropySchema,
  thresholds: z.strictObject({ high: entropySchema, low: entropySchema }),
  blocks: z.array(blockSchema),
  runs: z.array(runSchema),
  limitations: z.array(z.string()),
});
export type ByteEntropy = z.infer<typeof byteEntropySchema>;

/** Shannon entropy in bits per byte, rounded once at the reporting boundary. */
export const entropyFromCounts = (
  counts: ArrayLike<number>,
  length: number,
): number => {
  if (length === 0) return 0;
  let entropy = 0;
  for (let i = 0; i < counts.length; i++) {
    const count = counts[i] ?? 0;
    if (count > 0) {
      const probability = count / length;
      entropy -= probability * Math.log2(probability);
    }
  }
  return Math.round(entropy * 10000) / 10000;
};

export const computeBlockEntropy = (bytes: Uint8Array): number => {
  const counts = new Float64Array(256);
  for (const byte of bytes) counts[byte] = (counts[byte] ?? 0) + 1;
  return entropyFromCounts(counts, bytes.length);
};

/** Merge only adjacent classified blocks, using the reported rounded entropy. */
export const mergeEntropyRuns = (
  blocks: readonly ByteEntropy["blocks"][number][],
  thresholds: ByteEntropy["thresholds"],
): ByteEntropy["runs"] => {
  const runs: ByteEntropy["runs"] = [];
  for (const block of blocks) {
    const classification =
      block.entropy >= thresholds.high
        ? "high"
        : block.entropy <= thresholds.low
          ? "low"
          : null;
    if (classification === null || block.length === 0) continue;
    const previous = runs.at(-1);
    if (
      previous?.classification === classification &&
      previous.offset + previous.length === block.offset
    )
      previous.length += block.length;
    else
      runs.push({ offset: block.offset, length: block.length, classification });
  }
  return runs;
};

import { z } from "zod";
import { fixedTupleSchema } from "../fixedTupleSchema.js";

const swiftStringLiteralFields = {
  source_address: z
    .string()
    .describe(
      "Instruction that consumes both words: a call, tail call, return, or paired store.",
    ),
  value: z
    .string()
    .describe("Decoded UTF-8 text, including the canonical empty string."),
  registers: fixedTupleSchema([z.string(), z.string()]),
  words: fixedTupleSchema([z.string(), z.string()]).describe(
    "Observed constant register values, in register order.",
  ),
};

/** A Swift String literal decoded from the two words of its ABI value, not a data reference. */
export const swiftSmallStringLiteralSchema = z.strictObject({
  ...swiftStringLiteralFields,
  representation: z
    .literal("small")
    .describe("The UTF-8 bytes are inside the two words."),
  address: z.null().describe("A small literal has no storage of its own."),
});
export const swiftLargeStringLiteralSchema = z.strictObject({
  ...swiftStringLiteralFields,
  representation: z
    .literal("large")
    .describe(
      "An immortal literal whose words hold its count and a pointer to its bytes.",
    ),
  address: z.string().describe("Address of a large literal's bytes."),
});
export const swiftStringLiteralSchema = z.discriminatedUnion("representation", [
  swiftSmallStringLiteralSchema,
  swiftLargeStringLiteralSchema,
]);

const swiftStringLiteralOmissionFields = {
  source_address: swiftStringLiteralFields.source_address,
  byte_length: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  reason: z
    .enum(["capacity", "unresolved_jump"])
    .describe(
      "Why this candidate is omitted: capacity stopped decoding, or an unresolved jump left its use unknown.",
    ),
  registers: swiftStringLiteralFields.registers,
  words: swiftStringLiteralFields.words,
};

/** A Swift literal candidate omitted because decoding capacity or control flow left it unknown. */
export const swiftSmallStringLiteralOmissionSchema = z.strictObject({
  ...swiftStringLiteralOmissionFields,
  representation: z.literal("small"),
  address: z.null(),
});
export const swiftLargeStringLiteralOmissionSchema = z.strictObject({
  ...swiftStringLiteralOmissionFields,
  representation: z.literal("large"),
  address: z.string().describe("Address of the literal's bytes."),
});
export const swiftStringLiteralOmissionSchema = z.discriminatedUnion(
  "representation",
  [
    swiftSmallStringLiteralOmissionSchema,
    swiftLargeStringLiteralOmissionSchema,
  ],
);

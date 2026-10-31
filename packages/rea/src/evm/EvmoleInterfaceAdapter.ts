import { z } from "zod";
import type { EvmInterface } from "../domain/evm/evmInterface.js";

const offset = z.int().nonnegative();
const reportedMetadata = z.strictObject({
  bytecodeOffset: offset,
  cborLength: offset,
  entries: z.array(
    z.strictObject({
      key: z.string(),
      value: z.discriminatedUnion("type", [
        z.strictObject({ type: z.literal("string"), value: z.string() }),
        z.strictObject({
          type: z.literal("integer"),
          // Reported integers can exceed the safe range; fractions still violate the tag.
          value: z.number().refine(Number.isInteger, "Expected an integer"),
        }),
        z.strictObject({ type: z.literal("bytes"), value: z.string() }),
        z.strictObject({ type: z.literal("bool"), value: z.boolean() }),
        z.strictObject({ type: z.literal("undecoded"), value: z.string() }),
      ]),
    }),
  ),
});
/** Parse the exact producer representation before assigning portable field names. */
export const evmoleInterfaceReplySchema = z.strictObject({
  // The unchanged JS binding exposes disabled facets as own undefined keys.
  // Their JSON transport representation is absence; actual facet values are
  // outside this interface-only profile and must still fail validation.
  storage: z.undefined().optional(),
  transientStorage: z.undefined().optional(),
  disassembled: z.undefined().optional(),
  basicBlocks: z.undefined().optional(),
  controlFlowGraph: z.undefined().optional(),
  // Upstream also extracts metadata when selectors are requested, regardless
  // of its metadata flag. Retain its reported values without precision claims.
  metadata: reportedMetadata.optional(),
  functions: z
    .array(
      z.strictObject({
        selector: z.string().regex(/^[a-f0-9]{8}$/),
        bytecodeOffset: offset,
        dispatch: z.enum(["abi", "fallback"]),
        arguments: z.string().optional(),
        stateMutability: z.string().optional(),
      }),
    )
    .optional(),
});

/** Preserve inference strings and unknown absence; selectors use the conventional 0x display prefix. */
export const projectEvmoleFunctions = (
  producer: z.output<typeof evmoleInterfaceReplySchema>,
): EvmInterface["functions"] =>
  (producer.functions ?? []).map((fn) => ({
    selector: `0x${fn.selector}`,
    bytecode_offset: fn.bytecodeOffset,
    dispatch: fn.dispatch,
    inferred_arguments: fn.arguments ?? null,
    inferred_state_mutability: fn.stateMutability ?? null,
  }));

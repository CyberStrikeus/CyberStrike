import { z } from "zod";

/** A decompiler p-code varnode location or literal value. */
export const nativeVarnodeSchema = z.strictObject({
  kind: z.enum(["constant", "address", "register", "unique", "other"]),
  size_bytes: z.int().nonnegative(),
  location: z.string().nullable(),
  constant_hex: z
    .string()
    .regex(/^[0-9a-f]+$/u)
    .nullable(),
});

/** One high-p-code operation recovered for a single function. */
export const nativePcodeOperationSchema = z.strictObject({
  id: z.string().min(1),
  address: z.string().min(1),
  sequence: z.int().nonnegative(),
  opcode: z.string().min(1),
  is_dead: z.boolean(),
  block_membership: z.enum(["member", "detached", "unavailable"]),
  inputs: z.array(nativeVarnodeSchema),
  output: nativeVarnodeSchema.nullable(),
});

/** A def-use relation between operations in one recovered HighFunction. */
export const nativePcodeDefUseSchema = z.strictObject({
  definition: z.string().min(1),
  use: z.string().min(1),
  input_index: z.int().nonnegative(),
});

/** Memory and branch operations as directly named by Ghidra p-code. */
export const nativePcodeEffectSchema = z.strictObject({
  operation: z.string().min(1),
  kind: z.enum([
    "memory_read",
    "memory_write",
    "conditional_branch",
    "indirect_branch",
    "direct_call",
    "indirect_call",
  ]),
  operand_input: z.int().nonnegative().nullable(),
  value_input: z.int().nonnegative().nullable(),
});

/** Bounded data-flow observations; STORE is not necessarily a persistent/global write. */
export const availableNativeValueFlowSchema = z.strictObject({
  available: z.literal(true),
  provenance: z.literal("ghidra-high-pcode"),
  operations: z.array(nativePcodeOperationSchema),
  def_use: z.array(nativePcodeDefUseSchema),
  effects: z.array(nativePcodeEffectSchema),
  parameters: z.array(
    z.strictObject({
      ordinal: z.int().nonnegative(),
      name: z.string(),
      data_type: z.string(),
    }),
  ),
  parameter_uses: z.array(
    z.strictObject({
      ordinal: z.int().nonnegative(),
      use: z.string(),
      input_index: z.int().nonnegative(),
    }),
  ),
  truncated: z.boolean(),
  omitted_operations_lower_bound: z.int().nonnegative(),
  known_omitted_inputs: z.int().nonnegative(),
  known_omitted_edges: z.int().nonnegative(),
  limitations: z.array(z.string().min(1)),
});
export const unavailableNativeValueFlowSchema = z.strictObject({
  available: z.literal(false),
  reason: z.string().min(1),
  limitations: z.array(z.string().min(1)),
});
export const nativeValueFlowSchema = z.discriminatedUnion("available", [
  availableNativeValueFlowSchema,
  unavailableNativeValueFlowSchema,
]);

/** Lightweight retained metadata; historical records may omit newer omission counts.
 * Strip full flow collections without parsing or copying them. An empty recorded
 * unavailable reason remains source evidence even though new producers forbid it.
 */
export const nativeValueFlowMetadataSchema = z.union([
  availableNativeValueFlowSchema
    .pick({
      available: true,
      truncated: true,
      omitted_operations_lower_bound: true,
      known_omitted_inputs: true,
      known_omitted_edges: true,
    })
    .partial({
      omitted_operations_lower_bound: true,
      known_omitted_inputs: true,
      known_omitted_edges: true,
    })
    .strip(),
  unavailableNativeValueFlowSchema
    .pick({ available: true, reason: true })
    .extend({ reason: z.string() })
    .strip(),
]);

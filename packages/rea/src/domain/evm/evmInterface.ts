import { z } from "zod";

import { absoluteLocalPathStringSchema } from "../localPath.js";
import { solidityMetadataSchema } from "./solidityMetadata.js";

const byteOffset = z.int().nonnegative();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
/** Owned EVMole worker deadline. Omission keeps this value. */
export const DEFAULT_EVM_TIMEOUT_MS = 30_000;
/** Largest delay supported without overflowing Node timers. */
export const MAX_EVM_TIMEOUT_MS = 2_147_483_647;

/** Select the carrier representation explicitly; no RPC or deployed-contract lookup is implied. */
export const inspectEvmInterfaceInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema.describe(
    "Absolute path to caller-selected local bytecode carrier",
  ),
  encoding: z
    .enum(["raw", "hex"])
    .describe(
      "Raw bytes or UTF-8 hex with optional 0x prefix and outer ASCII whitespace",
    ),
  timeout_ms: z
    .number()
    .int()
    .min(1)
    .max(MAX_EVM_TIMEOUT_MS)
    .optional()
    .describe(
      `Deadline in milliseconds for the owned EVMole worker command (default ${String(DEFAULT_EVM_TIMEOUT_MS)}), not carrier acquisition or final reply reads. An integer from 1 to ${String(MAX_EVM_TIMEOUT_MS)} applies on the next call. Fixed input, reply, diagnostic, address-space, and CPU allowances stay unchanged.`,
    ),
});

/** Recovered interface candidates are inferences, independently of observed byte identity. */
export const evmInterfaceSchema = z
  .strictObject({
    artifact: z.strictObject({
      path: z.string().min(1),
      sha256,
      bytes: byteOffset,
      encoding: z.enum(["raw", "hex"]),
    }),
    bytecode: z.strictObject({
      sha256,
      bytes: byteOffset,
      hex: z.string().regex(/^(?:[0-9a-f]{2})*$/),
      digest_algorithm: z.literal("sha256"),
      kind: z.literal("unknown"),
      deployment_authenticity: z.literal("unknown"),
      hardfork: z.literal("unknown"),
      metadata: solidityMetadataSchema.nullable().default(null),
    }),
    evidence_kind: z.literal("inferred"),
    functions: z.array(
      z.strictObject({
        selector: z.string().regex(/^0x[0-9a-f]{8}$/),
        bytecode_offset: byteOffset,
        dispatch: z.enum(["abi", "fallback"]),
        inferred_arguments: z.string().nullable(),
        inferred_state_mutability: z.string().nullable(),
      }),
    ),
    discovery_completeness: z.literal("unknown"),
    runtime_execution: z.literal("not-performed"),
    diagnostics: z.strictObject({
      stdout: z.string(),
      stderr: z.string(),
      truncated: z.boolean(),
    }),
    limitations: z.array(z.string()),
  })
  .superRefine((value, context) => {
    if (value.bytecode.hex.length !== value.bytecode.bytes * 2)
      context.addIssue({
        code: "custom",
        path: ["bytecode"],
        message:
          "Selected byte count does not match the bytecode hex representation.",
      });
    const metadata = value.bytecode.metadata;
    if (
      metadata !== null &&
      metadata.status !== "unavailable" &&
      (metadata.bytecode_offset === null ||
        metadata.cbor_bytes === null ||
        metadata.bytecode_offset + metadata.cbor_bytes + 2 !==
          value.bytecode.bytes ||
        metadata.cbor_bytes !==
          Number.parseInt(value.bytecode.hex.slice(-4), 16))
    )
      context.addIssue({
        code: "custom",
        path: ["bytecode", "metadata"],
        message:
          "Metadata range must match the terminal length suffix in selected bytecode.",
      });
    for (const [index, fn] of value.functions.entries())
      if (fn.bytecode_offset >= value.bytecode.bytes)
        context.addIssue({
          code: "custom",
          path: ["functions", index, "bytecode_offset"],
          message: "Inferred body offset lies outside the selected bytecode.",
        });
  });

export type InspectEvmInterfaceInput = z.infer<
  typeof inspectEvmInterfaceInputSchema
>;
export type EvmInterface = z.infer<typeof evmInterfaceSchema>;

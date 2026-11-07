import { z } from "zod";

/** Exact code or data location within the active analysis program. */
export const nativeInstructionInputSchema = z.strictObject({
  address: z.string().min(1),
  document: z.string().optional(),
});
const reference = z.strictObject({
  target_address: z.string(),
  type: z.string(),
  call: z.boolean(),
  jump: z.boolean(),
  indirect: z.boolean(),
  computed: z.boolean(),
  operand_index: z.int(),
  source_address: z.string().min(1).nullable().optional(),
  data: z.boolean().nullable().optional(),
  read: z.boolean().nullable().optional(),
  write: z.boolean().nullable().optional(),
  primary: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "Provider primary-reference status, not proof of literal addressing or a runtime access. Null or omission means unavailable.",
    ),
  provenance: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe(
      "Provider subsystem reporting this reference; null or omission means unavailable.",
    ),
  source: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe(
      "Provider reference origin, such as analysis, default, imported or user_defined; null or omission means unavailable.",
    ),
});
/** Provider-decoded facts for one instruction; operand tokens preserve their native ordering. */
export const nativeInstructionSchema = z.strictObject({
  address: z.string(),
  status: z
    .enum([
      "decoded",
      "not-instruction-boundary",
      "data",
      "not-in-listing",
      "undecodable",
      "outside-memory",
    ])
    .describe(
      "decoded is an instruction at the address; not-instruction-boundary is inside a listed instruction; data is defined data; outside-memory is outside the program's memory. Ghidra's not-in-listing means the address is in memory with no listed instruction or defined data; no decode was attempted, and memory may be uninitialized. The legacy undecodable value in older Evidence has the same ambiguous meaning and does not prove decoding failed.",
    ),
  procedure: z.string().nullable(),
  architecture: z.string(),
  mode: z
    .string()
    .describe(
      "Provider-reported mode label. Per-address decoder context, when available, is reported separately; a program-wide label does not establish runtime encoding mode.",
    ),
  decoder_context: z
    .array(
      z.strictObject({
        register: z.string().min(1),
        value: z.string().min(1).nullable(),
        source: z.string().min(1),
      }),
    )
    .optional()
    .describe(
      "Observed per-address decoder context. Null means no value was available; omission means the provider or older capture does not expose this facet. The separate mode field retains the program language variant.",
    ),
  bytes: z.string().nullable(),
  length: z.int().positive().nullable(),
  mnemonic: z.string().nullable(),
  raw_disassembly: z.string().nullable(),
  operands: z.array(
    z.strictObject({
      index: z.int().nonnegative(),
      raw: z.string(),
      provider_type: z.int(),
      components: z.array(
        z.strictObject({
          kind: z.enum(["register", "immediate", "address", "unknown"]),
          text: z.string(),
          value: z.string().nullable(),
          bit_width: z.int().nonnegative().nullable(),
        }),
      ),
      memory_addressing: z.literal("unavailable"),
    }),
  ),
  flow: z.strictObject({
    kind: z.enum([
      "call",
      "jump",
      "return",
      "fallthrough",
      "terminal",
      "unavailable",
    ]),
    conditional: z.boolean(),
    computed: z.boolean(),
    direct_destinations: z.array(z.string()),
    classification_evidence: z
      .array(
        z.strictObject({
          source: z.string().min(1),
          value: z.string().min(1),
        }),
      )
      .optional()
      .describe(
        "Observed provider facts used to classify flow; older captures or other providers may omit them.",
      ),
  }),
  references: z.array(reference),
  incoming_references: z
    .array(reference)
    .nullable()
    .optional()
    .describe(
      "Static references to this exact code or data address, excluding synthetic entry-point references. An empty array means the provider examined the address and found none; null or omission means unavailable. Analyzer references do not prove literal addressing or runtime access.",
    ),
  limitations: z.array(z.string()),
});

/** Static target resolution preserves provider references as evidence, never runtime certainty. */
export const nativeCallTargetsSchema = z.strictObject({
  call_site: z.string(),
  procedure: z.string().nullable(),
  status: z.enum([
    "direct",
    "resolved-indirect",
    "ambiguous",
    "unresolved",
    "not-call",
    "unavailable",
  ]),
  mechanism: z.enum(["direct", "computed", "indirect", "unavailable"]),
  targets: z.array(
    z.strictObject({
      address: z.string(),
      procedure: z.string().nullable(),
      status: z.enum(["direct", "resolved-indirect", "candidate"]),
      basis: z.literal("provider-reference"),
      references: z.array(reference),
    }),
  ),
  limitations: z.array(z.string()),
});

import { z } from "zod";
import { commandEvidenceDetailSchema } from "./commandObservation.js";
import { localPathStringSchema } from "./localPath.js";

/** Omitted one-shot objdump/rizin wall clock. Preflight shares it; the command gets it again. */
export const DEFAULT_REVERSE_COMMAND_TIMEOUT_MS = 120_000;
/** Node timer ceiling. Larger deadlines would be clamped instead of honored. */
export const MAX_REVERSE_COMMAND_TIMEOUT_MS = 2_147_483_647;

/** Per-call deadline for one-shot objdump and rizin commands. */
export const reverseCommandTimeoutSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_REVERSE_COMMAND_TIMEOUT_MS)
  .exactOptional()
  .describe(
    "Wall-clock budget in milliseconds. Target preflight shares one budget across stat and digest, and the one-shot command receives that budget again (default 120000 each). Omitted means 120000. Applies on the next call. Does not raise the 16 MiB combined output cap, Ghidra or Hopper startup deadlines, or debugger session deadlines.",
  );

const commandTimeoutMsField = {
  command_timeout_ms: reverseCommandTimeoutSchema,
};

export const OBJDUMP_ARTIFACT_OPERATIONS = [
  "file_headers",
  "section_headers",
  "symbols",
  "relocations",
  "dwarf",
  "disassemble",
  "disassemble_all",
] as const;

const objdumpArtifactInputSchema = z
  .object({
    path: localPathStringSchema,
    operation: z.enum(OBJDUMP_ARTIFACT_OPERATIONS).exclude(["disassemble"]),
    follow_debug_links: z.boolean().default(false),
    ...commandTimeoutMsField,
  })
  .strict();

const objdumpDisassemblyInputSchema = objdumpArtifactInputSchema.extend({
  operation: z.literal("disassemble"),
  symbol: z
    .string()
    .min(1)
    .regex(/^[^\x00]*$/u)
    // Keep UTF-16 checks out of patterns consumed by scalar Unicode engines.
    .refine(
      (symbol) => !/[\uD800-\uDFFF]/u.test(symbol),
      "Symbol must be well-formed Unicode.",
    )
    .describe(
      "Native symbol to disassemble, expressed as well-formed Unicode. Matching and symbol boundaries follow GNU objdump; omitted means all code sections.",
    )
    .optional(),
});

const objdumpArchitecturesInputSchema = z.strictObject({
  operation: z.literal("architectures"),
  ...commandTimeoutMsField,
});

/** Caller-selected native selection and independent Evidence delivery. */
export const objdumpInputSchema = z.discriminatedUnion("operation", [
  objdumpArtifactInputSchema.extend({ detail: commandEvidenceDetailSchema }),
  objdumpDisassemblyInputSchema.extend({ detail: commandEvidenceDetailSchema }),
  objdumpArchitecturesInputSchema.extend({
    detail: commandEvidenceDetailSchema,
  }),
]);

/** Caller-selected Rizin command against one local artifact. */
export const rizinInputSchema = z
  .object({
    path: localPathStringSchema,
    command: z
      .string()
      .min(1)
      .refine(
        (value) => !/[\r\n\u0000]/u.test(value),
        "A single command line is required",
      ),
    ...commandTimeoutMsField,
  })
  .strict();

export type ObjdumpSelection =
  | z.input<typeof objdumpArtifactInputSchema>
  | z.input<typeof objdumpDisassemblyInputSchema>
  | z.input<typeof objdumpArchitecturesInputSchema>;
export type RizinInput = z.output<typeof rizinInputSchema>;

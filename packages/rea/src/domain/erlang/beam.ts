import { z } from "zod";

import { digestSchema } from "../digests.js";
import { absoluteLocalPathStringSchema } from "../localPath.js";

const uint = z.number().int().min(0).max(0xffffffff);
const range = z.strictObject({ offset: uint, bytes: uint });

/** Hard ceiling on the caller-selected input read budget. */
export const MAX_INSPECT_ERLANG_BEAM_FILE_BYTES = 536870912;
/** Hard ceiling on IFF chunks in one BEAM form. */
export const MAX_INSPECT_ERLANG_BEAM_CHUNKS = 256;
/** Hard ceiling on decoded atom-table entries. */
export const MAX_INSPECT_ERLANG_BEAM_ATOMS = 65536;
/** Hard ceiling on export, import, and lambda rows combined. */
export const MAX_INSPECT_ERLANG_BEAM_TABLE_ROWS = 65536;

/** Complete bounded inspection of one Erlang BEAM IFF container. */
export const inspectErlangBeamInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema.describe(
    "Absolute filesystem path to a BEAM file",
  ),
  max_file_bytes: z
    .number()
    .int()
    .min(16)
    .max(MAX_INSPECT_ERLANG_BEAM_FILE_BYTES)
    .default(67108864)
    .describe("Maximum stable artifact bytes to read (default 64 MiB)"),
  max_chunks: z
    .number()
    .int()
    .min(1)
    .max(MAX_INSPECT_ERLANG_BEAM_CHUNKS)
    .default(64)
    .describe(
      "Maximum IFF chunks to examine; exceeding the budget fails without partial success",
    ),
  max_atoms: z
    .number()
    .int()
    .min(1)
    .max(MAX_INSPECT_ERLANG_BEAM_ATOMS)
    .default(4096)
    .describe(
      "Maximum atom-table entries to decode; exceeding the budget fails without partial success",
    ),
});

const atomSchema = z.strictObject({
  index: uint,
  name: z.string(),
});

const exportSchema = z.strictObject({
  function_index: uint,
  function: z.string().nullable(),
  arity: uint,
  label: uint,
});

const importSchema = z.strictObject({
  module_index: uint,
  module: z.string().nullable(),
  function_index: uint,
  function: z.string().nullable(),
  arity: uint,
});

const lambdaSchema = z.strictObject({
  function_index: uint,
  function: z.string().nullable(),
  arity: uint,
  label: uint,
  index: uint,
  free_vars: uint,
  old_unique: uint,
});

const chunkSchema = z.strictObject({
  index: uint,
  name: z.string().length(4),
  location: range,
  payload: z.strictObject({
    location: range,
    bytes: uint,
    sha256: digestSchema,
  }),
});

/** Observed BEAM IFF form; missing optional tables stay null rather than empty-everywhere. */
export const erlangBeamSchema = z.strictObject({
  artifact: z.strictObject({
    path: z.string().min(1),
    sha256: digestSchema,
    bytes: uint,
  }),
  form: z.strictObject({
    location: range,
    size: uint,
  }),
  chunks: z.array(chunkSchema),
  atoms: z.array(atomSchema).nullable(),
  atom_encoding: z.enum(["latin1", "utf8"]).nullable(),
  exports: z.array(exportSchema).nullable(),
  imports: z.array(importSchema).nullable(),
  lambdas: z.array(lambdaSchema).nullable(),
  code: z
    .strictObject({
      instruction_set: uint,
      opcode_max: uint,
      labels: uint,
      functions: uint,
      extra_header_bytes: uint,
      instructions: range,
    })
    .nullable(),
  module: z.string().nullable(),
  coverage: z.strictObject({
    status: z.literal("complete"),
    examined_chunks: uint,
    atoms: uint,
  }),
  limitations: z.array(z.string()),
});

export type ErlangBeam = z.infer<typeof erlangBeamSchema>;
export type InspectErlangBeamInput = z.infer<
  typeof inspectErlangBeamInputSchema
>;

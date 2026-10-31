import { z } from "zod";
import { nativeSymbolMetadataSchema } from "./nativeSymbol.js";
import { functionBodySchema, functionBodyEntryAgrees } from "./functionBody.js";

export const procedureClassificationSchema = z
  .object({
    external: z.boolean(),
    thunk: z.boolean(),
    thunk_target: z.string().nullable(),
    provenance: z.string().min(1),
  })
  .strict();
export const procedureIdentitySchema = z
  .object({
    address: z.string(),
    name: z.string(),
    symbol: nativeSymbolMetadataSchema.nullable().exactOptional(),
    classification: procedureClassificationSchema.nullable(),
    body: functionBodySchema,
  })
  .strict()
  .superRefine((identity, context) => {
    if (!functionBodyEntryAgrees(identity.body, identity.address))
      context.addIssue({
        code: "custom",
        message:
          "Function body entry membership disagrees with procedure identity",
      });
  });
export const localVariableSchema = z
  .object({
    description: z.string(),
    provenance: z.string().min(1),
    name: z.string().nullable().exactOptional(),
    stack_displacement: z
      .string()
      .regex(/^-?\d+$/u)
      .nullable()
      .exactOptional()
      .describe(
        "Observed signed stack byte displacement, encoded as decimal to preserve precision.",
      ),
  })
  .strict();
/** Provider-neutral procedure metadata, including exact body ranges. */
export const procedureInfoSchema = z.object({
  name: z.string(),
  symbol: nativeSymbolMetadataSchema.nullable().exactOptional(),
  entrypoint: z.string(),
  basicblock_count: z.number().int().min(0),
  length: z.number().min(0),
  signature: z.string().nullable(),
  locals: z.array(localVariableSchema),
  classification: procedureClassificationSchema.nullable(),
  body: functionBodySchema,
});

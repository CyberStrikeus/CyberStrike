import { z } from "zod";
import { functionDossierSchema } from "../native/functionDossier.js";

/** One explicit function's analyst-authored metadata changes. */
export const nativeFunctionAnnotationsInputSchema = z
  .strictObject({
    procedure: z.string().min(1),
    name: z.string().min(1).optional(),
    comment: z
      .string()
      .optional()
      .describe("Regular entry comment; empty text clears it"),
    inline_comment: z
      .string()
      .optional()
      .describe("Inline entry comment; empty text clears it"),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.comment !== undefined ||
      value.inline_comment !== undefined,
    "Supply at least one annotation change",
  );

/** Readback and refreshed analysis after one atomic metadata edit. */
export const nativeFunctionAnnotationsSchema = z
  .strictObject({
    annotations: z.strictObject({
      address: z.string().min(1),
      name: z.string().min(1),
      comment: z.string().nullable(),
      inline_comment: z.string().nullable(),
    }),
    dossier: functionDossierSchema,
    effects: z.strictObject({
      scope: z.literal("session-analysis-database"),
      source_bytes_modified: z.literal(false),
      persists_after_close: z.literal(false),
    }),
  })
  .superRefine((value, context) => {
    if (
      value.annotations.address !== value.dossier.procedure.address ||
      value.annotations.name !== value.dossier.procedure.name
    )
      context.addIssue({
        code: "custom",
        message:
          "Annotation readback disagrees with refreshed function identity",
      });
  });

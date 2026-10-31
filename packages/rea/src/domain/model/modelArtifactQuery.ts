import { z } from "zod";
import { absoluteLocalPathStringSchema } from "../localPath.js";
import {
  modelArtifactObjectSchema,
  modelMetadataSchema,
  modelTensorSchema,
} from "./modelArtifact.js";

export const modelTypeRowSchema =
  modelArtifactObjectSchema.shape.totals.shape.by_type.element.extend({
    index: z.number().int().nonnegative(),
  });

const page = {
  indices: z.array(z.number().int().nonnegative()).optional(),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().default(32),
};
const tensorSelectionSchema = z.strictObject({
  ...page,
  collection: z.literal("tensors"),
  names: z.array(z.string()).optional(),
  storage_validation: z
    .array(modelTensorSchema.shape.storage_validation)
    .optional(),
  types: z.array(z.string()).optional(),
  fields: z.array(modelTensorSchema.keyof()).optional(),
});
const typeSelectionSchema = z.strictObject({
  ...page,
  collection: z.literal("types"),
  types: z.array(z.string()).optional(),
  fields: z.array(modelTypeRowSchema.keyof()).optional(),
});
const metadataSelectionSchema = z.strictObject({
  ...page,
  collection: z.literal("metadata"),
  keys: z.array(z.string()).optional(),
  fields: z.array(modelMetadataSchema.keyof()).optional(),
});

export const modelArtifactSelectionSchema = z.discriminatedUnion("collection", [
  tensorSelectionSchema,
  typeSelectionSchema,
  metadataSelectionSchema,
]);

export const modelArtifactViewRequestSchema = z.discriminatedUnion(
  "collection",
  [
    tensorSelectionSchema.extend({ kind: z.literal("model-artifact") }),
    typeSelectionSchema.extend({ kind: z.literal("model-artifact") }),
    metadataSelectionSchema.extend({ kind: z.literal("model-artifact") }),
  ],
);

/** Selection changes delivery; full observations remain retained. */
export const inspectModelArtifactInputSchema = z
  .strictObject({
    path: absoluteLocalPathStringSchema,
    hash: z
      .enum(["header", "full"])
      .default("header")
      .describe(
        "header reads declarations only; full streams all bytes for SHA-256",
      ),
    detail: z.enum(["summary", "complete"]).default("summary"),
    view: modelArtifactSelectionSchema
      .optional()
      .describe(
        "Return this selected page with compact model context, retaining complete Evidence; requires summary detail",
      ),
  })
  .superRefine((value, context) => {
    if (value.view !== undefined && value.detail === "complete")
      context.addIssue({
        code: "custom",
        path: ["view"],
        message:
          "view selects summary delivery; omit view to request complete Evidence",
      });
  });

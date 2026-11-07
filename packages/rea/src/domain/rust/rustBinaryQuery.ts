import { z } from "zod";
import {
  inspectRustBinaryInputSchema,
  rustPackageSchema,
  rustPackageFeaturesSchema,
  rustAuditableMetadataSchema,
} from "./rustBinary.js";

const edgeSchema = rustAuditableMetadataSchema.shape.dependency_edges.element;
const index = z.number().int().nonnegative();
const page = {
  indices: z.array(index).optional(),
  offset: index.default(0),
  limit: z.number().int().positive().default(64),
};
const packages = z.strictObject({
  ...page,
  collection: z.literal("packages"),
  names: z.array(z.string()).optional(),
  versions: z.array(z.string()).optional(),
  fields: z
    .array(rustPackageSchema.keyof())
    .optional()
    .describe(
      "Original index always retained. Default attributes omit dependency vectors; select dependencies explicitly for direct index references.",
    ),
});
const edges = z.strictObject({
  ...page,
  collection: z.literal("edges"),
  from_indices: z.array(index).optional(),
  to_indices: z.array(index).optional(),
  fields: z.array(edgeSchema.keyof()).optional(),
});

/** Filters intersect; empty arrays select none and offsets count matching rows. */
export const rustBinarySelectionSchema = z.discriminatedUnion("collection", [
  packages,
  edges,
]);
export const rustBinaryViewRequestSchema = z.discriminatedUnion("collection", [
  packages.extend({ kind: z.literal("rust") }),
  edges.extend({ kind: z.literal("rust") }),
]);
export const rustBinaryViewPageSchema = z.discriminatedUnion("collection", [
  z.strictObject({
    collection: z.literal("packages"),
    rows: z.array(
      rustPackageSchema.partial().extend({
        features: rustPackageFeaturesSchema.optional(),
        index,
      }),
    ),
  }),
  z.strictObject({
    collection: z.literal("edges"),
    rows: z.array(edgeSchema.partial().extend({ index })),
  }),
]);

/** Delivery choices never enter the file-reader port or change original Evidence identity. */
export const inspectRustBinaryRequestSchema = inspectRustBinaryInputSchema
  .extend({
    detail: z.enum(["complete", "summary"]).optional(),
    view: rustBinarySelectionSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.view !== undefined && value.detail === "complete")
      context.addIssue({
        code: "custom",
        path: ["view"],
        message:
          "view selects compact delivery; omit view for complete Evidence",
      });
  });

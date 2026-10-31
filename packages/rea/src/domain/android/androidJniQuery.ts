import { z } from "zod";
import {
  androidJniBindingSchema,
  androidJniCandidateSchema,
  androidJniDeclarationSchema,
  androidJniLibrarySchema,
} from "./androidJniBindings.js";
import { validateAndroidPackageDelivery } from "./androidPackageQuery.js";
const page = {
  kind: z.literal("android-jni"),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
  indices: z.array(z.int().nonnegative()).optional(),
};
/** Pages reference original parent collection indices, independently of source ordinals. */
export const androidJniViewRequestSchema = z.discriminatedUnion("collection", [
  z.strictObject({
    ...page,
    collection: z.literal("declarations"),
    declaration_ids: z.array(z.string()).optional(),
    descriptors: z
      .array(androidJniDeclarationSchema.shape.descriptor)
      .optional(),
    class_names: z.array(z.string()).optional(),
    method_names: z.array(z.string()).optional(),
    fields: z.array(androidJniDeclarationSchema.keyof()).optional(),
  }),
  z.strictObject({
    ...page,
    collection: z.literal("libraries"),
    library_ids: z.array(z.string()).optional(),
    abis: z.array(z.string()).optional(),
    fields: z.array(androidJniLibrarySchema.keyof()).optional(),
  }),
  z.strictObject({
    ...page,
    collection: z.literal("candidates"),
    candidate_ids: z.array(z.string()).optional(),
    declaration_ids: z.array(z.string()).optional(),
    library_ids: z.array(z.string()).optional(),
    fields: z.array(androidJniCandidateSchema.keyof()).optional(),
  }),
  z.strictObject({
    ...page,
    collection: z.literal("bindings"),
    declaration_ids: z.array(z.string()).optional(),
    abis: z.array(z.string()).optional(),
    statuses: z.array(androidJniBindingSchema.shape.status).optional(),
    fields: z.array(androidJniBindingSchema.keyof()).optional(),
  }),
]);
export const androidJniViewItemsSchema = z.union([
  z.array(
    androidJniDeclarationSchema
      .partial()
      .extend({ row_index: z.int().nonnegative() }),
  ),
  z.array(
    androidJniLibrarySchema
      .partial()
      .extend({ row_index: z.int().nonnegative() }),
  ),
  z.array(
    androidJniCandidateSchema
      .partial()
      .extend({ row_index: z.int().nonnegative() }),
  ),
  z.array(
    androidJniBindingSchema
      .partial()
      .extend({ row_index: z.int().nonnegative() }),
  ),
]);
/** CLI and MCP share the same delivery admission before analysis starts. */
export const androidJniDeliverySchema = z
  .strictObject({
    detail: z.enum(["complete", "summary"]).default("complete"),
    view: androidJniViewRequestSchema.optional(),
  })
  .superRefine(validateAndroidPackageDelivery);

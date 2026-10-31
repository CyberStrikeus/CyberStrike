import { z } from "zod";
import { androidManifestComponentSchema } from "./androidManifestComponents.js";

const componentFilters = {
  kinds: z.array(androidManifestComponentSchema.shape.kind).optional(),
  actions: z
    .array(z.string())
    .optional()
    .describe("Match any exact retained intent action; no substring matching"),
  names: z
    .array(z.string())
    .optional()
    .describe(
      "Exact resolved class names or declared component names; no substring or alias guessing",
    ),
  exported: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "Exact exported declaration; null selects omitted or unresolved declarations. exported_default is separate.",
    ),
};

/** Exact decoded text; positions count UTF-16 code units. */
export const androidManifestViewRequestSchema = z.strictObject({
  kind: z.literal("android"),
  facet: z.literal("manifest"),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive(),
});

export const androidComponentsViewRequestSchema = z.strictObject({
  kind: z.literal("android"),
  facet: z.literal("components"),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
  fields: z.array(androidManifestComponentSchema.keyof()).optional(),
  ...componentFilters,
});

export const androidComponentSummaryViewRequestSchema = z.strictObject({
  kind: z.literal("android"),
  facet: z.literal("component-summary"),
  ...componentFilters,
});

export const androidViewRequestSchema = z.discriminatedUnion("facet", [
  androidManifestViewRequestSchema,
  androidComponentsViewRequestSchema,
  androidComponentSummaryViewRequestSchema,
]);

export const validateAndroidPackageDelivery = (
  value: {
    readonly detail?: "complete" | "summary" | undefined;
    readonly view?: unknown;
  },
  context: z.RefinementCtx,
): void => {
  if (value.view !== undefined && value.detail !== "summary")
    context.addIssue({
      code: "custom",
      path: ["view"],
      message:
        "Android view selection requires detail summary; complete detail preserves the complete source result.",
    });
};

/** Delivery choices never change the provider's analysis request. */
export const androidPackageDeliverySchema = z
  .strictObject({
    detail: z.enum(["complete", "summary"]).default("complete"),
    view: androidViewRequestSchema.optional(),
  })
  .superRefine(validateAndroidPackageDelivery);

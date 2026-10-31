import { z } from "zod";

/** Partial provider classification; it does not establish generic reference flags. */
export const nativeCallClassificationSchema = z.strictObject({
  classification: z.enum(["none", "unknown", "direct", "objective_c"]),
  provider_type: z.number().int(),
  provenance: z.string().min(1),
});

/** Original provider endpoints, before resolving a containing procedure. */
export const nativeCallReferenceSchema = nativeCallClassificationSchema.extend({
  source_address: z.string(),
  target_address: z.string(),
});
export type NativeCallReference = z.infer<typeof nativeCallReferenceSchema>;

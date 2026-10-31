import { z } from "zod";
import { unavailableNativeFactSchema } from "./nativeFactAvailability.js";
import { procedureIdentitySchema } from "./procedureInfo.js";
import { nativeCallClassificationSchema } from "./nativeCallReference.js";

export const availableReferenceKindSchema = z
  .object({
    available: z.literal(true),
    provenance: z.string().min(1),
    type: z.string(),
    flow: z.boolean(),
    call: z.boolean(),
    jump: z.boolean(),
    data: z.boolean(),
    read: z.boolean(),
    write: z.boolean(),
    indirect: z.boolean(),
    computed: z.boolean(),
    conditional: z.boolean(),
    terminal: z.boolean(),
    primary: z.boolean(),
    operand_index: z.int(),
    external: z.boolean(),
  })
  .strict();
export const referenceKindSchema = z.discriminatedUnion("available", [
  unavailableNativeFactSchema,
  availableReferenceKindSchema,
]);
/** Reported call sites without resolved targets; unreported dispatch stays unknown. */
export const unresolvedCallSchema = z.strictObject({
  address: z.string(),
  reason: z.string(),
});

/** Observed endpoints with complete or partial reference classification evidence. */
export const referenceEdgeSchema = z
  .object({
    source_address: z.string(),
    target_address: z.string(),
    source_procedure: procedureIdentitySchema.nullable(),
    target_procedure: procedureIdentitySchema.nullable(),
    kind: referenceKindSchema,
    call: nativeCallClassificationSchema.exactOptional(),
  })
  .strict();

import { z } from "zod";
import { nativeMetadataRecoverySummarySchema } from "./nativeMetadataRecovery.js";

const bytes = z.number().int().nonnegative().safe();

/** Captured source coverage and any completed derivation, without retaining raw bytes. */
export const nativeAotSnapshotObservationSchema = z.strictObject({
  kind: z.literal("native-aot-snapshot"),
  analysis_artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  image_base: z.string().regex(/^0x[0-9a-f]+$/u),
  capture: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("captured"), bytes }),
    z.strictObject({
      status: z.literal("over-capacity"),
      source_bytes_at_least: bytes,
      maximum_bytes: bytes,
    }),
  ]),
  metadata_recovery: nativeMetadataRecoverySummarySchema.optional(),
});
export type NativeAotSnapshotObservation = z.infer<
  typeof nativeAotSnapshotObservationSchema
>;

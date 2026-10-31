import { digestSchema } from "../digests.js";
import { z } from "zod";
import { absoluteLocalPathStringSchema } from "../localPath.js";
import {
  apkSignerSchema,
  apkSignerV3Schema,
  apkSignatureResultSchema,
} from "./apkSignatureReport.js";

export const apkSignatureSchemeSchema = z.enum(["v1", "v2", "v3", "v3.1"]);
const position = z.int().nonnegative();
const identity = {
  id: z.string().min(1),
  scheme: apkSignatureSchemeSchema,
  index: position,
};
const childIdentity = {
  ...identity,
  signer_id: z.string().min(1),
  signer_index: position,
};
export const apkSignerRowSchema = z.strictObject({
  ...identity,
  certificate: apkSignerSchema.shape.certificate,
  certificate_sha256: digestSchema.nullable(),
  signatures: apkSignerSchema.shape.signatures,
  public_key_bytes: position.nullable(),
  uninterpreted_signed_data_bytes: position.nullable(),
  uninterpreted_signer_bytes: position.nullable(),
  min_sdk: apkSignerSchema.shape.min_sdk,
  max_sdk: apkSignerSchema.shape.max_sdk,
  signature_file: z.string().nullable(),
  block_file: z.string().nullable(),
  signer_infos:
    apkSignatureResultSchema.shape.schemes.shape.v1.shape.signers.element.shape
      .signer_infos,
  decode_error: z.string().nullable(),
});
export const apkDigestRowSchema =
  apkSignerSchema.shape.digests.element.extend(childIdentity);
export const apkLineageRowSchema =
  apkSignerV3Schema.shape.rotation.shape.lineage.element.extend({
    ...childIdentity,
    previous_id: z.string().nullable(),
    certificate_sha256: digestSchema.nullable(),
  });
const filters = {
  ids: z.array(z.string()).optional(),
  schemes: z.array(apkSignatureSchemeSchema).optional(),
  signer_ids: z.array(z.string()).optional(),
  offset: position.default(0),
  limit: z.int().positive().default(32),
};
const signers = z.strictObject({
  ...filters,
  collection: z.literal("signers"),
  fields: z.array(apkSignerRowSchema.keyof()).optional(),
});
const digests = z.strictObject({
  ...filters,
  collection: z.literal("digests"),
  fields: z.array(apkDigestRowSchema.keyof()).optional(),
});
const lineage = z.strictObject({
  ...filters,
  collection: z.literal("lineage"),
  fields: z.array(apkLineageRowSchema.keyof()).optional(),
});
export const apkSignatureSelectionSchema = z.discriminatedUnion("collection", [
  signers,
  digests,
  lineage,
]);
export const apkSignatureViewRequestSchema = z.discriminatedUnion(
  "collection",
  [
    signers.extend({ kind: z.literal("apk-signature") }),
    digests.extend({ kind: z.literal("apk-signature") }),
    lineage.extend({ kind: z.literal("apk-signature") }),
  ],
);
export const apkSignatureViewItemsSchema = z.union([
  z.array(
    apkSignerRowSchema.partial().required({
      id: true,
      scheme: true,
      index: true,
      certificate_sha256: true,
    }),
  ),
  z.array(
    apkDigestRowSchema.partial().required({
      id: true,
      scheme: true,
      index: true,
      signer_id: true,
      signer_index: true,
    }),
  ),
  z.array(
    apkLineageRowSchema.partial().required({
      id: true,
      scheme: true,
      index: true,
      signer_id: true,
      signer_index: true,
      certificate_sha256: true,
    }),
  ),
]);
export const inspectApkSignatureInputSchema = z
  .strictObject({
    path: absoluteLocalPathStringSchema.describe(
      "Selected local APK/ZIP/AAB; static inspection only",
    ),
    detail: z.enum(["summary", "complete"]).default("summary"),
    view: apkSignatureSelectionSchema.optional(),
  })
  .superRefine((input, context) => {
    if (input.detail === "complete" && input.view !== undefined)
      context.addIssue({
        code: "custom",
        path: ["view"],
        message:
          "view requires summary delivery; omit it for complete Evidence",
      });
  });

import { z } from "zod";

import { digestSchema } from "../digests.js";
import { absoluteLocalPathStringSchema } from "../localPath.js";

const uint = z.number().int().min(0).max(0xffffffff);
const range = z.strictObject({ offset: uint, bytes: uint });

/** Hard ceiling on the caller-selected input read budget. */
export const MAX_INSPECT_PE_CERTIFICATE_FILE_BYTES = 536870912;
/** Hard ceiling on concatenated WIN_CERTIFICATE entries. */
export const MAX_INSPECT_PE_CERTIFICATE_ENTRIES = 64;

export const PE_CERTIFICATE_TYPES = [
  "x509",
  "pkcs7",
  "reserved",
  "ts_stack_signed",
  "unknown",
] as const;
export type PeCertificateType = (typeof PE_CERTIFICATE_TYPES)[number];

/** Map WIN_CERTIFICATE wCertificateType to a named kind; unknown stays unknown. */
export const peCertificateTypeName = (type: number): PeCertificateType => {
  switch (type) {
    case 0x0001:
      return "x509";
    case 0x0002:
      return "pkcs7";
    case 0x0003:
      return "reserved";
    case 0x0004:
      return "ts_stack_signed";
    default:
      return "unknown";
  }
};

/** Complete bounded inspection of one PE Authenticode certificate table. */
export const inspectPeCertificatesInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema.describe(
    "Absolute filesystem path to a PE image",
  ),
  max_file_bytes: z
    .number()
    .int()
    .min(64)
    .max(MAX_INSPECT_PE_CERTIFICATE_FILE_BYTES)
    .default(67108864)
    .describe("Maximum stable artifact bytes to read (default 64 MiB)"),
  max_entries: z
    .number()
    .int()
    .min(1)
    .max(MAX_INSPECT_PE_CERTIFICATE_ENTRIES)
    .default(8)
    .describe(
      "Maximum WIN_CERTIFICATE entries to examine; exceeding the budget fails without partial success",
    ),
});

const distinguishedNameSchema = z.strictObject({
  text: z.string(),
  attributes: z.array(
    z.strictObject({
      oid: z.string(),
      oid_name: z.string().nullable(),
      value: z.string(),
    }),
  ),
});

const x509CertificateSchema = z.strictObject({
  location: range,
  der_sha256: digestSchema,
  serial_hex: z.string().regex(/^[0-9a-f]*$/),
  issuer: distinguishedNameSchema,
  subject: distinguishedNameSchema,
  not_before: z.string(),
  not_after: z.string(),
  signature_algorithm_oid: z.string(),
  signature_algorithm_name: z.string().nullable(),
});

const signerInfoSchema = z.strictObject({
  digest_algorithm_oid: z.string(),
  digest_algorithm_name: z.string().nullable(),
  signature_algorithm_oid: z.string(),
  signature_algorithm_name: z.string().nullable(),
  issuer: distinguishedNameSchema.nullable(),
  serial_hex: z
    .string()
    .regex(/^[0-9a-f]*$/)
    .nullable(),
  subject_key_identifier_hex: z
    .string()
    .regex(/^[0-9a-f]*$/)
    .nullable(),
  authenticated_attributes: z.boolean(),
  // Optional for Evidence recorded before unsigned attributes were observed.
  // Null means the field was absent; an array means it was present.
  unsigned_attribute_oids: z.array(z.string()).nullable().optional(),
});

const pkcs7Schema = z.strictObject({
  content_type_oid: z.string(),
  content_type_name: z.string().nullable(),
  digest_algorithm_oids: z.array(z.string()),
  certificates: z.array(x509CertificateSchema),
  signers: z.array(signerInfoSchema),
});

const certificateEntrySchema = z.strictObject({
  index: uint,
  location: range,
  length: uint,
  revision: uint,
  certificate_type: uint,
  certificate_type_name: z.enum(PE_CERTIFICATE_TYPES),
  payload: z.strictObject({
    location: range,
    bytes: uint,
    sha256: digestSchema,
  }),
  pkcs7: pkcs7Schema.nullable(),
});

/** Observed IMAGE_DIRECTORY_ENTRY_SECURITY table; absence is null, not unsigned-everywhere. */
export const peCertificatesSchema = z.strictObject({
  artifact: z.strictObject({
    path: z.string().min(1),
    sha256: digestSchema,
    bytes: uint,
  }),
  format: z.enum(["pe32", "pe32-plus"]),
  machine: uint,
  table: z
    .strictObject({
      location: range,
      data_directory_location: range,
    })
    .nullable(),
  entries: z.array(certificateEntrySchema),
  coverage: z.strictObject({
    status: z.enum(["complete", "partial"]),
    examined_entries: uint,
    certificates: uint,
  }),
  limitations: z.array(z.string()),
});

export type PeCertificates = z.infer<typeof peCertificatesSchema>;
export type InspectPeCertificatesInput = z.infer<
  typeof inspectPeCertificatesInputSchema
>;

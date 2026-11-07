import { z } from "zod";
import { localPathStringSchema } from "../localPath.js";
import { digestSchema } from "../digests.js";
import { jsonValueSchema } from "../jsonValue.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const decimal = z.string().regex(/^(?:0|[1-9][0-9]*)$/u);

export const modelSourceSchema = z.strictObject({
  path: localPathStringSchema,
  file_size: count,
  header_sha256: digestSchema,
  header_length: count,
  sha256: digestSchema.nullable(),
  bytes_read: count,
  read_scope: z.enum(["header", "full-file"]),
});

const location = {
  source_offset: count,
  source_length: count,
  json_pointer: z.string().nullable(),
};

/** Arrays retain declared types/counts and bounded observations, never an implicit full vocabulary. */
export const modelMetadataSchema = z.strictObject({
  index: count,
  key: z.string(),
  type: z.string(),
  value: jsonValueSchema,
  element_type: z.string().nullable(),
  element_count: count.nullable(),
  preview_complete: z.boolean(),
  ...location,
});

export const modelTensorSchema = z.strictObject({
  index: count,
  name: z.string(),
  type: z.string(),
  type_id: count.nullable(),
  shape: z.array(decimal),
  data_offset: count,
  file_offset: count,
  byte_length: count.nullable(),
  parameter_count: decimal,
  byte_length_state: z.enum(["derived", "declared", "unknown"]),
  storage_validation: z.enum(["consistent", "unknown"]),
  ...location,
});

export const modelArtifactObjectSchema = z.strictObject({
  artifact: modelSourceSchema,
  format: z.enum(["gguf", "safetensors"]),
  version: count.nullable(),
  byte_order: z.enum(["little", "big"]),
  alignment: count.nullable(),
  tensor_data_offset: count,
  metadata: z.array(modelMetadataSchema),
  tensors: z.array(modelTensorSchema),
  totals: z.strictObject({
    confidence: z.literal("derived"),
    parameter_count: decimal,
    tensor_bytes: count.nullable(),
    by_type: z.array(
      z.strictObject({
        type: z.string(),
        tensors: count,
        parameter_count: decimal,
        bytes: count.nullable(),
      }),
    ),
  }),
  coverage: z.strictObject({
    header: z.literal("complete"),
    tensor_data: z.literal("not-interpreted"),
    array_values: z.enum(["complete", "preview"]),
    tensor_ranges: z.enum(["complete", "partial"]),
    storage_sizes: z.enum(["complete", "partial"]),
  }),
  limitations: z.array(z.string()),
});

/** Facts proven before an interrupted model read reached final file identity checks. */
export const modelArtifactPartialTensorSchema = z.strictObject({
  index: count,
  name: z.string(),
  type: z.string(),
  type_id: count.nullable(),
  shape: z.array(decimal),
  data_offset: count,
  file_offset: count.nullable(),
  byte_length: count.nullable(),
  parameter_count: decimal,
  byte_length_state: z.enum(["derived", "declared", "unknown"]),
  storage_validation: z.enum(["consistent", "unknown", "not-established"]),
  ...location,
});

export const modelArtifactPartialSchema = z.strictObject({
  kind: z.literal("model-artifact-partial"),
  artifact: z.strictObject({
    path: localPathStringSchema,
    observed_file_size: count,
    header_sha256: z.null(),
    sha256: z.null(),
    file_identity: z.literal("unverified"),
  }),
  format: z.enum(["gguf", "safetensors"]),
  version: count.nullable(),
  byte_order: z.enum(["little", "big"]).nullable(),
  alignment: count.nullable(),
  declared_metadata_count: count.nullable(),
  declared_tensor_count: count.nullable(),
  metadata: z.array(modelMetadataSchema),
  tensor_declarations: z.array(modelArtifactPartialTensorSchema),
  tensors: z.array(modelTensorSchema),
  coverage: z.strictObject({
    header: z.enum(["partial", "complete"]),
    metadata: z.enum(["not-started", "partial", "complete"]),
    tensors: z.enum(["not-started", "partial", "complete"]),
  }),
  limitations: z.array(z.string()),
});

/** Lookup indexes are safe only after positional identities and uniqueness are proven. */
export const modelArtifactSchema = modelArtifactObjectSchema.superRefine(
  (report, context) => {
    const collections = [
      { name: "metadata", rows: report.metadata, identity: "key" },
      { name: "tensors", rows: report.tensors, identity: "name" },
      { name: "totals.by_type", rows: report.totals.by_type, identity: "type" },
    ] as const;
    for (const { name, rows, identity } of collections) {
      const seen = new Set<string>();
      const prefix = name.split(".");
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index]!;
        if ("index" in row && row.index !== index) {
          context.addIssue({
            code: "custom",
            path: [...prefix, index, "index"],
            message: "Model row index must equal its source position",
          });
          return;
        }
        const value =
          identity === "key" && "key" in row
            ? row.key
            : identity === "name" && "name" in row
              ? row.name
              : row.type;
        if (seen.has(value)) {
          context.addIssue({
            code: "custom",
            path: [...prefix, index, identity],
            message: "Model collection identities must be unique",
          });
          return;
        }
        seen.add(value);
      }
    }
  },
);

export type ModelArtifact = z.infer<typeof modelArtifactSchema>;
export type ModelTensor = z.infer<typeof modelTensorSchema>;
export type ModelMetadata = z.infer<typeof modelMetadataSchema>;
export type ModelArtifactPartial = z.infer<typeof modelArtifactPartialSchema>;
export type ModelArtifactPartialTensor = z.infer<
  typeof modelArtifactPartialTensorSchema
>;
export interface ModelArtifactInput {
  readonly path: string;
  readonly hash: "header" | "full";
}

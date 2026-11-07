import { z } from "zod";
import { createHash } from "node:crypto";
import { digestSchema } from "../digests.js";
import {
  absoluteLocalPathStringSchema,
  localPathStringSchema,
} from "../localPath.js";
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const gpuLocationSchema = z.strictObject({
  container_id: z.string().nullable(),
  offset: count,
  size: count,
  section_index: count.nullable(),
  section_name: z.string().nullable(),
});
export const gpuObjectSchema = z.strictObject({
  id: z.string(),
  parent_id: z.string().nullable(),
  kind: z.enum([
    "cuda-fatbin",
    "hip-bundle",
    "native-section",
    "ptx",
    "cubin",
    "amdgpu",
    "host",
    "unknown",
  ]),
  target: z.string().nullable(),
  payload_target: z.string().nullable(),
  cuda_target_header: z
    .strictObject({
      os_abi: z.number().int().min(0).max(255),
      flags: z.string().regex(/^0x[0-9a-f]{8}$/u),
      location: gpuLocationSchema,
    })
    .nullable(),
  amd_target_metadata: z
    .strictObject({
      flags: z.string().regex(/^0x[0-9a-f]{8}$/u),
      processor: z.string().nullable(),
      header_location: gpuLocationSchema,
      note_coverage: z
        .enum(["complete", "partial"])
        .describe(
          "Complete only after all declared ELF note sections were examined within supported AMD metadata coverage; partial retains only examined facts.",
        ),
      notes: z.array(
        z.strictObject({
          target: z.string().nullable(),
          target_state: z.enum(["absent", "declared", "invalid"]),
          location: gpuLocationSchema,
        }),
      ),
    })
    .nullable()
    .default(null),
  target_consistency: z.enum([
    "unexamined",
    "single-source",
    "consistent",
    "base-only",
    "conflict",
    "unknown",
  ]),
  bundle_id: z.string().nullable(),
  compression: z.enum(["none", "zstd", "zlib", "lz4", "unsupported"]),
  compression_id: z.string().nullable(),
  encoded_size: count,
  decoded_size: count.nullable(),
  sha256: digestSchema.nullable(),
  raw_flags: z.string().nullable(),
  location: gpuLocationSchema,
  metadata_location: gpuLocationSchema,
  inspection: z.enum([
    "inventory",
    "complete",
    "partial",
    "not-selected",
    "unsupported",
    "malformed",
    "capacity",
  ]),
  limitations: z.array(z.string()),
});
export const gpuParameterSchema = z.strictObject({
  ordinal: count,
  name: z.string().nullable(),
  offset: count.nullable(),
  size: count.nullable(),
  type: z.string().nullable(),
  hidden: z.boolean().nullable(),
});
export const gpuKernelSchema = z.strictObject({
  id: z.string(),
  object_id: z.string(),
  representation: z.enum([
    "ptx-declarations",
    "cuda-elf-metadata",
    "amdgpu-metadata",
  ]),
  name: z.string(),
  symbol: z.string().nullable(),
  parameter_count: count.nullable(),
  parameter_bytes: count.nullable(),
  parameters: z.array(gpuParameterSchema),
  registers: z.strictObject({
    physical: count.nullable(),
    sgpr: count.nullable(),
    vgpr: count.nullable(),
    agpr: count.nullable(),
    virtual: z.array(
      z.strictObject({ type: z.string(), count: count.nullable() }),
    ),
  }),
  shared_bytes: count
    .nullable()
    .describe(
      "PTX: entry-local declared static bytes; CUDA ELF: allocated section bytes; AMDGPU: group_segment_fixed_size. Runtime dynamic/module shared allocations are not established by PTX.",
    ),
  private_bytes: count.nullable(),
  location: gpuLocationSchema,
  sources: z.strictObject({
    parameters: gpuLocationSchema.nullable(),
    registers: gpuLocationSchema.nullable(),
    shared: gpuLocationSchema.nullable(),
    private: gpuLocationSchema.nullable(),
  }),
  limitations: z.array(z.string()),
});
export const gpuPtxArtifactSchema = z
  .strictObject({
    id: z.string(),
    object_id: z.string(),
    sha256: digestSchema,
    media_type: z.literal("text/x-ptx"),
    encoding: z.literal("utf-8"),
    byte_length: count,
    text: z.string(),
    location: gpuLocationSchema,
  })
  .superRefine((artifact, context) => {
    if (
      /[\uD800-\uDFFF]/u.test(artifact.text) ||
      Buffer.byteLength(artifact.text, "utf8") !== artifact.byte_length ||
      artifact.location.size !== artifact.byte_length
    )
      context.addIssue({
        code: "custom",
        path: ["byte_length"],
        message: "PTX text and its UTF-8 source extent disagree",
      });
    if (
      createHash("sha256").update(artifact.text, "utf8").digest("hex") !==
      artifact.sha256
    )
      context.addIssue({
        code: "custom",
        path: ["sha256"],
        message: "PTX digest does not match retained UTF-8 text",
      });
  });
export const gpuCodeObjectsObjectSchema = z.strictObject({
  artifact: z.strictObject({
    path: localPathStringSchema,
    file_size: count,
    sha256: digestSchema,
    bytes_read: count,
  }),
  format: z.enum(["elf", "pe", "cuda-fatbin", "hip-bundle", "ptx"]),
  analysis: z.enum(["inventory", "kernels"]),
  objects: z.array(gpuObjectSchema),
  kernels: z.array(gpuKernelSchema),
  ptx_artifacts: z.array(gpuPtxArtifactSchema),
  coverage: z.strictObject({
    discovery_scope: z.literal(
      "supported-section-names-and-standalone-formats",
    ),
    discovery: z.enum(["complete", "partial"]),
    payloads: z.enum(["not-requested", "complete", "partial"]),
    examined_sections: count,
    unknown_section_names: count,
  }),
  limitations: z.array(z.string()),
});
/** Validate local identities and coordinate spaces once before consumers build lookup indexes. */
export const gpuCodeObjectsSchema = gpuCodeObjectsObjectSchema.superRefine(
  (report, context) => {
    const objects = new Map<string, GpuObject>();
    const issue = (path: (string | number)[], message: string): void =>
      context.addIssue({ code: "custom", path, message });
    for (let index = 0; index < report.objects.length; index++) {
      const row = report.objects[index]!;
      if (objects.has(row.id))
        issue(["objects", index, "id"], "GPU object IDs must be unique");
      if (row.parent_id !== null && !objects.has(row.parent_id))
        issue(
          ["objects", index, "parent_id"],
          "GPU parents must precede their children",
        );
      if (
        row.location.container_id !== row.parent_id ||
        row.metadata_location.container_id !== row.parent_id
      )
        issue(
          ["objects", index, "location"],
          "GPU object ranges must use their parent's coordinate space",
        );
      objects.set(row.id, row);
    }
    const range = (value: GpuLocation, path: (string | number)[]): void => {
      const size =
        value.container_id === null
          ? report.artifact.file_size
          : objects.get(value.container_id)?.decoded_size;
      if (
        size === undefined ||
        (size !== null &&
          (value.offset > size || value.size > size - value.offset))
      )
        issue(
          path,
          "GPU source range is outside its declared coordinate space",
        );
    };
    for (let index = 0; index < report.objects.length; index++) {
      const row = report.objects[index]!;
      range(row.location, ["objects", index, "location"]);
      range(row.metadata_location, ["objects", index, "metadata_location"]);
      const amd = row.amd_target_metadata;
      if (amd !== null) {
        range(amd.header_location, [
          "objects",
          index,
          "amd_target_metadata",
          "header_location",
        ]);
        if (
          row.kind !== "amdgpu" ||
          amd.header_location.container_id !== row.id ||
          amd.header_location.offset !== 0 ||
          ![52, 64].includes(amd.header_location.size)
        )
          issue(
            ["objects", index, "amd_target_metadata"],
            "AMDGPU header provenance must start at its payload",
          );
        for (let note = 0; note < amd.notes.length; note++) {
          const location = amd.notes[note]!.location;
          range(location, [
            "objects",
            index,
            "amd_target_metadata",
            "notes",
            note,
            "location",
          ]);
          if (location.container_id !== row.id)
            issue(
              [
                "objects",
                index,
                "amd_target_metadata",
                "notes",
                note,
                "location",
              ],
              "AMDGPU notes must use their payload coordinate space",
            );
        }
      }
      const header = row.cuda_target_header;
      if (header !== null) {
        range(header.location, [
          "objects",
          index,
          "cuda_target_header",
          "location",
        ]);
        if (
          row.kind !== "cubin" ||
          ![52, 64].includes(header.location.size) ||
          (header.location.container_id === row.id
            ? header.location.offset !== 0
            : header.location.container_id !== row.parent_id ||
              header.location.offset !== row.location.offset)
        )
          issue(
            ["objects", index, "cuda_target_header"],
            "CUDA header provenance must start at its CUBIN object",
          );
      }
    }
    const kernelIds = new Set<string>();
    for (let index = 0; index < report.kernels.length; index++) {
      const row = report.kernels[index]!;
      if (kernelIds.has(row.id))
        issue(["kernels", index, "id"], "GPU kernel IDs must be unique");
      kernelIds.add(row.id);
      if (
        !objects.has(row.object_id) ||
        row.location.container_id !== row.object_id
      )
        issue(
          ["kernels", index, "object_id"],
          "GPU kernels require an inventoried object and its coordinate space",
        );
      range(row.location, ["kernels", index, "location"]);
      for (const [field, source] of Object.entries(row.sources))
        if (source !== null)
          range(source, ["kernels", index, "sources", field]);
    }
    const artifactIds = new Set<string>();
    for (let index = 0; index < report.ptx_artifacts.length; index++) {
      const row = report.ptx_artifacts[index]!;
      if (artifactIds.has(row.id))
        issue(
          ["ptx_artifacts", index, "id"],
          "PTX artifact IDs must be unique",
        );
      artifactIds.add(row.id);
      if (
        objects.get(row.object_id)?.kind !== "ptx" ||
        row.location.container_id !== row.object_id
      )
        issue(
          ["ptx_artifacts", index, "object_id"],
          "PTX artifacts require an inventoried PTX object",
        );
      range(row.location, ["ptx_artifacts", index, "location"]);
    }
  },
);
/** Interrupted observations retain facts without claiming final source identity or completeness. */
export const gpuCodeObjectsPartialSchema = z.strictObject({
  kind: z.literal("gpu-code-objects-partial"),
  artifact: z.strictObject({
    path: localPathStringSchema,
    observed_file_size: count,
    sha256: z.null(),
    file_identity: z.literal("unverified"),
  }),
  analysis: z.enum(["inventory", "kernels"]),
  objects: z.array(gpuObjectSchema),
  kernels: z.array(gpuKernelSchema),
  ptx_artifacts: z.array(gpuPtxArtifactSchema),
  coverage: z.strictObject({
    discovery: z.literal("partial"),
    payloads: z.literal("partial"),
  }),
  limitations: z.array(z.string()),
});
export type GpuCodeObjectsPartial = z.infer<typeof gpuCodeObjectsPartialSchema>;
export const gpuTargetSchema = z.strictObject({
  id: z.string(),
  target: z.string().nullable(),
  confidence: z.literal("derived"),
  object_count: count,
  kernel_count: count,
  encoded_bytes: z.string().regex(/^(?:0|[1-9][0-9]*)$/u),
  decoded_bytes: z
    .string()
    .regex(/^(?:0|[1-9][0-9]*)$/u)
    .nullable(),
  kernel_coverage: z.enum(["not-requested", "complete", "partial"]),
  by_kind: z.strictObject({
    ptx: count,
    cubin: count,
    amdgpu: count,
    unknown: count,
  }),
});
export type GpuTarget = z.infer<typeof gpuTargetSchema>;
const selection = {
  ids: z.array(z.string()).optional(),
  targets: z.array(z.string()).optional(),
  offset: count.default(0),
  limit: z.number().int().positive().default(32),
};
export const gpuCodeObjectsSelectionSchemas = {
  objects: z.strictObject({
    ...selection,
    collection: z.literal("objects"),
    fields: z.array(gpuObjectSchema.keyof()).optional(),
  }),
  kernels: z.strictObject({
    ...selection,
    collection: z.literal("kernels"),
    object_ids: z.array(z.string()).optional(),
    names: z.array(z.string()).optional(),
    fields: z.array(gpuKernelSchema.keyof()).optional(),
  }),
  ptx: z.strictObject({
    collection: z.literal("ptx"),
    object_id: z.string(),
    offset: count.default(0),
    limit: z.number().int().positive().default(4096),
  }),
  targets: z.strictObject({
    ...selection,
    collection: z.literal("targets"),
    fields: z.array(gpuTargetSchema.keyof()).optional(),
  }),
};
export const gpuCodeObjectsSelectionSchema = z.discriminatedUnion(
  "collection",
  [
    gpuCodeObjectsSelectionSchemas.objects,
    gpuCodeObjectsSelectionSchemas.kernels,
    gpuCodeObjectsSelectionSchemas.ptx,
    gpuCodeObjectsSelectionSchemas.targets,
  ],
);
export const inspectGpuCodeObjectsInputSchema = z
  .strictObject({
    path: absoluteLocalPathStringSchema,
    analysis: z.enum(["inventory", "kernels"]).default("inventory"),
    expected_sha256: digestSchema
      .optional()
      .describe(
        "Require the current full-file digest; mandatory when selecting inventory object_ids",
      ),
    object_ids: z
      .array(z.string())
      .optional()
      .describe(
        "Decode only these inventory IDs; IDs are scoped to the artifact SHA-256",
      ),
    targets: z
      .array(z.string())
      .optional()
      .describe(
        "Decode only exact target declarations, preserving all inventory rows",
      ),
    detail: z.enum(["summary", "complete"]).default("summary"),
    view: gpuCodeObjectsSelectionSchema.optional(),
  })
  .superRefine((input, context) => {
    if (input.object_ids !== undefined && input.expected_sha256 === undefined)
      context.addIssue({
        code: "custom",
        path: ["expected_sha256"],
        message: "object_ids require the artifact SHA-256 from their inventory",
      });
    if (input.view !== undefined && input.detail === "complete")
      context.addIssue({
        code: "custom",
        path: ["view"],
        message: "view requires summary detail",
      });
  });
export type GpuCodeObjects = z.infer<typeof gpuCodeObjectsSchema>;
export type GpuObject = z.infer<typeof gpuObjectSchema>;
export type GpuKernel = z.infer<typeof gpuKernelSchema>;
export type GpuLocation = z.infer<typeof gpuLocationSchema>;
export type GpuCodeObjectsInput = Pick<
  z.infer<typeof inspectGpuCodeObjectsInputSchema>,
  "path" | "analysis" | "object_ids" | "targets" | "expected_sha256"
>;

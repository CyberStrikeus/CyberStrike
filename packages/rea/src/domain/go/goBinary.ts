import { z } from "zod";
import { binaryMetadataArchitecture } from "../binaryMetadataArchitecture.js";
import {
  machoSelectionContainsRange,
  selectedSliceAgreesWithReport,
  machoSliceArchitectureSchema,
  machoTargetSelectionSchema,
} from "../apple/machoTargetSelection.js";
import { digestSchema } from "../digests.js";
import {
  absoluteLocalPathStringSchema,
  localPathStringSchema,
} from "../localPath.js";
import { canonicalBase64Schema } from "../stringPatterns.js";

const sourceRangeSchema = z.strictObject({
  offset: z.int().nonnegative(),
  bytes: z.int().nonnegative(),
});
const moduleIdentitySchema = z.strictObject({
  path: z.string(),
  version: z.string(),
  sum: z.string().nullable(),
});

/** Module identities retain development versions, local replacements and missing sums verbatim. */
export const goModuleSchema = moduleIdentitySchema.extend({
  replacement: moduleIdentitySchema.nullable(),
});

/** Parsed records alongside unrecognized text lines and exact non-UTF-8 line bytes. */
export const goModuleMetadataSchema = z.strictObject({
  path: z.string().nullable(),
  main: goModuleSchema.nullable(),
  dependencies: z.array(goModuleSchema),
  settings: z.array(z.strictObject({ key: z.string(), value: z.string() })),
  unparsed_lines: z.array(z.string()),
  unparsed_line_bytes_base64: z.array(canonicalBase64Schema),
  complete: z.boolean(),
});

/** One exact local artifact, independent of any active disassembler target. */
export const inspectGoBinaryInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema.describe(
    "Absolute filesystem path to the selected executable or library",
  ),
  architecture: machoSliceArchitectureSchema.exactOptional(),
  detail: z
    .enum(["complete", "summary"])
    .default("complete")
    .describe(
      "complete returns all metadata inline; summary retains complete Evidence and returns build identity and counts for subsequent retained Go views.",
    ),
});

/** Compiler-written build information and its original file-backed source ranges. */
export const goBuildInfoSchema = z.strictObject({
  header_offset: z.int().nonnegative(),
  encoding: z.enum(["inline", "pointer"]),
  go_version: z.string().nullable(),
  go_version_bytes_base64: canonicalBase64Schema,
  module_text: z.string().nullable(),
  module_bytes_base64: canonicalBase64Schema,
  version_location: sourceRangeSchema,
  module_location: sourceRangeSchema,
  module: goModuleMetadataSchema,
});

/** Complete bounded build-metadata observation; absence does not identify a binary as non-Go. */
export const goBinarySchema = z
  .strictObject({
    artifact: z.strictObject({
      path: localPathStringSchema,
      sha256: digestSchema,
      bytes: z.int().nonnegative(),
    }),
    format: z.enum(["elf", "pe", "macho"]),
    architecture: z.string(),
    bits: z.union([z.literal(32), z.literal(64)]),
    byte_order: z.enum(["little", "big"]),
    /** The universal slice that was read; source ranges stay file offsets inside it. */
    selected_slice: machoTargetSelectionSchema.exactOptional(),
    build_info: goBuildInfoSchema.nullable(),
    limitations: z.array(z.string()),
  })
  .superRefine((report, context) => {
    const info = report.build_info;
    const slice = report.selected_slice;
    if (
      slice !== undefined &&
      (!selectedSliceAgreesWithReport(
        slice,
        report.format,
        binaryMetadataArchitecture(report.architecture),
      ) ||
        !machoSelectionContainsRange(
          slice,
          report.artifact.bytes,
          slice.offset,
          0,
        ) ||
        (info !== null &&
          [
            { offset: info.header_offset, bytes: 32 },
            info.version_location,
            info.module_location,
          ].some(
            (range) =>
              !machoSelectionContainsRange(
                slice,
                report.artifact.bytes,
                range.offset,
                range.bytes,
              ),
          )))
    )
      context.addIssue({
        code: "custom",
        path: ["selected_slice"],
        message:
          "Selected universal slice must be a FAT slice of the artifact whose CPU matches the report's Mach-O architecture and that contains the build-info source ranges.",
      });
    if (info === null) return;
    if (info.header_offset > report.artifact.bytes - 32)
      context.addIssue({
        code: "custom",
        path: ["build_info", "header_offset"],
        message: "Build-info header is outside the selected artifact.",
      });
    for (const field of ["version_location", "module_location"] as const) {
      const range = info[field];
      if (
        range.offset > report.artifact.bytes ||
        range.bytes > report.artifact.bytes - range.offset
      )
        context.addIssue({
          code: "custom",
          path: ["build_info", field],
          message: "Build-info source range is outside the selected artifact.",
        });
    }
    for (const [field, range, description] of [
      ["go_version_bytes_base64", info.version_location, "compiler"],
      ["module_bytes_base64", info.module_location, "module"],
    ] as const) {
      const encoded = info[field];
      if (Buffer.byteLength(encoded, "base64") !== range.bytes)
        context.addIssue({
          code: "custom",
          path: ["build_info", field],
          message: `Encoded ${description} bytes do not match their reported source length.`,
        });
    }
  });

export type GoModule = z.infer<typeof goModuleSchema>;
export type GoModuleMetadata = z.infer<typeof goModuleMetadataSchema>;
export type GoBinary = z.infer<typeof goBinarySchema>;
export type InspectGoBinaryInput = z.infer<typeof inspectGoBinaryInputSchema>;

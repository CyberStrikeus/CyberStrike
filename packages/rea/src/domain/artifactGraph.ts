import {
  artifactDfuCrc32PairSchema,
  artifactIntegrityClaimSchema,
  artifactSha256PairSchema,
  artifactMd5PairSchema,
} from "./artifactIntegrity.js";
import { artifactFormatMetadataSchema } from "./artifactFormatMetadata.js";
import { z } from "zod";
import { prefixedDigestSchema } from "./../domain/digests.js";
import { inesInventorySchema } from "./inesContainer.js";

/** Entry kinds or subtrees deliberately excluded by an artifact traversal. */
export const artifactTraversalOmissionKindSchema = z.enum([
  "fifo",
  "socket",
  "block-device",
  "character-device",
  "unsupported",
  "directory-descendants",
]);
export type ArtifactTraversalOmissionKind = z.infer<
  typeof artifactTraversalOmissionKindSchema
>;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const artifactIdSchema = prefixedDigestSchema("art");
const occurrenceIdSchema = prefixedDigestSchema("occ");
const edgeIdSchema = prefixedDigestSchema("edge");
const manifestIdSchema = prefixedDigestSchema("agm");
const extractionIdSchema = prefixedDigestSchema("aex");
const contradictionIdSchema = prefixedDigestSchema("ic");
const boundedRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      path.split("/").every((part) => part !== "" && part !== ".."),
    "Expected a normalized relative POSIX path without traversal",
  );

/** Closed artifact categories used to traverse application containers. */
const artifactKindSchema = z.enum([
  "container",
  "executable",
  "dynamic-library",
  "framework",
  "native-addon",
  "javascript",
  "source-map",
  "plist",
  "entitlements",
  "resource",
  "universal-slice",
  "package-metadata",
  "unknown",
]);

/** Recognized storage or application formats; unknown bytes remain explicit. */
export const ARTIFACT_FORMAT_IDS = [
  "dotnet-bundle",
  "bun-standalone",
  "dmg",
  "zip",
  "pkg",
  "asar",
  "ines",
  "godot-pck",
  "unityfs",
  "uimage",
  "javascript-bundle",
  "source-map",
  "mach-o-universal",
  "mach-o",
  "elf",
  "pe",
  "dos-mz",
  "dos-com",
  "raw-binary",
  "gamecube-dol",
  "hopper",
  "analysis-database",
  "ipa",
  "apk",
  "msix",
  "appx",
  "hap",
  "hsp",
  "app-pack",
  "plist",
  "entitlements",
  "directory",
  "file",
  "pyinstaller",
  "node-sea",
  "intel-hex",
  "srec",
  "esp-image",
  "uf2",
  "dfuse",
  "esp-flash-image",
  "fit",
  "unknown",
] as const;

export type ArtifactFormatId = (typeof ARTIFACT_FORMAT_IDS)[number];

const artifactFormatSchema = z.enum(ARTIFACT_FORMAT_IDS);

/** Formats established from bytes or a virtual directory tree, independent of path roles. */
const artifactContentFormatSchema = artifactFormatSchema.extract([
  "ines",
  "zip",
  "godot-pck",
  "unityfs",
  "uimage",
  "intel-hex",
  "srec",
  "esp-image",
  "uf2",
  "dfuse",
  "fit",
  "mach-o-universal",
  "mach-o",
  "elf",
  "pe",
  "dos-mz",
  "plist",
  "directory",
  "file",
  "unknown",
]);

/** File byte interval for an artifact derived without writing it to disk. */
const artifactByteRangeSchema = z.object({
  offset: z.int().min(0),
  length: z.int().min(0),
});

/** External command provenance, including observable side effects. */
const artifactCommandSchema = z.object({
  tool: z.string().min(1),
  arguments: z.array(z.string()),
  tool_version: z.string().nullable(),
  executable_sha256: sha256Schema.nullable(),
  exit_code: z.int().nullable(),
  effects: z.array(z.enum(["read", "write", "mount"])),
});

/** Parsed artifact-producing command provenance. */
export type ArtifactCommand = z.infer<typeof artifactCommandSchema>;

/** One content-addressed application artifact in deterministic manifest order. */
export const artifactNodeSchema = z.object({
  artifact_id: artifactIdSchema,
  format: artifactContentFormatSchema,
  sha256: sha256Schema,
  size: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  media_type: z.string().min(1).nullable(),
  architecture: z.string().min(1).nullable(),
  content_state: z.enum(["materialized", "embedded", "virtual"]),
  limitations: z.array(z.string()),
});

/** One path or virtual location where an artifact occurs in its parent. */
export const artifactOccurrenceSchema = z.object({
  occurrence_id: occurrenceIdSchema,
  artifact_id: artifactIdSchema.nullable(),
  parent_occurrence_id: occurrenceIdSchema.nullable(),
  logical_path: boundedRelativePathSchema,
  entry_kind: z.enum(["file", "directory", "symlink", "slice", "metadata"]),
  artifact_kind: artifactKindSchema,
  artifact_format: artifactFormatSchema,
  declared_size: z.int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  compressed_size: z.int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  executable: z.boolean(),
  encrypted: z.boolean(),
  /** Reader-observed ASAR storage; omission leaves historical storage unknown. */
  unpacked: z.boolean().exactOptional(),
  hash_status: z.enum(["verified", "mismatched", "not-hashed", "unavailable"]),
  source_location: artifactByteRangeSchema.nullable(),
  /** Exact reader-source path or opaque key, including an observed empty key. */
  source_path: z.string().exactOptional(),
  declared_integrity: artifactIntegrityClaimSchema.exactOptional(),
  format_metadata: artifactFormatMetadataSchema.exactOptional(),
  limitations: z.array(z.string()),
});

/** Observed bytes that contradict a container's declared integrity identity. */
const integrityContradictionBaseSchema = z.object({
  contradiction_id: contradictionIdSchema,
  occurrence_id: occurrenceIdSchema,
  parent_artifact_id: artifactIdSchema,
  logical_path: boundedRelativePathSchema,

  entry_kind: z.enum(["file", "slice"]),
  unpacked: z.boolean(),
  trust: z.literal("observed-untrusted"),
  provenance: z.literal("container-integrity-metadata-versus-observed-bytes"),
  limitations: z.array(z.string()).min(1),
});

export const integrityContradictionSchema = z.union([
  integrityContradictionBaseSchema.extend(artifactSha256PairSchema.shape),
  integrityContradictionBaseSchema.extend(artifactMd5PairSchema.shape),
  integrityContradictionBaseSchema.extend(artifactDfuCrc32PairSchema.shape),
]);

/**
 * Parent-child derivation relation between two content-addressed artifacts.
 * The child artifact and its logical path are those of the edge's occurrence.
 */
export const artifactEdgeSchema = z.object({
  edge_id: edgeIdSchema,
  ordinal: z.int().min(0),
  parent_artifact_id: artifactIdSchema,
  relation: z.enum([
    "contains",
    "extracts",
    "slice-of",
    "embeds",
    "loads",
    "maps-source",
    "derived-from",
  ]),
  occurrence_id: occurrenceIdSchema,
  producer: artifactCommandSchema.nullable(),
});

/** Stable cryptographic commitment and counts for a complete artifact graph. */
export const artifactGraphManifestSchema = z.object({
  manifest_id: manifestIdSchema,
  root_artifact_id: artifactIdSchema,
  root_sha256: sha256Schema,
  root_format: artifactFormatSchema,
  graph_sha256: sha256Schema,
  node_count: z.int().min(1),
  occurrence_count: z.int().min(1),
  edge_count: z.int().min(0),
});

/** Producer-owned traversal coverage; content certainty remains on each occurrence. */
export const artifactInventoryCoverageSchema = z.strictObject({
  scope: z.enum(["root", "container-entries"]),
  status: z.enum(["complete", "unknown"]),
});
export type ArtifactInventoryCoverage = z.infer<
  typeof artifactInventoryCoverageSchema
>;

/** Current inventory observation containing the stable artifact graph. */
export const artifactInventoryResultSchema = z.strictObject({
  manifest: artifactGraphManifestSchema,
  nodes: z.array(artifactNodeSchema),
  occurrences: z.array(artifactOccurrenceSchema),
  edges: z.array(artifactEdgeSchema),
  provenance: z.array(artifactCommandSchema),
  ines: inesInventorySchema.exactOptional(),
  integrity_contradictions: z.array(integrityContradictionSchema),
  coverage: artifactInventoryCoverageSchema,
  limitations: z.array(z.string()),
});

/** One safely materialized artifact beneath caller-approved output root. */
const extractedArtifactSchema = z.object({
  artifact_id: artifactIdSchema,
  relative_path: boundedRelativePathSchema,
  sha256: sha256Schema,
  bytes_written: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  created: z.boolean(),
});

/** Path-independent commitment to one selected extraction operation. */
const artifactExtractionManifestSchema = z.object({
  extraction_id: extractionIdSchema,
  source_manifest_id: manifestIdSchema,
  selected_occurrence_ids: z.array(occurrenceIdSchema),
  files_sha256: sha256Schema,
  output_root_alias: z.literal("$OUTPUT_ROOT"),
});

/** Safe extraction observation with containment and cleanup verification. */
export const artifactExtractionResultSchema = z.object({
  manifest: artifactGraphManifestSchema,
  extraction_manifest: artifactExtractionManifestSchema,
  output_root: z.string().min(1),
  artifacts: z.array(extractedArtifactSchema),
  containment_verified: z.boolean(),
  cleanup: z.object({
    attempted: z.boolean(),
    verified: z.boolean(),
    residual_paths: z.array(boundedRelativePathSchema),
  }),
  coverage: artifactInventoryCoverageSchema,
  provenance: z.array(artifactCommandSchema),
  integrity_contradictions: z.array(integrityContradictionSchema),
  limitations: z.array(z.string()),
});

/** Parsed artifact graph node. */
export type ArtifactNode = z.infer<typeof artifactNodeSchema>;

/** Parsed artifact derivation edge. */
export type ArtifactEdge = z.infer<typeof artifactEdgeSchema>;

/** Parsed artifact occurrence. */
export type ArtifactOccurrence = z.infer<typeof artifactOccurrenceSchema>;
export type IntegrityContradiction = z.infer<
  typeof integrityContradictionSchema
>;

/** Parsed deterministic artifact graph manifest. */
export type ArtifactGraphManifest = z.infer<typeof artifactGraphManifestSchema>;

/** Parsed paginated inventory result. */
export type ArtifactInventoryResult = z.infer<
  typeof artifactInventoryResultSchema
>;

/** Parsed paginated extraction result. */
export type ArtifactExtractionResult = z.infer<
  typeof artifactExtractionResultSchema
>;

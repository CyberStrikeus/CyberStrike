import { requireOutputSchema } from "./toolOutputSchemaPrimitives.js";
import { z } from "zod";

import type { ToolContract } from "./toolContractTypes.js";
import { artifactOutputSchemas } from "./toolOutputSchemaGroups.js";
import { artifactIntegrityPolicySchema } from "../domain/artifactIntegrityPolicy.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { toolContractMetadata } from "./toolEffects.js";
import { appleAssetCatalogInputSchema } from "../domain/apple/appleAssetCatalog.js";
import { dylibResolutionInputSchema } from "../domain/apple/dylibResolution.js";
import { keyedArchiveInputSchema } from "../domain/apple/keyedArchive.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { analysisDetailSchema } from "./analysisDetail.js";
/** Exact caller boundary for deterministic artifact inventory. */
export const artifactInventoryInputSchema = z.strictObject({
  integrity_policy: artifactIntegrityPolicySchema,
});

/** Delivery selection belongs to the adapter, not the inventory producer. */
export const artifactInspectionInputSchema =
  artifactInventoryInputSchema.extend({
    detail: analysisDetailSchema
      .unwrap()
      .optional()
      .describe(
        "Omitted or complete returns the complete inspection Evidence. summary retains that complete Evidence in this session and returns its inspect_analysis_view summary; use normalized_result.parent_evidence_id for inventory views.",
      ),
  });

/** Extraction needs no selector: it materializes every regular child file. */
export const artifactExtractionInputSchema = z.strictObject({
  integrity_policy: artifactIntegrityPolicySchema,
});

/** Provider input containing the destination chosen by the local adapter. */
export const artifactExtractionExecutionSchema =
  artifactExtractionInputSchema.extend({
    output_root: localPathStringSchema,
  });

const exampleInputSchema = z.record(z.string(), jsonValueSchema);
const examples: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  inspect_artifact: { detail: "summary" },
  extract_artifact: {},
  decode_interface_builder: {},
  inspect_asset_catalog: { offset: 0, limit: 1000 },
  inspect_keyed_archive: { path: "Contents/Resources/Model.plist" },
  trace_dylib_resolution: {
    roots: ["Contents/MacOS/App"],
    architecture: "arm64",
  },
};

const artifact = <
  Name extends keyof typeof artifactOutputSchemas,
  Schema extends z.ZodType<Readonly<Record<string, unknown>>>,
>(
  name: Name,
  description: string,
  inputSchema: Schema,
  retainedSummary?: ToolContract["retainedSummary"],
) => {
  const outputSchema = requireOutputSchema(artifactOutputSchemas, name);
  return {
    name,
    ...toolContractMetadata(name),
    description,
    kind: "artifact-provider",
    requiresActiveTarget: true,
    ...(retainedSummary === undefined ? {} : { retainedSummary }),
    inputSchema,
    outputSchema,
    examples: [
      {
        title: `Example ${name.replaceAll("_", " ")} request`,
        input: exampleInputSchema.parse(examples[name] ?? {}),
      },
    ],
  } satisfies ToolContract<Name, Schema, typeof outputSchema>;
};

/** Artifact-graph inventory and safe extraction contracts. */
export const ARTIFACT_TOOL_CONTRACTS = [
  artifact(
    "inspect_artifact",
    "Inspect an active archive or application package, including Node.js SEA carriers, in one call. By default returns the complete content-addressed artifact graph once, as the typed nested inventory Evidence, with root and integrity observations, integrity contradictions, hypotheses, unexplored branches, limitations, and next probes inline. Bun standalone inventory describes stored module, sourcemap and opaque bytecode regions. For PCK, Bun and large containers prefer detail summary: it retains the complete inspection and returns its derived summary view; read exact paths, batch occurrence/content IDs and selected fields with inspect_analysis_view using parent_evidence_id. This changes delivery, not inventory coverage. Classic iNES includes header facts, PRG/CHR file-region hashes and byte-exact reconstruction evidence; mapper execution and CPU bank mappings remain unobserved. Read-only DMG mounting is used automatically on supported macOS hosts. Integrity mismatches fail by default; record-and-continue keeps mismatches explicitly untrusted. It does not extract files; use extract_artifact to materialize regular contents of supported formats. DMG extraction is unavailable; use a caller-managed read-only mount on macOS to access its files.",
    artifactInspectionInputSchema,
    { evidenceParameters: "preserve-detail" },
  ),
  artifact(
    "extract_artifact",
    "Extract regular files (including Node.js SEA scripts and assets) exposed by a supported active archive reader into a fresh temporary directory chosen by REA. A nested archive exposed as a file is copied as a file; inspect and extract it separately to unpack its contents. The result includes its location. DMG extraction is unavailable; use a caller-managed read-only mount on macOS to access its files. Rejects traversal and symlink escapes, never overwrites, and verifies cleanup. Integrity mismatches fail by default; record-and-continue extracts the observed bytes and returns each mismatch as an explicitly untrusted integrity contradiction.",
    artifactExtractionInputSchema,
  ),
  artifact(
    "decode_interface_builder",
    "Decode compiled storyboard and nib archives inside the active Apple app bundle, including keyed property lists and NIBArchive object tables, into a bounded object, hierarchy, and connection graph. This is static archive parsing; unrecognized archive classes and unresolved code handlers remain explicit unknowns. A full app graph is often several megabytes; detail summary retains it and returns documents with node, edge and coverage counts, then page rows, optionally one document's, with inspect_analysis_view kind interface-builder.",
    z.strictObject({
      max_documents: z.int().min(1).max(64).default(64),
      max_objects: z.int().min(1).max(20_000).default(20_000),
      max_connections: z.int().min(1).max(40_000).default(40_000),
      detail: analysisDetailSchema
        .unwrap()
        .optional()
        .describe(
          "Omitted or complete returns the complete decoded graph Evidence. summary retains that complete Evidence in this session and returns its inspect_analysis_view summary; use normalized_result.parent_evidence_id for interface-builder pages.",
        ),
    }),
    { evidenceParameters: "omit-detail" },
  ),
  artifact(
    "inspect_keyed_archive",
    "Inspect one Foundation NSKeyedArchiver plist in the active app bundle as original object-table nodes, class descriptors, named roots, and UID edges. Preserves shared and cyclic references without instantiating classes. The path is relative to the bundle; root selection and object pagination preserve original identities.",
    keyedArchiveInputSchema,
  ),
  artifact(
    "inspect_asset_catalog",
    "Inspect compiled Assets.car metadata in an active Apple app bundle. Returns stable paginated catalog and rendition records with raw assetutil metadata and catalog digests; rendition bytes are not extracted.",
    appleAssetCatalogInputSchema,
  ),
  artifact(
    "trace_dylib_resolution",
    "Trace how dyld would resolve each Mach-O dylib load for the active Mach-O, or for every executable in the active .app bundle (the main app, XPC services, extensions, login items, helpers). Expands @executable_path, @loader_path, and @rpath through each process's LC_RPATH stack in dependents-first load order, and reports every candidate path with its outcome, the resolved image and digest, weak, re-export, upward, and lazy-load flags, including LC_LAZY_LOAD_DYLIB_INFO linkedit payloads, and derived findings such as unresolved required loads or absent earlier @rpath candidates. Pure header parsing: nothing is executed, and absolute or system paths outside the analyzed root stay undetermined. Select roots or one architecture to narrow large bundles.",
    dylibResolutionInputSchema,
  ),
] as const satisfies readonly ToolContract[];

/** Provider operations; inventory remains an internal primitive of inspection. */
export const ARTIFACT_ANALYSIS_OPERATIONS = [
  "inventory_artifact",
  ...ARTIFACT_TOOL_CONTRACTS.map(({ name }) => name),
] as const;

/** Provider-level operations including the inventory primitive used internally. */
export type ArtifactAnalysisOperation =
  (typeof ARTIFACT_ANALYSIS_OPERATIONS)[number];

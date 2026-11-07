import { createHash } from "node:crypto";

import { z } from "zod";

import { evidenceSchema, type Evidence } from "../evidence.js";
import { evidenceInputSchema } from "../evidenceReference.js";
import type { EvidenceRequestFrameInput } from "../evidenceInputContract.js";
import {
  cliMetadataGuidSchema,
  managedMetadataTokenSchema,
  managedMemberInspectionSchema,
  type ManagedMemberInspection,
} from "./managedArtifact.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import { digestSchema, prefixedDigestSchema } from "../digests.js";
import { readManagedInspectionEvidence } from "./managedInspectionEvidence.js";
import { AnalysisInputError } from "../analysisErrorCore.js";
import { EvidenceIntegrityError } from "../evidenceErrors.js";
import { err, ok, type Result } from "../result.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const textSchema = z.string().min(1);

const decompilerSchema = z.strictObject({
  name: textSchema,
  version: textSchema.nullable().default(null),
  family: z.enum(["ilspy", "dnspy", "dnlib", "mono-cecil", "other"]),
  executable_sha256: digestSchema.nullable().default(null),
  options: z.array(z.string()).default([]),
});

const managedReconstructionMethodInputSchema = z.strictObject({
  token: managedMetadataTokenSchema,
  signature_sha256: digestSchema,
  normalized_il_sha256: digestSchema.nullable(),
  reconstruction: z.strictObject({
    kind: z.enum(["decompiled-csharp", "decompiled-il", "semantic-pseudocode"]),
    language: z.enum(["csharp", "il", "pseudocode"]),
    text: textSchema,
    text_sha256: digestSchema.optional(),
    source_path: textSchema.nullable().optional(),
    start_line: z.int().min(1).nullable().optional(),
    end_line: z.int().min(1).nullable().optional(),
  }),
});

type ManagedReconstructionMethodInput = z.infer<
  typeof managedReconstructionMethodInputSchema
>;

const managedReconstructionImportRequestShape = {
  decompiler: decompilerSchema,
  methods: z.array(managedReconstructionMethodInputSchema).min(1),
  notes: z.array(textSchema).default([]),
};

const reconstructionInput = <Source extends z.ZodType>(source: Source) =>
  z.strictObject({
    ...managedReconstructionImportRequestShape,
    static_members: source,
  });

/** Complete semantic reconstruction input with its original source record. */
export const managedReconstructionImportInputSchema =
  reconstructionInput(evidenceSchema);

/** Public reconstruction request accepts records inline or by exact retained identity. */
export const managedReconstructionImportRequestSchema =
  reconstructionInput(evidenceInputSchema);

const importedMethodSchema = z.strictObject({
  token: managedMetadataTokenSchema,
  declaring_type: z.string().nullable(),
  name: z.string(),
  signature_sha256: digestSchema,
  normalized_il_sha256: digestSchema.nullable(),
  body_sha256: digestSchema.nullable(),
  il_size: z.int().min(0),
  reconstruction: z.strictObject({
    kind: z.enum(["decompiled-csharp", "decompiled-il", "semantic-pseudocode"]),
    language: z.enum(["csharp", "il", "pseudocode"]),
    text: textSchema,
    text_sha256: digestSchema,
    text_length: z.int().min(1),
    line_count: z.int().min(1),
    source_path: textSchema.nullable(),
    start_line: z.int().min(1).nullable(),
    end_line: z.int().min(1).nullable(),
  }),
  validation: z.strictObject({
    matched_static_member: z.literal(true),
    exact_build_required: z.literal(true),
    canonical_observation: z.literal(false),
    confidence_floor: z.literal("inference"),
  }),
});

export const managedReconstructionImportResultSchema = z.strictObject({
  reconstruction_id: prefixedDigestSchema("mre"),
  phase: z.literal("reconstruction-import"),
  executed: z.literal(false),
  static_observation: z.strictObject({
    evidence_id: evidenceIdSchema,
    artifact_sha256: digestSchema,
    artifact_path: z.string().min(1),
    byte_length: z.int().min(0),
    module_name: z.string().nullable(),
    mvid: cliMetadataGuidSchema.nullable(),
    metadata_status: z.enum(["absent", "complete", "partial", "malformed"]),
  }),
  decompiler: decompilerSchema.extend({
    options_sha256: digestSchema,
  }),
  summary: z.strictObject({
    imported_methods: z.int().min(1),
    decompiled_csharp_methods: z.int().min(0),
    decompiled_il_methods: z.int().min(0),
    pseudocode_methods: z.int().min(0),
    total_text_bytes: z.int().min(1),
  }),
  methods: z.array(importedMethodSchema).min(1),
  notes: z.array(textSchema),
  evidence_links: z.array(evidenceIdSchema).length(1),
  limitations: z.array(textSchema),
});

export type ManagedReconstructionImportInput = z.infer<
  typeof managedReconstructionImportInputSchema
>;
export type ManagedReconstructionImportRequest =
  EvidenceRequestFrameInput<ManagedReconstructionImportInput>;
export type ManagedReconstructionImportResult = z.infer<
  typeof managedReconstructionImportResultSchema
>;

type Member = ManagedMemberInspection["methods"][number];
type ImportedMethod = ManagedReconstructionImportResult["methods"][number];
type StaticObservation =
  ManagedReconstructionImportResult["static_observation"];

const sha256Text = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const countLines = (text: string): number =>
  text.length === 0 ? 0 : text.split(/\r\n|\r|\n/u).length;

const findObservedMethod = (
  members: ManagedMemberInspection,
  candidate: ManagedReconstructionMethodInput,
): Member | undefined =>
  members.methods.find(
    (item) =>
      item.token === candidate.token &&
      item.signature.raw_sha256 === candidate.signature_sha256 &&
      item.body.status === "present" &&
      item.body.normalized_il_sha256 !== null &&
      candidate.normalized_il_sha256 !== null &&
      item.body.normalized_il_sha256 === candidate.normalized_il_sha256,
  );

const buildImportedMethod = (
  observed: Member,
  candidate: ManagedReconstructionMethodInput,
  textSha256: string,
): ImportedMethod => ({
  token: observed.token,
  declaring_type: observed.declaring_type,
  name: observed.name,
  signature_sha256: observed.signature.raw_sha256,
  normalized_il_sha256: observed.body.normalized_il_sha256,
  body_sha256: observed.body.il_sha256,
  il_size: observed.body.il_size,
  reconstruction: {
    kind: candidate.reconstruction.kind,
    language: candidate.reconstruction.language,
    text: candidate.reconstruction.text,
    text_sha256: textSha256,
    text_length: candidate.reconstruction.text.length,
    line_count: countLines(candidate.reconstruction.text),
    source_path: candidate.reconstruction.source_path ?? null,
    start_line: candidate.reconstruction.start_line ?? null,
    end_line: candidate.reconstruction.end_line ?? null,
  },
  validation: {
    matched_static_member: true as const,
    exact_build_required: true as const,
    canonical_observation: false as const,
    confidence_floor: "inference" as const,
  },
});

const buildReconstructionSummary = (
  methods: readonly ImportedMethod[],
): ManagedReconstructionImportResult["summary"] => ({
  imported_methods: methods.length,
  decompiled_csharp_methods: methods.filter(
    ({ reconstruction }) => reconstruction.kind === "decompiled-csharp",
  ).length,
  decompiled_il_methods: methods.filter(
    ({ reconstruction }) => reconstruction.kind === "decompiled-il",
  ).length,
  pseudocode_methods: methods.filter(
    ({ reconstruction }) => reconstruction.kind === "semantic-pseudocode",
  ).length,
  total_text_bytes: methods.reduce(
    (total, { reconstruction }) =>
      total + Buffer.byteLength(reconstruction.text, "utf8"),
    0,
  ),
});

const buildStaticObservation = (
  staticEvidence: Evidence,
  members: ManagedMemberInspection,
): StaticObservation => ({
  evidence_id: staticEvidence.evidence_id,
  artifact_sha256: members.artifact.sha256,
  artifact_path: members.artifact.path,
  byte_length: members.artifact.byte_length,
  module_name: members.module?.name ?? null,
  mvid: members.module?.mvid ?? null,
  metadata_status: members.metadata.status,
});

const buildDecompilerRecord = (
  decompiler: ManagedReconstructionImportInput["decompiler"],
): ManagedReconstructionImportResult["decompiler"] => ({
  ...decompiler,
  options_sha256: digestCanonicalValue(
    decompiler.options,
    "Managed reconstruction",
  ),
});

const RECONSTRUCTION_LIMITATIONS = [
  "Decompiler output is imported as reconstruction evidence and analyst inference; metadata and IL observations remain canonical.",
  "This operation did not execute, load, reflect over, debug, instrument, patch, or decompile the target artifact.",
  "The imported reconstruction is valid only for the exact artifact SHA-256, MVID, method signature, and normalized IL shape recorded here.",
  "Obfuscated names, decompiler variables, and control-flow restructuring are not treated as proof without separate validation.",
];

const buildReconstructionWithoutId = (
  input: ManagedReconstructionImportRequest,
  staticEvidence: Evidence,
  members: ManagedMemberInspection,
  methods: readonly ImportedMethod[],
): Omit<ManagedReconstructionImportResult, "reconstruction_id"> => ({
  phase: "reconstruction-import" as const,
  executed: false as const,
  static_observation: buildStaticObservation(staticEvidence, members),
  decompiler: buildDecompilerRecord(input.decompiler),
  summary: buildReconstructionSummary(methods),
  methods: [...methods],
  notes: input.notes,
  evidence_links: [staticEvidence.evidence_id],
  limitations: RECONSTRUCTION_LIMITATIONS,
});

export interface ResolvedManagedReconstructionImport {
  readonly request: ManagedReconstructionImportRequest;
  readonly staticEvidence: Evidence;
  readonly members: ManagedMemberInspection;
  readonly methods: readonly ImportedMethod[];
}

/** Parse the managed member facts once, then validate every caller lock at its request path. */
export const resolveManagedReconstructionImport = (
  input: ManagedReconstructionImportRequest,
): Result<
  ResolvedManagedReconstructionImport,
  AnalysisInputError | EvidenceIntegrityError
> => {
  const source = readManagedInspectionEvidence(
    input.static_members,
    "inspect_managed_members",
    managedMemberInspectionSchema,
    { operation: "import_managed_reconstruction", path: ["static_members"] },
  );
  if (!source.ok) return source;

  const methods: ImportedMethod[] = [];
  for (const [index, candidate] of input.methods.entries()) {
    const observed = findObservedMethod(source.value.result, candidate);
    if (observed === undefined) {
      const message = `Reconstruction method lock ${candidate.token} does not match a static managed member observation`;
      return err(
        new AnalysisInputError("import_managed_reconstruction", {}, [
          { path: ["methods", index], reason: "invalid_value", message },
        ]),
      );
    }
    const textSha256 = sha256Text(candidate.reconstruction.text);
    if (
      candidate.reconstruction.text_sha256 !== undefined &&
      candidate.reconstruction.text_sha256 !== textSha256
    ) {
      const message = `Reconstruction text hash mismatch for ${candidate.token}`;
      return err(
        new AnalysisInputError("import_managed_reconstruction", {}, [
          {
            path: ["methods", index, "reconstruction", "text_sha256"],
            reason: "invalid_value",
            message,
          },
        ]),
      );
    }
    methods.push(buildImportedMethod(observed, candidate, textSha256));
  }
  return ok({
    request: input,
    staticEvidence: source.value.evidence,
    members: source.value.result,
    methods,
  });
};

/** Build the import solely from facts authenticated and validated by the resolver. */
export const executeManagedReconstructionImport = (
  resolved: ResolvedManagedReconstructionImport,
): ManagedReconstructionImportResult => {
  const withoutId = buildReconstructionWithoutId(
    resolved.request,
    resolved.staticEvidence,
    resolved.members,
    resolved.methods,
  );
  return managedReconstructionImportResultSchema.parse({
    ...withoutId,
    reconstruction_id: `mre_${digestCanonicalValue(
      withoutId,
      "Managed reconstruction",
    )}`,
  });
};

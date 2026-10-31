import { readEvidencePayload } from "./evidenceValidation.js";
import type { EvidenceIntegrityError } from "./evidenceErrors.js";
import { ok, type Result } from "./result.js";
import {
  canBorrowParsedJsonSnapshot,
  immutableJsonSnapshotMember,
} from "./immutableJson.js";
import {
  artifactDfuCrc32PairSchema,
  artifactIntegrityPairOf,
  artifactSha256PairSchema,
  artifactMd5PairSchema,
} from "./artifactIntegrity.js";
import { z } from "zod";

import {
  artifactInventoryResultSchema,
  type ArtifactInventoryResult,
} from "./artifactGraph.js";
import { digestCanonicalValue } from "./canonicalDigest.js";
import { isJavaScriptSourcePath } from "./javascript/javascriptArtifactFiles.js";
import { admitRawBinary } from "./rawBinary.js";
import { uniqueSorted } from "./canonicalOrdering.js";
import { evidenceSchema, parseEvidence, type Evidence } from "./evidence.js";
import { offsetText } from "./firmware/espImageStructures.js";
import { jsonValueSchema } from "./jsonValue.js";
import { prefixedDigestSchema } from "./../domain/digests.js";

const textSchema = z.string().min(1);
const evidenceIdSchema = prefixedDigestSchema("ev");
const artifactIdSchema = prefixedDigestSchema("art");

const inspectionObservationSchema = z.strictObject({
  observation_id: prefixedDigestSchema("aio"),
  kind: z.enum([
    "root-manifest",
    "integrity",
    "container-header",
    "reconstruction",
  ]),
  subject: textSchema,
  value: jsonValueSchema,
  evidence_id: evidenceIdSchema,
});

const inspectionHypothesisSchema = z.strictObject({
  hypothesis_id: prefixedDigestSchema("aih"),
  statement: textSchema,
  confidence: z.enum(["medium", "low"]),
  basis_evidence_ids: z.array(evidenceIdSchema).min(1),
  limitation: textSchema,
});

const inspectionContradictionBaseSchema = z.strictObject({
  contradiction_id: prefixedDigestSchema("aic"),
  statement: textSchema,
  occurrence_id: prefixedDigestSchema("occ"),

  evidence_id: evidenceIdSchema,
});

const inspectionContradictionSchema = z.union([
  inspectionContradictionBaseSchema.extend(artifactSha256PairSchema.shape),
  inspectionContradictionBaseSchema.extend(artifactMd5PairSchema.shape),
  inspectionContradictionBaseSchema.extend(artifactDfuCrc32PairSchema.shape),
]);

const nextProbeSchema = z.strictObject({
  operation: textSchema,
  rationale: textSchema,
  authority: z.enum([
    "artifact-bytes",
    "managed-static-analysis",
    "native-analysis-provider",
    "ast-static-analysis",
  ]),
});

const unexploredBranchSchema = z.strictObject({
  branch_id: prefixedDigestSchema("aib"),
  reason: z.enum(["format-specific-analysis-required", "unknown-format"]),
  detail: textSchema,
  next_probe: nextProbeSchema.nullable(),
  evidence_id: evidenceIdSchema,
});

/** Provider-neutral inspection result with its atomic source Evidence. */
export const artifactInspectionResultSchema = z.strictObject({
  inspection_id: prefixedDigestSchema("ai"),
  subject: z.strictObject({
    manifest_id: prefixedDigestSchema("agm"),
    root_artifact_id: artifactIdSchema,
    root_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    root_format: textSchema,
  }),
  substeps: z
    .array(
      z.strictObject({
        substep_id: prefixedDigestSchema("ais"),
        operation: z.literal("inventory_artifact"),
        status: z.literal("completed"),
        evidence_id: evidenceIdSchema,
        evidence: evidenceSchema.safeExtend({
          operation: z.literal("inventory_artifact"),
          normalized_result: artifactInventoryResultSchema,
        }),
      }),
    )
    .min(1),
  observations: z.array(inspectionObservationSchema),
  hypotheses: z.array(inspectionHypothesisSchema),
  contradictions: z.array(inspectionContradictionSchema),
  unexplored_branches: z.array(unexploredBranchSchema),
  next_probes: z.array(nextProbeSchema),
  coverage: z.strictObject({
    status: z.enum(["complete-within-substeps", "partial", "truncated"]),
    substeps_completed: z.int().min(1),
    observations_retained: z.int().min(0),
    observations_omitted: z.int().min(0),
    hypotheses_retained: z.int().min(0),
    hypotheses_omitted: z.int().min(0),
    unexplored_branches_retained: z.int().min(0),
    unexplored_branches_omitted: z.int().min(0),
    next_probes_retained: z.int().min(0),
    next_probes_omitted: z.int().min(0),
  }),
  evidence_links: z.array(evidenceIdSchema).min(1),
  limitations: z.array(textSchema),
});

export type ArtifactInspectionResult = z.infer<
  typeof artifactInspectionResultSchema
>;

/** Project one successful inventory Evidence record into an inspection report. */
export const createArtifactInspection = (
  inventoryInput: unknown,
): ArtifactInspectionResult => {
  const inventoryEvidence = parseInventoryEvidence(inventoryInput);
  const inventory = artifactInventoryResultSchema.parse(
    inventoryEvidence.normalized_result,
  );
  const observations = allObservations(
    inventory,
    inventoryEvidence.evidence_id,
  );
  const hypotheses = allHypotheses(inventory, inventoryEvidence.evidence_id);
  const nextProbes = probesFor(inventory);
  const branches = allUnexploredBranches(
    inventory,
    inventoryEvidence.evidence_id,
    nextProbes,
  );
  const retained = {
    observations,
    hypotheses,
    branches,
    probes: nextProbes,
  };
  const omissions = {
    observations: 0,
    hypotheses: 0,
    branches: 0,
    probes: 0,
  };
  const semantic = {
    subject: {
      manifest_id: inventory.manifest.manifest_id,
      root_artifact_id: inventory.manifest.root_artifact_id,
      root_sha256: inventory.manifest.root_sha256,
      root_format: inventory.manifest.root_format,
    },
    substeps: [
      {
        substep_id: `ais_${digestCanonicalValue(
          {
            operation: "inventory_artifact",
            evidence_id: inventoryEvidence.evidence_id,
          },
          "Artifact inspection",
        )}`,
        operation: "inventory_artifact" as const,
        status: "completed" as const,
        evidence_id: inventoryEvidence.evidence_id,
        evidence: inventoryEvidence,
      },
    ],
    observations: retained.observations,
    hypotheses: retained.hypotheses,
    contradictions: contradictions(inventory, inventoryEvidence.evidence_id),
    unexplored_branches: retained.branches,
    next_probes: retained.probes,
    coverage: {
      status: inspectionCoverage(inventory, omissions),
      substeps_completed: 1 as const,
      observations_retained: retained.observations.length,
      observations_omitted: omissions.observations,
      hypotheses_retained: retained.hypotheses.length,
      hypotheses_omitted: omissions.hypotheses,
      unexplored_branches_retained: retained.branches.length,
      unexplored_branches_omitted: omissions.branches,
      next_probes_retained: retained.probes.length,
      next_probes_omitted: omissions.probes,
    },
    evidence_links: [inventoryEvidence.evidence_id],
    limitations: uniqueSorted([
      ...inventory.limitations,
      "Inspection derives bounded static hypotheses and next probes; it does not execute the artifact or claim format-specific semantics.",
    ]),
  };
  return artifactInspectionResultSchema.parse({
    ...semantic,
    inspection_id: `ai_${digestCanonicalValue(semantic, "Artifact inspection")}`,
  });
};

const parseInventoryEvidence = (input: unknown): Evidence => {
  const evidence = parseEvidence(input);
  if (evidence.operation !== "inventory_artifact")
    throw new TypeError(
      "Artifact inspection substep requires inventory_artifact Evidence",
    );
  return evidence;
};

// Artifact, occurrence, and edge records stay in the nested inventory Evidence;
// restating each one here would repeat the complete graph in every result.
const allObservations = (
  inventory: ArtifactInventoryResult,
  evidenceId: string,
): ArtifactInspectionResult["observations"] => [
  observation(
    "root-manifest",
    inventory.manifest.root_artifact_id,
    inventory.manifest,
    evidenceId,
  ),
  ...inventory.integrity_contradictions.map((value) =>
    observation("integrity", value.contradiction_id, value, evidenceId),
  ),
  ...(inventory.ines === undefined
    ? []
    : [
        observation(
          "container-header",
          inventory.manifest.root_artifact_id,
          inventory.ines.header,
          evidenceId,
        ),
        observation(
          "reconstruction",
          inventory.manifest.root_artifact_id,
          inventory.ines.reconstruction,
          evidenceId,
        ),
      ]),
];

const observation = (
  kind: ArtifactInspectionResult["observations"][number]["kind"],
  subject: string,
  value: unknown,
  evidenceId: string,
): ArtifactInspectionResult["observations"][number] => {
  const semantic = {
    kind,
    subject,
    value: jsonValueSchema.parse(value),
    evidence_id: evidenceId,
  };
  return {
    observation_id: `aio_${digestCanonicalValue(semantic, "Artifact inspection")}`,
    ...semantic,
  };
};

const allHypotheses = (
  inventory: ArtifactInventoryResult,
  evidenceId: string,
): ArtifactInspectionResult["hypotheses"] => {
  const statements =
    inventory.manifest.root_format === "pe"
      ? [
          "The PE artifact may contain managed CLI metadata or native code; inventory bytes alone do not distinguish them.",
        ]
      : ["asar", "javascript-bundle"].includes(inventory.manifest.root_format)
        ? [
            "The artifact may contain a recoverable JavaScript application graph.",
          ]
        : [];
  return statements.map((statement) => {
    const semantic = {
      statement,
      confidence: "low" as const,
      basis_evidence_ids: [evidenceId],
      limitation:
        "Format classification proposes a bounded follow-up; it is not semantic proof.",
    };
    return {
      hypothesis_id: `aih_${digestCanonicalValue(semantic, "Artifact inspection")}`,
      ...semantic,
    };
  });
};

const contradictions = (
  inventory: ArtifactInventoryResult,
  evidenceId: string,
): ArtifactInspectionResult["contradictions"] =>
  inventory.integrity_contradictions.map((value) => {
    const semantic = {
      statement:
        value.logical_path === "."
          ? "The container's declared integrity contradicts its observed bytes."
          : `Declared integrity for ${value.logical_path} contradicts observed bytes.`,
      occurrence_id: value.occurrence_id,
      ...artifactIntegrityPairOf(value),
      evidence_id: evidenceId,
    };
    return {
      contradiction_id: `aic_${digestCanonicalValue(semantic, "Artifact inspection")}`,
      ...semantic,
    };
  });

const probesFor = (
  inventory: ArtifactInventoryResult,
): ArtifactInspectionResult["next_probes"] => {
  const format = inventory.manifest.root_format;
  // The JavaScript analyzer selects extracted files by source suffix, so a
  // main script such as `main` has no follow-up it can read.
  if (format === "node-sea")
    return inventory.occurrences.some(
      (row) =>
        row.format_metadata?.kind === "node-sea-entry" &&
        row.format_metadata.role === "main-script" &&
        isJavaScriptSourcePath(row.logical_path),
    )
      ? [
          {
            operation: "analyze_javascript_application",
            rationale:
              "Extract the SEA main script with extract_artifact, then analyze the extracted JavaScript application.",
            authority: "ast-static-analysis",
          },
        ]
      : [];
  if (
    format === "intel-hex" ||
    format === "srec" ||
    format === "uf2" ||
    format === "dfuse"
  )
    return inventory.occurrences.some(
      (row) =>
        row.format_metadata?.kind === "hex-record-region" ||
        row.format_metadata?.kind === "uf2-region" ||
        row.format_metadata?.kind === "dfuse-element",
    )
      ? [
          {
            operation: "open_binary",
            rationale:
              "Extract regions with extract_artifact, then open one with format raw-binary, a caller-chosen architecture, and entry_point set to the region start address (raw-binary maps file offset 0 at entry_point).",
            authority: "native-analysis-provider",
          },
        ]
      : [];
  if (format === "esp-image") return espFlashDumpProbes(inventory);
  if (format === "fit") return fitProbes(inventory);
  return format === "directory"
    ? directoryProbes(inventory)
    : probesForFormat(format);
};

// An ESP image that its reader found at the start of a flash dump read from
// a later address is better read as that dump.
const espFlashDumpProbes = (
  inventory: ArtifactInventoryResult,
): ArtifactInspectionResult["next_probes"] => {
  const root = inventory.occurrences.find(
    ({ logical_path }) => logical_path === ".",
  )?.format_metadata;
  if (root?.kind !== "esp-image") return [];
  // Evidence recorded before REA reported the origin has no hint to offer.
  const dump = root.flash_dump;
  if (dump === null || dump === undefined) return [];
  const offset = offsetText(dump.flash_offset);
  return [
    {
      operation: "open_binary",
      rationale: `Reopen the file with format esp-flash-image and flash_offset ${offset}, then inspect_artifact: it is a flash dump read from flash ${offset}, with a partition table at file offset ${offsetText(dump.table_file_offset)}.`,
      authority: "artifact-bytes",
    },
  ];
};

const fitProbes = (
  inventory: ArtifactInventoryResult,
): ArtifactInspectionResult["next_probes"] => {
  // Extraction keeps stored bytes, so only plain images are directly analyzable.
  const images = inventory.occurrences.flatMap((row) =>
    row.format_metadata?.kind === "fit-image" &&
    row.format_metadata.compression === "none" &&
    row.format_metadata.cipher_present === false
      ? [{ row, image: row.format_metadata }]
      : [],
  );
  let rawProbe: ArtifactInspectionResult["next_probes"][number] | undefined;
  for (const { row, image } of images) {
    if (row.declared_size === null) continue;
    if (image.entry !== null && image.entry !== image.load) continue;
    // An unavailable entry is not proof that the declaration was absent.
    if (image.unreadable_fields.includes("entry")) continue;
    const admitted = admitRawBinary({
      architecture: image.arch,
      entryPoint: image.load,
      fileBytes: row.declared_size,
    });
    if (!admitted.ok) continue;
    rawProbe = {
      operation: "open_binary",
      rationale: `Extract ${JSON.stringify(row.logical_path)} with extract_artifact, then open those uncompressed, unciphered bytes with format raw-binary, architecture ${admitted.value.architecture} and entry_point ${admitted.value.entryPoint}. This maps offset 0 and seeds analysis at that address; the declared entry is absent or equal to load.`,
      authority: "native-analysis-provider",
    };
    break;
  }
  return [
    ...(images.some(({ image }) => image.type === "flat_dt")
      ? [
          {
            operation: "inspect_devicetree",
            rationale:
              "Extract images with extract_artifact, then inspect uncompressed, unciphered flat_dt images with inspect_devicetree.",
            authority: "artifact-bytes" as const,
          },
        ]
      : []),
    ...(rawProbe === undefined ? [] : [rawProbe]),
  ];
};

// An application bundle directory is only a container, so its probes follow
// the formats it holds: a bundle of Mach-O executables is not a JavaScript tree.
// Formats are ordered so a repeated operation keeps its most general rationale.
const DIRECTORY_MEMBER_FORMATS: readonly ArtifactInventoryResult["manifest"]["root_format"][] =
  [
    "asar",
    "javascript-bundle",
    "mach-o-universal",
    "mach-o",
    "elf",
    "pe",
    "plist",
  ];

const directoryProbes = (
  inventory: ArtifactInventoryResult,
): ArtifactInspectionResult["next_probes"] => {
  // JavaScript acquisition does not follow symlinks. Other probes retain
  // their own applicability rules; plist inspection follows readable links.
  const present = new Set(
    inventory.occurrences
      .filter(
        ({ entry_kind, artifact_format }) =>
          entry_kind !== "symlink" || artifact_format !== "javascript-bundle",
      )
      .map(({ artifact_format }) => artifact_format),
  );
  const members = DIRECTORY_MEMBER_FORMATS.filter((memberFormat) =>
    present.has(memberFormat),
  );
  const probes = members.flatMap(probesForFormat);
  return probes.filter(
    (probe, index) =>
      probes.findIndex(({ operation }) => operation === probe.operation) ===
      index,
  );
};

const probesForFormat = (
  format: ArtifactInventoryResult["manifest"]["root_format"],
): ArtifactInspectionResult["next_probes"] => {
  if (format === "bun-standalone")
    return [
      {
        operation: "extract_artifact",
        authority: "artifact-bytes",
        rationale:
          "Extract the stored module regions into a fresh owned directory, then inspect compatible source separately. Bytecode and source-map regions remain stored evidence; they are not decoded or executed.",
      },
    ];
  if (format === "dotnet-bundle")
    return [
      {
        operation: "extract_artifact",
        rationale:
          "Extract members into a fresh owned directory, then inspect candidate files separately; bundle declarations do not establish their format.",
        authority: "artifact-bytes",
      },
    ];
  if (["asar", "javascript-bundle"].includes(format))
    return [
      {
        operation: "analyze_javascript_application",
        rationale:
          "Recover bounded JavaScript modules, source maps, Electron boundaries, and application relationships.",
        authority: "ast-static-analysis",
      },
    ];
  if (format === "pe")
    return [
      {
        operation: "inspect_managed_artifact",
        rationale:
          "Check execution-free CLI metadata before choosing a deep native provider.",
        authority: "managed-static-analysis",
      },
      {
        operation: "open_binary",
        rationale:
          "Open as native code only when managed inspection reports a native or mixed boundary.",
        authority: "native-analysis-provider",
      },
    ];
  if (["mach-o", "mach-o-universal", "elf"].includes(format))
    return [
      {
        operation: "open_binary",
        rationale:
          "Bind one deep native provider before function-level analysis.",
        authority: "native-analysis-provider",
      },
    ];
  if (format === "plist")
    return [
      {
        operation: "inspect_plist",
        rationale: "Parse property-list values without executing the artifact.",
        authority: "artifact-bytes",
      },
    ];
  return [];
};

const allUnexploredBranches = (
  inventory: ArtifactInventoryResult,
  evidenceId: string,
  nextProbes: ArtifactInspectionResult["next_probes"],
): ArtifactInspectionResult["unexplored_branches"] => {
  const branches: ArtifactInspectionResult["unexplored_branches"] = [];
  branches.push(
    ...nextProbes.map((probe) =>
      branch(
        "format-specific-analysis-required",
        `${probe.operation} was not run by provider-neutral artifact inspection.`,
        probe,
        evidenceId,
      ),
    ),
  );
  if (inventory.manifest.root_format === "unknown")
    branches.push(
      branch(
        "unknown-format",
        "Artifact bytes did not match an admitted format classifier.",
        null,
        evidenceId,
      ),
    );
  return branches;
};

const branch = (
  reason: ArtifactInspectionResult["unexplored_branches"][number]["reason"],
  detail: string,
  nextProbe: ArtifactInspectionResult["next_probes"][number] | null,
  evidenceId: string,
): ArtifactInspectionResult["unexplored_branches"][number] => {
  const semantic = {
    reason,
    detail,
    next_probe: nextProbe,
    evidence_id: evidenceId,
  };
  return {
    branch_id: `aib_${digestCanonicalValue(semantic, "Artifact inspection")}`,
    ...semantic,
  };
};

// A completed substep establishes only the coverage its producer examined, so
// unknown inventory traversal keeps the inspection partial, never complete.
const inspectionCoverage = (
  inventory: ArtifactInventoryResult,
  omissions: Readonly<Record<string, number>>,
): ArtifactInspectionResult["coverage"]["status"] => {
  if (Object.values(omissions).some((count) => count > 0)) return "truncated";
  if (inventory.coverage.status !== "complete") return "partial";
  return "complete-within-substeps";
};

/** Select source records from a typed inspection, preserving sealed child ownership. */
export const artifactInspectionSources = (
  inspection: ArtifactInspectionResult,
): readonly Evidence[] => {
  const substeps = immutableJsonSnapshotMember(inspection, "substeps");
  return Object.freeze(
    inspection.substeps.map((step, index) => {
      const ownedStep = immutableJsonSnapshotMember(substeps, String(index));
      immutableJsonSnapshotMember(ownedStep, "evidence");
      return step.evidence;
    }),
  );
};

/** Validate an unknown inspection before selecting its atomic source closure. */
export const readArtifactInspectionSources = (
  result: unknown,
): Result<readonly Evidence[], EvidenceIntegrityError> => {
  const parsed = readEvidencePayload(artifactInspectionResultSchema, result);
  if (!parsed.ok) return parsed;
  const inspection = canBorrowParsedJsonSnapshot(result, parsed.value)
    ? result
    : parsed.value;
  return ok(artifactInspectionSources(inspection));
};

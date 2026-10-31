import { compareUnicodeCodePoints } from "./unicodeCodePointOrder.js";
import { z } from "zod";

import type {
  ArtifactInventoryResult,
  ArtifactNode,
  ArtifactOccurrence,
} from "./artifactGraph.js";
import { AnalysisInputError } from "./analysisErrorCore.js";
import {
  ArtifactInventoryCarrierError,
  hasCompleteInventoryCoverage,
  parseArtifactInventoryEvidence,
  type InventorySet,
} from "./artifactInventoryEvidence.js";
import {
  dfuSeElementDeclaration,
  espFlashPartitionDeclaration,
  espImageSegmentDeclaration,
  fitImageDeclaration,
  nodeSeaEntryDeclaration,
  pyInstallerEntryDeclaration,
} from "./artifactFormatMetadata.js";
import { prefixedDigestSchema } from "./../domain/digests.js";
import { canonicalJson } from "./comparisonSemantics.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const comparisonStatusSchema = z.enum([
  "unchanged",
  "added",
  "removed",
  "changed",
  "truncated",
  "unknown",
  "contradiction",
]);
const changeKindSchema = z.enum([
  "added",
  "removed",
  "changed",
  "unknown",
  "contradiction",
]);
const comparisonDimensionSchema = z.enum([
  "content",
  "kind",
  "format",
  "size",
  "executable",
  "relations",
  "metadata",
  "availability",
  "integrity",
]);
/** One path-classified artifact change with citations to both observations. */
const artifactChangeSchema = z.object({
  classification: changeKindSchema,
  logical_path: z.string().min(1),
  dimensions: z.array(comparisonDimensionSchema).min(1),
  left_occurrence_id: z
    .string()
    .regex(/^occ_[a-f0-9]{64}$/u)
    .nullable(),
  right_occurrence_id: z
    .string()
    .regex(/^occ_[a-f0-9]{64}$/u)
    .nullable(),
  left_artifact_id: z
    .string()
    .regex(/^art_[a-f0-9]{64}$/u)
    .nullable(),
  right_artifact_id: z
    .string()
    .regex(/^art_[a-f0-9]{64}$/u)
    .nullable(),
  evidence_links: z.array(evidenceIdSchema).min(2),
});

/** Deterministic artifact comparison with every change returned inline. */
export const artifactComparisonResultSchema = z.object({
  status: comparisonStatusSchema,
  left_manifest_id: prefixedDigestSchema("agm"),
  right_manifest_id: prefixedDigestSchema("agm"),
  summary: z.object({
    unchanged: z.int().min(0),
    added: z.int().min(0),
    removed: z.int().min(0),
    changed: z.int().min(0),
    unknown: z.int().min(0),
    contradiction: z.int().min(0).default(0),
  }),
  changes: z.array(artifactChangeSchema),
  // Absent on legacy records; absence does not identify a contradicting side.
  integrity_mismatch_evidence_ids: z.array(evidenceIdSchema).optional(),
  limitations: z.array(z.string()),
});

export type ArtifactComparisonResult = z.infer<
  typeof artifactComparisonResultSchema
>;
type ArtifactChange = z.infer<typeof artifactChangeSchema>;

const comparisonInventory = (input: unknown, side: "left" | "right") => {
  try {
    return parseArtifactInventoryEvidence(input);
  } catch (cause: unknown) {
    if (!(cause instanceof ArtifactInventoryCarrierError)) throw cause;
    throw new AnalysisInputError(
      "compare_artifacts",
      { cause, userMessage: cause.message },
      [{ path: [side], reason: "invalid_value", message: cause.message }],
    );
  }
};

/** Compare complete inventory evidence without treating missing evidence as equality. */
export const compareArtifacts = (
  leftEvidence: unknown,
  rightEvidence: unknown,
): ArtifactComparisonResult => {
  const left = comparisonInventory(leftEvidence, "left");
  const right = comparisonInventory(rightEvidence, "right");
  const leftComplete = left.inventory.complete;
  const rightComplete = right.inventory.complete;
  const sameScope =
    left.inventory.coverage.scope === right.inventory.coverage.scope;
  const rootCoverageComplete =
    sameScope &&
    left.inventory.complete &&
    right.inventory.complete &&
    left.inventory.coverage.status === "complete" &&
    right.inventory.coverage.status === "complete";
  const entryCoverageComplete =
    rootCoverageComplete &&
    left.inventory.coverage.scope === "container-entries";
  const leftCovered =
    sameScope &&
    hasCompleteInventoryCoverage(left.inventory, left.inventory.coverage.scope);
  const rightCovered =
    sameScope &&
    hasCompleteInventoryCoverage(
      right.inventory,
      right.inventory.coverage.scope,
    );
  const fullyCovered =
    leftCovered &&
    rightCovered &&
    (entryCoverageComplete ||
      (rootCoverageComplete &&
        left.inventory.manifest.occurrence_count === 1 &&
        right.inventory.manifest.occurrence_count === 1));
  const leftOccurrencesByPath = occurrencesByPath(left.inventory.occurrences);
  const rightOccurrencesByPath = occurrencesByPath(right.inventory.occurrences);
  const comparison = compareOccurrences(
    left.inventory,
    right.inventory,
    leftOccurrencesByPath,
    rightOccurrencesByPath,
    [
      ...left.evidence.map(({ evidence_id: id }) => id),
      ...right.evidence.map(({ evidence_id: id }) => id),
    ],
    { root: rootCoverageComplete, entries: entryCoverageComplete },
  );
  const changes = comparison.changes;
  const limitations = [
    ...left.inventory.limitations.map((item) => `Left: ${item}`),
    ...right.inventory.limitations.map((item) => `Right: ${item}`),
    ...(leftComplete ? [] : ["Left artifact inventory is incomplete."]),
    ...(rightComplete ? [] : ["Right artifact inventory is incomplete."]),
    ...(sameScope ? [] : ["Artifact inventory scopes differ."]),
    ...(sameScope &&
    left.inventory.coverage.scope === "root" &&
    (left.inventory.manifest.occurrence_count > 1 ||
      right.inventory.manifest.occurrence_count > 1)
      ? ["Container entry coverage is unavailable for child paths."]
      : []),
    ...(left.inventory.coverage.status === "complete"
      ? []
      : ["Left artifact inventory traversal coverage is unknown."]),
    ...(right.inventory.coverage.status === "complete"
      ? []
      : ["Right artifact inventory traversal coverage is unknown."]),
    ...(comparison.hasUnknownAsarPacking
      ? [
          "ASAR packing metadata is recorded on only one side for matching paths; omitted metadata may be a legacy observation and does not establish packed or unpacked storage.",
        ]
      : []),
    ...(comparison.hasUnknownNodeSeaMetadata
      ? [
          "Node SEA member metadata is recorded on only one side for matching paths; omitted metadata may be a legacy observation and leaves the complete runtime member declaration unavailable.",
        ]
      : []),
    ...(comparison.hasAmbiguousDuplicatePaths
      ? [
          "Duplicate logical paths cannot be paired across inventories; comparisons for those paths are unknown.",
        ]
      : []),
  ];
  applyRootHashChange(left.inventory, right.inventory, changes, [
    ...left.evidence.map(({ evidence_id: id }) => id),
    ...right.evidence.map(({ evidence_id: id }) => id),
  ]);
  const summary = summarize(
    left.inventory,
    right.inventory,
    changes,
    fullyCovered,
  );
  return artifactComparisonResultSchema.parse({
    status:
      !leftComplete || !rightComplete
        ? "truncated"
        : changes.some(
              ({ classification }) => classification === "contradiction",
            )
          ? "contradiction"
          : !fullyCovered
            ? "unknown"
            : changes.some(({ classification }) => classification === "unknown")
              ? "unknown"
              : changes.length === 0
                ? "unchanged"
                : "changed",
    left_manifest_id: left.inventory.manifest.manifest_id,
    right_manifest_id: right.inventory.manifest.manifest_id,
    summary,
    changes,
    integrity_mismatch_evidence_ids: [
      ...new Set(
        [left, right].flatMap((source) =>
          source.inventory.occurrences.some(
            (occurrence) => occurrence.hash_status === "mismatched",
          )
            ? source.evidence.map((record) => record.evidence_id)
            : [],
        ),
      ),
    ].sort(compareUnicodeCodePoints),
    limitations: [...new Set(limitations)].sort(compareUnicodeCodePoints),
  });
};

const compareOccurrences = (
  left: InventorySet,
  right: InventorySet,
  leftByPath: ReadonlyMap<string, ArtifactOccurrence[]>,
  rightByPath: ReadonlyMap<string, ArtifactOccurrence[]>,
  evidenceLinks: readonly string[],
  coverage: { readonly root: boolean; readonly entries: boolean },
): {
  readonly changes: ArtifactChange[];
  readonly hasAmbiguousDuplicatePaths: boolean;
  readonly hasUnknownAsarPacking: boolean;
  readonly hasUnknownNodeSeaMetadata: boolean;
} => {
  const leftNodes = new Map(left.nodes.map((item) => [item.artifact_id, item]));
  const rightNodes = new Map(
    right.nodes.map((item) => [item.artifact_id, item]),
  );
  const leftRelations = relationsByPath(left);
  const rightRelations = relationsByPath(right);
  const paths = [
    ...new Set([...leftByPath.keys(), ...rightByPath.keys()]),
  ].sort(compareUnicodeCodePoints);
  const output: ArtifactChange[] = [];
  let hasAmbiguousDuplicatePaths = false;
  let hasUnknownAsarPacking = false;
  let hasUnknownNodeSeaMetadata = false;
  for (const path of paths) {
    const leftMatches = leftByPath.get(path) ?? [];
    const rightMatches = rightByPath.get(path) ?? [];
    if (leftMatches.length > 1 || rightMatches.length > 1) {
      hasAmbiguousDuplicatePaths = true;
      output.push({
        logical_path: path,
        classification: "unknown",
        dimensions: ["availability"],
        left_occurrence_id: null,
        right_occurrence_id: null,
        left_artifact_id: null,
        right_artifact_id: null,
        evidence_links: [...evidenceLinks],
      });
      continue;
    }
    const leftOccurrence = leftMatches[0];
    const rightOccurrence = rightMatches[0];
    const metadata = occurrenceMetadata({ leftOccurrence, rightOccurrence });
    if (leftOccurrence !== undefined && rightOccurrence !== undefined) {
      if (metadata.asarPacking === "unknown") hasUnknownAsarPacking = true;
      if (metadata.nodeSea === "unknown") hasUnknownNodeSeaMetadata = true;
    }
    const change = classifyPath({
      metadata,
      path,
      leftOccurrence,
      rightOccurrence,
      leftNode: nodeFor(leftOccurrence, leftNodes),
      rightNode: nodeFor(rightOccurrence, rightNodes),
      leftRelations: leftRelations.get(path) ?? [],
      rightRelations: rightRelations.get(path) ?? [],
      rootCovered: coverage.root,
      entriesCovered: coverage.entries,
      evidenceLinks,
    });
    if (change !== null) output.push(change);
  }
  return {
    changes: output,
    hasAmbiguousDuplicatePaths,
    hasUnknownAsarPacking,
    hasUnknownNodeSeaMetadata,
  };
};

const occurrencesByPath = (
  occurrences: readonly ArtifactOccurrence[],
): ReadonlyMap<string, ArtifactOccurrence[]> => {
  const output = new Map<string, ArtifactOccurrence[]>();
  for (const occurrence of occurrences) {
    const matches = output.get(occurrence.logical_path);
    if (matches === undefined)
      output.set(occurrence.logical_path, [occurrence]);
    else matches.push(occurrence);
  }
  return output;
};

interface ClassifyPathInput {
  readonly metadata: OccurrenceMetadata;
  readonly path: string;
  readonly leftOccurrence: ArtifactOccurrence | undefined;
  readonly rightOccurrence: ArtifactOccurrence | undefined;
  readonly leftNode: ArtifactNode | undefined;
  readonly rightNode: ArtifactNode | undefined;
  readonly leftRelations: readonly RelationProjection[];
  readonly rightRelations: readonly RelationProjection[];
  readonly rootCovered: boolean;
  readonly entriesCovered: boolean;
  readonly evidenceLinks: readonly string[];
}

const buildArtifactChangeBase = (input: ClassifyPathInput) => ({
  logical_path: input.path,
  left_occurrence_id: input.leftOccurrence?.occurrence_id ?? null,
  right_occurrence_id: input.rightOccurrence?.occurrence_id ?? null,
  left_artifact_id: input.leftOccurrence?.artifact_id ?? null,
  right_artifact_id: input.rightOccurrence?.artifact_id ?? null,
  evidence_links: [...input.evidenceLinks],
});

const classifyPresence = (
  input: ClassifyPathInput,
  base: ReturnType<typeof buildArtifactChangeBase>,
): ArtifactChange | null => {
  const covered = input.path === "." ? input.rootCovered : input.entriesCovered;
  if (input.leftOccurrence === undefined)
    return {
      ...base,
      classification: covered ? "added" : "unknown",
      dimensions: [covered ? "content" : "availability"],
    };
  if (input.rightOccurrence === undefined)
    return {
      ...base,
      classification: covered ? "removed" : "unknown",
      dimensions: [covered ? "content" : "availability"],
    };
  return null;
};

const classifyIntegrity = (
  input: ClassifyPathInput,
  base: ReturnType<typeof buildArtifactChangeBase>,
): ArtifactChange | null => {
  if (
    input.leftOccurrence?.hash_status === "mismatched" ||
    input.rightOccurrence?.hash_status === "mismatched"
  )
    return {
      ...base,
      classification: "contradiction",
      dimensions: ["integrity"],
    };
  return null;
};

const classifyAvailability = (
  input: ClassifyPathInput,
  base: ReturnType<typeof buildArtifactChangeBase>,
): ArtifactChange | null => {
  if (
    input.leftOccurrence?.hash_status !== "verified" ||
    input.rightOccurrence?.hash_status !== "verified" ||
    input.leftNode === undefined ||
    input.rightNode === undefined
  )
    return { ...base, classification: "unknown", dimensions: ["availability"] };
  return null;
};

const classifyPath = (input: ClassifyPathInput): ArtifactChange | null => {
  const base = buildArtifactChangeBase(input);
  // A declared/observed mismatch is known even without an opposite occurrence.
  const integrity = classifyIntegrity(input, base);
  if (integrity !== null) return integrity;
  const presence = classifyPresence(input, base);
  if (presence !== null) return presence;
  const declaration = classifyPyInstallerDeclaration(input, base);
  if (declaration.handled) return declaration.change;
  const availability = classifyAvailability(input, base);
  if (availability !== null) {
    const known = occurrenceDifferences(input);
    const dimensions: ArtifactChange["dimensions"] = [];
    if (known.kind) dimensions.push("kind");
    if (known.format) dimensions.push("format");
    if (known.executable) dimensions.push("executable");
    if (known.relations) dimensions.push("relations");
    if (known.metadata) dimensions.push("metadata");
    dimensions.push("availability");
    return {
      ...base,
      classification: declarationChanged(input.metadata)
        ? "changed"
        : "unknown",
      dimensions,
    };
  }
  const dimensions = changedDimensions(input);
  const occurrence = occurrenceDifferences(input);
  if (
    Object.values(input.metadata).includes("unknown") ||
    occurrence.kindUnknown ||
    occurrence.formatUnknown ||
    differsWithUnknown(input.leftNode?.format, input.rightNode?.format) ||
    differsWithMissing(
      input.leftNode?.media_type,
      input.rightNode?.media_type,
    ) ||
    differsWithMissing(
      input.leftNode?.architecture,
      input.rightNode?.architecture,
    )
  ) {
    if (dimensions.length === 0)
      return {
        ...base,
        classification: "unknown",
        dimensions: ["availability"],
      };
    dimensions.push("availability");
  }
  return dimensions.length === 0
    ? null
    : { ...base, classification: "changed", dimensions };
};

type OccurrencePair = Pick<
  ClassifyPathInput,
  "leftOccurrence" | "rightOccurrence"
>;

type MetadataComparison = "unchanged" | "changed" | "unknown";

interface OccurrenceMetadata {
  readonly asarPacking: MetadataComparison;
  readonly nodeSea: MetadataComparison;
  readonly espImageSegment: MetadataComparison;
  readonly espFlashPartition: MetadataComparison;
  readonly fitImage: MetadataComparison;
  readonly fitImageAvailability: MetadataComparison;
  readonly dfuSeElement: MetadataComparison;
  readonly pyInstaller: MetadataComparison;
}

/** A declaration that differs even when content is unavailable. */
const declarationChanged = (metadata: OccurrenceMetadata): boolean =>
  metadata.asarPacking === "changed" ||
  metadata.nodeSea === "changed" ||
  metadata.espImageSegment === "changed" ||
  metadata.espFlashPartition === "changed" ||
  metadata.fitImage === "changed" ||
  metadata.dfuSeElement === "changed";

/** Unknown classifications and absent node metadata cannot establish a difference. */
const differsWithUnknown = (
  left: string | null | undefined,
  right: string | null | undefined,
): boolean =>
  left !== right &&
  (left == null || right == null || left === "unknown" || right === "unknown");

const differsWithMissing = (
  left: string | null | undefined,
  right: string | null | undefined,
): boolean => left !== right && (left == null || right == null);

/** Occurrence facts remain independently comparable when content is unavailable. */
const occurrenceDifferences = (input: {
  readonly metadata: OccurrenceMetadata;
  readonly leftOccurrence: ArtifactOccurrence | undefined;
  readonly rightOccurrence: ArtifactOccurrence | undefined;
  readonly leftRelations: readonly RelationProjection[];
  readonly rightRelations: readonly RelationProjection[];
}) => ({
  kind:
    input.leftOccurrence?.artifact_kind !==
      input.rightOccurrence?.artifact_kind &&
    !differsWithUnknown(
      input.leftOccurrence?.artifact_kind,
      input.rightOccurrence?.artifact_kind,
    ),
  kindUnknown: differsWithUnknown(
    input.leftOccurrence?.artifact_kind,
    input.rightOccurrence?.artifact_kind,
  ),
  format:
    input.leftOccurrence?.artifact_format !==
      input.rightOccurrence?.artifact_format &&
    !differsWithUnknown(
      input.leftOccurrence?.artifact_format,
      input.rightOccurrence?.artifact_format,
    ),
  formatUnknown: differsWithUnknown(
    input.leftOccurrence?.artifact_format,
    input.rightOccurrence?.artifact_format,
  ),
  executable:
    input.leftOccurrence?.executable !== input.rightOccurrence?.executable,
  // A missing content identity prevents inventory from emitting its edges.
  // An empty projection in that case is unknown, not evidence of no relation.
  relations:
    input.leftOccurrence?.artifact_id != null &&
    input.rightOccurrence?.artifact_id != null &&
    JSON.stringify(input.leftRelations) !==
      JSON.stringify(input.rightRelations),
  metadata:
    declarationChanged(input.metadata) ||
    input.metadata.pyInstaller === "changed" ||
    input.leftOccurrence?.entry_kind !== input.rightOccurrence?.entry_kind ||
    input.leftOccurrence?.encrypted !== input.rightOccurrence?.encrypted ||
    JSON.stringify(input.leftOccurrence?.limitations) !==
      JSON.stringify(input.rightOccurrence?.limitations),
});

const compareOptionalMetadata = <T>(
  left: T | undefined,
  right: T | undefined,
  declaration: (value: T) => unknown,
): MetadataComparison => {
  if (left === undefined || right === undefined)
    return left === right ? "unchanged" : "unknown";
  return canonicalJson(declaration(left)) === canonicalJson(declaration(right))
    ? "unchanged"
    : "changed";
};

/** Interpret each pair's format declarations once, preserving historical omission. */
const occurrenceMetadata = (input: OccurrencePair): OccurrenceMetadata => {
  const left = input.leftOccurrence;
  const right = input.rightOccurrence;
  const fit = compareFitImageDeclarations(input);
  return {
    fitImage: fit.declaration,
    fitImageAvailability: fit.availability,
    asarPacking: compareOptionalMetadata(
      left?.unpacked,
      right?.unpacked,
      (value) => value,
    ),
    nodeSea: compareOptionalMetadata(
      left?.format_metadata?.kind === "node-sea-entry"
        ? left.format_metadata
        : undefined,
      right?.format_metadata?.kind === "node-sea-entry"
        ? right.format_metadata
        : undefined,
      nodeSeaEntryDeclaration,
    ),
    espImageSegment: compareOptionalMetadata(
      left?.format_metadata?.kind === "esp-image-segment"
        ? left.format_metadata
        : undefined,
      right?.format_metadata?.kind === "esp-image-segment"
        ? right.format_metadata
        : undefined,
      espImageSegmentDeclaration,
    ),
    dfuSeElement: compareOptionalMetadata(
      left?.format_metadata?.kind === "dfuse-element"
        ? left.format_metadata
        : undefined,
      right?.format_metadata?.kind === "dfuse-element"
        ? right.format_metadata
        : undefined,
      dfuSeElementDeclaration,
    ),
    espFlashPartition: compareOptionalMetadata(
      left?.format_metadata?.kind === "esp-flash-partition"
        ? left.format_metadata
        : undefined,
      right?.format_metadata?.kind === "esp-flash-partition"
        ? right.format_metadata
        : undefined,
      espFlashPartitionDeclaration,
    ),
    pyInstaller: compareOptionalMetadata(
      isPyInstallerEntry(left) ? left.format_metadata : undefined,
      isPyInstallerEntry(right) ? right.format_metadata : undefined,
      pyInstallerEntryDeclaration,
    ),
  };
};

/** Keep known FIT changes even when another declaration is unavailable. */
const compareFitImageDeclarations = ({
  leftOccurrence: left,
  rightOccurrence: right,
}: OccurrencePair): {
  readonly declaration: MetadataComparison;
  readonly availability: MetadataComparison;
} => {
  const lm =
    left?.format_metadata?.kind === "fit-image"
      ? left.format_metadata
      : undefined;
  const rm =
    right?.format_metadata?.kind === "fit-image"
      ? right.format_metadata
      : undefined;
  if (lm === undefined || rm === undefined) {
    const result = compareOptionalMetadata(lm, rm, fitImageDeclaration);
    return {
      declaration: result,
      availability: result === "unknown" ? "unknown" : "unchanged",
    };
  }
  const ld = fitImageDeclaration(lm);
  const rd = fitImageDeclaration(rm);
  const keys = Object.keys(ld) as (keyof typeof ld)[];
  let changed = false;
  let unavailable = false;
  for (const key of keys) {
    if (
      lm.unreadable_fields.some((field) => field === key) ||
      rm.unreadable_fields.some((field) => field === key)
    ) {
      unavailable = true;
      continue;
    }
    if (ld[key] !== rd[key]) changed = true;
  }
  return {
    declaration: changed ? "changed" : "unchanged",
    availability: unavailable ? "unknown" : "unchanged",
  };
};

const isPyInstallerEntry = (
  occurrence: ArtifactOccurrence | undefined,
): occurrence is ArtifactOccurrence & {
  readonly format_metadata: Extract<
    NonNullable<ArtifactOccurrence["format_metadata"]>,
    { readonly kind: "pyinstaller-entry" }
  >;
} => occurrence?.format_metadata?.kind === "pyinstaller-entry";

const classifyPyInstallerDeclaration = (
  input: ClassifyPathInput,
  base: ReturnType<typeof buildArtifactChangeBase>,
): { readonly handled: boolean; readonly change: ArtifactChange | null } => {
  const leftIsDeclaration = input.leftOccurrence?.entry_kind === "metadata";
  const rightIsDeclaration = input.rightOccurrence?.entry_kind === "metadata";
  if (!leftIsDeclaration && !rightIsDeclaration)
    return { handled: false, change: null };
  // Metadata is not inherently a PyInstaller declaration. Only apply this
  // format-specific comparison when a producer explicitly identified one.
  if (
    !isPyInstallerEntry(input.leftOccurrence) &&
    !isPyInstallerEntry(input.rightOccurrence)
  )
    return { handled: false, change: null };
  if (!leftIsDeclaration || !rightIsDeclaration)
    return { handled: false, change: null };
  if (
    !isPyInstallerEntry(input.leftOccurrence) ||
    !isPyInstallerEntry(input.rightOccurrence)
  )
    return {
      handled: true,
      change: {
        ...base,
        classification: "unknown",
        dimensions: ["availability"],
      },
    };
  const changed = input.metadata.pyInstaller === "changed";
  return {
    handled: true,
    change: changed
      ? { ...base, classification: "changed", dimensions: ["metadata"] }
      : null,
  };
};

const changedDimensions = (input: {
  readonly metadata: OccurrenceMetadata;
  readonly leftNode: ArtifactNode | undefined;
  readonly rightNode: ArtifactNode | undefined;
  readonly leftOccurrence: ArtifactOccurrence | undefined;
  readonly rightOccurrence: ArtifactOccurrence | undefined;
  readonly leftRelations: readonly RelationProjection[];
  readonly rightRelations: readonly RelationProjection[];
}): z.infer<typeof comparisonDimensionSchema>[] => {
  const left = input.leftNode;
  const right = input.rightNode;
  if (left === undefined || right === undefined) return ["availability"];
  const occurrence = occurrenceDifferences(input);
  const checks: readonly [
    z.infer<typeof comparisonDimensionSchema>,
    boolean,
  ][] = [
    ["content", left.sha256 !== right.sha256],
    ["kind", occurrence.kind],
    [
      "format",
      (left.format !== right.format &&
        !differsWithUnknown(left.format, right.format)) ||
        occurrence.format,
    ],
    ["size", left.size !== right.size],
    ["executable", occurrence.executable],
    ["relations", occurrence.relations],
    ["metadata", occurrence.metadata || metadataChanged(left, right)],
  ];
  return checks
    .filter(([, changed]) => changed)
    .map(([dimension]) => dimension);
};

const metadataChanged = (left: ArtifactNode, right: ArtifactNode): boolean =>
  (left.media_type !== right.media_type &&
    !differsWithMissing(left.media_type, right.media_type)) ||
  (left.architecture !== right.architecture &&
    !differsWithMissing(left.architecture, right.architecture)) ||
  left.content_state !== right.content_state ||
  JSON.stringify(left.limitations) !== JSON.stringify(right.limitations);

const nodeFor = (
  occurrence: ArtifactOccurrence | undefined,
  nodes: ReadonlyMap<string, ArtifactNode>,
): ArtifactNode | undefined =>
  occurrence?.artifact_id === null || occurrence?.artifact_id === undefined
    ? undefined
    : nodes.get(occurrence.artifact_id);

const relationsByPath = (
  inventory: InventorySet,
): ReadonlyMap<string, readonly RelationProjection[]> => {
  const output = new Map<string, RelationProjection[]>();
  const occurrences = new Map(
    inventory.occurrences.map((item) => [item.occurrence_id, item]),
  );
  for (const edge of inventory.edges) {
    const occurrence = occurrences.get(edge.occurrence_id);
    // An incomplete inventory can omit the occurrence that names the child.
    if (occurrence?.artifact_id === null || occurrence === undefined) continue;
    const path = occurrence.logical_path;
    const values = output.get(path);
    const projection: RelationProjection = {
      parent_logical_path:
        occurrence.parent_occurrence_id === null
          ? null
          : (occurrences.get(occurrence.parent_occurrence_id)?.logical_path ??
            null),
      // Containment roots are path-normalized to avoid graph-wide deltas, but
      // a source map's target is a semantic content identity, not its parent
      // directory. Preserve that identity in the relation comparison.
      mapped_artifact_id:
        edge.relation === "maps-source" ? edge.parent_artifact_id : null,
      child_artifact_id: occurrence.artifact_id,
      relation: edge.relation,
      logical_path: occurrence.logical_path,
      producer: edge.producer,
    };
    if (values === undefined) output.set(path, [projection]);
    else values.push(projection);
  }
  for (const values of output.values())
    values.sort((left, right) =>
      compareUnicodeCodePoints(canonicalJson(left), canonicalJson(right)),
    );
  return output;
};

interface RelationProjection {
  /** Logical parent is stable across graph-root ID changes. */
  readonly parent_logical_path: string | null;
  /** Content identity is material for a maps-source edge. */
  readonly mapped_artifact_id: string | null;
  readonly child_artifact_id: string;
  readonly relation: ArtifactInventoryResult["edges"][number]["relation"];
  readonly logical_path: string | null;
  /** Producer is semantic provenance; edge ordinal is presentation order. */
  readonly producer: ArtifactInventoryResult["edges"][number]["producer"];
}

const summarize = (
  left: InventorySet,
  right: InventorySet,
  changes: readonly ArtifactChange[],
  covered: boolean,
) => {
  const counts = {
    added: 0,
    removed: 0,
    changed: 0,
    unknown: 0,
    contradiction: 0,
  };
  for (const change of changes) counts[change.classification] += 1;
  // Change rows are keyed by logical path, and one unknown row for a duplicate
  // path stands for every left occurrence on it. Only occurrences on paths
  // without a left-side change are affirmatively unchanged.
  const changedPaths = new Set(
    changes
      .filter(({ classification }) => classification !== "added")
      .map(({ logical_path: path }) => path),
  );
  return {
    unchanged: covered
      ? left.occurrences.filter(
          ({ logical_path: path }) => !changedPaths.has(path),
        ).length
      : 0,
    ...counts,
    unknown: covered
      ? counts.unknown
      : Math.max(
          counts.unknown,
          Math.max(
            left.manifest.occurrence_count,
            right.manifest.occurrence_count,
          ) -
            counts.added -
            counts.removed -
            counts.changed -
            counts.contradiction,
        ),
  };
};

// Differing manifest root digests prove a root content change even when node
// details are unavailable. Fold that fact into an existing root row so one
// logical path keeps one classification.
const applyRootHashChange = (
  left: InventorySet,
  right: InventorySet,
  changes: ArtifactChange[],
  evidenceLinks: readonly string[],
): void => {
  if (left.manifest.root_sha256 === right.manifest.root_sha256) return;
  const index = changes.findIndex((change) => change.logical_path === ".");
  const existing = changes[index];
  if (existing !== undefined) {
    if (
      existing.dimensions.includes("content") ||
      (existing.classification !== "unknown" &&
        existing.classification !== "changed")
    )
      return;
    changes[index] = {
      ...existing,
      classification: "changed",
      dimensions: comparisonDimensionSchema.options.filter(
        (dimension) =>
          dimension === "content" || existing.dimensions.includes(dimension),
      ),
      evidence_links: [
        ...new Set([...existing.evidence_links, ...evidenceLinks]),
      ],
    };
    return;
  }
  const leftRoot = left.occurrences.find(
    (occurrence) => occurrence.logical_path === ".",
  );
  const rightRoot = right.occurrences.find(
    (occurrence) => occurrence.logical_path === ".",
  );
  changes.push({
    classification: "changed",
    logical_path: ".",
    dimensions: ["content"],
    left_occurrence_id: leftRoot?.occurrence_id ?? null,
    right_occurrence_id: rightRoot?.occurrence_id ?? null,
    left_artifact_id: leftRoot?.artifact_id ?? null,
    right_artifact_id: rightRoot?.artifact_id ?? null,
    evidence_links: [...evidenceLinks],
  });
};

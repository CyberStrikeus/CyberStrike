import {
  canBorrowParsedJsonSnapshot,
  isImmutableJsonSnapshot,
  freezeJsonSnapshot,
  immutableJsonSnapshotMember,
} from "./immutableJson.js";
import {
  artifactInventoryResultSchema,
  type ArtifactInventoryCoverage,
  type ArtifactInventoryResult,
  type ArtifactNode,
  type ArtifactOccurrence,
  type IntegrityContradiction,
} from "./artifactGraph.js";
import { compareUnicodeCodePoints } from "./unicodeCodePointOrder.js";
import { canonicalJson } from "./comparisonSemantics.js";
import {
  artifactContradictionId,
  artifactEdgeId,
  artifactGraphDigest,
  artifactIdForContent,
  artifactManifestId,
  occurrenceIdForLocation,
} from "./artifactIdentity.js";
import type { Evidence } from "./evidence.js";
import { z } from "zod";
import { EvidenceIntegrityError } from "./evidenceErrors.js";
import { readEvidence, safeParseEvidence } from "./evidenceValidation.js";
import {
  artifactInspectionResultSchema,
  type ArtifactInspectionResult,
} from "./artifactInspection.js";

/** Complete or partially assembled inventory used by comparison workflows. */
export interface InventorySet {
  readonly manifest: ArtifactInventoryResult["manifest"];
  readonly nodes: readonly ArtifactNode[];
  readonly occurrences: readonly ArtifactOccurrence[];
  readonly edges: readonly ArtifactInventoryResult["edges"][number][];
  readonly integrityContradictions: readonly IntegrityContradiction[];
  readonly limitations: readonly string[];
  /** True when merged node, occurrence, and edge counts match the manifest. */
  readonly complete: boolean;
  readonly coverage: ArtifactInventoryCoverage;
}

/** Whether all graph members are present and the producer reports full coverage. */
export const hasCompleteInventoryCoverage = (
  inventory: InventorySet,
  requiredScope: ArtifactInventoryCoverage["scope"],
): boolean =>
  inventory.complete &&
  inventory.coverage.scope === requiredScope &&
  inventory.coverage.status === "complete";

export interface ParsedInventorySet {
  readonly evidence: readonly Evidence[];
  readonly inventory: InventorySet;
}

/** Expected failure while validating inventory facts without an Evidence carrier. */
export class ArtifactInventoryValidationError extends TypeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArtifactInventoryValidationError";
  }
}

/** Individually valid pages disagree about the selected inventory. */
class ArtifactInventoryCompositionError extends ArtifactInventoryValidationError {}

/** Caller selected a carrier or page composition that cannot form an inventory. */
export class ArtifactInventoryCarrierError extends Error {
  constructor(
    message: string,
    readonly index: number | undefined = undefined,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ArtifactInventoryCarrierError";
  }
}

interface ParsedArtifactInspectionInventory {
  readonly inspection: ArtifactInspectionResult;
  readonly inventory: InventorySet;
  readonly evidenceIds: readonly string[];
}

/** Parse, merge, and verify inventory Evidence pages. */
export const parseArtifactInventoryEvidence = (
  input: unknown,
): ParsedInventorySet => {
  const carriers = Array.isArray(input) ? input : [input];
  if (carriers.length === 0)
    throw new ArtifactInventoryCarrierError(
      "Artifact inventory requires at least one Evidence carrier",
    );
  const evidence = carriers.map((carrier) => {
    const parsed = readEvidence(carrier);
    if (!parsed.ok) throw parsed.error;
    return parsed.value;
  });
  try {
    const pageGroups = evidence.map((carrier, index) => {
      if (carrier.operation === "inventory_artifact")
        return [parseInventoryEvidencePage(carrier)];
      if (carrier.operation !== "inspect_artifact")
        throw new ArtifactInventoryCarrierError(
          "Artifact inventory requires inventory_artifact or inspect_artifact Evidence",
          index,
        );
      return parseInspectionEvidencePayload(
        carrier.normalized_result,
        carrier.subject,
      );
    });
    for (const pages of pageGroups)
      if (pages.length > 1) assembleInventoryResults(pages);
    try {
      return {
        evidence,
        inventory: assembleInventoryResults(pageGroups.flat()),
      };
    } catch (cause: unknown) {
      if (!(cause instanceof ArtifactInventoryCompositionError)) throw cause;
      if (pageGroups.length === 1) throw cause;
      throw new ArtifactInventoryCarrierError(cause.message, undefined, {
        cause,
      });
    }
  } catch (cause: unknown) {
    if (cause instanceof ArtifactInventoryCarrierError) throw cause;
    if (!(cause instanceof ArtifactInventoryValidationError)) throw cause;
    throw new EvidenceIntegrityError(cause.message, {
      cause,
      userMessage: cause.message,
    });
  }
};

const parseInspectionEvidencePayload = (
  input: unknown,
  subject: Evidence["subject"],
): readonly ArtifactInventoryResult[] => {
  try {
    return parseInspectionInventoryPayload(input, subject).pages;
  } catch (cause: unknown) {
    if (!(cause instanceof z.ZodError)) throw cause;
    throw new ArtifactInventoryValidationError(cause.message, { cause });
  }
};

/** Parse and authenticate an already-owned inspection payload and its pages. */
export const parseArtifactInspectionInventoryResult = (
  input: unknown,
  subject: Evidence["subject"],
): ParsedArtifactInspectionInventory => {
  const parsed = parseInspectionInventoryPayload(input, subject);
  return {
    inspection: parsed.inspection,
    inventory: assembleInventoryResults(parsed.pages),
    evidenceIds: parsed.evidenceIds,
  };
};

/** Shared owner boundary for full Evidence and already-authenticated parents. */
const parseInspectionInventoryPayload = (
  input: unknown,
  subject: Evidence["subject"],
): {
  readonly inspection: ArtifactInspectionResult;
  readonly pages: readonly ArtifactInventoryResult[];
  readonly evidenceIds: readonly string[];
} => {
  const parsedInspection = artifactInspectionResultSchema.parse(input);
  const inspection = canBorrowParsedJsonSnapshot(input, parsedInspection)
    ? input
    : isImmutableJsonSnapshot(input)
      ? freezeJsonSnapshot(parsedInspection)
      : parsedInspection;
  const sealedSubsteps = immutableJsonSnapshotMember(inspection, "substeps");
  if (inspection.coverage.substeps_completed !== inspection.substeps.length)
    throw new ArtifactInventoryValidationError(
      "Artifact inspection substep count does not match its coverage declaration",
    );
  const substeps = inspection.substeps.map((step, index) => {
    const sealedStep = immutableJsonSnapshotMember(
      sealedSubsteps,
      String(index),
    );
    const sourceEvidence =
      immutableJsonSnapshotMember(sealedStep, "evidence") ?? step.evidence;
    const parsedEvidence = safeParseEvidence(sourceEvidence);
    if (!parsedEvidence.ok)
      throw Object.assign(
        new z.ZodError(
          parsedEvidence.error.issues.map((issue) => ({
            ...issue,
            path: ["substeps", index, "evidence", ...issue.path],
          })),
        ),
        { cause: parsedEvidence.error },
      );
    const evidence = canBorrowParsedJsonSnapshot(
      sourceEvidence,
      parsedEvidence.value,
    )
      ? sourceEvidence
      : parsedEvidence.value;
    immutableJsonSnapshotMember(evidence, "normalized_result");
    if (step.evidence_id !== evidence.evidence_id)
      throw new ArtifactInventoryValidationError(
        "Artifact inspection substep evidence ID does not match nested Evidence",
      );
    return {
      evidenceId: evidence.evidence_id,
      page: parseInventoryEvidencePage(evidence),
    };
  });
  const firstPage = substeps[0]?.page;
  if (firstPage === undefined)
    throw new ArtifactInventoryValidationError(
      "Artifact inspection requires inventory substeps",
    );
  validateInspectionSubject(subject, inspection, firstPage.manifest);
  return {
    inspection,
    pages: substeps.map(({ page }) => page),
    evidenceIds: substeps.map(({ evidenceId }) => evidenceId),
  };
};

/** Ensure the inspection declaration and carrier identify its inventory. */
const validateInspectionSubject = (
  subject: Evidence["subject"],
  inspection: ArtifactInspectionResult,
  manifest: ArtifactInventoryResult["manifest"],
): void => {
  if (
    inspection.subject.manifest_id !== manifest.manifest_id ||
    inspection.subject.root_artifact_id !== manifest.root_artifact_id ||
    inspection.subject.root_sha256 !== manifest.root_sha256 ||
    inspection.subject.root_format !== manifest.root_format
  )
    throw new ArtifactInventoryValidationError(
      "Artifact inspection subject does not match its inventory manifest",
    );
  if (!subjectMatchesInventoryRoot(subject, manifest))
    throw new ArtifactInventoryValidationError(
      "Artifact inspection Evidence subject does not match its root manifest",
    );
};

/** Validate one already authenticated parent payload with the same graph proofs. */
export const parseArtifactInventoryResult = (
  input: unknown,
  subject: Evidence["subject"],
): InventorySet =>
  assembleInventoryResults([parseInventoryPage(input, subject)]);

/** Parse one already authenticated inventory result into its validated facts. */
const parseInventoryPage = (
  input: unknown,
  subject: Evidence["subject"],
): ArtifactInventoryResult => {
  const parsed = artifactInventoryResultSchema.parse(input);
  const inventory = canBorrowParsedJsonSnapshot(input, parsed)
    ? input
    : isImmutableJsonSnapshot(input)
      ? freezeJsonSnapshot(parsed)
      : parsed;
  validateArtifactInventorySubject(subject, inventory.manifest);
  validateInventoryPage(inventory);
  return inventory;
};

/** Parse one authenticated inventory carrier into its validated owner facts. */
const parseInventoryEvidencePage = (
  evidence: Evidence,
): ArtifactInventoryResult => {
  if (evidence.operation !== "inventory_artifact")
    throw new ArtifactInventoryValidationError(
      "Artifact inventory page must be inventory_artifact Evidence",
    );
  try {
    return parseInventoryPage(evidence.normalized_result, evidence.subject);
  } catch (cause: unknown) {
    if (!(cause instanceof z.ZodError)) throw cause;
    throw new ArtifactInventoryValidationError(cause.message, { cause });
  }
};

const subjectMatchesInventoryRoot = (
  subject: Evidence["subject"],
  manifest: ArtifactInventoryResult["manifest"],
): boolean =>
  subject !== null &&
  subject.digest.sha256 === manifest.root_sha256 &&
  subject.format === manifest.root_format;

/** Both inventory carriers require the same authenticated root identity. */
export const validateArtifactInventorySubject = (
  subject: Evidence["subject"],
  manifest: ArtifactInventoryResult["manifest"],
): void => {
  if (!subjectMatchesInventoryRoot(subject, manifest))
    throw new ArtifactInventoryValidationError(
      "Artifact inventory Evidence subject does not match its root digest",
    );
};

const validateInventoryPage = (inventory: ArtifactInventoryResult): void => {
  const manifest = inventory.manifest;
  if (manifest.root_artifact_id !== artifactIdForContent(manifest.root_sha256))
    throw new ArtifactInventoryValidationError(
      "Artifact root identity does not match its manifest digest",
    );
  if (
    manifest.manifest_id !==
    artifactManifestId(manifest.root_artifact_id, manifest.graph_sha256)
  )
    throw new ArtifactInventoryValidationError(
      "Artifact manifest ID does not match its commitment",
    );
  for (const occurrence of inventory.occurrences) {
    if (occurrence.logical_path !== ".") continue;
    if (
      occurrence.artifact_id !== manifest.root_artifact_id ||
      occurrence.artifact_format !== manifest.root_format ||
      occurrence.parent_occurrence_id !== null ||
      occurrence.entry_kind !==
        (manifest.root_format === "directory" ? "directory" : "file")
    )
      throw new ArtifactInventoryValidationError(
        "Artifact root occurrence does not match its manifest representation",
      );
    if (
      occurrence.occurrence_id !==
      occurrenceIdForLocation({
        rootArtifactId: manifest.root_artifact_id,
        logicalPath: ".",
        entryKind: occurrence.entry_kind,
      })
    )
      throw new ArtifactInventoryValidationError(
        "Artifact occurrence ID does not match its identity",
      );
  }
  assertUnique(
    inventory.nodes.map(({ artifact_id: id }) => id),
    "node ID",
  );
  assertUnique(
    inventory.occurrences.map(({ occurrence_id: id }) => id),
    "occurrence ID",
  );
  assertUnique(
    inventory.edges.map(({ edge_id: id }) => id),
    "edge ID",
  );
  for (const node of inventory.nodes)
    if (node.artifact_id !== artifactIdForContent(node.sha256))
      throw new ArtifactInventoryValidationError(
        "Artifact node ID is not content-addressed",
      );
};

const assembleInventoryResults = (
  pages: readonly ArtifactInventoryResult[],
): InventorySet => {
  const first = pages[0];
  if (first === undefined)
    throw new ArtifactInventoryValidationError(
      "Artifact inventory requires Evidence pages",
    );
  const manifestJson = canonicalJson(first.manifest, "Artifact inventory");
  const coverageJson = canonicalJson(
    first.coverage,
    "Artifact inventory coverage",
  );
  const nodes = new Map<string, ArtifactNode>();
  const occurrences = new Map<string, ArtifactOccurrence>();
  const edges = new Map<string, ArtifactInventoryResult["edges"][number]>();
  for (const page of pages) {
    if (canonicalJson(page.manifest, "Artifact inventory") !== manifestJson)
      throw new ArtifactInventoryCompositionError(
        "Artifact inventory pages do not share one manifest",
      );
    if (
      canonicalJson(page.coverage, "Artifact inventory coverage") !==
      coverageJson
    )
      throw new ArtifactInventoryCompositionError(
        "Artifact inventory pages do not share one coverage declaration",
      );
    if (
      canonicalJson(page.integrity_contradictions, "Artifact inventory") !==
      canonicalJson(first.integrity_contradictions, "Artifact inventory")
    )
      throw new ArtifactInventoryCompositionError(
        "Artifact inventory pages do not share integrity contradictions",
      );
    for (const node of page.nodes)
      mergeExact(nodes, node.artifact_id, node, "node");
    for (const occurrence of page.occurrences) {
      mergeExact(
        occurrences,
        occurrence.occurrence_id,
        occurrence,
        "occurrence",
      );
    }
    for (const edge of page.edges)
      mergeExact(edges, edge.edge_id, edge, "edge");
  }
  const inventory = orderedInventory(first, pages, {
    nodes,
    occurrences,
    edges,
  });
  if (
    inventory.nodes.length > inventory.manifest.node_count ||
    inventory.occurrences.length > inventory.manifest.occurrence_count ||
    inventory.edges.length > inventory.manifest.edge_count
  )
    throw new ArtifactInventoryValidationError(
      "Artifact inventory members exceed their manifest counts",
    );
  const occurrencesById = new Map(
    inventory.occurrences.map((occurrence) => [
      occurrence.occurrence_id,
      occurrence,
    ]),
  );
  for (const edge of inventory.edges) {
    const occurrence = occurrencesById.get(edge.occurrence_id);
    // Missing pages leave references unresolved, but a supplied occurrence
    // already provides every input to the edge's identity commitment.
    if (occurrence === undefined) continue;
    if (occurrence.artifact_id === null)
      throw new ArtifactInventoryValidationError(
        "Artifact edge references a missing graph member",
      );
    if (edge.edge_id !== artifactEdgeId(edge, occurrence))
      throw new ArtifactInventoryValidationError(
        "Artifact edge ID does not match its identity",
      );
  }
  if (inventory.complete) validateCompleteInventory(inventory);
  return inventory;
};

const orderedInventory = (
  first: ArtifactInventoryResult,
  pages: readonly ArtifactInventoryResult[],
  values: {
    readonly nodes: ReadonlyMap<string, ArtifactNode>;
    readonly occurrences: ReadonlyMap<string, ArtifactOccurrence>;
    readonly edges: ReadonlyMap<
      string,
      ArtifactInventoryResult["edges"][number]
    >;
  },
): InventorySet => {
  const nodes = [...values.nodes.values()].sort((left, right) =>
    compareUnicodeCodePoints(left.artifact_id, right.artifact_id),
  );
  const occurrences = orderOccurrences(first.manifest.root_artifact_id, [
    ...values.occurrences.values(),
  ]);
  const edges = [...values.edges.values()].sort((left, right) =>
    compareUnicodeCodePoints(left.edge_id, right.edge_id),
  );
  const limitations = [
    ...new Set(pages.flatMap((inventory) => inventory.limitations)),
  ].sort(compareUnicodeCodePoints);
  return {
    manifest: first.manifest,
    nodes,
    occurrences,
    edges,
    integrityContradictions: first.integrity_contradictions,
    limitations,
    coverage: first.coverage,
    complete:
      nodes.length === first.manifest.node_count &&
      occurrences.length === first.manifest.occurrence_count &&
      edges.length === first.manifest.edge_count,
  };
};

const orderOccurrences = (
  rootArtifactId: string,
  occurrences: readonly ArtifactOccurrence[],
): ArtifactOccurrence[] => {
  const groups = new Map<string, ArtifactOccurrence[]>();
  for (const occurrence of occurrences) {
    const group = groups.get(occurrence.logical_path);
    if (group === undefined) groups.set(occurrence.logical_path, [occurrence]);
    else group.push(occurrence);
  }
  return [...groups]
    .sort(([left], [right]) => compareUnicodeCodePoints(left, right))
    .flatMap(([path, group]) => {
      if (group.length < 2) return group;
      const ordinalById = new Map<string, number>();
      const kinds = new Set(group.map(({ entry_kind }) => entry_kind));
      for (let ordinal = 0; ordinal < group.length; ordinal++) {
        // Entry kinds come from a fixed schema enum, so work stays linear in
        // the group size without changing or guessing producer identities.
        for (const entryKind of kinds)
          ordinalById.set(
            occurrenceIdForLocation({
              rootArtifactId,
              logicalPath: path,
              entryKind,
              ...(ordinal === 0 ? {} : { duplicateOrdinal: ordinal }),
            }),
            ordinal,
          );
      }
      return group.sort(
        (left, right) =>
          (ordinalById.get(left.occurrence_id) ?? Number.MAX_SAFE_INTEGER) -
            (ordinalById.get(right.occurrence_id) ?? Number.MAX_SAFE_INTEGER) ||
          compareUnicodeCodePoints(left.occurrence_id, right.occurrence_id),
      );
    });
};

const validateCompleteInventory = (inventory: InventorySet): void => {
  const nodeIds = new Set(inventory.nodes.map(({ artifact_id: id }) => id));
  const occurrenceIds = new Set(
    inventory.occurrences.map(({ occurrence_id: id }) => id),
  );
  const rootNode = inventory.nodes.find(
    ({ artifact_id: id }) => id === inventory.manifest.root_artifact_id,
  );
  if (rootNode?.sha256 !== inventory.manifest.root_sha256)
    throw new ArtifactInventoryValidationError(
      "Artifact root node does not match its manifest digest",
    );
  const rootOccurrence = inventory.occurrences.find(
    ({ logical_path }) => logical_path === ".",
  );
  if (rootOccurrence === undefined)
    throw new ArtifactInventoryValidationError(
      "Artifact root occurrence does not match its manifest representation",
    );
  const duplicateOrdinalByPath = new Map<string, number>();
  for (const occurrence of inventory.occurrences) {
    const ordinal = duplicateOrdinalByPath.get(occurrence.logical_path) ?? 0;
    duplicateOrdinalByPath.set(occurrence.logical_path, ordinal + 1);
    validateOccurrence(occurrence, inventory, nodeIds, occurrenceIds, ordinal);
  }
  const occurrencesById = new Map(
    inventory.occurrences.map((occurrence) => [
      occurrence.occurrence_id,
      occurrence,
    ]),
  );
  for (const edge of inventory.edges)
    validateEdge(edge, nodeIds, occurrencesById);
  for (const contradiction of inventory.integrityContradictions) {
    if (
      !nodeIds.has(contradiction.parent_artifact_id) ||
      !occurrenceIds.has(contradiction.occurrence_id)
    )
      throw new ArtifactInventoryValidationError(
        "Integrity contradiction references a missing graph member",
      );
    const expectedId = artifactContradictionId({
      rootArtifactId: inventory.manifest.root_artifact_id,
      logicalPath: contradiction.logical_path,
      integrity: contradiction,
    });
    if (contradiction.contradiction_id !== expectedId)
      throw new ArtifactInventoryValidationError(
        "Integrity contradiction ID does not match its identity",
      );
  }
  const graphSha256 = artifactGraphDigest({
    nodes: inventory.nodes,
    occurrences: inventory.occurrences,
    edges: inventory.edges,
    contradictions: inventory.integrityContradictions,
  });
  if (graphSha256 !== inventory.manifest.graph_sha256)
    throw new ArtifactInventoryValidationError(
      "Artifact graph commitment does not match its members",
    );
};

const validateOccurrence = (
  occurrence: ArtifactOccurrence,
  inventory: InventorySet,
  nodeIds: ReadonlySet<string>,
  occurrenceIds: ReadonlySet<string>,
  duplicateOrdinal: number,
): void => {
  if (occurrence.artifact_id !== null && !nodeIds.has(occurrence.artifact_id))
    throw new ArtifactInventoryValidationError(
      "Artifact occurrence references a missing node",
    );
  if (
    occurrence.parent_occurrence_id !== null &&
    !occurrenceIds.has(occurrence.parent_occurrence_id)
  )
    throw new ArtifactInventoryValidationError(
      "Artifact occurrence references a missing parent",
    );
  const expectedId = occurrenceIdForLocation({
    rootArtifactId: inventory.manifest.root_artifact_id,
    logicalPath: occurrence.logical_path,
    entryKind: occurrence.entry_kind,
    ...(duplicateOrdinal === 0 ? {} : { duplicateOrdinal }),
  });
  if (occurrence.occurrence_id !== expectedId)
    throw new ArtifactInventoryValidationError(
      "Artifact occurrence ID does not match its identity",
    );
};

const validateEdge = (
  edge: ArtifactInventoryResult["edges"][number],
  nodeIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, ArtifactOccurrence>,
): void => {
  const occurrence = occurrences.get(edge.occurrence_id);
  if (
    !nodeIds.has(edge.parent_artifact_id) ||
    occurrence?.artifact_id === null ||
    occurrence === undefined ||
    !nodeIds.has(occurrence.artifact_id)
  )
    throw new ArtifactInventoryValidationError(
      "Artifact edge references a missing graph member",
    );
};

const mergeExact = <Value>(
  output: Map<string, Value>,
  key: string,
  value: Value,
  label: string,
): void => {
  const previous = output.get(key);
  if (
    previous !== undefined &&
    canonicalJson(previous, "Artifact inventory") !==
      canonicalJson(value, "Artifact inventory")
  )
    throw new ArtifactInventoryCompositionError(
      `Artifact inventory has conflicting ${label} pages`,
    );
  output.set(key, value);
};

const assertUnique = (values: readonly string[], label: string): void => {
  if (new Set(values).size !== values.length)
    throw new ArtifactInventoryValidationError(
      `Artifact inventory contains a duplicate ${label}`,
    );
};

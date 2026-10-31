import type { ArtifactInventorySnapshot } from "../../domain/artifactInventorySnapshot.js";
import type { InesInventory } from "../../domain/inesContainer.js";
import type { ArtifactEmbeddedFormatProbeFacts } from "../ArtifactEmbeddedFormatProbes.js";
import { compareUnicodeCodePoints } from "../../domain/unicodeCodePointOrder.js";

import { AsarArtifactReader } from "../AsarArtifactReader.js";
import {
  InesArtifactReader,
  type InesRegionScan,
} from "../InesArtifactReader.js";

import { lstat } from "node:fs/promises";
import type { Stats } from "node:fs";
import type { RootInventorySource } from "./classify.js";
import { isZipPackageFormat } from "../../domain/zipPackageFormat.js";

import {
  ArtifactReaderFailure,
  type ArtifactReader,
  type ArtifactReaderTraversal,
} from "../ArtifactReader.js";
import type { ArtifactResourceOwner } from "../ArtifactResourceScope.js";
import {
  artifactInventoryResultSchema,
  type ArtifactInventoryResult,
  type ArtifactNode,
  type ArtifactOccurrence,
  type IntegrityContradiction,
} from "../../domain/artifactGraph.js";
import {
  createArtifactEdges,
  createRootNode,
  materializeDirectoryNodes,
  rekeyOccurrences,
  rootOccurrenceFor,
  type MutableOccurrence,
} from "./ArtifactGraphConstruction.js";
import {
  artifactContradictionId,
  artifactGraphDigest,
  artifactManifestId,
} from "../../domain/artifactIdentity.js";
import { classifyAndHashRootForInventory } from "./classify.js";
import { hostExecutableMarking } from "../hostExecutableMarking.js";
import type { HashResult } from "../ArtifactHash.js";
import {
  hashStableRootArtifact,
  hashStableRootArtifactHandle,
} from "./hashStableRootArtifact.js";
import { createReader, inventoryCoverage } from "./reader.js";
import {
  scanReader,
  type PendingIntegrityContradiction,
} from "./scanReader.js";
import type { ArtifactInventoryOptions } from "./types.js";
import type { ArtifactContainerIntegrityPair } from "../../domain/artifactIntegrity.js";

export interface TransferredArtifactInventorySource {
  readonly owner: ArtifactResourceOwner;
  readonly admission: NonNullable<Parameters<typeof createReader>[3]>;
}

export const scanCanonicalArtifactInventoryInScope = async (
  path: string,
  options: ArtifactInventoryOptions,
  readerFactory: typeof createReader = createReader,
  selectedPath: string = path,
): Promise<ArtifactInventorySnapshot> =>
  (
    await scanCanonical(
      path,
      options,
      readerFactory,
      "release",
      undefined,
      selectedPath,
    )
  ).snapshot;

/** Keep the admitted source and parsed format facts alive for extraction of this inventory. */
export const scanCanonicalArtifactInventoryForExtractionInScope = async (
  path: string,
  options: ArtifactInventoryOptions,
  probeFacts?: ArtifactEmbeddedFormatProbeFacts,
  selectedPath: string = path,
): Promise<{
  readonly snapshot: ArtifactInventorySnapshot;
  readonly transferredSource: TransferredArtifactInventorySource | undefined;
}> =>
  scanCanonical(
    path,
    options,
    createReader,
    "transfer-source",
    probeFacts,
    selectedPath,
  );

const scanCanonical = async (
  path: string,
  options: ArtifactInventoryOptions,
  readerFactory: typeof createReader,
  rootDisposition: "release" | "transfer-source",
  probeFacts?: ArtifactEmbeddedFormatProbeFacts,
  selectedPath: string = path,
): Promise<{
  readonly snapshot: ArtifactInventorySnapshot;
  readonly transferredSource: TransferredArtifactInventorySource | undefined;
}> => {
  const metadata = await lstat(path);
  const {
    format: rootFormat,
    digest: rootDigest,
    rootSource,
    readerAdmission,
  } = await classifyAndHashRootForInventory(
    path,
    metadata.isDirectory(),
    metadata,
    { ...options, selectedPath },
    probeFacts,
  );
  let reader: ArtifactReader | undefined;
  let readerCreationFailure: { readonly cause: unknown } | undefined;
  try {
    reader = readerFactory(
      path,
      rootFormat,
      options.environment ?? {},
      readerAdmission,
      options.asarHeaderAdmission,
      selectedPath,
    );
  } catch (cause: unknown) {
    readerCreationFailure = { cause };
  }
  const ownedReaders: ArtifactReader[] = reader === undefined ? [] : [reader];
  let outcome: InventoryScanOutcome;
  try {
    if (readerCreationFailure !== undefined) throw readerCreationFailure.cause;
    if (reader instanceof AsarArtifactReader)
      await reader.prepareContainer(rootDigest?.sha256, options.signal);
    const {
      nodes,
      occurrences,
      pendingContradictions,
      caseCollisionLimitation,
      inesRegionScan,
      unknownParentOccurrences,
      traversal,
      rootContradiction,
    } = await scanReader(
      reader,
      ownedReaders,
      options.signal,
      options.integrity,
      options.asarHeaderAdmission,
    );
    outcome = {
      kind: "completed",
      snapshot: await buildInventorySnapshot({
        path,
        metadata,
        rootFormat,
        rootDigest,
        rootSource,
        resourceScope: options.resourceScope,
        reader,
        signal: options.signal,
        nodes,
        occurrences,
        pendingContradictions,
        caseCollisionLimitation,
        inesRegionScan,
        unknownParentOccurrences,
        traversal,
        rootContradiction,
      }),
    };
  } catch (cause: unknown) {
    outcome = { kind: "failed", cause };
    // A mount refusal does not erase the independently classified, hashed
    // carrier. Retain only that root, with explicitly unexamined children.
    if (
      rootFormat === "dmg" &&
      cause instanceof ArtifactReaderFailure &&
      cause.reason === "unavailable" &&
      cause.partialObservation === undefined &&
      options.signal?.aborted !== true
    ) {
      let retained: ArtifactInventorySnapshot | undefined;
      let rootFailure: unknown;
      try {
        retained = await buildInventorySnapshot({
          path,
          metadata,
          rootFormat,
          rootDigest,
          rootSource,
          resourceScope: options.resourceScope,
          reader,
          signal: options.signal,
          nodes: new Map(),
          occurrences: [],
          pendingContradictions: [],
          caseCollisionLimitation: undefined,
          inesRegionScan: undefined,
          unknownParentOccurrences: new Set(),
          rootContradiction: undefined,
          traversal: {
            status: "unknown",
            limitations: [
              `DMG child traversal was unavailable: ${cause.message}`,
            ],
          },
        });
      } catch (failure: unknown) {
        rootFailure = failure;
      }
      outcome = {
        kind: "failed",
        cause: new ArtifactReaderFailure(
          cause.reason,
          rootFailure === undefined
            ? cause.message
            : `${cause.message}; root observations could not be revalidated: ${rootFailure instanceof Error ? rootFailure.message : String(rootFailure)}`,
          {
            cause:
              rootFailure === undefined
                ? cause
                : new AggregateError(
                    [cause, rootFailure],
                    "DMG traversal and root revalidation failed",
                    { cause },
                  ),
            cleanup: cause.cleanup,
            cleanupLeases: cause.cleanupLeases,
            userMessage: cause.userMessage,
            ...(retained === undefined
              ? {}
              : {
                  partialObservation: {
                    kind: "artifact-inventory",
                    inventory: retained,
                  },
                }),
          },
          cause.details,
        ),
      };
    }
  }
  const cleanup = await cleanupInventoryOwners({
    path,
    options,
    rootSource,
    ownedReaders,
    readerAdmission,
    outcome,
    rootDisposition:
      rootDisposition === "transfer-source" &&
      outcome.kind === "completed" &&
      rootSource !== undefined &&
      (isZipPackageFormat(rootFormat) ||
        rootFormat === "ines" ||
        (readerAdmission !== undefined && "kind" in readerAdmission))
        ? "transfer"
        : "release",
  });
  if (cleanup.failure !== undefined) throw cleanup.failure;
  if (cleanup.outcome.kind === "failed") throw cleanup.outcome.cause;
  return {
    snapshot: cleanup.outcome.snapshot,
    transferredSource: cleanup.transferred,
  };
};

type InventoryScanOutcome =
  | {
      readonly kind: "completed";
      readonly snapshot: ArtifactInventorySnapshot;
    }
  | { readonly kind: "failed"; readonly cause: unknown };

const cleanupInventoryOwners = async ({
  path,
  options,
  rootSource,
  ownedReaders,
  readerAdmission,
  outcome,
  rootDisposition,
}: {
  readonly path: string;
  readonly options: ArtifactInventoryOptions;
  readonly rootSource: RootInventorySource | undefined;
  readonly ownedReaders: readonly ArtifactReader[];
  readonly readerAdmission: Parameters<typeof createReader>[3];
  readonly outcome: InventoryScanOutcome;
  readonly rootDisposition: "release" | "transfer";
}): Promise<{
  readonly failure: ArtifactReaderFailure | undefined;
  readonly transferred: TransferredArtifactInventorySource | undefined;
  readonly outcome: InventoryScanOutcome;
}> => {
  let finalOutcome = outcome;
  let cleanupFailure: ArtifactReaderFailure | undefined;
  // Finalization still belongs to this operation. Preserve completed facts when
  // cancellation arrives while an owner is being released, but keep an earlier
  // operation or cleanup failure primary.
  const observeCancellation = (): void => {
    if (
      finalOutcome.kind === "completed" &&
      cleanupFailure === undefined &&
      options.signal?.aborted === true
    )
      finalOutcome = {
        kind: "failed",
        cause: new ArtifactReaderFailure(
          "cancelled",
          "Artifact inventory cancelled during finalization",
          {
            cause: options.signal.reason,
            partialObservation: {
              kind: "artifact-inventory",
              inventory: finalOutcome.snapshot,
            },
          },
        ),
      };
  };
  observeCancellation();
  const readerOwners: ArtifactResourceOwner[] = [...ownedReaders]
    .reverse()
    .map((reader) => ({
      kind: "reader" as const,
      reader,
      resource: `artifact reader for ${path}`,
    }));
  const rootOwner: ArtifactResourceOwner | undefined =
    rootSource === undefined
      ? undefined
      : {
          kind: "file-handle",
          handle: rootSource.owner,
          resource: `root artifact descriptor for ${path}`,
        };
  for (const owner of readerOwners) {
    const attempt = await options.resourceScope.release(owner);
    observeCancellation();
    if (attempt.kind === "released") continue;
    cleanupFailure = options.resourceScope.cleanupFailure(
      cleanupFailure === undefined
        ? finalOutcome
        : { kind: "failed", cause: cleanupFailure },
      [attempt],
      outcome.kind === "completed"
        ? { kind: "artifact-inventory", inventory: outcome.snapshot }
        : undefined,
    );
  }
  if (
    rootDisposition === "transfer" &&
    finalOutcome.kind === "completed" &&
    cleanupFailure === undefined &&
    rootSource !== undefined &&
    rootOwner !== undefined &&
    readerAdmission !== undefined
  )
    return {
      failure: undefined,
      transferred: { owner: rootOwner, admission: readerAdmission },
      outcome: finalOutcome,
    };
  if (rootOwner !== undefined) {
    const attempt = await options.resourceScope.release(rootOwner);
    observeCancellation();
    if (attempt.kind === "failed")
      cleanupFailure = options.resourceScope.cleanupFailure(
        cleanupFailure === undefined
          ? finalOutcome
          : { kind: "failed", cause: cleanupFailure },
        [attempt],
        outcome.kind === "completed"
          ? { kind: "artifact-inventory", inventory: outcome.snapshot }
          : undefined,
      );
  }
  return {
    failure: cleanupFailure,
    transferred: undefined,
    outcome: finalOutcome,
  };
};

interface SnapshotBuildInput {
  readonly resourceScope: ArtifactInventoryOptions["resourceScope"];
  readonly path: string;
  readonly metadata: Stats;
  readonly rootFormat: ArtifactOccurrence["artifact_format"];
  readonly rootDigest: HashResult | null;
  readonly rootSource: RootInventorySource | undefined;
  readonly reader: ArtifactReader | undefined;
  readonly signal: AbortSignal | undefined;
  readonly nodes: Map<string, ArtifactNode>;
  readonly occurrences: MutableOccurrence[];
  readonly pendingContradictions: PendingIntegrityContradiction[];
  readonly caseCollisionLimitation: string | undefined;
  readonly inesRegionScan: InesRegionScan | undefined;
  readonly unknownParentOccurrences: ReadonlySet<MutableOccurrence>;
  readonly traversal: ArtifactReaderTraversal;
  readonly rootContradiction: ArtifactContainerIntegrityPair | undefined;
}

const buildInventorySnapshot = async (
  input: SnapshotBuildInput,
): Promise<ArtifactInventorySnapshot> => {
  const { path, metadata, rootFormat, rootDigest, rootSource, reader, signal } =
    input;
  materializeDirectoryNodes(input.occurrences, input.nodes);
  const rootNode = createRootNode({
    digest: rootDigest,
    occurrences: input.occurrences,
  });
  input.nodes.set(rootNode.artifact_id, rootNode);
  rekeyOccurrences(rootNode.artifact_id, input.occurrences);
  const rootOccurrence = rootOccurrenceFor(rootNode, {
    size: metadata.size,
    executable: hostExecutableMarking(path, metadata),
    format: rootFormat,
    path,
    formatMetadata: reader?.formatMetadata?.(),
  });
  for (const occurrence of input.occurrences)
    if (
      occurrence.parent_occurrence_id === null &&
      !input.unknownParentOccurrences.has(occurrence)
    )
      occurrence.parent_occurrence_id = rootOccurrence.occurrence_id;
  input.occurrences.unshift(rootOccurrence);
  if (input.rootContradiction !== undefined) {
    rootOccurrence.hash_status = "mismatched";
    rootOccurrence.limitations.push(
      "Declared integrity metadata contradicts observed bytes.",
    );
    input.pendingContradictions.push({
      occurrence: rootOccurrence,
      integrity: input.rootContradiction,
      entryKind: "file",
      unpacked: false,
    });
  }

  const occurrenceById = new Map(
    input.occurrences.map((occurrence) => [
      occurrence.occurrence_id,
      occurrence,
    ]),
  );
  const integrityContradictions = buildIntegrityContradictions(
    input.pendingContradictions,
    occurrenceById,
    rootNode,
  );
  const edgeResult = createArtifactEdges(
    rootNode.artifact_id,
    input.occurrences,
    reader?.provenance()[0],
  );
  const { edges } = edgeResult;
  const orderedNodes = sortNodes([...input.nodes.values()]);
  const orderedOccurrences = sortOccurrences(input.occurrences);
  const orderedEdges = sortEdges(edges).map((edge, ordinal) => ({
    ...edge,
    ordinal,
  }));

  await verifyRootDigest(
    path,
    rootDigest,
    rootSource,
    input.resourceScope,
    signal,
  );

  const graphSha256 = artifactGraphDigest({
    nodes: orderedNodes,
    occurrences: orderedOccurrences,
    edges: orderedEdges,
    contradictions: integrityContradictions,
  });
  const manifest = buildManifest({
    rootNode,
    rootFormat,
    graphSha256,
    orderedNodes,
    orderedOccurrences,
    orderedEdges,
  });
  let ines: InesInventory | undefined;
  if (reader instanceof InesArtifactReader) {
    if (rootDigest === null || input.inesRegionScan === undefined)
      throw new ArtifactReaderFailure(
        "integrity",
        "Missing iNES reconstruction scan",
      );
    ines = await reader.verifyReconstruction(
      rootDigest.sha256,
      input.inesRegionScan,
      signal,
    );
  }
  const traversal = inventoryCoverage(rootFormat, reader, input.traversal);
  const coverage =
    edgeResult.limitations.length === 0
      ? traversal.coverage
      : { ...traversal.coverage, status: "unknown" as const };
  return {
    manifest,
    ...(ines === undefined ? {} : { ines }),
    nodes: orderedNodes,
    occurrences: orderedOccurrences,
    edges: orderedEdges,
    provenance: reader?.provenance() ?? [],
    integrity_contradictions: integrityContradictions,
    coverage,
    limitations: buildLimitations(
      [...traversal.limitations, ...edgeResult.limitations],
      integrityContradictions,
      input.caseCollisionLimitation,
    ),
  };
};

const buildIntegrityContradictions = (
  pending: readonly PendingIntegrityContradiction[],
  occurrenceById: ReadonlyMap<string, MutableOccurrence>,
  rootNode: ArtifactNode,
): IntegrityContradiction[] =>
  pending.map((contradiction): IntegrityContradiction => {
    const occurrence = contradiction.occurrence;
    const parent =
      occurrence.parent_occurrence_id === null
        ? undefined
        : occurrenceById.get(occurrence.parent_occurrence_id);
    const parentArtifactId = parent?.artifact_id ?? rootNode.artifact_id;
    return {
      contradiction_id: artifactContradictionId({
        rootArtifactId: rootNode.artifact_id,
        logicalPath: occurrence.logical_path,
        integrity: contradiction.integrity,
      }),
      occurrence_id: occurrence.occurrence_id,
      parent_artifact_id: parentArtifactId,
      logical_path: occurrence.logical_path,
      ...contradiction.integrity,
      entry_kind: contradiction.entryKind,
      unpacked: contradiction.unpacked,
      trust: "observed-untrusted",
      provenance: "container-integrity-metadata-versus-observed-bytes",
      limitations: [
        "Observed bytes contradict declared integrity metadata and cannot support equivalence.",
      ],
    };
  });

const verifyRootDigest = async (
  path: string,
  rootDigest: HashResult | null,
  rootSource: RootInventorySource | undefined,
  resourceScope: ArtifactInventoryOptions["resourceScope"],
  signal: AbortSignal | undefined,
): Promise<void> => {
  if (rootDigest === null) return;
  const verified =
    rootSource === undefined
      ? await hashStableRootArtifact(path, resourceScope, signal)
      : await hashStableRootArtifactHandle(
          path,
          rootSource.handle,
          rootSource.initial,
          signal,
        );
  if (
    verified.sha256 !== rootDigest.sha256 ||
    verified.bytes !== rootDigest.bytes
  )
    throw new ArtifactReaderFailure(
      "integrity",
      "Root artifact changed during inventory",
    );
};

const sortNodes = (nodes: ArtifactNode[]): ArtifactNode[] =>
  nodes.sort((left, right) =>
    compareUnicodeCodePoints(left.artifact_id, right.artifact_id),
  );

const sortOccurrences = (
  occurrences: MutableOccurrence[],
): MutableOccurrence[] =>
  occurrences.sort((left, right) =>
    compareUnicodeCodePoints(left.logical_path, right.logical_path),
  );

const sortEdges = <T extends { edge_id: string }>(edges: T[]): T[] =>
  edges.sort((left, right) =>
    compareUnicodeCodePoints(left.edge_id, right.edge_id),
  );

const buildManifest = ({
  rootNode,
  rootFormat,
  graphSha256,
  orderedNodes,
  orderedOccurrences,
  orderedEdges,
}: {
  readonly rootNode: ArtifactNode;
  readonly rootFormat: ArtifactOccurrence["artifact_format"];
  readonly graphSha256: string;
  readonly orderedNodes: readonly ArtifactNode[];
  readonly orderedOccurrences: readonly unknown[];
  readonly orderedEdges: readonly { edge_id: string }[];
}): ArtifactInventoryResult["manifest"] =>
  artifactInventoryResultSchema.shape.manifest.parse({
    manifest_id: artifactManifestId(rootNode.artifact_id, graphSha256),
    root_artifact_id: rootNode.artifact_id,
    root_sha256: rootNode.sha256,
    root_format: rootFormat,
    graph_sha256: graphSha256,
    node_count: orderedNodes.length,
    occurrence_count: orderedOccurrences.length,
    edge_count: orderedEdges.length,
  });

const buildLimitations = (
  scopeLimitations: readonly string[],
  integrityContradictions: readonly IntegrityContradiction[],
  caseCollisionLimitation: string | undefined,
): string[] => [
  ...scopeLimitations,
  ...(caseCollisionLimitation === undefined ? [] : [caseCollisionLimitation]),
  ...(integrityContradictions.length === 0
    ? []
    : [
        `${String(integrityContradictions.length)} integrity contradiction(s) were recorded; mismatched content is observed-untrusted.`,
      ]),
];

import type { AsarHeaderAdmission } from "../../config/asarHeaderAdmission.js";
import {
  artifactContainerIntegrityDetails,
  artifactIntegrityPair,
  artifactIntegrityDetails,
  type ArtifactContainerIntegrityPair,
  type ArtifactIntegrityPair,
} from "../../domain/artifactIntegrity.js";
import { isAbsolute } from "node:path";
import { createHash, type Hash } from "node:crypto";

import {
  annotateEnglishUnicodeCaseCollisions,
  ArtifactPathRegistry,
  normalizeArtifactPath,
} from "../ArtifactPaths.js";
import {
  ArtifactEntryContentUnavailable,
  ArtifactReaderFailure,
  type ArtifactEntry,
  type ArtifactReader,
  type ArtifactReaderTraversal,
} from "../ArtifactReader.js";
import { ArtifactTraversalObservation } from "../ArtifactTraversalObservation.js";
import { DirectoryArtifactEntryAccessDenied } from "../DirectoryArtifactReader.js";
import { AsarArtifactReader } from "../AsarArtifactReader.js";
import {
  InesArtifactReader,
  type InesRegionScan,
} from "../InesArtifactReader.js";
import type { ArtifactNode } from "../../domain/artifactGraph.js";
import {
  classifyArtifactContent,
  classifyArtifactBytes,
  createArtifactNode,
  createOccurrence,
  noteUnreadContainerSuffix,
  indexDestinationOccurrencesByPath,
  resolveOccurrenceParents,
  type MutableOccurrence,
} from "./ArtifactGraphConstruction.js";
import type { ArtifactIntegrityPolicyName } from "../../domain/artifactIntegrityPolicy.js";
import { abortIfNeeded, hashReadable } from "../ArtifactHash.js";

export interface PendingIntegrityContradiction {
  readonly occurrence: MutableOccurrence;
  readonly integrity: ArtifactIntegrityPair;
  readonly entryKind: "file" | "slice";
  readonly unpacked: boolean;
}

const emptyScan = (): {
  readonly nodes: Map<string, ArtifactNode>;
  readonly occurrences: MutableOccurrence[];
  readonly pendingContradictions: PendingIntegrityContradiction[];
} => ({ nodes: new Map(), occurrences: [], pendingContradictions: [] });

interface ScanContext {
  readonly reader: ArtifactReader;
  readonly signal: AbortSignal | undefined;
  readonly integrity: ArtifactIntegrityPolicyName;
  readonly asarHeaderAdmission: AsarHeaderAdmission | undefined;
  readonly nodes: Map<string, ArtifactNode>;
  readonly occurrences: MutableOccurrence[];
  readonly pendingContradictions: PendingIntegrityContradiction[];
  readonly occurrenceCountByPath: Map<string, number>;
  readonly registry: ArtifactPathRegistry;
  readonly expandedContainerIds: Set<string>;
  readonly ownedReaders: ArtifactReader[];
  readonly reconstruction:
    | {
        readonly hash: Hash;
        readonly regionOrder: string[];
        bytes: number;
      }
    | undefined;
  readonly traversal: ArtifactTraversalObservation;
}

export const scanReader = async (
  reader: ArtifactReader | undefined,
  ownedReaders: ArtifactReader[],
  signal?: AbortSignal,
  integrity: ArtifactIntegrityPolicyName = "fail",
  asarHeaderAdmission?: AsarHeaderAdmission,
): Promise<{
  readonly nodes: Map<string, ArtifactNode>;
  readonly occurrences: MutableOccurrence[];
  readonly pendingContradictions: PendingIntegrityContradiction[];
  readonly caseCollisionLimitation: string | undefined;
  readonly inesRegionScan: InesRegionScan | undefined;
  readonly unknownParentOccurrences: ReadonlySet<MutableOccurrence>;
  readonly traversal: ArtifactReaderTraversal;
  /** A recorded disagreement between the root's own checksum and its bytes. */
  readonly rootContradiction: ArtifactContainerIntegrityPair | undefined;
}> => {
  const { nodes, occurrences, pendingContradictions } = emptyScan();
  if (reader === undefined)
    return {
      nodes,
      occurrences,
      pendingContradictions,
      caseCollisionLimitation: undefined,
      inesRegionScan: undefined,
      unknownParentOccurrences: new Set(),
      traversal: { status: "complete", limitations: [] },
      rootContradiction: undefined,
    };
  const context: ScanContext = {
    reader,
    signal,
    integrity,
    asarHeaderAdmission,
    nodes,
    occurrences,
    pendingContradictions,
    occurrenceCountByPath: new Map<string, number>(),
    registry: new ArtifactPathRegistry(),
    expandedContainerIds: new Set<string>(),
    ownedReaders,
    reconstruction:
      reader instanceof InesArtifactReader
        ? { hash: createHash("sha256"), regionOrder: [], bytes: 0 }
        : undefined,
    traversal: new ArtifactTraversalObservation(),
  };
  await visitArtifactEntries(context, reader, "");
  const rootContradiction = containerContradiction(reader, integrity);
  // Archive directories may appear after their children. Resolve containment
  // against the complete index before directory identities are materialized.
  const byPath = indexDestinationOccurrencesByPath(occurrences);
  const parentResolution = resolveOccurrenceParents(
    occurrences,
    byPath,
    context.expandedContainerIds,
  );
  const structuralLimitations = [...parentResolution.limitations];
  context.traversal.onCoverage({
    status: structuralLimitations.length === 0 ? "complete" : "unknown",
    limitations: structuralLimitations,
  });
  return {
    nodes,
    occurrences,
    pendingContradictions,
    caseCollisionLimitation: annotateEnglishUnicodeCaseCollisions(occurrences),
    inesRegionScan:
      context.reconstruction === undefined
        ? undefined
        : {
            region_order: context.reconstruction.regionOrder,
            bytes: context.reconstruction.bytes,
            sha256: context.reconstruction.hash.digest("hex"),
          },
    unknownParentOccurrences: parentResolution.unknownParentOccurrences,
    traversal: context.traversal.snapshot(),
    rootContradiction,
  };
};

/** Apply the integrity policy to a checksum the root declares over its own bytes. */
const containerContradiction = (
  reader: ArtifactReader,
  integrity: ArtifactIntegrityPolicyName,
): ArtifactContainerIntegrityPair | undefined => {
  const pair = reader.containerIntegrity?.();
  if (pair === undefined || pair.declared_crc32 === pair.observed_crc32)
    return undefined;
  if (integrity === "fail")
    throw new ArtifactReaderFailure(
      "integrity",
      "Artifact integrity metadata disagrees with content: .",
      undefined,
      artifactContainerIntegrityDetails(".", pair),
    );
  return pair;
};

const inventoryEntries = (
  context: ScanContext,
  reader: ArtifactReader,
  prefix: string,
): AsyncIterator<ArtifactEntry> =>
  reader
    .entries(context.signal, {
      onCoverage: context.traversal.onCoverage,
      onOmission: (omission) =>
        context.traversal.onOmission({
          ...omission,
          path:
            prefix.length === 0 ? omission.path : `${prefix}/${omission.path}`,
        }),
    })
    [Symbol.asyncIterator]();

const visitArtifactEntries = async (
  context: ScanContext,
  currentReader: ArtifactReader,
  prefix: string,
): Promise<void> => {
  const stack: Array<{
    readonly reader: ArtifactReader;
    readonly prefix: string;
    readonly containerId: string | null;
    readonly iterator: AsyncIterator<ArtifactEntry>;
  }> = [
    {
      reader: currentReader,
      prefix,
      containerId: null,
      iterator: inventoryEntries(context, currentReader, prefix),
    },
  ];
  let failure: { readonly cause: unknown } | undefined;
  try {
    while (stack.length > 0) {
      const frame = stack.at(-1);
      if (frame === undefined) break;
      const next = await frame.iterator.next();
      if (next.done) {
        stack.pop();
        continue;
      }
      const entry = next.value;
      const logicalPath = normalizeArtifactPath(
        frame.prefix.length === 0
          ? entry.path
          : `${frame.prefix}/${entry.path}`,
      );
      const expandableAsar = isExpandableAsar(entry, logicalPath);
      // PyInstaller rows and Bun modules are source-distinct even when their logical
      // destinations collide. Inventory retains those observations; the
      // extraction path registry remains the authority for materialization.
      if (
        frame.reader.format !== "pyinstaller" &&
        frame.reader.format !== "bun-standalone"
      )
        context.registry.add(
          logicalPath,
          expandableAsar ? "directory" : entry.kind,
        );
      const duplicateOrdinal =
        context.occurrenceCountByPath.get(logicalPath) ?? 0;
      context.occurrenceCountByPath.set(logicalPath, duplicateOrdinal + 1);
      const occurrence = createOccurrence(
        entry,
        logicalPath,
        entry.kind === "metadata" ? frame.containerId : null,
        { duplicateOrdinal, sourceFormat: frame.reader.format },
      );
      let digested:
        | {
            readonly node: ArtifactNode;
            readonly mismatched: boolean;
            readonly classification: ReturnType<typeof classifyArtifactContent>;
          }
        | undefined;
      try {
        digested = await digestArtifactEntry(
          context,
          frame.reader,
          entry,
          logicalPath,
          occurrence,
        );
      } catch (cause: unknown) {
        if (
          !(cause instanceof DirectoryArtifactEntryAccessDenied) &&
          !(cause instanceof ArtifactEntryContentUnavailable)
        )
          throw cause;
        abortIfNeeded(context.signal);
        const limitation =
          cause instanceof ArtifactEntryContentUnavailable
            ? cause.limitation
            : cause.message;
        const traversal =
          cause instanceof ArtifactEntryContentUnavailable
            ? cause.traversal
            : { status: "unknown" as const, limitations: [limitation] };
        if (traversal !== undefined) context.traversal.onCoverage(traversal);
        occurrence.hash_status = "unavailable";
        occurrence.limitations.push(limitation);
      }
      if (digested === undefined) noteUnreadContainerSuffix(occurrence);
      else {
        context.nodes.set(digested.node.artifact_id, digested.node);
        occurrence.artifact_id = digested.node.artifact_id;
        const seaMainScript =
          entry.formatMetadata?.kind === "node-sea-entry" &&
          entry.formatMetadata.role === "main-script";
        occurrence.artifact_kind = seaMainScript
          ? "javascript"
          : digested.classification.kind;
        occurrence.artifact_format = seaMainScript
          ? "javascript-bundle"
          : digested.classification.format;
        occurrence.hash_status = digested.mismatched
          ? "mismatched"
          : "verified";
        if (digested.mismatched)
          occurrence.limitations.push(
            "Declared integrity metadata contradicts observed bytes.",
          );
      }
      context.occurrences.push(occurrence);
      if (
        expandableAsar &&
        digested !== undefined &&
        digested.classification.format === "asar" &&
        !digested.mismatched
      ) {
        const nested = new AsarArtifactReader(
          entry.adapterKey,
          context.asarHeaderAdmission === undefined
            ? {}
            : { headerAdmission: context.asarHeaderAdmission },
        );
        context.ownedReaders.push(nested);
        await nested.prepareContainer(digested.node.sha256, context.signal);
        // Only traversed containers can own members, not opaque ASAR-named files.
        context.expandedContainerIds.add(occurrence.occurrence_id);
        stack.push({
          reader: nested,
          prefix: logicalPath,
          containerId: occurrence.occurrence_id,
          iterator: inventoryEntries(context, nested, logicalPath),
        });
      }
    }
  } catch (cause: unknown) {
    failure = { cause };
  } finally {
    // Readers remain owned by the inventory until its complete observation is built.
    for (const { iterator, prefix, reader } of stack.reverse()) {
      try {
        await iterator.return?.();
      } catch (cause: unknown) {
        failure = {
          cause: ArtifactReaderFailure.withCleanup(
            failure === undefined ? cause : failure.cause,
            ArtifactReaderFailure.cleanupObservation(
              cause,
              `artifact traversal for ${prefix || reader.format}`,
            ),
          ),
        };
      }
    }
  }
  if (failure !== undefined) throw failure.cause;
};

const digestArtifactEntry = async (
  context: ScanContext,
  currentReader: ArtifactReader,
  entry: ArtifactEntry,
  logicalPath: string,
  occurrence: MutableOccurrence,
): Promise<
  | {
      readonly node: ArtifactNode;
      readonly mismatched: boolean;
      readonly classification: ReturnType<typeof classifyArtifactContent>;
    }
  | undefined
> => {
  if ((entry.kind !== "file" && entry.kind !== "slice") || entry.encrypted)
    return undefined;
  const reconstruction =
    currentReader === context.reader ? context.reconstruction : undefined;
  if (reconstruction !== undefined && entry.byteOffset !== reconstruction.bytes)
    throw new ArtifactReaderFailure("integrity", "Noncontiguous iNES regions");
  const digest = await hashReadable(
    await currentReader.open(entry, context.signal),
    context.signal,
    entry.declaredIntegrity?.algorithm,
    context.asarHeaderAdmission,
    reconstruction === undefined
      ? undefined
      : (chunk) => {
          reconstruction.hash.update(chunk);
          reconstruction.bytes += chunk.length;
        },
  );
  reconstruction?.regionOrder.push(entry.path);
  const claim = entry.declaredIntegrity;
  const observed = claim?.algorithm === "md5" ? digest.md5 : digest.sha256;
  if (claim !== null && observed === undefined)
    throw new ArtifactReaderFailure(
      "integrity",
      "The selected integrity digest was not computed",
    );
  const mismatched = claim !== null && claim.digest !== observed;
  if (mismatched && claim !== null && observed !== undefined) {
    if (context.integrity === "fail")
      throw new ArtifactReaderFailure(
        "integrity",
        `Artifact integrity metadata disagrees with content: ${logicalPath}`,
        undefined,
        artifactIntegrityDetails(logicalPath, claim, observed, entry.unpacked),
      );
    context.pendingContradictions.push({
      occurrence,
      integrity: artifactIntegrityPair(claim, observed),
      entryKind: entry.kind,
      unpacked: entry.unpacked,
    });
  }
  const classified =
    entry.kind === "slice"
      ? {
          kind: "universal-slice" as const,
          format: "mach-o" as const,
          contentFormat: classifyArtifactBytes(digest, digest.bytes),
        }
      : classifyArtifactContent(logicalPath, digest, digest.bytes);
  return {
    node: createArtifactNode({
      sha256: digest.sha256,
      size: digest.bytes,
      format: classified.contentFormat,
      contentState: "embedded",
    }),
    mismatched,
    classification: classified,
  };
};

const isExpandableAsar = (entry: ArtifactEntry, logicalPath: string): boolean =>
  entry.kind === "file" &&
  logicalPath.toLowerCase().endsWith(".asar") &&
  isAbsolute(entry.adapterKey);

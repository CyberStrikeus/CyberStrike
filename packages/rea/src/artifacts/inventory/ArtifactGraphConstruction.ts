import { artifactFormatDescriptor } from "../artifactFormats.js";
import { hasGodotPckHeader } from "../../domain/godotPckFormat.js";
import { hasUImageMagic } from "../../domain/uimageFormat.js";
import { hasUnityFsHeader } from "../../domain/unityfsFormat.js";
import { detectHexRecordEncoding } from "../../domain/firmware/hexRecords.js";
import { recognizeEspImage } from "../../domain/firmware/espImage.js";
import { hasUf2Block } from "../../domain/firmware/uf2.js";
import { isDfuSeFile } from "../../domain/firmware/dfuse.js";
import { hasFitImagesNode } from "../../domain/firmware/fitImage.js";
import type { ArtifactClassificationEvidence } from "../ArtifactClassificationProbe.js";
import { asarHeaderAdmissionFailure } from "../AsarHeader.js";
import { hasDestinationPath } from "../ArtifactPaths.js";
import { compareUnicodeCodePoints } from "../../domain/unicodeCodePointOrder.js";
import { isJavaScriptSourcePath } from "../../domain/javascript/javascriptArtifactFiles.js";
import { digestCanonicalValue } from "../../domain/canonicalDigest.js";
import {
  hasBinaryPlistSignature,
  hasXmlPlistSignature,
} from "../../domain/apple/appleArchiveFormat.js";
import {
  artifactEdgeId,
  artifactIdForContent,
  occurrenceIdForLocation,
  logicalPathNfc,
} from "../../domain/artifactIdentity.js";
import type { ArtifactEntry, ArtifactReader } from "../ArtifactReader.js";
import type {
  ArtifactCommand,
  ArtifactEdge,
  ArtifactNode,
  ArtifactOccurrence,
} from "../../domain/artifactGraph.js";
import {
  hasZipSignature,
  zipPackageFormatForPath,
  type ZipPackageFormat,
} from "../../domain/zipPackageFormat.js";
import { parseMzHeaderEvidence } from "../../domain/dosMz.js";
import {
  classifyFatContainerEvidence,
  readFatContainerHeader,
  readMachoHeaderPrefixFacts,
} from "../../domain/apple/machoContainer.js";
import {
  nesContainerFormat,
  parseInesLayout,
} from "../../domain/inesContainer.js";

/** Mutable internal occurrence used until root-bound IDs are known. */
export interface MutableOccurrence {
  occurrence_id: string;
  artifact_id: string | null;
  parent_occurrence_id: string | null;
  logical_path: string;
  entry_kind: ArtifactOccurrence["entry_kind"];
  artifact_kind: ArtifactOccurrence["artifact_kind"];
  artifact_format: ArtifactOccurrence["artifact_format"];
  declared_size: number | null;
  compressed_size: number | null;
  executable: boolean;
  encrypted: boolean;
  unpacked?: boolean;
  hash_status: ArtifactOccurrence["hash_status"];
  source_location: ArtifactOccurrence["source_location"];
  source_path?: string;
  declared_integrity?: NonNullable<ArtifactOccurrence["declared_integrity"]>;
  format_metadata?: NonNullable<ArtifactOccurrence["format_metadata"]>;
  limitations: string[];
}

/** Index destination paths without mixing in declaration query names or choosing an owner. */
export const indexDestinationOccurrencesByPath = (
  occurrences: readonly MutableOccurrence[],
): ReadonlyMap<string, readonly MutableOccurrence[]> => {
  const byPath = new Map<string, MutableOccurrence[]>();
  for (const occurrence of occurrences) {
    if (!hasDestinationPath(occurrence.entry_kind)) continue;
    const matches = byPath.get(occurrence.logical_path);
    if (matches === undefined)
      byPath.set(occurrence.logical_path, [occurrence]);
    else matches.push(occurrence);
  }
  return byPath;
};

/**
 * Create an occurrence before its bytes are read. A container suffix is not a
 * container family until the bytes are classified, so a member named like a
 * container starts with an unknown format.
 */
export const createOccurrence = (
  entry: ArtifactEntry,
  path: string,
  parent: string | null,
  options: {
    readonly duplicateOrdinal?: number;
    readonly sourceFormat?: ArtifactReader["format"];
  } = {},
): MutableOccurrence => {
  const duplicateOrdinal = options.duplicateOrdinal ?? 0;
  const role =
    entry.kind === "metadata"
      ? { kind: "package-metadata" as const, format: "unknown" as const }
      : entry.kind === "directory"
        ? {
            kind: path.toLowerCase().endsWith(".framework")
              ? ("framework" as const)
              : ("container" as const),
            format: "directory" as const,
          }
        : containerSuffixFamily(path) === undefined
          ? classifyArtifactPath(path)
          : ({ kind: "unknown", format: "unknown" } as const);
  return {
    occurrence_id: `occ_${digestCanonicalValue(
      duplicateOrdinal === 0
        ? { path, kind: entry.kind }
        : { path, kind: entry.kind, duplicate_ordinal: duplicateOrdinal },
      "Artifact",
    )}`,
    artifact_id: null,
    parent_occurrence_id: parent,
    logical_path: path,
    ...(entry.sourcePath !== undefined ||
    entry.path !== logicalPathNfc(entry.path)
      ? { source_path: entry.sourcePath ?? entry.path }
      : {}),
    entry_kind: entry.kind,
    artifact_kind: role.kind,
    artifact_format: role.format,
    declared_size: entry.declaredSize,
    compressed_size: entry.compressedSize,
    executable: entry.executable,
    encrypted: entry.encrypted,
    ...(entry.unpacked ||
    (options.sourceFormat === "asar" && entry.kind === "file")
      ? { unpacked: entry.unpacked }
      : {}),
    hash_status: entry.encrypted ? "unavailable" : "not-hashed",
    source_location:
      entry.encrypted ||
      entry.byteOffset === null ||
      entry.declaredSize === null
        ? null
        : {
            offset: entry.byteOffset,
            length: entry.byteLength ?? entry.declaredSize,
          },
    limitations: [...entry.limitations],
    ...(entry.declaredIntegrity === null
      ? {}
      : { declared_integrity: { ...entry.declaredIntegrity } }),
    ...(entry.formatMetadata === undefined
      ? {}
      : { format_metadata: { ...entry.formatMetadata } }),
  };
};

/** Record that an unread member's container suffix was not checked against bytes. */
export const noteUnreadContainerSuffix = (
  occurrence: MutableOccurrence,
): void => {
  if (occurrence.entry_kind === "directory") return;
  const family = containerSuffixFamily(occurrence.logical_path);
  if (family === undefined) return;
  occurrence.limitations.push(
    `The path suffix suggests ${family.toUpperCase()}, but these bytes were not read, so the container family is unknown.`,
  );
};

const containerSuffixFamily = (
  path: string,
): "asar" | ZipPackageFormat | undefined => {
  const lower = path.toLowerCase();
  return lower.endsWith(".asar") ? "asar" : zipPackageFormatForPath(lower);
};

/** Compare exact child names independently of host locale and traversal order. */
export const materializeDirectoryNodes = (
  occurrences: MutableOccurrence[],
  nodes: Map<string, ArtifactNode>,
): void => {
  const directories = occurrences
    .filter(
      ({ entry_kind: kind, hash_status }) =>
        kind === "directory" && hash_status !== "unavailable",
    )
    .sort(
      (left, right) => depth(right.logical_path) - depth(left.logical_path),
    );
  const childrenByParent = new Map<string, MutableOccurrence[]>();
  for (const occurrence of occurrences) {
    if (occurrence.parent_occurrence_id === null) continue;
    const children = childrenByParent.get(occurrence.parent_occurrence_id);
    if (children === undefined)
      childrenByParent.set(occurrence.parent_occurrence_id, [occurrence]);
    else children.push(occurrence);
  }
  for (const directory of directories) {
    const children = (childrenByParent.get(directory.occurrence_id) ?? [])
      .map(({ logical_path, artifact_id, entry_kind }) => ({
        // Intermediate directory entries may be absent from an archive.
        name: logical_path.slice(directory.logical_path.length + 1),
        artifact_id,
        entry_kind,
      }))
      .sort((left, right) => compareUnicodeCodePoints(left.name, right.name));
    const node = createArtifactNode({
      sha256: digestCanonicalValue({ kind: "directory", children }, "Artifact"),
      size: 0,
      format: "directory",
      contentState: "virtual",
    });
    nodes.set(node.artifact_id, node);
    directory.artifact_id = node.artifact_id;
    directory.hash_status = "verified";
  }
};

export const createRootNode = (input: {
  readonly digest:
    | ({
        readonly sha256: string;
        readonly bytes: number;
      } & ArtifactClassificationEvidence)
    | null;
  readonly occurrences: readonly MutableOccurrence[];
}): ArtifactNode =>
  createArtifactNode({
    sha256:
      input.digest?.sha256 ??
      digestCanonicalValue(
        {
          kind: "directory-root",
          children: input.occurrences
            .map(({ logical_path, artifact_id }) => ({
              logical_path,
              artifact_id,
            }))
            .sort((left, right) =>
              compareUnicodeCodePoints(left.logical_path, right.logical_path),
            ),
        },
        "Artifact",
      ),
    size: input.digest?.bytes ?? 0,
    format:
      input.digest === null
        ? "directory"
        : classifyArtifactBytes(input.digest, input.digest.bytes),
    contentState: "materialized",
  });

export const createArtifactNode = (input: {
  readonly sha256: string;
  readonly size: number;
  readonly format: ArtifactNode["format"];
  readonly contentState: ArtifactNode["content_state"];
}): ArtifactNode => ({
  artifact_id: artifactIdForContent(input.sha256),
  format: input.format,
  sha256: input.sha256,
  size: input.size,
  media_type: null,
  architecture: null,
  content_state: input.contentState,
  limitations: [],
});

export const rootOccurrenceFor = (
  node: ArtifactNode,
  metadata: {
    readonly size: number;
    readonly executable: boolean;
    readonly format: ArtifactOccurrence["artifact_format"];
    readonly path: string;
    readonly formatMetadata?: ArtifactOccurrence["format_metadata"];
  },
): MutableOccurrence => ({
  occurrence_id: occurrenceIdForLocation({
    rootArtifactId: node.artifact_id,
    logicalPath: ".",
    entryKind: metadata.format === "directory" ? "directory" : "file",
  }),
  artifact_id: node.artifact_id,
  parent_occurrence_id: null,
  logical_path: ".",
  entry_kind: metadata.format === "directory" ? "directory" : "file",
  artifact_kind:
    artifactFormatDescriptor(metadata.format)?.occurrenceContainer === true
      ? "container"
      : artifactRoleForFormat(metadata.path, metadata.format).kind,
  artifact_format: metadata.format,
  declared_size: metadata.size,
  compressed_size: null,
  executable: metadata.executable,
  encrypted:
    (metadata.formatMetadata?.kind === "godot-pck" ||
      metadata.formatMetadata?.kind === "unityfs") &&
    metadata.formatMetadata.directory_status === "encrypted",
  hash_status: "verified",
  source_location: null,
  ...(metadata.formatMetadata === undefined
    ? {}
    : { format_metadata: metadata.formatMetadata }),
  limitations: [],
});

export const rekeyOccurrences = (
  rootArtifactId: string,
  occurrences: MutableOccurrence[],
): void => {
  const replacements = new Map<string, string>();
  const ordinalByPath = new Map<string, number>();
  for (const occurrence of occurrences) {
    const ordinal = ordinalByPath.get(occurrence.logical_path) ?? 0;
    ordinalByPath.set(occurrence.logical_path, ordinal + 1);
    replacements.set(
      occurrence.occurrence_id,
      occurrenceIdForLocation({
        rootArtifactId,
        logicalPath: occurrence.logical_path,
        entryKind: occurrence.entry_kind,
        ...(ordinal === 0 ? {} : { duplicateOrdinal: ordinal }),
      }),
    );
  }
  for (const occurrence of occurrences) {
    occurrence.occurrence_id =
      replacements.get(occurrence.occurrence_id) ?? occurrence.occurrence_id;
    if (occurrence.parent_occurrence_id !== null)
      occurrence.parent_occurrence_id =
        replacements.get(occurrence.parent_occurrence_id) ??
        occurrence.parent_occurrence_id;
  }
};

export const createArtifactEdges = (
  rootArtifactId: string,
  occurrences: MutableOccurrence[],
  producer?: ArtifactCommand,
): { readonly edges: ArtifactEdge[]; readonly limitations: string[] } => {
  const byId = new Map(occurrences.map((item) => [item.occurrence_id, item]));
  const byPath = indexDestinationOccurrencesByPath(occurrences);
  const edges: ArtifactEdge[] = [];
  const limitations: string[] = [];
  for (const occurrence of occurrences) {
    // Use the occurrence's own classification: a directory named `x.map` is
    // a container, not a source map of its sibling.
    const isSourceMap = occurrence.artifact_kind === "source-map";
    const sourcePath = isSourceMap
      ? occurrence.logical_path.slice(0, -".map".length)
      : undefined;
    const sourceCandidates =
      sourcePath === undefined ? [] : (byPath.get(sourcePath) ?? []);
    const mappedSource =
      sourceCandidates.length === 1 &&
      sourceCandidates[0]?.entry_kind === "file" &&
      sourceCandidates[0].artifact_id !== null
        ? sourceCandidates[0]
        : undefined;
    if (sourcePath !== undefined) {
      const unknownMapping =
        sourceCandidates.length > 1
          ? {
              occurrence: `Source-map target is unknown because multiple occurrences share ${JSON.stringify(sourcePath)}.`,
              coverage: `Source-map relationships are unknown because multiple occurrences share ${JSON.stringify(sourcePath)}.`,
            }
          : sourceCandidates.length === 1 &&
              sourceCandidates[0]?.entry_kind === "file" &&
              mappedSource === undefined
            ? {
                occurrence: `Source-map target identity is unknown because the matching occurrence at ${JSON.stringify(sourcePath)} has no content identity.`,
                coverage: `Source-map relationships are unknown because the matching occurrence at ${JSON.stringify(sourcePath)} has no content identity.`,
              }
            : undefined;
      if (unknownMapping !== undefined) {
        occurrence.limitations.push(unknownMapping.occurrence);
        limitations.push(unknownMapping.coverage);
      }
    }
    if (
      occurrence.parent_occurrence_id === null ||
      occurrence.artifact_id === null
    )
      continue;
    const parentArtifactId =
      mappedSource?.artifact_id ??
      byId.get(occurrence.parent_occurrence_id)?.artifact_id ??
      rootArtifactId;
    const semantic = {
      parent_artifact_id: parentArtifactId,
      relation:
        occurrence.entry_kind === "slice"
          ? ("slice-of" as const)
          : occurrence.format_metadata?.kind === "pyinstaller-entry" &&
              occurrence.format_metadata.bytecode_header === "derived"
            ? ("derived-from" as const)
            : isSourceMap
              ? mappedSource === undefined
                ? ("contains" as const)
                : ("maps-source" as const)
              : relationFor(occurrence.logical_path),
      occurrence_id: occurrence.occurrence_id,
    };
    edges.push({
      edge_id: artifactEdgeId(semantic, occurrence),
      ...semantic,
      producer: occurrence.entry_kind === "slice" ? (producer ?? null) : null,
      ordinal: edges.length,
    });
  }
  return { edges, limitations };
};

interface ArtifactParentIndex {
  readonly children: Map<string, ArtifactParentIndex>;
  occurrences?: readonly MutableOccurrence[];
}

/** Resolve strict observed ancestors without rebuilding every path prefix. */
export const resolveOccurrenceParents = (
  occurrences: readonly MutableOccurrence[],
  byPath: ReadonlyMap<string, readonly MutableOccurrence[]>,
  expandedContainerIds: ReadonlySet<string>,
): {
  readonly limitations: readonly string[];
  readonly unknownParentOccurrences: ReadonlySet<MutableOccurrence>;
} => {
  const root: ArtifactParentIndex = { children: new Map() };
  for (const matches of byPath.values()) {
    const parents = matches.filter(
      (occurrence) =>
        occurrence.entry_kind === "directory" ||
        expandedContainerIds.has(occurrence.occurrence_id),
    );
    if (parents.length === 0) continue;
    if (parents.length > 1)
      for (const parent of parents)
        if (parent.entry_kind === "directory") {
          parent.artifact_id = null;
          parent.hash_status = "unavailable";
          parent.limitations.push(
            "This directory occurrence cannot be materialized because multiple directory entries share its logical path.",
          );
        }
    const path = matches[0]?.logical_path;
    if (path === undefined) continue;
    let branch = root;
    for (const segment of path.split("/")) {
      let child = branch.children.get(segment);
      if (child === undefined) {
        child = { children: new Map() };
        branch.children.set(segment, child);
      }
      branch = child;
    }
    branch.occurrences = parents;
  }
  const limitations = new Set<string>();
  const unknownParentOccurrences = new Set<MutableOccurrence>();
  for (const occurrence of occurrences) {
    // Query paths do not imply filesystem containment. The scanner records
    // the declaring container for metadata instead.
    if (occurrence.entry_kind === "metadata") continue;
    const path = occurrence.logical_path;
    let branch = root;
    let parent: MutableOccurrence | undefined;
    let ambiguousParentPath: string | undefined;
    let prefix = "";
    // Walk parent segments only. Stop scanning the path once no observed
    // directory or expanded container can be an ancestor.
    for (let start = 0; ;) {
      const slash = path.indexOf("/", start);
      if (slash < 0) break;
      const segment = path.slice(start, slash);
      const child = branch.children.get(segment);
      if (child === undefined) break;
      branch = child;
      prefix = prefix.length === 0 ? segment : `${prefix}/${segment}`;
      const candidates = branch.occurrences ?? [];
      if (candidates.length === 1) {
        parent = candidates[0];
        ambiguousParentPath = undefined;
      } else if (candidates.length > 1) {
        parent = undefined;
        ambiguousParentPath = prefix;
      }
      start = slash + 1;
    }
    occurrence.parent_occurrence_id = parent?.occurrence_id ?? null;
    if (ambiguousParentPath !== undefined) {
      const limitation = `The parent occurrence for ${JSON.stringify(path)} is unknown because multiple observed directory or container occurrences share ${JSON.stringify(ambiguousParentPath)}.`;
      occurrence.limitations.push(limitation);
      limitations.add(limitation);
      unknownParentOccurrences.add(occurrence);
    }
  }
  return {
    limitations: [...limitations].sort(compareUnicodeCodePoints),
    unknownParentOccurrences,
  };
};

/**
 * Assign a path role hint. Container families are not path roles: ZIP and
 * ASAR families are chosen only after their bytes have been classified.
 */
export const classifyArtifactPath = (
  path: string,
): {
  readonly kind: ArtifactOccurrence["artifact_kind"];
  readonly format: ArtifactOccurrence["artifact_format"];
} => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".map"))
    return { kind: "source-map", format: "source-map" };
  if (isJavaScriptSourcePath(path))
    return { kind: "javascript", format: "javascript-bundle" };
  if (/\.framework(?:\/|$)/u.test(lower))
    return { kind: "framework", format: "file" };
  if (/\.(?:node|dylib|so)$/u.test(lower))
    return {
      kind: lower.endsWith(".node") ? "native-addon" : "dynamic-library",
      format: "file",
    };
  if (lower.endsWith(".plist")) return { kind: "plist", format: "plist" };
  if (lower.endsWith(".entitlements"))
    return { kind: "entitlements", format: "entitlements" };
  return { kind: "resource", format: "file" };
};

/** Classify executable formats from bytes while retaining path-specific roles. */
export const classifyArtifactContent = (
  path: string,
  evidence: ArtifactClassificationEvidence,
  fileSize = evidence.prefix.length,
): {
  readonly kind: ArtifactOccurrence["artifact_kind"];
  readonly format: ArtifactOccurrence["artifact_format"];
  readonly contentFormat: ArtifactNode["format"];
} => {
  const { prefix, asarHeader } = evidence;
  const contentFormat = classifyArtifactBytes(evidence, fileSize);
  const byPath = classifyArtifactPath(path);
  let role: ReturnType<typeof classifyArtifactPath>;
  if (
    contentFormat === "plist" &&
    !hasBinaryPlistSignature(prefix) &&
    (["javascript", "source-map", "entitlements"].includes(byPath.kind) ||
      path.toLowerCase().endsWith(".asar"))
  )
    role = byPath;
  else if (
    contentFormat === "file" &&
    path.toLowerCase().endsWith(".asar") &&
    asarHeader.state !== "rejected"
  ) {
    if (asarHeader.state === "limit")
      throw asarHeaderAdmissionFailure(asarHeader.admission);
    if (asarHeader.state === "matched")
      role = { kind: "container", format: "asar" };
    else role = artifactRoleForFormat(path, contentFormat);
  } else role = artifactRoleForFormat(path, contentFormat);
  return { ...role, contentFormat };
};

const artifactRoleForFormat = (
  path: string,
  format: ArtifactOccurrence["artifact_format"],
): ReturnType<typeof classifyArtifactPath> => {
  const byPath = classifyArtifactPath(path);
  if (format === "file" || format === byPath.format) return byPath;
  if (format === "unknown") return { kind: "unknown", format };
  if (format === "zip")
    return {
      kind: "container",
      format: zipPackageFormatForPath(path) ?? format,
    };
  if (format === "plist") return { kind: "plist", format };
  if (artifactFormatDescriptor(format)?.roleContainer === true)
    return { kind: "container", format };
  return {
    kind: ["native-addon", "dynamic-library"].includes(byPath.kind)
      ? byPath.kind
      : ("executable" as const),
    format,
  };
};

/** Classify storage bytes independently of path names, roles, and permissions. */
export const classifyArtifactBytes = (
  evidence: ArtifactClassificationEvidence,
  fileSize = evidence.prefix.length,
): ArtifactNode["format"] => {
  const { prefix, suffix, mzWindowsHeaderSignature } = evidence;
  // A header-only region has the signature but not the declared cartridge
  // extent. Keep it as a file instead of inventing another container.
  if (
    nesContainerFormat(prefix) === "ines" &&
    parseInesLayout(prefix, fileSize).ok
  )
    return "ines";
  if (hasZipSignature(prefix)) return "zip";
  if (hasGodotPckHeader(prefix)) return "godot-pck";
  if (hasUnityFsHeader(prefix)) return "unityfs";
  if (hasUImageMagic(prefix)) return "uimage";
  const hexRecords = detectHexRecordEncoding(prefix);
  if (hexRecords !== undefined) return hexRecords;
  if (hasUf2Block(prefix)) return "uf2";
  if (suffix !== undefined && isDfuSeFile(prefix, suffix, fileSize))
    return "dfuse";
  if (recognizeEspImage(prefix, fileSize) === "esp-image") return "esp-image";
  if (hasFitImagesNode(prefix)) return "fit";
  if (hasBinaryPlistSignature(prefix)) return "plist";
  if (hasXmlPlistSignature(prefix)) return "plist";
  const fatFormat = classifyFatArtifact(evidence, fileSize);
  if (fatFormat !== null) return fatFormat;
  if (prefix.length >= 4) {
    if (readMachoHeaderPrefixFacts(prefix).format !== null) return "mach-o";
    if (prefix.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])))
      return "elf";
  }
  if (prefix.length >= 2 && prefix[0] === 0x4d && prefix[1] === 0x5a) {
    if (
      !Number.isSafeInteger(fileSize) ||
      fileSize < prefix.length ||
      prefix.length < Math.min(fileSize, 64)
    )
      return "unknown";
    const mzEvidence = parseMzHeaderEvidence(
      prefix,
      fileSize,
      mzWindowsHeaderSignature,
    );
    const { windowsHeader } = mzEvidence;
    if (windowsHeader.state === "signature-needed") return "unknown";
    if (windowsHeader.state === "candidate") return "unknown";
    if (windowsHeader.state === "declared") {
      const windowsOffset = windowsHeader.offset;
      if (
        windowsHeader.signature === "PE" &&
        windowsOffset >= 64 &&
        (windowsOffset <= prefix.length - 4 ||
          (mzWindowsHeaderSignature?.offset === windowsOffset &&
            mzWindowsHeaderSignature.bytes.length >= 4))
      )
        return "pe";
      return "unknown";
    }
    if (mzEvidence.dos.ok) return "dos-mz";
    return "unknown";
  }
  return "file";
};

const classifyFatArtifact = (
  evidence: ArtifactClassificationEvidence,
  fileSize: number,
): ArtifactNode["format"] | null => {
  const { prefix, fatSliceHeaders } = evidence;
  const fatHeader =
    fatSliceHeaders?.header ?? readFatContainerHeader(prefix, fileSize);
  if (fatHeader.state === "needs-data" || fatHeader.state === "malformed")
    return "unknown";
  if (fatHeader.state === "not-fat") return null;
  const identity = classifyFatContainerEvidence(
    fatHeader,
    prefix,
    fatSliceHeaders?.sliceHeadersByOffset,
  );
  return identity.state === "mach-o" ? "mach-o-universal" : "unknown";
};

/** Relation of a non-source-map occurrence to its parent. */
const relationFor = (path: string): ArtifactEdge["relation"] =>
  path.toLowerCase().includes(".framework/") ? "embeds" : "contains";

const depth = (path: string): number => path.split("/").length;

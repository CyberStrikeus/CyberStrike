import { posix, win32 } from "node:path";

import type { ApplicationNode } from "./javascriptApplicationGraphSchemas.js";
import type { JavaScriptApplicationGraph } from "./javascriptApplicationGraph.js";
import {
  logicalPathEscapesRoot,
  normalizeJoinedLogicalPath,
} from "../artifactIdentity.js";
import { uniqueSorted } from "../canonicalOrdering.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import type { ParsedStaticLayer } from "./javascriptRuntimeReconciliationParsing.js";
import type { RuntimeReconciliationEntity } from "./javascriptRuntimeReconciliationRuntime.js";

export interface StaticRuntimeCandidate {
  readonly layer: ParsedStaticLayer;
  readonly node: ApplicationNode;
  readonly category: "renderer" | "javascript" | "worker" | "service-worker";
  readonly paths: readonly string[];
  readonly nativeDeclarationPaths: Readonly<
    Record<
      "posix" | "windows",
      readonly { readonly path: string; readonly sourcePath: string | null }[]
    >
  >;
  readonly digests: readonly {
    readonly sha256: string;
    readonly basis: "content-sha256" | "module-source-sha256";
  }[];
}

export interface MappedRuntimePath {
  readonly path: string;
  readonly fileStyle: "posix" | "windows" | null;
  readonly nativeRelativePath: string | null;
  readonly artifactPrefix: string;
  readonly basis:
    | "artifact-path"
    | "operator-file-mapping"
    | "operator-url-mapping";
}

/** Precomputed mapping scope and graph paths for static load-state decisions. */
export interface StaticRuntimeScope {
  readonly artifactPrefixes: readonly string[];
  /** Prefixes beneath which a runtime script or worker had no artifact path. */
  readonly untranslatedArtifactPrefixes: readonly string[];
  readonly pathsByNodeId: ReadonlyMap<string, readonly string[]>;
}

/** Where one static node falls relative to the runtime-exercised mappings. */
export type StaticRuntimeScopeMembership = "outside" | "within" | "uncertain";

/** Index statically reconstructed entities that can receive runtime matches. */
export const collectStaticRuntimeCandidates = (
  layers: readonly ParsedStaticLayer[],
): StaticRuntimeCandidate[] =>
  layers
    .flatMap((layer) => candidatesForLayer(layer))
    .sort(
      (left, right) =>
        compareUnicodeCodePoints(left.layer.layerId, right.layer.layerId) ||
        compareUnicodeCodePoints(left.node.node_id, right.node.node_id),
    );

/** Translate one already-authorized runtime location into artifact paths. */
export const mappedRuntimePaths = (
  layer: ParsedStaticLayer,
  entity: RuntimeReconciliationEntity,
): MappedRuntimePath[] => {
  const paths: MappedRuntimePath[] = [];
  const fileStyle =
    entity.location.kind === "file"
      ? absoluteFilePathStyle(entity.location.value)
      : null;
  if (entity.location.kind === "file" && layer.result.format === "directory") {
    const path = pathBelowRoot(layer.result.input_path, entity.location.value);
    if (path !== null)
      paths.push({
        path,
        fileStyle,
        nativeRelativePath: path,
        artifactPrefix: "",
        basis: "artifact-path",
      });
  }
  for (const mapping of layer.runtimeMappings) {
    const translation = translateRuntimeLocation(mapping, entity.location);
    if (translation.kind !== "translated") continue;
    const suffix = translation.suffix;
    const path = safeArtifactPath(mapping.artifact_prefix, suffix);
    if (path === null) continue;
    paths.push({
      path,
      fileStyle,
      nativeRelativePath: mapping.kind === "file-root" ? suffix : null,
      artifactPrefix: normalizeArtifactPrefix(mapping.artifact_prefix),
      basis:
        mapping.kind === "file-root"
          ? "operator-file-mapping"
          : "operator-url-mapping",
    });
  }
  return uniqueMappedPaths(paths);
};

/** Precompute the artifact prefixes exercised by a bounded runtime set. */
export const createStaticRuntimeScope = (
  layer: ParsedStaticLayer,
  entities: readonly RuntimeReconciliationEntity[],
): StaticRuntimeScope => ({
  ...exercisedArtifactPrefixes(layer, entities),
  pathsByNodeId: indexStaticPaths(layer.graph),
});

/**
 * Classify one static node against the mappings exercised by this runtime set.
 * A node beneath a prefix whose runtime script or worker location could not be
 * translated is uncertain: that location may name it, so absence is unproven.
 */
export const staticNodeRuntimeScope = (
  node: ApplicationNode,
  scope: StaticRuntimeScope,
): StaticRuntimeScopeMembership => {
  const paths = scope.pathsByNodeId.get(node.node_id) ?? [];
  const beneath = (prefixes: readonly string[]): boolean =>
    paths.some((path) =>
      prefixes.some((prefix) => pathWithinPrefix(path, prefix)),
    );
  if (beneath(scope.untranslatedArtifactPrefixes)) return "uncertain";
  return beneath(scope.artifactPrefixes) ? "within" : "outside";
};

const candidatesForLayer = (
  layer: ParsedStaticLayer,
): StaticRuntimeCandidate[] => {
  const graph = layer.graph;
  const pathsByNodeId = indexStaticPaths(graph);
  return graph.nodes.flatMap((node) => {
    const category = candidateCategory(node);
    if (category === null) return [];
    return [
      {
        layer,
        node,
        category,
        paths: pathsByNodeId.get(node.node_id) ?? [],
        nativeDeclarationPaths: nativeDeclarationPaths(node),
        digests: candidateDigests(node),
      },
    ];
  });
};

const candidateCategory = (
  node: ApplicationNode,
): StaticRuntimeCandidate["category"] | null => {
  if (node.kind === "electron-renderer") return "renderer";
  if (
    node.kind === "javascript-asset" ||
    (node.kind === "javascript-module" && !isStaticSourceModule(node))
  )
    return "javascript";
  if (node.kind === "worker") return "worker";
  if (node.kind === "service-worker") return "service-worker";
  return null;
};

const isStaticSourceModule = (node: ApplicationNode): boolean =>
  node.observations.some(
    ({ properties }) => properties.semantic_role === "source-module",
  );

const indexStaticPaths = (
  graph: JavaScriptApplicationGraph,
): ReadonlyMap<string, readonly string[]> => {
  const nodes = new Map(
    graph.nodes.map((candidate) => [candidate.node_id, candidate]),
  );
  const relatedBySource = new Map<string, ApplicationNode[]>();
  for (const edge of graph.edges) {
    if (edge.relation !== "maps_to") continue;
    const target = nodes.get(edge.target_node_id);
    if (target === undefined) continue;
    const related = relatedBySource.get(edge.source_node_id);
    if (related === undefined)
      relatedBySource.set(edge.source_node_id, [target]);
    else related.push(target);
  }
  return new Map(
    graph.nodes.map((node) => [
      node.node_id,
      uniqueSorted([
        ...nodePaths(node),
        ...(usesApplicationFileDeclaration(node)
          ? []
          : (relatedBySource.get(node.node_id) ?? []).flatMap(nodePaths)),
      ]),
    ]),
  );
};

const nodePaths = (node: ApplicationNode): string[] => {
  const paths: string[] = [];
  if (node.identity.strategy === "canonical-path")
    paths.push(node.identity.path);
  for (const observation of node.observations) {
    const rawApplicationFile =
      node.kind === "electron-renderer" &&
      isRawApplicationFileObservation(observation);
    if (typeof observation.properties.path === "string")
      paths.push(observation.properties.path);
    const applicationPath = ownedApplicationPath(observation);
    if (applicationPath !== undefined) paths.push(applicationPath);
    if (rawApplicationFile) continue;
    if (typeof observation.properties.resolved_path === "string")
      paths.push(observation.properties.resolved_path);
    const declaration = observation.properties.declared_path;
    if (
      !hasOwnedArtifactPath(node) &&
      typeof declaration === "string" &&
      !declaration.includes("\\")
    )
      paths.push(declaration);
    if (
      observation.evidence.location.available &&
      observation.evidence.location.value.kind === "artifact-path"
    )
      paths.push(observation.evidence.location.value.path);
  }
  return paths
    .map(relativeLogicalPath)
    .filter(
      (path): path is string => path !== null && path !== "artifact-root",
    );
};

// Raw filesystem expressions have host syntax only when a captured file location
// establishes that format. Genuinely owned artifact facts take precedence.
const hasOwnedArtifactPath = (node: ApplicationNode): boolean =>
  node.identity.strategy === "canonical-path" ||
  node.observations.some(
    ({ properties }) => typeof properties.path === "string",
  ) ||
  node.observations.some(
    (observation) =>
      ownedApplicationPath(observation) !== undefined ||
      (!isRawApplicationFileObservation(observation) &&
        typeof observation.properties.resolved_path === "string"),
  );

// Ownership of the application base survives missing target bytes. A confined
// candidate is a path identity, not proof that a static file exists.
const ownedApplicationPath = (
  observation: ApplicationNode["observations"][number],
): string | undefined => {
  const properties = observation.properties;
  if (properties.runtime_path_base !== "application-root") return undefined;
  if (
    properties.resolution_status === "resolved" &&
    typeof properties.resolved_path === "string"
  )
    return properties.resolved_path;
  if (
    properties.runtime_path_base_proven === true &&
    (properties.resolution_status === "not-found" ||
      properties.resolution_status === "unavailable") &&
    typeof properties.candidate_path === "string"
  )
    return properties.candidate_path;
  return undefined;
};

// Native declaration matching is needed only without an owned logical path.
const isRawApplicationFileObservation = (
  observation: ApplicationNode["observations"][number],
): boolean =>
  observation.properties.runtime_path_base === "application-root"
    ? ownedApplicationPath(observation) === undefined
    : // Compatibility for captures reconstructed before the producer retained its base.
      observation.properties.resolution_context === "filesystem-expression" &&
      typeof observation.properties.mechanism === "string" &&
      observation.properties.mechanism.startsWith("call:") &&
      observation.properties.mechanism.endsWith("loadFile");

const usesApplicationFileDeclaration = (node: ApplicationNode): boolean =>
  node.kind === "electron-renderer" &&
  !hasOwnedArtifactPath(node) &&
  node.observations.some(isRawApplicationFileObservation);

const nativeDeclarationPaths = (
  node: ApplicationNode,
): StaticRuntimeCandidate["nativeDeclarationPaths"] => {
  if (hasOwnedArtifactPath(node)) return { posix: [], windows: [] };
  const declarations = node.observations.flatMap((observation) => {
    const { properties } = observation;
    return properties.resolution_context === "filesystem-expression" &&
      typeof properties.declared_path === "string" &&
      (isRawApplicationFileObservation(observation) ||
        properties.declared_path.includes("\\"))
      ? [
          {
            path: properties.declared_path,
            sourcePath: nativeDeclarationSource(observation),
          },
        ]
      : [];
  });
  const normalized = (windows: boolean) => {
    const values = declarations.flatMap(({ path, sourcePath }) => {
      if (windows && (win32.isAbsolute(path) || /^[a-z]:/iu.test(path)))
        return [];
      const normalizedPath = relativeLogicalPath(
        windows ? path.replaceAll("\\", "/") : path,
      );
      return normalizedPath === null
        ? []
        : [{ path: normalizedPath, sourcePath }];
    });
    return [
      ...new Map(
        values.map((value) => [JSON.stringify(value), value]),
      ).values(),
    ].sort(
      (left, right) =>
        compareUnicodeCodePoints(left.path, right.path) ||
        compareUnicodeCodePoints(left.sourcePath ?? "", right.sourcePath ?? ""),
    );
  };
  return { posix: normalized(false), windows: normalized(true) };
};

// A source anchor constrains the selected application namespace; it does not
// supply a module-relative base for the raw filesystem declaration.
const nativeDeclarationSource = (
  observation: ApplicationNode["observations"][number],
): string | null => {
  const location = observation.evidence.location;
  if (!location.available) return null;
  const source =
    location.value.kind === "source-range"
      ? location.value.source
      : location.value.kind === "artifact-path"
        ? location.value.path
        : null;
  return source === null || source === "artifact-root"
    ? null
    : relativeLogicalPath(source);
};

const candidateDigests = (
  node: ApplicationNode,
): StaticRuntimeCandidate["digests"] => {
  const values: StaticRuntimeCandidate["digests"][number][] = [];
  if (
    node.kind === "javascript-asset" &&
    node.identity.strategy === "content-digest"
  )
    values.push({
      sha256: node.identity.sha256,
      basis: "content-sha256",
    });
  if (node.kind === "javascript-module")
    for (const observation of node.observations) {
      const digest = observation.properties.source_sha256;
      if (typeof digest === "string" && /^[a-f0-9]{64}$/u.test(digest))
        values.push({ sha256: digest, basis: "module-source-sha256" });
    }
  return [
    ...new Map(
      values.map((value) => [`${value.basis}:${value.sha256}`, value]),
    ).values(),
  ];
};

const pathBelowRoot = (root: string, value: string): string | null => {
  const rootStyle = absoluteFilePathStyle(root);
  if (rootStyle === null || rootStyle !== absoluteFilePathStyle(value))
    return null;
  const remainder =
    rootStyle === "windows"
      ? win32.relative(root, value)
      : posix.relative(root, value);
  const portableRemainder =
    rootStyle === "windows" ? remainder.replaceAll("\\", "/") : remainder;
  if (
    remainder === "" ||
    (rootStyle === "windows" && win32.isAbsolute(remainder)) ||
    portableRemainder === ".." ||
    portableRemainder.startsWith("../")
  )
    return null;
  return relativeLogicalPath(portableRemainder);
};

const absoluteFilePathStyle = (path: string): "posix" | "windows" | null => {
  if (
    /^[a-z]:[\\/]/iu.test(path) ||
    /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u.test(path)
  )
    return "windows";
  return path.startsWith("/") ? "posix" : null;
};

/**
 * How a runtime location relates to one mapping: outside it, beneath it with
 * an artifact-relative suffix, or beneath it without any artifact path.
 */
type RuntimeLocationTranslation =
  | { readonly kind: "outside" }
  | { readonly kind: "untranslatable" }
  | { readonly kind: "translated"; readonly suffix: string };

const OUTSIDE_MAPPING: RuntimeLocationTranslation = { kind: "outside" };

const translateRuntimeLocation = (
  mapping: ParsedStaticLayer["runtimeMappings"][number],
  location: RuntimeReconciliationEntity["location"],
): RuntimeLocationTranslation => {
  if (mapping.kind === "url-prefix")
    return location.kind === "url"
      ? pathBelowUrlPrefix(mapping.prefix, location.value)
      : OUTSIDE_MAPPING;
  const suffix =
    location.kind === "file"
      ? pathBelowRoot(mapping.root, location.value)
      : null;
  return suffix === null ? OUTSIDE_MAPPING : { kind: "translated", suffix };
};

const pathBelowUrlPrefix = (
  prefix: string,
  value: string,
): RuntimeLocationTranslation => {
  const base = URL.parse(prefix);
  const candidate = URL.parse(value);
  if (
    base === null ||
    candidate === null ||
    base.origin !== candidate.origin ||
    !candidate.pathname.startsWith(base.pathname)
  )
    return OUTSIDE_MAPPING;
  const encoded = candidate.pathname.slice(base.pathname.length);
  // The prefix itself names the mapped directory or a page, not a file below it.
  if (encoded === "") return OUTSIDE_MAPPING;
  const decoded = decodeUrlPathSegments(encoded);
  const suffix = decoded === null ? null : relativeLogicalPath(decoded);
  return suffix === null
    ? { kind: "untranslatable" }
    : { kind: "translated", suffix };
};

/**
 * Decode each URL path segment separately. An encoded slash is a byte inside
 * one segment, never an artifact directory boundary, so a segment containing
 * one after decoding has no artifact path. An encoded backslash stays a literal
 * name byte, and malformed or non-UTF-8 escapes have no artifact path.
 */
const decodeUrlPathSegments = (value: string): string | null => {
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch (cause: unknown) {
      // Malformed escapes are represented by the null return.
      void cause;
      return null;
    }
    if (decoded.includes("/")) return null;
    segments.push(decoded);
  }
  return segments.join("/");
};

const exercisedArtifactPrefixes = (
  layer: ParsedStaticLayer,
  entities: readonly RuntimeReconciliationEntity[],
): Pick<
  StaticRuntimeScope,
  "artifactPrefixes" | "untranslatedArtifactPrefixes"
> => {
  const prefixes = new Set<string>();
  const untranslated = new Set<string>();
  if (
    layer.result.format === "directory" &&
    entities.some(
      ({ location }) =>
        location.kind === "file" &&
        pathBelowRoot(layer.result.input_path, location.value) !== null,
    )
  )
    prefixes.add("");
  for (const mapping of layer.runtimeMappings) {
    const prefix = normalizeArtifactPrefix(mapping.artifact_prefix);
    for (const entity of entities) {
      if (prefixes.has(prefix) && untranslated.has(prefix)) break;
      const translation = translateRuntimeLocation(mapping, entity.location);
      if (translation.kind === "translated") prefixes.add(prefix);
      // Only scripts and workers can correspond to load-state nodes.
      else if (
        translation.kind === "untranslatable" &&
        (entity.kind === "script" || entity.kind === "worker")
      )
        untranslated.add(prefix);
    }
  }
  return {
    artifactPrefixes: [...prefixes].sort(compareUnicodeCodePoints),
    untranslatedArtifactPrefixes: [...untranslated].sort(
      compareUnicodeCodePoints,
    ),
  };
};

const normalizeArtifactPrefix = (prefix: string): string =>
  prefix === "" ? "" : normalizeJoinedLogicalPath(prefix);

const pathWithinPrefix = (path: string, prefix: string): boolean =>
  prefix === "" || path === prefix || path.startsWith(`${prefix}/`);

const safeArtifactPath = (prefix: string, suffix: string): string | null =>
  relativeLogicalPath(prefix === "" ? suffix : posix.join(prefix, suffix));

const relativeLogicalPath = (value: string): string | null => {
  // These are artifact names or already parsed runtime paths, not declarations.
  const normalized = normalizeJoinedLogicalPath(value);
  return normalized !== "" &&
    normalized !== "." &&
    !logicalPathEscapesRoot(normalized)
    ? normalized
    : null;
};

const uniqueMappedPaths = (
  values: readonly MappedRuntimePath[],
): MappedRuntimePath[] =>
  [
    ...new Map(
      values.map((value) => [
        JSON.stringify([
          value.basis,
          value.path,
          value.fileStyle,
          value.nativeRelativePath,
          value.artifactPrefix,
        ]),
        value,
      ]),
    ).values(),
  ].sort(
    (left, right) =>
      compareUnicodeCodePoints(left.path, right.path) ||
      compareUnicodeCodePoints(left.basis, right.basis) ||
      compareUnicodeCodePoints(
        left.nativeRelativePath ?? "",
        right.nativeRelativePath ?? "",
      ) ||
      compareUnicodeCodePoints(left.artifactPrefix, right.artifactPrefix),
  );

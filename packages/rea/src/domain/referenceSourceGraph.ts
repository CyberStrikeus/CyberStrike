import { posix } from "node:path";

import { z } from "zod";

import { canonicalJson } from "./comparisonSemantics.js";
import { digestCanonicalValue } from "./canonicalDigest.js";
import {
  createReferenceSourcePathLookup,
  isPortableAbsoluteReferenceTarget,
} from "./referenceSourcePathIdentity.js";
import { compareUnicodeCodePoints } from "./unicodeCodePointOrder.js";
import { digestSchema, prefixedDigestSchema } from "./../domain/digests.js";
const boundedTextSchema = z.string().min(1);
const relativePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\0") &&
      path
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."),
    "Expected a normalized relative POSIX path without traversal",
  );

const classificationSchema = z.enum([
  "source",
  "test",
  "config",
  "manifest",
  "generated",
  "vendor",
  "documentation",
  "unknown",
]);

const entryBaseShape = {
  path: relativePathSchema,
  classifications: z.array(classificationSchema).min(1),
  limitations: z.array(boundedTextSchema),
  // Host presentation is retained evidence, separate from relocatable semantics.
  local_diagnostics: z.array(boundedTextSchema).exactOptional(),
};

const sourceFileBaseShape = {
  ...entryBaseShape,
  kind: z.literal("file"),
  language: z.string().min(1).nullable(),
};

const sourceFileSchema = z.union([
  z.strictObject({
    ...sourceFileBaseShape,
    sha256: digestSchema,
    size: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    content_state: z.literal("hashed"),
  }),
  z.strictObject({
    ...sourceFileBaseShape,
    sha256: z.null(),
    size: z.int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
    content_state: z.enum([
      "redacted-secret",
      "excluded",
      "unreadable",
      "unknown",
    ]),
  }),
]);

const sourceDirectorySchema = z.strictObject({
  ...entryBaseShape,
  kind: z.literal("directory"),
  tree_state: z.enum([
    "enumerated",
    "partial",
    "excluded",
    "unreadable",
    "unknown",
  ]),
});

const symlinkTargetSchema = z
  .string()
  .min(1)
  .refine(
    (target) =>
      !target.includes("\0") &&
      (isPortableAbsoluteReferenceTarget(target) ||
        (!target.startsWith("/") && posix.normalize(target) === target)),
    "Expected a normalized POSIX symlink target",
  );

const sourceSymlinkSchema = z.union([
  z.strictObject({
    ...entryBaseShape,
    kind: z.literal("symlink"),
    target: symlinkTargetSchema,
    target_state: z.enum(["internal", "external", "missing"]),
  }),
  z.strictObject({
    ...entryBaseShape,
    kind: z.literal("symlink"),
    target: z.null(),
    target_state: z.enum(["unreadable", "unknown"]),
  }),
]);

const sourceEntrySchema = z.union([
  sourceFileSchema,
  sourceDirectorySchema,
  sourceSymlinkSchema,
  z.strictObject({
    ...entryBaseShape,
    kind: z.literal("unknown"),
  }),
]);

const sourceRelationshipSchema = z.strictObject({
  from_path: relativePathSchema,
  to: z.string().min(1),
  source_specifier: z.string().min(1).exactOptional(),
  kind: z.enum(["imports", "requires", "references", "declares-module"]),
  resolution: z.enum(["internal", "external", "unresolved", "unknown"]),
  parse_state: z.enum(["parsed", "partial", "unknown"]),
});

const parseFailureSchema = z.strictObject({
  path: relativePathSchema,
  parser: z.string().min(1),
  reason: boundedTextSchema,
});

const exclusionSchema = z.discriminatedUnion("reason", [
  z.strictObject({
    path: relativePathSchema,
    entry_kind: z
      .enum(["file", "directory", "symlink", "other", "unknown"])
      .exactOptional(),
    reason: z.enum([
      "configured-secret",
      "project-ignored",
      "default-ignored",
      "caller-excluded",
    ]),
    pattern: boundedTextSchema,
  }),
  z.strictObject({
    path: relativePathSchema,
    entry_kind: z
      .enum(["file", "directory", "symlink", "other", "unknown"])
      .exactOptional(),
    reason: z.enum(["symlink-escape", "unreadable"]),
  }),
]);

const vcsSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("git"),
      head: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
      dirty: z.boolean().nullable(),
    }),
    z.strictObject({
      kind: z.literal("none"),
      head: z.null(),
      dirty: z.null(),
    }),
    z.strictObject({
      kind: z.literal("unknown"),
      head: z.null(),
      dirty: z.null(),
    }),
  ])
  .nullable();

const graphShape = {
  schema: z.literal("HistoricalSourceGraph"),
  authority: z.literal("historical-reference"),
  root_alias: z.literal("$REFERENCE_ROOT"),
  root_sha256: digestSchema,
  inventory_state: z.enum(["complete", "partial", "unknown"]),
  entries: z.array(sourceEntrySchema),
  relationships: z.array(sourceRelationshipSchema),
  parse_failures: z.array(parseFailureSchema),
  exclusions: z.array(exclusionSchema),
  languages: z.array(z.string().min(1)),
  manifests: z.array(relativePathSchema),
  vcs: vcsSchema,
  provenance: z.strictObject({
    importer: z.string().min(1),
    importer_version: z.string().min(1).nullable(),
    caller: z
      .string()
      .min(1)
      .regex(/^[\w .:@\x2f+\x2d]+$/u),
  }),
  limitations: z.array(boundedTextSchema),
};

const historicalSourceGraphStructureSchema = z
  .strictObject(graphShape)
  .superRefine(checkGraphInvariants);

export const historicalSourceGraphSchema =
  historicalSourceGraphStructureSchema.superRefine((graph, context) => {
    if (
      computeRootSha256(graph.entries, graph.exclusions) !== graph.root_sha256
    )
      context.addIssue({
        code: "custom",
        message: "Historical source root commitment does not match entries",
        path: ["root_sha256"],
      });
  });

const historicalSourceGraphInputSchema = z.strictObject({
  ...graphShape,
  root_sha256: z.never().optional(),
});

const historicalSourceManifestBaseSchema = z.strictObject({
  schema: z.literal("HistoricalSourceManifest"),
  authority: z.literal("historical-reference"),
  manifest_id: prefixedDigestSchema("hsm"),
  graph_sha256: digestSchema,
  root_sha256: digestSchema,
  inventory_state: z.enum(["complete", "partial", "unknown"]),
  entry_count: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  relationship_count: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export type HistoricalSourceGraph = z.infer<typeof historicalSourceGraphSchema>;
export type HistoricalSourceGraphInput = z.infer<
  typeof historicalSourceGraphInputSchema
>;
export type HistoricalSourceManifest = z.infer<
  typeof historicalSourceManifestBaseSchema
>;

/** Whether source facts prevent an inventory from being claimed complete. */
export const historicalSourceInventoryHasPartialFacts = (
  input: Pick<
    HistoricalSourceGraphInput,
    | "entries"
    | "relationships"
    | "parse_failures"
    | "exclusions"
    | "limitations"
  >,
): boolean =>
  input.limitations.length > 0 ||
  input.exclusions.length > 0 ||
  input.parse_failures.length > 0 ||
  input.entries.some(
    (entry) =>
      entry.limitations.length > 0 ||
      (entry.kind === "file" && entry.content_state !== "hashed") ||
      (entry.kind === "directory" && entry.tree_state !== "enumerated") ||
      (entry.kind === "symlink" && entry.target_state !== "internal") ||
      entry.kind === "unknown",
  ) ||
  input.relationships.some(
    ({ parse_state, resolution }) =>
      parse_state !== "parsed" ||
      resolution === "unresolved" ||
      resolution === "unknown",
  );

/** Stable identity used to sort and deduplicate source parse failures. */
export const historicalSourceParseFailureKey = (
  failure: HistoricalSourceGraphInput["parse_failures"][number],
): string => `${failure.path}\u0000${failure.parser}\u0000${failure.reason}`;

/** Stable identity used to sort and deduplicate source relationships. */
export const historicalSourceRelationshipKey = (
  relationship: HistoricalSourceGraphInput["relationships"][number],
): string =>
  `${relationship.from_path}\u0000${relationship.to}\u0000${relationship.kind}\u0000${relationship.resolution}\u0000${relationship.parse_state}${relationship.source_specifier === undefined ? "" : `\u0000${relationship.source_specifier}`}`;

const checkSortedUnique = (
  values: readonly string[],
  field: string,
  context: z.RefinementCtx,
): void => {
  for (let index = 1; index < values.length; index += 1)
    if (
      compareUnicodeCodePoints(values[index - 1] ?? "", values[index] ?? "") >=
      0
    ) {
      context.addIssue({
        code: "custom",
        message: `${field} must be sorted and unique by Unicode code point`,
        path: [field, index],
      });
      return;
    }
};

/** Derive the canonical language index from inventoried source files. */
export const historicalSourceLanguages = (
  entries: readonly z.infer<typeof sourceEntrySchema>[],
): string[] =>
  [
    ...new Set(
      entries.flatMap((entry) =>
        entry.kind === "file" && entry.language !== null
          ? [entry.language]
          : [],
      ),
    ),
  ].sort(compareUnicodeCodePoints);

/** Derive the canonical manifest path index from inventoried source files. */
export const historicalSourceManifests = (
  entries: readonly z.infer<typeof sourceEntrySchema>[],
): string[] =>
  entries
    .flatMap((entry) =>
      entry.kind === "file" && entry.classifications.includes("manifest")
        ? [entry.path]
        : [],
    )
    .sort(compareUnicodeCodePoints);

type GraphStructure = z.infer<typeof historicalSourceGraphStructureSchema>;

const checkRelationships = (
  graph: GraphStructure,
  paths: ReadonlySet<string>,
  context: z.RefinementCtx,
): void => {
  const files = new Set(
    graph.entries.flatMap((entry) =>
      entry.kind === "file" ? [entry.path] : [],
    ),
  );
  for (const [index, relationship] of graph.relationships.entries()) {
    if (!files.has(relationship.from_path))
      context.addIssue({
        code: "custom",
        message: "Relationship source must name an inventoried file",
        path: ["relationships", index, "from_path"],
      });
    if (relationship.resolution !== "internal") continue;
    const parsed = relativePathSchema.safeParse(relationship.to);
    if (!parsed.success || !paths.has(parsed.data))
      context.addIssue({
        code: "custom",
        message:
          "Internal relationship target must be normalized and inventoried",
        path: ["relationships", index, "to"],
      });
  }
};

const checkSymlinks = (
  graph: GraphStructure,
  paths: ReadonlySet<string>,
  context: z.RefinementCtx,
): void => {
  const lookupPath = createReferenceSourcePathLookup(paths);
  const excludedPaths = createReferenceSourcePathLookup(
    graph.exclusions.map(({ path }) => path),
  );
  const excludedKinds = new Map<
    string,
    Set<"file" | "directory" | "symlink" | "other" | "unknown" | undefined>
  >();
  for (const { path, entry_kind } of graph.exclusions) {
    const kinds = excludedKinds.get(path) ?? new Set();
    kinds.add(entry_kind);
    excludedKinds.set(path, kinds);
  }
  for (const [index, entry] of graph.entries.entries()) {
    if (entry.kind !== "symlink") continue;
    if (entry.target === null) continue;
    const resolved = posix.normalize(
      posix.join(posix.dirname(entry.path), entry.target),
    );
    const escapesRoot = resolved.startsWith("../") || resolved === "..";
    // The root is implicit; every other internal target needs an exact or
    // uniquely Unicode-equivalent recorded inventory identity.
    const inventoried =
      resolved === "." || lookupPath.resolve(resolved) !== undefined;
    const exactExcluded = excludedPaths.resolve(resolved);
    let excluded = exactExcluded !== undefined;
    for (
      let candidate = posix.dirname(resolved);
      candidate !== "." && candidate !== "/";
      candidate = posix.dirname(candidate)
    ) {
      const excludedAncestor = excludedPaths.resolve(candidate);
      if (excludedAncestor === undefined) continue;
      const kinds = excludedKinds.get(excludedAncestor);
      if (kinds?.size !== 1 || !kinds.has("directory")) {
        excluded = false;
        break;
      }
      excluded = true;
    }
    const ownedRelativeTarget =
      !entry.target.startsWith("/") && !escapesRoot && inventoried;
    const absolute =
      isPortableAbsoluteReferenceTarget(entry.target) &&
      !(entry.target_state === "internal" && ownedRelativeTarget);
    if (
      (entry.target_state === "external" && !absolute) ||
      (entry.target_state === "internal" && absolute)
    )
      context.addIssue({
        code: "custom",
        message: "Symlink target path does not match its target state",
        path: ["entries", index, "target"],
      });
    if (entry.target_state !== "internal") continue;
    if (escapesRoot || (!inventoried && !excluded))
      context.addIssue({
        code: "custom",
        message:
          "Internal symlink target must resolve to an inventoried entry or a recorded exclusion",
        path: ["entries", index, "target"],
      });
  }
};

const checkCompleteInventory = (
  graph: GraphStructure,
  context: z.RefinementCtx,
): void => {
  if (
    graph.inventory_state !== "complete" ||
    !historicalSourceInventoryHasPartialFacts(graph)
  )
    return;
  context.addIssue({
    code: "custom",
    message:
      "Complete inventory cannot contain partial states, exclusions, failures, or limitations",
    path: ["inventory_state"],
  });
};

function checkGraphInvariants(
  graph: GraphStructure,
  context: z.RefinementCtx,
): void {
  checkSortedUnique(
    graph.entries.map(({ path }) => path),
    "entries",
    context,
  );
  for (const [index, entry] of graph.entries.entries())
    checkSortedUnique(
      entry.classifications,
      `entries.${index}.classifications`,
      context,
    );
  checkSortedUnique(graph.languages, "languages", context);
  checkSortedUnique(graph.manifests, "manifests", context);
  checkSortedUnique(
    graph.relationships.map(historicalSourceRelationshipKey),
    "relationships",
    context,
  );
  checkSortedUnique(
    graph.parse_failures.map(historicalSourceParseFailureKey),
    "parse_failures",
    context,
  );
  checkSortedUnique(
    graph.exclusions.map(
      (exclusion) =>
        `${exclusion.path}\u0000${exclusion.reason}\u0000${"pattern" in exclusion ? exclusion.pattern : ""}`,
    ),
    "exclusions",
    context,
  );

  if (
    canonicalJson(graph.languages, "Reference source graph") !==
    canonicalJson(
      historicalSourceLanguages(graph.entries),
      "Reference source graph",
    )
  )
    context.addIssue({
      code: "custom",
      message: "languages must be derived from file entries",
      path: ["languages"],
    });
  if (
    canonicalJson(graph.manifests, "Reference source graph") !==
    canonicalJson(
      historicalSourceManifests(graph.entries),
      "Reference source graph",
    )
  )
    context.addIssue({
      code: "custom",
      message: "manifests must be derived from classified file entries",
      path: ["manifests"],
    });

  const paths = new Set(graph.entries.map(({ path }) => path));
  checkRelationships(graph, paths, context);
  checkSymlinks(graph, paths, context);
  checkCompleteInventory(graph, context);
}

const rootCommitment = (
  entries: readonly z.infer<typeof sourceEntrySchema>[],
  exclusions: readonly z.infer<typeof exclusionSchema>[],
): unknown => ({
  entries: entries.map((entry) => {
    switch (entry.kind) {
      case "file":
        return {
          kind: entry.kind,
          path: entry.path,
          sha256: entry.sha256,
          size: entry.size,
          content_state: entry.content_state,
        };
      case "directory":
        return {
          kind: entry.kind,
          path: entry.path,
          tree_state: entry.tree_state,
        };
      case "symlink":
        return {
          kind: entry.kind,
          path: entry.path,
          target: entry.target,
          target_state: entry.target_state,
        };
      case "unknown":
        return {
          kind: entry.kind,
          path: entry.path,
        };
    }
  }),
  exclusions,
});

const computeRootSha256 = (
  entries: readonly z.infer<typeof sourceEntrySchema>[],
  exclusions: readonly z.infer<typeof exclusionSchema>[],
): string =>
  digestCanonicalValue(
    rootCommitment(entries, exclusions),
    "Reference source graph",
  );

/** Build and internally commit a normalized historical source graph. */
export const createHistoricalSourceGraph = (
  input: unknown,
): HistoricalSourceGraph => {
  const parsed = historicalSourceGraphInputSchema.parse(input);
  return historicalSourceGraphSchema.parse({
    ...parsed,
    root_sha256: computeRootSha256(parsed.entries, parsed.exclusions),
  });
};

/** Parse a graph and reject stale or caller-invented root commitments. */
export const parseHistoricalSourceGraph = (
  input: unknown,
): HistoricalSourceGraph => historicalSourceGraphSchema.parse(input);

/** Commit semantic graph facts while retaining host-local diagnostic metadata separately. */
const computeHistoricalSourceGraphSha256 = (
  graph: HistoricalSourceGraph,
): string =>
  digestCanonicalValue(
    {
      ...graph,
      entries: graph.entries.map(
        ({ local_diagnostics: _local, ...entry }) => entry,
      ),
    },
    "Reference source graph",
  );

/** Build a deterministic, relocation-independent manifest for a source graph. */
export const createHistoricalSourceManifest = (
  input: unknown,
): HistoricalSourceManifest => {
  const graph = parseHistoricalSourceGraph(input);
  const semantic = {
    schema: "HistoricalSourceManifest" as const,
    authority: "historical-reference" as const,
    graph_sha256: computeHistoricalSourceGraphSha256(graph),
    root_sha256: graph.root_sha256,
    inventory_state: graph.inventory_state,
    entry_count: graph.entries.length,
    relationship_count: graph.relationships.length,
  };
  return historicalSourceManifestBaseSchema.parse({
    ...semantic,
    manifest_id: `hsm_${digestCanonicalValue(semantic, "Reference source graph")}`,
  });
};

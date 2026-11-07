import {
  createHistoricalSourceManifest,
  type HistoricalSourceGraph,
} from "./referenceSourceGraph.js";

type Entry = HistoricalSourceGraph["entries"][number];

const outlineEntry = (entry: Entry) => {
  if (entry.kind !== "file") return entry;
  return {
    path: entry.path,
    kind: entry.kind,
    language: entry.language,
    size: entry.size,
    content_state: entry.content_state,
    classifications: entry.classifications,
    limitations: entry.limitations,
    ...(entry.local_diagnostics === undefined
      ? {}
      : { local_diagnostics: entry.local_diagnostics }),
  };
};

/** Project one committed inventory without rereading or reinterpreting source. */
export const createHistoricalSourceSummary = (
  graph: HistoricalSourceGraph,
  outlineDepth: number,
) => {
  const manifest = createHistoricalSourceManifest(graph);
  const counts = {
    entries: graph.entries.length,
    files: 0,
    directories: 0,
    symlinks: 0,
    unknown: 0,
    relationships: graph.relationships.length,
    parse_failures: graph.parse_failures.length,
    exclusions: graph.exclusions.length,
  };
  const contentStates = {
    hashed: 0,
    "redacted-secret": 0,
    excluded: 0,
    unreadable: 0,
    unknown: 0,
  };
  const treeStates = {
    enumerated: 0,
    partial: 0,
    excluded: 0,
    unreadable: 0,
    unknown: 0,
  };
  let knownBytes = 0n;
  let unknownSizeFiles = 0;
  const outline: ReturnType<typeof outlineEntry>[] = [];
  for (const entry of graph.entries) {
    if (entry.kind === "file") {
      counts.files += 1;
      contentStates[entry.content_state] += 1;
      if (entry.size === null) unknownSizeFiles += 1;
      else knownBytes += BigInt(entry.size);
    } else if (entry.kind === "directory") {
      counts.directories += 1;
      treeStates[entry.tree_state] += 1;
    } else if (entry.kind === "symlink") counts.symlinks += 1;
    else counts.unknown += 1;
    // Canonical entries already use Unicode code-point order; filtering preserves it.
    if (entry.path.split("/").length <= outlineDepth)
      outline.push(outlineEntry(entry));
  }
  return {
    schema: "HistoricalSourceSummary" as const,
    authority: graph.authority,
    root_alias: graph.root_alias,
    manifest,
    inventory_state: graph.inventory_state,
    provenance: graph.provenance,
    vcs: graph.vcs,
    languages: graph.languages,
    manifests: graph.manifests,
    counts,
    file_content_states: contentStates,
    directory_tree_states: treeStates,
    file_sizes: {
      // Decimal text keeps large totals exact; this covers only known inventoried sizes.
      known_bytes: knownBytes.toString(),
      unknown_file_count: unknownSizeFiles,
    },
    exclusions: graph.exclusions,
    limitations: graph.limitations,
    outline: {
      depth: outlineDepth,
      entries: outline,
      omitted_entry_count: graph.entries.length - outline.length,
    },
  };
};

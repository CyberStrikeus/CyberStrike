import { describe, expect, it } from "vitest";

import {
  createHistoricalSourceGraph,
  createHistoricalSourceManifest,
  type HistoricalSourceGraphInput,
} from "./referenceSourceGraph.js";
import { createHistoricalSourceSummary } from "./referenceSourceSummary.js";

const input = (
  entries: HistoricalSourceGraphInput["entries"],
): HistoricalSourceGraphInput => ({
  schema: "HistoricalSourceGraph",
  authority: "historical-reference",
  root_alias: "$REFERENCE_ROOT",
  inventory_state: "unknown",
  entries,
  relationships: [],
  parse_failures: [],
  exclusions: [],
  languages: [],
  manifests: [],
  vcs: null,
  provenance: { importer: "fixture", importer_version: null, caller: "test" },
  limitations: ["Inventory coverage is unknown"],
});

describe("committed historical-source summaries", () => {
  it("preserves unknown coverage, sizes, directories and missing symlinks without mutating the graph", () => {
    const graph = createHistoricalSourceGraph(
      input([
        {
          path: "a",
          kind: "directory",
          tree_state: "unknown",
          classifications: ["unknown"],
          limitations: ["Not enumerated"],
        },
        {
          path: "b",
          kind: "file",
          sha256: null,
          size: null,
          content_state: "unreadable",
          language: null,
          classifications: ["unknown"],
          limitations: ["Not readable"],
        },
        {
          path: "c",
          kind: "symlink",
          target: "missing",
          target_state: "missing",
          classifications: ["unknown"],
          limitations: [],
        },
      ]),
    );
    const original = structuredClone(graph);
    const summary = createHistoricalSourceSummary(graph, 1);
    expect(summary).toMatchObject({
      manifest: createHistoricalSourceManifest(original),
      inventory_state: "unknown",
      vcs: null,
      provenance: original.provenance,
      file_sizes: { known_bytes: "0", unknown_file_count: 1 },
      counts: { entries: 3, files: 1, directories: 1, symlinks: 1 },
      directory_tree_states: { unknown: 1, enumerated: 0 },
      file_content_states: { unreadable: 1, hashed: 0 },
      limitations: original.limitations,
      outline: {
        entries: [
          original.entries[0],
          expect.objectContaining({ size: null, content_state: "unreadable" }),
          original.entries[2],
        ],
        omitted_entry_count: 0,
      },
    });
    expect(summary.outline.entries[1]).not.toHaveProperty("sha256");
    expect(graph).toEqual(original);
  });

  it("counts entries of unknown kind separately from symlinks", () => {
    const graph = createHistoricalSourceGraph(
      input([
        {
          path: "deep",
          kind: "unknown",
          classifications: ["unknown"],
          limitations: ["lstat: ENAMETOOLONG"],
        },
      ]),
    );
    expect(createHistoricalSourceSummary(graph, 1).counts).toMatchObject({
      entries: 1,
      files: 0,
      directories: 0,
      symlinks: 0,
      unknown: 1,
    });
  });

  it("sums known bytes losslessly beyond the JSON safe integer range", () => {
    const graph = createHistoricalSourceGraph(
      input(
        ["a", "b"].map((path) => ({
          path,
          kind: "file",
          sha256: "a".repeat(64),
          size: Number.MAX_SAFE_INTEGER,
          content_state: "hashed",
          language: null,
          classifications: ["unknown"],
          limitations: [],
        })),
      ),
    );
    expect(createHistoricalSourceSummary(graph, 0)).toMatchObject({
      file_sizes: { known_bytes: "18014398509481982", unknown_file_count: 0 },
      outline: { entries: [], omitted_entry_count: 2 },
    });
  });
});

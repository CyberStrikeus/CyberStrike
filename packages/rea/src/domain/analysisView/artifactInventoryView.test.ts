import {
  artifactIdForContent,
  occurrenceIdForLocation,
  artifactEdgeId,
  artifactGraphDigest,
  artifactManifestId,
} from "../artifactIdentity.js";
import { afterEach, expect, it, vi } from "vitest";
import { ARTIFACT_COMPARISON_EXAMPLE } from "../../contracts/artifactComparisonExample.js";
import { artifactInventoryResultSchema } from "../artifactGraph.js";
import { freezeJsonSnapshot } from "../immutableJson.js";
import {
  artifactInventoryViewRequestSchema,
  projectArtifactInventoryView,
} from "./artifactInventoryView.js";
import type { AnalysisViewParent } from "./analysisView.js";

const carrier = ARTIFACT_COMPARISON_EXAMPLE.left;
const freshInventory = () => {
  const inventory = artifactInventoryResultSchema.parse(
    carrier.normalized_result,
  );
  const root = inventory.occurrences[0]!;
  const rootNode = inventory.nodes[0]!;
  root.artifact_kind = "container";
  root.artifact_format = "zip";
  rootNode.format = "zip";
  const sha256 = "1".repeat(64);
  const child = {
    ...root,
    occurrence_id: occurrenceIdForLocation({
      rootArtifactId: rootNode.artifact_id,
      logicalPath: "child.txt",
      entryKind: "file",
    }),
    artifact_id: artifactIdForContent(sha256),
    parent_occurrence_id: root.occurrence_id,
    logical_path: "child.txt",
    artifact_kind: "resource" as const,
    artifact_format: "file" as const,
    declared_size: 2,
    limitations: [...root.limitations],
  };
  inventory.nodes.push({
    ...rootNode,
    artifact_id: child.artifact_id,
    sha256,
    format: "file",
    size: 2,
    content_state: "embedded",
    limitations: [...rootNode.limitations],
  });
  inventory.nodes.sort((left, right) =>
    left.artifact_id < right.artifact_id
      ? -1
      : left.artifact_id > right.artifact_id
        ? 1
        : 0,
  );
  inventory.occurrences.push(child);
  const edge = {
    ordinal: 0,
    parent_artifact_id: rootNode.artifact_id,
    relation: "contains" as const,
    occurrence_id: child.occurrence_id,
    producer: null,
  };
  inventory.edges.push({ ...edge, edge_id: artifactEdgeId(edge, child) });
  const graph = artifactGraphDigest({
    nodes: inventory.nodes,
    occurrences: inventory.occurrences,
    edges: inventory.edges,
    contradictions: inventory.integrity_contradictions,
  });
  inventory.manifest = {
    ...inventory.manifest,
    root_format: "zip",
    node_count: 2,
    occurrence_count: 2,
    edge_count: 1,
    graph_sha256: graph,
    manifest_id: artifactManifestId(rootNode.artifact_id, graph),
  };
  return inventory;
};
const parent = (normalizedResult: unknown): AnalysisViewParent => ({
  evidenceId: carrier.evidence_id,
  operation: "inventory_artifact",
  subject:
    carrier.subject === null
      ? null
      : { ...carrier.subject, format: "zip", architecture: null },
  normalizedResult,
  sealedResult: true,
  limitations: [],
});
const page = (source: AnalysisViewParent, view: unknown) => {
  const result = projectArtifactInventoryView(
    source,
    artifactInventoryViewRequestSchema.parse(view),
  );
  if (!result.ok) throw result.error;
  if (!("items" in result.value)) throw new Error("Expected an inventory page");
  return result.value;
};
afterEach(() => vi.restoreAllMocks());

it.each(["node_count", "occurrence_count", "edge_count"] as const)(
  "rejects inventory views whose retained members exceed %s",
  (count) => {
    const inventory = freshInventory();
    inventory.manifest[count] -= 1;
    const result = projectArtifactInventoryView(
      parent(inventory),
      artifactInventoryViewRequestSchema.parse({
        kind: "inventory",
        collection: "nodes",
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        issues: [
          {
            path: ["source"],
            reason: "invalid_value",
            message: "Artifact inventory members exceed their manifest counts",
          },
        ],
      },
    });
  },
);

it("batches exact occurrence IDs in source order while retaining linkage with no selected fields", () => {
  const inventory = freshInventory();
  const selected = inventory.occurrences.slice(0, 2);
  expect(selected).toHaveLength(2);
  const result = page(parent(inventory), {
    kind: "inventory",
    collection: "occurrences",
    occurrence_ids: [...selected]
      .reverse()
      .flatMap((row) => [row.occurrence_id, row.occurrence_id]),
    fields: [],
  });
  expect(result.items).toEqual(
    selected.map((row) => ({
      occurrence_id: row.occurrence_id,
      artifact_id: row.artifact_id,
      parent_occurrence_id: row.parent_occurrence_id,
    })),
  );
  expect(result.coverage.total).toBe(2);
});

it("intersects exact IDs and paths, then pages the filtered order", () => {
  const inventory = freshInventory();
  const selected = inventory.occurrences.slice(0, 2);
  const result = page(parent(inventory), {
    kind: "inventory",
    collection: "occurrences",
    occurrence_ids: selected.map((row) => row.occurrence_id),
    logical_paths: selected.map((row) => row.logical_path),
    fields: ["logical_path"],
    offset: 1,
    limit: 1,
  });
  expect(result.items).toEqual([
    expect.objectContaining({
      occurrence_id: selected[1]?.occurrence_id,
      logical_path: selected[1]?.logical_path,
    }),
  ]);
  expect(result.coverage).toMatchObject({
    total: 2,
    examined: 1,
    next_offset: null,
  });
  expect(
    page(parent(inventory), {
      kind: "inventory",
      collection: "occurrences",
      occurrence_ids: [selected[0]!.occurrence_id],
      logical_paths: [selected[1]!.logical_path],
    }).items,
  ).toEqual([]);
});

it.each([{ occurrence_ids: [] }, { logical_paths: [] }])(
  "keeps an explicitly empty occurrence selection empty",
  (filter) => {
    expect(
      page(parent(freshInventory()), {
        kind: "inventory",
        collection: "occurrences",
        ...filter,
      }).items,
    ).toEqual([]);
  },
);

it("fetches only selected content identities and fields, in canonical node order", () => {
  const inventory = freshInventory();
  const selected = inventory.nodes.slice(0, 2);
  const result = page(parent(inventory), {
    kind: "inventory",
    collection: "nodes",
    artifact_ids: [...selected].reverse().map((row) => row.artifact_id),
    fields: ["sha256", "size"],
  });
  expect(result.items).toEqual(
    selected.map((row) => ({
      artifact_id: row.artifact_id,
      sha256: row.sha256,
      size: row.size,
    })),
  );
  expect(
    page(parent(inventory), {
      kind: "inventory",
      collection: "nodes",
      artifact_ids: [selected[0]!.artifact_id],
      fields: [],
    }).items,
  ).toEqual([{ artifact_id: selected[0]!.artifact_id }]);
  expect(
    page(parent(inventory), {
      kind: "inventory",
      collection: "nodes",
      artifact_ids: [],
    }).items,
  ).toEqual([]);
});

it("does not fabricate a selected field absent from the owning report", () => {
  const inventory = freshInventory();
  expect(
    page(parent(inventory), {
      kind: "inventory",
      collection: "occurrences",
      fields: ["format_metadata"],
      limit: 1,
    }).items,
  ).toEqual([
    {
      occurrence_id: inventory.occurrences[0]!.occurrence_id,
      artifact_id: inventory.occurrences[0]!.artifact_id,
      parent_occurrence_id: inventory.occurrences[0]!.parent_occurrence_id,
    },
  ]);
  expect(() =>
    artifactInventoryViewRequestSchema.parse({
      kind: "inventory",
      collection: "nodes",
      fields: ["logical_path"],
    }),
  ).toThrow();
});

it("borrows authenticated immutable facts and validates once across retained queries", () => {
  const inventory = freezeJsonSnapshot(freshInventory());
  const source = parent(inventory);
  const parse = vi.spyOn(artifactInventoryResultSchema, "parse");
  const first = page(source, {
    kind: "inventory",
    collection: "occurrences",
    limit: 1,
  });
  expect(first.items[0]).toBe(inventory.occurrences[0]);
  expect(parse).toHaveBeenCalledOnce();
  page(source, {
    kind: "inventory",
    collection: "nodes",
    artifact_ids: [inventory.nodes[0]!.artifact_id],
  });
  expect(parse).toHaveBeenCalledOnce();
});

it("does not reuse validation for a mutable object carrying a forged sealing flag", () => {
  const inventory = freshInventory();
  const source = parent(inventory);
  page(source, { kind: "inventory", collection: "nodes", fields: [] });
  inventory.manifest.graph_sha256 = "0".repeat(64);
  expect(() =>
    page(source, { kind: "inventory", collection: "nodes", fields: [] }),
  ).toThrow();
});

it("keeps a missing match unknown when retained inventory pages are partial", () => {
  const inventory = freshInventory();
  inventory.occurrences = inventory.occurrences.slice(0, 1);
  const result = page(parent(inventory), {
    kind: "inventory",
    collection: "occurrences",
    logical_paths: ["not-recorded"],
  });
  expect(result.source_complete).toBe(false);
  expect(result.items).toEqual([]);
  expect(result.unknowns.join(" ")).toContain(
    "Missing matches do not establish absence",
  );
});

it("binds reused facts to the current Evidence ID and validates its subject on every projection", () => {
  const inventory = freezeJsonSnapshot(freshInventory());
  const first = parent(inventory);
  page(first, { kind: "inventory", collection: "nodes", fields: [] });
  const next = { ...first, evidenceId: `ev_${"f".repeat(64)}` };
  expect(
    page(next, { kind: "inventory", collection: "nodes", fields: [] })
      .inventory_evidence_ids,
  ).toEqual([next.evidenceId]);
  const subject = next.subject;
  if (subject === null || subject === undefined)
    throw new Error("Expected a subject");
  expect(() =>
    page(
      {
        ...next,
        subject: { ...subject, digest: { sha256: "f".repeat(64) } },
      },
      { kind: "inventory", collection: "nodes" },
    ),
  ).toThrow();
  expect(() =>
    page(
      { ...next, operation: "inspect_artifact" },
      { kind: "inventory", collection: "nodes" },
    ),
  ).toThrow();
});

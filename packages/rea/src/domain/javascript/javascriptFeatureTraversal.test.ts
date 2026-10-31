import { describe, expect, it } from "vitest";

import {
  createJavaScriptApplicationEdge,
  createJavaScriptApplicationGraph,
} from "./javascriptApplicationGraph.js";
import {
  artifactEvidence,
  completeCoverage,
  fixtureNode,
} from "./javascriptApplicationGraph.fixture.js";
import type {
  ApplicationEdge,
  ApplicationNode,
} from "./javascriptApplicationGraphSchemas.js";
import { traceApplicationFeature } from "./javascriptFeatureTrace.js";
import { traverseApplicationFeature } from "./javascriptFeatureTraversal.js";

const SHA = "a".repeat(64);

const node = (kind: ApplicationNode["kind"], path: string): ApplicationNode =>
  fixtureNode(
    kind,
    {
      strategy: "canonical-path",
      stability: "artifact-version",
      artifact_sha256: SHA,
      path,
    },
    path,
    {},
    artifactEvidence(SHA, path),
  );

const edge = (
  source: ApplicationNode,
  target: ApplicationNode,
  relation: ApplicationEdge["relation"],
): ApplicationEdge =>
  createJavaScriptApplicationEdge({
    source_node_id: source.node_id,
    target_node_id: target.node_id,
    relation,
    properties: {},
    evidence: artifactEvidence(SHA, source.observations[0]?.label ?? "x"),
  });

// One artifact holds two unrelated assets. Each module persists to its own
// storage key; the second module also calls an endpoint.
const root = node("artifact", "root");
const firstAsset = node("javascript-asset", "first.js");
const secondAsset = node("javascript-asset", "second.js");
const firstModule = node("javascript-module", "first.js#module");
const secondModule = node("javascript-module", "second.js#module");
const firstKey = node("storage", "first-key");
const secondKey = node("storage", "second-key");
const endpoint = node("endpoint", "rpc-second");
const graph = createJavaScriptApplicationGraph({
  schema: "JavaScriptApplicationGraph",
  root_node_ids: [root.node_id],
  nodes: [
    root,
    firstAsset,
    secondAsset,
    firstModule,
    secondModule,
    firstKey,
    secondKey,
    endpoint,
  ],
  edges: [
    edge(root, firstAsset, "contains"),
    edge(root, secondAsset, "contains"),
    edge(firstAsset, firstModule, "exposes"),
    edge(secondAsset, secondModule, "exposes"),
    edge(firstModule, firstKey, "persists_to"),
    edge(secondModule, secondKey, "persists_to"),
    edge(secondModule, endpoint, "calls"),
  ],
  coverage: completeCoverage,
  limitations: [],
});

const ids = (nodes: readonly ApplicationNode[]): string[] =>
  nodes.map(({ node_id: id }) => id).sort();

describe("traverseApplicationFeature", () => {
  it("does not enter a shared container's other children for both", () => {
    const both = traverseApplicationFeature(graph, [firstKey.node_id], "both");
    const incoming = traverseApplicationFeature(
      graph,
      [firstKey.node_id],
      "incoming",
    );
    const outgoing = traverseApplicationFeature(
      graph,
      [firstKey.node_id],
      "outgoing",
    );

    expect(ids(both.nodes)).toEqual(
      [...new Set([...ids(incoming.nodes), ...ids(outgoing.nodes)])].sort(),
    );
    expect(ids(both.nodes)).toEqual(
      ids([root, firstAsset, firstModule, firstKey]),
    );
    expect(ids(both.nodes)).not.toContain(secondKey.node_id);
    expect(ids(both.nodes)).not.toContain(endpoint.node_id);
  });

  it("keeps the shared container out of a sibling's trace paths", () => {
    const trace = traceApplicationFeature({
      sourceEvidenceId: `ev_${"b".repeat(64)}`,
      graph,
      nativeEvidence: [],
      seed: {
        kind: "string",
        value: "first-key",
        match: "exact",
        case_sensitive: true,
      },
      direction: "both",
    });

    expect(trace.summary.traced_nodes).toBe(4);
    expect(trace.paths.map(({ end_node_id: id }) => id)).toEqual([]);
  });

  it("follows a feature across relationships that point at it from both sides", () => {
    // An IPC feature: the preload asset invokes the channel that the handler
    // handles, and the main module loads the preload and requires a helper.
    // Reaching the modules needs both edge directions; the shared root must
    // not lead into the unrelated asset.
    const preloadAsset = node("javascript-asset", "preload.js");
    const preloadModule = node("javascript-module", "preload.js#module");
    const mainAsset = node("javascript-asset", "main.js");
    const mainModule = node("javascript-module", "main.js#module");
    const helperModule = node("javascript-module", "csv.js#module");
    const channel = node("ipc-channel", "notes-export");
    const handler = node("ipc-handler", "notes-export-handler");
    const unrelatedAsset = node("javascript-asset", "unrelated.js");
    const unrelatedModule = node("javascript-module", "unrelated.js#module");
    const ipcGraph = createJavaScriptApplicationGraph({
      schema: "JavaScriptApplicationGraph",
      root_node_ids: [root.node_id],
      nodes: [
        root,
        preloadAsset,
        preloadModule,
        mainAsset,
        mainModule,
        helperModule,
        channel,
        handler,
        unrelatedAsset,
        unrelatedModule,
      ],
      edges: [
        edge(root, preloadAsset, "contains"),
        edge(root, mainAsset, "contains"),
        edge(root, unrelatedAsset, "contains"),
        edge(preloadAsset, preloadModule, "contains"),
        edge(preloadAsset, channel, "invokes"),
        edge(handler, channel, "handles"),
        edge(mainAsset, handler, "contains"),
        edge(mainAsset, mainModule, "contains"),
        edge(mainModule, preloadAsset, "loads"),
        edge(mainModule, helperModule, "imports"),
        edge(unrelatedAsset, unrelatedModule, "contains"),
      ],
      coverage: completeCoverage,
      limitations: [],
    });

    const traversal = traverseApplicationFeature(
      ipcGraph,
      [channel.node_id],
      "both",
    );

    expect(ids(traversal.nodes)).toEqual(
      ids([
        channel,
        preloadAsset,
        preloadModule,
        handler,
        mainAsset,
        mainModule,
        helperModule,
        root,
      ]),
    );
  });

  it("returns complete one-direction paths to terminals on both sides", () => {
    // caller -> seed -> outgoing storage; incoming storage -> caller.
    const seed = node("javascript-module", "seed.js#module");
    const caller = node("javascript-module", "caller.js#module");
    const outgoingKey = node("storage", "outgoing-key");
    const incomingKey = node("storage", "incoming-key");
    const persists = edge(seed, outgoingKey, "persists_to");
    const imports = edge(caller, seed, "imports");
    const calls = edge(incomingKey, caller, "calls");
    const trace = traceApplicationFeature({
      sourceEvidenceId: `ev_${"b".repeat(64)}`,
      graph: createJavaScriptApplicationGraph({
        schema: "JavaScriptApplicationGraph",
        root_node_ids: [caller.node_id],
        nodes: [seed, caller, outgoingKey, incomingKey],
        edges: [persists, imports, calls],
        coverage: completeCoverage,
        limitations: [],
      }),
      nativeEvidence: [],
      seed: {
        kind: "node-id",
        value: seed.node_id,
        match: "exact",
        case_sensitive: true,
      },
      direction: "both",
    });

    expect(
      trace.paths
        .map(({ end_node_id, node_ids, edge_ids }) => ({
          end_node_id,
          node_ids,
          edge_ids,
        }))
        .sort((left, right) => left.node_ids.length - right.node_ids.length),
    ).toEqual([
      {
        end_node_id: outgoingKey.node_id,
        node_ids: [seed.node_id, outgoingKey.node_id],
        edge_ids: [persists.edge_id],
      },
      {
        end_node_id: incomingKey.node_id,
        node_ids: [seed.node_id, caller.node_id, incomingKey.node_id],
        edge_ids: [imports.edge_id, calls.edge_id],
      },
    ]);
  });
});

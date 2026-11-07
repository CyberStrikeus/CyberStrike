import { describe, expect, it } from "vitest";

import {
  APPLICATION_GRAPH_DIGESTS,
  artifactEvidence,
  fixtureNode,
} from "./javascriptApplicationGraph.fixture.js";
import { findApplicationFeatureSeeds } from "./javascriptFeatureSeed.js";

const channelNode = (channel: string) =>
  fixtureNode(
    "ipc-channel",
    {
      strategy: "artifact-local-key",
      stability: "artifact-version",
      artifact_sha256: APPLICATION_GRAPH_DIGESTS.asar,
      namespace: "electron-ipc",
      key: channel,
    },
    channel,
    { channel },
    artifactEvidence(
      APPLICATION_GRAPH_DIGESTS.asar,
      "dist/preload.js",
      "ast-static-analysis",
    ),
  );

const nodes = [channelNode("ff"), channelNode("ﬀ")] as const;

const matchedNodeIds = (
  value: string,
  match: "exact" | "contains",
  caseSensitive: boolean,
) =>
  findApplicationFeatureSeeds(nodes, {
    kind: "channel",
    value,
    match,
    case_sensitive: caseSensitive,
  }).map(({ node_id }) => node_id);

describe("application feature seed Unicode matching", () => {
  it("keeps compatibility-distinct channels separate for exact case-sensitive seeds", () => {
    expect(matchedNodeIds("ff", "exact", true)).toEqual([nodes[0].node_id]);
    expect(matchedNodeIds("ﬀ", "exact", true)).toEqual([nodes[1].node_id]);
  });

  it("does not compatibility-fold case-sensitive substring seeds", () => {
    expect(matchedNodeIds("f", "contains", true)).toEqual([nodes[0].node_id]);
  });

  it("retains compatibility folding for explicit case-insensitive matching", () => {
    expect(matchedNodeIds("FF", "exact", false)).toEqual(
      nodes.map(({ node_id }) => node_id).sort(),
    );
  });
});

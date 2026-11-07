import { describe, expect, it } from "vitest";

import { buildSyntheticJavaScriptApplicationGraph } from "./javascriptApplicationGraph.fixture.js";
import type { JsonValue } from "../jsonValue.js";
import { findApplicationFeatureSeeds } from "./javascriptFeatureSeed.js";

describe("application feature seed property matching", () => {
  it("finds strings after the former property count ceiling", () => {
    const node = graphNodeWithProperties({
      values: Array.from({ length: 513 }, (_, index) => `value-${index}`),
    });

    expect(
      findApplicationFeatureSeeds([node], {
        kind: "string",
        value: "value-512",
        match: "exact",
        case_sensitive: true,
      }),
    ).toEqual([
      {
        node_id: node.node_id,
        kind: node.kind,
        basis: "property",
        field: "observations[0].properties.values[512]",
      },
    ]);
  });

  it("finds strings deeper than the former traversal cutoff", () => {
    const node = graphNodeWithProperties({
      one: {
        two: { three: { four: { five: { six: { seven: "deep-value" } } } } },
      },
    });

    expect(
      findApplicationFeatureSeeds([node], {
        kind: "string",
        value: "deep-value",
        match: "exact",
        case_sensitive: true,
      }),
    ).toEqual([
      {
        node_id: node.node_id,
        kind: node.kind,
        basis: "property",
        field: "observations[0].properties.one.two.three.four.five.six.seven",
      },
    ]);
  });
});

const graphNodeWithProperties = (
  properties: Readonly<Record<string, JsonValue>>,
) => {
  const template = buildSyntheticJavaScriptApplicationGraph().nodes[0];
  if (template === undefined) throw new Error("Expected fixture graph node");
  return {
    ...template,
    observations: template.observations.map((observation) => ({
      ...observation,
      properties,
    })),
  };
};

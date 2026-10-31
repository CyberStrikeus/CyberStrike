import { expect, it } from "vitest";
import {
  artifactEvidence,
  completeCoverage,
  fixtureNode,
} from "./javascriptApplicationGraph.fixture.js";
import {
  createJavaScriptApplicationGraph,
  createJavaScriptApplicationEdge,
  type JavaScriptApplicationGraph,
} from "./javascriptApplicationGraph.js";
import { compareJavaScriptApplicationVersions } from "./javascriptApplicationVersionComparison.js";

const graph = (
  sha: string,
  peers: "ambiguous" | "unique" | "unmatched",
  options: {
    relation?: "imports" | "invokes";
    target?: "peer-one" | "peer-two";
    direction?: "in" | "out";
    content?: string;
    partial?: true;
  } = {},
) => {
  const evidence = artifactEvidence(sha, "main.js");
  const nodes = ["main", "peer-one", "peer-two"].map((key) =>
    fixtureNode(
      "javascript-module",
      {
        strategy: "artifact-local-key",
        stability: "artifact-version",
        artifact_sha256: sha,
        namespace: "module",
        key,
      },
      key === "main" ? "main" : "peer",
      {
        source_sha256:
          key === "main"
            ? (options.content ?? "d".repeat(64))
            : peers === "ambiguous"
              ? "c".repeat(64)
              : peers === "unique"
                ? (key === "peer-one" ? "e" : "f").repeat(64)
                : (key === "peer-one" ? "1" : "2").repeat(64),
        ...(key === "main"
          ? {
              structural_fingerprint_sha256: "9".repeat(64),
              structural_fingerprint_algorithm: "fixture",
            }
          : {}),
      },
      evidence,
    ),
  );
  const main = nodes[0],
    target = nodes[options.target === "peer-two" ? 2 : 1];
  if (main === undefined || target === undefined)
    throw new Error("Missing fixture nodes");
  return {
    main,
    graph: createJavaScriptApplicationGraph({
      schema: "JavaScriptApplicationGraph",
      root_node_ids: [main.node_id],
      nodes,
      edges: [
        createJavaScriptApplicationEdge({
          source_node_id:
            options.direction === "in" ? target.node_id : main.node_id,
          target_node_id:
            options.direction === "in" ? main.node_id : target.node_id,
          relation: options.relation ?? "imports",
          properties: {},
          evidence,
        }),
      ],
      coverage: options.partial
        ? { ...completeCoverage, status: "partial", omitted_count: null }
        : completeCoverage,
      limitations: options.partial ? ["Controlled incomplete inventory."] : [],
    }),
  };
};
const compare = (
  left: ReturnType<typeof graph>,
  right: ReturnType<typeof graph>,
) => {
  const result = compareJavaScriptApplicationVersions({
    left: {
      evidenceId: `ev_${"1".repeat(64)}`,
      rootArtifactSha256: "a".repeat(64),
      graph: left.graph,
    },
    right: {
      evidenceId: `ev_${"2".repeat(64)}`,
      rootArtifactSha256: "b".repeat(64),
      graph: right.graph,
    },
    leftNativeEvidence: [],
    rightNativeEvidence: [],
  });
  const item = result.items.find(
    (item) => item.left_node_id === left.main.node_id,
  );
  if (item === undefined) throw new Error("Missing main comparison item");
  return { result, item };
};

it.each(["ambiguous", "unmatched"] as const)(
  "keeps %s neighbor alignment unknown despite complete inventories",
  (peers) => {
    const { result, item } = compare(
      graph("a".repeat(64), "ambiguous"),
      graph("b".repeat(64), peers),
    );
    expect(item).toMatchObject({
      status: "unknown",
      dimensions: [],
      match: {
        status: "matched",
        basis: "exact-module-source-digest",
        confidence: "exact",
      },
    });
    expect(item.limitations.join(" ")).toMatch(
      /relationship.*identity.*unresolved/iu,
    );
    expect(item.limitations.join(" ")).not.toContain(
      "Incomplete graph coverage",
    );
    expect(result.coverage.status).toBe("complete-within-inputs");
    expect(
      result.graph.edges.filter((edge) => edge.relation === "changed_from"),
    ).toEqual([]);
    expect(result.graph.nodes).toHaveLength(6);
    if (peers === "ambiguous") {
      expect(result.summary).toEqual({
        unchanged: 0,
        added: 0,
        removed: 0,
        changed: 0,
        unknown: 5,
      });
      expect(
        result.items.filter((i) => i.match.status === "ambiguous"),
      ).toHaveLength(4);
    }
  },
);

it("keeps equal relationships to uniquely paired peers unchanged", () => {
  const { item } = compare(
    graph("a".repeat(64), "unique"),
    graph("b".repeat(64), "unique"),
  );
  expect(item).toMatchObject({ status: "unchanged", dimensions: [] });
  expect(item.limitations).toEqual([]);
});

it.each([{ relation: "invokes" as const }, { direction: "in" as const }])(
  "retains positive relation/direction differences beside unknown peer identity %j",
  (options) => {
    const { item } = compare(
      graph("a".repeat(64), "ambiguous"),
      graph("b".repeat(64), "ambiguous", options),
    );
    expect(item).toMatchObject({
      status: "changed",
      dimensions: ["relationships"],
    });
    expect(item.limitations.join(" ")).toMatch(
      /relationship.*identity.*unresolved/iu,
    );
  },
);

it("reports a resolved target change", () => {
  const { item } = compare(
    graph("a".repeat(64), "unique"),
    graph("b".repeat(64), "unique", { target: "peer-two" }),
  );
  expect(item).toMatchObject({
    status: "changed",
    dimensions: ["relationships"],
  });
});

it("preserves definite content change alongside unresolved relationships", () => {
  const { item } = compare(
    graph("a".repeat(64), "ambiguous"),
    graph("b".repeat(64), "ambiguous", { content: "8".repeat(64) }),
  );
  expect(item).toMatchObject({
    status: "changed",
    dimensions: ["content", "properties"],
    match: { basis: "structural-fingerprint" },
  });
  expect(item.limitations.join(" ")).toMatch(
    /relationship.*identity.*unresolved/iu,
  );
});

it.each(["imports", "invokes"] as const)(
  "keeps partial inventory and neighbor identity uncertainty distinct (%s)",
  (relation) => {
    const { result, item } = compare(
      graph("a".repeat(64), "ambiguous"),
      graph("b".repeat(64), "ambiguous", { partial: true, relation }),
    );
    expect(item).toMatchObject({
      status: "unknown",
      dimensions:
        relation === "imports" ? ["coverage"] : ["relationships", "coverage"],
    });
    const changes = result.graph.edges.filter(
      (edge) => edge.relation === "changed_from",
    );
    expect(changes).toHaveLength(relation === "imports" ? 0 : 1);
    if (relation === "invokes")
      expect(changes[0]).toMatchObject({
        properties: { status: "unknown" },
        evidence: { coverage: { status: "partial" } },
      });
    expect(item.limitations.join(" ")).toContain("Incomplete graph coverage");
    expect(item.limitations.join(" ")).toMatch(
      /relationship.*identity.*unresolved/iu,
    );
  },
);

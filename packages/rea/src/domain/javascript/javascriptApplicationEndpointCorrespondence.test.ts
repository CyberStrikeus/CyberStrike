import { expect, it } from "vitest";

import {
  artifactEvidence,
  completeCoverage,
  fixtureNode,
} from "./javascriptApplicationGraph.fixture.js";
import { createJavaScriptApplicationGraph } from "./javascriptApplicationGraph.js";
import { compareJavaScriptApplicationVersions } from "./javascriptApplicationVersionComparison.js";
import type { ApplicationNode } from "./javascriptApplicationGraphSchemas.js";

const endpoint = (options: {
  readonly sha: string;
  readonly path?: string;
  readonly line?: number;
  readonly partial?: boolean;
  readonly kind?: string;
  readonly method?: string;
  readonly candidate?: boolean;
  readonly value?: string;
  readonly resolution?: null | "unresolved";
  readonly state?: "unknown" | "unavailable";
}): ApplicationNode => {
  const path = options.path ?? "main.js";
  const line = options.line ?? 1;
  return fixtureNode(
    "endpoint",
    {
      strategy: "artifact-local-key",
      stability: "artifact-version",
      artifact_sha256: options.sha,
      namespace: options.kind ?? "fetch",
      key: JSON.stringify([path, line, options.partial, options.candidate]),
    },
    "API_BASE",
    {
      endpoint_kind: options.kind ?? "fetch",
      value: options.value ?? "API_BASE",
      ...(options.partial ? { resolution: "partial" } : {}),
      ...(options.resolution === undefined
        ? {}
        : { resolution: options.resolution }),
      ...(options.candidate ? { interpretation: "candidate" } : {}),
      ...(options.method === undefined ? {} : { method: options.method }),
    },
    {
      ...artifactEvidence(options.sha, path, "ast-static-analysis"),
      ...(options.state === undefined
        ? {}
        : {
            state: options.state,
            authority: "unknown",
            confidence: "unknown",
            coverage: {
              status: "unknown",
              truncated: false,
              omitted_count: null,
              limits: [],
            },
            limitations: ["Endpoint target was not established."],
          }),
      location: {
        available: true,
        value: {
          kind: "source-range",
          source: path,
          start: { line, column: 0 },
          end: { line, column: 15 },
        },
      },
    },
  );
};

const compare = (left: ApplicationNode, right: ApplicationNode) => {
  const graph = (node: ApplicationNode) =>
    createJavaScriptApplicationGraph({
      schema: "JavaScriptApplicationGraph",
      root_node_ids: [node.node_id],
      nodes: [node],
      edges: [],
      coverage: completeCoverage,
      limitations: [],
    });
  return compareJavaScriptApplicationVersions({
    left: {
      evidenceId: `ev_${"1".repeat(64)}`,
      rootArtifactSha256: "a".repeat(64),
      graph: graph(left),
    },
    right: {
      evidenceId: `ev_${"2".repeat(64)}`,
      rootArtifactSha256: "b".repeat(64),
      graph: graph(right),
    },
    leftNativeEvidence: [],
    rightNativeEvidence: [],
  });
};

it.each(["moved-partial", "exact", "candidate"] as const)(
  "does not select endpoint correspondence from equal display text for %s",
  (control) => {
    const result = compare(
      endpoint({ sha: "a".repeat(64), partial: true }),
      endpoint({
        sha: "b".repeat(64),
        path: control === "moved-partial" ? "other.js" : "main.js",
        partial: control === "moved-partial",
        candidate: control === "candidate",
      }),
    );
    expect(result.items).toHaveLength(2);
    expect(
      result.items.every(
        ({ status, match }) =>
          status === "unknown" && match.status === "unmatched",
      ),
    ).toBe(true);
  },
);

it("aligns equal partial source sites while keeping target identity unknown across binding context changes", () => {
  // Different source digests can hide changed bindings even when this call site stays fixed.
  const result = compare(
    endpoint({ sha: "a".repeat(64), partial: true }),
    endpoint({ sha: "b".repeat(64), partial: true }),
  );
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    status: "unknown",
    match: { status: "matched", basis: "semantic-key" },
    limitations: expect.arrayContaining([
      expect.stringContaining("target identity remains unresolved"),
    ]),
  });
});

it.each([false, true])(
  "preserves known metadata changes on an established endpoint pair (partial=%s)",
  (partial) => {
    const result = compare(
      endpoint({ sha: "a".repeat(64), partial, method: "GET" }),
      endpoint({ sha: "b".repeat(64), partial, method: "POST" }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      status: "changed",
      dimensions: ["properties"],
      match: { status: "matched", basis: "semantic-key" },
    });
  },
);

it("keeps exact endpoint target matching portable across source relocation", () => {
  const result = compare(
    endpoint({ sha: "a".repeat(64) }),
    endpoint({ sha: "b".repeat(64), path: "moved.js", line: 4 }),
  );
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    status: "unchanged",
    dimensions: ["location"],
    match: { status: "matched", basis: "semantic-key" },
  });
});

it("keeps unrelated unresolved endpoint kinds from hiding exact target absence", () => {
  const result = compare(
    endpoint({ sha: "a".repeat(64) }),
    endpoint({ sha: "b".repeat(64), kind: "route", partial: true }),
  );
  expect(
    result.items.find(({ left_node_id }) => left_node_id !== null),
  ).toMatchObject({ status: "removed", match: { status: "unmatched" } });
  expect(
    result.items.find(({ right_node_id }) => right_node_id !== null),
  ).toMatchObject({ status: "unknown", match: { status: "unmatched" } });
});

it.each([null, "unresolved"] as const)(
  "preserves explicit unknown endpoint resolution %s",
  (resolution) => {
    const result = compare(
      endpoint({ sha: "a".repeat(64) }),
      endpoint({ sha: "b".repeat(64), resolution }),
    );
    expect(result.items).toHaveLength(2);
    expect(
      result.items.every(
        ({ status, match }) =>
          status === "unknown" && match.status === "unmatched",
      ),
    ).toBe(true);
  },
);

it.each(["unknown", "unavailable"] as const)(
  "keeps %s endpoint Evidence from proving another target absent",
  (state) => {
    const result = compare(
      endpoint({ sha: "a".repeat(64), value: "known" }),
      endpoint({ sha: "b".repeat(64), value: "unestablished", state }),
    );
    expect(result.items).toHaveLength(2);
    expect(
      result.items.every(
        ({ status, match }) =>
          status === "unknown" && match.status === "unmatched",
      ),
    ).toBe(true);
  },
);

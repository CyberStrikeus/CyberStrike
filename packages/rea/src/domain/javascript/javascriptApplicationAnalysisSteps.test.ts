import { describe, expect, it } from "vitest";
import { z } from "zod";

import { JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE } from "../../contracts/javascript/javascriptRuntimeReconciliationExample.js";
import { freezeJsonSnapshot } from "../immutableJson.js";
import {
  javascriptApplicationAnalysisResultSchema,
  parseOwnedJavaScriptApplicationAnalysisSteps,
} from "./javascriptApplicationAnalysis.js";
import {
  createJavaScriptApplicationGraph,
  createImmutableJavaScriptApplicationGraphSteps,
  isValidatedImmutableJavaScriptApplicationGraph,
  sealTransferredJavaScriptApplicationGraphSteps,
} from "./javascriptApplicationGraph.js";
import {
  createJavaScriptSemanticGraph,
  createImmutableJavaScriptSemanticGraphSteps,
  isValidatedImmutableJavaScriptSemanticGraph,
  sealTransferredJavaScriptSemanticGraphSteps,
} from "./javascriptSemanticGraph.js";

const complete = <Value>(steps: Iterator<void, Value>): Value => {
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
};

const example = () =>
  javascriptApplicationAnalysisResultSchema.parse(
    JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE.normalized_result,
  );

const ownedExample = () => {
  const result = example();
  const { graph_id: _applicationId, ...application } = result.graph;
  const { graph_id: _semanticId, ...semantic } = result.semantic_graph;
  return {
    ...result,
    graph: complete(
      createImmutableJavaScriptApplicationGraphSteps(application),
    ),
    semantic_graph: complete(
      createImmutableJavaScriptSemanticGraphSteps(semantic),
    ),
  };
};

const issuesFrom = (action: () => unknown) => {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof z.ZodError) return error.issues;
    throw error;
  }
  throw new Error("Expected complete result validation to reject the input");
};

describe("immutable JavaScript result reuse", () => {
  it("preserves parser copies shared across owned graphs and result metadata", () => {
    const owned = ownedExample();
    const input = freezeJsonSnapshot({
      ...owned,
      limitations: owned.graph.limitations,
    });
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const parsed = complete(
        parseOwnedJavaScriptApplicationAnalysisSteps(input),
      );
      expect(parsed).not.toBe(input);
      expect(parsed.graph).toBe(input.graph);
      expect(parsed.limitations).toEqual(input.graph.limitations);
      expect(parsed.limitations).not.toBe(parsed.graph.limitations);
    }
  });

  it.each(["hidden-extra", "changed-enumerability"])(
    "preserves parsed results when the source has %s normalization",
    (kind) => {
      const input = example();
      if (kind === "hidden-extra")
        Object.defineProperty(input, "not_in_parsed_result", {
          value: { unvalidated: true },
          enumerable: false,
        });
      else Object.defineProperty(input, "input_path", { enumerable: false });
      freezeJsonSnapshot(input);
      const expected = javascriptApplicationAnalysisResultSchema.parse(input);
      for (let repeat = 0; repeat < 2; repeat += 1) {
        const parsed = complete(
          parseOwnedJavaScriptApplicationAnalysisSteps(input),
        );
        expect(parsed).not.toBe(input);
        expect(Object.hasOwn(parsed, "not_in_parsed_result")).toBe(false);
        expect(
          Object.getOwnPropertyDescriptor(parsed, "input_path")?.enumerable,
        ).toBe(
          Object.getOwnPropertyDescriptor(expected, "input_path")?.enumerable,
        );
      }
    },
  );

  it("borrows imported immutable results only after complete format validation", () => {
    const input = example();
    delete input.statistics.skipped_javascript_files;
    freezeJsonSnapshot(input);
    const result = complete(
      parseOwnedJavaScriptApplicationAnalysisSteps(input),
    );
    expect(result).toBe(input);
    expect(result).toEqual(
      javascriptApplicationAnalysisResultSchema.parse(input),
    );
    expect(result.statistics).not.toHaveProperty("skipped_javascript_files");
    expect(complete(parseOwnedJavaScriptApplicationAnalysisSteps(input))).toBe(
      input,
    );
    expect(Reflect.set(input.statistics, "findings", -1)).toBe(false);
  });

  it("preserves a normalized representation instead of borrowing changed input", () => {
    const input = example();
    Object.setPrototypeOf(input, null);
    freezeJsonSnapshot(input);
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const result = complete(
        parseOwnedJavaScriptApplicationAnalysisSteps(input),
      );
      expect(result).not.toBe(input);
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(result).toEqual(
        javascriptApplicationAnalysisResultSchema.parse(input),
      );
    }
  });

  it.each(["mutable", "shallow-frozen"])(
    "rechecks changed %s metadata despite authenticated nested graphs",
    (kind) => {
      const input = ownedExample();
      if (kind === "shallow-frozen") Object.freeze(input);
      expect(
        complete(parseOwnedJavaScriptApplicationAnalysisSteps(input)),
      ).not.toBe(input);
      input.statistics.findings = -1;
      expect(() =>
        complete(parseOwnedJavaScriptApplicationAnalysisSteps(input)),
      ).toThrow(z.ZodError);
    },
  );
});

describe("owned JavaScript graph validation", () => {
  it("reuses exact sealed graphs and preserves all public result fields", () => {
    const input = ownedExample();
    const result = complete(
      parseOwnedJavaScriptApplicationAnalysisSteps(input),
    );
    expect(result).toEqual(
      javascriptApplicationAnalysisResultSchema.parse(input),
    );
    expect(result.graph).toBe(input.graph);
    expect(result.semantic_graph).toBe(input.semantic_graph);
    expect(result.summary).not.toBe(input.summary);
    expect(result.statistics).not.toBe(input.statistics);
    expect(Object.isFrozen(result.graph.nodes[0]?.observations)).toBe(true);
    expect(Object.isFrozen(result.semantic_graph.nodes[0]?.properties)).toBe(
      true,
    );
    expect(isValidatedImmutableJavaScriptApplicationGraph(result.graph)).toBe(
      true,
    );
    expect(
      isValidatedImmutableJavaScriptSemanticGraph(result.semantic_graph),
    ).toBe(true);
    expect(
      isValidatedImmutableJavaScriptApplicationGraph(result.graph.nodes),
    ).toBe(false);
  });

  it("keeps ordinary constructors mutable and clones inputs before sealing", () => {
    const input = example();
    const { graph_id: _applicationId, ...application } = input.graph;
    const { graph_id: _semanticId, ...semantic } = input.semantic_graph;
    const ordinaryApplication = createJavaScriptApplicationGraph(application);
    const ordinarySemantic = createJavaScriptSemanticGraph(semantic);
    expect(Object.isFrozen(ordinaryApplication)).toBe(false);
    expect(Object.isFrozen(ordinarySemantic)).toBe(false);
    const applicationSteps =
      createImmutableJavaScriptApplicationGraphSteps(application);
    const semanticSteps = createImmutableJavaScriptSemanticGraphSteps(semantic);
    application.limitations.push("Changed after factory input was cloned.");
    semantic.limitations.push("Changed after factory input was cloned.");
    expect(complete(applicationSteps)).toEqual(ordinaryApplication);
    expect(complete(semanticSteps)).toEqual(ordinarySemantic);
    expect(
      isValidatedImmutableJavaScriptApplicationGraph(ordinaryApplication),
    ).toBe(false);
    expect(isValidatedImmutableJavaScriptSemanticGraph(ordinarySemantic)).toBe(
      false,
    );
  });

  it.each(["mutable", "shallow-frozen", "json-sealed"])(
    "fully validates %s imported graphs instead of trusting their IDs",
    (representation) => {
      const input = example();
      input.graph.graph_id = `jag_${"f".repeat(64)}`;
      if (representation === "shallow-frozen") Object.freeze(input.graph);
      if (representation === "json-sealed") freezeJsonSnapshot(input.graph);
      expect(isValidatedImmutableJavaScriptApplicationGraph(input.graph)).toBe(
        false,
      );
      const issues = issuesFrom(() =>
        complete(parseOwnedJavaScriptApplicationAnalysisSteps(input)),
      );
      expect(issues).toEqual(
        issuesFrom(() =>
          javascriptApplicationAnalysisResultSchema.parse(input),
        ),
      );
      expect(
        issues.some(({ path }) => path.join("/") === "graph/graph_id"),
      ).toBe(true);
    },
  );

  it("fully parses valid imported graphs without conferring an owned proof", () => {
    const input = example();
    const parsed = complete(
      parseOwnedJavaScriptApplicationAnalysisSteps(input),
    );
    expect(parsed).toEqual(input);
    expect(parsed.graph).not.toBe(input.graph);
    expect(parsed.semantic_graph).not.toBe(input.semantic_graph);
    expect(
      isValidatedImmutableJavaScriptSemanticGraph(parsed.semantic_graph),
    ).toBe(false);
  });

  it("rejects a forged semantic graph paired with an authenticated application graph", () => {
    const input = ownedExample();
    input.semantic_graph = freezeJsonSnapshot({
      ...input.semantic_graph,
      graph_id: `jsrg_${"f".repeat(64)}`,
    });
    expect(
      isValidatedImmutableJavaScriptSemanticGraph(input.semantic_graph),
    ).toBe(false);
    expect(
      issuesFrom(() =>
        complete(parseOwnedJavaScriptApplicationAnalysisSteps(input)),
      ),
    ).toEqual(
      issuesFrom(() => javascriptApplicationAnalysisResultSchema.parse(input)),
    );
  });

  it("does not authenticate an abandoned sealing operation", () => {
    const input = example();
    const { graph_id: _semanticId, ...semantic } = input.semantic_graph;
    const originalNode = semantic.nodes[0];
    if (originalNode === undefined) throw new Error("Expected a semantic node");
    semantic.nodes[0] = {
      ...originalNode,
      properties: {
        rows: Array.from({ length: 10_000 }, (_, value) => ({ value })),
      },
    };
    const mutable = createJavaScriptSemanticGraph(semantic);
    const { graph_id: _mutableId, ...mutableInput } = mutable;
    const steps = createImmutableJavaScriptSemanticGraphSteps(mutableInput);
    expect(steps.next().done).toBe(false);
    steps.return(mutable);
    expect(isValidatedImmutableJavaScriptSemanticGraph(mutable)).toBe(false);
    const sealed = complete(
      createImmutableJavaScriptSemanticGraphSteps(mutableInput),
    );
    expect(sealed).toEqual(mutable);
    expect(isValidatedImmutableJavaScriptSemanticGraph(sealed)).toBe(true);
  });
});

describe("owned JavaScript result bindings", () => {
  it.each(["application", "root", "node"])(
    "retains the %s binding check for individually authenticated graphs",
    (binding) => {
      const input = ownedExample();
      if (binding === "root") input.root_artifact_sha256 = "e".repeat(64);
      else {
        const { graph_id: _semanticId, ...semantic } = input.semantic_graph;
        if (binding === "application")
          semantic.application_graph_id = `jag_${"e".repeat(64)}`;
        else {
          const node = semantic.nodes[0];
          if (node === undefined) throw new Error("Expected a semantic node");
          semantic.nodes = [
            { ...node, application_node_ids: [`jag_node_${"e".repeat(64)}`] },
            ...semantic.nodes.slice(1),
          ];
        }
        input.semantic_graph = complete(
          createImmutableJavaScriptSemanticGraphSteps(semantic),
        );
      }
      expect(
        issuesFrom(() =>
          complete(parseOwnedJavaScriptApplicationAnalysisSteps(input)),
        ),
      ).toEqual(
        issuesFrom(() =>
          javascriptApplicationAnalysisResultSchema.parse(input),
        ),
      );
    },
  );

  it("yields while checking a wide binding set and closes an abandoned iteration", () => {
    const input = ownedExample();
    const { graph_id: _semanticId, ...semantic } = input.semantic_graph;
    const node = semantic.nodes[0];
    if (node === undefined) throw new Error("Expected a semantic node");
    semantic.nodes = [
      {
        ...node,
        application_node_ids: Array.from(
          { length: 10_000 },
          (_, index) => `jag_node_${index.toString(16).padStart(64, "0")}`,
        ),
      },
      ...semantic.nodes.slice(1),
    ];
    input.semantic_graph = complete(
      createImmutableJavaScriptSemanticGraphSteps(semantic),
    );
    freezeJsonSnapshot(input);
    const steps = parseOwnedJavaScriptApplicationAnalysisSteps(input);
    expect(steps.next().done).toBe(false);
    steps.return(input);
    expect(steps.next().done).toBe(true);
    expect(
      issuesFrom(() =>
        complete(parseOwnedJavaScriptApplicationAnalysisSteps(input)),
      ),
    ).toEqual(
      issuesFrom(() => javascriptApplicationAnalysisResultSchema.parse(input)),
    );
  });

  it("retains strict metadata validation alongside authenticated graphs", () => {
    const input = {
      ...ownedExample(),
      statistics: { ...example().statistics, findings: -1 },
      extra: true,
    };
    expect(
      issuesFrom(() =>
        complete(parseOwnedJavaScriptApplicationAnalysisSteps(input)),
      ),
    ).toEqual(
      issuesFrom(() => javascriptApplicationAnalysisResultSchema.parse(input)),
    );
  });
});

describe("graphs transferred to their sealing steps", () => {
  it("seal the same validated graphs as the copying factories", () => {
    const input = example();
    const { graph_id: _applicationId, ...application } = input.graph;
    const { graph_id: _semanticId, ...semantic } = input.semantic_graph;
    const expectedApplication = createJavaScriptApplicationGraph(application);
    const expectedSemantic = createJavaScriptSemanticGraph(semantic);
    const sealedApplication = complete(
      sealTransferredJavaScriptApplicationGraphSteps(
        structuredClone(application),
      ),
    );
    const sealedSemantic = complete(
      sealTransferredJavaScriptSemanticGraphSteps(structuredClone(semantic)),
    );
    expect(sealedApplication).toEqual(expectedApplication);
    expect(sealedSemantic).toEqual(expectedSemantic);
    expect(
      isValidatedImmutableJavaScriptApplicationGraph(sealedApplication),
    ).toBe(true);
    expect(isValidatedImmutableJavaScriptSemanticGraph(sealedSemantic)).toBe(
      true,
    );
  });

  it("report the issues a whole-graph parse reports", () => {
    const input = example();
    const { graph_id: _applicationId, ...application } = input.graph;
    const { graph_id: _semanticId, ...semantic } = input.semantic_graph;
    const node = semantic.nodes[0];
    const applicationNode = application.nodes[0];
    if (node === undefined || applicationNode === undefined)
      throw new Error("Expected semantic and application nodes");
    const malformed = {
      ...semantic,
      nodes: [{ ...node, label: 7 }, ...semantic.nodes.slice(1)],
    };
    expect(
      issuesFrom(() =>
        complete(sealTransferredJavaScriptSemanticGraphSteps(malformed)),
      ),
    ).toEqual(issuesFrom(() => createJavaScriptSemanticGraph(malformed)));
    const stale = {
      ...application,
      nodes: [
        { ...applicationNode, node_id: `jag_node_${"f".repeat(64)}` },
        ...application.nodes.slice(1),
      ],
    };
    expect(
      issuesFrom(() =>
        complete(sealTransferredJavaScriptApplicationGraphSteps(stale)),
      ),
    ).toEqual(issuesFrom(() => createJavaScriptApplicationGraph(stale)));
  });
});

describe("skipped_javascript_files backward compatibility", () => {
  it("preserves omission for saved evidence that predates the skipped counter", () => {
    const legacy = structuredClone(
      JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE.normalized_result,
    ) as Record<string, unknown>;
    const statistics = legacy.statistics as Record<string, unknown>;
    delete statistics.skipped_javascript_files;
    const result = javascriptApplicationAnalysisResultSchema.parse(legacy);
    // A pre-change result can contain the very resource-skipped files this
    // field reports, but it has no counter: unknown must not become a
    // measured zero that comparisons would treat as "nothing skipped".
    expect("skipped_javascript_files" in result.statistics).toBe(false);
    expect(result.statistics.skipped_javascript_files).toBeUndefined();
  });

  it("keeps the producer-written skipped count in current evidence", () => {
    const current = structuredClone(
      JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE.normalized_result,
    ) as Record<string, unknown>;
    const statistics = current.statistics as Record<string, unknown>;
    statistics.skipped_javascript_files = 3;
    const result = javascriptApplicationAnalysisResultSchema.parse(current);
    expect(result.statistics.skipped_javascript_files).toBe(3);
  });
});

describe("Electron boundary summary compatibility", () => {
  it("reads results produced before protocol registrations were counted", () => {
    const current = example();
    const { protocol_registrations: _count, ...summary } = current.summary;
    const parsed = javascriptApplicationAnalysisResultSchema.parse({
      ...current,
      summary,
    });
    expect(parsed.summary).not.toHaveProperty("protocol_registrations");
  });
});

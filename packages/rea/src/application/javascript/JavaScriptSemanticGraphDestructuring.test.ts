import { expect, it } from "vitest";
import { graphForJavaScript } from "../../../tests/fixtures/javascriptSemanticGraph.js";

it.each(
  [
    { pattern: "{ a: selected }", source: "{ a: 1 }", path: ["a"] },
    { pattern: "[selected]", source: "[1]", path: ["0"] },
    {
      pattern: "{ a: [selected] = [] }",
      source: "{ a: [1] }",
      path: ["a", "0"],
    },
    {
      pattern: "{ a: { b: selected } = {} }",
      source: "{ a: { b: 1 } }",
      path: ["a", "b"],
    },
    { pattern: "[[selected] = []]", source: "[[1]]", path: ["0", "0"] },
  ].flatMap((pattern) =>
    [false, true].map((assignment) => ({ ...pattern, assignment })),
  ),
)(
  "retains source-property flow for $pattern, assignment=$assignment",
  ({ pattern, source, path, assignment }) => {
    const graph = graphForJavaScript(`
      const source = ${source};
      ${assignment ? `let selected; (${pattern} = source);` : `const ${pattern} = source;`}
    `);
    const target = graph.nodes.find(
      (node) => node.kind === "binding" && node.label === "selected",
    );
    expect(target).toBeDefined();
    const relations = graph.relations.filter(
      (relation) =>
        relation.relation === "destructures" &&
        relation.target_node_id === target?.node_id,
    );
    expect(relations).toHaveLength(1);
    expect(relations[0]?.resolution).toBe("resolved");
    const slot = graph.nodes.find(
      (node) => node.node_id === relations[0]?.source_node_id,
    );
    expect(slot?.properties.property_path).toEqual(path);
  },
);

it.each(["{}", "unknownSource"])(
  "keeps nested default source flow conservative for %s",
  (source) => {
    const graph = graphForJavaScript(
      `const source = ${source}; const { a: [selected] = [1] } = source;`,
    );
    const target = graph.nodes.find(
      (node) => node.kind === "binding" && node.label === "selected",
    );
    const relation = graph.relations.find(
      (item) =>
        item.relation === "destructures" &&
        item.target_node_id === target?.node_id,
    );
    expect(relation).toMatchObject({ resolution: "candidate" });
    expect(graph.unknowns).toContainEqual(
      expect.objectContaining({
        family: "object-flow",
        relation_kinds: ["destructures"],
      }),
    );
  },
);

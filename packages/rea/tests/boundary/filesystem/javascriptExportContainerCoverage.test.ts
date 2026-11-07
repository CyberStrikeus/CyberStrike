import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseApplicationGraphEvidence } from "../../../src/application/javascript/JavaScriptApplicationEvidenceGraph.js";
import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";
import { compareJavaScriptExportShapesEvidence } from "../../../src/application/javascript/JavaScriptApplicationWorkflowService.js";
import { projectedExportReturnShapesSchema } from "../../../src/domain/javascript/javascriptExportShapeComparisonSchemas.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

describe("JavaScript export container coverage through authenticated Evidence", () => {
  it.each([
    {
      name: "empty object",
      before: "",
      after: ", options: {}",
      paths: ["/options"],
      addedPaths: ["/options"],
    },
    {
      name: "empty array",
      before: "",
      after: ", options: []",
      paths: ["/options"],
      addedPaths: ["/options"],
    },
    {
      name: "nested object",
      before: ", options: {}",
      after: ", options: { nested: {} }",
      paths: ["/options/nested"],
      addedPaths: ["/options/nested"],
    },
    {
      name: "nested array",
      before: ", options: []",
      after: ", options: [[]]",
      paths: ["/options/0"],
      addedPaths: ["/options/0"],
    },
    {
      name: "container subtree",
      before: "",
      after: ", options: { nested: {} }",
      paths: ["/options", "/options/nested"],
      // Complete root coverage proves the absent ancestor and its descendants.
      addedPaths: ["/options", "/options/nested"],
    },
    {
      name: "escaped property keys",
      before: ', "a/b~c": {}',
      after: ', "a/b~c": { "d/e~f": [] }',
      paths: ["/a~1b~0c/d~1e~0f"],
      addedPaths: ["/a~1b~0c/d~1e~0f"],
    },
  ])(
    "reports $name presence independently of unresolved values in both directions",
    async ({ before, after, paths, addedPaths }) => {
      const [absent, retained] = await analyzeReturns(before, after);
      for (const path of paths) {
        expect(
          absent.shape.property_coverage.some(
            (coverage) => coverage.path === path,
          ),
        ).toBe(false);
        expect(retained.shape.property_coverage).toContainEqual({
          path,
          status: "complete",
          omitted: 0,
        });
        expect(retained.shape.fields.some((field) => field.path === path)).toBe(
          false,
        );
      }

      for (const [left, right, leftAvailability, rightAvailability, status] of [
        [absent, retained, "absent", "unknown", "added"],
        [retained, absent, "unknown", "absent", "removed"],
      ] as const) {
        const result = compareEvidence(left, right);
        expect(result.summary).toEqual({
          added: 0,
          removed: 0,
          changed: 0,
          unknown: paths.length - addedPaths.length,
          [status]: addedPaths.length,
        });
        expect(result.changes).toHaveLength(paths.length);
        expect(result.changes).toEqual(
          expect.arrayContaining(
            paths.map((path) =>
              expect.objectContaining({
                path,
                status: addedPaths.includes(path) ? status : "unknown",
                discriminant: { path: "/type", value: "item" },
                left: expect.objectContaining({
                  availability: leftAvailability,
                }),
                right: expect.objectContaining({
                  availability: rightAvailability,
                }),
                left_source_range: left.shape.source_range,
                right_source_range: right.shape.source_range,
                evidence_links: [
                  left.evidence.evidence_id,
                  right.evidence.evidence_id,
                ],
                limitations: addedPaths.includes(path)
                  ? []
                  : [
                      "The static value or relevant parent-property coverage is incomplete.",
                    ],
              }),
            ),
          ),
        );
        expect(result.coverage).toMatchObject({
          status:
            addedPaths.length === paths.length
              ? "complete-within-inputs"
              : "partial",
          paired_variants: 1,
          unpaired_left_variants: 0,
          unpaired_right_variants: 0,
          omitted_changes: 0,
        });
        expect(compareEvidence(left, right)).toEqual(result);
      }
    },
  );
});

describe("JavaScript export container coverage controls", () => {
  it.each(["{}", "[]", "{ nested: {} }", "[[]]"])(
    "keeps identical %s containers and primitive fields unchanged",
    async (container) => {
      const properties = `, options: ${container}, enabled: false`;
      const sources = await analyzeReturns(properties, properties);
      const result = compareEvidence(...sources);
      expect(result.changes).toEqual([]);
      expect(result.summary).toEqual({
        added: 0,
        removed: 0,
        changed: 0,
        unknown: 0,
      });
      expect(result.coverage.status).toBe("complete-within-inputs");
    },
  );

  it.each([
    { before: "", after: ", enabled: false", status: "added" },
    { before: ", enabled: false", after: "", status: "removed" },
    { before: ", enabled: false", after: ", enabled: true", status: "changed" },
  ])(
    "preserves primitive $status beside an unchanged container",
    async ({ before, after, status }) => {
      const sources = await analyzeReturns(
        `, options: {}${before}`,
        `, options: {}${after}`,
      );
      const result = compareEvidence(...sources);
      expect(result.changes).toEqual([
        expect.objectContaining({ path: "/enabled", status }),
      ]);
      expect(result.summary).toEqual({
        added: 0,
        removed: 0,
        changed: 0,
        unknown: 0,
        [status]: 1,
      });
      expect(result.coverage.status).toBe("complete-within-inputs");
    },
  );

  it.each(["{}", "[]", "false"])(
    "keeps a %s leaf unknown when the opposite parent has partial coverage",
    async (leaf) => {
      const [partial, complete] = await analyzeReturns(
        ", options: { ...dynamic }",
        `, options: { nested: ${leaf} }`,
      );
      expect(partial.shape.property_coverage).toContainEqual({
        path: "/options",
        status: "partial",
        omitted: null,
      });
      for (const sources of [
        [partial, complete],
        [complete, partial],
      ] as const) {
        const result = compareEvidence(...sources);
        expect(result.changes).toEqual([
          expect.objectContaining({
            path: "/options/nested",
            status: "unknown",
          }),
        ]);
        expect(result.summary).toEqual({
          added: 0,
          removed: 0,
          changed: 0,
          unknown: 1,
        });
        expect(result.coverage.status).toBe("partial");
      }
    },
  );
});

type Source = Awaited<ReturnType<typeof analyzeReturn>>;

const analyzeReturns = async (
  left: string,
  right: string,
): Promise<[Source, Source]> => {
  const root = await createTestTempDirectory("rea-export-container-coverage-");
  return Promise.all([
    analyzeReturn(join(root, "left"), left),
    analyzeReturn(join(root, "right"), right),
  ]);
};

const analyzeReturn = async (root: string, properties: string) => {
  const expression = `{ type: "item"${properties} }`;
  const prefix = "export default () => (";
  await writeFixtureFiles(root, { "parser.mjs": `${prefix}${expression});\n` });
  const analyzed = await analyzeJavaScriptApplication({ input_path: root });
  if (!analyzed.ok) throw analyzed.error;
  const parsed = parseApplicationGraphEvidence(analyzed.value);
  if (!parsed.ok) throw new Error("Analysis Evidence must parse");
  const source = parsed.value;
  const observation = source.graph.nodes
    .flatMap(({ observations }) => observations)
    .find(
      ({ properties: value }) => value.semantic_role === "export-return-shapes",
    );
  const projection = projectedExportReturnShapesSchema.parse(
    observation?.properties,
  );
  expect(projection).toMatchObject({
    module_path: "parser.mjs",
    exported_name: "default",
  });
  expect(projection.static_return_shapes).toHaveLength(1);
  const shape = projection.static_return_shapes[0];
  if (shape === undefined) throw new TypeError("Missing fixture return shape");
  expect(shape.source_range).toEqual({
    start: { line: 1, column: prefix.length },
    end: { line: 1, column: prefix.length + expression.length },
  });
  return { ...source, shape };
};

const compareEvidence = (left: Source, right: Source) => {
  const compared = compareJavaScriptExportShapesEvidence({
    left: left.evidence,
    right: right.evidence,
    left_module_path: "parser.mjs",
    left_export_name: "default",
    right_module_path: "parser.mjs",
    right_export_name: "default",
  });
  if (!compared.ok) throw compared.error;
  const evidence = compared.value.evidence;
  const result = compared.value.result;
  const evidenceLinks = [left.evidence.evidence_id, right.evidence.evidence_id];
  expect(evidence).toMatchObject({
    operation: "compare_javascript_export_shapes",
    predicate_type: "rea.javascript-export-shape-comparison",
    authority: "analyst-inference",
    confidence: "inferred",
    evidence_links: evidenceLinks,
  });
  expect(result.evidence_links).toEqual(evidenceLinks);
  for (const [selected, source] of [
    [result.left, left],
    [result.right, right],
  ] as const) {
    expect(selected).toMatchObject({
      status: "selected",
      evidence_id: source.evidence.evidence_id,
      graph_id: source.graph.graph_id,
    });
    expect(
      source.graph.nodes.some(
        ({ node_id }) => node_id === selected.selected_node_id,
      ),
    ).toBe(true);
  }
  return result;
};

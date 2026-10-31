import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";
import { parseApplicationGraphEvidence } from "../../../src/application/javascript/JavaScriptApplicationEvidenceGraph.js";
import { compareJavaScriptExportShapesEvidence } from "../../../src/application/javascript/JavaScriptApplicationWorkflowService.js";
import { compareJavaScriptExportShapes } from "../../../src/domain/javascript/javascriptExportShapeComparison.js";
import {
  javaScriptExportShapeComparisonResultSchema,
  projectedExportReturnShapesSchema,
} from "../../../src/domain/javascript/javascriptExportShapeComparisonSchemas.js";
import {
  createJavaScriptApplicationGraph,
  createJavaScriptApplicationNode,
} from "../../../src/domain/javascript/javascriptApplicationGraph.js";

const registerImplicitInvocationComparisonTests = (): void => {
  it("preserves accessor-effect uncertainty through analyzed Evidence and export comparison", async () => {
    const [left, right] = await analyzeSources({
      left: `export default function observe() {
        const box = { value: 1, get trigger() { this.value = 2; return 0; } };
        box.trigger;
        return { type: "event", value: box.value, stable: "kept" };
      }`,
      right: `export default function observe() {
        return { type: "event", value: 2, stable: "kept" };
      }`,
    });
    const execution = compareJavaScriptExportShapesEvidence({
      left: left.evidence,
      right: right.evidence,
      left_module_path: "parser.mjs",
      left_export_name: "default",
      right_module_path: "parser.mjs",
      right_export_name: "default",
    });
    if (!execution.ok) throw execution.error;
    expect(execution.value.result.changes).toEqual([
      expect.objectContaining({
        status: "unknown",
        path: "/value",
        left: expect.objectContaining({ availability: "unknown" }),
        right: { availability: "literal", value: 2 },
      }),
    ]);
    expect(execution.value.sources).toContain(left.evidence);
    expect(execution.value.result.coverage.status).toBe("partial");
    expect(inventoryProperties(execution.value.result, "left", 0)).toEqual(
      expect.arrayContaining(["/stable", "/value", "/type"]),
    );
  });

  it("preserves independent implicit invocation unknowns through retained export Evidence", async () => {
    const [left, right] = await analyzeSources({
      left: `export default function observe() {
        const getter = { value: 1, get trigger() { this.value = 2; return 0; } };
        const copy = { ...getter };
        const coercion = { [Symbol.toPrimitive]() { this.value = 2; return "key"; }, value: 1 };
        const keyed = { [coercion]: 0 };
        const disposal = { [Symbol.dispose]() { this.value = 2; }, value: 1 };
        { using owned = disposal; }
        return { type: "event", getter: getter.value, coercion: coercion.value, disposal: disposal.value, stable: "kept" };
      }`,
      right: `export default function observe() {
        return { type: "event", getter: 2, coercion: 2, disposal: 2, stable: "kept" };
      }`,
    });
    const result = compare(left, right);
    expect(result.changes).toHaveLength(3);
    expect(result.changes).toEqual(
      expect.arrayContaining(
        ["/getter", "/coercion", "/disposal"].map((path) =>
          expect.objectContaining({
            path,
            status: "unknown",
            left: expect.objectContaining({ availability: "unknown" }),
            right: { availability: "literal", value: 2 },
          }),
        ),
      ),
    );
    expect(result.coverage.status).toBe("partial");
    expect(inventoryProperties(result, "left", 0)).toContain("/stable");
  });
};

describe("JavaScript export return-shape comparison", () => {
  it("propagates proven ancestor absence to nested additions and removals", async () => {
    const [left, right] = await analyzeSources({
      left: 'export default () => ({kind:"result"});',
      right: 'export default () => ({kind:"result",nested:{total:1}});',
    });
    const forward = compare(left, right),
      reverse = compare(right, left);
    expect(forward.summary).toEqual({
      added: 2,
      removed: 0,
      changed: 0,
      unknown: 0,
    });
    expect(reverse.summary).toEqual({
      added: 0,
      removed: 2,
      changed: 0,
      unknown: 0,
    });
    expect(forward.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/nested/total",
          status: "added",
          presence: { left: "absent", right: "present" },
        }),
      ]),
    );
    expect(forward.coverage.status).toBe("complete-within-inputs");
    const [unknown, present] = await analyzeSources({
      left: 'export default () => ({kind:"result",nested:unresolved});',
      right: 'export default () => ({kind:"result",nested:{total:1}});',
    });
    expect(compare(unknown, present).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/nested/total",
          status: "unknown",
          presence: { left: "unknown-coverage", right: "present" },
        }),
      ]),
    );
  });

  it("reports exactly the heading depth addition from source-owned parser fixtures", async () => {
    const root = await temporaryRoot();
    const leftRoot = join(root, "left");
    const rightRoot = join(root, "right");
    await Promise.all([mkdir(leftRoot), mkdir(rightRoot)]);
    await Promise.all([
      copyFile(
        resolve("tests/fixtures/replay/parser.mjs"),
        join(leftRoot, "parser.mjs"),
      ),
      copyFile(
        resolve("tests/fixtures/replay/parser-v2.mjs"),
        join(rightRoot, "parser.mjs"),
      ),
    ]);
    const [left, right] = await Promise.all([
      analyzeGraph(leftRoot),
      analyzeGraph(rightRoot),
    ]);

    const first = compare(left, right);
    const second = compare(left, right);
    const execution = compareJavaScriptExportShapesEvidence({
      left: left.evidence,
      right: right.evidence,
      left_module_path: "parser.mjs",
      left_export_name: "default",
      right_module_path: "parser.mjs",
      right_export_name: "default",
    });
    if (!execution.ok) throw execution.error;
    expect(execution.value.result).toEqual(first);
    expect(execution.value.sources[0]).toBe(left.evidence);
    expect(execution.value.sources[1]).toBe(right.evidence);

    expect(first.comparison_id).toBe(second.comparison_id);
    expect(() =>
      javaScriptExportShapeComparisonResultSchema.parse(first),
    ).not.toThrow();
    expect(first.summary).toEqual({
      added: 1,
      removed: 0,
      changed: 0,
      unknown: 0,
    });
    expect(first.changes).toEqual([
      expect.objectContaining({
        status: "added",
        path: "/depth",
        discriminant: { path: "/type", value: "heading" },
        presence: { left: "absent", right: "present" },
        left: { availability: "absent" },
        right: { availability: "literal", value: 1 },
      }),
    ]);
    expect(first.changes.some(({ path }) => path === "/text")).toBe(false);
    expect(first.coverage).toMatchObject({
      status: "complete-within-inputs",
      paired_variants: 3,
      unpaired_left_variants: 0,
      unpaired_right_variants: 0,
    });
    expect(first.limitations).toContain(
      "This static comparison cannot establish runtime semantics; run behavioral probes directly against the relevant application versions when that evidence is required.",
    );
  });

  registerImplicitInvocationComparisonTests();

  it("keeps additions unknown when spread coverage is incomplete", async () => {
    const [left, right] = await analyzeSources({
      left: `
        const dynamic = getDynamic();
        export default () => ({ ...dynamic, type: "heading" });
      `,
      right: `
        const dynamic = getDynamic();
        export default () => ({ depth: 1, ...dynamic, type: "heading" });
      `,
    });
    const result = compare(left, right);

    expect(result.changes).toEqual([
      expect.objectContaining({
        status: "unknown",
        path: "/depth",
        presence: { left: "unknown-coverage", right: "present" },
      }),
    ]);
    expect(result.coverage.status).toBe("partial");
  });

  it("orders multiple changed paths deterministically across Unicode names", async () => {
    const graphs = await analyzeSources({
      left: `export default () => ({ type: "item", zeta: 1, alpha: 1, "éclair": 1 });`,
      right: `export default () => ({ type: "item", zeta: 2, alpha: 2, "éclair": 2 });`,
    });
    const first = compare(...graphs);
    const second = compare(...graphs);

    expect(new Set(first.changes.map(({ path }) => path))).toEqual(
      new Set(["/alpha", "/zeta", "/éclair"]),
    );
    expect(first.changes).toEqual(second.changes);
    expect(first.comparison_id).toBe(second.comparison_id);
  });
});

describe("JavaScript export return-shape pairing limits", () => {
  it("does not pair an inline discriminant with absent or unknown presence", async () => {
    const rows = [
      { presence: "absent", side: "left" },
      { presence: "unknown-coverage", side: "left" },
      { presence: "absent", side: "right" },
      { presence: "unknown-coverage", side: "right" },
    ] as const;
    const [left, right] = await analyzeSources({
      left: 'export default () => ({ kind: "result", count: 1 });',
      right: 'export default () => ({ kind: "result", total: 2 });',
    });

    for (const { presence, side } of rows) {
      const label = `${side} discriminant presence ${presence}`;
      const selected = side === "left" ? left : right;
      const graph = createJavaScriptApplicationGraph({
        schema: "JavaScriptApplicationGraph",
        root_node_ids: selected.graph.root_node_ids,
        edges: selected.graph.edges,
        coverage: selected.graph.coverage,
        limitations: selected.graph.limitations,
        nodes: selected.graph.nodes.map((node) =>
          createJavaScriptApplicationNode({
            kind: node.kind,
            identity: node.identity,
            observations: node.observations.map(
              ({ label, properties, evidence }) => ({
                label,
                evidence,
                properties:
                  properties.semantic_role !== "export-return-shapes"
                    ? properties
                    : {
                        ...properties,
                        static_return_shapes: projectedExportReturnShapesSchema
                          .parse(properties)
                          .static_return_shapes.map((shape) => ({
                            ...shape,
                            fields: shape.fields.map((field) =>
                              field.path === "/kind"
                                ? { ...field, presence }
                                : field,
                            ),
                          })),
                      },
              }),
            ),
          }),
        ),
      });
      const result =
        side === "left"
          ? compare({ ...left, graph }, right)
          : compare(left, { ...right, graph });
      expect(result.coverage, label).toMatchObject({
        status: "partial",
        paired_variants: 0,
        unpaired_left_variants: 1,
        unpaired_right_variants: 1,
      });
      expect(result.changes, label).toHaveLength(2);
      expect(
        result.changes.every(
          ({ status, discriminant }) =>
            status === "unknown" && discriminant === null,
        ),
        label,
      ).toBe(true);
      expect(
        result.property_inventories.map(({ side }) => side).sort(),
        label,
      ).toEqual(["left", "right"]);
      expect(
        result.property_inventories.every(
          ({ paired, discriminant }) => !paired && discriminant === null,
        ),
        label,
      ).toBe(true);
    }
  });

  it("does not pair discriminants that an unknown trailing spread can overwrite", async () => {
    const [left, right] = await analyzeSources({
      left: `
        const dynamic = getDynamic();
        export default () => ({ type: "heading", ...dynamic });
      `,
      right: `
        const dynamic = getDynamic();
        export default () => ({ type: "heading", depth: 1, ...dynamic });
      `,
    });
    const result = compare(left, right);

    expect(result.changes).toEqual([
      expect.objectContaining({
        status: "unknown",
        path: "",
        discriminant: null,
      }),
      expect.objectContaining({
        status: "unknown",
        path: "",
        discriminant: null,
      }),
    ]);
    expect(result.summary).toEqual({
      added: 0,
      removed: 0,
      changed: 0,
      unknown: 2,
    });
    expect(result.coverage).toMatchObject({
      status: "partial",
      paired_variants: 0,
      unpaired_left_variants: 1,
      unpaired_right_variants: 1,
    });
  });

  it("does not pair ambiguous variants or invent behavior for no-return exports", async () => {
    const ambiguous = await analyzeSources({
      left: `
        export default function parse(value) {
          if (value) return { type: "heading", text: render(value) };
          return { type: "heading", text: render(value) };
        }
      `,
      right: `export default (value) => ({ type: "heading", text: render(value) });`,
    });
    const compared = compare(...ambiguous);
    expect(compared.summary.unknown).toBe(3);
    expect(compared.coverage).toMatchObject({
      status: "partial",
      paired_variants: 0,
      unpaired_left_variants: 2,
      unpaired_right_variants: 1,
    });

    const noReturn = await analyzeSources({
      left: `export default function stop() { throw new Error("stop"); }`,
      right: `export default function stop() { throw new Error("stop"); }`,
    });
    const unknown = compare(...noReturn);
    expect(unknown.changes).toEqual([
      expect.objectContaining({ status: "unknown", path: "" }),
    ]);
  });
});

describe("JavaScript export return-shape uncertain presence", () => {
  it("keeps deleted property presence unknown in both comparison directions", async () => {
    const plain = 'export default () => ({ kind: "result" });';
    const mutated = `export default function make() {
      const result = { kind: "result", count: 1 };
      delete result.count;
      return result;
    }`;
    const graphs = await analyzeSources({ left: plain, right: mutated });
    for (const direction of [
      {
        name: "plain to deleted-property source",
        result: compare(...graphs),
        presence: { left: "absent", right: "unknown-coverage" },
        inventorySide: "right" as const,
      },
      {
        name: "deleted-property to plain source",
        result: compare(graphs[1], graphs[0]),
        presence: { left: "unknown-coverage", right: "absent" },
        inventorySide: "left" as const,
      },
    ]) {
      expect(
        direction.result.changes,
        `${direction.name}: /count change`,
      ).toContainEqual(
        expect.objectContaining({
          path: "/count",
          status: "unknown",
          presence: direction.presence,
        }),
      );
      expect(
        inventoryProperties(direction.result, direction.inventorySide, 0),
        `${direction.name}: uncertain count inventory`,
      ).not.toContain("/count");
      expect(
        direction.result.summary.added + direction.result.summary.removed,
        `${direction.name}: added/removed summary`,
      ).toBe(0);
      expect(
        direction.result.coverage.status,
        `${direction.name}: coverage`,
      ).toBe("partial");
    }
  });
});

describe("JavaScript export return-shape array presence", () => {
  it("excludes array holes while preserving observed unknown elements", async () => {
    const holes = 'export default () => ({ kind: "result", items: [,] });';
    const empty = await analyzeSources({
      left: holes,
      right: 'export default () => ({ kind: "result", items: [] });',
    });
    const result = compare(...empty);
    expect(result.coverage.status).toBe("complete-within-inputs");
    expect(inventoryProperties(result, "left", 0)).not.toContain("/items/0");
    expect(result.changes.some(({ path }) => path === "/items/0")).toBe(false);
    const filled = await analyzeSources({
      left: holes,
      right: 'export default () => ({ kind: "result", items: [call()] });',
    });
    expect(compare(...filled).changes).toContainEqual(
      expect.objectContaining({
        path: "/items/0",
        status: "added",
        presence: { left: "absent", right: "present" },
        left: { availability: "absent" },
        right: expect.objectContaining({ availability: "unknown" }),
      }),
    );
  });
});

describe("JavaScript export unpaired return locations", () => {
  it.each([
    {
      description: "two right return variants",
      left: "export default function f() {}",
      right: `export default function f(flag) {
        if (flag) return { count: call() };
        return { total: call() };
      }`,
      side: "right" as const,
      lines: [2, 3],
    },
    {
      description: "one right return variant",
      left: "export default function f() {}",
      right: `export default function f() {
        return { count: call() };
      }`,
      side: "right" as const,
      lines: [2],
    },
    {
      description: "two left return variants",
      left: `export default function f(flag) {
        if (flag) return { count: call() };
        return { total: call() };
      }`,
      right: "export default function f() {}",
      side: "left" as const,
      lines: [2, 3],
    },
    {
      description: "one left return variant",
      left: `export default function f() {
        return { count: call() };
      }`,
      right: "export default function f() {}",
      side: "left" as const,
      lines: [2],
    },
  ])(
    "retains each location for $description when the opposite export has no return",
    async ({ left, right, side, lines }) => {
      const graphs = await analyzeSources({ left, right });
      const result = compare(...graphs);
      expect(result.coverage).toMatchObject({
        status: "partial",
        unpaired_left_variants: side === "left" ? lines.length : 0,
        unpaired_right_variants: side === "right" ? lines.length : 0,
      });
      expect(result.changes).toHaveLength(lines.length);
      expect(
        result.changes.every(
          ({ status, left_source_range, right_source_range }) =>
            status === "unknown" &&
            (side === "left"
              ? left_source_range !== null && right_source_range === null
              : left_source_range === null && right_source_range !== null),
        ),
      ).toBe(true);
      const locations = result.changes
        .map((change) =>
          side === "left"
            ? change.left_source_range?.start.line
            : change.right_source_range?.start.line,
        )
        .sort((first, second) => (first ?? 0) - (second ?? 0));
      expect(locations).toEqual(lines);
      expect(result.summary).toMatchObject({
        added: 0,
        removed: 0,
        changed: 0,
        unknown: lines.length,
      });
    },
  );

  it("retains unpaired inventory locations when the opposite export has no return", async () => {
    const graphs = await analyzeSources({
      left: "export default function f() {}",
      right: `export default function f(flag) {
        if (flag) return { count: call() };
        return { total: call() };
      }`,
    });
    const result = compare(...graphs);
    expect(result.property_inventories).toEqual([
      expect.objectContaining({
        side: "right",
        paired: false,
        variant_index: 0,
        properties: expect.arrayContaining(["/count"]),
        source_range: expect.objectContaining({
          start: expect.objectContaining({ line: 2 }),
        }),
      }),
      expect.objectContaining({
        side: "right",
        paired: false,
        variant_index: 1,
        properties: expect.arrayContaining(["/total"]),
        source_range: expect.objectContaining({
          start: expect.objectContaining({ line: 3 }),
        }),
      }),
    ]);
    expect(() =>
      javaScriptExportShapeComparisonResultSchema.parse(result),
    ).not.toThrow();
  });
});

describe("JavaScript export matching uncertain projections", () => {
  it.each([
    ["Object.assign", "Object.assign(result, { extra: 1 });"],
    ["local helper", "mutate(result);"],
    ["alias", "const alias = result; mutate(alias);"],
    ["destructuring", "const { value } = { value: result }; mutate(value);"],
    ["shared wrapper", "mutate({ value: result });"],
    ["spread arguments", "mutate(...[result]);"],
    ["optional call", "mutate?.(result);"],
    ["constructor", "new Mutator(result);"],
    ["tagged template", "tag`${result}`;"],
  ])(
    "does not infer an addition after %s can mutate the return value",
    async (_description, invocation) => {
      const graphs = await analyzeSources({
        left: `
        function mutate(value) { (value.value ?? value).extra = 1; }
        function Mutator(value) { value.extra = 1; }
        function tag(_strings, value) { value.extra = 1; }
        export default function make() {
          const result = { kind: "record" };
          ${invocation}
          return result;
        }
      `,
        right: 'export default () => ({ kind: "record", extra: 1 });',
      });
      const result = compare(...graphs);
      expect(result.summary).toMatchObject({
        added: 0,
        removed: 0,
        changed: 0,
      });
      expect(result.coverage.status).toBe("partial");
      expect(result.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: "unknown" }),
        ]),
      );
    },
  );

  it("keeps sibling properties known when a method can mutate its receiver", async () => {
    const graphs = await analyzeSources({
      left: `export default function make() {
        const result = { kind: "record", tokens: [] };
        result.tokens.push({ extra: 1 });
        return result;
      }`,
      right:
        'export default () => ({ kind: "record", tokens: [{ extra: 1 }] });',
    });
    const result = compare(...graphs);
    expect(result.property_inventories.map(({ side }) => side).sort()).toEqual([
      "left",
      "right",
    ]);
    expect(result.summary).toMatchObject({ added: 0, removed: 0, changed: 0 });
    expect(result.coverage.status).toBe("partial");
    for (const inventory of result.property_inventories)
      expect(inventory.properties).toContain("/kind");
  });

  it.each(["delete result.count;", "result.count = query();"])(
    "omits matching uncertain projections after %s",
    async (mutation) => {
      const source = `export default function make() {
        const result = { kind: "result", count: 1 };
        ${mutation}
        return result;
      }`;
      const graphs = await analyzeSources({ left: source, right: source });
      const result = compare(...graphs);
      expect(
        result.property_inventories.map(({ side }) => side).sort(),
      ).toEqual(["left", "right"]);
      expect(result.changes).toEqual([]);
      expect(result.summary).toEqual({
        added: 0,
        removed: 0,
        changed: 0,
        unknown: 0,
      });
      expect(result.coverage.status).toBe("partial");
      expect(
        result.property_inventories.every(
          ({ properties }) => !properties.includes("/count"),
        ),
      ).toBe(true);
    },
  );
});

describe("JavaScript export localized mutation uncertainty", () => {
  it.each([
    {
      initializer: '{ kind: "result", count: 1 }',
      mutation: "delete result.count;",
      uncertain: "/count",
      right: '{ kind: "result", total: 1 }',
      added: "/total",
    },
    {
      initializer: '{ kind: "result" }',
      mutation: "result.count = query();",
      uncertain: "/count",
      right: '{ kind: "result", total: 1 }',
      added: "/total",
    },
    {
      initializer: '{ kind: "result" }',
      mutation: "delete result.count;",
      uncertain: "/count",
      right: '{ kind: "result", total: 1 }',
      added: "/total",
    },
    {
      initializer: '{ kind: "result", nested: {} }',
      mutation: "result.nested.count = query();",
      uncertain: "/nested/count",
      right: '{ kind: "result", nested: { total: 1 } }',
      added: "/nested/total",
    },
    {
      initializer: '{ kind: "result", items: [] }',
      mutation: "result.items[1] = query();",
      uncertain: "/items/1",
      right: '{ kind: "result", items: [,,1] }',
      added: "/items/2",
    },
    {
      initializer: '{ kind: "result", items: [] }',
      mutation: "delete result.items[1];",
      uncertain: "/items/1",
      right: '{ kind: "result", items: [,,1] }',
      added: "/items/2",
    },
    {
      initializer: '{ kind: "result", items: [] }',
      mutation: "result.items[1000000000] = query();",
      uncertain: "/items/1000000000",
      right: '{ kind: "result", items: [,,1] }',
      added: "/items/2",
    },
  ])(
    "localizes $mutation without losing sibling absence",
    async ({ initializer, mutation, uncertain, right, added }) => {
      const graphs = await analyzeSources({
        left: `export default function make() {
          const result = ${initializer};
          ${mutation}
          return result;
        }`,
        right: `export default () => (${right});`,
      });
      const result = compare(...graphs);
      expect(result.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: uncertain,
            status: "unknown",
            presence: { left: "unknown-coverage", right: "absent" },
          }),
          expect.objectContaining({
            path: added,
            status: "added",
            presence: { left: "absent", right: "present" },
          }),
        ]),
      );
      expect(result.summary).toEqual({
        added: 1,
        removed: 0,
        changed: 0,
        unknown: 1,
      });
    },
  );
});

describe("JavaScript export property presence boundaries", () => {
  it("rejects return-shape observations that omit required slot presence", async () => {
    const source =
      'export default () => ({ kind: "result", count: flag ? 1 : 2, nested: { enabled: true } });';
    const [left, right] = await analyzeSources({ left: source, right: source });
    const graph = createJavaScriptApplicationGraph({
      schema: "JavaScriptApplicationGraph",
      root_node_ids: left.graph.root_node_ids,
      edges: left.graph.edges,
      coverage: left.graph.coverage,
      limitations: left.graph.limitations,
      nodes: left.graph.nodes.map((node) =>
        createJavaScriptApplicationNode({
          kind: node.kind,
          identity: node.identity,
          observations: node.observations.map(
            ({ label, properties, evidence }) => {
              if (properties.semantic_role !== "export-return-shapes")
                return { label, properties, evidence };
              const projection =
                projectedExportReturnShapesSchema.parse(properties);
              return {
                label,
                evidence,
                properties: {
                  ...properties,
                  static_return_shapes: projection.static_return_shapes.map(
                    (shape) => ({
                      ...shape,
                      fields: shape.fields.map(
                        ({ path, state, value, reason }) => ({
                          path,
                          state,
                          value,
                          reason,
                        }),
                      ),
                    }),
                  ),
                },
              };
            },
          ),
        }),
      ),
    });
    for (const sides of [
      [{ ...left, graph }, right],
      [right, { ...left, graph }],
    ] as const) {
      const result = compare(sides[0], sides[1]);
      expect(result.coverage.paired_variants).toBe(0);
      expect([result.left.status, result.right.status]).toContain(
        "unavailable",
      );
      expect(result.changes).toEqual([
        expect.objectContaining({ status: "unknown", path: "" }),
      ]);
      expect(result.coverage.status).toBe("partial");
    }
  });

  it("proves absence beyond literal holes while retaining unknown spread coverage", async () => {
    const right =
      'export default () => ({ kind: "result", items: [,, call()] });';
    const literal = await analyzeSources({
      left: 'export default () => ({ kind: "result", items: [,] });',
      right,
    });
    const result = compare(...literal);
    expect(result.changes).toEqual([
      expect.objectContaining({
        path: "/items/2",
        status: "added",
        presence: { left: "absent", right: "present" },
      }),
    ]);
    expect(result.coverage.status).toBe("complete-within-inputs");
    const spread = await analyzeSources({
      left: 'export default () => ({ kind: "result", items: [, ...rest] });',
      right,
    });
    expect(compare(...spread).changes).toContainEqual(
      expect.objectContaining({
        path: "/items/2",
        status: "unknown",
        presence: { left: "unknown-coverage", right: "present" },
      }),
    );
  });

  it("excludes the return root but retains empty property names and nested containers", async () => {
    const source =
      'export default () => ({ kind: "result", "": call(), options: {} });';
    const graphs = await analyzeSources({ left: source, right: source });
    const result = compare(...graphs);
    expect(inventoryProperties(result, "left", 0)).toEqual([
      "/",
      "/kind",
      "/options",
    ]);
    expect(result.property_inventories[0]?.property_coverage).toContainEqual({
      path: "",
      status: "complete",
    });
  });
});

describe("JavaScript export return-shape property presence", () => {
  it("lists observed names without pairing untagged search variants", async () => {
    const graphs = await analyzeSources(
      {
        left: untaggedSearchSource("count"),
        right: untaggedSearchSource("total"),
      },
      "search.js",
    );
    const first = compare(...graphs, {
      modulePath: "search.js",
      leftExportName: "search",
      rightExportName: "search",
    });
    const second = compare(...graphs, {
      modulePath: "search.js",
      leftExportName: "search",
      rightExportName: "search",
    });

    expect(first.comparison_id).toBe(second.comparison_id);
    expect(first.coverage).toMatchObject({
      paired_variants: 0,
      unpaired_left_variants: 1,
      unpaired_right_variants: 1,
    });
    expect(first.summary).toEqual({
      added: 0,
      removed: 0,
      changed: 0,
      unknown: 2,
    });
    expect(
      first.changes.every(({ discriminant }) => discriminant === null),
    ).toBe(true);
    expect(inventoryProperties(first, "left", 0)).toEqual(
      expect.arrayContaining(["/count", "/matches"]),
    );
    expect(inventoryProperties(first, "right", 0)).toEqual(
      expect.arrayContaining(["/matches", "/query", "/total"]),
    );
    expect(inventoryProperties(first, "left", 0)).not.toEqual(
      inventoryProperties(first, "right", 0),
    );
  });

  it("reports presence-only added and removed names for tagged search variants", async () => {
    const graphs = await analyzeSources(
      {
        left: taggedSearchSource({ count: true }),
        right: taggedSearchSource({ total: true, query: true }),
      },
      "search.js",
    );
    const first = compare(...graphs, {
      modulePath: "search.js",
      leftExportName: "search",
      rightExportName: "search",
    });
    const second = compare(...graphs, {
      modulePath: "search.js",
      leftExportName: "search",
      rightExportName: "search",
    });

    expect(first.comparison_id).toBe(second.comparison_id);
    expect(() =>
      javaScriptExportShapeComparisonResultSchema.parse(first),
    ).not.toThrow();
    expect(first.coverage.paired_variants).toBe(1);
    expect(first.summary.added).toBe(2);
    expect(first.summary.removed).toBe(1);
    expect(
      first.changes.filter(({ path }) =>
        ["/count", "/total", "/query"].includes(path),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "removed",
          path: "/count",
          presence: { left: "present", right: "absent" },
          left: expect.objectContaining({ availability: "unknown" }),
          right: { availability: "absent" },
        }),
        expect.objectContaining({
          status: "added",
          path: "/total",
          presence: { left: "absent", right: "present" },
          left: { availability: "absent" },
          right: expect.objectContaining({ availability: "unknown" }),
        }),
        expect.objectContaining({
          status: "added",
          path: "/query",
          presence: { left: "absent", right: "present" },
          left: { availability: "absent" },
          right: expect.objectContaining({ availability: "unknown" }),
        }),
      ]),
    );
    expect(
      first.changes.some(
        ({ path, status }) =>
          ["/count", "/total", "/query"].includes(path) && status === "unknown",
      ),
    ).toBe(false);
    expect(inventoryProperties(first, "left", 0)).toEqual(
      expect.arrayContaining(["/count", "/kind", "/matches"]),
    );
    expect(inventoryProperties(first, "right", 0)).toEqual(
      expect.arrayContaining(["/kind", "/matches", "/query", "/total"]),
    );
  });
});

describe("JavaScript export return-shape container presence", () => {
  it.each(["{}", "[]", "{ nested: 1 }"])(
    "does not report a retained %s container property as added or removed",
    async (container) => {
      const graphs = await analyzeSources({
        left: 'export default () => ({ type: "item", options: false });',
        right: `export default () => ({ type: "item", options: ${container} });`,
      });
      const forward = compare(...graphs);
      const reverse = compare(graphs[1], graphs[0]);
      expect(
        forward.changes.find(({ path }) => path === "/options"),
        `${container}: primitive to container`,
      ).toMatchObject({
        status: "unknown",
        left: { availability: "literal", value: false },
        right: { availability: "unknown" },
      });
      expect(() =>
        javaScriptExportShapeComparisonResultSchema.parse(forward),
      ).not.toThrow();
      expect(
        reverse.changes.find(({ path }) => path === "/options"),
        `${container}: container to primitive`,
      ).toMatchObject({
        status: "unknown",
        left: { availability: "unknown" },
        right: { availability: "literal", value: false },
      });
    },
  );

  it.each([
    { left: "", right: ", options: false", status: "added" },
    { left: ", options: false", right: "", status: "removed" },
  ])("preserves genuine primitive $status", async ({ left, right, status }) => {
    const graphs = await analyzeSources({
      left: `export default () => ({ type: "item"${left} });`,
      right: `export default () => ({ type: "item"${right} });`,
    });
    expect(compare(...graphs).changes).toEqual([
      expect.objectContaining({ path: "/options", status }),
    ]);
  });

  it("keeps a container transition unknown under incomplete spread coverage", async () => {
    const graphs = await analyzeSources({
      left: 'export default () => ({ type: "item", options: false });',
      right:
        'export default () => ({ type: "item", options: { ...dynamic } });',
    });
    const result = compare(...graphs);
    expect(
      result.changes.find(({ path }) => path === "/options"),
    ).toMatchObject({
      status: "unknown",
      right: { availability: "unknown" },
    });
    expect(result.coverage.status).toBe("partial");
  });

  it("preserves identical container leaves and real primitive changes", async () => {
    const graphs = await analyzeSources({
      left: 'export default () => ({ type: "item", options: {}, enabled: false });',
      right:
        'export default () => ({ type: "item", options: {}, enabled: true });',
    });
    const result = compare(...graphs);
    expect(result.changes).toEqual([
      expect.objectContaining({ path: "/enabled", status: "changed" }),
    ]);
  });
});

describe("JavaScript export return-shape selection", () => {
  it("returns complete candidate, variant, and change inventories", async () => {
    const candidates = await analyzeSources({
      left: `
        export const first = () => ({ type: "first" });
        export const second = () => ({ type: "second" });
        export const third = () => ({ type: "third" });
      `,
      right: `export default () => ({ type: "default" });`,
    });
    const missing = compare(candidates[0], candidates[1], {
      leftExportName: "missing",
    });
    expect(missing.left).toMatchObject({
      status: "missing",
      omitted_candidates: 0,
      candidates: expect.arrayContaining([
        expect.objectContaining({ export_name: "first" }),
        expect.objectContaining({ export_name: "second" }),
        expect.objectContaining({ export_name: "third" }),
      ]),
    });

    const parsers = await sourceOwnedParsers();
    const variants = compare(parsers[0], parsers[1]);
    expect(variants.coverage.omitted_left_variants).toBe(0);
    expect(variants.coverage.omitted_right_variants).toBe(0);

    const changes = await analyzeSources({
      left: `export default () => ({ type: "item" });`,
      right: `export default () => ({ type: "item", depth: 1, level: 2 });`,
    });
    const complete = compare(changes[0], changes[1]);
    expect(complete.summary.added).toBe(2);
    expect(complete.changes).toHaveLength(2);
    expect(complete.coverage.omitted_changes).toBe(0);
  });

  it("refuses an exact selector that resolves to multiple graph nodes", async () => {
    const [left, right] = await analyzeSources({
      left: `export default () => ({ type: "item" });`,
      right: `export default () => ({ type: "item" });`,
    });
    const exported = left.graph.nodes.find((node) =>
      node.observations.some(
        ({ properties }) => properties.semantic_role === "export-binding",
      ),
    );
    if (
      exported === undefined ||
      exported.identity.strategy !== "artifact-local-key"
    )
      throw new Error("Expected one artifact-local export fixture node");
    const duplicate = createJavaScriptApplicationNode({
      kind: exported.kind,
      identity: {
        ...exported.identity,
        key: `${exported.identity.key}:duplicate`,
      },
      observations: exported.observations.map(
        ({ label, properties, evidence }) => ({ label, properties, evidence }),
      ),
    });
    const ambiguousGraph = createJavaScriptApplicationGraph({
      schema: "JavaScriptApplicationGraph",
      root_node_ids: left.graph.root_node_ids,
      nodes: [...left.graph.nodes, duplicate],
      edges: left.graph.edges,
      coverage: left.graph.coverage,
      limitations: left.graph.limitations,
    });
    const result = compare({ ...left, graph: ambiguousGraph }, right);

    expect(result.left).toMatchObject({
      status: "ambiguous",
      selected_node_id: null,
      candidates: [expect.any(Object), expect.any(Object)],
    });
    expect(result.changes).toEqual([
      expect.objectContaining({ status: "unknown", path: "" }),
    ]);
  });
});

describe("JavaScript export return-shape projection", () => {
  it("retains more than 64 inferred return fields", async () => {
    const properties = Array.from(
      { length: 70 },
      (_, index) => `field${String(index)}: ${String(index)}`,
    ).join(",");
    const root = await temporaryRoot();
    await writeFile(
      join(root, "parser.mjs"),
      `export const parse = () => ({ ${properties} });`,
    );
    const analyzed = await analyzeGraph(root);
    const returnShape = analyzed.graph.nodes
      .flatMap(({ observations }) => observations)
      .find(
        ({ properties: value }) =>
          value.semantic_role === "export-return-shapes",
      );

    const shapes = returnShape?.properties.static_return_shapes;
    expect(Array.isArray(shapes)).toBe(true);
    if (!Array.isArray(shapes)) throw new TypeError("Missing return shapes");
    const firstShape = shapes[0];
    if (
      firstShape === null ||
      typeof firstShape !== "object" ||
      Array.isArray(firstShape)
    )
      throw new TypeError("Missing first return shape");
    expect(firstShape.fields).toHaveLength(70);
    expect(returnShape?.properties.return_shape_coverage).toMatchObject({
      omitted_fields: 0,
      projection_complete: true,
    });
  });

  it("returns every source property within the supplied inputs", async () => {
    const properties = [
      'a_type: "item"',
      ...Array.from(
        { length: 70 },
        (_, index) => `field${String(index)}: ${String(index)}`,
      ),
    ].join(",");
    const [left, right] = await analyzeSources({
      left: `export default () => ({ ${properties} });`,
      right: `export default () => ({ ${properties} });`,
    });
    const result = compare(left, right);

    expect(result.coverage.status).toBe("complete-within-inputs");
    expect(result.coverage.left_omitted_fields).toBe(0);
    expect(result.coverage.right_omitted_fields).toBe(0);
  });
});

it("preserves export lifetime and selected value facts through retained comparison Evidence", async () => {
  const graphs = await analyzeSources(
    {
      left: `
      exports.deleted = function(){ return {type:"result",value:1}; }; delete exports.deleted;
      exports.intact = function(){ return {type:"result",value:1}; };
      exports.precise = function(){ const source={stable:7}; return {type:"result",...source,value:true ? 1 : 2}; };
    `,
      right: `
      exports.deleted = function(){ return {type:"result",value:2}; }; delete exports.deleted;
      exports.intact = function(){ return {type:"result",value:2}; };
      exports.precise = function(){ return {type:"result",stable:7,value:1}; };
    `,
    },
    "main.cjs",
  );
  const deleted = compare(...graphs, {
    modulePath: "main.cjs",
    leftExportName: "deleted",
    rightExportName: "deleted",
  });
  expect(deleted.left.status).toBe("missing");
  expect(deleted.right.status).toBe("missing");
  expect(deleted.changes.every(({ status }) => status === "unknown")).toBe(
    true,
  );
  const intact = compare(...graphs, {
    modulePath: "main.cjs",
    leftExportName: "intact",
    rightExportName: "intact",
  });
  expect(intact.changes).toEqual([
    expect.objectContaining({ path: "/value", status: "changed" }),
  ]);
  const precise = compare(...graphs, {
    modulePath: "main.cjs",
    leftExportName: "precise",
    rightExportName: "precise",
  });
  expect(precise.changes).toEqual([]);
  const missingCounterpart = compare(...graphs, {
    modulePath: "main.cjs",
    leftExportName: "deleted",
    rightExportName: "intact",
  });
  expect(missingCounterpart.changes[0]?.right).toMatchObject({
    availability: "unknown",
    reason: expect.stringContaining("counterpart"),
  });
});

it("retains provenance-only depth omissions alongside unaffected export facts", async () => {
  const graphs = await analyzeSources({
    left: `const deep=${"a=".repeat(300)}"x"; export default()=>({type:"stable",value:7});`,
    right: `const deep=${"a=".repeat(10)}"x"; export default()=>({type:"stable",value:7});`,
  });
  expect(graphs[0].graph.coverage).toMatchObject({
    status: "partial",
    omitted_count: null,
    limits: expect.arrayContaining([
      expect.objectContaining({ name: "javascript_semantic_expression_depth" }),
    ]),
  });
  expect(graphs[1].graph.coverage.status).toBe("complete");
  expect(compare(...graphs).changes).toEqual([]);
});

type GraphSource = Awaited<ReturnType<typeof analyzeGraph>>;

const compare = (
  left: GraphSource,
  right: GraphSource,
  options: {
    readonly modulePath?: string;
    readonly leftExportName?: string;
    readonly rightExportName?: string;
  } = {},
) =>
  compareJavaScriptExportShapes({
    left: {
      evidenceId: left.evidence.evidence_id,
      graph: left.graph,
      modulePath: options.modulePath ?? "parser.mjs",
      exportName: options.leftExportName ?? "default",
    },
    right: {
      evidenceId: right.evidence.evidence_id,
      graph: right.graph,
      modulePath: options.modulePath ?? "parser.mjs",
      exportName: options.rightExportName ?? "default",
    },
  });

const analyzeGraph = async (root: string) => {
  const result = await analyzeJavaScriptApplication({
    input_path: root,
  });
  if (!result.ok) throw result.error;
  const parsed = parseApplicationGraphEvidence(result.value);
  if (!parsed.ok) throw new Error("Analysis Evidence must parse");
  return parsed.value;
};

const analyzeSources = async (
  sources: {
    readonly left: string;
    readonly right: string;
  },
  fileName = "parser.mjs",
): Promise<[GraphSource, GraphSource]> => {
  const root = await temporaryRoot();
  const leftRoot = join(root, "left");
  const rightRoot = join(root, "right");
  await Promise.all([mkdir(leftRoot), mkdir(rightRoot)]);
  await Promise.all([
    writeFile(join(leftRoot, fileName), sources.left),
    writeFile(join(rightRoot, fileName), sources.right),
  ]);
  return Promise.all([analyzeGraph(leftRoot), analyzeGraph(rightRoot)]);
};

const inventoryProperties = (
  result: ReturnType<typeof compareJavaScriptExportShapes>,
  side: "left" | "right",
  variantIndex: number,
): string[] => {
  const inventory = result.property_inventories.find(
    (entry) => entry.side === side && entry.variant_index === variantIndex,
  );
  if (inventory === undefined)
    throw new Error(
      `Missing ${side} property inventory ${String(variantIndex)}`,
    );
  return inventory.properties;
};

const untaggedSearchSource = (countKey: "count" | "total"): string =>
  countKey === "count"
    ? `
        export function search(items, q) {
          const matches = items.filter((item) => item.includes(q));
          return { matches, count: matches.length };
        }
      `
    : `
        export function search(items, q) {
          const matches = items.filter((item) => item.includes(q));
          return { matches, total: matches.length, query: String(q) };
        }
      `;

const taggedSearchSource = (fields: {
  readonly count?: boolean;
  readonly total?: boolean;
  readonly query?: boolean;
}): string => {
  const extra = [
    fields.count === true ? "count: matches.length" : null,
    fields.total === true ? "total: matches.length" : null,
    fields.query === true ? "query: String(q)" : null,
  ]
    .filter((field): field is string => field !== null)
    .join(", ");
  return `
    export function search(items, q) {
      const matches = items.filter((item) => item.includes(q));
      return { kind: "results", matches${extra.length > 0 ? `, ${extra}` : ""} };
    }
  `;
};

const sourceOwnedParsers = async (): Promise<[GraphSource, GraphSource]> => {
  const root = await temporaryRoot();
  const leftRoot = join(root, "left");
  const rightRoot = join(root, "right");
  await Promise.all([mkdir(leftRoot), mkdir(rightRoot)]);
  await Promise.all([
    copyFile(
      resolve("tests/fixtures/replay/parser.mjs"),
      join(leftRoot, "parser.mjs"),
    ),
    copyFile(
      resolve("tests/fixtures/replay/parser-v2.mjs"),
      join(rightRoot, "parser.mjs"),
    ),
  ]);
  return Promise.all([analyzeGraph(leftRoot), analyzeGraph(rightRoot)]);
};

const temporaryRoot = (): Promise<string> =>
  createTestTempDirectory("rea-export-shapes-");

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readImportSpecifiers } from "../../../scripts/lib/import-specifiers.mjs";

const root = dirname(fileURLToPath(import.meta.url));

const relativeSpecifiers = (source: string): readonly string[] =>
  readImportSpecifiers(source)
    .map(({ specifier }) => specifier)
    .filter((specifier) => specifier.startsWith("."));

/**
 * Cycles that already existed outside the semantic analysis hub. Membership is
 * exact so a new edge cannot hide inside the allow-list.
 */
const allowedCycles = [
  [
    "electronStaticAnalysisTypes.ts",
    "javascriptRouteFacts.ts",
    "javascriptSourceCoordinates.ts",
    "javascriptStaticAnalysisTypes.ts",
  ],
  [
    "javascriptRuntimeReconciliationActive.ts",
    "javascriptRuntimeReconciliationCaptureParsing.ts",
  ],
  ["javascriptStaticAnalysisFindings.ts", "javascriptStaticAnalysisState.ts"],
];

const allowedCycleEdges = [
  "electronStaticAnalysisTypes.ts -> javascriptStaticAnalysisTypes.ts",
  "javascriptRouteFacts.ts -> javascriptSourceCoordinates.ts",
  "javascriptSourceCoordinates.ts -> javascriptStaticAnalysisTypes.ts",
  "javascriptStaticAnalysisTypes.ts -> electronStaticAnalysisTypes.ts",
  "javascriptStaticAnalysisTypes.ts -> javascriptRouteFacts.ts",
  "javascriptRuntimeReconciliationActive.ts -> javascriptRuntimeReconciliationCaptureParsing.ts",
  "javascriptRuntimeReconciliationCaptureParsing.ts -> javascriptRuntimeReconciliationActive.ts",
  "javascriptStaticAnalysisFindings.ts -> javascriptStaticAnalysisState.ts",
  "javascriptStaticAnalysisState.ts -> javascriptStaticAnalysisFindings.ts",
].sort();

const productionFiles = (directory: string): string[] => {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...productionFiles(path));
    else if (name.endsWith(".ts") && !name.includes(".test.")) files.push(path);
  }
  return files;
};

const importGraph = (): Map<string, Set<string>> => {
  const files = new Set(
    productionFiles(root).map((path) => relative(root, path)),
  );
  const graph = new Map<string, Set<string>>();
  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8");
    const edges = new Set<string>();
    for (const spec of relativeSpecifiers(source)) {
      const resolved = resolve(dirname(join(root, file)), spec).replace(
        /\.js$/,
        ".ts",
      );
      const target = relative(root, resolved);
      if (files.has(target)) edges.add(target);
    }
    graph.set(file, edges);
  }
  return graph;
};

const stronglyConnected = (
  graph: Map<string, Set<string>>,
): readonly (readonly string[])[] => {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const components: string[][] = [];
  const visit = (node: string): void => {
    indices.set(node, index);
    low.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!indices.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node) ?? index, low.get(next) ?? index));
      } else if (onStack.has(next)) {
        low.set(
          node,
          Math.min(low.get(node) ?? index, indices.get(next) ?? index),
        );
      }
    }
    if (low.get(node) === indices.get(node)) {
      const component: string[] = [];
      let member = "";
      while (member !== node) {
        member = stack.pop() ?? node;
        onStack.delete(member);
        component.push(member);
      }
      if (component.length > 1) components.push(component.sort());
    }
  };
  for (const node of [...graph.keys()].sort()) {
    if (!indices.has(node)) visit(node);
  }
  return components.sort(
    (left, right) =>
      right.length - left.length || left.join().localeCompare(right.join()),
  );
};

describe("javascript semantic import cycles", () => {
  it("keeps the semantic modules out of one import cycle", () => {
    const graph = importGraph();
    const cycles = stronglyConnected(graph).map((cycle) => cycle.join("\n"));
    expect(cycles).toEqual(
      allowedCycles.map((cycle) => [...cycle].sort().join("\n")),
    );
    const internalEdges = allowedCycles.flatMap((cycle) =>
      cycle.flatMap((source) =>
        [...(graph.get(source) ?? [])]
          .filter((target) => cycle.includes(target))
          .map((target) => `${source} -> ${target}`),
      ),
    );
    expect(internalEdges.sort()).toEqual(allowedCycleEdges);
  });
});

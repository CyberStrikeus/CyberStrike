import { expect, it } from "vitest";
import { z } from "zod";
import { createAnalysisExecution } from "../../src/application/AnalysisProvider.js";
import { traceCallPath } from "../../src/application/CallPathTracing.js";
import { ok } from "../../src/domain/result.js";

const traceSchema = z.object({
  goal_status: z.string(),
  traversal_path: z.array(z.string()),
  nodes: z.array(z.object({ address: z.string(), depth: z.number() })),
  edges: z.array(
    z.object({
      source_address: z.string(),
      target_address: z.string(),
      discovery_depth: z.number(),
    }),
  ),
});
const addresses = ["0x1", "0x2", "0x3"];

/** Enumerate simple paths independently of the production breadth-first traversal. */
const pathsFrom = (
  graph: ReadonlyMap<string, readonly string[]>,
  path: string[],
): string[][] => [
  path,
  ...(graph.get(path.at(-1)!) ?? []).flatMap((next) =>
    path.includes(next) ? [] : pathsFrom(graph, [...path, next]),
  ),
];

it("matches a simple-path oracle for every three-node directed graph in both directions", async () => {
  const possible = addresses.flatMap((from) =>
    addresses.filter((to) => to !== from).map((to) => [from, to] as const),
  );
  for (let mask = 0; mask < 2 ** possible.length; mask++) {
    const edges = possible.filter((_, index) => mask & (1 << index));
    for (const direction of ["forward", "backward"] as const) {
      const graph = new Map(
        addresses.map((address) => [
          address,
          edges
            .filter(
              ([from, to]) => (direction === "forward" ? from : to) === address,
            )
            .map(([from, to]) => (direction === "forward" ? to : from)),
        ]),
      );
      const paths = pathsFrom(graph, ["0x1"]).sort(
        (a, b) =>
          a.length - b.length ||
          JSON.stringify(a).localeCompare(JSON.stringify(b)),
      );
      const depth = (address: string) =>
        paths.find((path) => path.at(-1) === address)!.length - 1;
      for (const goal of [undefined, ...addresses]) {
        const expanded: string[] = [];
        const result = await traceCallPath(
          async (_, args) => ok(String(args.procedure)),
          async (_, args) => {
            const address = String(args.procedure);
            expanded.push(address);
            // Deliberately duplicated and reversed producer order.
            const related = [...(graph.get(address) ?? [])].reverse();
            return ok(
              createAnalysisExecution(
                [...related, ...related],
                { id: "oracle", name: "Oracle", version: null },
                { relationshipCoverage: { status: "complete" } },
              ),
            );
          },
          { start: "0x1", goal, direction },
        );
        if (!result.ok) throw result.error;
        const trace = traceSchema.parse(result.value);
        const expected =
          goal === undefined
            ? []
            : (paths.find((path) => path.at(-1) === goal) ?? []);
        expect(trace.traversal_path).toEqual(expected);
        expect(trace.goal_status).toBe(
          goal === undefined
            ? "not_requested"
            : expected.length > 0
              ? "reached"
              : "not_reached",
        );
        expect(new Set(expanded).size).toBe(expanded.length);
        if (goal !== undefined) continue;
        const reachable = new Set(paths.map((path) => path.at(-1)!));
        expect(trace.nodes).toEqual(
          [...reachable]
            .map((address) => ({ address, depth: depth(address) }))
            .sort(
              (a, b) => a.depth - b.depth || a.address.localeCompare(b.address),
            ),
        );
        expect(trace.edges).toEqual(
          edges
            .filter(([from, to]) =>
              reachable.has(direction === "forward" ? from : to),
            )
            .map(([from, to]) => ({
              source_address: from,
              target_address: to,
              discovery_depth: depth(direction === "forward" ? from : to) + 1,
            }))
            .sort(
              (a, b) =>
                a.discovery_depth - b.discovery_depth ||
                a.source_address.localeCompare(b.source_address) ||
                a.target_address.localeCompare(b.target_address),
            ),
        );
      }
    }
  }
});

it("reconstructs a deep chain iteratively and preserves its discovery depths", async () => {
  const count = 5000;
  const address = (index: number) => `0x${index.toString(16).padStart(4, "0")}`;
  const result = await traceCallPath(
    async (_, args) => ok(String(args.procedure)),
    async (_, args) => {
      const next = Number.parseInt(String(args.procedure).slice(2), 16) + 1;
      return ok(
        createAnalysisExecution(
          next < count ? [address(next)] : [],
          { id: "chain", name: "Chain", version: null },
          { relationshipCoverage: { status: "complete" } },
        ),
      );
    },
    { start: address(0), goal: address(count - 1), direction: "forward" },
  );
  if (!result.ok) throw result.error;
  const trace = traceSchema.parse(result.value);
  expect(trace.traversal_path).toEqual(
    Array.from({ length: count }, (_, index) => address(index)),
  );
  expect(trace.nodes.at(-1)).toEqual({
    address: address(count - 1),
    depth: count - 1,
  });
});

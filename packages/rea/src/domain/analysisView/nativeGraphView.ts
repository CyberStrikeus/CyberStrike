import { z } from "zod";
import type { NativeCallGraph } from "../native/nativeCallGraph.js";
import type { RelationshipCoverage } from "../relationshipCoverage.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import {
  nativeGraphViewItemsSchema,
  referencedRelationshipCoverageSchema,
} from "./nativeObservationSchemas.js";

type GraphItems = z.output<typeof nativeGraphViewItemsSchema>;
type Coverage = z.output<typeof referencedRelationshipCoverageSchema>;

const referenceCoverage = (
  source: RelationshipCoverage,
  intern: (message: string) => number,
): Coverage => {
  const diagnostic =
    source.diagnostics === undefined
      ? {}
      : { diagnostic_ids: source.diagnostics.map(intern) };
  if (source.status === "complete")
    return { status: "complete", ...diagnostic };
  const directions =
    source.limited_directions === undefined
      ? {}
      : { limited_directions: source.limited_directions };
  return source.status === "partial"
    ? {
        status: "partial",
        limitation_ids: source.limitations.map(intern),
        ...directions,
        ...diagnostic,
      }
    : {
        status: "unknown",
        reason_id: intern(source.reason),
        ...directions,
        ...diagnostic,
      };
};

/** Object levels have canonical key order; row identity is (parent, level, source_index). */
export const projectNativeGraphRows = (
  source: NativeCallGraph,
  view: { readonly offset: number; readonly limit: number },
): { items: GraphItems; total: number } => {
  const messages: string[] = [];
  const known = new Map<string, number>();
  const intern = (message: string): number => {
    const prior = known.get(message);
    if (prior !== undefined) return prior;
    const id = messages.length;
    messages.push(message);
    known.set(message, id);
    return id;
  };
  const rows: GraphItems["rows"] = [];
  let total = 0;
  for (const level of Object.keys(source.graph).sort(
    compareUnicodeCodePoints,
  )) {
    const nodes = source.graph[level]!;
    if (nodes.length === 0) {
      if (total >= view.offset && rows.length < view.limit)
        rows.push({ level, source_index: null, status: "empty-level" });
      total++;
      continue;
    }
    const begin = Math.max(0, view.offset - total);
    const end = Math.min(
      nodes.length,
      begin + Math.max(0, view.limit - rows.length),
    );
    for (let index = begin; index < end; index++) {
      const node = nodes[index]!;
      rows.push(
        node.status === "error"
          ? { level, source_index: index, ...node }
          : {
              level,
              source_index: index,
              address: node.address,
              status: node.status,
              calls: node.calls,
              relationship_coverage: referenceCoverage(
                node.relationship_coverage,
                intern,
              ),
              ...(node.limitations === undefined
                ? {}
                : { limitation_ids: node.limitations.map(intern) }),
            },
      );
    }
    total += nodes.length;
  }
  return { items: { type: "graph-nodes", messages, rows }, total };
};

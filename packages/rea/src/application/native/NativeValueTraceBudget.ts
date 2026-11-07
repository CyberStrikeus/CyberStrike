import type { z } from "zod";
import { jsonParts } from "../../domain/jsonSerialization.js";
import {
  nativeValueTraceTruncationReasonSchema,
  type nativeValueTraceSchema,
  type NativeValueTraceTruncationReason,
} from "../../domain/native/nativeValueTrace.js";

type Trace = z.output<typeof nativeValueTraceSchema>;
type TraceNode = Trace["nodes"][number];
type TraceEdge = Trace["edges"][number];
type TraceUnknown = Trace["unknowns"][number];

/** Retained node JSON allowance; this release has no runtime override. */
const NODE_PAYLOAD_BYTES = 8 * 1024 * 1024;

const rowBudgetReasons = {
  max_nodes: "Node budget reached",
  node_payload_bytes: "Node payload budget reached",
  max_edges: "Edge budget reached",
} as const;

/**
 * Own row admission and every observed cause of a narrowed traversal. Each
 * cause is recorded with a located unknown, and a row budget is recorded only
 * after it rejects a row, so an exactly filled budget is not truncation.
 */
export const createValueTraceBudget = (
  limits: { readonly max_nodes: number; readonly max_edges: number },
  unknowns: TraceUnknown[],
) => {
  const nodes: TraceNode[] = [];
  const edges: TraceEdge[] = [];
  const causes = new Set<NativeValueTraceTruncationReason>();
  let bytes = 0;
  let nodesExhausted = false;
  let edgesExhausted = false;
  const narrow = (
    reason: NativeValueTraceTruncationReason,
    unknown: TraceUnknown,
  ): false => {
    causes.add(reason);
    unknowns.push(unknown);
    return false;
  };
  const reject = (procedure: string, reason: keyof typeof rowBudgetReasons) =>
    narrow(reason, {
      procedure,
      address: null,
      reason: rowBudgetReasons[reason],
    });
  return {
    nodes,
    edges,
    narrow,
    retainNode(value: TraceNode): boolean {
      if (nodesExhausted) return false;
      if (nodes.length >= limits.max_nodes) {
        nodesExhausted = true;
        return reject(value.procedure, "max_nodes");
      }
      let size = 0;
      // Reuse bounded JSON encoding to count escapes and UTF-8 expansion
      // before allocating a complete serialized node that might not fit.
      for (const part of jsonParts(value)) {
        size += Buffer.byteLength(part);
        if (size > NODE_PAYLOAD_BYTES - bytes) {
          nodesExhausted = true;
          return reject(value.procedure, "node_payload_bytes");
        }
      }
      bytes += size;
      nodes.push(value);
      return true;
    },
    retainEdge(value: TraceEdge, procedure: string): boolean {
      if (edgesExhausted) return false;
      if (edges.length >= limits.max_edges) {
        edgesExhausted = true;
        return reject(procedure, "max_edges");
      }
      edges.push(value);
      return true;
    },
    /** A rejected edge means no later call edge or expansion can be retained. */
    edgesExhausted: () => edgesExhausted,
    /** Traversal stops after the procedure in which a row budget rejected work. */
    exhausted: () => nodesExhausted || edgesExhausted,
    traversal: (): Trace["traversal"] => {
      const reasons = nativeValueTraceTruncationReasonSchema.options.filter(
        (reason) => causes.has(reason),
      );
      return reasons.length === 0
        ? { status: "complete" }
        : { status: "truncated", reasons };
    },
  };
};

import type { SemanticFlowProjectionContext } from "./JavaScriptSemanticGraphFlowProjection.js";
import { createSemanticNodeRangeLookup } from "./JavaScriptSemanticGraphProjection.js";
import { sourceRangesEqual } from "../../domain/javascript/javascriptStaticAnalysisHelpers.js";
import { javascriptSourceRangeKey } from "../../domain/javascript/javascriptSourceCoordinates.js";
import {
  addSemanticGraphRelation,
  addSemanticGraphUnknown,
} from "./JavaScriptSemanticGraphConstruction.js";
import { unknownSemanticEvidence } from "./JavaScriptSemanticGraphEvidence.js";

/** Connect retained reads to writes without claiming assignment values or order. */
export function* projectSemanticAssignments(
  context: SemanticFlowProjectionContext,
): Generator<void, void> {
  const readsWithin = createSemanticNodeRangeLookup(context.readNodes);
  const writesWithin = createSemanticNodeRangeLookup(context.writeNodes);
  const expressions = new Set(
    context.ir.expressionFlows.map((flow) =>
      javascriptSourceRangeKey(flow.location),
    ),
  );
  for (const [index, flow] of context.ir.assignmentFlows.entries()) {
    if (index % 64 === 0) yield;
    const owner =
      flow.ownerCallableId === null
        ? null
        : context.callableNodes.get(flow.ownerCallableId)?.node_id;
    const writes = writesWithin(flow.target).filter((node) =>
      sourceRangesEqual(node.identity.source_range, flow.target),
    );
    const reads = expressions.has(javascriptSourceRangeKey(flow.source))
      ? []
      : readsWithin(flow.source).filter(
          (node) => node.function_node_id === owner,
        );
    // Compound assignments consume the previous value as well as the RHS.
    if (flow.operator !== "=")
      reads.push(
        ...readsWithin(flow.target).filter((node) =>
          sourceRangesEqual(node.identity.source_range, flow.target),
        ),
      );
    for (const write of writes) {
      for (const read of reads)
        addSemanticGraphRelation(context.state, {
          source: read,
          target: write,
          relation: "defines",
          resolution:
            sourceRangesEqual(read.identity.source_range, flow.target) ||
            (flow.sourceIsReference &&
              sourceRangesEqual(read.identity.source_range, flow.source) &&
              !["&&=", "||=", "??="].includes(flow.operator))
              ? "resolved"
              : "candidate",
          properties: { assignment_operator: flow.operator },
        });
      if (reads.length > 0)
        addSemanticGraphUnknown(context.state, {
          node_id: write.node_id,
          family: "data-flow",
          relation_kinds: ["defines"],
          reason: "unknown-value",
          detail:
            "Assignment inputs may influence this write; execution order, branch selection and the resulting value are not established.",
          candidate_node_ids: [],
          evidence: unknownSemanticEvidence(context.file, flow.target),
        });
    }
  }
}

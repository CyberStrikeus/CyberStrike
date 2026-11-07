import {
  compareJavaScriptSourcePoints,
  javascriptSourceRangeContains,
  javascriptSourceRangeKey,
} from "../../domain/javascript/javascriptSourceCoordinates.js";
import type { JavaScriptSourceRange } from "../../domain/javascript/javascriptStaticAnalysisTypes.js";
import type { JavaScriptSemanticGraphNode } from "../../domain/javascript/javascriptSemanticGraphSchemas.js";
import { compositeKey } from "../../domain/unicodeCodePointOrder.js";
import type { SemanticFlowProjectionContext } from "./JavaScriptSemanticGraphFlowProjection.js";
import {
  addSemanticGraphRelation,
  addSemanticGraphUnknown,
  retainSemanticGraphNode,
} from "./JavaScriptSemanticGraphConstruction.js";
import { unknownSemanticEvidence } from "./JavaScriptSemanticGraphEvidence.js";

const sameArtifact = (
  node: JavaScriptSemanticGraphNode,
  context: SemanticFlowProjectionContext,
): boolean =>
  node.identity.module_path === context.file.path &&
  node.identity.artifact_sha256 === context.file.sha256;

const literalValueKey = (value: string | number | boolean | null): string =>
  `${typeof value}:${JSON.stringify(value)}`;

type IndexedOperatorLiteral = {
  readonly node: JavaScriptSemanticGraphNode;
  readonly range: JavaScriptSourceRange;
  readonly order: number;
};

/**
 * Literals are remembered by their own source range and value.
 * An initializer that merely contains another occurrence, including a
 * nested function body, does not reuse the declaration's literal.
 */
const operatorLiteralIndex = (
  context: SemanticFlowProjectionContext,
): {
  remember(
    node: JavaScriptSemanticGraphNode | null,
  ): JavaScriptSemanticGraphNode | null;
  find(
    value: string | number | boolean | null,
    location: JavaScriptSourceRange,
  ): JavaScriptSemanticGraphNode | undefined;
} => {
  const exact = new Map<string, IndexedOperatorLiteral>();
  const byValue = new Map<string, IndexedOperatorLiteral[]>();
  const seen = new Set<string>();
  let order = 0;
  const remember = (
    node: JavaScriptSemanticGraphNode | null,
  ): JavaScriptSemanticGraphNode | null => {
    if (
      node === null ||
      node.kind !== "literal" ||
      !sameArtifact(node, context) ||
      seen.has(node.node_id)
    )
      return node;
    const range = node.identity.source_range;
    const value = node.properties.value;
    if (
      range === null ||
      (typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean" &&
        value !== null)
    )
      return node;
    seen.add(node.node_id);
    const entry = { node, range, order: order++ };
    const valueKey = literalValueKey(value);
    const id = compositeKey([valueKey, javascriptSourceRangeKey(range)]);
    const group = byValue.get(valueKey) ?? [];
    group.push(entry);
    byValue.set(valueKey, group);
    if (!exact.has(id)) exact.set(id, entry);
    return node;
  };
  for (const node of context.state.nodes.values()) remember(node);
  return {
    remember,
    find(value, location) {
      const valueKey = literalValueKey(value);
      const operandKey = javascriptSourceRangeKey(location);
      let best: IndexedOperatorLiteral | undefined;
      const consider = (entry: IndexedOperatorLiteral | undefined): void => {
        if (
          entry !== undefined &&
          (best === undefined || entry.order < best.order)
        )
          best = entry;
      };
      consider(exact.get(compositeKey([valueKey, operandKey])));
      const group = byValue.get(valueKey) ?? [];
      let low = 0;
      let high = group.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        const entry = group[middle];
        if (
          entry !== undefined &&
          compareJavaScriptSourcePoints(entry.range.start, location.start) <= 0
        )
          low = middle + 1;
        else high = middle;
      }
      const candidate = group[low - 1];
      if (
        candidate !== undefined &&
        javascriptSourceRangeContains(candidate.range, location)
      )
        consider(candidate);
      return best?.node;
    },
  };
};

/** Project immediate operator dependencies without treating them as aliases. */
export function* projectSemanticExpressionInfluence(
  context: SemanticFlowProjectionContext & {
    readonly argumentNodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>;
  },
): Generator<void, void> {
  if (context.ir.expressionFlowsTruncated)
    context.state.fileNodesDropped = true;
  const key = javascriptSourceRangeKey;
  const expressions = new Map<string, JavaScriptSemanticGraphNode>();
  const usedExpressions = new Set<string>();
  const reads = new Map(
    context.readNodes.flatMap((node) =>
      node.identity.source_range === null
        ? []
        : [[key(node.identity.source_range), node] as const],
    ),
  );
  const writes = new Map(
    context.writeNodes.flatMap((node) =>
      node.identity.source_range === null
        ? []
        : [[key(node.identity.source_range), node] as const],
    ),
  );
  const bindings = new Map(
    context.ir.bindings.flatMap((binding) => {
      const node = context.bindingNodes.get(binding.bindingId);
      return node === undefined
        ? []
        : binding.definitions.map(
            (definition) => [key(definition.location), node] as const,
          );
    }),
  );
  for (const [index, flow] of context.ir.expressionFlows.entries()) {
    if (index % 64 === 0) yield;
    const owner =
      flow.ownerCallableId === null
        ? null
        : (context.callableNodes.get(flow.ownerCallableId)?.node_id ?? null);
    const node = retainSemanticGraphNode(context.state, context.file, {
      kind: "expression",
      roleKey: `operator:${index}`,
      location: flow.location,
      label: flow.operator,
      functionNodeId: owner,
      properties: { operator: flow.operator },
    });
    if (node !== null) expressions.set(key(flow.location), node);
  }
  const remainingUnknowns =
    context.state.unknownCapacity === null
      ? context.readNodes.length
      : Math.max(
          0,
          context.state.unknownCapacity - context.state.unknowns.size,
        );
  let unsupportedReads = 0;
  let unsupportedOverflow = false;
  const orderedReads = context.readNodes
    .flatMap((node) =>
      node.identity.source_range === null
        ? []
        : [{ node, location: node.identity.source_range }],
    )
    .sort((left, right) =>
      compareJavaScriptSourcePoints(left.location.start, right.location.start),
    );
  let processedOperands = 0;
  let processedReferences = 0;
  const literals = operatorLiteralIndex(context);
  for (const [index, flow] of context.ir.expressionFlows.entries()) {
    if (index % 64 === 0) yield;
    const result = expressions.get(key(flow.location));
    for (const operand of flow.operands) {
      if (processedOperands % 64 === 0) yield;
      processedOperands += 1;
      if (operand.kind === "unsupported") {
        if (result !== undefined)
          addSemanticGraphUnknown(context.state, {
            node_id: result.node_id,
            family: "data-flow",
            relation_kinds: ["influences"],
            reason: "unknown-value",
            detail: "An operator operand has unmodeled value dependencies.",
            candidate_node_ids: [],
            evidence: unknownSemanticEvidence(context.file, operand.location),
          });
        if (!unsupportedOverflow) {
          let low = 0,
            high = orderedReads.length;
          while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (
              compareJavaScriptSourcePoints(
                orderedReads[middle]!.location.start,
                operand.location.start,
              ) < 0
            )
              low = middle + 1;
            else high = middle;
          }
          for (let offset = low; offset < orderedReads.length; offset++) {
            const { node: reference, location } = orderedReads[offset]!;
            if (
              compareJavaScriptSourcePoints(
                location.start,
                operand.location.end,
              ) > 0
            )
              break;
            if (processedReferences % 64 === 0) yield;
            processedReferences += 1;
            if (processedReferences > remainingUnknowns) {
              unsupportedOverflow = true;
              break;
            }
            if (
              !javascriptSourceRangeContains(operand.location, location) ||
              reference.function_node_id !== result?.function_node_id
            )
              continue;
            if (unsupportedReads >= remainingUnknowns) {
              unsupportedOverflow = true;
              break;
            }
            unsupportedReads += 1;
            addSemanticGraphUnknown(context.state, {
              node_id: reference.node_id,
              family: "data-flow",
              relation_kinds: ["influences"],
              reason: "unknown-value",
              detail:
                "This read occurs inside an unmodeled operator operand; its influence on the result is unknown.",
              candidate_node_ids: [],
              evidence: unknownSemanticEvidence(context.file, operand.location),
            });
          }
        }
        continue;
      }
      const source =
        operand.kind === "reference"
          ? reads.get(key(operand.location))
          : operand.kind === "expression"
            ? expressions.get(key(operand.location))
            : (literals.find(operand.literal ?? null, operand.location) ??
              literals.remember(
                retainSemanticGraphNode(context.state, context.file, {
                  kind: "literal",
                  roleKey: `operator-literal:${key(operand.location)}:${JSON.stringify(operand.literal ?? null)}`,
                  location: operand.location,
                  label: "operator literal",
                  functionNodeId: result?.function_node_id ?? null,
                  properties: { value: operand.literal ?? null },
                }) ?? null,
              ));
      if (
        operand.kind === "expression" &&
        source !== undefined &&
        result !== undefined
      )
        usedExpressions.add(key(operand.location));
      addSemanticGraphRelation(context.state, {
        source,
        target: result,
        relation: "influences",
        resolution: "resolved",
        properties: { conditional: operand.conditional },
      });
    }
  }
  // Some operands are calls, members or other constructs whose value owner is
  // not yet modeled here. Do not claim complete influence for any query that
  // may cross one of these unmodeled operator inputs.
  if (unsupportedOverflow)
    addSemanticGraphUnknown(context.state, {
      node_id: null,
      family: "data-flow",
      relation_kinds: ["influences"],
      reason: "resource-limit",
      detail:
        "The bounded operator-dependency audit omitted some unmodeled operand reads; influence through them remains unknown.",
      candidate_node_ids: [],
      evidence: unknownSemanticEvidence(context.file, null),
    });
  const connect = (
    source: JavaScriptSemanticGraphNode | undefined,
    target: JavaScriptSemanticGraphNode | undefined,
    conditional = false,
  ) => {
    if (
      source !== undefined &&
      target !== undefined &&
      source.identity.source_range !== null &&
      expressions.get(key(source.identity.source_range)) === source
    )
      usedExpressions.add(key(source.identity.source_range));
    addSemanticGraphRelation(context.state, {
      source,
      target,
      relation: "influences",
      resolution: "resolved",
      properties: { conditional },
    });
  };
  for (const flow of context.ir.initializerFlows)
    connect(expressions.get(key(flow.source)), bindings.get(key(flow.target)));
  for (const flow of context.ir.assignmentFlows) {
    const source = expressions.get(key(flow.source));
    const target = writes.get(key(flow.target));
    if (source !== undefined && target !== undefined)
      usedExpressions.add(key(flow.source));
    addSemanticGraphRelation(context.state, {
      source,
      target,
      relation: "influences",
      resolution: "resolved",
      properties: {
        conditional: ["&&=", "||=", "??="].includes(flow.operator),
        assignment_operator: flow.operator,
      },
    });
  }
  for (const call of context.ir.callSites)
    for (const argument of call.arguments) {
      if (argument.valueExpressionLocation === null) continue;
      connect(
        expressions.get(key(argument.valueExpressionLocation)),
        context.argumentNodes.get(
          `${call.callSiteId}\u0000${String(argument.index)}`,
        ),
      );
    }
  const literalReturns = new Map(
    context.ir.literalReturns.map((item) => [key(item.location), item]),
  );
  for (const callable of context.ir.callables)
    for (const site of callable.returnSites) {
      if (site.valueExpressionLocation !== null) {
        const target = context.returnSiteNodes.get(site.returnSiteId);
        connect(expressions.get(key(site.valueExpressionLocation)), target);
        const literal = literalReturns.get(key(site.valueExpressionLocation));
        if (literal !== undefined) {
          const source = retainSemanticGraphNode(context.state, context.file, {
            kind: "literal",
            roleKey: `return-literal:${site.returnSiteId}`,
            location: literal.location,
            label: "return literal",
            functionNodeId: target?.function_node_id ?? null,
            properties: { value: literal.value },
          });
          addSemanticGraphRelation(context.state, {
            source,
            target,
            relation: "aliases",
            resolution: "resolved",
          });
        }
      }
    }
  for (const flow of context.ir.expressionFlows) {
    const node = expressions.get(key(flow.location));
    if (node === undefined || usedExpressions.has(key(flow.location))) continue;
    addSemanticGraphUnknown(context.state, {
      node_id: node.node_id,
      family: "data-flow",
      relation_kinds: ["influences"],
      reason: "unknown-value",
      detail:
        "The receiving expression or container for this operator result is not modeled; further influence is unknown.",
      candidate_node_ids: [],
      evidence: unknownSemanticEvidence(context.file, flow.location),
    });
  }
}

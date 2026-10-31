import * as t from "@babel/types";

import {
  semanticContainer,
  semanticPropertyPointer,
} from "./javascriptSemanticSlots.js";

import type {
  JavaScriptSemanticBinding,
  JavaScriptSemanticCallable,
  JavaScriptSemanticModuleLink,
  JavaScriptSemanticReturnSite,
} from "./javascriptSemanticIr.js";
import type { JavaScriptSemanticValue } from "./javascriptSemanticValueTypes.js";
import type {
  ProjectedPropertyCoverage,
  ProjectedReturnField,
} from "./javascriptExportShapeComparisonSchemas.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import { semanticCallableIdForNode } from "./javascriptSemanticProjection.js";
import { unwrapJavaScriptExpression } from "./javascriptAstValues.js";
import {
  resolveSemanticBindingState,
  type JavaScriptSemanticAnalysisState,
  type JavaScriptSemanticBindingState,
} from "./javascriptSemanticState.js";
import { evaluateSemanticExpression } from "./javascriptSemanticValues.js";
import { range } from "./javascriptStaticAnalysisHelpers.js";
import { semanticReturnCoverage } from "./javascriptSemanticCoverage.js";
import { semanticCallableResultExpressions } from "./javascriptSemanticCallableResults.js";
import { semanticBindingAtRead } from "./javascriptSemanticMutationInitializers.js";

interface ReturnExpression {
  readonly node: t.Node | null;
  readonly location: JavaScriptSemanticReturnSite["location"];
}

/** Evaluate direct returns while excluding every nested callable. */
export const collectSemanticReturns = (
  state: JavaScriptSemanticAnalysisState,
  parserPartial: boolean,
): JavaScriptSemanticCallable[] => {
  return state.callables.map((callable) => {
    const node = state.callableNodesById.get(callable.callableId);
    if (node === undefined)
      return {
        ...callable,
        returnCoverage: {
          status: "partial" as const,
          retainedCount: 0,
          omittedCount: null,
        },
      };
    const expressions = directReturnExpressions(node);
    const sites: JavaScriptSemanticReturnSite[] = [];
    for (const expression of expressions) {
      const returned =
        expression.node === null
          ? null
          : unwrapJavaScriptExpression(expression.node).node;
      sites.push({
        returnSiteId: semanticReturnSiteId(
          callable.callableId,
          expression.location,
        ),
        location: expression.location,
        identityReferenceLocation:
          returned !== null && t.isIdentifier(returned)
            ? range(returned)
            : null,
        valueExpressionLocation: returned === null ? null : range(returned),
        value:
          expression.node === null
            ? { status: "unknown", reason: "Return has no value." }
            : evaluateSemanticExpression(expression.node, state),
      });
    }
    return {
      ...callable,
      returnSites: sites,
      returnCoverage: semanticReturnCoverage(sites.length, parserPartial),
    };
  });
};

const semanticReturnSiteId = (
  callableId: string,
  location: JavaScriptSemanticReturnSite["location"],
): string =>
  [
    callableId,
    "return",
    String(location.start.line),
    String(location.start.column),
    String(location.end.line),
    String(location.end.column),
  ].join(":");

/** Finalize exported bindings only when lexical resolution is unique and exact. */
export const resolveSemanticModuleCallables = (
  state: JavaScriptSemanticAnalysisState,
  callables: readonly JavaScriptSemanticCallable[],
  bindings: readonly JavaScriptSemanticBinding[],
): JavaScriptSemanticModuleLink[] => {
  const callableIds = new Set(callables.map(({ callableId }) => callableId));
  const provenanceByBinding = new Map(
    bindings.map(({ bindingId, provenance }) => [bindingId, provenance]),
  );
  return state.moduleLinks.map((link) => {
    if (link.kind === "type-import") return { ...link, callableId: null };
    // Named exports follow their lexical binding, including every assignment.
    // A declaration's ID or a callable's display name cannot prove that link.
    const captured = state.defaultExportExpressions.get(link);
    if (link.localName === null && captured === undefined)
      return link.callableId !== null && callableIds.has(link.callableId)
        ? link
        : { ...link, callableId: null };
    const binding = state.moduleLinkBindings.get(link);
    const resolved =
      captured !== undefined
        ? callableIdsForNode(captured, state, callableIds, new Set(), true)
        : binding === undefined
          ? []
          : callableIdsForBinding(binding, state, callableIds, new Set());
    const provenance =
      binding === undefined || link.specifier !== null
        ? undefined
        : provenanceByBinding.get(binding.bindingId);
    const resolutionMode =
      provenance?.status === "module"
        ? provenance.origins[0].resolutionMode
        : undefined;
    return {
      ...link,
      ...(resolutionMode !== undefined ? { resolutionMode } : {}),
      callableId: resolved.length === 1 ? (resolved[0] ?? null) : null,
    };
  });
};

const directReturnExpressions = (callable: t.Node): ReturnExpression[] =>
  semanticCallableResultExpressions(callable)
    .filter(({ kind }) => kind === "return")
    .map(({ node, site }) => ({ node, location: range(site) }));

const callableIdsForBinding = (
  binding: JavaScriptSemanticBindingState,
  state: JavaScriptSemanticAnalysisState,
  admitted: ReadonlySet<string>,
  seen: ReadonlySet<string>,
  read?: t.Node,
): string[] => {
  // A single initializer does not prove an assignment executes or replace
  // the unknown incoming value of a parameter/catch binding.
  if (
    seen.has(binding.bindingId) ||
    (read === undefined && binding.initializers.length !== 1) ||
    binding.definitions.some(
      ({ kind }) =>
        (read === undefined && kind === "assignment") ||
        kind === "parameter" ||
        kind === "catch",
    )
  )
    return [];
  const selected =
    read === undefined
      ? binding
      : semanticBindingAtRead(binding, read, state.parentsByNode).binding;
  const initializer = selected.initializers[0];
  if (
    initializer === undefined ||
    selected.initializers.length !== 1 ||
    initializer.projection.length > 0 ||
    state.conditionallySkippedExpressions.has(initializer.node)
  )
    return [];
  return callableIdsForNode(
    initializer.node,
    state,
    admitted,
    new Set([...seen, binding.bindingId]),
    read !== undefined,
  );
};

const callableIdsForNode = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
  admitted: ReadonlySet<string>,
  seen: ReadonlySet<string>,
  snapshot = false,
): string[] => {
  const unwrapped = unwrapJavaScriptExpression(node).node;
  if (unwrapped !== node)
    return callableIdsForNode(unwrapped, state, admitted, seen, snapshot);
  const direct = semanticCallableIdForNode(node);
  if (direct !== null && admitted.has(direct)) return [direct];
  if (t.isIdentifier(node)) {
    const binding = resolveSemanticBindingState(state, node, node.name);
    return binding === undefined
      ? []
      : callableIdsForBinding(
          binding,
          state,
          admitted,
          seen,
          snapshot ? node : undefined,
        );
  }
  return [];
};

/** Flatten a semantic value to bounded JSON-pointer leaves for graph projection. */
export const flattenSemanticReturnValue = (
  value: JavaScriptSemanticValue,
): {
  readonly fields: readonly ProjectedReturnField[];
  readonly propertyCoverage: readonly ProjectedPropertyCoverage[];
} => {
  const fields: ProjectedReturnField[] = [];
  const propertyCoverage: ProjectedPropertyCoverage[] = [];
  flattenValue(value, "", fields, propertyCoverage);
  fields.sort((left, right) => compareUnicodeCodePoints(left.path, right.path));
  propertyCoverage.sort((left, right) =>
    compareUnicodeCodePoints(left.path, right.path),
  );
  return { fields, propertyCoverage };
};

const flattenValue = (
  value: JavaScriptSemanticValue,
  path: string,
  fields: ProjectedReturnField[],
  coverage: ProjectedPropertyCoverage[],
  presence: "present" | "absent" | "unknown-coverage" = "present",
): void => {
  if (presence !== "present") {
    fields.push({
      path,
      presence,
      state: "unknown",
      value: null,
      reason:
        "reason" in value ? value.reason : "Property presence is uncertain.",
    });
    return;
  }
  if (value.status === "literal") {
    fields.push({
      path,
      presence,
      state: "literal",
      value: value.value,
      reason: null,
    });
    return;
  }
  if (value.status === "union") {
    fields.push({
      path,
      presence,
      state: "union",
      value: [...value.values],
      reason: null,
    });
    return;
  }
  if ("reason" in value) {
    fields.push({
      path,
      presence,
      state: "unknown",
      value: null,
      reason: value.reason,
    });
    return;
  }
  const container = semanticContainer(value);
  coverage.push({ path, ...container.coverage });
  for (const slot of container.slots)
    flattenValue(
      slot.value,
      `${path}${semanticPropertyPointer([slot.name])}`,
      fields,
      coverage,
      slot.presence,
    );
};

import type * as t from "@babel/types";

/** A lexical substitution environment, never a JavaScript execution context. */
export interface SymbolicEnvironment {
  readonly values: ReadonlyMap<string, SymbolicValue>;
  readonly parent?: SymbolicEnvironment;
  /** Stable activation identity, shared by its completed views. */
  readonly activation?: object;
  /** Known synchronous caller, distinct from lexical capture. */
  readonly caller?: SymbolicEnvironment;
  /** Source point at which the current function is being symbolically executed. */
  readonly point?: t.Node;
  /** Lexical function scope for point-sensitive local initializer checks. */
  readonly scopeId?: string;
  /** Function activation captured by this environment, when one exists. */
  readonly scopeNode?: t.Function;
  /** Completion boundary proven for this captured activation. */
  readonly completedAt?: t.Node;
  /** Shared completion facts must remain unchanged through this later exit. */
  readonly commonThrough?: t.Node;
}

export interface SymbolicCondition {
  readonly node: t.Node;
  readonly positive: boolean | "nullish" | "not-nullish";
}

export interface SymbolicMetadata {
  /** Predicates required for this value to be selected. */
  readonly conditions?: readonly SymbolicCondition[];
  /** A control-flow join prevented a sound predicate from being retained. */
  readonly conditionUnresolved?: true;
}

export interface SymbolicFunction extends SymbolicMetadata {
  readonly kind: "function";
  readonly node: t.Function;
  readonly environment: SymbolicEnvironment;
  readonly origins: readonly t.Node[];
  /** Return statement completing the activation that produced this value. */
  readonly returnPoint?: t.Node;
}

export type SymbolicValue = (
  | { readonly kind: "unknown"; readonly reason: string }
  | {
      readonly kind: "literal";
      readonly value: string | number | boolean | null | undefined;
    }
  | { readonly kind: "external"; readonly path: readonly string[] }
  | {
      readonly kind: "object";
      readonly node: t.ObjectExpression;
      readonly environment: SymbolicEnvironment;
    }
  | {
      readonly kind: "namespace";
      readonly bindingId: string;
      readonly environment: SymbolicEnvironment;
      /** Namespace identity does not establish the mutable root's runtime value. */
      readonly runtimeValueUnknown?: true;
    }
  | {
      readonly kind: "loader";
      readonly modules: ReadonlyMap<string, SymbolicValue>;
    }
  | { readonly kind: "array"; readonly values: readonly SymbolicValue[] }
  | {
      readonly kind: "record";
      readonly values: ReadonlyMap<string, SymbolicValue>;
    }
  | { readonly kind: "union"; readonly values: readonly SymbolicValue[] }
  | { readonly kind: "iterator" }
  | {
      readonly kind: "promise";
      readonly value: SymbolicValue;
      readonly returnPoint?: t.Node;
    }
  | SymbolicFunction
) &
  SymbolicMetadata;

export const symbolicUnknown = (reason: string): SymbolicValue => ({
  kind: "unknown",
  reason,
});
export const symbolicVariants = (
  value: SymbolicValue,
): readonly SymbolicValue[] =>
  value.kind === "union" ? value.values : [value];
export const symbolicUnion = (
  values: readonly SymbolicValue[],
): SymbolicValue => {
  const unique = [...new Set(values.flatMap(symbolicVariants))];
  return unique.length === 1 ? unique[0]! : { kind: "union", values: unique };
};
export const symbolicTruth = (value: SymbolicValue): boolean | undefined => {
  if (value.kind === "namespace" && value.runtimeValueUnknown) return undefined;
  if (value.kind === "union") {
    const choices = value.values.map(symbolicTruth);
    return choices.length > 0 &&
      choices.every((choice) => choice === choices[0])
      ? choices[0]
      : undefined;
  }
  return value.kind === "literal"
    ? Boolean(value.value)
    : [
          "function",
          "object",
          "namespace",
          "array",
          "record",
          "loader",
          "promise",
          "iterator",
        ].includes(value.kind)
      ? true
      : undefined;
};

/** Attach selection predicates to values while preserving their representation. */
export const symbolicCondition = (
  value: SymbolicValue,
  condition: SymbolicCondition,
): SymbolicValue => {
  if (value.kind === "union")
    return symbolicUnion(
      value.values.map((variant) => symbolicCondition(variant, condition)),
    );
  return { ...value, conditions: [...(value.conditions ?? []), condition] };
};

export const symbolicConditionsUnresolved = (
  value: SymbolicValue,
): SymbolicValue => {
  if (value.kind === "union")
    return symbolicUnion(value.values.map(symbolicConditionsUnresolved));
  return { ...value, conditionUnresolved: true };
};

import type * as t from "@babel/types";
import type { JavaScriptSemanticPropertyPath } from "./javascriptSemanticPropertyPaths.js";

/** Shared shape of an iterator or property-read source. */
export interface IterationSourceValue {
  readonly node: t.Node;
  readonly projection: JavaScriptSemanticPropertyPath;
  readonly iterationSources?: readonly IterationSourceValue[];
}

/** An iterator receiver or property reference store, with default guards. */
export interface SemanticIterationSource extends IterationSourceValue {
  readonly iterationSources?: readonly IterationSourceValue[];
  readonly kind: "iteration" | "reference-store";
  readonly mutation: t.Node;
  readonly target?: t.MemberExpression;
  readonly fallbackSources?: readonly IterationSourceValue[];
  readonly requiredSources?: readonly IterationSourceValue[];
}

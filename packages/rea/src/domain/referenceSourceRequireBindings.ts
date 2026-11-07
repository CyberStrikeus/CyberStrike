import * as t from "@babel/types";
import { posix } from "node:path";

import { semanticStaticPropertyKey } from "./javascript/javascriptAstValues.js";
import { isUnmodifiedGlobalReference } from "./javascript/javascriptSemanticAmbientWrites.js";
import {
  indexJavaScriptBindingsWithReceiversSteps,
  type JavaScriptReceiverIndex,
} from "./javascript/javascriptSemanticAnalysis.js";
import type { JavaScriptSemanticAnalysisState } from "./javascript/javascriptSemanticState.js";
import {
  semanticRequireCallAt,
  semanticRequireLoaderAt,
  type JavaScriptRequireCallFact,
} from "./javascript/javascriptSemanticRequireOrigin.js";
import {
  completeSemanticSteps,
  traverseJavaScriptAst,
} from "./javascript/javascriptSemanticTraversal.js";
import {
  javaScriptRuntimeContext,
  type ParsedJavaScriptSource,
} from "./javascript/javascriptSourceParser.js";

export type ReferenceSourceRequireResolutionBase =
  | "source-file"
  | { readonly kind: "source-relative-file"; readonly path: string }
  | "unknown";

export interface ReferenceSourceRequireCall {
  readonly arguments: JavaScriptRequireCallFact["arguments"];
  readonly resolutionBase: ReferenceSourceRequireResolutionBase;
  readonly limitation?: string;
}

/** Identify exact calls through a source-owned Node loader and their resolver base. */
export const referenceSourceRequireCalls = (
  file: Pick<ParsedJavaScriptSource, "program">,
  path: string,
): ReadonlyMap<
  t.CallExpression | t.OptionalCallExpression,
  ReferenceSourceRequireCall
> => {
  // Unmarked paths depend on package scope or compiler options. Preserve their
  // candidate CommonJS edges; explicit module paths have no wrapper loader.
  const runtimeContext = javaScriptRuntimeContext(file.program);
  const index = completeSemanticSteps(
    indexJavaScriptBindingsWithReceiversSteps(
      file.program,
      runtimeContext === "module" ? undefined : "commonjs-wrapper",
    ),
  );
  const factoryBindings: ReadonlySet<string> = new Set();
  const candidates: {
    readonly call: t.CallExpression | t.OptionalCallExpression;
    readonly identifier: t.Identifier;
    readonly arguments: JavaScriptRequireCallFact["arguments"];
    readonly resolutionBase: ReferenceSourceRequireResolutionBase;
    readonly limitation?: string;
  }[] = [];
  traverseJavaScriptAst(file.program, {
    enter: (node) => {
      if (!t.isCallExpression(node) && !t.isOptionalCallExpression(node))
        return;
      const identifier = callReceiverIdentifier(node.callee);
      if (identifier === undefined) return;
      let fact = semanticRequireLoaderAt(node, index.bindings, factoryBindings);
      if (fact === "create-require") {
        // Definitions identify a possible factory. Its mutable member reads
        // need the shared write index before they can prove an association.
        completeSemanticSteps(index.indexMemberMutationFactsSteps());
        fact = semanticRequireLoaderAt(node, index.bindings, factoryBindings);
      }
      const callFact = semanticRequireCallAt(
        node,
        index.bindings,
        factoryBindings,
      );
      if (callFact === undefined || callFact.loader === "local") return;
      if (fact !== "create-require" && fact !== "commonjs-loader") return;
      const sourceRelativePath = callFact.sourceRelativePath;
      const normalizedSourceRelativePath =
        sourceRelativePath === undefined
          ? undefined
          : posix.normalize(
              posix.join(posix.dirname(path), sourceRelativePath),
            );
      const base: ReferenceSourceRequireResolutionBase =
        runtimeContext === "unknown"
          ? "unknown"
          : callFact.loader === "create-require"
            ? sourceRelativePath === undefined
              ? callFact.sourceRelative === true
                ? "source-file"
                : "unknown"
              : normalizedSourceRelativePath === undefined ||
                  normalizedSourceRelativePath === ".." ||
                  normalizedSourceRelativePath.startsWith("../")
                ? "unknown"
                : normalizedSourceRelativePath === path
                  ? "source-file"
                  : {
                      kind: "source-relative-file",
                      path: normalizedSourceRelativePath,
                    }
            : fact === "commonjs-loader" &&
                callFact.loader === "commonjs-loader" &&
                runtimeContext === "commonjs"
              ? "source-file"
              : "unknown";
      const searchBase = requireResolveSearchBase(
        callFact.operation,
        callFact.arguments,
        index.bindings,
        base,
        runtimeContext === "commonjs",
      );
      candidates.push({
        call: node,
        identifier,
        arguments: callFact.arguments,
        resolutionBase: searchBase,
        ...(runtimeContext === "unknown"
          ? {
              limitation: `Module context is unknown in ${path}; the requested dependency was retained without a proven loader base.`,
            }
          : {}),
      });
    },
  });
  if (candidates.some(({ call }) => !t.isIdentifier(call.callee)))
    completeSemanticSteps(index.indexMemberMutationFactsSteps());
  return new Map(
    candidates.map(
      ({
        call,
        identifier,
        arguments: callArguments,
        resolutionBase,
        limitation,
      }) =>
        [
          call,
          {
            arguments: callArguments,
            ...(limitation === undefined ? {} : { limitation }),
            resolutionBase:
              !t.isIdentifier(call.callee) &&
              hasPriorMemberMutation(index, call, identifier)
                ? "unknown"
                : resolutionBase,
          },
        ] as const,
    ),
  );
};

/** `require.resolve` options replace the default search paths unless exact current-directory paths are supplied. */
const requireResolveSearchBase = (
  operation: JavaScriptRequireCallFact["operation"],
  callArguments: JavaScriptRequireCallFact["arguments"],
  bindings: JavaScriptSemanticAnalysisState,
  loaderBase: ReferenceSourceRequireResolutionBase,
  hasCommonJsWrapper: boolean,
): ReferenceSourceRequireResolutionBase => {
  const arguments_ = callArguments ?? [];
  if (operation !== "resolve" || arguments_.length < 2) return loaderBase;
  if (arguments_.length !== 2) return "unknown";
  const options = t.isExpression(arguments_[1]) ? arguments_[1] : undefined;
  if (options === undefined || !t.isObjectExpression(options)) return "unknown";
  if (options.properties.length === 0) return loaderBase;
  if (options.properties.length !== 1) return "unknown";
  const property = options.properties[0];
  if (!t.isObjectProperty(property)) return "unknown";
  if (semanticStaticPropertyKey(property.key, property.computed) !== "paths")
    return "unknown";
  const value = t.isExpression(property.value) ? property.value : undefined;
  if (!t.isArrayExpression(value) || value.elements.length !== 1)
    return "unknown";
  const directory = value.elements[0];
  return hasCommonJsWrapper &&
    t.isIdentifier(directory, { name: "__dirname" }) &&
    isUnmodifiedGlobalReference(directory, bindings, "__dirname")
    ? "source-file"
    : "unknown";
};

const hasPriorMemberMutation = (
  index: JavaScriptReceiverIndex,
  site: t.CallExpression | t.OptionalCallExpression,
  identifier: t.Identifier,
): boolean => {
  const callee = site.callee;
  const property =
    t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)
      ? semanticStaticPropertyKey(callee.property, callee.computed)
      : undefined;
  if (property === undefined || property === null) return true;
  const facts = index.effectsForReferenceAt(site, identifier, [property]);
  return (
    !facts.memberEffectsIndexed ||
    facts.effects.some(
      ({ kind, timing }) =>
        (kind === "member-write" || kind === "escape") && timing !== "after",
    )
  );
};

const callReceiverIdentifier = (
  callee: t.Node | null | undefined,
): t.Identifier | undefined => {
  if (t.isIdentifier(callee)) return callee;
  if (
    (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
    t.isIdentifier(callee.object)
  )
    return callee.object;
  return undefined;
};

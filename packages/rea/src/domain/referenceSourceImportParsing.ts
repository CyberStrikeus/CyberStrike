import type {
  CallExpression,
  File,
  OptionalCallExpression,
  Node,
} from "@babel/types";
import { traverseJavaScriptAst } from "./javascript/javascriptSemanticTraversal.js";
import { readExactJavaScriptLiteral } from "./javascript/javascriptAstValues.js";
import {
  parseRecoveredJavaScript,
  parserPluginsForPath,
  type JavaScriptPackageType,
} from "./javascript/javascriptSourceParser.js";
import {
  referenceSourceRequireCalls,
  type ReferenceSourceRequireCall,
} from "./referenceSourceRequireBindings.js";
import { isRelativeJavaScriptModuleSpecifier } from "./javascript/javascriptModuleSpecifier.js";
import {
  isCallExpression,
  isExportAllDeclaration,
  isExportNamedDeclaration,
  isImportDeclaration,
  isImportExpression,
  isOptionalCallExpression,
  isTSImportType,
  isStringLiteral,
  isTSExternalModuleReference,
  isTSImportEqualsDeclaration,
  isTSModuleDeclaration,
} from "@babel/types";

type ReferenceSourceImportKind =
  | "imports"
  | "requires"
  | "references"
  | "declares-module";

type ReferenceSourceImportResolution =
  | "internal"
  | "external"
  | "unresolved"
  | "unknown";

type ReferenceSourceImportParseState = "parsed" | "partial" | "unknown";

interface ReferenceSourceImportRelationship {
  readonly from_path: string;
  readonly to: string;
  readonly kind: ReferenceSourceImportKind;
  readonly resolution: ReferenceSourceImportResolution;
  readonly parse_state: ReferenceSourceImportParseState;
  /** Distinguishes call-form CommonJS require from TS import-equals `requires`. */
  readonly resolutionStrategy?: "runtime-require";
  /** Internal lookup origin for a proven createRequire URL base. */
  readonly resolutionBasePath?: string;
}

interface ReferenceSourceParseFailure {
  readonly path: string;
  readonly parser: string;
  readonly reason: string;
}

export interface ReferenceSourceImportParseResult {
  readonly relationships: readonly ReferenceSourceImportRelationship[];
  readonly parse_failures: readonly ReferenceSourceParseFailure[];
  readonly limitations: readonly string[];
}

export const PARSEABLE_REFERENCE_SOURCE_LANGUAGES: ReadonlySet<string> =
  new Set(["JavaScript", "TypeScript", "JSX", "TSX"]);

const safeModuleName = (node: Node | null | undefined): string | undefined => {
  if (isStringLiteral(node)) return node.value;
  return undefined;
};

const exactStringModuleName = (
  node: Node | null | undefined,
): string | undefined => {
  if (node === null || node === undefined) return undefined;
  const literal = readExactJavaScriptLiteral(node);
  return literal.found && typeof literal.value === "string"
    ? literal.value
    : undefined;
};

const resolveSpecifier = (
  specifier: string,
): ReferenceSourceImportResolution => {
  if (
    isRelativeJavaScriptModuleSpecifier(specifier) ||
    specifier.startsWith("/")
  )
    return "internal";
  return "external";
};

const appendRelationship = (
  relationships: ReferenceSourceImportRelationship[],
  limitations: string[],
  input: {
    readonly fromPath: string;
    readonly to: string | undefined;
    readonly kind: ReferenceSourceImportKind;
    readonly parseState: ReferenceSourceImportParseState;
    readonly resolution?: ReferenceSourceImportResolution;
    readonly resolutionStrategy?: "runtime-require";
    readonly resolutionBasePath?: string;
  },
): void => {
  if (input.to === undefined) return;
  if (input.to.length === 0) {
    limitations.push(
      `Empty module specifier in ${input.fromPath} was not recorded as a relationship.`,
    );
    return;
  }
  relationships.push({
    from_path: input.fromPath,
    to: input.to,
    kind: input.kind,
    resolution: input.resolution ?? resolveSpecifier(input.to),
    parse_state: input.parseState,
    ...(input.resolutionStrategy === undefined
      ? {}
      : { resolutionStrategy: input.resolutionStrategy }),
    ...(input.resolutionBasePath === undefined
      ? {}
      : { resolutionBasePath: input.resolutionBasePath }),
  });
};

const appendImportEquals = (
  statement: Node,
  from_path: string,
  relationships: ReferenceSourceImportRelationship[],
  limitations: string[],
): void => {
  if (!isTSImportEqualsDeclaration(statement)) return;
  const reference = statement.moduleReference;
  if (!isTSExternalModuleReference(reference)) return;
  appendRelationship(relationships, limitations, {
    fromPath: from_path,
    to: safeModuleName(reference.expression),
    kind: "requires",
    parseState: "parsed",
  });
};

/** One AST owner retains historical declarations, types and runtime requests. */
const extractImports = (
  ast: File,
  from_path: string,
  relationships: ReferenceSourceImportRelationship[],
  limitations: string[],
  requireCalls: ReadonlyMap<
    CallExpression | OptionalCallExpression,
    ReferenceSourceRequireCall
  >,
): void => {
  traverseJavaScriptAst(ast.program, {
    enter: (node) => {
      if (
        isImportDeclaration(node) ||
        isExportAllDeclaration(node) ||
        (isExportNamedDeclaration(node) && node.source != null)
      ) {
        appendRelationship(relationships, limitations, {
          fromPath: from_path,
          to: safeModuleName(node.source),
          kind: "imports",
          parseState: "parsed",
        });
      } else if (isTSImportEqualsDeclaration(node)) {
        appendImportEquals(node, from_path, relationships, limitations);
      } else if (isTSModuleDeclaration(node)) {
        if (node.declare === true && isStringLiteral(node.id))
          appendRelationship(relationships, limitations, {
            fromPath: from_path,
            to: node.id.value,
            kind: "declares-module",
            parseState: "parsed",
            resolution: "unknown",
          });
      } else if (isImportExpression(node) || isTSImportType(node)) {
        const specifier = exactStringModuleName(node.source);
        appendRelationship(relationships, limitations, {
          fromPath: from_path,
          to: specifier ?? "<dynamic-import>",
          kind: "imports",
          parseState: specifier === undefined ? "partial" : "parsed",
          ...(specifier === undefined ? { resolution: "unknown" } : {}),
        });
      } else if (isCallExpression(node) || isOptionalCallExpression(node)) {
        const requireCall = requireCalls.get(node);
        if (requireCall === undefined) return;
        const specifier = exactStringModuleName(requireCall.arguments?.[0]);
        if (specifier === undefined) return;
        if (
          requireCall.limitation !== undefined &&
          !limitations.includes(requireCall.limitation)
        )
          limitations.push(requireCall.limitation);
        const uncertainResolution = requireCall.resolutionBase === "unknown";
        appendRelationship(relationships, limitations, {
          fromPath: from_path,
          to: specifier,
          kind: "requires",
          parseState: uncertainResolution ? "partial" : "parsed",
          ...(uncertainResolution ? { resolution: "unknown" } : {}),
          ...(uncertainResolution
            ? {}
            : { resolutionStrategy: "runtime-require" as const }),
          ...(typeof requireCall.resolutionBase === "object"
            ? { resolutionBasePath: requireCall.resolutionBase.path }
            : {}),
        });
      }
    },
  });
};

const parseWithBabel = (
  path: string,
  source: string,
  packageType: JavaScriptPackageType | undefined,
): {
  ast: File | undefined;
  reasons: readonly string[];
  moduleOnlyErrors: readonly string[];
} => {
  // The shared parser owns filename precedence and observed package context.
  const plugins = parserPluginsForPath(path);

  try {
    const { file: ast, moduleOnlyErrors } = parseRecoveredJavaScript(
      source,
      path,
      {
        allowImportExportEverywhere: false,
        allowReturnOutsideFunction: true,
        allowUndeclaredExports: true,
        plugins,
      },
      packageType,
    );
    return {
      ast,
      reasons: ast.errors.map((error) => error.message),
      moduleOnlyErrors,
    };
  } catch (cause: unknown) {
    return {
      ast: undefined,
      reasons: [cause instanceof Error ? cause.message : "Parse failed"],
      moduleOnlyErrors: [],
    };
  }
};

/** Parse ESM/CommonJS imports and dynamic imports from source bytes. */
export const parseReferenceSourceImports = (
  path: string,
  bytes: Uint8Array,
  language: string | null,
  packageType?: JavaScriptPackageType,
): ReferenceSourceImportParseResult => {
  if (language !== null && !PARSEABLE_REFERENCE_SOURCE_LANGUAGES.has(language))
    return { relationships: [], parse_failures: [], limitations: [] };

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      relationships: [],
      parse_failures: [
        {
          path,
          parser: "utf-8",
          reason:
            "Source bytes are not valid UTF-8; import targets were not parsed.",
        },
      ],
      limitations: [],
    };
  }
  const { ast, reasons, moduleOnlyErrors } = parseWithBabel(
    path,
    source,
    packageType,
  );
  const limitations =
    moduleOnlyErrors.length === 0
      ? []
      : [
          `Strict-mode errors apply only if this file is an ES module: ${moduleOnlyErrors.join("; ")}`,
        ];
  const parseFailures = reasons.map((reason) => ({
    path,
    parser: "babel",
    reason,
  }));

  if (ast === undefined) {
    return {
      relationships: [],
      parse_failures: parseFailures,
      limitations,
    };
  }

  const relationships: ReferenceSourceImportRelationship[] = [];
  extractImports(
    ast,
    path,
    relationships,
    limitations,
    referenceSourceRequireCalls(ast, path),
  );

  return {
    relationships: relationships.map((relationship) => ({
      ...relationship,
      parse_state:
        parseFailures.length > 0 && relationship.parse_state === "parsed"
          ? "partial"
          : relationship.parse_state,
    })),
    parse_failures: parseFailures,
    limitations,
  };
};

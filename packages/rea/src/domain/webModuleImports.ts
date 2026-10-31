import { isStringLiteral, isTemplateLiteral } from "@babel/types";
import type { Node } from "@babel/types";
import { traverseJavaScriptAst } from "./javascript/javascriptSemanticTraversal.js";
import { parseJavaScriptSource } from "./javascript/javascriptSourceParser.js";
import type { WebModuleImport } from "./webModuleTrace.js";
import type { ExportedWebScript } from "./webScriptExport.js";
import {
  hasUncertainTypeOnlyModuleSideEffect,
  semanticStaticModuleSource,
} from "./javascript/javascriptModuleDeclaration.js";

/** Collect module declarations, omitting whole-statement type-only forms. */
export const collectWebModuleImports = (
  source: string,
  sourcePath: string,
): {
  readonly imports: readonly WebModuleImport[];
  readonly state: "parsed" | "unparseable";
  readonly diagnostics: readonly string[];
} => {
  const ast = parseJavaScriptSource(source, sourcePath);
  if (ast === null)
    return {
      imports: [],
      state: "unparseable",
      diagnostics: ["Source could not be parsed; imports are unknown."],
    };
  const imports: WebModuleImport[] = [];
  const add = (kind: WebModuleImport["kind"], expression: Node): void => {
    if (
      expression.start === null ||
      expression.start === undefined ||
      expression.end === null ||
      expression.end === undefined ||
      expression.loc === null ||
      expression.loc === undefined
    )
      return;
    const specifier = isStringLiteral(expression)
      ? expression.value
      : isTemplateLiteral(expression) && expression.expressions.length === 0
        ? (expression.quasis[0]?.value.cooked ?? null)
        : null;
    imports.push({
      kind,
      specifier,
      expression: source.slice(expression.start, expression.end),
      start: {
        offset: expression.start,
        line: expression.loc.start.line,
        column: expression.loc.start.column,
      },
      end: {
        offset: expression.end,
        line: expression.loc.end.line,
        column: expression.loc.end.column,
      },
    });
  };
  traverseJavaScriptAst(ast, {
    enter: (node) => {
      const moduleSource = semanticStaticModuleSource(node);
      if (moduleSource !== null) {
        add(
          node.type === "ImportDeclaration" ? "static-import" : "re-export",
          moduleSource,
        );
      } else if (node.type === "ImportExpression")
        add("dynamic-import", node.source);
    },
  });
  imports.sort((a, b) => a.start.offset - b.start.offset);
  return {
    imports,
    state: "parsed",
    diagnostics: [
      ...(ast.errors?.map((error) => error.message) ?? []),
      ...(hasUncertainTypeOnlyModuleSideEffect(ast.program)
        ? [
            "Compiler options are unavailable; inline type-only imports or re-exports may preserve a module side-effect dependency.",
          ]
        : []),
    ],
  };
};

/** Match reported URLs without collapsing query or module fragment identity. */
export const matchCapturedModules = (
  url: string,
  scripts: readonly ExportedWebScript[],
) => {
  const transport = URL.parse(url);
  if (transport !== null) transport.hash = "";
  const candidates: {
    script_index: number;
    match: "exact-reported-url" | "response-url-without-fragment";
    script: ExportedWebScript;
  }[] = [];
  scripts.forEach((script, script_index) => {
    if (script.url === url)
      candidates.push({ script_index, match: "exact-reported-url", script });
    else if (
      script.source.kind === "scenario-response" &&
      transport?.href === script.url
    )
      candidates.push({
        script_index,
        match: "response-url-without-fragment",
        script,
      });
  });
  return candidates;
};

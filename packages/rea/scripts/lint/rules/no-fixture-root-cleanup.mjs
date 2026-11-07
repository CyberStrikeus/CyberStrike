import { findBinding } from "../bindings.mjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveImportSource } from "./import-source.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const fixtureModule = resolve(root, "tests/fixtures/temporaryDirectory");
const workspaceModule = resolve(
  root,
  "tests/support/workspace/workspaceFixture",
);
const hooks = new Set(["afterEach", "afterAll", "onTestFinished"]);
const unwrap = (node) => {
  while (
    node &&
    [
      "AwaitExpression",
      "TSAsExpression",
      "TSNonNullExpression",
      "ChainExpression",
    ].includes(node.type)
  )
    node = node.argument ?? node.expression;
  return node;
};
const isFunction = (node) =>
  node &&
  [
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
  ].includes(node.type);

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Let createTestTempDirectory own removal of its root.",
    },
    schema: [],
    messages: {
      duplicate:
        "createTestTempDirectory already owns root cleanup; remove the duplicate teardown deletion, retaining cleanup of other resources.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const filename = context.physicalFilename ?? context.filename;
    const calls = [];
    const variable = (node) => findBinding(sourceCode, node);
    const imported = (node) => {
      const member = node?.type === "MemberExpression" ? node : undefined;
      const binding = member ? member.object : node;
      if (binding?.type !== "Identifier") return undefined;
      const definition = variable(binding)?.defs[0];
      if (
        definition?.type !== "ImportBinding" ||
        (member
          ? definition.node.type !== "ImportNamespaceSpecifier"
          : definition.node.type !== "ImportSpecifier")
      )
        return undefined;
      const declaration = definition.parent ?? definition.node.parent;
      const specifier = declaration.source?.value;
      if (typeof specifier !== "string") return undefined;
      return {
        name: member
          ? member.computed
            ? member.property.value
            : member.property.name
          : (definition.node.imported.name ?? definition.node.imported.value),
        module:
          resolveImportSource(filename, specifier)?.replace(
            /\.(?:[cm]?[jt]s)$/u,
            "",
          ) ?? specifier,
      };
    };
    const fixtureRoot = (raw, seen = new Set()) => {
      const node = unwrap(raw);
      if (node?.type === "CallExpression") {
        const identity = imported(node.callee);
        return (
          identity?.module === fixtureModule &&
          identity.name === "createTestTempDirectory"
        );
      }
      if (node?.type !== "Identifier") return false;
      const binding = variable(node);
      if (!binding || seen.has(binding)) return false;
      seen.add(binding);
      const definition = binding.defs[0];
      // Mutable ownership and mixed root registries require flow analysis, not
      // a guess based on the variable name or one assignment.
      return (
        definition?.type === "Variable" &&
        definition.parent.kind === "const" &&
        definition.node.id.type === "Identifier" &&
        fixtureRoot(definition.node.init, seen)
      );
    };
    const callback = (raw) => {
      const node = unwrap(raw);
      if (isFunction(node)) return node;
      if (node?.type !== "Identifier") return undefined;
      const definition = variable(node)?.defs[0];
      if (definition?.type === "FunctionName") return definition.node;
      if (
        definition?.type === "Variable" &&
        definition.parent.kind === "const"
      ) {
        const value = unwrap(definition.node.init);
        if (isFunction(value)) return value;
      }
      return undefined;
    };
    return {
      CallExpression(node) {
        calls.push(node);
      },
      "Program:exit"() {
        const teardowns = new Set();
        for (const call of calls) {
          const identity = imported(call.callee);
          if (identity?.module === "vitest" && hooks.has(identity.name)) {
            const body = callback(call.arguments[0]);
            if (body) teardowns.add(body);
          }
        }
        for (const call of calls) {
          const identity = imported(call.callee);
          if (!identity) continue;
          const removesRoot =
            (identity.module === "node:fs/promises" &&
              ["rm", "rmdir"].includes(identity.name)) ||
            (identity.module === "node:fs" &&
              ["rm", "rmSync", "rmdir", "rmdirSync"].includes(identity.name)) ||
            (identity.module === workspaceModule &&
              identity.name === "removeTestWorkspace");
          if (!removesRoot || !fixtureRoot(call.arguments[0])) continue;
          let parent = call.parent;
          while (parent && !isFunction(parent)) parent = parent.parent;
          if (teardowns.has(parent))
            context.report({ node: call, messageId: "duplicate" });
        }
      },
    };
  },
};

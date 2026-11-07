import { findBinding } from "../bindings.mjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { collectToolCatalogSources } from "./tool-catalog-sources.mjs";
import { resolveImportSource } from "./import-source.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const catalogs = collectToolCatalogSources(
  resolve(root, "src/contracts/toolContracts.ts"),
);

const unwrap = (node) => {
  while (
    node &&
    [
      "TSAsExpression",
      "TSSatisfiesExpression",
      "TSNonNullExpression",
      "ChainExpression",
    ].includes(node.type)
  )
    node = node.expression;
  return node;
};
const numeric = (node) =>
  (node?.type === "Literal" &&
    (typeof node.value === "number" ||
      (typeof node.value === "string" &&
        /^(?:0|[1-9][0-9]*)$/u.test(node.value)))) ||
  (node?.type === "UnaryExpression" &&
    ["+", "-"].includes(node.operator) &&
    node.argument.type === "Literal" &&
    typeof node.argument.value === "number");

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Select canonical tool contracts by name, never catalog position.",
    },
    schema: [],
    messages: {
      positional:
        "Select a named tool contract; catalog ordering must not select an operation or schema.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const filename = context.physicalFilename ?? context.filename;
    const variable = (node) => findBinding(sourceCode, node);
    const imported = (node) => {
      if (node?.type !== "Identifier") return undefined;
      const definition = variable(node)?.defs[0];
      if (definition?.type !== "ImportBinding") return undefined;
      const declaration = definition.parent ?? definition.node.parent;
      const specifier = declaration.source?.value;
      const path = resolveImportSource(filename, specifier)?.replace(
        /\.(?:[cm]?[jt]s)$/u,
        "",
      );
      const expected = catalogs.get(path);
      if (expected === undefined) return undefined;
      return { definition, expected };
    };
    const isCatalog = (raw, seen = new Set()) => {
      const node = unwrap(raw);
      if (!node) return false;
      if (node.type === "Identifier") {
        const binding = variable(node);
        if (!binding || seen.has(binding)) return false;
        seen.add(binding);
        const identity = imported(node);
        if (identity) {
          const specifier = identity.definition.node;
          return (
            specifier.type === "ImportSpecifier" &&
            identity.expected.has(
              specifier.imported.name ?? specifier.imported.value,
            )
          );
        }
        const definition = binding.defs[0];
        return (
          definition?.type === "Variable" &&
          definition.parent.kind === "const" &&
          definition.node.id.type === "Identifier" &&
          isCatalog(definition.node.init, seen)
        );
      }
      if (node.type === "MemberExpression" || node.type === "TSQualifiedName") {
        const object =
          node.type === "MemberExpression" ? node.object : node.left;
        const identity = imported(object);
        if (identity?.definition.node.type !== "ImportNamespaceSpecifier")
          return false;
        const property =
          node.type === "MemberExpression" ? node.property : node.right;
        const name = node.computed ? property.value : property.name;
        return identity.expected.has(name);
      }
      return false;
    };
    const selectedContract = (raw, seen = new Set()) => {
      const node = unwrap(raw);
      if (!node) return undefined;
      if (
        node.type === "MemberExpression" &&
        node.computed &&
        numeric(node.property) &&
        isCatalog(node.object)
      )
        return node;
      if (node.type === "CallExpression") {
        const callee = unwrap(node.callee);
        if (
          callee?.type === "MemberExpression" &&
          (callee.computed ? callee.property.value : callee.property.name) ===
            "at" &&
          numeric(node.arguments[0]) &&
          isCatalog(callee.object)
        )
          return node;
      }
      if (node.type !== "Identifier") return undefined;
      const binding = variable(node);
      if (!binding || seen.has(binding)) return undefined;
      seen.add(binding);
      const definition = binding.defs[0];
      if (definition?.type !== "Variable" || definition.parent.kind !== "const")
        return undefined;
      if (definition.node.id.type === "Identifier")
        return selectedContract(definition.node.init, seen);
      if (
        definition.node.id.type === "ArrayPattern" &&
        definition.node.id.elements.some(
          (element) =>
            element?.type === "Identifier" && element.name === node.name,
        ) &&
        isCatalog(definition.node.init)
      )
        return definition.node;
      return undefined;
    };
    const bindingFields = new Set(["name", "inputSchema", "outputSchema"]);
    const isRegistrationOptions = (node) => {
      if (node?.type !== "Identifier") return false;
      const definition = variable(node)?.defs[0];
      if (
        definition?.type !== "ImportBinding" ||
        definition.node.type !== "ImportSpecifier"
      )
        return false;
      const declaration = definition.parent ?? definition.node.parent;
      const specifier = declaration.source?.value;
      const path = resolveImportSource(filename, specifier)?.replace(
        /\.(?:[cm]?[jt]s)$/u,
        "",
      );
      const name =
        definition.node.imported.name ?? definition.node.imported.value;
      return (
        path === resolve(root, "src/server/toolRegistrationOptions") &&
        [
          "toolRegistrationOptions",
          "applicationToolRegistrationOptions",
        ].includes(name)
      );
    };
    const reported = new Set();
    const reportSelection = (raw) => {
      const node = selectedContract(raw);
      if (node && !reported.has(node)) {
        reported.add(node);
        context.report({ node, messageId: "positional" });
      }
    };
    return {
      MemberExpression(node) {
        const name = node.computed ? node.property.value : node.property.name;
        const parent = node.parent;
        const writesProperty =
          (parent?.type === "AssignmentExpression" && parent.left === node) ||
          parent?.type === "UpdateExpression" ||
          (parent?.type === "UnaryExpression" && parent.operator === "delete");
        if (bindingFields.has(name) && !writesProperty)
          reportSelection(node.object);
      },
      CallExpression(node) {
        if (isRegistrationOptions(unwrap(node.callee)))
          reportSelection(node.arguments[0]);
      },
      VariableDeclarator(node) {
        if (
          node.id.type === "ObjectPattern" &&
          node.id.properties.some(
            (property) =>
              property.type === "Property" &&
              bindingFields.has(
                property.computed ? property.key.value : property.key.name,
              ),
          )
        )
          reportSelection(node.init);
      },
      TSIndexedAccessType(node) {
        if (
          node.objectType.type === "TSTypeQuery" &&
          node.indexType.type === "TSLiteralType" &&
          numeric(node.indexType.literal) &&
          isCatalog(node.objectType.exprName)
        )
          context.report({ node, messageId: "positional" });
      },
    };
  },
};

import { findBinding } from "../bindings.mjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveImportSource } from "./import-source.mjs";

const domain = fileURLToPath(new URL("../../../src/domain/", import.meta.url));
const payloadFields = new Set(["parameters", "result", "rawResult"]);

const propertyName = (node) => {
  if (!node.computed && node.property?.type === "Identifier")
    return node.property.name;
  if (
    node.property?.type === "Literal" &&
    typeof node.property.value === "string"
  )
    return node.property.value;
  return undefined;
};

const fieldName = (node) => {
  if (node.type !== "Property") return undefined;
  if (!node.computed && node.key.type === "Identifier") return node.key.name;
  if (node.key.type === "Literal" && typeof node.key.value === "string")
    return node.key.value;
  return undefined;
};

const importedBinding = (sourceCode, node) => {
  if (node.type !== "Identifier") return undefined;
  const variable = findBinding(sourceCode, node);
  if (!variable || variable.defs.length !== 1) return undefined;
  const definition = variable.defs[0];
  return definition.type === "ImportBinding" ? definition : undefined;
};

const isImported = (context, node, module, names) => {
  const member = node.type === "MemberExpression" && !node.optional;
  const binding = importedBinding(
    context.sourceCode,
    member ? node.object : node,
  );
  if (!binding || binding.parent?.type !== "ImportDeclaration") return false;
  const declaration = binding.parent;
  if (declaration.importKind === "type" || binding.node.importKind === "type")
    return false;
  const specifier = declaration.source.value;
  const target = resolveImportSource(
    context.physicalFilename ?? context.filename,
    specifier,
  );
  if (
    target !== resolve(domain, `${module}.js`) &&
    target !== resolve(domain, `${module}.ts`)
  )
    return false;
  if (member)
    return (
      binding.node.type === "ImportNamespaceSpecifier" &&
      names.has(propertyName(node))
    );
  if (binding.node.type !== "ImportSpecifier") return false;
  return names.has(binding.node.imported.name ?? binding.node.imported.value);
};

const evidenceCreator = new Set(["createEvidence"]);
const genericJsonSchemas = new Set(["jsonValueSchema", "jsonObjectSchema"]);

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Leave ordinary Evidence JSON payload admission with createEvidence.",
    },
    schema: [],
    messages: {
      redundantJsonAdmission:
        "Pass the {{field}} payload directly to createEvidence; it owns generic JSON admission. Keep semantic validation at its own boundary.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.optional ||
          !isImported(context, node.callee, "evidence", evidenceCreator)
        )
          return;
        const observation = node.arguments[2];
        if (observation?.type !== "ObjectExpression") return;
        for (const [index, property] of observation.properties.entries()) {
          const field = fieldName(property);
          if (
            !payloadFields.has(field) ||
            property.kind !== "init" ||
            property.method
          )
            continue;
          // A later spread or unknown key may replace this field before admission.
          if (
            observation.properties
              .slice(index + 1)
              .some(
                (later) =>
                  later.type !== "Property" ||
                  fieldName(later) === undefined ||
                  fieldName(later) === field,
              )
          )
            continue;
          const parsed = property.value;
          if (
            parsed.type !== "CallExpression" ||
            parsed.optional ||
            parsed.arguments.length !== 1
          )
            continue;
          const parse = parsed.callee;
          if (
            parse.type !== "MemberExpression" ||
            parse.optional ||
            propertyName(parse) !== "parse"
          )
            continue;
          if (
            isImported(context, parse.object, "jsonValue", genericJsonSchemas)
          )
            context.report({
              node: parsed,
              messageId: "redundantJsonAdmission",
              data: { field },
            });
        }
      },
    };
  },
};

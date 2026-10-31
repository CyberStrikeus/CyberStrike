import { relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { findBinding } from "../bindings.mjs";
import { projectForTest } from "../../lib/test-projects.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const mockMethods = new Set(["mock", "doMock"]);

const unwrap = (node) =>
  node?.type === "ChainExpression" ? node.expression : node;

const propertyName = (member) => {
  if (!member?.computed && member?.property?.type === "Identifier")
    return member.property.name;
  if (member?.computed && member.property?.type === "Literal")
    return member.property.value;
  return undefined;
};

const importedFromVitest = (sourceCode, identifier) => {
  const binding = findBinding(sourceCode, identifier);
  const definition = binding?.defs[0];
  if (definition?.type !== "ImportBinding") return undefined;
  const declaration = definition.parent ?? definition.node.parent;
  if (declaration?.source?.value !== "vitest") return undefined;
  return definition.node;
};

const isViImport = (sourceCode, identifier) => {
  const specifier = importedFromVitest(sourceCode, identifier);
  return (
    specifier?.type === "ImportSpecifier" &&
    (specifier.imported.name ?? specifier.imported.value) === "vi"
  );
};

const isVitestNamespace = (sourceCode, identifier) =>
  importedFromVitest(sourceCode, identifier)?.type ===
  "ImportNamespaceSpecifier";

const isVitestViMember = (sourceCode, node) => {
  const member = unwrap(node);
  if (
    member?.type !== "MemberExpression" ||
    propertyName(member) !== "vi" ||
    member.object?.type !== "Identifier"
  )
    return false;
  return isVitestNamespace(sourceCode, member.object);
};

const isModuleMockCall = (sourceCode, callee) => {
  const method = unwrap(callee);
  if (
    method?.type !== "MemberExpression" ||
    !mockMethods.has(propertyName(method))
  )
    return false;
  const receiver = unwrap(method.object);
  return (
    (receiver?.type === "Identifier" && isViImport(sourceCode, receiver)) ||
    isVitestViMember(sourceCode, receiver)
  );
};

const isolationForFile = (filename, cwd) => {
  if (typeof filename !== "string" || !filename.endsWith(".test.ts"))
    return undefined;
  const testPath = relative(cwd, filename).split("\\").join("/");
  if (
    testPath === "" ||
    isAbsolute(testPath) ||
    testPath === ".." ||
    testPath.startsWith("../")
  )
    return undefined;
  try {
    return projectForTest(testPath).isolate !== false;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("No test project owns ")
    )
      return undefined;
    throw error;
  }
};

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep Vitest module mocks in projects with per-file module isolation.",
    },
    schema: [],
    messages: {
      shared:
        "Vitest module mocks need an isolated test project; move the test to an isolated project or replace the module mock with a scoped spy or injected dependency.",
    },
  },
  create(context) {
    const filename = context.physicalFilename ?? context.filename;
    const sourceCode = context.sourceCode;
    const cwd =
      context.cwd ?? context.getCwd?.() ?? sourceCode.getCwd?.() ?? repository;
    if (isolationForFile(filename, cwd) !== false) return {};
    return {
      CallExpression(node) {
        if (isModuleMockCall(sourceCode, node.callee))
          context.report({ node, messageId: "shared" });
      },
    };
  },
};

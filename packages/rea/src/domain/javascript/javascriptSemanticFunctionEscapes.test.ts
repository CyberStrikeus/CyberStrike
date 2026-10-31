import { expect, it } from "vitest";

import { indexJavaScriptBindingsWithReceiversSteps } from "./javascriptSemanticAnalysis.js";
import { completeSemanticSteps } from "./javascriptSemanticTraversal.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";

const indexedBindings = (body: string) => {
  const parsed = parseJavaScriptSource(
    `const shared={};const get=()=>shared;${body}`,
  );
  if (parsed === null) throw new Error("Expected callback escape fixture");
  const index = completeSemanticSteps(
    indexJavaScriptBindingsWithReceiversSteps(parsed.program),
  );
  completeSemanticSteps(index.indexAmbientWritesSteps());
  completeSemanticSteps(index.indexMemberMutationFactsSteps());
  return [...index.bindings.bindingsById.values()];
};

it.each([
  ["consume(get);", true],
  ["consume(()=>shared);", true],
  ["const alias=get;consume(alias);", true],
  ["consume(()=>({}));", false],
  ["const local=()=>({});consume(local);", false],
  ["const local=()=>({});const alias=local;consume(alias);", false],
  ["get.own=1;", false],
  ["const local=()=>({});get.call=local;consume(get);", true],
  ["const local=()=>({});get.call=local;consume(get.call);", false],
])("preserves callback result escape sources through %s", (body, escaped) => {
  const bindings = indexedBindings(body);
  const shared = bindings.find(({ name }) => name === "shared");
  expect(shared).toBeDefined();
  expect((shared?.escapedPaths.length ?? 0) > 0).toBe(escaped);
});

it.each(["call", "apply", "other"])(
  "keeps a function's own %s write separate from its returned object",
  (member) => {
    const bindings = indexedBindings(`get.${member}=()=>({});`);
    const get = bindings.find(({ name }) => name === "get");
    const shared = bindings.find(({ name }) => name === "shared");
    expect(get?.memberWrites.map(({ path }) => path)).toContainEqual([member]);
    expect(shared?.memberWrites).toEqual([]);
    expect(shared?.escapedPaths).toEqual([]);
  },
);

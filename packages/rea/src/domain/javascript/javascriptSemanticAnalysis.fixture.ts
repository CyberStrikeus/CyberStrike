import { expect } from "vitest";

import type {
  JavaScriptSemanticBinding,
  JavaScriptSemanticIr,
} from "./javascriptSemanticIr.js";

export const programScope = (ir: JavaScriptSemanticIr) => {
  const scope = ir.scopes.find(({ kind }) => kind === "program");
  if (scope === undefined) throw new Error("Missing program scope");
  return scope;
};

export const bindingsNamed = (
  ir: JavaScriptSemanticIr,
  name: string,
): JavaScriptSemanticBinding[] =>
  ir.bindings.filter(({ name: candidate }) => candidate === name);

export const bindingById = (
  ir: JavaScriptSemanticIr,
  bindingId: string,
): JavaScriptSemanticBinding | undefined =>
  ir.bindings.find(({ bindingId: candidate }) => candidate === bindingId);

export const onlyBinding = (
  ir: JavaScriptSemanticIr,
  name: string,
): JavaScriptSemanticBinding => {
  const bindings = bindingsNamed(ir, name);
  expect(bindings).toHaveLength(1);
  const binding = bindings[0];
  if (binding === undefined) throw new Error(`Missing binding ${name}`);
  return binding;
};

export const onlyCallable = (ir: JavaScriptSemanticIr, name: string) => {
  const callables = ir.callables.filter(
    ({ name: candidate }) => candidate === name,
  );
  if (callables.length !== 1 || callables[0] === undefined)
    throw new Error(`Expected one callable named ${name}`);
  return callables[0];
};

export const topLevelBinding = (
  ir: JavaScriptSemanticIr,
  name: string,
): JavaScriptSemanticBinding => {
  const scopeId = programScope(ir).scopeId;
  const binding = ir.bindings.find(
    ({ name: candidate, scopeId: candidateScope }) =>
      candidate === name && candidateScope === scopeId,
  );
  if (binding === undefined)
    throw new Error(`Missing top-level binding ${name}`);
  return binding;
};

export const origin = (binding: JavaScriptSemanticBinding) => {
  expect(binding.provenance.status).toBe("module");
  expect(binding.provenance.origins).toHaveLength(1);
  const value = binding.provenance.origins[0];
  if (value === undefined)
    throw new Error(`Missing origin for ${binding.name}`);
  return value;
};

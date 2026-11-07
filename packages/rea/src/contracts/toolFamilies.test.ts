import { describe, expect, expectTypeOf, it } from "vitest";

import {
  TOOL_FAMILY_DEFINITIONS,
  contractsForToolFamilies,
  toolFamilyId,
} from "./toolFamilies.js";
import {
  registerToolFamilies,
  TOOL_FAMILY_IDS,
  type ToolFamilyId,
} from "./toolFamilyIds.js";
import { TOOL_CONTRACTS, toolContract } from "./toolContracts.js";
import type {
  officialOutputSchemas,
  enhancedOutputSchemas,
  nativeOutputSchemas,
  artifactOutputSchemas,
  managedOutputSchemas,
  managedWorkflowOutputSchemas,
} from "./toolOutputSchemaGroups.js";

// Catalog resolution must retain the exact schema owned by each named family.
expectTypeOf(
  toolContract("inspect_native_instruction").outputSchema,
).toEqualTypeOf<typeof officialOutputSchemas.inspect_native_instruction>();
expectTypeOf(toolContract("analyze_function").outputSchema).toEqualTypeOf<
  typeof enhancedOutputSchemas.analyze_function
>();
expectTypeOf(toolContract("inspect_macho").outputSchema).toEqualTypeOf<
  typeof nativeOutputSchemas.inspect_macho
>();
expectTypeOf(toolContract("inspect_artifact").outputSchema).toEqualTypeOf<
  typeof artifactOutputSchemas.inspect_artifact
>();
expectTypeOf(
  toolContract("inspect_managed_artifact").outputSchema,
).toEqualTypeOf<typeof managedOutputSchemas.inspect_managed_artifact>();
expectTypeOf(
  toolContract("compare_managed_members").outputSchema,
).toEqualTypeOf<typeof managedWorkflowOutputSchemas.compare_managed_members>();

describe("tool families", () => {
  it("declares exactly one definition per published id", () => {
    expect(TOOL_FAMILY_DEFINITIONS.map(({ id }) => id)).toEqual([
      ...TOOL_FAMILY_IDS,
    ]);
  });

  it("runs registrars in published id order", () => {
    const seen: string[] = [];
    const registrars = Object.fromEntries(
      TOOL_FAMILY_IDS.map((id) => [
        id,
        (): void => {
          seen.push(id);
        },
      ]),
    ) as unknown as { readonly [Id in ToolFamilyId]: () => void };
    registerToolFamilies(registrars);
    expect(seen).toEqual([...TOOL_FAMILY_IDS]);
  });

  it("covers every contract exactly once", () => {
    const owners = new Map<string, string[]>();
    for (const { id, contracts } of TOOL_FAMILY_DEFINITIONS)
      for (const { name } of contracts)
        owners.set(name, [...(owners.get(name) ?? []), id]);
    expect([...owners].filter(([, ids]) => ids.length > 1)).toEqual([]);
    expect([...owners.keys()].sort()).toEqual(
      TOOL_CONTRACTS.map(({ name }) => name).sort(),
    );
  });

  it("resolves each advertised tool to its owning family", () => {
    for (const { name } of TOOL_CONTRACTS)
      expect(TOOL_FAMILY_IDS).toContain(toolFamilyId(name));
    expect(toolFamilyId("not_a_tool")).toBeUndefined();
  });

  it("projects catalog contracts from a family selection", () => {
    expect(contractsForToolFamilies(undefined)).toEqual(TOOL_CONTRACTS);
    expect(contractsForToolFamilies(new Set())).toEqual([]);
    const scoped = contractsForToolFamilies(new Set(["session"]));
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.length).toBeLessThan(TOOL_CONTRACTS.length);
    expect(scoped.map(({ name }) => name)).toEqual(
      TOOL_CONTRACTS.filter(({ name }) => toolFamilyId(name) === "session").map(
        ({ name }) => name,
      ),
    );
  });
});

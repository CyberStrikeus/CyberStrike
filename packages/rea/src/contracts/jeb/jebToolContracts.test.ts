import { expect, it } from "vitest";

import { JEB_TOOL_CONTRACTS } from "./jebToolContracts.js";
import { TOOL_CONTRACTS } from "../toolContracts.js";

const registered = new Set(TOOL_CONTRACTS.map((contract) => contract.name));

it("registers every JEB contract in the canonical inventory with audited effects", () => {
  for (const contract of JEB_TOOL_CONTRACTS) {
    expect(registered.has(contract.name)).toBe(true);
    expect(contract.effects.accessesNetwork).toBe(true);
    expect(contract.effects.launchesProcess).toBe(false);
    expect(contract.effects.writesFilesystem).toBe(false);
    expect(contract.effects.mutatesTarget).toBe(false);
  }
  expect(contractByName("open_jeb_project").effects.idempotent).toBe(false);
});

it("keeps executable examples valid against their advertised input schemas", () => {
  for (const contract of JEB_TOOL_CONTRACTS) {
    for (const example of contract.examples) {
      expect(
        contract.inputSchema.safeParse(example.input).success,
        `${contract.name}: ${example.title ?? "example"}`,
      ).toBe(true);
    }
  }
});

it("describes engine authority truthfully", () => {
  for (const contract of JEB_TOOL_CONTRACTS) {
    expect(contract.kind).toBe("jeb-provider");
    expect(contract.description).toMatch(/JEB|[Ee]ngine/);
  }
  expect(contractByName("open_jeb_project").description).toContain(
    "REA does not",
  );
});

const contractByName = (name: string) => {
  const contract = JEB_TOOL_CONTRACTS.find(
    (candidate) => candidate.name === name,
  );
  if (contract === undefined) throw new Error(`Missing JEB contract: ${name}`);
  return contract;
};

import { Ajv2020 } from "ajv/dist/2020.js";
import { expect } from "vitest";

import {
  TOOL_CONTRACTS,
  toolContract,
} from "../../../src/contracts/toolContracts.js";

type ToolName = (typeof TOOL_CONTRACTS)[number]["name"];

/** Advertised tool listing shape needed for contract validation. */
export interface AdvertisedMcpTool {
  readonly name: string;
  readonly inputSchema?: unknown;
}

/**
 * Assert every named operation is advertised and its input schema compiles,
 * accepts the contract's own examples, and rejects unknown input. The server
 * may present a compacted form of the contract schema.
 */
export const assertAdvertisedMcpContracts = (
  operationNames: readonly ToolName[],
  tools: readonly AdvertisedMcpTool[],
): void => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  for (const name of operationNames) {
    const contract = toolContract(name);
    const matches = tools.filter((tool) => tool.name === name);
    if (matches.length !== 1)
      throw new Error(`${name} must have exactly one advertised definition`);
    const listed = matches[0];
    if (listed?.inputSchema === undefined)
      throw new Error(`${name} must advertise an input schema`);
    const validate = ajv.compile(
      JSON.parse(JSON.stringify(listed.inputSchema)),
    );
    for (const example of contract.examples)
      expect(validate(example.input), `${name} example`).toBe(true);
    expect(validate({ unknown_argument: true }), `${name} rejects`).toBe(false);
  }
};

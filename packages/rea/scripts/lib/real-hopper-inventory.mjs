import assert from "node:assert/strict";
import { HOPPER_PROVIDER_IDENTITY } from "../../dist/hopper/HopperProviderCapabilities.js";
import {
  requireMcpEvidenceResult,
  requireEvidenceProvider,
} from "./mcp-verifier-results.mjs";

/** Verify real Hopper inventories and address filters through the MCP transport. */
export async function verifyHopperInventories(client, options) {
  const inventoryCounts = {};
  for (const operation of ["list_strings", "list_names"]) {
    const called = await client.callTool(
      { name: operation, arguments: {} },
      options,
    );
    const inventory = requireMcpEvidenceResult(called, operation);
    requireEvidenceProvider(called, operation, HOPPER_PROVIDER_IDENTITY.id);
    assert.ok(
      Array.isArray(inventory) && inventory.length > 0,
      `${operation} omitted the real fixture inventory`,
    );
    let previous = -1n;
    for (const item of inventory) {
      assert.match(item.address, /^0x[0-9a-f]+$/u);
      assert.equal(typeof item.value, "string");
      const address = BigInt(item.address);
      assert.ok(
        address > previous,
        `${operation} is not numerically address-sorted`,
      );
      previous = address;
    }
    const filtered = requireMcpEvidenceResult(
      await client.callTool(
        {
          name: operation,
          arguments: { address: inventory[0].address },
        },
        options,
      ),
      operation,
    );
    assert.deepEqual(filtered, [inventory[0]]);
    inventoryCounts[operation] = inventory.length;
  }
  return inventoryCounts;
}

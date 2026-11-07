import { describe, expect, it } from "vitest";

import {
  HopperFixtureLauncher,
  startHopperFixtureClient,
} from "./hopperClient.fixture.js";

describe("Hopper wire arguments", () => {
  it("retains omitted defaults and explicitly selected documents on the socket", async () => {
    const launcher = new HopperFixtureLauncher();
    const client = await startHopperFixtureClient(launcher);
    for (const [operation, parameters] of [
      ["procedure_pseudo_code", { procedure: "main" }],
      ["list_strings", {}],
      ["set_bookmark", { address: "0x1000" }],
      ["procedure_assembly", { procedure: "main", document: "chosen" }],
    ] as const) {
      await expect(
        client.callTool(operation, parameters),
      ).resolves.toMatchObject({ ok: true });
      const request = await launcher.waitForRequest(operation);
      expect(request.params).toEqual(parameters);
    }
  });
});

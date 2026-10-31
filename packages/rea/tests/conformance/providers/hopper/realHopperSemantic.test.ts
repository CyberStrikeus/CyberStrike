import { describe, expect, it } from "vitest";

import {
  requireCurrentDocument,
  resolveFixtureProcedure,
} from "../../../../scripts/lib/real-hopper-semantic.mjs";

const normalize = (value: unknown): unknown => value;

describe("Hopper verifier semantic fixture resolution", () => {
  it("binds mutations to the active document, not the first listed one", async () => {
    await expect(
      requireCurrentDocument(
        clientReturning("active"),
        {},
        ["unrelated", "active"],
        normalize,
      ),
    ).resolves.toBe("active");
    await expect(
      requireCurrentDocument(
        clientReturning("unknown"),
        {},
        ["unrelated", "active"],
        normalize,
      ),
    ).rejects.toThrow(/current_document/u);
  });

  it.each([
    ["empty", []],
    [
      "duplicate",
      [
        { address: "0x1000", value: "rea_entry" },
        { address: "0x2000", value: "_rea_entry" },
      ],
    ],
    ["wrong name", [{ address: "0x1000", value: "rea_other" }]],
  ])("rejects %s search evidence", async (_label, items) => {
    await expect(
      resolveFixtureProcedure(
        clientWithItems(items),
        {},
        "rea_entry",
        normalize,
      ),
    ).rejects.toThrow(/exactly one Hopper procedure/u);
  });
});

const clientWithItems = (items: readonly unknown[]) => ({
  callTool: async () => items,
});

const clientReturning = (value: unknown) => ({
  callTool: async () => value,
});

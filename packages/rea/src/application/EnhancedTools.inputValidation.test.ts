import { describe, expect, it, vi } from "vitest";

import {
  createAnalysisExecution,
  type AnalysisOperationPort,
} from "./AnalysisProvider.js";
import { EnhancedTools } from "./EnhancedTools.js";
import { ok } from "../domain/result.js";

const provider = { id: "fixture", name: "Fixture", version: "1" };

describe("direct Objective-C protocol input validation", () => {
  it.each([
    { label: "extra property", input: { unexpected: "benign" } },
    { label: "null", input: null },
    { label: "undefined", input: undefined },
    { label: "array", input: [] },
    { label: "string", input: "protocols" },
  ])("rejects $label before invoking the provider", async ({ input }) => {
    const execute = vi
      .fn<AnalysisOperationPort["execute"]>()
      .mockResolvedValue(ok(createAnalysisExecution([], provider)));

    const result = await new EnhancedTools({ execute }).execute(
      "get_objc_protocols",
      input,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError", operation: "get_objc_protocols" },
    });
  });

  it.each([
    { label: "empty", names: [], protocols: [] },
    {
      label: "populated",
      names: [{ address: "0x1000", value: "__OBJC_PROTOCOL_$_Delegate" }],
      protocols: [{ address: "0x1000", name: "__OBJC_PROTOCOL_$_Delegate" }],
    },
  ])(
    "accepts an empty object with $label inventory",
    async ({ names, protocols }) => {
      const execute = vi
        .fn<AnalysisOperationPort["execute"]>()
        .mockResolvedValue(ok(createAnalysisExecution(names, provider)));

      const result = await new EnhancedTools({ execute }).execute(
        "get_objc_protocols",
        {},
      );

      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute.mock.calls[0]?.[0]).toBe("list_names");
      expect(result).toEqual({
        ok: true,
        value: { count: protocols.length, protocols },
      });
    },
  );
});

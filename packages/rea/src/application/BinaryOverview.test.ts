import { expect, it } from "vitest";
import { EnhancedTools } from "./EnhancedTools.js";
import { createAnalysisExecution } from "./AnalysisProvider.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { err, ok } from "../domain/result.js";

it("uses the provider-owned overview without requesting complete inventories", async () => {
  const calls: string[] = [];
  const result = {
    document: "selected",
    procedure_count: 12,
    string_count: 34,
  };
  const tools = new EnhancedTools({
    execute: async (operation) => {
      calls.push(operation);
      return ok(
        createAnalysisExecution(result, {
          id: "fixture",
          name: "Fixture",
          version: "1",
        }),
      );
    },
  });
  expect(await tools.execute("binary_overview", {})).toEqual(ok(result));
  expect(calls).toEqual(["read_binary_inventory_summary"]);
});

it.each([
  new AnalysisOutputError("binary_overview", "Malformed aggregate"),
  new AnalysisCancelledError("binary_overview"),
  new AnalysisCapabilityUnavailableError(
    "fixture",
    "binary_overview",
    "Cleanup pending",
    {
      cleanup: {
        reason: "Owned process is still closing",
        resources: ["session"],
      },
    },
  ),
])(
  "preserves an aggregate failure rather than silently repeating analysis: %s",
  async (failure) => {
    const calls: string[] = [];
    const tools = new EnhancedTools({
      execute: async (operation) => {
        calls.push(operation);
        return err(failure);
      },
    });
    expect(await tools.execute("binary_overview", {})).toEqual(err(failure));
    expect(calls).toEqual(["read_binary_inventory_summary"]);
  },
);

const fallbackOverview = (procedures: JsonValue, strings: JsonValue) =>
  new EnhancedTools({
    execute: async (operation) => {
      if (
        operation === "read_binary_inventory_summary" ||
        operation === "list_segments"
      )
        return err(
          new AnalysisCapabilityUnavailableError(
            "fixture",
            operation,
            "Not supported",
          ),
        );
      const result =
        operation === "current_document"
          ? "selected"
          : operation === "list_procedures"
            ? procedures
            : strings;
      return ok(
        createAnalysisExecution(result, {
          id: "fixture",
          name: "Fixture",
          version: "1",
        }),
      );
    },
  });

it.each(["list_procedures", "list_strings"] as const)(
  "rejects malformed successful %s inventories in the public overview workflow",
  async (operation) => {
    for (const malformed of [
      { error: "inventory unavailable" },
      { "0x1000": "obsolete map" },
      { [operation === "list_procedures" ? "procedures" : "strings"]: [] },
      JSON.parse('{"__proto__":"observed"}'),
      [null],
      [{ address: "0x1000" }],
      [{ address: "0x1000", value: 1 }],
    ]) {
      const tools = fallbackOverview(
        operation === "list_procedures" ? malformed : [],
        operation === "list_strings" ? malformed : [],
      );
      const result = await tools.execute("binary_overview", {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(AnalysisOutputError);
        if (result.error instanceof AnalysisOutputError)
          expect(result.error.operation).toBe(operation);
      }
    }
  },
);

it("counts canonical fallback inventories including typed and display-only strings", async () => {
  const tools = fallbackOverview(
    [{ address: "0x1000", value: "entry" }],
    [
      { address: "0x2000", value: "display-only" },
      {
        address: "0x2000",
        value: "typed",
        provider_value: "source display",
        string: {
          encoding: "utf-8",
          termination: "present_or_not_required",
          byte_length: 5,
        },
      },
    ],
  );
  expect(await tools.execute("binary_overview", {})).toEqual(
    ok({
      document: "selected",
      procedure_count: 1,
      string_count: 2,
    }),
  );
  expect(await fallbackOverview([], []).execute("binary_overview", {})).toEqual(
    ok({
      document: "selected",
      procedure_count: 0,
      string_count: 0,
    }),
  );
});

import { afterEach, describe, expect, it } from "vitest";
import { EnhancedTools } from "../../../src/application/EnhancedTools.js";
import {
  AnalysisArtifactChangedError,
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
} from "../../../src/domain/analysisErrorCore.js";
import { err } from "../../../src/domain/result.js";
import { observed as ok } from "../../fixtures/analysisExecution.js";
import { GHIDRA_SWIFT_INVENTORY } from "../../fixtures/swift/ghidraInventory.js";
import {
  closeEnhancedToolResources,
  connect,
  jsonResult,
} from "./enhancedToolsHarness.js";

afterEach(closeEnhancedToolResources);

describe("Swift classification through MCP", () => {
  it.each([
    { arguments: {}, total: 6 },
    { arguments: { category: "structs" }, total: 5 },
    { arguments: { category: "structs", pattern: "Pair" }, total: 3 },
    { arguments: { pattern: "_$s4main4PairVMa" }, total: 1 },
  ])("classifies golden Ghidra observations with $arguments", async (test) => {
    const client = await connect({
      execute: async (operation) =>
        ok(
          operation === "list_procedures"
            ? GHIDRA_SWIFT_INVENTORY.procedures
            : GHIDRA_SWIFT_INVENTORY.symbols,
        ),
    });
    const result = await client.callTool({
      name: "analyze_swift_types",
      arguments: test.arguments,
    });
    expect(result.isError).not.toBe(true);
    const inventory = jsonResult(result);
    expect(inventory).toMatchObject({ total: test.total });
    if (test.arguments.pattern === undefined)
      expect(inventory).toMatchObject({
        categories: {
          structs: {
            items: expect.not.arrayContaining([
              expect.objectContaining({ address: "0x100000c0c" }),
            ]),
          },
        },
      });
    if (test.arguments.pattern === undefined)
      expect(jsonResult(result)).toMatchObject({
        unclassified: [
          {
            name: "main::$swiftIndirect",
            reason: "category_not_decoded",
            mangled_names: ["_$s4main13swiftIndirectySiAA7Scoring_p_SitF"],
          },
        ],
      });
    else expect(jsonResult(result)).toMatchObject({ unclassified: [] });
  });

  it("keeps provider names and supporting aliases inline", async () => {
    const client = await connect({
      execute: async (operation) =>
        ok(
          operation === "list_procedures"
            ? GHIDRA_SWIFT_INVENTORY.procedures
            : GHIDRA_SWIFT_INVENTORY.symbols,
        ),
    });
    expect(
      jsonResult(
        await client.callTool({
          name: "analyze_swift_types",
          arguments: { category: "structs", pattern: "typeMetadataAccessor" },
        }),
      ),
    ).toMatchObject({
      total: 2,
      categories: {
        structs: {
          items: [
            {
              address: "0x100000ab4",
              name: "main::Pair::typeMetadataAccessor",
              mangled_names: ["_$s4main4PairVMa"],
            },
            {
              address: "0x100000ac4",
              name: "main::Scorer::typeMetadataAccessor",
              mangled_names: ["_$s4main6ScorerVMa"],
            },
          ],
        },
      },
      unclassified: [],
    });
  });

  it("retains known facts when a provider has no symbol inventory", async () => {
    const client = await connect({
      execute: async (operation) =>
        operation === "list_procedures"
          ? ok([{ address: "0x1", value: "$s4main4PairVMa" }])
          : err(
              new AnalysisCapabilityUnavailableError(
                "fixture",
                operation,
                "no symbols",
              ),
            ),
    });
    const result = await client.callTool({
      name: "analyze_swift_types",
      arguments: { category: "structs" },
    });
    expect(result.isError).not.toBe(true);
    expect(jsonResult(result)).toMatchObject({
      total: 1,
      symbol_inventory_error: { code: "capability_unavailable" },
      limitations: expect.arrayContaining([
        expect.stringContaining("symbol inventory is unavailable"),
      ]),
    });
  });

  it.each([
    new AnalysisOutputError("list_names", "malformed symbols"),
    new AnalysisArtifactChangedError(
      "list_names",
      "/fixture",
      "fixture changed",
    ),
  ])("preserves symbol-inventory failures: $_tag", async (failure) => {
    const tools = new EnhancedTools({
      execute: async (operation) =>
        operation === "list_procedures"
          ? ok([{ address: "0x1", value: "$s4main4PairVMa" }])
          : err(failure),
    });
    expect(await tools.execute("analyze_swift_types", {})).toEqual(
      err(failure),
    );
  });

  it("returns cancellation during the symbol join", async () => {
    const controller = new AbortController();
    const tools = new EnhancedTools({
      execute: async (operation) => {
        if (operation === "list_names") controller.abort();
        return ok([{ address: "0x1", value: "$s4main4PairVMa" }]);
      },
    });
    expect(
      await tools.execute("analyze_swift_types", {}, controller.signal),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisCancelledError" } });
  });
});

describe("Swift category uncertainty through MCP", () => {
  it("keeps unsupported nested Unicode names unresolved through MCP filters", async () => {
    const names = [
      "_$s6Nested8EnvelopeV007IhuqBAbO8describeSSyF",
      "_$s6Nested8EnvelopeV007jvrtDBlCAEycfC",
      "_$s6Nested8EnvelopeV007jvrtDBlCMa",
    ];
    const procedures = [
      ...names.map((name, index) => ({
        address: `0x${String(index + 1)}`,
        value: name,
      })),
      { address: "0x10", value: "_$s6Nested8EnvelopeVMa" },
      { address: "0x11", value: "_$s6Nested8EnvelopeV5InnerCMa" },
      { address: "0x12", value: "_$s6Nested8EnvelopeV5InnerC6methodyyF" },
    ];
    const client = await connect({
      execute: async (operation) =>
        ok(operation === "list_procedures" ? procedures : []),
    });

    const all = jsonResult(
      await client.callTool({
        name: "analyze_swift_types",
        arguments: {},
      }),
    );
    expect(all).toMatchObject({
      total: 6,
      categories: {
        structs: {
          items: [{ name: "_$s6Nested8EnvelopeVMa" }],
        },
        classes: {
          items: [
            { name: "_$s6Nested8EnvelopeV5InnerCMa" },
            { name: "_$s6Nested8EnvelopeV5InnerC6methodyyF" },
          ],
        },
        other: {
          items: names.map((name) => ({ name, mangled_names: [name] })),
        },
      },
      unclassified: names.map((name) => ({
        name,
        mangled_names: [name],
        reason: "category_not_decoded",
      })),
    });

    for (const category of ["classes", "enums"] as const) {
      const filtered = jsonResult(
        await client.callTool({
          name: "analyze_swift_types",
          arguments: { category },
        }),
      );
      expect(filtered).toMatchObject({
        categories: { [category]: { count: category === "classes" ? 2 : 0 } },
        unclassified: names.map((name) => ({
          name,
          mangled_names: [name],
          reason: "category_not_decoded",
        })),
      });
    }
  });
});

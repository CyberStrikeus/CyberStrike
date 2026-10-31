import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  closeEnhancedToolResources,
  connect as connectTool,
  jsonResult,
} from "./enhancedToolsHarness.js";
import {
  createAnalysisExecution,
  type AnalysisExecution,
  type AnalysisOperation,
  type AnalysisOperationPort,
} from "../../../src/application/AnalysisProvider.js";
import type { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisProtocolError,
} from "../../../src/domain/analysisErrorCore.js";
import {
  err,
  ok as resultOk,
  type Result,
} from "../../../src/domain/result.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import { createAnalysisProfile } from "../../../src/domain/analysisProfile.js";
import { observed as ok } from "../../fixtures/analysisExecution.js";

afterEach(closeEnhancedToolResources);

// These fixtures exercise composition for providers without a native overview.
const connect = (analysis: AnalysisOperationPort) =>
  connectTool({
    execute: (operation, parameters, options) =>
      operation === "read_binary_inventory_summary"
        ? Promise.resolve(
            err(
              new AnalysisCapabilityUnavailableError(
                "fixture",
                operation,
                "No native overview",
              ),
            ),
          )
        : analysis.execute(operation, parameters, options),
  });

it("retains distinct class locations and excludes compiler bookkeeping", async () => {
  const client = await connect({
    execute: (name) => {
      if (name === "inspect_native_dispatch_metadata")
        return Promise.resolve(
          err(
            new AnalysisCapabilityUnavailableError(
              "fixture",
              name,
              "Native metadata is unavailable in this provider fixture",
            ),
          ),
        );
      expect(name).toBe("list_names");
      return Promise.resolve(
        ok([
          { address: "0x1", value: "_OBJC_CLASS_$_First" },
          { address: "0x2", value: "_OBJC_CLASS_$_Last" },
          { address: "0x3", value: "_OBJC_CLASS_$_First" },
          { address: "0x4", value: "__OBJC_CLASS_RO_$_First" },
          { address: "0x5", value: "_OBJC_CLASSLIST_REFERENCES_$_" },
          { address: "0x6", value: "l_OBJC_CLASS_NAME_" },
          { address: "0x7", value: "_OBJC_IVAR_$_First.value" },
          { address: "0x8", value: "_OBJC_METACLASS_$_First" },
          { address: "0x9", value: "_OBJC_PROP_$_First.value" },
          { address: "0xa", value: "__OBJC_PROTOCOL_$_Delegate" },
          { address: "0xb", value: "__OBJC_PROTOCOL_$_Delegate" },
          { address: "0xc", value: "__OBJC_PROTOCOL_REFERENCE_$_Delegate" },
          { address: "0xd", value: "_$s4main7ScoringMp" },
          { address: "0xe", value: "_$s4main7ScoringTL" },
          { address: "0xf", value: "_$s4main7ScoringP5scoreSiyFTq" },
          { address: "0x10", value: "l_OBJC_CLASS_Legacy" },
          { address: "0x11", value: "l_OBJC_CLASS_NAME_.1" },
        ]),
      );
    },
  });
  const result = jsonResult(
    await client.callTool({ name: "get_objc_classes", arguments: {} }),
  );
  expect(result).toMatchObject({
    count: 4,
    classes: [
      { address: "0x1", name: "_OBJC_CLASS_$_First" },
      { address: "0x2", name: "_OBJC_CLASS_$_Last" },
      { address: "0x3", name: "_OBJC_CLASS_$_First" },
      { address: "0x10", name: "l_OBJC_CLASS_Legacy" },
    ],
    identity_coverage: { status: "unknown" },
  });
  expect(
    jsonResult(
      await client.callTool({
        name: "get_objc_classes",
        arguments: { pattern: "First" },
      }),
    ),
  ).toMatchObject({
    count: 2,
    identity_coverage: { status: "unknown" },
    classes: [
      { address: "0x1", name: "_OBJC_CLASS_$_First" },
      { address: "0x3", name: "_OBJC_CLASS_$_First" },
    ],
  });
  expect(
    jsonResult(
      await client.callTool({ name: "get_objc_protocols", arguments: {} }),
    ),
  ).toMatchObject({
    count: 2,
    protocols: [
      { address: "0xa", name: "__OBJC_PROTOCOL_$_Delegate" },
      { address: "0xd", name: "_$s4main7ScoringMp" },
    ],
  });
});

it("discovers stripped Hopper class labels through MCP with literal filtering", async () => {
  const names = [
    "__objc_class_HuntRoot_class",
    "__objc_class_HuntSub_class",
    "__objc_class_HuntWorker_class",
    "__objc_class_HuntModel_class",
    "__objc_class_HuntLegacy_class",
    "prefix__objc_class_HuntForeign_class",
    "__objc_class__class",
    "__objc_class_HuntMissingSuffix",
  ];
  const client = await connect({
    execute: (name) => {
      if (name === "inspect_native_dispatch_metadata")
        return Promise.resolve(
          err(
            new AnalysisCapabilityUnavailableError(
              "fixture",
              name,
              "Native metadata is unavailable in this provider fixture",
            ),
          ),
        );
      expect(name).toBe("list_names");
      return Promise.resolve(
        ok(
          names.map((value, index) => ({
            address: `0x${index + 1}`,
            value,
            ...(index < 5
              ? { objc_class_label: "hopper_legacy_class_object" }
              : {}),
          })),
        ),
      );
    },
  });

  const all = jsonResult(
    await client.callTool({ name: "get_objc_classes", arguments: {} }),
  );
  expect(all).toMatchObject({
    count: 5,
    identity_coverage: { status: "unknown" },
    classes: names.slice(0, 5).map((name, index) => ({
      address: `0x${index + 1}`,
      name,
    })),
  });

  const filtered = jsonResult(
    await client.callTool({
      name: "get_objc_classes",
      arguments: { pattern: "__objc_class_HuntRoot_class" },
    }),
  );
  expect(filtered).toMatchObject({
    count: 1,
    classes: [{ address: "0x1", name: "__objc_class_HuntRoot_class" }],
  });
});

it("reports exact selected-image class-import identity through MCP", async () => {
  const hopper = { id: "hopper", name: "Hopper", version: "1" };
  const native = { id: "native", name: "Native", version: "1" };
  const subject = {
    sha256: "a".repeat(64),
    path: "/fixture",
    format: "mach-o" as const,
    architecture: "arm64" as const,
  };
  const targetSelection = {
    kind: "macho-selected-image-v1" as const,
    container: "thin" as const,
    offset: 0,
    byte_length: 4096,
    cpu_type: 0x0100000c,
    cpu_subtype: 0x80000002,
    container_table_sha256: null,
  };
  const profile = createAnalysisProfile(hopper, {
    target_selection: targetSelection,
  });
  const analysis: AnalysisOperationPort = {
    execute: async (operation: AnalysisOperation) => {
      if (operation === "list_names")
        return resultOk(
          createAnalysisExecution(
            [
              { address: "0x1000", value: "OBJC_CLASS_$_Document$GOT" },
              { address: "0x2000", value: "OBJC_CLASS_$_Document" },
            ],
            hopper,
            { subject, analysisProfile: profile },
          ),
        );
      if (operation === "inspect_native_dispatch_metadata")
        return resultOk(
          createAnalysisExecution(
            {
              target_sha256: subject.sha256,
              target_architecture: subject.architecture,
              provider: native,
              analysis_profile_digest: null,
              result: {
                db_save_result: null,
                target_selection: targetSelection,
                objc_class_import_bindings: [
                  {
                    requested_address: "0x1000",
                    symbol: "_OBJC_CLASS_$_Document",
                    binding_source: "chained",
                    library_ordinal: 1,
                    library:
                      "/System/Library/Frameworks/AppKit.framework/AppKit",
                    weak: false,
                    addend: "0",
                  },
                ],
                objc_class_import_binding_coverage: {
                  facet: "objc_class_import_bindings",
                  status: "complete",
                  reason: null,
                  examined: 2,
                  decoded: 1,
                },
              },
            },
            native,
            { subject },
          ),
        );
      throw new Error(`Unexpected operation: ${operation}`);
    },
  };
  const client = await connect(analysis);
  const result = jsonResult(
    await client.callTool({ name: "get_objc_classes", arguments: {} }),
  );
  expect(result).toMatchObject({
    count: 2,
    classes: [
      {
        address: "0x1000",
        name: "OBJC_CLASS_$_Document$GOT",
        binding_identity: {
          symbol: "_OBJC_CLASS_$_Document",
          binding_source: "chained",
          library_ordinal: 1,
          slot_addresses: ["0x1000"],
        },
      },
      { address: "0x2000", name: "OBJC_CLASS_$_Document" },
    ],
    identity_coverage: { status: "complete", reason: null },
  });
});

const completeOverviewPort: AnalysisOperationPort = {
  execute: (name) => {
    switch (name) {
      case "list_segments":
        return Promise.resolve(
          ok([
            {
              name: "__TEXT",
              start: "0x1000",
              end: "0x1800",
              image_base: "0x1000",
              readable: null,
              writable: null,
              executable: null,
            },
            {
              name: "__DATA",
              start: "0x1800",
              end: "0x2000",
              image_base: "0x1000",
              readable: null,
              writable: null,
              executable: null,
            },
          ]),
        );
      case "current_document":
        return Promise.resolve(ok("fixture"));
      case "list_documents":
        return Promise.resolve(ok(["New Document", "fixture"]));
      case "list_strings":
        return Promise.resolve(
          ok(
            Array.from({ length: 700 }, (_, index) => ({
              address: `0x${(0x30 + index).toString(16)}`,
              value: `string-${index}`,
            })),
          ),
        );
      case "list_procedures": {
        return Promise.resolve(
          ok([
            { address: "0x1", value: "first" },
            { address: "0x2", value: "last" },
          ]),
        );
      }
      default:
        throw new Error(`Unexpected analysis operation: ${name}`);
    }
  },
};

describe("enhanced MCP binary overview", () => {
  it("returns the complete overview inline with exhaustive totals", async () => {
    const client = await connect(completeOverviewPort);
    const result = jsonResult(
      await client.callTool({
        name: "binary_overview",
        arguments: {},
      }),
    );
    expect(result).toEqual({
      document: "fixture",
      image_base: "0x1000",
      segments: [
        {
          name: "__TEXT",
          start: "0x1000",
          end: "0x1800",
          length: 2048,
          image_base: "0x1000",
        },
        {
          name: "__DATA",
          start: "0x1800",
          end: "0x2000",
          length: 2048,
          image_base: "0x1000",
        },
      ],
      segment_count: 2,
      procedure_count: 2,
      string_count: 700,
    });
  });

  it("returns binary counts while omitting unavailable segment coverage", async () => {
    const client = await connect({
      execute: (name) => {
        if (name === "current_document")
          return Promise.resolve(
            err(
              new AnalysisCapabilityUnavailableError(
                "fixture",
                name,
                "the provider has one bound document",
              ),
            ),
          );
        if (name === "list_documents")
          return Promise.resolve(ok(["/tmp/fixture.bin"]));
        if (name === "list_segments")
          return Promise.resolve(
            err(
              new AnalysisCapabilityUnavailableError(
                "fixture",
                name,
                "segment enumeration is unsupported",
              ),
            ),
          );
        if (name === "list_procedures" || name === "list_strings")
          return Promise.resolve(ok([]));
        throw new Error(`Unexpected analysis operation: ${name}`);
      },
    });

    expect(
      jsonResult(
        await client.callTool({ name: "binary_overview", arguments: {} }),
      ),
    ).toEqual({
      document: "/tmp/fixture.bin",
      procedure_count: 0,
      string_count: 0,
    });
  });
});

describe("enhanced MCP inventory validation", () => {
  // Injected provider successes verify public MCP composition, not real-provider behavior.
  it.each(["list_procedures", "list_strings"] as const)(
    "rejects malformed successful %s inventory without manufacturing overview counts",
    async (operation) => {
      let inventory: JsonValue = [];
      const client = await connect({
        execute: (name, parameters, options) =>
          name === operation
            ? Promise.resolve(ok(inventory))
            : completeOverviewPort.execute(name, parameters, options),
      });
      for (const malformed of [
        { error: "inventory unavailable" },
        { "0x1000": "obsolete map" },
        [{ address: "0x1000", value: 7 }],
      ]) {
        inventory = malformed;
        const response = await client.callTool({
          name: "binary_overview",
          arguments: {},
        });
        expect(response.isError).toBe(true);
        expect(parseMcpToolError(response).error).toMatchObject({
          code: "unreadable_output",
          details: { operation },
        });
      }
      inventory = [{ address: "0x1000", value: "canonical control" }];
      const response = await client.callTool({
        name: "binary_overview",
        arguments: {},
      });
      expect(response.isError).not.toBe(true);
      expect(jsonResult(response)).toMatchObject({
        document: "fixture",
        procedure_count: operation === "list_procedures" ? 1 : 2,
        string_count: operation === "list_strings" ? 1 : 700,
      });
    },
  );

  it("rejects paginated provider output", async () => {
    const client = await connect({
      execute: () =>
        Promise.resolve(
          ok({
            items: [{ address: "0x1", value: "_TtC5First" }],
          }),
        ),
    });
    const result = await client.callTool({
      name: "analyze_swift_types",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const text = result.content.find((item) => item.type === "text");
    expect(text?.type === "text" ? text.text : "").toBe(
      JSON.stringify(parseMcpToolError(result)),
    );
  });

  it("rejects a segment with omitted coordinates instead of reporting zero length", async () => {
    const client = await connect({
      execute: (name) => {
        if (name === "list_segments")
          return Promise.resolve(
            ok([
              {
                name: "__TEXT",
                end: "0x2000",
                readable: null,
                writable: null,
                executable: null,
              },
            ]),
          );
        if (name === "current_document") return Promise.resolve(ok("fixture"));
        if (name === "list_procedures" || name === "list_strings")
          return Promise.resolve(ok([]));
        throw new Error(`Unexpected analysis operation: ${name}`);
      },
    });
    const result = await client.callTool({
      name: "binary_overview",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContainEqual({
      type: "text",
      text: JSON.stringify(parseMcpToolError(result)),
    });
  });

  it("preserves unknown length for malformed segment coordinates", async () => {
    const client = await connect({
      execute: (name) => {
        if (name === "list_segments")
          return Promise.resolve(
            ok([
              {
                name: "__TEXT",
                start: "unparsed-start",
                end: "0x2000",
                readable: null,
                writable: null,
                executable: null,
              },
            ]),
          );
        if (name === "current_document") return Promise.resolve(ok("fixture"));
        if (name === "list_procedures" || name === "list_strings")
          return Promise.resolve(ok([]));
        throw new Error(`Unexpected analysis operation: ${name}`);
      },
    });
    expect(
      jsonResult(
        await client.callTool({ name: "binary_overview", arguments: {} }),
      ),
    ).toMatchObject({
      segments: [{ name: "__TEXT", start: "unparsed-start", length: null }],
      segment_count: 1,
    });
  });
});

const overviewPort = (
  current: Result<AnalysisExecution, AnalysisError>,
  documents: readonly string[],
): AnalysisOperationPort => ({
  execute: (name) => {
    switch (name) {
      case "current_document":
        return Promise.resolve(current);
      case "list_documents":
        return Promise.resolve(ok([...documents]));
      case "list_segments":
        return Promise.resolve(
          ok([
            {
              name: "text",
              start: "0x1000",
              end: "0x2000",
              readable: null,
              writable: null,
              executable: null,
            },
          ]),
        );
      case "list_procedures":
      case "list_strings":
        return Promise.resolve(ok([]));
      default:
        throw new Error(`Unexpected analysis operation: ${name}`);
    }
  },
});

describe("overview document identity through MCP", () => {
  const unsupported = () =>
    err(
      new AnalysisCapabilityUnavailableError(
        "fixture",
        "current_document",
        "headless provider",
      ),
    );

  it("uses the sole headless document when current-document selection is unsupported", async () => {
    const client = await connect(
      overviewPort(unsupported(), ["single-target"]),
    );
    expect(
      jsonResult(
        await client.callTool({ name: "binary_overview", arguments: {} }),
      ),
    ).toMatchObject({ document: "single-target" });
  });

  it.each([
    { documents: [] },
    { documents: [""] },
    { documents: ["one", "two"] },
  ])(
    "rejects ambiguous or missing headless identities: $documents",
    async ({ documents }) => {
      const client = await connect(overviewPort(unsupported(), documents));
      expect(
        (await client.callTool({ name: "binary_overview", arguments: {} }))
          .isError,
      ).toBe(true);
    },
  );

  it.each([{ value: null }, { value: "" }, { value: [] }])(
    "rejects a malformed current-document result: $value",
    async ({ value }) => {
      const client = await connect(
        overviewPort(ok(value), ["fallback-must-not-hide-error"]),
      );
      expect(
        (await client.callTool({ name: "binary_overview", arguments: {} }))
          .isError,
      ).toBe(true);
    },
  );

  it("preserves non-capability current-document failures", async () => {
    const client = await connect(
      overviewPort(
        err(new AnalysisProtocolError("failed current-document transport")),
        ["must-not-be-selected"],
      ),
    );
    expect(
      (await client.callTool({ name: "binary_overview", arguments: {} }))
        .isError,
    ).toBe(true);
  });

  it("reports document selection unavailable when neither current-document nor list-documents is supported", async () => {
    const client = await connect({
      execute: (name) => {
        if (name === "current_document" || name === "list_documents")
          return Promise.resolve(
            err(
              new AnalysisCapabilityUnavailableError(
                "fixture",
                name,
                "provider lacks document selection",
              ),
            ),
          );
        if (name === "list_segments") return Promise.resolve(ok([]));
        if (name === "list_procedures" || name === "list_strings")
          return Promise.resolve(ok([]));
        throw new Error(`Unexpected analysis operation: ${name}`);
      },
    });
    const result = await client.callTool({
      name: "binary_overview",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(parseMcpToolError(result).error).toMatchObject({
      code: "capability_unavailable",
      details: {
        provider_id: "fixture",
        operation: "list_documents",
        reason: expect.stringContaining("provider lacks document selection"),
      },
    });
  });
});

it("refuses document fallback while the current-selection owner reports incomplete cleanup", async () => {
  const failure = new AnalysisCapabilityUnavailableError(
    "fixture",
    "current_document",
    "Selection unavailable during cleanup",
    {
      cleanup: {
        reason: "controlled live selection resource",
        resources: ["selection owner"],
      },
    },
  );
  const calls: string[] = [];
  const client = await connect({
    execute: async (operation) => {
      calls.push(operation);
      return operation === "current_document"
        ? err(failure)
        : ok(["must-not-be-selected"]);
    },
  });
  const response = await client.callTool({
    name: "binary_overview",
    arguments: {},
  });
  expect(response.isError).toBe(true);
  expect(parseMcpToolError(response).error).toMatchObject({
    code: "cleanup_incomplete",
    details: { operation: "current_document" },
  });
  expect(calls).toEqual(["current_document"]);
  expect(failure.cleanupIncomplete).toBe(true);
});

it("forwards max_input_bytes from the MCP tool to the binary metadata operation", async () => {
  const received: unknown[] = [];
  const client = await connect({
    execute: (name, parameters) => {
      if (name === "inspect_native_dispatch_metadata")
        received.push(parameters);
      return Promise.resolve(
        err(
          new AnalysisCapabilityUnavailableError(
            "fixture",
            name,
            "Metadata is unavailable in this provider fixture",
          ),
        ),
      );
    },
  });
  await client.callTool({
    name: "inspect_native_dispatch_metadata",
    arguments: { max_input_bytes: 134217728 },
  });
  await client.callTool({
    name: "inspect_native_dispatch_metadata",
    arguments: {},
  });
  expect(received).toEqual([
    { max_records: 5000, max_input_bytes: 134217728 },
    { max_records: 5000 },
  ]);
});

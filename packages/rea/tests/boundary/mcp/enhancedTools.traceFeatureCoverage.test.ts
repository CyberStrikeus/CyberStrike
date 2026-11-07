import { afterEach, describe, expect, it } from "vitest";

import type { AnalysisOperationPort } from "../../../src/application/AnalysisProvider.js";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { EnhancedTools } from "../../../src/application/EnhancedTools.js";
import { AnalysisOutputError } from "../../../src/domain/analysisErrorCore.js";
import { err, ok } from "../../../src/domain/result.js";

import { closeEnhancedToolResources, connect } from "./enhancedToolsHarness.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

afterEach(closeEnhancedToolResources);

const PROVIDER = {
  id: "fixture",
  name: "Fixture analysis provider",
  version: "1",
} as const;

type Coverage = boolean | undefined;

interface Behavior {
  /** What the provider reports for the references of each match address. */
  readonly coverage?: Readonly<Record<string, Coverage>>;
  readonly limitations?: readonly string[];
  /** Also report the first string match as a procedure match. */
  readonly duplicateProcedure?: boolean;
  /** Return no reference rows for this address while preserving cap metadata. */
  readonly emptyXrefsOf?: string;
  /** Fail the references read of this address. */
  readonly failXrefsOf?: string;
  readonly calls?: string[];
}

const containing = (address: string) => ({
  query_address: address,
  found: false,
  procedure: null,
  reason: "not_in_procedure",
});

/**
 * A provider with two string matches (0x10 and 0x11), each referenced from
 * one address (0x20 and 0x21).
 */
const provider = (behavior: Behavior = {}): AnalysisOperationPort => ({
  execute: async (name, arguments_) => {
    const address = String(arguments_.address);
    behavior.calls?.push(`${name}:${address}`);
    switch (name) {
      case "search_strings":
        return ok(
          createAnalysisExecution(
            [
              { address: "0x10", value: "hello" },
              { address: "0x11", value: "hello again" },
            ],
            PROVIDER,
          ),
        );
      case "search_procedures":
        return ok(
          createAnalysisExecution(
            behavior.duplicateProcedure === true
              ? [{ address: "0x10", value: "hello" }]
              : [],
            PROVIDER,
          ),
        );
      case "xrefs": {
        if (address === behavior.failXrefsOf)
          return err(new AnalysisOutputError("xrefs", "provider failed"));
        const reported = behavior.coverage?.[address];
        return ok(
          createAnalysisExecution(
            address === behavior.emptyXrefsOf
              ? []
              : [address === "0x10" ? "0x20" : "0x21"],
            PROVIDER,
            {
              limitations: behavior.limitations ?? [],
              ...(reported === undefined
                ? {}
                : { referencesTruncated: reported }),
            },
          ),
        );
      }
      case "resolve_containing_procedure":
        return ok(createAnalysisExecution(containing(address), PROVIDER));
      default:
        throw new Error(`Unexpected operation: ${name}`);
    }
  },
});

const expectedTrace = (
  residual: readonly string[],
  extraMatches: readonly object[] = [],
  emptyReferenceTargets: readonly string[] = [],
) => ({
  query: "hello",
  search_mode: "literal",
  matches: [
    { type: "string", address: "0x10", value: "hello" },
    { type: "string", address: "0x11", value: "hello again" },
    ...extraMatches,
  ],
  references: [
    {
      target_address: "0x10",
      source_address: "0x20",
      containing_procedure: containing("0x20"),
    },
    {
      target_address: "0x11",
      source_address: "0x21",
      containing_procedure: containing("0x21"),
    },
  ].filter(
    ({ target_address }) => !emptyReferenceTargets.includes(target_address),
  ),
  truncated: residual.length > 0,
  residual_unknowns: residual,
});

const unknownFor = (address: string) =>
  `References to ${address} were truncated by the provider; additional references may exist.`;

const trace = async (analysis: AnalysisOperationPort) => {
  const client = await connect(analysis);
  const result = await client.callTool({
    name: "trace_feature",
    arguments: { query: "hello" },
  });
  expect(result.isError).not.toBe(true);
  return result.structuredContent as { normalized_result: unknown };
};

describe("trace_feature reference coverage", () => {
  it("marks the trace truncated for the target whose references the provider capped", async () => {
    const output = await trace(
      provider({ coverage: { "0x10": true, "0x11": false } }),
    );

    expect(
      output.normalized_result,
      "the received references are kept and only the capped target is a residual unknown",
    ).toEqual(expectedTrace([unknownFor("0x10")]));
  });

  it("keeps an empty capped reference page as an unknown, not proof of absence", async () => {
    const output = await trace(
      provider({
        coverage: { "0x10": true, "0x11": false },
        emptyXrefsOf: "0x10",
      }),
    );

    expect(output.normalized_result).toEqual(
      expectedTrace([unknownFor("0x10")], [], ["0x10"]),
    );
  });

  it("does not carry a truncation over to the next target that reports nothing", async () => {
    const output = await trace(provider({ coverage: { "0x10": true } }));

    expect(output.normalized_result).toEqual(
      expectedTrace([unknownFor("0x10")]),
    );
  });

  it("reports a capped target once when it is matched twice", async () => {
    const output = await trace(
      provider({ coverage: { "0x10": true }, duplicateProcedure: true }),
    );

    expect(output.normalized_result).toEqual(
      expectedTrace(
        [unknownFor("0x10")],
        [{ type: "procedure", address: "0x10", value: "hello" }],
      ),
    );
  });

  it("resolves the containing procedure of a repeated reference source once", async () => {
    const calls: string[] = [];
    const output = await trace(provider({ duplicateProcedure: true, calls }));

    expect(
      calls.filter((call) => call.startsWith("resolve_containing_procedure:")),
      "the source 0x20 is referenced by two matches of the same address and resolved once",
    ).toEqual([
      "resolve_containing_procedure:0x20",
      "resolve_containing_procedure:0x21",
    ]);
    expect(
      output.normalized_result,
      "each target's reference set is reported once with its containing procedure",
    ).toEqual(
      expectedTrace(
        [],
        [{ type: "procedure", address: "0x10", value: "hello" }],
      ),
    );
  });

  it("keeps the trace complete when the provider explicitly reports no cap", async () => {
    const output = await trace(
      provider({ coverage: { "0x10": false, "0x11": false } }),
    );

    expect(output.normalized_result).toEqual(expectedTrace([]));
  });

  it("does not change the trace of a provider that reports no coverage", async () => {
    const output = await trace(
      provider({
        limitations: ["Upstream xrefs_to capped results at 1000 references."],
      }),
    );

    expect(
      output.normalized_result,
      "a limitation text alone never truncates, and an absent field keeps the previous result",
    ).toEqual(expectedTrace([]));
  });

  it("never exposes the coverage field in the tool output", async () => {
    const output = await trace(
      provider({ coverage: { "0x10": true, "0x11": false } }),
    );

    expect(JSON.stringify(output)).not.toMatch(
      /referencesTruncated|references_truncated/,
    );
  });

  it("fails the trace when a references read fails and reads nothing further", async () => {
    const calls: string[] = [];
    const result = await new EnhancedTools(
      provider({ failXrefsOf: "0x10", calls }),
    ).execute("trace_feature", { query: "hello" });

    expect(result.ok).toBe(false);
    expect(
      calls.filter((call) => call.startsWith("xrefs:")),
      "the next target is not read after the failure",
    ).toEqual(["xrefs:0x10"]);
  });

  it("stops without reading references when the trace is cancelled", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    controller.abort();
    const result = await new EnhancedTools(provider({ calls })).execute(
      "trace_feature",
      { query: "hello" },
      controller.signal,
    );

    expect(result.ok).toBe(false);
    expect(calls.filter((call) => call.startsWith("xrefs:"))).toEqual([]);
  });
});

it("preserves string search qualifications in trace matches without fabricating them for procedures", async () => {
  const baseline = provider({ duplicateProcedure: true });
  const row = {
    address: "0x10",
    value: "hello",
    provider_value: "provider display",
    decoding: { available: false, reason: "Typed bytes were unavailable." },
    string: {
      encoding: "utf-8",
      encoding_status: "inferred",
      termination: "missing",
      byte_length: 5,
    },
  } as const;
  const output = await trace({
    execute: (operation, input, options) =>
      operation === "search_strings"
        ? Promise.resolve(ok(createAnalysisExecution([row], PROVIDER)))
        : baseline.execute(operation, input, options),
  });
  expect(output.normalized_result).toMatchObject({
    matches: [
      { ...row, type: "string" },
      { type: "procedure", address: "0x10", value: "hello" },
    ],
  });
  expect(
    (output.normalized_result as { matches: object[] }).matches[1],
  ).not.toHaveProperty("string");
});

it("retains each same-address string encoding and reuses the address reference observation", async () => {
  const calls: string[] = [];
  const baseline = provider({ calls });
  // Kuna's canonical inventory identity includes the encoding at each address.
  const rows = ["ascii", "utf8", "utf16"].map((encoding) => ({
    address: "0x10",
    value: "hello",
    string: {
      encoding,
      encoding_status: "observed" as const,
      termination: "present_or_not_required" as const,
      byte_length: encoding === "utf16" ? 12 : 6,
    },
  }));
  const output = await trace({
    execute: (operation, input, options) =>
      operation === "search_strings"
        ? Promise.resolve(ok(createAnalysisExecution(rows, PROVIDER)))
        : baseline.execute(operation, input, options),
  });
  expect(output.normalized_result).toMatchObject({
    matches: rows.map((row) => ({ ...row, type: "string" })),
    references: [
      {
        target_address: "0x10",
        source_address: "0x20",
        containing_procedure: containing("0x20"),
      },
    ],
  });
  expect(calls.filter((call) => call.startsWith("xrefs:"))).toEqual([
    "xrefs:0x10",
  ]);
  expect(
    calls.filter((call) => call.startsWith("resolve_containing_procedure:")),
  ).toEqual(["resolve_containing_procedure:0x20"]);
});

it("keeps duplicate reference rows reported by one provider observation", async () => {
  const baseline = provider();
  const output = await trace({
    execute: (operation, input, options) =>
      operation === "xrefs"
        ? Promise.resolve(
            ok(createAnalysisExecution(["0x20", "0x20"], PROVIDER)),
          )
        : baseline.execute(operation, input, options),
  });
  expect(output.normalized_result).toMatchObject({
    references: ["0x10", "0x10", "0x11", "0x11"].map((address) => ({
      target_address: address,
      source_address: "0x20",
      containing_procedure: containing("0x20"),
    })),
  });
});

it.each([
  null,
  {},
  { query_address: "0x20", found: true, procedure: null },
  { query_address: "0x20", found: false, procedure: null },
])(
  "returns a typed failure for malformed trace reference resolution: %j",
  async (resolution) => {
    const baseline = provider();
    const client = await connect({
      execute: (operation, input, options) =>
        operation === "resolve_containing_procedure"
          ? Promise.resolve(ok(createAnalysisExecution(resolution, PROVIDER)))
          : baseline.execute(operation, input, options),
    });
    const result = await client.callTool({
      name: "trace_feature",
      arguments: { query: "hello" },
    });
    expect(JSON.stringify(result.content)).not.toContain(
      "Output validation error",
    );
    expect(parseMcpToolError(result).error).toMatchObject({
      code: "unreadable_output",
      details: { operation: "resolve_containing_procedure" },
    });
  },
);

it("retains a validated containing procedure and its unavailable body facts", async () => {
  const baseline = provider();
  const resolution = {
    query_address: "0x20",
    found: true,
    procedure: {
      address: "0x20",
      name: "hello_caller",
      classification: null,
      body: { available: false, reason: "Provider has no function ranges." },
    },
  } as const;
  const output = await trace({
    execute: (operation, input, options) =>
      operation === "resolve_containing_procedure"
        ? Promise.resolve(
            ok(
              createAnalysisExecution(
                { ...resolution, query_address: String(input.address) },
                PROVIDER,
              ),
            ),
          )
        : baseline.execute(operation, input, options),
  });
  expect(output.normalized_result).toMatchObject({
    references: [
      { source_address: "0x20", containing_procedure: resolution },
      {
        source_address: "0x21",
        containing_procedure: { ...resolution, query_address: "0x21" },
      },
    ],
  });
});

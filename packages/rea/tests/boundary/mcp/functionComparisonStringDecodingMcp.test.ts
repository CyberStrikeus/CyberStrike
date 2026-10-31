import { beforeEach, describe, expect, it } from "vitest";

import { FUNCTION_COMPARISON_EXAMPLE } from "../../../src/contracts/functionComparisonExample.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { functionDossierSchema } from "../../../src/domain/native/functionDossier.js";
import {
  functionComparisonResultSchema,
  type FunctionComparisonResult as Comparison,
} from "../../../src/domain/functionComparisonSchemas.js";

import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";

const template = FUNCTION_COMPARISON_EXAMPLE.left;
const base = functionDossierSchema.parse(template.normalized_result);

const evidence = (
  id: string,
  strings: readonly (typeof base.referenced_strings)[number][],
  literalValue?: string,
) =>
  createEvidence(
    {
      path: `/fixture/function-string-decoding/${id}`,
      sha256: "1".repeat(64),
      format: "mach-o",
    },
    template.provider,
    {
      operation: "analyze_function",
      parameters: { ...template.parameters, observation: id },
      result: {
        ...base,
        referenced_strings: [...strings],
        swift_string_literals:
          literalValue === undefined
            ? []
            : [
                {
                  source_address: "0x1002",
                  value: literalValue,
                  registers: ["x0", "x1"],
                  words: ["0x1", "0x2"],
                  representation: "small",
                  address: null,
                },
              ],
        swift_string_literal_omissions: [],
      },
      confidence: template.confidence,
      authority: template.authority,
      relationshipCoverage: { status: "complete" },
    },
  );

const reference = (
  value: string,
  options: {
    readonly decoding?: { readonly available: false; readonly reason: string };
    readonly termination?: "missing" | "present_or_not_required";
    readonly byteLength?: number;
    readonly sourceAddress?: string;
    readonly metadata?: boolean;
    readonly encodingStatus?: "observed" | "inferred";
  } = {},
) => ({
  address: "0x2000",
  source_address: options.sourceAddress ?? "0x1000",
  value,
  ...(options.decoding === undefined ? {} : { decoding: options.decoding }),
  ...(options.metadata === false
    ? {}
    : {
        string: {
          encoding: "utf-8",
          ...(options.encodingStatus === undefined
            ? {}
            : { encoding_status: options.encodingStatus }),
          termination: options.termination ?? "present_or_not_required",
          byte_length: options.byteLength ?? 6,
        },
      }),
});

type Compare = (
  left: ReturnType<typeof evidence>,
  right: ReturnType<typeof evidence>,
) => Promise<Comparison>;

let compare: Compare;

beforeEach(async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Function comparison must not launch a provider");
  });
  const { client } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "function-string-decoding-test", version: "1" },
    serverOptions: {
      environment: {
        ...process.env,
        REA_MCP_MAX_INPUT_ELEMENTS: process.env.REA_MCP_MAX_INPUT_ELEMENTS,
      },
    },
  });
  compare = async (left, right) => {
    const response = await client.callTool({
      name: "compare_functions",
      arguments: { left, right },
    });
    expect(
      response.isError,
      JSON.stringify(response.structuredContent),
    ).not.toBe(true);
    return functionComparisonResultSchema.parse(
      parseEvidence(response.structuredContent).normalized_result,
    );
  };
});

const stringsNames = (result: Comparison) =>
  result.dimensions.find(({ dimension }) => dimension === "strings_names");

describe("compare_functions referenced string decoding", () => {
  const reason = "The native string bytes are unavailable";
  const undecodable = (id: string, display: string) =>
    evidence(id, [
      reference(display, { decoding: { available: false, reason } }),
    ]);

  it("keeps unavailable previews unknown even when their display differs", async () => {
    const samePreview = await compare(
      undecodable("1", "display preview"),
      undecodable("2", "display preview"),
    );
    expect(samePreview.status).toBe("unknown");
    expect(stringsNames(samePreview)).toMatchObject({
      status: "unknown",
      limitations: [`Referenced string decoding unavailable: ${reason}`],
    });

    const differentPreview = await compare(
      undecodable("3", "first display preview"),
      undecodable("4", "second display preview"),
    );
    expect(differentPreview.status).toBe("unknown");
  });

  it("compares known typed string facts alongside unavailable content", async () => {
    const metadataChange = await compare(
      evidence("9", [
        reference("display preview", {
          decoding: { available: false, reason },
          byteLength: 6,
        }),
      ]),
      evidence("a", [
        reference("same display preview", {
          decoding: { available: false, reason },
          byteLength: 7,
        }),
      ]),
    );
    expect(metadataChange.status).toBe("changed");

    const mixedKnownChange = await compare(
      evidence("b", [
        reference("uncertain display", {
          decoding: { available: false, reason },
          sourceAddress: "0x1000",
        }),
        reference("before", { sourceAddress: "0x1001" }),
      ]),
      evidence("c", [
        reference("uncertain display", {
          decoding: { available: false, reason },
          sourceAddress: "0x1000",
        }),
        reference("after", { sourceAddress: "0x1001" }),
      ]),
    );
    expect(mixedKnownChange.status).toBe("changed");
  });

  it("retains decoder reasons when strings share a source site", async () => {
    const reason = "Typed string bytes could not be read";
    const rows = [
      reference("display preview", {
        decoding: { available: false, reason },
      }),
      reference("known content"),
    ];
    const result = await compare(
      evidence("repeated-left", rows),
      evidence("repeated-right", rows),
    );
    expect(stringsNames(result)).toMatchObject({
      status: "unknown",
      limitations: expect.arrayContaining([
        `Referenced string decoding unavailable: ${reason}`,
      ]),
    });
  });

  it("compares decoded content and termination facts", async () => {
    const decoded = (
      id: string,
      termination:
        | "missing"
        | "present_or_not_required" = "present_or_not_required",
      byteLength = 6,
    ) => evidence(id, [reference("hello", { termination, byteLength })]);
    const equal = await compare(decoded("5"), decoded("6"));
    expect(equal.status).toBe("unchanged");
    expect(stringsNames(equal)).toMatchObject({
      status: "unchanged",
      left_count: 1,
      right_count: 1,
      left_digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(stringsNames(equal)?.right_digest).toBe(
      stringsNames(equal)?.left_digest,
    );

    const different = await compare(decoded("7"), decoded("8", "missing", 5));
    expect(different.status).toBe("changed");
    expect(stringsNames(different)).toMatchObject({ status: "changed" });
  });

  it("preserves paired metadata absence and ignores encoding provenance", async () => {
    const missingMetadata = await compare(
      evidence("d", [reference("same", { metadata: false })]),
      evidence("e", [reference("same")]),
    );
    expect(missingMetadata.status).toBe("unknown");

    const absentMetadata = await compare(
      evidence("g", [reference("same", { metadata: false })]),
      evidence("h", [reference("same", { metadata: false })]),
    );
    expect(absentMetadata.status).toBe("unchanged");

    const provenanceOnly = await compare(
      evidence("f", [reference("same", { encodingStatus: "observed" })]),
      evidence("0", [reference("same", { encodingStatus: "inferred" })]),
    );
    expect(provenanceOnly.status).toBe("unchanged");
  });

  it("keeps literal changes in the combined string dimension", async () => {
    const changed = await compare(
      evidence("literal-before", [reference("hello")], "literal one"),
      evidence("literal-after", [reference("hello")], "literal two"),
    );
    expect(changed.status).toBe("changed");
    expect(stringsNames(changed)).toMatchObject({
      status: "changed",
      left_count: 2,
      right_count: 2,
      left_digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      right_digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(stringsNames(changed)?.left_digest).not.toBe(
      stringsNames(changed)?.right_digest,
    );
  });
});

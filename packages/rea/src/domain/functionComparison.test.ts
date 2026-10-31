import { functionSnapshotFixture } from "./functionDossierEvidence.fixture.js";
import { describe, expect, it } from "vitest";

import { FUNCTION_COMPARISON_EXAMPLE } from "../contracts/functionComparisonExample.js";
import { enhancedInputSchemas } from "../contracts/enhancedInputs.js";
import { functionComparisonResultSchema } from "./functionComparisonSchemas.js";
import { createFunctionCoordinateContext } from "./native/functionCoordinateContext.js";
import { createAnalysisProfile } from "./analysisProfile.js";
import { createEvidence, type Evidence } from "./evidence.js";
import { functionDossierSchema } from "./native/functionDossier.js";
import { canonicalJson } from "./comparisonSemantics.js";
import { digestCanonicalValue } from "./canonicalDigest.js";
import { compareUnicodeCodePoints } from "./unicodeCodePointOrder.js";
import { jsonValueSchema } from "./jsonValue.js";

import { compareFunctions } from "./functionComparison.js";
import type { RelationshipCoverage } from "./relationshipCoverage.js";
const procedure = (address: string, name: string) => ({
  address,
  name,
  symbol: {
    primary: true,
    dynamic: false,
    external: false,
    type: "function",
    source: "imported" as const,
  },
  classification: null,
  body: {
    available: false as const,
    reason:
      "Hopper's public Python API does not expose complete function body ranges",
  },
});
const dossier = (
  text: string,
  base: "0x1000" | "0x2000",
  successors: readonly string[] = [],
) =>
  functionDossierSchema.parse({
    procedure: {
      ...procedure(base, "main"),
      signature: "int main(void)",
      locals: [],
    },
    pseudocode: text,
    assembly: ["ret"],
    comments: [],
    callers: [],
    callees: [],
    incoming_references: [],
    outgoing_references: [],
    referenced_strings: [],
    referenced_names: [],
    native_api: null,
    native_value_flow: null,
    facet_availability: {
      pseudocode: { available: true },
      assembly: { available: true },
      comments: { available: true },
      callers: { available: true },
      callees: { available: true },
      references: { available: true },
      strings_names: { available: true },
      cfg: { available: true },
    },
    basic_blocks: [
      {
        start: base,
        end: base === "0x1000" ? "0x1001" : "0x2001",
        successors,
      },
    ],
    limitations: [],
  });

const dossierWithReference = (
  base: "0x1000" | "0x2000",
  kind: "call" | "data" | "unavailable",
) => {
  const target = base === "0x1000" ? "0x1010" : "0x2010";
  return functionDossierSchema.parse({
    ...dossier("return helper();", base),
    outgoing_references: [
      {
        source_address: base,
        target_address: target,
        source_procedure: procedure(base, "main"),
        target_procedure: procedure(target, "helper"),
        kind:
          kind === "unavailable"
            ? { available: false, reason: "provider has no kind authority" }
            : {
                available: true,
                provenance: "ghidra-reference-manager",
                type: kind === "call" ? "UNCONDITIONAL_CALL" : "READ",
                flow: kind === "call",
                call: kind === "call",
                jump: false,
                data: kind === "data",
                read: kind === "data",
                write: false,
                indirect: false,
                computed: false,
                conditional: false,
                terminal: false,
                primary: true,
                operand_index: 0,
                external: false,
              },
      },
    ],
  });
};

const observe = (
  digit: string,
  value: ReturnType<typeof dossier>,
  providerId = "rea-workflow",
  relationshipCoverage: RelationshipCoverage | null = { status: "complete" },
): Evidence =>
  createEvidence(
    {
      path: `/tmp/function-${digit}`,
      sha256: digit.repeat(64),
      format: "mach-o",
      architecture: "arm64",
    },
    { id: providerId, name: providerId, version: "1" },
    {
      operation: "analyze_function",
      analysisProfile: createAnalysisProfile(
        { id: providerId, name: providerId, version: "1" },
        {
          architecture: "arm64",
          loader: "auto-from-header",
          function_coordinate_context: createFunctionCoordinateContext({
            loader: "auto-from-header",
            language_id: "auto-from-header",
            compiler_spec_id: "auto-default",
            load_segment: null,
            address_coordinates: null,
            entry_point: null,
          }),
        },
      ),
      parameters: enhancedInputSchemas.analyze_function.parse({
        procedure: "main",
      }),
      result: jsonValueSchema.parse(value),
      confidence: "derived",
      authority: "shipped-artifact",
      ...(relationshipCoverage === null ? {} : { relationshipCoverage }),
    },
  );

const rejectsMalformedFacetAvailability = (): void => {
  expect(
    functionDossierSchema.safeParse({
      ...dossier("return 0;", "0x1000"),
      facet_availability: { cfg: { available: false, reason: "" } },
    }).success,
  ).toBe(false);
  expect(
    functionDossierSchema.safeParse({
      ...dossier("return 0;", "0x1000"),
      facet_availability: { cfg: undefined },
    }).success,
  ).toBe(false);
};

it.each(["imported", null] as const)(
  "preserves same-entry correspondence across a rename from symbol origin %s",
  (origin) => {
    const before = dossier("int evaluate(void) { return 0; }", "0x1000");
    before.procedure.name = "evaluate";
    before.procedure.symbol =
      origin === null
        ? null
        : { ...procedure("0x1000", "evaluate").symbol, source: origin };
    const after = functionDossierSchema.parse({
      ...before,
      procedure: {
        ...before.procedure,
        name: "renamed_evaluate",
        symbol: {
          ...procedure("0x1000", "evaluate").symbol,
          source: "user_defined",
        },
      },
      pseudocode: "int renamed_evaluate(void) { return 0; }",
    });
    const left = observe("a", before);
    const right = observe("a", after);
    const result = compareFunctions(
      functionSnapshotFixture(left),
      functionSnapshotFixture(right),
    );
    expect(result.function_match).toMatchObject({
      status: "matched",
      method: "same-entry",
      left_name: "evaluate",
      right_name: "renamed_evaluate",
    });
    expect(result.status).toBe("changed");
    for (const name of ["identity", "pseudocode"])
      expect(
        result.dimensions.find(({ dimension }) => dimension === name),
      ).toMatchObject({ status: "changed" });
    expect(
      result.dimensions.find(({ dimension }) => dimension === "assembly"),
    ).toMatchObject({ status: "unchanged" });
    expect(
      result.dimensions.every(
        ({ evidence_links }) =>
          evidence_links.includes(left.evidence_id) &&
          evidence_links.includes(right.evidence_id),
      ),
    ).toBe(true);
  },
);

const keepsGeneratedNamesAmbiguous = (): void => {
  const named = (base: "0x1000" | "0x2000", name: string) =>
    functionDossierSchema.parse({
      ...dossier("return 0;", base),
      procedure: {
        ...procedure(base, name),
        signature: "int helper(void)",
        locals: [],
      },
    });
  const unknownOrigin = (base: "0x1000" | "0x2000", name: string) => {
    const value = named(base, name);
    return functionDossierSchema.parse({
      ...value,
      procedure: { ...value.procedure, symbol: null },
    });
  };
  const generated = compareFunctions(
    functionSnapshotFixture(observe("1", unknownOrigin("0x1000", "sub_1000"))),
    functionSnapshotFixture(observe("2", unknownOrigin("0x2000", "sub_2000"))),
  );
  expect(generated.function_match.status).toBe("ambiguous");
  expect(generated.status).toBe("unknown");
  expect(
    generated.dimensions.find(({ dimension }) => dimension === "identity"),
  ).toMatchObject({ status: "unknown" });

  const stable = compareFunctions(
    functionSnapshotFixture(observe("3", named("0x1000", "firstFunction"))),
    functionSnapshotFixture(observe("4", named("0x2000", "secondFunction"))),
  );
  expect(stable.function_match.status).toBe("mismatched");
  expect(stable.status).toBe("changed");
};

describe("function comparison normalized identity", () => {
  it("retains unresolved call details alongside missing facet coverage", () => {
    const value: Record<string, unknown> = {
      ...dossier("return 0;", "0x1000"),
      unresolved_calls: [
        { address: "0x1010", reason: "Unknown indirect target" },
      ],
    };
    delete value.facet_availability;
    const legacy = observe("a", functionDossierSchema.parse(value), "ida");
    const calls = compareFunctions(
      functionSnapshotFixture(legacy),
      functionSnapshotFixture(legacy),
    ).dimensions.find(({ dimension }) => dimension === "calls");
    expect(calls).toMatchObject({
      status: "unknown",
      limitations: expect.arrayContaining([
        "Left: Unresolved call at 0x1010: Unknown indirect target",
        "Left: callers: Provider did not declare coverage for this empty facet.",
      ]),
    });
  });
  it("keeps empty legacy facets without coverage declarations unknown", () => {
    const value: Record<string, unknown> = {
      ...dossier("return 0;", "0x1000"),
      basic_blocks: [],
    };
    delete value.facet_availability;
    const legacy = observe("a", functionDossierSchema.parse(value), "ida");
    const result = compareFunctions(
      functionSnapshotFixture(legacy),
      functionSnapshotFixture(legacy),
    );
    for (const dimension of [
      "comments",
      "references",
      "strings_names",
      "cfg",
      "calls",
    ]) {
      expect(
        result.dimensions.find((item) => item.dimension === dimension),
      ).toMatchObject({ status: "unknown" });
    }
  });
  it("keeps unavailable facets unknown even when one side supplies values", () => {
    const left = observe(
      "a",
      functionDossierSchema.parse({
        ...dossier("return 0;", "0x1000"),
        facet_availability: {
          comments: { available: false, reason: "Not collected" },
        },
        comments: [
          { address: "0x1000", kind: "comment", text: "partial record" },
        ],
      }),
    );
    const right = observe("b", dossier("return 0;", "0x2000"));
    expect(
      compareFunctions(
        functionSnapshotFixture(left),
        functionSnapshotFixture(right),
      ).dimensions.find(({ dimension }) => dimension === "comments"),
    ).toMatchObject({ status: "unknown", left_count: null, right_count: null });
  });
  it(
    "rejects malformed facet availability instead of treating it as absence",
    rejectsMalformedFacetAvailability,
  );
  it(
    "keeps differing generated names ambiguous and stable names mismatched",
    keepsGeneratedNamesAmbiguous,
  );

  it.each([
    "sub_deallocate",
    "sub_deadbeef_handler",
    "fcn.dispatch",
    "EntryPoint",
    "FUN_deadBEEF",
  ])(
    "recognizes the explicit symbol %s without a generated-name prefix false positive",
    (name) => {
      const named = (base: "0x1000" | "0x2000") =>
        functionDossierSchema.parse({
          ...dossier("return 0;", base),
          procedure: {
            ...procedure(base, name),
            name,
            signature: "int helper(void)",
            locals: [],
          },
        });
      const result = compareFunctions(
        functionSnapshotFixture(observe("b", named("0x1000"))),
        functionSnapshotFixture(observe("c", named("0x2000"))),
      );
      expect(result.function_match).toMatchObject({
        status: "matched",
        method: "symbol",
      });
      expect(
        result.dimensions.find(({ dimension }) => dimension === "identity"),
      ).toMatchObject({ status: "unchanged" });
    },
  );

  it.each(["sub_deadbeef", "fcn.00401000", "FUN_deadBEEF", "EntryPoint"])(
    "keeps unqualified label %s unknown regardless of spelling",
    (name) => {
      const generated = (base: "0x1000" | "0x2000") =>
        functionDossierSchema.parse({
          ...dossier("return 0;", base),
          procedure: {
            ...procedure(base, name),
            symbol: null,
            name,
            signature: "int helper(void)",
            locals: [],
          },
        });
      const result = compareFunctions(
        functionSnapshotFixture(observe("d", generated("0x1000"))),
        functionSnapshotFixture(observe("e", generated("0x2000"))),
      );
      expect(result.function_match.status).toBe("ambiguous");
      expect(
        result.dimensions.find(({ dimension }) => dimension === "identity"),
      ).toMatchObject({ status: "unknown" });
    },
  );
});

describe("function comparison address-derived call names", () => {
  it.each([
    {
      name: "sub_deallocate",
      source: "imported",
      status: "unchanged",
      diagnostic: undefined,
    },
    {
      name: "sub_deadbeef",
      source: "default",
      status: "unknown",
      diagnostic: "Provider retained an unresolved call target.",
    },
    {
      name: "FUN_00401000",
      source: "default",
      status: "unknown",
      diagnostic: undefined,
    },
    {
      name: "FUN_initialize",
      source: "imported",
      status: "unchanged",
      diagnostic: undefined,
    },
  ])(
    "preserves the calls dimension for callee $name",
    ({ name, source, status, diagnostic }) => {
      const calling = (base: "0x1000" | "0x2000") =>
        functionDossierSchema.parse({
          ...dossier("return helper();", base),
          callees: [
            {
              ...procedure(base === "0x1000" ? "0x1010" : "0x2010", name),
              symbol: { ...procedure(base, name).symbol, source },
            },
          ],
        });
      const result = compareFunctions(
        functionSnapshotFixture(observe("6", calling("0x1000"))),
        functionSnapshotFixture(
          observe(
            "7",
            calling("0x2000"),
            "rea-workflow",
            diagnostic === undefined
              ? { status: "complete" }
              : { status: "complete", diagnostics: [diagnostic] },
          ),
        ),
      );
      const calls = result.dimensions.find(
        ({ dimension }) => dimension === "calls",
      );
      expect(calls).toMatchObject({ status });
      if (diagnostic !== undefined)
        expect(calls).toMatchObject({
          status: "unknown",
          limitations: expect.arrayContaining([
            "Unnamed relationship endpoints, generated symbols and unknown symbol origins have no stable identity outside a common executable coordinate context.",
            `Right: ${diagnostic}`,
          ]),
        });
    },
  );
});

describe("function call relationship coverage", () => {
  const coverageCases: {
    readonly label: string;
    readonly coverage: RelationshipCoverage | null;
    readonly limitation: string;
  }[] = [
    {
      label: "missing",
      coverage: null,
      limitation: "Provider did not report relationship coverage.",
    },
    {
      label: "partial",
      coverage: {
        status: "partial",
        limitations: ["Call graph stopped at the read limit."],
      },
      limitation: "Call graph stopped at the read limit.",
    },
  ];
  it.each(coverageCases)(
    "keeps equal empty calls unknown for $label coverage",
    ({ coverage, limitation }) => {
      const left = observe("a", dossier("return 0;", "0x1000"));
      const right = observe(
        "b",
        dossier("return 0;", "0x2000"),
        "rea-workflow",
        coverage,
      );
      const result = compareFunctions(
        functionSnapshotFixture(left),
        functionSnapshotFixture(right),
      );
      const calls = result.dimensions.find(
        ({ dimension }) => dimension === "calls",
      );
      expect(calls).toMatchObject({
        status: "unknown",
        conclusion_kind: "unresolved_branch",
        left_count: 0,
        right_count: 0,
        limitations: [`Right: ${limitation}`],
      });
      expect(result.status).toBe("unknown");
    },
  );

  it("retains complete observations with execution diagnostics as comparable", () => {
    const coverage = {
      status: "complete" as const,
      diagnostics: ["Provider reported a non-call xref warning."],
    };
    const left = observe(
      "c",
      dossier("return 0;", "0x1000"),
      "rea-workflow",
      coverage,
    );
    const right = observe(
      "d",
      dossier("return 0;", "0x2000"),
      "rea-workflow",
      coverage,
    );
    expect(
      compareFunctions(
        functionSnapshotFixture(left),
        functionSnapshotFixture(right),
      ).dimensions.find(({ dimension }) => dimension === "calls"),
    ).toMatchObject({ status: "unchanged", left_count: 0, right_count: 0 });
  });

  it("keeps unresolved call sites unknown despite complete resolved-set coverage", () => {
    const left = observe("e", dossier("return 0;", "0x1000"));
    const rightDossier = functionDossierSchema.parse({
      ...dossier("return 0;", "0x2000"),
      unresolved_calls: [
        {
          address: "0x2010",
          reason: "Indirect dispatch target could not be resolved.",
        },
      ],
    });
    const right = observe("f", rightDossier);
    expect(
      compareFunctions(
        functionSnapshotFixture(left),
        functionSnapshotFixture(right),
      ).dimensions.find(({ dimension }) => dimension === "calls"),
    ).toMatchObject({
      status: "unknown",
      limitations: [
        "Right: Unresolved call at 0x2010: Indirect dispatch target could not be resolved.",
      ],
    });
  });
});

describe("function collection collation ties", () => {
  const composed = procedure("0x2000", "caf\u00e9");
  const decomposed = procedure("0x3000", "cafe\u0301");
  const calling = (callees: readonly ReturnType<typeof procedure>[]) =>
    functionDossierSchema.parse({
      ...dossier("return 0;", "0x1000"),
      callees,
    });

  it("ignores reordered callees whose distinct names collate equally", () => {
    const result = compareFunctions(
      functionSnapshotFixture(observe("b", calling([composed, decomposed]))),
      functionSnapshotFixture(observe("c", calling([decomposed, composed]))),
    );
    expect(result.status).toBe("unchanged");
    const calls = result.dimensions.find(
      ({ dimension }) => dimension === "calls",
    );
    expect(calls).toMatchObject({
      status: "unchanged",
      left_count: 2,
      right_count: 2,
    });
    expect(calls?.left_digest).toBe(calls?.right_digest);
  });

  it.each([
    ["remove composed", [decomposed]],
    ["remove decomposed", [composed]],
    ["replace composed", [decomposed, decomposed]],
    ["replace decomposed", [composed, composed]],
  ] as const)("preserves an exact name change: %s", (_label, changed) => {
    const result = compareFunctions(
      functionSnapshotFixture(observe("b", calling([composed, decomposed]))),
      functionSnapshotFixture(observe("c", calling(changed))),
    );
    expect(result.status).toBe("changed");
    const calls = result.dimensions.find(
      ({ dimension }) => dimension === "calls",
    );
    expect(calls).toMatchObject({
      status: "changed",
      left_digest: expect.any(String),
      right_digest: expect.any(String),
    });
    expect(calls?.left_digest).not.toBe(calls?.right_digest);
  });

  it("uses canonical code-point ordering for collection digests", () => {
    const callees = ["zeta", "Alpha", "alpha", "_helper", "beta"].map(
      (name, index) => procedure(`0x${(0x2000 + index).toString(16)}`, name),
    );
    const canonicalProjection = callees
      .map(({ name }) => ({
        direction: "out",
        source: null,
        target: { kind: "name", name, ambiguous: false },
        kind: null,
      }))
      .sort((left, right) =>
        compareUnicodeCodePoints(canonicalJson(left), canonicalJson(right)),
      );
    const result = compareFunctions(
      functionSnapshotFixture(observe("b", calling(callees))),
      functionSnapshotFixture(observe("c", calling([...callees].reverse()))),
    );
    const calls = result.dimensions.find(
      ({ dimension }) => dimension === "calls",
    );
    expect(calls).toMatchObject({
      status: "unchanged",
      left_digest: digestCanonicalValue(canonicalProjection),
      right_digest: digestCanonicalValue(canonicalProjection),
    });
  });
});

describe("function comparison ordering controls", () => {
  it("preserves duplicate Unicode collections and nullable endpoints", () => {
    const controlled = (base: "0x1000" | "0x2000", reverse: boolean) => {
      const endpoint = base === "0x1000" ? "0x1010" : "0x2010";
      const composed = procedure(endpoint, "caf\u00e9");
      const decomposed = procedure(
        base === "0x1000" ? "0x1020" : "0x2020",
        "cafe\u0301",
      );
      const edges = [
        {
          source_address: base,
          target_address: endpoint,
          source_procedure: null,
          target_procedure: procedure(endpoint, "caf\u00e9"),
          kind: {
            available: true,
            provenance: "provider-reference-manager",
            type: "UNCONDITIONAL_CALL",
            flow: true,
            call: true,
            jump: false,
            data: false,
            read: false,
            write: false,
            indirect: false,
            computed: false,
            conditional: false,
            terminal: false,
            primary: true,
            operand_index: 0,
            external: false,
          },
        },
        {
          source_address: base,
          target_address: endpoint,
          source_procedure: procedure(base, "dispatch"),
          target_procedure: null,
          kind: {
            available: true,
            provenance: "provider-reference-manager",
            type: "READ",
            flow: false,
            call: false,
            jump: false,
            data: true,
            read: true,
            write: false,
            indirect: false,
            computed: false,
            conditional: false,
            terminal: false,
            primary: true,
            operand_index: 1,
            external: false,
          },
        },
      ];
      const strings = [
        { address: endpoint, source_address: base, value: "caf\u00e9" },
        { address: endpoint, source_address: base, value: "cafe\u0301" },
        { address: endpoint, source_address: base, value: "cafe\u0301" },
      ];
      return functionDossierSchema.parse({
        ...dossier("return 0;", base),
        callees: [composed, decomposed, composed],
        incoming_references: reverse ? [...edges].reverse() : edges,
        outgoing_references: reverse ? [...edges].reverse() : edges,
        referenced_strings: reverse ? [...strings].reverse() : strings,
        referenced_names: reverse ? [...strings].reverse() : strings,
      });
    };
    const makeEvidence = (digit: string, result: unknown): Evidence =>
      createEvidence(
        {
          path: `/tmp/function-${digit}`,
          sha256: digit.repeat(64),
          format: "mach-o",
        },
        { id: "rea-workflow", name: "REA workflow", version: "1" },
        {
          operation: "analyze_function",
          parameters: enhancedInputSchemas.analyze_function.parse({
            procedure: "dispatch",
          }),
          result,
          confidence: "derived",
          authority: "shipped-artifact",
          relationshipCoverage: { status: "complete" },
        },
      );
    const left = controlled("0x1000", false);
    const right = controlled("0x2000", true);
    const rightWithoutNativeApi = { ...right, native_api: null };

    const comparison = compareFunctions(
      functionSnapshotFixture(makeEvidence("d", left)),
      functionSnapshotFixture(makeEvidence("e", rightWithoutNativeApi)),
    );

    for (const dimension of ["calls", "strings_names"] as const)
      expect(
        comparison.dimensions.find((item) => item.dimension === dimension),
      ).toMatchObject({ status: "unchanged" });
    // Unnamed endpoints in different artifacts have no stable identity.
    expect(
      comparison.dimensions.find((item) => item.dimension === "references"),
    ).toMatchObject({
      status: "unknown",
      limitations: expect.arrayContaining([
        expect.stringContaining("Unnamed relationship endpoints"),
      ]),
    });
    expect(comparison.status).toBe("unknown");
  });
});

describe("function comparison CFG address normalization", () => {
  it.each([
    { start: "ram:0x1000", end: "rom:0x1004", successors: [] },
    { start: "ram:0x1000", end: "ram:0x1004", successors: ["rom:0x1000"] },
    { start: "ram:0x1000", end: "ram:0x1004", successors: ["0x1000"] },
    { start: "ram::0x1000", end: "ram::0x1004", successors: [] },
  ])("keeps incompatible CFG coordinates unknown: %j", (block) => {
    const value = functionDossierSchema.parse({
      ...dossier("return 0;", "0x1000"),
      basic_blocks: [block],
    });
    const source = functionSnapshotFixture(observe("a", value));
    expect(
      compareFunctions(source, source).dimensions.find(
        ({ dimension }) => dimension === "cfg",
      ),
    ).toMatchObject({ status: "unknown" });
  });

  it("keeps disconnected blocks in different spaces unknown", () => {
    const value = functionDossierSchema.parse({
      ...dossier("return 0;", "0x1000"),
      basic_blocks: [
        { start: "ram:0x1000", end: "ram:0x1004", successors: [] },
        { start: "rom:0x2000", end: "rom:0x2004", successors: [] },
      ],
    });
    const source = functionSnapshotFixture(observe("a", value));
    expect(
      compareFunctions(source, source).dimensions.find(
        ({ dimension }) => dimension === "cfg",
      ),
    ).toMatchObject({ status: "unknown" });
  });

  it.each(["rom:0x1004", "RAM:0x1004", "0x1004", "ram:0x0fff"])(
    "keeps non-relative comment and reference sites unknown: %s",
    (site) => {
      const value = functionDossierSchema.parse({
        ...dossier("return 0;", "0x1000"),
        procedure: {
          ...procedure("ram:0x1000", "main"),
          signature: null,
          locals: [],
        },
        comments: [{ address: site, kind: "comment", text: "marker" }],
        referenced_strings: [
          { address: "rom:0x9000", source_address: site, value: "marker" },
        ],
      });
      const source = functionSnapshotFixture(observe("a", value));
      for (const dimension of ["comments", "strings_names"])
        expect(
          compareFunctions(source, source).dimensions.find(
            (item) => item.dimension === dimension,
          ),
        ).toMatchObject({ status: "unknown" });
    },
  );

  it("matches CFG successors by numeric address", () => {
    const make = (base: "0x1000" | "0x2000") =>
      functionDossierSchema.parse({
        ...dossier("return 0;", base),
        basic_blocks: [
          {
            start: base,
            end: base === "0x1000" ? "0x1004" : "0x2004",
            successors: [base === "0x1000" ? "0X01004" : "0x2004"],
          },
          {
            start: base === "0x1000" ? "0x1004" : "0x2004",
            end: base === "0x1000" ? "0x1008" : "0x2008",
            successors: [],
          },
        ],
      });
    expect(
      compareFunctions(
        functionSnapshotFixture(observe("b", make("0x1000"))),
        functionSnapshotFixture(observe("c", make("0x2000"))),
      ).dimensions.find(({ dimension }) => dimension === "cfg"),
    ).toMatchObject({ status: "unchanged" });
  });

  it("keeps duplicate numeric block starts unknown", () => {
    const duplicate = functionDossierSchema.parse({
      ...dossier("return 0;", "0x1000"),
      basic_blocks: [
        { start: "0x1000", end: "0x1004", successors: [] },
        { start: "0X01000", end: "0x1008", successors: [] },
      ],
    });
    expect(
      compareFunctions(
        functionSnapshotFixture(observe("d", duplicate)),
        functionSnapshotFixture(observe("e", duplicate)),
      ).dimensions.find(({ dimension }) => dimension === "cfg"),
    ).toMatchObject({ status: "unknown" });
  });
});

describe("function comparison unresolved text", () => {
  it("qualifies exact text changes caused by relocated provider labels", () => {
    const left = observe(
      "2",
      functionDossierSchema.parse({
        ...dossier("return FUN_00001010(DAT_00001020) % 3;", "0x1000"),
        assembly: ["0x1000 call FUN_00001010", "0x1004 ret"],
      }),
    );
    const right = observe(
      "3",
      functionDossierSchema.parse({
        ...dossier("return FUN_00002010(DAT_00002020) % 3;", "0x2000"),
        assembly: ["0x2000 call FUN_00002010", "0x2004 ret"],
      }),
    );
    const comparison = compareFunctions(
      functionSnapshotFixture(left),
      functionSnapshotFixture(right),
    );
    for (const name of ["pseudocode", "assembly"]) {
      const dimension = comparison.dimensions.find(
        ({ dimension }) => dimension === name,
      );
      expect(dimension).toMatchObject({
        status: "changed",
        limitations: expect.arrayContaining([
          expect.stringContaining(
            "layout-only differences do not establish a behavior change",
          ),
        ]),
      });
    }
    expect(
      comparison.dimensions.find(({ dimension }) => dimension === "cfg"),
    ).toMatchObject({ status: "unchanged" });
  });

  it("counts Unicode text consistently for unresolved provider comparisons", () => {
    const left = observe("b", dossier("return '😀';", "0x1000"), "provider-a");
    const right = observe("c", dossier("return '😀';", "0x2000"), "provider-b");
    const comparison = compareFunctions(
      functionSnapshotFixture(left),
      functionSnapshotFixture(right),
    );
    expect(
      comparison.dimensions.find(({ dimension }) => dimension === "pseudocode"),
    ).toMatchObject({ status: "unknown", left_count: 11, right_count: 11 });
    expect(comparison.summary).toEqual({
      unchanged: 6,
      changed: 0,
      unknown: 2,
    });
    expect(
      functionComparisonResultSchema.safeParse({
        ...comparison,
        status: "truncated",
      }).success,
    ).toBe(false);
  });
});

describe("function comparison", () => {
  it("retains complete call coverage diagnostics without blocking observed-set equality", () => {
    const diagnostic = "Indirect calls remain unresolved.";
    const left = observe("a", dossier("return 0;", "0x1000"), "rea-workflow", {
      status: "complete",
      diagnostics: [diagnostic],
    });
    const right = observe("b", dossier("return 0;", "0x2000"), "rea-workflow", {
      status: "complete",
      diagnostics: [diagnostic],
    });
    const comparison = compareFunctions(
      functionSnapshotFixture(left),
      functionSnapshotFixture(right),
    );
    expect(
      comparison.dimensions.find(({ dimension }) => dimension === "calls"),
    ).toMatchObject({
      status: "unchanged",
      limitations: [`Left: ${diagnostic}`, `Right: ${diagnostic}`],
    });
  });

  it("retains diagnostics alongside incomplete call coverage blockers", () => {
    const diagnostic = "Indirect calls remain unresolved.";
    const left = observe("c", dossier("return 0;", "0x1000"), "rea-workflow", {
      status: "partial",
      limitations: ["Provider read limit reached."],
      diagnostics: [diagnostic],
    });
    const right = observe("d", dossier("return 0;", "0x2000"), "rea-workflow", {
      status: "partial",
      limitations: ["Provider read limit reached."],
      diagnostics: [diagnostic],
    });
    expect(
      compareFunctions(
        functionSnapshotFixture(left),
        functionSnapshotFixture(right),
      ).dimensions.find(({ dimension }) => dimension === "calls"),
    ).toMatchObject({
      status: "unknown",
      limitations: expect.arrayContaining([
        "Left: Provider read limit reached.",
        `Left: ${diagnostic}`,
        "Right: Provider read limit reached.",
        `Right: ${diagnostic}`,
      ]),
    });
  });

  it("preserves text changes alongside complete inline dossier facets", () => {
    const result = compareFunctions(
      functionSnapshotFixture(FUNCTION_COMPARISON_EXAMPLE.left),
      functionSnapshotFixture(FUNCTION_COMPARISON_EXAMPLE.right),
    );
    expect(functionComparisonResultSchema.parse(result)).toMatchObject({
      status: "changed",
      function_match: { status: "matched", method: "symbol" },
    });
    expect(result.dimensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: "pseudocode", status: "changed" }),
        expect.objectContaining({ dimension: "assembly", status: "unchanged" }),
        expect.objectContaining({
          dimension: "references",
          status: "unchanged",
        }),
      ]),
    );
    expectInlineComparisonEvidence(result);
    expectFunctionDimensionAlgebra(result);
  });
});

describe("function comparison normalization and provenance", () => {
  it("normalizes CFG relocation but preserves changed edges and constants", () => {
    const left = observe("2", dossier("return 0x10;", "0x1000"));
    const relocated = observe("3", dossier("return 0x10;", "0x2000"));
    const same = compareFunctions(
      functionSnapshotFixture(left),
      functionSnapshotFixture(relocated),
    );
    expect(
      same.dimensions.find(({ dimension }) => dimension === "cfg"),
    ).toMatchObject({
      status: "unchanged",
    });
    expect(
      same.dimensions.find(({ dimension }) => dimension === "pseudocode"),
    ).toMatchObject({ status: "unchanged" });

    const changed = observe("4", dossier("return 0x20;", "0x2000", ["0x2000"]));
    const comparison = compareFunctions(
      functionSnapshotFixture(left),
      functionSnapshotFixture(changed),
    );
    expect(
      comparison.dimensions.find(({ dimension }) => dimension === "cfg"),
    ).toMatchObject({ status: "changed" });
    expect(
      comparison.dimensions.find(({ dimension }) => dimension === "pseudocode"),
    ).toMatchObject({ status: "changed" });
  });

  it("treats provider-specific text as unknown and validates Evidence", () => {
    const left = observe("5", dossier("return 0;", "0x1000"), "provider-a");
    const right = observe("6", dossier("return 1;", "0x2000"), "provider-b");
    const comparison = compareFunctions(
      functionSnapshotFixture(left),
      functionSnapshotFixture(right),
    );
    expect(
      comparison.dimensions.find(({ dimension }) => dimension === "pseudocode"),
    ).toMatchObject({ status: "unknown" });
    expect(comparison.changes).toHaveLength(2);
    expect(() =>
      compareFunctions(
        functionSnapshotFixture({ ...left, operation: "binary_overview" }),
        functionSnapshotFixture(right),
      ),
    ).toThrow(/identifier/u);
  });

  it("reports fully observed identical dossiers as unchanged", () => {
    const left = observe("7", dossier("return 0;\n", "0x1000"));
    const right = observe("8", dossier("return 0;\n", "0x2000"));
    const comparison = compareFunctions(
      functionSnapshotFixture(left),
      functionSnapshotFixture(right),
    );
    expect(comparison.status).toBe("unchanged");
    expect(
      comparison.dimensions.every(({ status }) => status === "unchanged"),
    ).toBe(true);
  });

  it("compares exact reference kinds only when both providers expose them", () => {
    const left = observe("d", dossierWithReference("0x1000", "call"));
    const same = observe("e", dossierWithReference("0x2000", "call"));
    expect(
      compareFunctions(
        functionSnapshotFixture(left),
        functionSnapshotFixture(same),
      ).dimensions.find(({ dimension }) => dimension === "references"),
    ).toMatchObject({ status: "unchanged" });

    const changed = observe("f", dossierWithReference("0x2000", "data"));
    expect(
      compareFunctions(
        functionSnapshotFixture(left),
        functionSnapshotFixture(changed),
      ).dimensions.find(({ dimension }) => dimension === "references"),
    ).toMatchObject({ status: "changed" });

    const unavailable = observe(
      "1",
      dossierWithReference("0x2000", "unavailable"),
    );
    expect(
      compareFunctions(
        functionSnapshotFixture(left),
        functionSnapshotFixture(unavailable),
      ).dimensions.find(({ dimension }) => dimension === "references"),
    ).toMatchObject({
      status: "unknown",
      limitations: [expect.stringContaining("did not expose reference kinds")],
    });
  });
});

describe("function comparison identity and malformed CFG", () => {
  it("does not promote address-derived names through equal signatures", () => {
    const autoDossier = (base: "0x1000" | "0x2000") =>
      functionDossierSchema.parse({
        ...dossier("return 0;", base),
        procedure: {
          ...procedure(base, "sub_1000"),
          symbol: null,
          name: "sub_1000",
          signature: "int helper(void)",
          locals: [],
        },
      });
    const comparison = compareFunctions(
      functionSnapshotFixture(observe("9", autoDossier("0x1000"))),
      functionSnapshotFixture(observe("a", autoDossier("0x2000"))),
    );
    expect(comparison.function_match.status).toBe("ambiguous");
    expect(
      comparison.dimensions.find(({ dimension }) => dimension === "identity"),
    ).toMatchObject({ status: "unknown" });
    expect(comparison.status).toBe("unknown");
    const changedText = compareFunctions(
      functionSnapshotFixture(observe("b", autoDossier("0x1000"))),
      functionSnapshotFixture(
        observe(
          "c",
          functionDossierSchema.parse({
            ...autoDossier("0x2000"),
            pseudocode: "return 1;",
          }),
        ),
      ),
    );
    expect(changedText.dimensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: "pseudocode", status: "changed" }),
      ]),
    );
    expect(changedText.status).toBe("unknown");
  });

  it("rejects invalid CFG normalization and preserves newline differences", () => {
    const leftDossier = dossier("line\r\n", "0x1000");
    const invalidCfg = functionDossierSchema.parse({
      ...dossier("line\n", "0x2000"),
      basic_blocks: [
        { start: "0x2000", end: "0x2001", successors: [] },
        { start: "0x2000", end: "0x2002", successors: [] },
      ],
    });
    const comparison = compareFunctions(
      functionSnapshotFixture(observe("b", leftDossier)),
      functionSnapshotFixture(observe("c", invalidCfg)),
    );
    expect(
      comparison.dimensions.find(({ dimension }) => dimension === "cfg"),
    ).toMatchObject({ status: "unknown" });
    const pseudocode = comparison.dimensions.find(
      ({ dimension }) => dimension === "pseudocode",
    );
    expect(pseudocode).toMatchObject({
      status: "changed",
      left_digest: expect.any(String),
      right_digest: expect.any(String),
    });
    expect(pseudocode?.left_digest).not.toBe(pseudocode?.right_digest);
  });
});

const withLiterals = (base: "0x1000" | "0x2000", values: readonly string[]) =>
  functionDossierSchema.parse({
    ...dossier("return 0;", base),
    swift_string_literals: values.map((value) => ({
      source_address: base,
      value,
      representation: "small" as const,
      address: null,
      registers: ["x0", "x1"] as const,
      words: ["0x0", "0xe"] as const,
    })),
  });
const stringsDimension = (
  leftDigit: string,
  left: ReturnType<typeof withLiterals> | ReturnType<typeof dossier>,
  rightDigit: string,
  right: ReturnType<typeof withLiterals> | ReturnType<typeof dossier>,
) =>
  compareFunctions(
    functionSnapshotFixture(observe(leftDigit, left)),
    functionSnapshotFixture(observe(rightDigit, right)),
  ).dimensions.find(({ dimension }) => dimension === "strings_names");

describe("function comparison Swift string literals", () => {
  it("retains literal comparisons when legacy dossiers omit facet declarations", () => {
    const legacy = (base: "0x1000" | "0x2000", value: string) => {
      const result = withLiterals(base, [value]);
      delete result.facet_availability;
      return result;
    };
    const left = legacy("0x1000", "SleepDisabled");
    expect(
      stringsDimension("1", left, "2", legacy("0x2000", "SleepDisabled")),
    ).toMatchObject({ status: "unchanged" });
    expect(
      stringsDimension("1", left, "2", legacy("0x2000", "Holding awake")),
    ).toMatchObject({ status: "changed" });
  });

  it("treats differing decoded literals as a strings and names change", () => {
    expect(
      stringsDimension(
        "1",
        withLiterals("0x1000", ["SleepDisabled"]),
        "2",
        withLiterals("0x2000", ["Holding awake"]),
      ),
    ).toMatchObject({ status: "changed" });
  });

  it("matches the same decoded literal after the function is relocated", () => {
    expect(
      stringsDimension(
        "3",
        withLiterals("0x1000", ["SleepDisabled"]),
        "4",
        withLiterals("0x2000", ["SleepDisabled"]),
      ),
    ).toMatchObject({ status: "unchanged" });
  });

  it("keeps strings and names unknown when only one dossier recorded Swift literals", () => {
    expect(
      stringsDimension(
        "5",
        withLiterals("0x1000", []),
        "6",
        dossier("return 0;", "0x2000"),
      ),
    ).toMatchObject({
      status: "unknown",
      limitations: [
        "Swift String literal coverage differs or is partial; complete coverage does not establish a differing literal.",
      ],
    });
  });

  it("reports a referenced name change even when Swift literal coverage differs", () => {
    const named = functionDossierSchema.parse({
      ...dossier("return 0;", "0x2000"),
      referenced_names: [
        { address: "0x3000", value: "helper", source_address: "0x2000" },
      ],
    });
    expect(
      stringsDimension("7", withLiterals("0x1000", []), "8", named),
    ).toMatchObject({ status: "changed" });
  });
});

describe("function comparison partial Swift literal coverage", () => {
  it("keeps literal comparisons unknown at unresolved jump candidates", () => {
    const unresolved = functionDossierSchema.parse({
      ...withLiterals("0x2000", []),
      swift_string_literal_omissions: [
        {
          source_address: "0x2004",
          representation: "small",
          address: null,
          byte_length: 4,
          reason: "unresolved_jump",
          registers: ["x0", "x1"],
          words: ["0x732f4220", "0xe400000000000000"],
        },
      ],
    });
    expect(
      stringsDimension(
        "8",
        withLiterals("0x1000", ["SleepDisabled"]),
        "9",
        unresolved,
      ),
    ).toMatchObject({ status: "unknown" });
  });

  it("does not equate a partial literal record with a complete one", () => {
    const partial = functionDossierSchema.parse({
      ...withLiterals("0x2000", ["SleepDisabled"]),
      swift_string_literal_omissions: [
        {
          source_address: "0x2000",
          representation: "large",
          address: "0x3000",
          byte_length: 64,
          reason: "capacity",
          registers: ["x0", "x1"],
          words: ["0xd000000000000040", "0x8000000000002fe0"],
        },
      ],
    });
    expect(
      stringsDimension(
        "9",
        withLiterals("0x1000", ["SleepDisabled"]),
        "a",
        partial,
      ),
    ).toMatchObject({ status: "unknown" });
  });

  it("reports a literal that a complete dossier shows absent at a site the partial one decoded", () => {
    const partial = functionDossierSchema.parse({
      ...withLiterals("0x2000", ["SleepDisabled"]),
      swift_string_literal_omissions: [
        {
          source_address: "0x2004",
          representation: "small",
          address: null,
          byte_length: 4,
          reason: "capacity",
          registers: ["x0", "x1"],
          words: ["0x732f4220", "0xe400000000000000"],
        },
      ],
    });
    expect(
      stringsDimension("d", withLiterals("0x1000", []), "e", partial),
    ).toMatchObject({ status: "changed" });
  });
});

describe("function comparison partial Swift literal omission interpretation", () => {
  it("does not interpret an unexamined path as a missing literal at a retained site", () => {
    const partial = functionDossierSchema.parse({
      ...withLiterals("0x2000", ["A"]),
      swift_string_literal_omissions: [
        {
          source_address: "0x2004",
          representation: "small",
          address: null,
          byte_length: 0,
          reason: "capacity",
          registers: ["x0", "x1"],
          words: ["0x0", "0xe000000000000000"],
        },
      ],
    });
    const complete = withLiterals("0x1000", ["A", "B"]);
    expect(stringsDimension("1", complete, "2", partial)).toMatchObject({
      status: "unknown",
    });
    expect(stringsDimension("3", partial, "4", complete)).toMatchObject({
      status: "unknown",
    });
    expect(
      stringsDimension("5", withLiterals("0x1000", []), "6", partial),
    ).toMatchObject({ status: "changed" });
  });

  it("treats an omission record without decoded literals as partial coverage", () => {
    const omissionOnly = functionDossierSchema.parse({
      ...dossier("return 0;", "0x2000"),
      swift_string_literal_omissions: [
        {
          source_address: "0x2004",
          representation: "small",
          address: null,
          byte_length: 4,
          reason: "capacity",
          registers: ["x0", "x1"],
          words: ["0x732f4220", "0xe400000000000000"],
        },
      ],
    });
    expect(
      stringsDimension("f", dossier("return 0;", "0x1000"), "0", omissionOnly),
    ).toMatchObject({ status: "unknown" });
  });

  it("keeps different retained representations unknown when both dossiers are partial", () => {
    const omission = {
      source_address: "0x1004",
      representation: "small",
      address: null,
      byte_length: 4,
      reason: "capacity",
      registers: ["x0", "x1"],
      words: ["0x732f4220", "0xe400000000000000"],
    } as const;
    const small = functionDossierSchema.parse({
      ...withLiterals("0x1000", ["SleepDisabled"]),
      swift_string_literal_omissions: [omission],
    });
    const large = functionDossierSchema.parse({
      ...dossier("return 0;", "0x2000"),
      swift_string_literals: [
        {
          source_address: "0x2000",
          value: "SleepDisabled",
          representation: "large",
          address: "0x3000",
          registers: ["x0", "x1"],
          words: ["0xd00000000000000d", "0x8000000000002fe0"],
        },
      ],
      swift_string_literal_omissions: [
        { ...omission, source_address: "0x2004" },
      ],
    });
    expect(stringsDimension("1", small, "2", large)).toMatchObject({
      status: "unknown",
    });
  });

  it("keeps different retained literals unknown when both dossiers are partial", () => {
    const partial = (base: "0x1000" | "0x2000", value: string) =>
      functionDossierSchema.parse({
        ...withLiterals(base, [value]),
        swift_string_literal_omissions: [
          {
            source_address: base === "0x1000" ? "0x1004" : "0x2004",
            representation: "large",
            address: "0x3000",
            byte_length: 64,
            reason: "capacity",
            registers: ["x0", "x1"],
            words: ["0xd000000000000040", "0x8000000000002fe0"],
          },
        ],
      });
    expect(
      stringsDimension(
        "b",
        partial("0x1000", "SleepDisabled"),
        "c",
        partial("0x2000", "Holding awake"),
      ),
    ).toMatchObject({ status: "unknown" });
  });
});

const expectInlineComparisonEvidence = (
  result: ReturnType<typeof compareFunctions>,
): void => {
  for (const dimension of result.dimensions)
    expect(dimension.evidence_links).toEqual([
      FUNCTION_COMPARISON_EXAMPLE.left.evidence_id,
      FUNCTION_COMPARISON_EXAMPLE.right.evidence_id,
    ]);
  const firstDimension = result.dimensions[0];
  expect(firstDimension).toBeDefined();
  if (firstDimension === undefined) return;
  expect(
    functionComparisonResultSchema.safeParse({
      ...result,
      dimensions: result.dimensions.map((dimension, index) =>
        index === 0
          ? {
              ...dimension,
              evidence_links: Array.from(
                { length: 201 },
                () => FUNCTION_COMPARISON_EXAMPLE.left.evidence_id,
              ),
            }
          : dimension,
      ),
    }).success,
  ).toBe(true);
};

const expectFunctionDimensionAlgebra = (
  result: ReturnType<typeof compareFunctions>,
): void => {
  const observed = result.dimensions.find(
    ({ status }) => status === "unchanged" || status === "changed",
  );
  expect(observed).toBeDefined();
  if (observed === undefined) return;
  expect(
    functionComparisonResultSchema.safeParse({
      ...result,
      dimensions: [
        { ...observed, left_digest: null, right_digest: null },
        ...result.dimensions.slice(1),
      ],
    }).success,
  ).toBe(false);
  expect(
    functionComparisonResultSchema.safeParse({
      ...result,
      function_match: { ...result.function_match, method: "explicit" },
    }).success,
  ).toBe(false);
};

it.each([
  { match: "mismatched", changedDimensions: false, expected: "changed" },
  { match: "ambiguous", changedDimensions: false, expected: "unknown" },
  { match: "ambiguous", changedDimensions: true, expected: "unknown" },
] as const)(
  "validates $match match precedence with changed dimensions=$changedDimensions",
  ({ match, changedDimensions, expected }) => {
    const result = compareFunctions(
      functionSnapshotFixture(FUNCTION_COMPARISON_EXAMPLE.left),
      functionSnapshotFixture(
        changedDimensions
          ? FUNCTION_COMPARISON_EXAMPLE.right
          : FUNCTION_COMPARISON_EXAMPLE.left,
      ),
    );
    const candidate = {
      ...result,
      function_match: {
        status: match,
        method: "explicit",
        left_name: "main",
        right_name: "other",
      },
    };
    expect(
      functionComparisonResultSchema.safeParse({
        ...candidate,
        status: expected,
      }).success,
    ).toBe(true);
    for (const status of ["unchanged", "changed", "unknown"] as const) {
      if (status === expected) continue;
      const parsed = functionComparisonResultSchema.safeParse({
        ...candidate,
        status,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success)
        expect(parsed.error.issues).toMatchObject([
          {
            path: ["status"],
            code: "custom",
            message:
              "Function comparison status contradicts its dimensions or function match.",
          },
        ]);
    }
  },
);

describe("function call endpoint identity", () => {
  const calling = (
    direction: "callers" | "callees",
    entries: readonly ReturnType<typeof procedure>[],
  ) =>
    functionDossierSchema.parse({
      ...dossier("return helper();", "0x1000"),
      [direction]: entries,
    });
  const calls = (
    left: ReturnType<typeof dossier>,
    right: ReturnType<typeof dossier>,
    sameArtifact: boolean,
  ) =>
    compareFunctions(
      functionSnapshotFixture(observe("a", left)),
      functionSnapshotFixture(observe(sameArtifact ? "a" : "b", right)),
    ).dimensions.find(({ dimension }) => dimension === "calls");

  it.each(["callers", "callees"] as const)(
    "uses known procedure entries rather than %s labels within an artifact",
    (direction) => {
      const left = calling(direction, [procedure("ram:0x1010", "helper")]);
      expect(
        calls(
          left,
          calling(direction, [procedure("ram:0x1020", "helper")]),
          true,
        ),
      ).toMatchObject({ status: "changed" });
      expect(
        calls(
          left,
          calling(direction, [procedure("ram:0X001010", "renamed")]),
          true,
        ),
      ).toMatchObject({ status: "unchanged" });
      expect(
        calls(
          left,
          calling(direction, [procedure("rom:0x1010", "helper")]),
          true,
        ),
      ).toMatchObject({ status: "changed" });
      expect(
        calls(
          left,
          calling(direction, [procedure("unparsed", "helper")]),
          true,
        ),
      ).toMatchObject({
        status: "unknown",
        limitations: [expect.stringContaining("could not be parsed")],
      });
    },
  );

  it.each(["callers", "callees"] as const)(
    "keeps repeated cross-artifact %s labels ambiguous without reference edges",
    (direction) => {
      const left = calling(direction, [
        procedure("0x1010", "helper"),
        procedure("0x1020", "helper"),
      ]);
      const right = calling(direction, [
        procedure("0x2010", "helper"),
        procedure("0x2020", "helper"),
      ]);
      expect(calls(left, right, false)).toMatchObject({
        status: "unknown",
        left_count: 2,
        right_count: 2,
        left_digest: null,
        right_digest: null,
        limitations: [
          expect.stringContaining("unique comparable procedure entry"),
        ],
      });
    },
  );

  it("retains duplicate counts when a name resolves to one entry per artifact", () => {
    const left = calling("callees", [
      procedure("0x1010", "helper"),
      procedure("0X001010", "helper"),
    ]);
    const right = calling("callees", [
      procedure("0x2010", "helper"),
      procedure("0x2010", "helper"),
    ]);
    expect(calls(left, right, false)).toMatchObject({
      status: "unchanged",
      left_count: 2,
      right_count: 2,
    });
    expect(
      calls(left, calling("callees", [procedure("0x2010", "helper")]), false),
    ).toMatchObject({ status: "changed" });
  });

  it("shares procedure-name ambiguity across call and reference observations", () => {
    const observed = (base: "0x1000" | "0x2000") =>
      functionDossierSchema.parse({
        ...dossierWithReference(base, "call"),
        callees: [procedure(base === "0x1000" ? "0x1020" : "0x2020", "helper")],
      });
    const result = compareFunctions(
      functionSnapshotFixture(observe("a", observed("0x1000"))),
      functionSnapshotFixture(observe("b", observed("0x2000"))),
    );
    for (const dimension of ["calls", "references"])
      expect(
        result.dimensions.find((value) => value.dimension === dimension),
      ).toMatchObject({
        status: "unknown",
        limitations: [
          expect.stringContaining("unique comparable procedure entry"),
        ],
      });
  });
});

describe("function comparison unnamed reference endpoints", () => {
  it("distinguishes unnamed reference targets by address within one artifact", () => {
    const unnamedTarget = (target: string) =>
      functionDossierSchema.parse({
        ...dossierWithReference("0x1000", "call"),
        outgoing_references: [
          {
            ...dossierWithReference("0x1000", "call").outgoing_references[0],
            target_address: target,
            target_procedure: null,
          },
        ],
      });
    const reference = (left: string, right: string, digits = ["a", "a"]) =>
      compareFunctions(
        functionSnapshotFixture(observe(digits[0] ?? "a", unnamedTarget(left))),
        functionSnapshotFixture(
          observe(digits[1] ?? "a", unnamedTarget(right)),
        ),
      ).dimensions.find(({ dimension }) => dimension === "references");
    expect(reference("0x1010", "0x1020")).toMatchObject({ status: "changed" });
    expect(reference("0x1010", "0x1010")).toMatchObject({
      status: "unchanged",
    });
    // Across artifacts the same address does not identify the same target.
    expect(reference("0x1010", "0x1010", ["a", "b"])).toMatchObject({
      status: "unknown",
    });
  });

  it("keeps known reference-kind changes beside unnamed endpoints", () => {
    const unnamed = (kind: "call" | "data") => {
      const edge = dossierWithReference("0x1000", kind).outgoing_references[0];
      return functionDossierSchema.parse({
        ...dossierWithReference("0x1000", kind),
        outgoing_references: [{ ...edge, target_procedure: null }],
      });
    };
    expect(
      compareFunctions(
        functionSnapshotFixture(observe("a", unnamed("call"))),
        functionSnapshotFixture(observe("b", unnamed("data"))),
      ).dimensions.find(({ dimension }) => dimension === "references"),
    ).toMatchObject({ status: "changed" });
  });
});

it("does not equate matching numeric entries from different providers", () => {
  const before = dossier("return 0;", "0x1000");
  before.procedure.name = "evaluate";
  const after = functionDossierSchema.parse({
    ...before,
    procedure: { ...before.procedure, name: "renamed_evaluate" },
  });
  const result = compareFunctions(
    functionSnapshotFixture(observe("a", before, "provider-a")),
    functionSnapshotFixture(observe("a", after, "provider-b")),
  );
  expect(result.function_match).toMatchObject({
    status: "ambiguous",
    method: "explicit",
  });
});

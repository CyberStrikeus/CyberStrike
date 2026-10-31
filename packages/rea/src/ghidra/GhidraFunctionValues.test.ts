import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import type { JsonValue } from "../domain/jsonValue.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { functionDossierSchema } from "../domain/native/functionDossier.js";
import {
  compactReference,
  compactInstruction,
  compactCallTargets,
} from "../domain/native/nativeInstruction.fixture.js";
import {
  parseGhidraFunctionResult,
  type GhidraFunctionOperation,
} from "./GhidraFunctionValues.js";
import {
  ghidraFunctionClassification,
  ghidraFunctionDossier,
  ghidraFunctionIdentity,
  ghidraNativeApiBoundary,
  ghidraReferenceEdge,
} from "../domain/ghidraValues.fixture.js";

const observationOperations: ReadonlySet<GhidraFunctionOperation> = new Set([
  "analyze_function",
  "procedure_assembly",
  "procedure_callees",
  "procedure_callers",
  "procedure_info",
  "procedure_pseudo_code",
  "procedure_references",
  "read_function_instructions",
]);

// Existing assertions focus on the value schema; this helper builds the current
// bridge envelope and returns its normalized value for those assertions.
const parseFunctionValueFixture = (
  operation: GhidraFunctionOperation,
  value: JsonValue,
) => {
  const wireValue = observationOperations.has(operation)
    ? { value, limitations: [] }
    : value;
  const parsed = parseGhidraFunctionResult(operation, wireValue);
  return parsed.ok ? { ok: true as const, value: parsed.value.value } : parsed;
};

describe("Ghidra unresolved call locations", () => {
  it("rejects a noncanonical unresolved call site rather than retaining unverifiable location evidence", () => {
    expect(
      parseGhidraFunctionResult("analyze_function", {
        value: {
          ...functionDossierSchema.parse(ghidraFunctionDossier()),
          unresolved_calls: [
            { address: "not-an-address", reason: "No call destination." },
          ],
        },
        limitations: [],
        relationship_coverage: {
          status: "partial",
          limitations: ["An unresolved call remains."],
        },
      }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
  });
});

describe("Ghidra function-analysis result values", () => {
  it.each(["snapshot", null, 1])(
    "rejects invalid result-specific cache policy %j",
    (cachePolicy) => {
      expect(
        parseGhidraFunctionResult("analyze_function", {
          value: ghidraFunctionDossier(),
          limitations: [],
          cache_policy: cachePolicy,
        }).ok,
      ).toBe(false);
    },
  );

  it("rejects result-specific cache policy outside the dossier operation", () => {
    expect(
      parseGhidraFunctionResult("procedure_pseudo_code", {
        value: "void main() {}",
        limitations: [],
        cache_policy: "live",
      }).ok,
    ).toBe(false);
  });

  it("preserves unresolved Swift jump omissions", () => {
    const dossier = {
      ...functionDossierSchema.parse(ghidraFunctionDossier()),
      swift_string_literals: [],
      swift_string_literal_omissions: [
        {
          source_address: "0x401004",
          representation: "small",
          address: null,
          byte_length: 5,
          reason: "unresolved_jump",
          registers: ["x0", "x1"],
          words: ["0x5000000000000005", "0x0000000000000000"],
        },
      ],
    };
    expect(
      parseGhidraFunctionResult("analyze_function", {
        value: dossier,
        limitations: [],
      }),
    ).toMatchObject({
      ok: true,
      value: {
        value: {
          swift_string_literal_omissions:
            dossier.swift_string_literal_omissions,
        },
      },
    });
  });

  it("retains unavailable pseudocode instead of treating its empty representation as observed source", () => {
    const availability = {
      pseudocode: {
        available: false,
        reason: "Ghidra does not decompile external functions.",
      },
      comments: { available: true },
    };
    const parsed = parseGhidraFunctionResult("analyze_function", {
      value: {
        ...functionDossierSchema.parse(ghidraFunctionDossier()),
        pseudocode: "",
        facet_availability: availability,
      },
      limitations: [],
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: { value: { pseudocode: "", facet_availability: availability } },
    });
  });
  it.each([
    { status: "complete", diagnostics: ["Resolved static references only."] },
    {
      status: "partial",
      limitations: ["Only the first instruction range was examined."],
    },
    { status: "unknown", reason: "Relationship inventory was unavailable." },
    {
      status: "partial",
      limitations: ["Missing callers."],
      limited_directions: ["callers"],
    },
    {
      status: "unknown",
      reason: "Missing callees.",
      limited_directions: ["callees"],
    },
  ])("preserves observed $status relationship coverage", (coverage) => {
    const parsed = parseGhidraFunctionResult("analyze_function", {
      value: ghidraFunctionDossier(),
      limitations: [],
      relationship_coverage: coverage,
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: { relationshipCoverage: coverage },
    });
  });

  it("preserves omitted relationship coverage for legacy observations", () => {
    const parsed = parseGhidraFunctionResult("analyze_function", {
      value: ghidraFunctionDossier(),
      limitations: [],
    });
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value).not.toHaveProperty("relationshipCoverage");
  });
});

describe("Ghidra relationship metadata validation", () => {
  it.each([
    { status: "partial", limitations: [] },
    { status: "unknown", reason: "" },
    { status: "complete", limitations: ["Truncated."] },
    { status: "partial", limitations: ["Truncated."], limited_directions: [] },
    {
      status: "partial",
      limitations: ["Truncated."],
      limited_directions: ["callers", "callers"],
    },
    { status: "unknown", reason: "Missing.", limited_directions: ["incoming"] },
    { status: "complete", limited_directions: ["callers"] },
  ])("rejects malformed relationship coverage %j", (coverage) => {
    expect(
      parseGhidraFunctionResult("analyze_function", {
        value: ghidraFunctionDossier(),
        limitations: [],
        relationship_coverage: coverage,
      }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
  });

  it("rejects relationship metadata on unrelated function operations", () => {
    expect(
      parseGhidraFunctionResult("procedure_assembly", {
        value: "ret",
        limitations: [],
        relationship_coverage: { status: "complete" },
      }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
  });

  it("preserves file-offset resolution in Evidence locations and rejects inexact offsets", () => {
    const selection = {
      file_offset: 0x210,
      mapped_address: "0x140001014",
      procedure_address: "0x140001010",
    };
    const wire = { value: "return 42;", limitations: [], selection };
    expect(parseGhidraFunctionResult("procedure_assembly", wire)).toMatchObject(
      { ok: false, error: { _tag: "AnalysisOutputError" } },
    );
    const parsed = parseGhidraFunctionResult("procedure_pseudo_code", wire);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value.locations).toEqual([
      { kind: "file-offset", offset: 0x210 },
      { kind: "address", address: "0x140001014" },
      { kind: "address", address: "0x140001010" },
    ]);
    expect(parsed.value.rawResult).toEqual(wire);
    expect(
      parseGhidraFunctionResult("procedure_pseudo_code", {
        ...wire,
        selection: { ...selection, file_offset: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
  });
  it.each([...observationOperations])(
    "requires the function-observation limitations envelope for %s",
    (operation) => {
      expect(parseGhidraFunctionResult(operation, null)).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisOutputError" },
      });
    },
  );

  it("preserves a named function-observation limitation", () => {
    expect(
      parseGhidraFunctionResult("procedure_pseudo_code", "void f() {}"),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
    const limitation =
      "Ghidra marks a call to external __tls_get_addr terminal; return behavior is not independently verified.";
    expect(
      parseGhidraFunctionResult("procedure_pseudo_code", {
        value: "void f() {}",
        limitations: [limitation],
      }),
    ).toEqual({
      ok: true,
      value: { value: "void f() {}", limitations: [limitation] },
    });
  });

  it("preserves handler-region limitations on procedure references", () => {
    const limitation =
      "Ghidra Listing shows a Borland/Delphi-style SEH frame registration at 0x401008 (push 0x4010a0 followed by fs-segment stack chaining); handler 0x4010a0 lies outside this procedure's body, so callees, strings, and cross-references may omit the handler region.";
    const parsed = parseGhidraFunctionResult("procedure_references", {
      value: {
        procedure: ghidraFunctionIdentity(),
        direction: "outgoing",
        references: [ghidraReferenceEdge()],
        reference_kinds_available: true,
        unresolved_calls: [],
      },
      limitations: [limitation],
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        value: {
          procedure: ghidraFunctionIdentity(),
          direction: "outgoing",
          references: [ghidraReferenceEdge()],
          reference_kinds_available: true,
          unresolved_calls: [],
        },
        limitations: [limitation],
      },
    });
    expect(
      parseGhidraFunctionResult("procedure_references", {
        procedure: ghidraFunctionIdentity(),
        direction: "outgoing",
        references: [],
        reference_kinds_available: true,
        unresolved_calls: [],
      }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
  });

  it.each(["procedure_callees", "procedure_callers"] as const)(
    "requires the function-observation envelope to carry terminal-call limitations for %s",
    (operation) => {
      // A bare address list is the pre-fix bridge shape; without the envelope
      // a truncated function body reports no warning, so it must be rejected.
      expect(parseGhidraFunctionResult(operation, ["0x2000"])).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisOutputError" },
      });
      const limitation =
        "Ghidra Listing reports a terminal call at 0x401000 to 0x402000 abort; fallthrough is excluded by Ghidra's flow model.";
      expect(
        parseGhidraFunctionResult(operation, {
          value: ["0x2000"],
          limitations: [limitation],
        }),
      ).toEqual({
        ok: true,
        value: { value: ["0x2000"], limitations: [limitation] },
      });
    },
  );
});

describe("Ghidra reference and value-flow completeness", () => {
  it.each(["procedure", "source_procedure", "target_procedure"] as const)(
    "requires producer symbol metadata on %s identities",
    (location) => {
      const observation = (identity: JsonValue) => ({
        procedure:
          location === "procedure" ? identity : ghidraFunctionIdentity(),
        direction: "outgoing",
        references: [
          {
            ...ghidraReferenceEdge(),
            ...(location === "procedure" ? {} : { [location]: identity }),
          },
        ],
        reference_kinds_available: true,
        unresolved_calls: [],
      });
      const identity = ghidraFunctionIdentity();
      expect(
        parseFunctionValueFixture("procedure_references", observation(identity))
          .ok,
      ).toBe(true);
      expect(
        parseFunctionValueFixture(
          "procedure_references",
          observation({ ...identity, symbol: null }),
        ).ok,
      ).toBe(true);
      const { symbol: omitted, ...withoutSymbol } = identity;
      expect(omitted).toBeDefined();
      for (const invalid of [
        withoutSymbol,
        { ...identity, symbol: { primary: "yes" } },
        { ...identity, unexpected: true },
      ]) {
        expect(
          parseFunctionValueFixture(
            "procedure_references",
            observation(invalid),
          ),
        ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
      }
    },
  );
  it.each(["reference_kinds_available", "unresolved_calls"])(
    "rejects omitted %s instead of inventing complete reference observations",
    (field) => {
      const output = {
        procedure: ghidraFunctionIdentity(),
        direction: "outgoing",
        references: [ghidraReferenceEdge()],
        reference_kinds_available: true,
        unresolved_calls: [],
      };
      const incomplete = Object.fromEntries(
        Object.entries(output).filter(([key]) => key !== field),
      );
      expect(
        parseFunctionValueFixture("procedure_references", output),
      ).toMatchObject({ ok: true });
      expect(
        parseFunctionValueFixture("procedure_references", incomplete),
      ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
    },
  );

  it.each(["block_membership", "parameters", "parameter_uses"])(
    "rejects a value-flow result missing %s",
    (field) => {
      const dossier = ghidraFunctionDossier();
      if (
        typeof dossier !== "object" ||
        dossier === null ||
        Array.isArray(dossier)
      )
        throw new TypeError("Ghidra dossier fixture is invalid");
      const flow = dossier.native_value_flow;
      if (typeof flow !== "object" || flow === null || Array.isArray(flow))
        throw new TypeError("Ghidra p-code fixture is invalid");
      if (!Array.isArray(flow.operations))
        throw new TypeError("Ghidra operation fixture is invalid");
      const incompleteFlow =
        field === "block_membership"
          ? {
              ...flow,
              operations: flow.operations.map((operation, index) =>
                index !== 0 ||
                typeof operation !== "object" ||
                operation === null ||
                Array.isArray(operation)
                  ? operation
                  : Object.fromEntries(
                      Object.entries(operation).filter(
                        ([key]) => key !== field,
                      ),
                    ),
              ),
            }
          : Object.fromEntries(
              Object.entries(flow).filter(([key]) => key !== field),
            );

      expect(
        parseFunctionValueFixture(
          "analyze_function",
          jsonValueSchema.parse({
            ...dossier,
            native_value_flow: incompleteFlow,
          }),
        ),
      ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
    },
  );

  it("rejects p-code relationships that refer to omitted operation IDs", () => {
    const dossier = ghidraFunctionDossier();
    if (
      typeof dossier !== "object" ||
      dossier === null ||
      Array.isArray(dossier)
    )
      throw new TypeError("Ghidra dossier fixture is invalid");
    const flow = dossier.native_value_flow;
    if (typeof flow !== "object" || flow === null || Array.isArray(flow))
      throw new TypeError("Ghidra p-code fixture is invalid");
    expect(
      parseFunctionValueFixture("analyze_function", {
        ...dossier,
        native_value_flow: {
          ...flow,
          def_use: [
            {
              definition: "0x401000#missing",
              use: "0x401000#0",
              input_index: 0,
            },
          ],
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisOutputError" },
    });
  });
});

describe("Ghidra Swift String literals", () => {
  it("keeps a small Swift literal without storage apart from a large literal's bytes", () => {
    const dossier = ghidraFunctionDossier();
    if (
      typeof dossier !== "object" ||
      dossier === null ||
      Array.isArray(dossier)
    )
      throw new TypeError("Ghidra dossier fixture is invalid");
    const literals = [
      {
        source_address: "0x401004",
        value: "The user name ",
        representation: "small",
        address: null,
        registers: ["x0", "x1"],
        words: ["0x7265737520656854", "0xee0020656d616e20"],
      },
      {
        source_address: "0x401006",
        value: "",
        representation: "small",
        address: null,
        registers: ["x0", "x1"],
        words: ["0x0", "0xe000000000000000"],
      },
      {
        source_address: "0x401008",
        value: " cannot be written into a sudoers rule safely.",
        representation: "large",
        address: "0x402270",
        registers: ["x0", "x1"],
        words: ["0xd00000000000002e", "0x8000000000402250"],
      },
    ];
    expect(
      parseFunctionValueFixture("analyze_function", {
        ...dossier,
        swift_string_literals: literals,
        swift_string_literal_omissions: [],
      }),
    ).toMatchObject({ ok: true, value: { swift_string_literals: literals } });
  });
});

describe("Ghidra compact reference provenance", () => {
  it("distinguishes incoming references, examined emptiness and unavailable coverage at data addresses", () => {
    const instruction = {
      ...compactInstruction(),
      address: "ram:00402000",
      status: "data",
      procedure: null,
    };
    const reference = {
      ...compactReference(),
      source_address: "ram:00401000",
      target_address: instruction.address,
      type: "WRITE",
      call: false,
      data: true,
      write: true,
    };
    for (const incoming of [
      {},
      { incoming_references: null },
      { incoming_references: [] },
      { incoming_references: [reference] },
      { incoming_references: [{ ...reference, primary: null, source: null }] },
    ]) {
      const expected = { ...instruction, ...incoming };
      const parsed = parseFunctionValueFixture(
        "inspect_native_instruction",
        expected,
      );
      if (!parsed.ok) throw parsed.error;
      expect(parsed.value).toEqual(expected);
    }
    expect(
      parseFunctionValueFixture("inspect_native_instruction", {
        ...instruction,
        incoming_references: [{ ...reference, primary: "false" }],
      }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
  });

  const operations = [
    ["inspect_native_instruction", compactInstruction],
    ["resolve_native_call_targets", compactCallTargets],
  ] as const;

  it.each(operations)(
    "preserves complete, legacy and unknown facts in %s",
    (operation, output) => {
      const complete = compactReference();
      const legacy = Object.fromEntries(
        Object.entries(complete).filter(
          ([key]) =>
            ![
              "source_address",
              "data",
              "read",
              "write",
              "primary",
              "provenance",
              "source",
            ].includes(key),
        ),
      );
      const unknown = {
        ...legacy,
        source_address: null,
        data: null,
        read: null,
        write: null,
        primary: null,
        provenance: null,
        source: null,
      };
      for (const reference of [complete, legacy, unknown]) {
        const expected = output([reference]);
        const parsed = parseFunctionValueFixture(operation, expected);
        if (!parsed.ok) throw parsed.error;
        expect(parsed.value).toEqual(expected);
      }
    },
  );

  it.each(operations)(
    "rejects malformed present provenance in %s",
    (operation, output) => {
      for (const [field, value] of [
        ["source_address", 1],
        ["data", "true"],
        ["read", 1],
        ["write", 0],
        ["primary", "false"],
        ["provenance", ""],
        ["source", false],
      ] as const) {
        expect(
          parseFunctionValueFixture(
            operation,
            output([{ ...compactReference(), [field]: value }]),
          ),
        ).toMatchObject({
          ok: false,
          error: { _tag: "AnalysisOutputError" },
        });
      }
    },
  );
});

describe("Ghidra jump-table mapping contract", () => {
  it("preserves evidenced defaults separately from cases and unresolved targets", () => {
    const dossier = functionDossierSchema.parse(ghidraFunctionDossier());
    const boundary = dossier.native_api;
    if (boundary?.available !== true)
      throw new TypeError("Ghidra native API fixture is unavailable");
    const table = boundary.jump_tables[0];
    const mapping = table?.mappings[0];
    if (table === undefined || mapping === undefined)
      throw new TypeError("Ghidra jump-table fixture is unavailable");
    const defaults = [
      {
        target_address: mapping.target_address,
        confidence: "high",
        evidence: [
          {
            kind: "jump-table",
            source: "ghidra-clang-case-token",
            detail: "Default label reaches this recovered destination.",
          },
        ],
      },
    ];
    const parsed = parseFunctionValueFixture("analyze_function", {
      ...dossier,
      native_api: {
        ...boundary,
        jump_tables: [
          {
            ...table,
            default_targets: defaults,
            mappings: [
              mapping,
              { ...mapping, case_value: null, target_address: "0x401030" },
            ],
          },
        ],
      },
    });
    if (!parsed.ok) throw parsed.error;
    const output = functionDossierSchema.parse(parsed.value).native_api;
    if (output?.available !== true)
      throw new TypeError("Ghidra native API fixture is unavailable");
    expect(output.jump_tables[0]).toMatchObject({
      default_targets: defaults,
      mappings: [
        { case_value: 0, target_address: "0x401020" },
        { case_value: null, target_address: "0x401030" },
      ],
    });
  });

  it("rejects omitted default observations instead of repairing obsolete bridge output", () => {
    const dossier = functionDossierSchema.parse(ghidraFunctionDossier());
    const boundary = dossier.native_api;
    if (boundary?.available !== true)
      throw new TypeError("Ghidra native API fixture is unavailable");
    const table = boundary.jump_tables[0];
    const mapping = table?.mappings[0];
    if (table === undefined || mapping === undefined)
      throw new TypeError("Ghidra jump-table fixture is unavailable");
    const { default_targets: omittedDefaults, ...withoutDefaults } = table;
    expect(omittedDefaults).toHaveLength(1);
    const parsed = parseFunctionValueFixture("analyze_function", {
      ...dossier,
      native_api: {
        ...boundary,
        jump_tables: [
          { ...withoutDefaults, mappings: [{ ...mapping, case_value: null }] },
        ],
      },
    });
    expect(parsed).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisOutputError" },
    });
  });

  it("rejects non-canonical default destinations and defaults without evidence", () => {
    const dossier = functionDossierSchema.parse(ghidraFunctionDossier());
    const boundary = dossier.native_api;
    if (boundary?.available !== true)
      throw new TypeError("Ghidra native API fixture is unavailable");
    const table = boundary.jump_tables[0];
    const mapping = table?.mappings[0];
    if (table === undefined || mapping === undefined)
      throw new TypeError("Ghidra jump-table fixture is unavailable");
    for (const destination of [
      {
        target_address: "0X401020",
        confidence: "high",
        evidence: mapping.evidence,
      },
      { target_address: "0x401020", confidence: "high", evidence: [] },
    ]) {
      expect(
        parseFunctionValueFixture("analyze_function", {
          ...dossier,
          native_api: {
            ...boundary,
            jump_tables: [{ ...table, default_targets: [destination] }],
          },
        }),
      ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
    }
  });
});

describe("Ghidra function-analysis malformed results", () => {
  it.each(malformedOutputs())(
    "rejects malformed %s output",
    (_name, operation, value) => {
      expect(parseFunctionValueFixture(operation, value)).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisOutputError" },
      });
    },
  );
});

const malformedSwiftStringLiterals = (
  dossier: Record<string, JsonValue>,
): Array<[string, GhidraFunctionOperation, JsonValue]> =>
  (
    [
      ["non-canonical Swift literal address", "large", "402240"],
      ["small Swift literal with storage", "small", "0x402270"],
      ["large Swift literal without storage", "large", null],
    ] as const
  ).map(([name, representation, address]) => [
    name,
    "analyze_function",
    {
      ...dossier,
      swift_string_literal_omissions: [],
      swift_string_literals: [
        {
          source_address: "0x401004",
          value: "The power setting could not be changed.",
          representation,
          address,
          registers: ["x0", "x1"],
          words: ["0xd000000000000027", "0x8000000000402220"],
        },
      ],
    },
  ]);

const malformedOutputs = (): Array<
  [string, GhidraFunctionOperation, JsonValue]
> => {
  const dossier = ghidraFunctionDossier();
  if (typeof dossier !== "object" || dossier === null || Array.isArray(dossier))
    throw new TypeError("Ghidra dossier fixture is invalid");
  const edge = ghidraReferenceEdge();
  const nativeApi = ghidraNativeApiBoundary();
  const jumpTable = nativeApi.jump_tables[0];
  const mapping = jumpTable?.mappings[0];
  if (jumpTable === undefined || mapping === undefined)
    throw new TypeError("Ghidra native API fixture is invalid");
  return [
    ["non-canonical address", "procedure_callers", ["401000"]],
    [
      "Swift literals without their omission record",
      "analyze_function",
      { ...dossier, swift_string_literals: [] },
    ],
    [
      "missing classification",
      "procedure_info",
      {
        name: "main",
        entrypoint: "0x401000",
        basicblock_count: 1,
        length: 1,
        signature: null,
        locals: [],
      },
    ],
    [
      "unavailable Ghidra reference kind",
      "procedure_references",
      {
        procedure: ghidraFunctionIdentity(),
        direction: "outgoing",
        references: [
          { ...edge, kind: { available: false, reason: "unknown" } },
        ],
      },
    ],
    [
      "missing native API boundary",
      "analyze_function",
      Object.fromEntries(
        Object.entries(dossier).filter(([key]) => key !== "native_api"),
      ),
    ],
    ...malformedSwiftStringLiterals(dossier),
    [
      "non-canonical Swift literal omission address",
      "analyze_function",
      {
        ...dossier,
        swift_string_literals: [],
        swift_string_literal_omissions: [
          {
            source_address: "0x401004",
            representation: "large",
            address: "402240",
            byte_length: 39,
            reason: "capacity",
            registers: ["x0", "x1"],
            words: ["0xd000000000000027", "0x8000000000402220"],
          },
        ],
      },
    ],
    [
      "non-canonical native API target",
      "analyze_function",
      {
        ...dossier,
        native_api: {
          ...nativeApi,
          jump_tables: [
            {
              ...jumpTable,
              mappings: [
                {
                  ...mapping,
                  target_address: "401020",
                },
              ],
            },
          ],
        },
      },
    ],
    [
      "Hopper local provenance",
      "analyze_function",
      {
        ...dossier,
        procedure: {
          ...ghidraFunctionIdentity(),
          signature: null,
          locals: [
            {
              description: "opaque",
              provenance: "hopper-public-python-api",
            },
          ],
        },
      },
    ],
    [
      "inconsistent dossier bound",
      "analyze_function",
      {
        ...dossier,
        instruction_scan: { scanned: -1, truncated: false },
      },
    ],
    [
      "missing uncertainty limitations",
      "analyze_function",
      {
        ...dossier,
        limitations: [],
      },
    ],
  ];
};

// Inclusive ranges are a wire-boundary fixture, not a claim of real-provider acceptance.
describe("complete Ghidra function body range evidence", () => {
  const body = () => ({
    available: true,
    provenance: "ghidra-function-body-address-set",
    ranges: [
      { start: "0x401000", end: "0x401002" },
      { start: "0x401010", end: "0x401011" },
    ],
    total_bytes: 5,
    span_bytes: 18,
    non_contiguous: true,
    contains_entry: true,
  });
  const info = () => ({
    name: "fixture_main",
    entrypoint: "0x401000",
    basicblock_count: 2,
    length: 5,
    signature: null,
    locals: [],
    classification: ghidraFunctionClassification(),
    body: body(),
  });
  it("preserves inclusive disjoint ranges and distinguishes owned bytes from enclosing span", () => {
    expect(parseFunctionValueFixture("procedure_info", info())).toMatchObject({
      ok: true,
      value: { body: body(), length: 5 },
    });
  });
  it("rejects omitted body evidence instead of accepting a length as complete coverage", () => {
    const { body: omitted, ...withoutBody } = info();
    expect(omitted.total_bytes).toBe(5);
    expect(parseFunctionValueFixture("procedure_info", withoutBody).ok).toBe(
      false,
    );
  });
  it("requires local entry coverage but permits an observed empty external body", () => {
    const empty = {
      ...body(),
      ranges: [],
      total_bytes: 0,
      span_bytes: 0,
      non_contiguous: false,
      contains_entry: false,
    };
    expect(
      parseFunctionValueFixture("procedure_info", {
        ...info(),
        body: empty,
        length: 0,
      }).ok,
    ).toBe(false);
    expect(
      parseFunctionValueFixture("procedure_info", {
        ...info(),
        classification: { ...ghidraFunctionClassification(), external: true },
        body: empty,
        length: 0,
      }).ok,
    ).toBe(true);
  });
  it("rejects a missing body on nested dossier identities", () => {
    const dossier = functionDossierSchema.parse(ghidraFunctionDossier());
    const { body: omitted, ...identity } = ghidraFunctionIdentity();
    expect(omitted.total_bytes).toBe(6);
    expect(
      parseFunctionValueFixture("analyze_function", {
        ...dossier,
        callers: [identity],
      }).ok,
    ).toBe(false);
  });
  it("requires body length and Ghidra-specific body provenance", () => {
    expect(
      parseFunctionValueFixture("procedure_info", { ...info(), length: 18 }).ok,
    ).toBe(false);
    expect(
      parseFunctionValueFixture("procedure_info", {
        ...info(),
        body: { ...body(), provenance: "unreviewed" },
      }).ok,
    ).toBe(false);
  });
  it.each([
    { total_bytes: 18 },
    { span_bytes: 5 },
    { non_contiguous: false },
    { contains_entry: false },
    {
      ranges: [
        { start: "0x401000", end: "0x401002" },
        { start: "0x401002", end: "0x401004" },
      ],
    },
    { ranges: [{ start: "0x401002", end: "0x401000" }] },
  ])("rejects contradictory complete body facts %j", (change) => {
    expect(
      parseFunctionValueFixture("procedure_info", {
        ...info(),
        body: { ...body(), ...change },
      }).ok,
    ).toBe(false);
  });
});

describe("Ghidra native instruction decoder context for ARM TMode and MIPS ISA_MODE", () => {
  it.each([
    {
      arch: "ARM:LE:32:v7",
      register: "TMode",
      value: "1",
      description: "Thumb execution mode",
    },
    {
      arch: "ARM:LE:32:v7",
      register: "TMode",
      value: "0",
      description: "ARM 32-bit execution mode",
    },
    {
      arch: "MIPS:LE:32:default",
      register: "ISA_MODE",
      value: "1",
      description: "MIPS16 mode",
    },
    {
      arch: "MIPS:LE:32:default",
      register: "ISA_MODE",
      value: "0",
      description: "Standard MIPS32 mode",
    },
  ])(
    "preserves $description ($register=$value) across boundary",
    ({ arch, register, value }) => {
      const instruction = {
        ...compactInstruction(),
        architecture: arch,
        decoder_context: [
          {
            register,
            value,
            source: "ghidra-program-context",
          },
        ],
      };
      const parsed = parseFunctionValueFixture(
        "inspect_native_instruction",
        instruction,
      );
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value).toMatchObject({
        architecture: arch,
        decoder_context: [
          { register, value, source: "ghidra-program-context" },
        ],
      });
    },
  );

  it("admits null value for uninitialized processor context register", () => {
    const instruction = {
      ...compactInstruction(),
      architecture: "ARM:LE:32:v7",
      decoder_context: [
        {
          register: "TMode",
          value: null,
          source: "ghidra-program-context",
        },
      ],
    };
    const parsed = parseFunctionValueFixture(
      "inspect_native_instruction",
      instruction,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      decoder_context: [{ register: "TMode", value: null }],
    });
  });

  it("rejects malformed decoder context entries", () => {
    const emptyRegister = {
      ...compactInstruction(),
      decoder_context: [{ register: "", value: "1", source: "ghidra" }],
    };
    expect(
      parseFunctionValueFixture("inspect_native_instruction", emptyRegister).ok,
    ).toBe(false);

    const emptySource = {
      ...compactInstruction(),
      decoder_context: [{ register: "TMode", value: "1", source: "" }],
    };
    expect(
      parseFunctionValueFixture("inspect_native_instruction", emptySource).ok,
    ).toBe(false);
  });
});

describe("Ghidra bridge script processor context contract", () => {
  it("binds TMode to ARM and ISA_MODE to MIPS in ReaGhidraBridge.java", async () => {
    const bridgePath = new URL(
      "../../bridge/ghidra/ReaGhidraBridge.java",
      import.meta.url,
    );
    const content = await readFile(bridgePath, "utf8");
    expect(content).toContain(
      'currentProgram.getLanguageID().getIdAsString().startsWith("ARM:")',
    );
    expect(content).toContain(
      'currentProgram.getLanguageID().getIdAsString().startsWith("MIPS:")',
    );
    expect(content).toContain('"TMode"');
    expect(content).toContain('"ISA_MODE"');
    expect(content).toContain('"ghidra-program-context"');
  });
});

describe("Ghidra dossier nested boundary composition", () => {
  const identityLocations = [
    "caller",
    "callee",
    "incoming source",
    "incoming target",
    "outgoing source",
    "outgoing target",
  ] as const;
  const withIdentity = (
    location: (typeof identityLocations)[number],
    identity: JsonValue,
  ): JsonValue => {
    const dossier = functionDossierSchema.parse(ghidraFunctionDossier());
    if (location === "caller") return { ...dossier, callers: [identity] };
    if (location === "callee") return { ...dossier, callees: [identity] };
    const collection = location.startsWith("incoming")
      ? "incoming_references"
      : "outgoing_references";
    const field = location.endsWith("source")
      ? "source_procedure"
      : "target_procedure";
    return {
      ...dossier,
      [collection]: [{ ...ghidraReferenceEdge(), [field]: identity }],
    };
  };

  it.each(identityLocations)(
    "retains the dossier's optional symbol and empty name on a nested %s identity",
    (location) => {
      const { symbol: omitted, ...identity } = ghidraFunctionIdentity();
      expect(omitted).toBeDefined();
      const value = withIdentity(location, { ...identity, name: "" });
      expect(
        parseFunctionValueFixture("analyze_function", value),
      ).toMatchObject({
        ok: true,
        value,
      });
    },
  );

  it.each(identityLocations)(
    "rejects noncanonical address and foreign body/classification provenance on a nested %s identity",
    (location) => {
      const identity = ghidraFunctionIdentity();
      for (const change of [
        { address: "401000" },
        { body: { ...identity.body, provenance: "foreign-provider" } },
        { body: { ...identity.body, contains_entry: false } },
        {
          classification: {
            ...identity.classification,
            provenance: "foreign-provider",
          },
        },
      ])
        expect(
          parseFunctionValueFixture(
            "analyze_function",
            withIdentity(location, { ...identity, ...change }),
          ),
        ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
    },
  );

  it.each(["incoming_references", "outgoing_references"] as const)(
    "requires Ghidra reference-manager provenance inside %s",
    (collection) => {
      const edge = ghidraReferenceEdge();
      expect(
        parseFunctionValueFixture("analyze_function", {
          ...functionDossierSchema.parse(ghidraFunctionDossier()),
          [collection]: [
            {
              ...edge,
              kind: { ...edge.kind, provenance: "hopper-public-python-api" },
            },
          ],
        }),
      ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
    },
  );

  it.each([
    {
      name: "comment address",
      fixture: (address: string) => ({
        comments: [{ address, kind: "comment", text: "observed comment" }],
      }),
    },
    {
      name: "basic-block start",
      fixture: (address: string) => ({
        basic_blocks: [{ start: address, end: "0x401006", successors: [] }],
      }),
    },
    {
      name: "basic-block successor",
      fixture: (address: string) => ({
        basic_blocks: [
          { start: "0x401000", end: "0x401006", successors: [address] },
        ],
      }),
    },
    {
      name: "referenced name source",
      fixture: (address: string) => ({
        referenced_names: [
          { address: "0x402000", source_address: address, value: "observed" },
        ],
      }),
    },
    {
      name: "referenced string source",
      fixture: (address: string) => ({
        referenced_strings: [
          { address: "0x402000", source_address: address, value: "observed" },
        ],
      }),
    },
  ])("requires a canonical $name", ({ fixture }) => {
    const dossier = functionDossierSchema.parse(ghidraFunctionDossier());
    expect(
      parseFunctionValueFixture("analyze_function", {
        ...dossier,
        ...fixture("0x401000"),
      }).ok,
    ).toBe(true);
    expect(
      parseFunctionValueFixture("analyze_function", {
        ...dossier,
        ...fixture("401000"),
      }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
  });
});

describe("Ghidra native facet coordinate admission", () => {
  it.each(["dispatch", "data source"] as const)(
    "requires canonical jump-table %s coordinates",
    (location) => {
      const dossier = functionDossierSchema.parse(ghidraFunctionDossier());
      const boundary = dossier.native_api;
      if (boundary?.available !== true)
        throw new Error("Missing native API fixture");
      const table = boundary.jump_tables[0];
      const source = table?.data_sources[0];
      if (table === undefined || source === undefined)
        throw new Error("Missing jump-table fixture");
      expect(parseFunctionValueFixture("analyze_function", dossier).ok).toBe(
        true,
      );
      expect(
        parseFunctionValueFixture("analyze_function", {
          ...dossier,
          native_api: {
            ...boundary,
            jump_tables: [
              {
                ...table,
                ...(location === "dispatch"
                  ? { dispatch_address: "401010" }
                  : { data_sources: [{ ...source, address: "403000" }] }),
              },
            ],
          },
        }),
      ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
    },
  );

  it.each(["operation", "input", "output"] as const)(
    "requires canonical p-code %s coordinates without inventing null locations",
    (location) => {
      const dossier = functionDossierSchema.parse(ghidraFunctionDossier());
      const flow = dossier.native_value_flow;
      if (flow?.available !== true) throw new Error("Missing p-code fixture");
      const operation = flow.operations[0];
      const input = operation?.inputs[0];
      const output = operation?.output;
      if (operation === undefined || input === undefined || output == null)
        throw new Error("Missing p-code operation fixture");
      for (const address of ["register:0x0", null, "register:0"] as const) {
        if (location === "operation" && address === null) continue;
        const changed = {
          ...operation,
          ...(location === "operation"
            ? { address }
            : location === "input"
              ? { inputs: [{ ...input, location: address }] }
              : { output: { ...output, location: address } }),
        };
        expect(
          parseFunctionValueFixture("analyze_function", {
            ...dossier,
            native_value_flow: { ...flow, operations: [changed] },
          }).ok,
        ).toBe(address !== "register:0");
      }
    },
  );
});

import { describe, expect, it } from "vitest";

import {
  requireAddressArray,
  requireFunctionDossierOracle,
  requireFunctionDossier,
  requirePseudocode,
} from "../../../../scripts/lib/real-hopper-assertions.mjs";

describe("Hopper verifier semantic rejection", () => {
  it("rejects empty and embedded per-item decompilation failures", () => {
    expect(requirePseudocode("return 0;", "batch_decompile")).toBe("return 0;");
    for (const invalid of ["", "   ", "No output", "Error: invalid address"])
      expect(() => requirePseudocode(invalid, "batch_decompile")).toThrow();
  });

  it("requires address-shaped relationship evidence", () => {
    expect(requireAddressArray(["0x1000"], "xrefs")).toEqual(["0x1000"]);
    expect(() => requireAddressArray(["main"], "xrefs")).toThrow();
  });

  it("rejects success-shaped dossiers without truthful semantic content", () => {
    const dossier = validDossier();
    expect(() =>
      requireFunctionDossier(
        {
          ...dossier,
          pseudocode: "Error: failed",
        },
        "0x1000",
      ),
    ).toThrow(/embedded failure/u);
  });
});

describe("Hopper verifier fixture assertions", () => {
  it("requires fixture-specific positive dossier evidence", () => {
    const entry = fixtureDossier({
      address: "0x1000",
      name: "rea_entry",
      callee: { address: "0x2000", name: "rea_branch" },
      caller: { address: "0x0900", name: "main" },
      referencedString: "REA_C_ENTRY",
      comment: "REA real-Hopper verifier",
      successor: "0x1010",
    });
    expect(() =>
      requireFunctionDossierOracle(entry, {
        procedure_address: "0x1000",
        callee_address: "0x2000",
        caller_address: "0x0900",
        referenced_string: "REA_C_ENTRY",
        referenced_name: "rea_c_global",
        comment: "REA real-Hopper verifier",
        require_cfg_successor: true,
        require_assembly: true,
      }),
    ).not.toThrow();

    for (const field of [
      "callees",
      "callers",
      "outgoing_references",
      "referenced_strings",
      "referenced_names",
      "comments",
      "assembly",
    ] as const) {
      expect(() =>
        requireFunctionDossierOracle(
          { ...entry, [field]: [] },
          {
            procedure_address: "0x1000",
            callee_address: "0x2000",
            caller_address: "0x0900",
            referenced_string: "REA_C_ENTRY",
            referenced_name: "rea_c_global",
            comment: "REA real-Hopper verifier",
            require_cfg_successor: true,
            require_assembly: true,
          },
        ),
      ).toThrow();
    }
    expect(() =>
      requireFunctionDossierOracle(
        {
          ...entry,
          referenced_names: [
            {
              address: "0x4000",
              value: "_rea_c_global",
              source_address: "0x2000",
            },
          ],
        },
        {
          procedure_address: "0x1000",
          referenced_name: "rea_c_global",
        },
      ),
    ).toThrow();
    expect(() =>
      requireFunctionDossierOracle(
        {
          ...entry,
          basic_blocks: [{ start: "0x1000", successors: [] }],
        },
        {
          procedure_address: "0x1000",
          callee_address: "0x2000",
          referenced_string: "REA_C_ENTRY",
          comment: "REA real-Hopper verifier",
          require_cfg_successor: true,
        },
      ),
    ).toThrow(/CFG successor/u);
  });
});

const fixtureDossier = (input: {
  readonly address: string;
  readonly name: string;
  readonly callee: { readonly address: string; readonly name: string };
  readonly caller: { readonly address: string; readonly name: string };
  readonly referencedString: string;
  readonly comment: string;
  readonly successor: string;
}) => ({
  ...validDossier(),
  procedure: { address: input.address, name: input.name },
  assembly: ["mov eax, eax"],
  comments: [{ address: input.address, kind: "comment", text: input.comment }],
  callees: [input.callee],
  callers: [input.caller],
  outgoing_references: [
    {
      source_address: input.address,
      target_address: input.callee.address,
      source_procedure: { address: input.address, name: input.name },
      target_procedure: input.callee,
      kind: { available: false, reason: "public API did not classify kind" },
    },
    {
      source_address: "0x1004",
      target_address: "0x3000",
      source_procedure: { address: input.address, name: input.name },
      target_procedure: null,
      kind: { available: false, reason: "public API did not classify kind" },
    },
    {
      source_address: "0x1008",
      target_address: "0x4000",
      source_procedure: { address: input.address, name: input.name },
      target_procedure: null,
      kind: { available: false, reason: "public API did not classify kind" },
    },
  ],
  referenced_strings: [
    {
      address: "0x3000",
      value: input.referencedString,
      source_address: "0x1004",
    },
  ],
  referenced_names: [
    {
      address: "0x4000",
      value: "_rea_c_global",
      source_address: "0x1008",
    },
  ],
  basic_blocks: [
    { start: input.address, successors: [input.successor] },
    { start: input.successor, successors: [] },
  ],
});

const validDossier = () => {
  return {
    procedure: { address: "0x1000", name: "main" },
    pseudocode: "return 0;",
    assembly: [],
    comments: [],
    callers: [],
    callees: [],
    incoming_references: [],
    outgoing_references: [],
    referenced_strings: [],
    referenced_names: [],
    basic_blocks: [{ successors: [] }],
  };
};

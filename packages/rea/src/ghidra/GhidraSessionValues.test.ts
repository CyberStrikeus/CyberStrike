import { describe, expect, it } from "vitest";

import {
  GHIDRA_SESSION_CAPABILITIES,
  GHIDRA_MUTATING_OPERATIONS,
  parseGhidraSessionInfo,
} from "./GhidraSessionValues.js";

const expected = {
  runId: "d6fcbb66-e829-4ff6-a535-0035aec63139",
  providerVersion: "12.1.4",
  profileDigest: "a".repeat(64),
  targetSha256: "b".repeat(64),
  expectedLanguageId: "x86:LE:16:Real Mode",
  expectedCompilerSpecId: "default",
};
const session = (
  language = expected.expectedLanguageId,
  compiler = "default",
) => ({
  name: "REA Ghidra bridge",
  run_id: expected.runId,
  profile_digest: expected.profileDigest,
  provider: { id: "ghidra", version: expected.providerVersion },
  read_only: false,
  analysis_complete: true,
  analysis_timed_out: false,
  capabilities: [...GHIDRA_SESSION_CAPABILITIES],
  target: {
    name: "legacy.exe",
    language_id: language,
    compiler_spec_id: compiler,
    image_base: "0x0",
    default_address_space: "ram",
    sha256: expected.targetSha256,
  },
});

const rejectedHandshake = (value: ReturnType<typeof session>) => {
  const parsed = parseGhidraSessionInfo(value, expected);
  if (parsed.ok) throw new Error("expected an invalid Ghidra handshake");
  return parsed.error;
};

describe("Ghidra DOS import commitment", () => {
  it("accepts the exact admitted real-mode language and compiler", () => {
    const parsed = parseGhidraSessionInfo(session(), expected);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value.target).toMatchObject({
      language_id: expected.expectedLanguageId,
      compiler_spec_id: expected.expectedCompilerSpecId,
    });
  });
  it("rejects a 32-bit interpretation even when artifact and profile hashes match", () => {
    expect(rejectedHandshake(session("x86:LE:32:default"))).toMatchObject({
      _tag: "GhidraAdmissionError",
      code: "handshake_identity",
    });
  });
  it("rejects compiler drift independently of the language", () => {
    expect(rejectedHandshake(session(undefined, "windows"))).toMatchObject({
      _tag: "GhidraAdmissionError",
      code: "handshake_identity",
    });
  });
});

describe("Ghidra PDB observations", () => {
  const pdb = {
    file: "C:\\build\\fixture.pdb",
    guid: "01234567-89AB-CDEF-0123-456789ABCDEF",
    age: "a",
    signature: null,
    version: "RSDS",
    loaded: false,
  };
  it("retains the referenced identity and observed load state", () => {
    const parsed = parseGhidraSessionInfo({ ...session(), pdb }, expected);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value.pdb).toEqual(pdb);
  });
  it("preserves missing attributes as unknown", () => {
    const unknown = Object.fromEntries(
      Object.keys(pdb).map((key) => [key, null]),
    );
    const parsed = parseGhidraSessionInfo(
      { ...session(), pdb: unknown },
      expected,
    );
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value.pdb).toEqual(unknown);
  });
  it.each([
    { ...pdb, loaded: "false" },
    { ...pdb, age: 1 },
    {
      guid: pdb.guid,
      age: pdb.age,
      signature: null,
      version: "RSDS",
      loaded: false,
    },
    { ...pdb, matched: true },
  ])("rejects malformed PDB reports", (report) => {
    expect(
      parseGhidraSessionInfo({ ...session(), pdb: report }, expected).ok,
    ).toBe(false);
  });
});

describe("Ghidra MIPS soft-float storage report", () => {
  const valid = {
    policy: "o32-soft-float-prototype-v1",
    functions: 2,
    definitions: 1,
  };
  it("accepts the exact committed policy outcome", () => {
    const parsed = parseGhidraSessionInfo(
      { ...session(), mips_soft_float_storage: valid },
      expected,
    );
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value.mips_soft_float_storage).toEqual(valid);
  });
  it.each([
    [
      "the superseded storage policy",
      { policy: "o32-integer-registers-v1", remapped: 2, retyped: 1 },
    ],
    ["a negative count", { ...valid, definitions: -1 }],
    ["a fractional count", { ...valid, functions: 1.5 }],
    ["a missing count", { policy: valid.policy, functions: 2 }],
    ["an undeclared field", { ...valid, skipped: 0 }],
    ["a non-object report", "functions"],
  ])("rejects %s", (_label, report) => {
    expect(
      parseGhidraSessionInfo(
        { ...session(), mips_soft_float_storage: report },
        expected,
      ).ok,
    ).toBe(false);
  });
});

describe("Ghidra RISC-V calling-convention report", () => {
  const valid = {
    policy: "ilp32-prototype-v1",
    functions: 11,
    definitions: 11,
  };
  it("accepts the exact committed policy outcome", () => {
    const parsed = parseGhidraSessionInfo(
      { ...session(), riscv_calling_convention: valid },
      expected,
    );
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value.riscv_calling_convention).toEqual(valid);
  });
  it.each([
    ["an unknown policy", { ...valid, policy: "ilp32f-prototype-v1" }],
    ["the MIPS policy", { ...valid, policy: "o32-soft-float-prototype-v1" }],
    ["a negative count", { ...valid, definitions: -1 }],
    ["a fractional count", { ...valid, functions: 1.5 }],
    ["a missing count", { policy: valid.policy, functions: 2 }],
    ["an undeclared field", { ...valid, prototype: "__rea_ilp32" }],
    ["a non-object report", "ilp32-prototype-v1"],
  ])("rejects %s", (_label, report) => {
    expect(
      parseGhidraSessionInfo(
        { ...session(), riscv_calling_convention: report },
        expected,
      ).ok,
    ).toBe(false);
  });
});

describe("Ghidra disabled analyzer report", () => {
  const valid = {
    format: "rea-ghidra-disabled-analyzers-v1",
    analyzers: [
      { name: "Decompiler Switch Analysis", status: "disabled" },
      { name: "Objective-C Message Analyzer", status: "not_applicable" },
    ],
  };
  it("accepts disabled and not-applicable outcomes in configured order", () => {
    const parsed = parseGhidraSessionInfo(
      { ...session(), disabled_analyzers: valid },
      expected,
    );
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value.disabled_analyzers).toEqual(valid);
  });
  it.each([
    [
      "an unknown analyzer reported as accepted",
      {
        ...valid,
        analyzers: [{ name: "REA Unknown Analyzer", status: "unknown" }],
      },
    ],
    ["an empty outcome list", { ...valid, analyzers: [] }],
    ["another report format", { ...valid, format: "rea-ghidra-seeds-v1" }],
    ["an undeclared field", { ...valid, skipped: [] }],
  ])("rejects %s", (_label, report) => {
    expect(
      parseGhidraSessionInfo(
        { ...session(), disabled_analyzers: report },
        expected,
      ).ok,
    ).toBe(false);
  });
});

describe("Ghidra mutation handshake", () => {
  it("requires the exact mutation authority and rejects duplicate capabilities", () => {
    const value = session();
    expect(
      parseGhidraSessionInfo({ ...value, read_only: true }, expected).ok,
    ).toBe(false);
    expect(
      parseGhidraSessionInfo(
        { ...value, capabilities: [...value.capabilities, "ping"] },
        expected,
      ).ok,
    ).toBe(false);
    expect(
      parseGhidraSessionInfo(
        {
          ...value,
          capabilities: value.capabilities.filter(
            (c) => c !== "annotate_native_function",
          ),
        },
        expected,
      ).ok,
    ).toBe(false);
  });
  it("excludes database mutation from the Windows transport handshake", () => {
    const value = session();
    const windows = {
      ...value,
      read_only: true,
      capabilities: value.capabilities.filter(
        (c) => !GHIDRA_MUTATING_OPERATIONS.has(c),
      ),
    };
    expect(
      parseGhidraSessionInfo(windows, { ...expected, expectedReadOnly: true })
        .ok,
    ).toBe(true);
    expect(
      parseGhidraSessionInfo(value, { ...expected, expectedReadOnly: true }).ok,
    ).toBe(false);
  });
  it("treats address naming as database mutation", () => {
    expect([...GHIDRA_MUTATING_OPERATIONS].sort()).toEqual([
      "annotate_native_function",
      "set_address_name",
      "set_addresses_names",
    ]);
    const value = session();
    for (const naming of ["set_address_name", "set_addresses_names"]) {
      expect(value.capabilities).toContain(naming);
      expect(
        parseGhidraSessionInfo(
          {
            ...value,
            capabilities: value.capabilities.filter((c) => c !== naming),
          },
          expected,
        ).ok,
      ).toBe(false);
    }
  });
});

it("admits unknown analysis completeness only for a committed read-only existing project", () => {
  const value = {
    ...session(),
    existing_project: true,
    read_only: true,
    analysis_complete: null,
    capabilities: GHIDRA_SESSION_CAPABILITIES.filter(
      (name) => !GHIDRA_MUTATING_OPERATIONS.has(name),
    ),
  };
  const project = {
    ...expected,
    expectedReadOnly: true,
    expectedExistingProject: true,
  };
  expect(parseGhidraSessionInfo(value, project).ok).toBe(true);
  expect(parseGhidraSessionInfo(value, expected).ok).toBe(false);
  for (const analysis_complete of [false, true])
    expect(
      parseGhidraSessionInfo({ ...value, analysis_complete }, project).ok,
    ).toBe(false);
  expect(
    parseGhidraSessionInfo(
      { ...value, capabilities: [...GHIDRA_SESSION_CAPABILITIES] },
      project,
    ).ok,
  ).toBe(false);
});

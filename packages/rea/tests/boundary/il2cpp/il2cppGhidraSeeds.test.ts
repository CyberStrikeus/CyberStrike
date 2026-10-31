import {
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../../../src/domain/analysisErrorCore.js";
import { expect, it } from "vitest";
import { parseGhidraSeeds } from "../../../src/ghidra/GhidraAnalysisSeeds.js";
import {
  ghidraDefaultBase,
  il2cppGhidraSeeds,
} from "../../../src/il2cpp/Il2cppGhidraSeeds.js";
import {
  IL2CPP_METADATA_MAGIC,
  IL2CPP_METADATA_SECTION_NAMES,
  type Il2cppMetadata,
} from "../../../src/domain/il2cpp/il2cppMetadata.js";
import { analysisErrorRemediationAction } from "../../../src/domain/analysisErrorPresentation.js";

const type = (
  name: string,
  namespace: string,
  method_start: number,
  method_count: number,
  declaring_type: number,
) => ({
  name,
  namespace,
  method_start,
  method_count,
  nested_type_start: -1,
  nested_type_count: 0,
  declaring_type,
});

const address = (rva: string): Il2cppMetadata["method_addresses"][number] =>
  rva === "no-body" || rva === "unknown"
    ? { state: rva, address: null, rva: null }
    : { state: "code", address: rva, rva };

const report: Il2cppMetadata = {
  artifact: {
    path: "/artifacts/global-metadata.dat",
    sha256: "a".repeat(64),
    bytes: 1024,
  },
  magic: IL2CPP_METADATA_MAGIC,
  metadata_version: 31,
  index_widths: {
    type_definition: 4,
    generic_container: 4,
    parameter: 4,
    type: 4,
    type_width_source: "fixed-width-version",
  },
  sections: IL2CPP_METADATA_SECTION_NAMES.map((name) => ({
    name,
    offset: 256,
    size: 0,
    count: 0,
  })),
  images: [{ name: "Assembly-CSharp.dll", type_start: 0, type_count: 3 }],
  types: [
    type("Player", "Game", 0, 2, -1),
    type("Slot", "", 2, 2, 0),
    type("<>c", "", 4, 1, 1),
  ],
  methods: [
    { name: "Update", declaring_type: 0 },
    { name: "Abstract", declaring_type: 0 },
    { name: "Add", declaring_type: 1 },
    { name: "Folded", declaring_type: 1 },
    { name: "<Run>b__0 x", declaring_type: 2 },
  ],
  fields: [],
  properties: [],
  events: [],
  parameters: [],
  string_literals: [],
  binary: {
    artifact: {
      path: "/artifacts/libil2cpp.so",
      sha256: "b".repeat(64),
      bytes: 4096,
    },
    format: "elf",
    architecture: "arm64",
    image_base: "0x0",
    code_gen_modules_field: "0x800",
    code_gen_modules_array: "0x900",
    code_gen_modules: [{ image: 0, address: "0x700", method_pointer_count: 5 }],
    types_field: "0x900",
    types_count: 0,
    generic_methods: null,
  },
  method_addresses: [
    address("0x100"),
    address("no-body"),
    address("0x110"),
    address("0x100"),
    address("0x120"),
  ],
  return_types: [],
  field_types: [],
  parameter_types: [],
  generic_method_instances: null,
  limitations: [],
};

it("names linked methods Type$$Method with nested types and shifts by the base", () => {
  const seeds = il2cppGhidraSeeds(report, 0x100000n);
  expect(seeds).toEqual({
    text:
      "0x100100\tfunction\tGame.Player$$Update\n" +
      "0x100110\tfunction\tGame.Player.Slot$$Add\n" +
      "0x100120\tfunction\tGame.Player.Slot.<>c$$<Run>b__0_x\n" +
      "# folded 0x100100 Game.Player$$Update also Game.Player.Slot$$Folded\n" +
      `# metadata_sha256 ${report.artifact.sha256}\n# binary_sha256 ${report.binary!.artifact.sha256}\n# link_base 0x0\n# seed_base 0x100000\n`,
    functions: 3,
    folded: 1,
    folded_groups: [
      {
        address: "0x100100",
        kept: "Game.Player$$Update",
        also: ["Game.Player.Slot$$Folded"],
      },
    ],
    without_address: 1,
    no_body: 1,
    unknown: 0,
    generic_instances: null,
    generic_without_seed: null,
  });
  const parsed = parseGhidraSeeds(seeds.text);
  expect(parsed.ok && parsed.value.length).toBe(3);
});

it("seeds generic instances after definitions and folds shared code", () => {
  const row = (spec: number, name: string | null, rva: string) => ({
    method_spec: spec,
    method: 2,
    name,
    ...address(rva),
  });
  const seeds = il2cppGhidraSeeds(
    {
      ...report,
      generic_method_instances: [
        row(0, "Game.Player.Slot$$Add<int, string>", "0x130"),
        row(1, "Game.Player.Slot$$Add<object, string>", "0x100"),
        row(2, "Game.Player.Slot$$Add<long, string>", "0x130"),
        row(3, "Game.Player.Slot$$Add<bool, string>", "no-body"),
        row(4, "Game.Player.Slot$$Add<char, string>", "unknown"),
        row(5, null, "unknown"),
      ],
    },
    0x100000n,
  );
  expect(seeds.text).toBe(
    "0x100100\tfunction\tGame.Player$$Update\n" +
      "0x100110\tfunction\tGame.Player.Slot$$Add\n" +
      "0x100120\tfunction\tGame.Player.Slot.<>c$$<Run>b__0_x\n" +
      "0x100130\tfunction\tGame.Player.Slot$$Add<int,_string>\n" +
      "# folded 0x100100 Game.Player$$Update also Game.Player.Slot$$Folded Game.Player.Slot$$Add<object,_string>\n" +
      "# folded 0x100130 Game.Player.Slot$$Add<int,_string> also Game.Player.Slot$$Add<long,_string>\n" +
      `# metadata_sha256 ${report.artifact.sha256}\n# binary_sha256 ${report.binary!.artifact.sha256}\n# link_base 0x0\n# seed_base 0x100000\n`,
  );
  expect(seeds).toMatchObject({
    functions: 4,
    folded: 3,
    without_address: 1,
    generic_instances: 3,
    generic_without_seed: 3,
  });
  // The real consumer parser admits every generic seed name.
  const parsed = parseGhidraSeeds(seeds.text);
  expect(parsed.ok && parsed.value.length).toBe(4);
});

it("seeds neither a method without a body nor one no module claims", () => {
  const unknown = {
    ...report,
    method_addresses: report.method_addresses.map((row, index) =>
      index === 1 ? address("unknown") : row,
    ),
  };
  const seeds = il2cppGhidraSeeds(unknown, 0x100000n);
  expect(seeds.text).toBe(il2cppGhidraSeeds(report, 0x100000n).text);
  expect(seeds).toMatchObject({ without_address: 1, no_body: 0, unknown: 1 });
});

const inputFailure = (run: () => unknown): AnalysisInputError => {
  try {
    run();
  } catch (cause) {
    if (cause instanceof AnalysisInputError) return cause;
    throw cause;
  }
  throw new Error("Expected seed input rejection");
};
it("refuses an unlinked report", () => {
  const failure = inputFailure(() =>
    il2cppGhidraSeeds({ ...report, binary: null }, 0n),
  );
  expect(failure.issues[0]?.path).toEqual(["binary_path"]);
});

it("defaults to Ghidra's load base: 0x100000 for an ELF linked at 0, else the link base", () => {
  const binary = report.binary!;
  expect(ghidraDefaultBase(binary)).toBe(0x100000n);
  expect(ghidraDefaultBase({ ...binary, image_base: "0x200000" })).toBe(
    0x200000n,
  );
  expect(ghidraDefaultBase({ ...binary, format: "macho" })).toBe(0n);
  expect(
    ghidraDefaultBase({ ...binary, format: "pe", image_base: "0x180000000" }),
  ).toBe(0x180000000n);
});

it("bounds folded-name retention against the actual Ghidra file admission", () => {
  const count = 35000;
  const repeated = {
    ...report,
    methods: Array.from({ length: count }, () => ({
      name: "M".repeat(1000),
      declaring_type: 0,
    })),
    method_addresses: Array.from({ length: count }, () => address("0x100")),
  };
  let caught: unknown;
  try {
    il2cppGhidraSeeds(repeated, 0n);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AnalysisResourceConstraintError);
  if (!(caught instanceof AnalysisResourceConstraintError))
    throw new Error("Expected seed-file allowance refusal");
  expect(caught.message).toMatch(/byte admission/);
  expect(analysisErrorRemediationAction(caught)).toContain(
    "The IL2CPP Ghidra seed-file allowance",
  );
  expect(analysisErrorRemediationAction(caught)).toContain(
    "fixed byte allowance",
  );
  expect(analysisErrorRemediationAction(caught)).not.toContain("fixed count");
  expect(analysisErrorRemediationAction(caught)).not.toContain(
    "seed-name allowance",
  );
  expect(caught.retryable).toBe(false);
});
it("refuses cyclic type ancestry before emitting a seed", () => {
  const cyclic = {
    ...report,
    types: report.types.map((type, index) => ({
      ...type,
      declaring_type: index === 0 ? 1 : 0,
    })),
  };
  expect(
    inputFailure(() => il2cppGhidraSeeds(cyclic, 0n)).issues[0]?.message,
  ).toContain("Cyclic type ancestry");
});
it("refuses seed addresses that overflow after rebasing", () => {
  expect(
    inputFailure(() => il2cppGhidraSeeds(report, 0xffffffffffffffffn)).issues[0]
      ?.path,
  ).toEqual(["seed_base"]);
});
it("refuses names the real Ghidra seed parser cannot admit", () => {
  const oversized = {
    ...report,
    methods: [{ name: "M".repeat(2001), declaring_type: 0 }],
  };
  let caught: unknown;
  try {
    il2cppGhidraSeeds(oversized, 0n);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AnalysisResourceConstraintError);
  if (!(caught instanceof AnalysisResourceConstraintError))
    throw new Error("Expected seed-name allowance refusal");
  expect(caught.message).toMatch(/character admission/);
  expect(analysisErrorRemediationAction(caught)).toContain(
    "The IL2CPP Ghidra seed-name allowance",
  );
  expect(analysisErrorRemediationAction(caught)).toContain("fixed count");
  expect(analysisErrorRemediationAction(caught)).not.toContain(
    "fixed byte allowance",
  );
  expect(caught.retryable).toBe(false);
});

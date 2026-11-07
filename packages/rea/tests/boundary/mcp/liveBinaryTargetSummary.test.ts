import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import { expect, it } from "vitest";

import type { BinaryTarget } from "../../../src/domain/binaryTargetTypes.js";
import { ZIP_PACKAGE_FORMATS } from "../../../src/domain/zipPackageFormat.js";
import { binaryTargetSummary } from "../../../src/application/binary/BinaryTargetSummary.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { toolOutputSchemaWithMetadata } from "../../../src/contracts/toolSchemaMetadata.js";
import { sessionOutputSchemas } from "../../../src/contracts/toolOutputSchemaGroups.js";

const identity = { path: "/fixture/target", sha256: "a".repeat(64) };
const executable = { ...identity, kind: "executable" as const };
const elf = {
  elfClass: 32 as const,
  byteOrder: "little" as const,
  type: 2,
  flags: 0,
};
const targets: readonly BinaryTarget[] = [
  ...(["mach-o", "elf", "dos-mz", "dos-com"] as const).map((format) => ({
    ...executable,
    format,
    architecture: "x86" as const,
    availableArchitectures: ["x86" as const],
  })),
  {
    ...executable,
    format: "elf",
    architecture: "mips",
    availableArchitectures: ["mips"],
    mips: elf,
  },
  {
    ...executable,
    format: "elf",
    architecture: "riscv",
    availableArchitectures: ["riscv"],
    riscv: elf,
  },
  {
    ...executable,
    format: "elf",
    architecture: "powerpc",
    availableArchitectures: ["powerpc"],
    powerpc: elf,
  },
  {
    ...executable,
    format: "elf",
    architecture: "hexagon",
    availableArchitectures: ["hexagon"],
  },
  {
    ...executable,
    format: "mach-o",
    architecture: "arm64_32",
    availableArchitectures: ["arm64_32"],
  },
  {
    ...executable,
    format: "mach-o-universal",
    architecture: "arm64",
    availableArchitectures: ["arm64"],
    universalSlice: { offset: 32, size: 32 },
  },
  {
    ...executable,
    format: "pe",
    architecture: "x86_64",
    availableArchitectures: ["x86_64"],
    managed: false,
    executableRole: "application",
  },
  ...(["x86", "x86_64", "arm", "arm64", "6502", "m68k"] as const).map(
    (architecture) => ({
      ...executable,
      format: "raw-binary" as const,
      architecture,
      availableArchitectures: [architecture],
      entryPoint: "0x1000",
      entryPointSource: "0x00001000",
    }),
  ),
  {
    ...executable,
    format: "gamecube-dol",
    architecture: "powerpc",
    availableArchitectures: ["powerpc"],
    byteOrder: "big",
    bits: 32,
    entryPoint: "0x80003100",
    entryPointSource: "dol-header",
    dol: {
      sections: [],
      bss: { address: 0, size: 0 },
      bssGaps: [],
      bssOverlaps: [],
      entryPoint: 0x80003100,
    },
  },
  { ...identity, kind: "database", format: "analysis-database" },
  ...([...ZIP_PACKAGE_FORMATS, "asar", "godot-pck", "dmg", "pkg"] as const).map(
    (format) => ({ ...identity, kind: "archive" as const, format }),
  ),
  ...(["plist", "javascript", "source-map"] as const).map((format) => ({
    ...identity,
    kind: "artifact" as const,
    format,
  })),
];
const impossible = [
  { kind: "database", format: "elf", architecture: "x86" },
  { kind: "executable", format: "zip", architecture: "arm64" },
  { kind: "archive", format: "zip", architecture: "arm64" },
  { kind: "executable", format: "pe", architecture: null },
  { kind: "executable", format: "mach-o", architecture: "hexagon" },
  { kind: "executable", format: "elf", architecture: "arm64_32" },
  { kind: "executable", format: "pe", architecture: "mips" },
  { kind: "database", format: "hopper", architecture: null },
  {
    kind: "executable",
    format: "raw-binary",
    architecture: "riscv",
    entry_point: "0x1000",
  },
  { kind: "executable", format: "gamecube-dol", architecture: "powerpc" },
  {
    kind: "executable",
    format: "gamecube-dol",
    architecture: "arm",
    entry_point: "0x1000",
  },
];

it.each(["draft-2020-12", "draft-07"] as const)(
  "preserves canonical live summaries and rejects impossible classifications through %s clients",
  (target) => {
    const advertised = toolOutputSchemaWithMetadata(
      toolContract("open_binary"),
    )["~standard"].jsonSchema.output({ target });
    const validate = new AjvJsonSchemaValidator().getValidator(advertised);
    for (const target of targets) {
      const summary = binaryTargetSummary(target);
      expect(summary).toEqual({
        ...identity,
        kind: target.kind,
        format: target.format,
        architecture: target.architecture ?? null,
        ...(target.format === "raw-binary" || target.format === "gamecube-dol"
          ? { entry_point: target.entryPoint }
          : {}),
      });
      expect(
        sessionOutputSchemas.open_binary.safeParse({ result: summary }).success,
      ).toBe(true);
      expect(validate({ result: summary }).valid).toBe(true);
    }
    for (const classification of impossible) {
      const result = { ...identity, ...classification };
      expect(
        sessionOutputSchemas.open_binary.safeParse({ result }).success,
      ).toBe(false);
      expect(validate({ result }).valid).toBe(false);
    }
  },
);

const sessionFacts = {
  open: true,
  cleanup_pending: false,
  capabilities: [],
  analysis_run: null,
  analysis_activity: { status: "not_observed", providers: [] },
  provider_operation_health: null,
  analysis_provider_binding: null,
  analysis_provider_candidates: [],
  client_features: {
    elicitation_form: false,
    elicitation_url: false,
    roots: false,
    sampling: false,
  },
  server_identity: {
    package: {
      name: "rea",
      version: "fixture",
      root_path: "/fixture",
      build_commit: null,
    },
    server: {
      name: "rea",
      version: "fixture",
      started_at: "2026-01-01T00:00:00Z",
      command_path: null,
    },
    sdk: { server: "fixture", client_test: "fixture", core: "fixture" },
    negotiated_protocol_version: null,
    client: null,
    skill: { name: "rea", expected_version: "fixture" },
    catalog: {
      counts: { cli_commands: 0, mcp_tools: 0, mcp_prompts: 0 },
      digests: {
        tools_sha256: identity.sha256,
        prompts_sha256: identity.sha256,
        combined_sha256: identity.sha256,
      },
    },
    protocol_features: {
      progress: false,
      cancellation: false,
      elicitation: false,
    },
    alignment: { state: "unknown", reasons: [], remediation: null },
  },
  detail: "complete",
  tool_availability: {
    client_requirements: {
      required: [],
      optional: [],
      missing_required: [],
      missing_optional: [],
    },
    groups: [],
  },
};

it.each(["draft-2020-12", "draft-07"] as const)(
  "shares live classification admission with binary_session in %s",
  (target) => {
    const advertised = toolOutputSchemaWithMetadata(
      toolContract("binary_session"),
    )["~standard"].jsonSchema.output({ target });
    const validate = new AjvJsonSchemaValidator().getValidator(advertised);
    // One representative per distinct projection shape; the complete target matrix is above.
    for (const format of [
      "elf",
      "raw-binary",
      "gamecube-dol",
      "zip",
    ] as const) {
      const selected = targets.find((candidate) => candidate.format === format);
      if (selected === undefined)
        throw new Error(`Missing canonical fixture: ${format}`);
      const value = {
        result: { ...sessionFacts, ...binaryTargetSummary(selected) },
      };
      expect(sessionOutputSchemas.binary_session.safeParse(value).success).toBe(
        true,
      );
      expect(validate(value).valid).toBe(true);
    }
    for (const classification of impossible.slice(0, 4)) {
      const value = {
        result: { ...sessionFacts, ...identity, ...classification },
      };
      expect(sessionOutputSchemas.binary_session.safeParse(value).success).toBe(
        false,
      );
      expect(validate(value).valid).toBe(false);
    }
  },
);

import { describe, expect, it } from "vitest";

import {
  describeElectronFuseFindings,
  electronFuseName,
  electronFuseReportSchema,
  electronFuseState,
  ELECTRON_FUSE_SENTINEL,
  ELECTRON_FUSE_STATE_BYTES,
  ELECTRON_FUSE_V1_NAMES,
  type ElectronFuseSlice,
} from "./electronFuses.js";

const artifact = {
  selected_path: "/artifacts/Electron",
  resolved_path: "/artifacts/Electron",
  sha256: "a".repeat(64),
  bytes: 128,
  format: "mach-o" as const,
};

const sentinel = (
  offset: number,
  fuses: readonly number[],
  options?: {
    readonly version?: number | null;
    readonly declared?: number | null;
    readonly complete?: boolean;
  },
) => ({
  sentinel_offset: offset,
  wire_version: options?.version === undefined ? 1 : options.version,
  declared_length:
    options?.declared === undefined ? fuses.length : options.declared,
  fuses: fuses.map((raw, index) => ({
    index,
    name: electronFuseName(
      options?.version === undefined ? 1 : (options.version ?? 1),
      index,
    ),
    state: electronFuseState(raw),
    raw_byte: raw,
  })),
  complete: options?.complete ?? true,
});

const slice = (
  sentinels: ReturnType<typeof sentinel>[],
  index = 0,
): ElectronFuseSlice => ({
  index,
  file_offset: 0,
  size: 128,
  architecture: "arm64",
  sentinel_count: sentinels.length,
  sentinels,
});

it("validates implications across repeated FAT slices and rejects a false claim", () => {
  const slices = Array.from({ length: 128 }, (_, index) => ({
    ...slice(
      Array.from({ length: 32 }, (_, offset) =>
        sentinel(
          offset * 64,
          Array.from({ length: 8 }, () => ELECTRON_FUSE_STATE_BYTES.enabled),
        ),
      ),
      index,
    ),
    size: 4096,
  }));
  const report = {
    artifact: { ...artifact, bytes: 4096, format: "mach-o-universal" as const },
    slices,
    ...describeElectronFuseFindings(slices, "mach-o-universal"),
  };
  expect(electronFuseReportSchema.safeParse(report).success).toBe(true);
  const last = report.runtime_implications.at(-1);
  expect(last).toBeDefined();
  expect(
    electronFuseReportSchema.safeParse({
      ...report,
      runtime_implications: [{ ...last, outcome: "unknown" }],
    }).success,
  ).toBe(false);
});

describe("Electron fuse wire decoding", () => {
  it("keeps the 32-byte sentinel and version-1 names pinned", () => {
    expect(ELECTRON_FUSE_SENTINEL).toHaveLength(32);
    expect(ELECTRON_FUSE_V1_NAMES[3]).toBe("EnableNodeCliInspectArguments");
    expect(electronFuseName(1, 8)).toBe("WasmTrapHandlers");
    expect(electronFuseName(1, 9)).toBeNull();
    expect(electronFuseName(2, 0)).toBeNull();
  });

  it("preserves disabled, enabled, removed, and unknown bytes", () => {
    expect(electronFuseState(ELECTRON_FUSE_STATE_BYTES.disabled)).toBe(
      "disabled",
    );
    expect(electronFuseState(ELECTRON_FUSE_STATE_BYTES.enabled)).toBe(
      "enabled",
    );
    expect(electronFuseState(ELECTRON_FUSE_STATE_BYTES.removed)).toBe(
      "removed",
    );
    expect(electronFuseState(0x99)).toBe("unknown");
  });

  it("derives runtime implications from the fuse index and leaves unknowns unknown", () => {
    const fuses = [
      ELECTRON_FUSE_STATE_BYTES.disabled,
      ELECTRON_FUSE_STATE_BYTES.enabled,
      0x99,
      ELECTRON_FUSE_STATE_BYTES.removed,
      ELECTRON_FUSE_STATE_BYTES.disabled,
      ELECTRON_FUSE_STATE_BYTES.enabled,
    ];
    const report = electronFuseReportSchema.parse({
      artifact,
      slices: [slice([sentinel(8, fuses)])],
      ...describeElectronFuseFindings([slice([sentinel(8, fuses)])], "mach-o"),
    });
    expect(report.runtime_implications).toEqual([
      expect.objectContaining({
        subject: "node_cli_inspect_arguments",
        fuse_index: 3,
        outcome: "not_honored",
        relationship: "derivation",
      }),
      expect.objectContaining({
        subject: "electron_run_as_node",
        fuse_index: 0,
        outcome: "not_honored",
      }),
      expect.objectContaining({
        subject: "embedded_asar_integrity_validation",
        fuse_index: 4,
        outcome: "not_enforced",
      }),
      expect.objectContaining({
        subject: "only_load_app_from_asar",
        fuse_index: 5,
        outcome: "restricted_to_app_asar",
      }),
    ]);
    expect(report.slices[0] !== undefined && "fuses" in report.slices[0]).toBe(
      false,
    );
    expect(report.slices[0]?.sentinels[0]?.fuses[2]).toMatchObject({
      index: 2,
      name: "EnableNodeOptionsEnvironmentVariable",
      state: "unknown",
      raw_byte: 0x99,
    });
  });

  it("does not treat a short wire as disabled fuses", () => {
    const truncated = describeElectronFuseFindings(
      [
        slice([
          sentinel(8, [ELECTRON_FUSE_STATE_BYTES.enabled], {
            declared: 4,
            complete: false,
          }),
        ]),
      ],
      "mach-o",
    );
    expect(truncated.runtime_implications).toEqual([
      expect.objectContaining({
        subject: "electron_run_as_node",
        outcome: "honored",
      }),
    ]);
    expect(truncated.limitations.join(" ")).toContain("truncated");
    expect(truncated.limitations.join(" ")).toContain("fuse index 3");
  });

  it("reports every sentinel and skips implications for an unpinned wire version", () => {
    const findings = describeElectronFuseFindings(
      [
        slice([
          sentinel(8, [ELECTRON_FUSE_STATE_BYTES.enabled], { version: 2 }),
          sentinel(
            40,
            Array.from({ length: 6 }, () => ELECTRON_FUSE_STATE_BYTES.disabled),
          ),
        ]),
      ],
      "mach-o",
    );
    expect(findings.runtime_implications).toHaveLength(4);
    expect(findings.limitations.join(" ")).toContain("none is selected");
    expect(findings.limitations.join(" ")).toContain("wire version 2");
    expect(
      findings.runtime_implications.every(
        (item) => item.sentinel_offset === 40,
      ),
    ).toBe(true);
  });
});

describe("ELF embedded ASAR integrity applicability", () => {
  it("does not claim ASAR integrity enforcement for an enabled fuse on ELF", () => {
    const fuses = [
      ELECTRON_FUSE_STATE_BYTES.disabled,
      ELECTRON_FUSE_STATE_BYTES.disabled,
      ELECTRON_FUSE_STATE_BYTES.disabled,
      ELECTRON_FUSE_STATE_BYTES.disabled,
      ELECTRON_FUSE_STATE_BYTES.enabled,
    ];
    const slices = [slice([sentinel(4, fuses)])];
    const elf = describeElectronFuseFindings(slices, "elf");
    expect(slices[0]?.sentinels[0]?.fuses[4]).toMatchObject({
      index: 4,
      name: "EnableEmbeddedAsarIntegrityValidation",
      state: "enabled",
      raw_byte: ELECTRON_FUSE_STATE_BYTES.enabled,
    });
    expect(
      elf.runtime_implications.find(
        (item) => item.subject === "embedded_asar_integrity_validation",
      ),
    ).toMatchObject({
      relationship: "derivation",
      fuse_index: 4,
      outcome: "unknown",
    });
    expect(elf.limitations.join(" ")).toContain("only on macOS and Windows");
    expect(
      describeElectronFuseFindings(slices, "mach-o").runtime_implications.find(
        (item) => item.subject === "embedded_asar_integrity_validation",
      ),
    ).toMatchObject({ outcome: "enforced" });
    expect(
      describeElectronFuseFindings(slices, "pe").runtime_implications.find(
        (item) => item.subject === "embedded_asar_integrity_validation",
      ),
    ).toMatchObject({ outcome: "enforced" });
    expect(
      describeElectronFuseFindings(
        slices,
        "mach-o-universal",
      ).runtime_implications.find(
        (item) => item.subject === "embedded_asar_integrity_validation",
      ),
    ).toMatchObject({ outcome: "enforced" });
  });
});

it("rejects claimed wire bytes outside their slice and unsupported derivations", () => {
  const slices = [slice([sentinel(4, [ELECTRON_FUSE_STATE_BYTES.disabled])])];
  const findings = describeElectronFuseFindings(slices, "mach-o");
  const report = { artifact, slices, ...findings };
  expect(electronFuseReportSchema.safeParse(report).success).toBe(true);
  expect(
    electronFuseReportSchema.safeParse({
      ...report,
      artifact: { ...artifact, bytes: 36 },
      slices: [{ ...slices[0], size: 36 }],
    }).success,
  ).toBe(false);
  expect(
    electronFuseReportSchema.safeParse({
      ...report,
      runtime_implications: findings.runtime_implications.map((fact) => ({
        ...fact,
        outcome: "honored",
      })),
    }).success,
  ).toBe(false);
  expect(
    electronFuseReportSchema.safeParse({
      ...report,
      runtime_implications: [
        {
          relationship: "derivation",
          subject: "node_cli_inspect_arguments",
          fuse_index: 3,
          outcome: "honored",
          slice_index: 0,
          sentinel_offset: 4,
        },
      ],
    }).success,
  ).toBe(false);
});

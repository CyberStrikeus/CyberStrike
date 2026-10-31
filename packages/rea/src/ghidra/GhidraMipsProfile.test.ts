import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { ok } from "../domain/result.js";
import { parseConfig } from "../config/parseConfig.js";
import type {
  BinaryTarget,
  MipsElfMetadata,
} from "../domain/binaryTargetTypes.js";
import { silentLogger } from "../logger.js";
import { HopperProvider } from "../hopper/HopperProvider.js";
import { hopperLoaderArgsForTarget } from "../hopper/HopperAnalysisProfile.js";
import { IdaProvider } from "../ida/IdaProvider.js";
import { GhidraProvider } from "./GhidraProvider.js";
import { ghidraMipsProfileParameters } from "./GhidraMipsProfile.js";
import { ghidraProfileInstallationHost as host } from "./GhidraInstallation.fixture.js";
import { GHIDRA_SESSION_CAPABILITIES } from "./GhidraSessionValues.js";
import type { GhidraMipsSoftFloatReport } from "./GhidraMipsProfile.js";
import {
  ghidraPinnedLanguage,
  ghidraProfileLanguageOverride,
  ghidraProfilePinnedLanguage,
} from "./GhidraAnalysisProfile.js";

const parsed = parseConfig({ GHIDRA_INSTALL_DIR: "/ghidra" });
if (!parsed.ok) throw parsed.error;
const config = parsed.value;

const MIPS_LANGUAGE_DEFINITIONS = `<?xml version="1.0" encoding="UTF-8"?>
<language_definitions>
  <language processor="MIPS" endian="little" size="32" variant="default"
            id="MIPS:LE:32:default">
    <compiler name="default" spec="mips32.cspec" id="default"/>
  </language>
  <language processor="MIPS" endian="little" size="32" variant="16e"
            id="MIPS:LE:32:16e">
    <compiler name="default" spec="mips32.cspec" id="default"/>
  </language>
</language_definitions>
`;

const installedMipsConfig = async () => {
  const installDir = await createTestTempDirectory("rea-ghidra-mips-");
  const languages = join(installDir, "Ghidra/Processors/MIPS/data/languages");
  await mkdir(languages, { recursive: true });
  await writeFile(join(languages, "mips.ldefs"), MIPS_LANGUAGE_DEFINITIONS);
  const installed = parseConfig({
    GHIDRA_INSTALL_DIR: installDir,
    REA_GHIDRA_LANGUAGE_ID: "MIPS:LE:32:16e",
  });
  if (!installed.ok) throw installed.error;
  return installed.value;
};

const target = (change: Partial<MipsElfMetadata> = {}): BinaryTarget => ({
  path: "/fixture.elf",
  sha256: "a".repeat(64),
  kind: "executable",
  format: "elf",
  architecture: "mips",
  availableArchitectures: ["mips"],
  mips: {
    elfClass: 32,
    byteOrder: "little",
    type: 2,
    flags: 0x70001001,
    gnuAttributes: null,
    abiFlags: {
      version: 0,
      isaLevel: 32,
      isaRevision: 2,
      gprSize: 1,
      cpr1Size: 1,
      cpr2Size: 0,
      fpAbi: 5,
      isaExtension: 0,
      ases: 0,
      flags1: 0,
      flags2: 0,
    },
    ...change,
  },
});
const abi = (
  change: Partial<NonNullable<MipsElfMetadata["abiFlags"]>>,
): Partial<MipsElfMetadata> => {
  const base = target();
  if (base.kind !== "executable" || base.architecture !== "mips")
    throw new Error("expected a MIPS fixture target");
  const flags = base.mips.abiFlags;
  if (flags === undefined || flags === null)
    throw new Error("expected fixture ABI flags");
  return { abiFlags: { ...flags, ...change } };
};
const softFloat = abi({ cpr1Size: 0, fpAbi: 3 });

describe("bounded Ghidra MIPS admission", () => {
  it("binds endian and flags without widening Windows P0", async () => {
    const ghidra = new GhidraProvider(config, silentLogger, {}, host);
    const little = target();
    const big = target({ byteOrder: "big" });
    expect(ghidra.inspectTargetSupport(little).status).toBe("supported");
    expect(ghidra.inspectTargetSupport(big).status).toBe("supported");
    const left = await ghidra.resolveAnalysisProfile(little);
    const right = await ghidra.resolveAnalysisProfile(big);
    if (!left.ok) throw left.error;
    if (!right.ok) throw right.error;
    expect(left.value.profile?.parameters.mips_elf).toEqual({
      elf_class: 32,
      byte_order: "little",
      type: 2,
      flags: 0x70001001,
      abi_flags: {
        version: 0,
        isa_level: 32,
        isa_revision: 2,
        gpr_size: 1,
        cpr1_size: 1,
        cpr2_size: 0,
        fp_abi: 5,
        isa_extension: 0,
        ases: 0,
        flags1: 0,
        flags2: 0,
      },
      gnu_attributes: null,
    });
    expect(left.value.profile?.digest).toEqual(expect.any(String));
    expect(right.value.profile?.digest).toEqual(expect.any(String));
    expect(left.value.profile?.digest).not.toBe(right.value.profile?.digest);
    const windows = new GhidraProvider(
      config,
      silentLogger,
      {},
      {
        ...host,
        platform: "win32",
      },
    );
    expect(windows.inspectTargetSupport(little).status).toBe("unsupported");
  });

  it.each([
    [{ elfClass: 64 }, "ELF32"],
    [{ type: 3 }, "ET_EXEC and ET_REL"],
    [{ type: 0xffa0 }, "ET_EXEC and ET_REL"],
    [{ flags: 0x10a23001 }, "separate MIPS ABI flags"],
    [{ flags: 0x70001021 }, "o32"],
    [{ flags: 0x70000001 }, "o32"],
    [{ flags: 0x70002001 }, "o32"],
    [{ flags: 0x70003001 }, "o32"],
    [{ flags: 0x70004001 }, "o32"],
    [{ flags: 0x72001001 }, "ASE"],
    [{ flags: 0x74001001 }, "ASE"],
    [{ flags: 0x70911001 }, "Machine-specific"],
    [{ flags: 0x60001001 }, "32R2"],
    [{ flags: 0x00001001 }, "recordless legacy admission"],
    [{ flags: 0x10000001 }, "other ISA revisions"],
    [{ flags: 0x70001201 }, "EF_MIPS_FP64"],
    [{ flags: 0x70001401 }, "EF_MIPS_NAN2008"],
    [{ abiFlags: null }, "inspected ABI"],
    [abi({ cpr1Size: 0, fpAbi: 1 }), "soft-float without CPR1"],
    [abi({ cpr1Size: 1, fpAbi: 3 }), "soft-float without CPR1"],
    [abi({ cpr1Size: 1, fpAbi: 2 }), "single-float"],
    [abi({ cpr1Size: 1, fpAbi: 0 }), "unspecified"],
    [abi({ cpr1Size: 2, fpAbi: 6 }), "FP64"],
  ] satisfies [Partial<MipsElfMetadata>, string][])(
    "refuses an unverified MIPS interpretation %j",
    async (change, reason) => {
      const ghidra = new GhidraProvider(config, silentLogger, {}, host);
      const value = target(change);
      expect(ghidra.inspectTargetSupport(value)).toMatchObject({
        status: "unsupported",
        reason: expect.stringContaining(reason),
      });
      const resolved = await ghidra.resolveAnalysisProfile(value);
      expect(resolved).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisUnsupportedTargetError",
          reason: expect.stringContaining(reason),
        },
      });
    },
  );

  it("keeps MIPS out of unverified Hopper and IDA adapter lanes", () => {
    const hopper = new HopperProvider(config, silentLogger, {}, "linux");
    expect(hopper.inspectTargetSupport(target()).status).toBe("unsupported");
    expect(hopperLoaderArgsForTarget(target()).ok).toBe(false);
    const ida = new IdaProvider(config, {});
    expect(ida.inspectTargetSupport(target()).status).toBe("unsupported");
  });
});

describe("recordless legacy MIPS admission", () => {
  it.each([0x50000001, 0x00000001])(
    "keeps recordless relocatable objects off the inferred-o32 lane (%i)",
    async (flags) => {
      const ghidra = new GhidraProvider(config, silentLogger, {}, host);
      const object = target({
        flags,
        abiFlags: null,
        type: 1,
      });
      expect(ghidra.inspectTargetSupport(object)).toMatchObject({
        status: "unsupported",
      });
      const resolved = await ghidra.resolveAnalysisProfile(object);
      expect(resolved).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisUnsupportedTargetError",
          reason: expect.stringContaining("ET_EXEC"),
        },
      });
    },
  );

  it.each([
    [{ flags: 0x00000001 }, "elf32-exec-mips1-legacy-pinned-v1"],
    [{ flags: 0x50000001 }, "elf32-exec-arch32-legacy-pinned-v1"],
    [{ flags: 0x70000001 }, "elf32-exec-arch32-legacy-pinned-v1"],
  ] satisfies [Partial<MipsElfMetadata>, string][])(
    "admits a recordless legacy header (%j) with a pinned 32-bit language",
    async (change, lane) => {
      const ghidra = new GhidraProvider(config, silentLogger, {}, host);
      const little = target({ ...change, abiFlags: null });
      const big = target({ ...change, abiFlags: null, byteOrder: "big" });
      expect(ghidra.inspectTargetSupport(little).status).toBe("supported");
      expect(ghidra.inspectTargetSupport(big).status).toBe("supported");
      const resolved = await ghidra.resolveAnalysisProfile(little);
      if (!resolved.ok) throw resolved.error;
      expect(resolved.value.profile?.parameters).toMatchObject({
        mips_support_lane: lane,
        mips_abi_basis: "inferred-o32-assumption-v1",
        language_id: "MIPS:LE:32:default",
        compiler_spec_id: "default",
        language_selection: "provider-pinned-v1",
      });
      const resolvedBig = await ghidra.resolveAnalysisProfile(big);
      if (!resolvedBig.ok) throw resolvedBig.error;
      expect(resolvedBig.value.profile?.parameters).toMatchObject({
        language_id: "MIPS:BE:32:default",
      });
    },
  );

  it("requires an inspected absence; a merely unobserved record stays refused", () => {
    const ghidra = new GhidraProvider(config, silentLogger, {}, host);
    const withRecord = target({ flags: 0x50000001 }) as BinaryTarget & {
      mips: MipsElfMetadata;
    };
    const { abiFlags: _record, ...unobservedMips } = withRecord.mips;
    void _record;
    expect(
      ghidra.inspectTargetSupport({
        ...withRecord,
        mips: unobservedMips,
      } as BinaryTarget),
    ).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("recordless legacy header"),
    });
  });

  it.each([
    [{ flags: 0x50000021 }, "n32"],
    [{ flags: 0x50000041 }, "EF_MIPS_ABI_ON32"],
    [{ flags: 0x50000101 }, "EF_MIPS_32BITMODE"],
    [{ flags: 0x00000201 }, "EF_MIPS_FP64"],
    [{ flags: 0x70000101 }, "EF_MIPS_32BITMODE"],
    [
      { flags: 0x50001001 },
      "EF_MIPS_ARCH_32R2 for headers that declare an ABI",
    ],
    [{ flags: 0x50000201 }, "EF_MIPS_FP64"],
    [{ flags: 0x50000401 }, "EF_MIPS_NAN2008"],
    [{ flags: 0x60000001 }, "32R2"],
    [
      {
        flags: 0x50000001,
        limitations: [
          "MIPS section header table at file offset 96 extends beyond the captured file: examined 2 of 5 complete headers. ABI declarations in unavailable headers remain unknown.",
        ],
      },
      "complete ABI-record inspection",
    ],
  ] satisfies [Partial<MipsElfMetadata>, string][])(
    "keeps refusing unverified recordless variants %j",
    (change, reason) => {
      const ghidra = new GhidraProvider(config, silentLogger, {}, host);
      expect(
        ghidra.inspectTargetSupport(target({ ...change, abiFlags: null })),
      ).toMatchObject({
        status: "unsupported",
        reason: expect.stringContaining(reason),
      });
    },
  );

  it("a caller-selected language wins over the provider pin", () => {
    const parameters = ghidraMipsProfileParameters(
      target({ flags: 0x50000001, abiFlags: null }),
      { languageId: "MIPS:LE:32:default", compilerSpecId: "default" },
    );
    expect(parameters.language_selection).toBeUndefined();
    expect(parameters.language_id).toBeUndefined();
    expect(parameters).toMatchObject({
      mips_support_lane: "elf32-exec-arch32-legacy-pinned-v1",
    });
  });

  it("reports the MIPS-I decoder assumption as a session limitation", async () => {
    const { client } = await session(
      target({ flags: 0x00000001, abiFlags: null }),
      undefined,
    );
    const health = await client.execute("health", {});
    if (!health.ok) throw health.error;
    expect(health.value.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("declares the MIPS-I ISA"),
        expect.stringContaining("generic 32-bit MIPS language"),
      ]),
    );
  });

  it("reads the pinned import language back only from pinned profiles", () => {
    const pinned = ghidraMipsProfileParameters(
      target({ flags: 0x50000001, abiFlags: null }),
    );
    expect(ghidraProfilePinnedLanguage(pinned)).toEqual({
      languageId: "MIPS:LE:32:default",
      compilerSpecId: "default",
    });
    const standard = ghidraMipsProfileParameters(target());
    expect(ghidraProfilePinnedLanguage(standard)).toBeUndefined();
  });
});

describe("caller-selected MIPS-I language", () => {
  it("reports the selected language instead of the provider pin", async () => {
    const mips1 = target({ flags: 0x00000001, abiFlags: null });
    const { profile, client } = await session(
      mips1,
      undefined,
      mips1,
      await installedMipsConfig(),
    );
    expect(profile.parameters).toMatchObject({
      mips_support_lane: "elf32-exec-mips1-legacy-pinned-v1",
      language_id: "MIPS:LE:32:16e",
      language_selection: "configured-v1",
    });
    const health = await client.execute("health", {});
    if (!health.ok) throw health.error;
    const limitations = health.value.limitations.join("\n");
    expect(limitations).toContain("caller-selected MIPS:LE:32:16e");
    expect(limitations).not.toContain(
      "REA pins the generic 32-bit MIPS language",
    );
  });
});

const report: GhidraMipsSoftFloatReport = {
  policy: "o32-soft-float-prototype-v1",
  functions: 5,
  definitions: 1,
};
const session = async (
  value: BinaryTarget,
  reported: GhidraMipsSoftFloatReport | undefined,
  profileFor: BinaryTarget = value,
  sessionConfig: typeof config = config,
) => {
  const counts = { starts: 0, calls: 0, closes: 0 };
  const ghidra = new GhidraProvider(
    sessionConfig,
    silentLogger,
    {},
    host,
    () => ({
      start: () => {
        counts.starts++;
        return Promise.resolve(
          ok({
            name: "REA Ghidra bridge" as const,
            run_id: "11111111-1111-4111-8111-111111111111",
            profile_digest: "a".repeat(64),
            provider: { id: "ghidra" as const, version: "12.1.4" },
            read_only: false,
            analysis_complete: true,
            analysis_timed_out: false,
            capabilities: [...GHIDRA_SESSION_CAPABILITIES],
            target: {
              name: "fixture.elf",
              language_id: "MIPS:LE:32:default",
              compiler_spec_id: "default",
              image_base: "0x0",
              default_address_space: "ram",
              sha256: "a".repeat(64),
            },
            ...(reported === undefined
              ? {}
              : { mips_soft_float_storage: reported }),
          }),
        );
      },
      callTool: () => {
        counts.calls++;
        return Promise.resolve(ok(null));
      },
      close: () => {
        counts.closes++;
        return Promise.resolve(ok(null));
      },
    }),
  );
  const resolved = await ghidra.resolveAnalysisProfile(profileFor);
  if (!resolved.ok || resolved.value.profile === null)
    throw new Error("expected a MIPS profile");
  return {
    counts,
    profile: resolved.value.profile,
    client: ghidra.createClient(value, resolved.value.profile),
  };
};

describe("legacy profile bindings", () => {
  it("refuses a legacy endian pin committed for a different target", async () => {
    const { counts, client } = await session(
      target({ flags: 0x50000001, abiFlags: null, byteOrder: "big" }),
      undefined,
      target({ flags: 0x50000001, abiFlags: null, byteOrder: "little" }),
    );
    expect((await client.execute("health", {})).ok).toBe(false);
    expect(counts.starts).toBe(0);
  });
  it.each([
    [
      "MIPS-I target with a MIPS32 profile",
      target({ flags: 0x00000001, abiFlags: null }),
      target({ flags: 0x50000001, abiFlags: null }),
    ],
    [
      "MIPS32 target with a MIPS-I profile",
      target({ flags: 0x50000001, abiFlags: null }),
      target({ flags: 0x00000001, abiFlags: null }),
    ],
  ])(
    "refuses a same-endian legacy profile from a different MIPS lane (%s)",
    async (_name, value, profileFor) => {
      const { counts, client } = await session(value, undefined, profileFor);
      expect((await client.execute("health", {})).ok).toBe(false);
      expect(counts.starts).toBe(0);
    },
  );
  it("refuses a same-lane legacy profile with different ELF metadata", async () => {
    const { counts, client } = await session(
      target({ flags: 0x70000001, abiFlags: null }),
      undefined,
      target({ flags: 0x50000001, abiFlags: null }),
    );
    expect((await client.execute("health", {})).ok).toBe(false);
    expect(counts.starts).toBe(0);
  });
  it.each([0x50000201, 0x50000401, 0x54000001, 0x50910001])(
    "refuses unsupported same-endian legacy flags %i before startup",
    async (flags) => {
      const value = target({ flags, abiFlags: null });
      expect(ghidraPinnedLanguage(value)).toBeUndefined();
      const { counts, client } = await session(
        value,
        undefined,
        target({ flags: 0x50000001, abiFlags: null }),
      );
      expect((await client.execute("health", {})).ok).toBe(false);
      expect(counts.starts).toBe(0);
    },
  );
  const unpinnedTargets: BinaryTarget[] = [
    target(),
    {
      path: "/fixture.elf",
      sha256: "a".repeat(64),
      kind: "executable",
      format: "elf",
      architecture: "x86_64",
      availableArchitectures: ["x86_64"],
    },
  ];
  it.each(unpinnedTargets)(
    "refuses a pinned profile for an unpinned target $architecture",
    async (value) => {
      expect(ghidraPinnedLanguage(value)).toBeUndefined();
      const { counts, client } = await session(
        value,
        undefined,
        target({ flags: 0x50000001, abiFlags: null }),
      );
      expect((await client.execute("health", {})).ok).toBe(false);
      expect(counts.starts).toBe(0);
    },
  );
});

describe("MIPS16 shared-image profile", () => {
  const shared = (change: Partial<MipsElfMetadata> = {}) =>
    target({
      type: 3,
      flags: 0x74001005,
      abiFlags: null,
      sharedLoad: {
        status: "complete",
        relocationCount: 14,
        relocationTypes: [0, 3],
        symbolRelativeCount: 0,
      },
      ...change,
    });
  it.each(["little", "big"] as const)(
    "pins a generic 32-bit %s language and retains the source ABI uncertainty",
    async (byteOrder) => {
      const ghidra = new GhidraProvider(config, silentLogger, {}, host);
      const value = shared({ byteOrder });
      expect(ghidra.inspectTargetSupport(value).status).toBe("supported");
      const resolved = await ghidra.resolveAnalysisProfile(value);
      if (!resolved.ok || resolved.value.profile === null)
        throw new Error("expected shared profile");
      const parameters = resolved.value.profile.parameters;
      expect(parameters).toMatchObject({
        language_id: `MIPS:${byteOrder === "little" ? "LE" : "BE"}:32:default`,
        compiler_spec_id: "default",
        language_selection: "provider-pinned-v1",
        mips_support_lane: "elf32-dyn-o32-arch32r2-mips16-local-rel32-v1",
        mips_elf: { abi_flags: null },
      });
      expect(ghidraProfileLanguageOverride(parameters)).toEqual({
        languageId: parameters.language_id,
        compilerSpecId: "default",
      });
    },
  );
  it("retains shared-image and unknown floating-point limitations on the session", async () => {
    const { client } = await session(shared(), undefined);
    const health = await client.execute("health", {});
    if (!health.ok) throw health.error;
    expect(health.value.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("External GOT bindings"),
        expect.stringContaining("does not establish the floating-point ABI"),
      ]),
    );
  });
  it("continues to admit a declared FPXX record only when its MIPS16 ASE agrees", () => {
    const ghidra = new GhidraProvider(config, silentLogger, {}, host);
    expect(
      ghidra.inspectTargetSupport(shared(abi({ ases: 0x400 }))).status,
    ).toBe("supported");
    expect(ghidra.inspectTargetSupport(shared(abi({ ases: 0 }))).status).toBe(
      "unsupported",
    );
  });
  it.each([
    { flags: 0x74001045 },
    { limitations: ["Unexamined section declarations"] },
    {
      sharedLoad: {
        status: "complete",
        relocationCount: 1,
        relocationTypes: [3],
        symbolRelativeCount: 1,
      },
    },
  ] satisfies Partial<MipsElfMetadata>[])(
    "refuses incomplete or unverified source declarations %j",
    (change) => {
      const ghidra = new GhidraProvider(config, silentLogger, {}, host);
      expect(ghidra.inspectTargetSupport(shared(change)).status).toBe(
        "unsupported",
      );
    },
  );
  it.each(["sharedLoad", "abiFlags", "gnuAttributes"] as const)(
    "refuses an uninspected %s declaration",
    (declaration) => {
      const value = shared();
      if (value.kind !== "executable" || value.architecture !== "mips")
        throw new Error("expected MIPS target");
      const facts = { ...value.mips };
      delete facts[declaration];
      const ghidra = new GhidraProvider(config, silentLogger, {}, host);
      expect(
        ghidra.inspectTargetSupport({ ...value, mips: facts }),
      ).toMatchObject({
        status: "unsupported",
        reason: expect.stringContaining(
          {
            abiFlags: "inspected ABI flags",
            gnuAttributes: "GNU MIPS ABI attribute inspection is unavailable",
            sharedLoad: "have not been inspected",
          }[declaration],
        ),
      });
    },
  );
  it("refuses an endian pin committed for a different target", async () => {
    const { counts, client } = await session(
      shared({ byteOrder: "big" }),
      undefined,
      shared(),
    );
    const health = await client.execute("health", {});
    expect(health.ok).toBe(false);
    expect(counts.starts).toBe(0);
  });
  it("rejects a caller-selected global MIPS16 processor without replacing the request", async () => {
    const parsed = parseConfig({
      GHIDRA_INSTALL_DIR: "/ghidra",
      REA_GHIDRA_LANGUAGE_ID: "MIPS:LE:32:16e",
    });
    if (!parsed.ok) throw parsed.error;
    const ghidra = new GhidraProvider(parsed.value, silentLogger, {}, host);
    const resolved = await ghidra.resolveAnalysisProfile(shared());
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.error.message).toContain(
        "requested override has not been changed",
      );
      expect(resolved.error).toMatchObject({
        _tag: "ConfigurationError",
        settings: [{ setting: "REA_GHIDRA_LANGUAGE_ID" }],
      });
    }
  });
});

describe("soft-float MIPS storage", () => {
  it("admits soft-float o32 and commits its storage policy only for it", async () => {
    const soft = target(softFloat);
    const ghidra = new GhidraProvider(config, silentLogger, {}, host);
    expect(ghidra.inspectTargetSupport(soft).status).toBe("supported");
    const { profile } = await session(soft, report);
    expect(profile.parameters.mips_soft_float_storage).toBe(
      "o32-soft-float-prototype-v1",
    );
    const hard = await session(target(), undefined);
    expect(hard.profile.parameters).not.toHaveProperty(
      "mips_soft_float_storage",
    );
  });

  it("admits the ODDSPREG default that soft-float toolchains emit, but no other flags", () => {
    const ghidra = new GhidraProvider(config, silentLogger, {}, host);
    // GCC 5.2 kernel modules and LLVM/Rust firmware both record flags1 = 1.
    expect(
      ghidra.inspectTargetSupport(
        target(abi({ cpr1Size: 0, fpAbi: 3, flags1: 1 })),
      ).status,
    ).toBe("supported");
    expect(
      ghidra.inspectTargetSupport(
        target(abi({ cpr1Size: 0, fpAbi: 3, flags1: 2 })),
      ),
    ).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("general flags"),
    });
  });

  it("reports the prototype outcome as session limitations", async () => {
    const { client } = await session(target(softFloat), report);
    const health = await client.execute("health", {});
    if (!health.ok) throw health.error;
    expect(health.value.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("model hard-float o32 only"),
        expect.stringContaining(
          "5 functions and 1 function-pointer definitions use __rea_soft_float.",
        ),
      ]),
    );
  });

  it("admits relocatable objects under their own lane with coordinate limitations", async () => {
    const relocatable = target({ type: 1 });
    const { profile, client } = await session(relocatable, undefined);
    expect(profile.parameters.mips_support_lane).toBe(
      "elf32-rel-o32-arch32r2-standard-v1",
    );
    const executable = await session(target(), undefined);
    expect(executable.profile.parameters.mips_support_lane).toBe(
      "elf32-exec-o32-arch32r2-standard-v3",
    );
    const health = await client.execute("health", {});
    if (!health.ok) throw health.error;
    expect(health.value.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("analysis coordinates"),
        expect.stringContaining("EXTERNAL block"),
      ]),
    );
    const executableHealth = await executable.client.execute("health", {});
    if (!executableHealth.ok) throw executableHealth.error;
    expect(executableHealth.value.limitations.join(" ")).not.toContain(
      "Relocatable MIPS ELF",
    );
  });

  it.each([
    {
      reason:
        "a soft-float session without a storage report before any analysis call",
      value: target(softFloat),
      storageReport: undefined,
      operation: "list_procedures",
    },
    {
      reason: "soft-float storage reported by a hard-float session",
      value: target(),
      storageReport: report,
      operation: "health",
    },
  ] as const)(
    "rejects $reason",
    async ({ value, storageReport, operation }) => {
      const { counts, client } = await session(value, storageReport);
      const failed = await client.execute(operation, {});
      expect(failed.ok).toBe(false);
      if (!failed.ok) expect(failed.error._tag).toBe("ProviderAdapterError");
      expect(counts).toEqual({ starts: 1, calls: 0, closes: 1 });
    },
  );

  it("refuses a profile whose storage policy disagrees with the target", async () => {
    for (const [value, profileFor] of [
      [target(softFloat), target()],
      [target(), target(softFloat)],
    ] as const) {
      const { counts, client } = await session(value, report, profileFor);
      const failed = await client.execute("health", {});
      expect(failed.ok).toBe(false);
      expect(counts.starts).toBe(0);
    }
  });
});

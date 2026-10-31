import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseConfig } from "../config/parseConfig.js";
import type {
  BinaryTarget,
  RiscvElfMetadata,
} from "../domain/binaryTargetTypes.js";
import { ok } from "../domain/result.js";
import { riscvIsaDeclaration } from "../domain/riscvIsaDeclaration.js";
import { silentLogger } from "../logger.js";
import { HopperProvider } from "../hopper/HopperProvider.js";
import { hopperLoaderArgsForTarget } from "../hopper/HopperAnalysisProfile.js";
import { IdaProvider } from "../ida/IdaProvider.js";
import { GhidraProvider } from "./GhidraProvider.js";
import {
  GHIDRA_RISCV32_DECODED_EXTENSIONS,
  GHIDRA_RISCV_CALLING_CONVENTIONS,
  GHIDRA_RISCV_CALLING_CONVENTION_IDS,
  GHIDRA_RISCV_LANES,
  ghidraRiscvCallingConvention,
  ghidraRiscvCallingConventionFailure,
  ghidraRiscvLimitations,
  ghidraRiscvSupportLane,
  ghidraRiscvUnsupportedReason,
  type GhidraRiscvCallingConventionReport,
} from "./GhidraRiscvProfile.js";
import { ghidraProjectHistoryEvidence } from "./GhidraProjectHistory.js";
import {
  GHIDRA_SESSION_CAPABILITIES,
  type GhidraSessionInfo,
} from "./GhidraSessionValues.js";
import { ghidraProfileInstallationHost as host } from "./GhidraInstallation.fixture.js";
import {
  ghidraPinnedLanguage,
  ghidraProfileLanguageOverride,
  sameGhidraLanguageOverride,
} from "./GhidraAnalysisProfile.js";

// Abbreviated from Ghidra 12.1.4 Processors/RISCV/data/languages/riscv.ldefs.
// The release tree ships no big-endian or ELF-class-mismatched RISC-V language.
const RISCV_LDEFS = `<?xml version="1.0" encoding="UTF-8"?>
<language_definitions>
  <language processor="RISCV"
            endian="little"
            size="64"
            variant="default"
            version="1.4"
            slafile="riscv.lp64d.sla"
            processorspec="RV64.pspec"
            id="RISCV:LE:64:default">
    <description>RISC-V 64 little default</description>
    <compiler name="gcc" spec="riscv64-fp.cspec" id="gcc"/>
  </language>
  <language processor="RISCV"
            endian="little"
            size="32"
            variant="default"
            version="1.4"
            slafile="riscv.ilp32d.sla"
            processorspec="RV32.pspec"
            id="RISCV:LE:32:default">
    <description>RISC-V 32 little default</description>
    <compiler name="gcc" spec="riscv32-fp.cspec" id="gcc"/>
  </language>
</language_definitions>
`;

const configOf = (
  installDir: string,
  environment: Record<string, string> = {},
) => {
  const parsed = parseConfig({
    GHIDRA_INSTALL_DIR: installDir,
    ...environment,
  });
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const target = (change: Partial<RiscvElfMetadata> = {}): BinaryTarget => ({
  path: "/fixture.elf",
  sha256: "a".repeat(64),
  kind: "executable",
  format: "elf",
  architecture: "riscv",
  availableArchitectures: ["riscv"],
  riscv: {
    elfClass: 64,
    byteOrder: "little",
    type: 2,
    flags: 0x5,
    ...change,
  },
});
// ESP-IDF's ESP32-C3 base string, as LLVM records it for the lane's fixture.
const C3_ARCH = "rv32i2p1_m2p0_c2p0_zicsr2p0_zifencei2p0_zmmul1p0";
const ilp32 = (
  arch: string = C3_ARCH,
  change: Partial<RiscvElfMetadata> = {},
): BinaryTarget =>
  target({
    elfClass: 32,
    flags: 0x1,
    isa: riscvIsaDeclaration(arch),
    ...change,
  });

let installDir = "";
beforeAll(async () => {
  const root =
    process.platform === "win32" ? join(process.cwd(), "build") : tmpdir();
  await mkdir(root, { recursive: true });
  installDir = await mkdtemp(join(root, "rea-ghidra-riscv-languages-"));
  // The simulated Linux host needs a POSIX absolute path. A current-drive root
  // path also reaches this real fixture on Windows without changing admission.
  if (process.platform === "win32")
    installDir = `/${relative(parse(installDir).root, installDir).replaceAll("\\", "/")}`;
  const languages = join(installDir, "Ghidra/Processors/RISCV/data/languages");
  await mkdir(languages, { recursive: true });
  await writeFile(join(languages, "riscv.ldefs"), RISCV_LDEFS);
});
afterAll(async () => {
  await rm(installDir, { recursive: true, force: true });
});

const ghidra = (environment: Record<string, string> = {}) =>
  new GhidraProvider(configOf(installDir, environment), silentLogger, {}, host);

const registerRiscvLanguageCommitmentCases = () => {
  it("pins the generic language per width instead of accepting the header guess", async () => {
    const provider = ghidra();
    const rv64 = target();
    const rv32 = target({ elfClass: 32, flags: 0x4 });
    expect(provider.inspectTargetSupport(rv64).status).toBe("supported");
    expect(provider.inspectTargetSupport(rv32).status).toBe("supported");
    expect(ghidraPinnedLanguage(rv64)).toEqual({
      languageId: "RISCV:LE:64:default",
      compilerSpecId: "gcc",
    });
    expect(ghidraPinnedLanguage(rv32)).toEqual({
      languageId: "RISCV:LE:32:default",
      compilerSpecId: "gcc",
    });
    const wide = await provider.resolveAnalysisProfile(rv64);
    const narrow = await provider.resolveAnalysisProfile(rv32);
    if (!wide.ok || !narrow.ok)
      throw new Error("expected admitted RISC-V profiles");
    expect(wide.value.profile?.parameters.riscv_elf).toEqual({
      elf_class: 64,
      byte_order: "little",
      type: 2,
      flags: 5,
      float_abi_double: true,
      rvc_declared: true,
      rve_declared: false,
      tso_declared: false,
    });
    expect(wide.value.profile?.parameters.riscv_support_lane).toBe(
      "elf64-exec-le-double-float-generic-v1",
    );
    expect(narrow.value.profile?.parameters.riscv_support_lane).toBe(
      "elf32-exec-le-double-float-generic-v1",
    );
    expect(narrow.value.profile?.parameters.riscv_elf).toMatchObject({
      elf_class: 32,
      rvc_declared: false,
    });
    expect(wide.value.profile?.digest).toEqual(expect.any(String));
    expect(narrow.value.profile?.digest).toEqual(expect.any(String));
    expect(wide.value.profile?.digest).not.toBe(narrow.value.profile?.digest);
  });

  it("commits the pinned language the session readback expects", async () => {
    // A pinned lane has one owner: the committed profile and the open_binary
    // readback must agree without either re-deriving a different family's pin.
    const provider = ghidra();
    for (const value of [target(), target({ elfClass: 32 })]) {
      const resolved = await provider.resolveAnalysisProfile(value);
      if (!resolved.ok || resolved.value.profile === null)
        throw new Error("expected a RISC-V profile");
      expect(
        sameGhidraLanguageOverride(
          ghidraProfileLanguageOverride(resolved.value.profile.parameters),
          ghidraPinnedLanguage(value),
        ),
      ).toBe(true);
    }
  });

  it("names the pinned RISC-V language when the session readback refuses", async () => {
    const value = target();
    const resolved = await ghidra().resolveAnalysisProfile(value);
    if (!resolved.ok || resolved.value.profile === null)
      throw new Error("expected a RISC-V profile");
    const profile = resolved.value.profile;
    const overridden = await ghidra({
      REA_GHIDRA_LANGUAGE_ID: "RISCV:LE:64:default",
    })
      .createClient(value, profile)
      .execute("health", {});
    const foreign = await ghidra()
      .createClient(
        {
          path: "/fixture.elf",
          sha256: "a".repeat(64),
          kind: "executable",
          format: "elf",
          architecture: "x86_64",
          availableArchitectures: ["x86_64"],
        },
        profile,
      )
      .execute("health", {});
    if (overridden.ok || foreign.ok)
      throw new Error("expected readback refusals");
    for (const failed of [overridden, foreign]) {
      expect(failed.error._tag).toBe("ProviderAdapterError");
      expect(failed.error.diagnostics?.reason).toEqual(
        expect.stringContaining("RISCV:LE:64:default"),
      );
    }
    expect(overridden.error.diagnostics?.reason).toEqual(
      expect.stringContaining("REA_GHIDRA_LANGUAGE_ID"),
    );
  });
};

const registerRiscvAdmissionAndCapabilityCases = () => {
  it.each([
    [{ byteOrder: "big" }, "little-endian"],
    [{ type: 3 }, "fixed-address ET_EXEC only"],
    [{ type: 1 }, "fixed-address ET_EXEC only"],
    [{ type: 0xffa0 }, "e_type 65440"],
    [{ flags: 0xc }, "EF_RISCV_RVE"],
    [{ flags: 0x14 }, "EF_RISCV_TSO"],
    [{ flags: 0x1 }, "soft-float ABI (lp64) declared by e_flags"],
    [{ flags: 0x3 }, "single-float ABI (lp64f)"],
    [{ flags: 0x7 }, "quad-float ABI (lp64q)"],
    [{ elfClass: 32, flags: 0x3 }, "single-float ABI (ilp32f)"],
    [{ elfClass: 32, flags: 0x7 }, "the quad-float ABI declared by e_flags"],
    [{ elfClass: 32, flags: 0x1 }, "which was not inspected"],
    [{ elfClass: 32, flags: 0x1, isa: { status: "absent" } }, "declares none"],
    [
      {
        elfClass: 32,
        flags: 0x1,
        isa: {
          status: "unavailable",
          reason: "truncated RISC-V attribute section",
        },
      },
      "readable Tag_RISCV_arch declaration: truncated RISC-V attribute section",
    ],
    [{ flags: 0x8000_0005 }, "(0x80000000)"],
    [{ flags: 0x24 }, "bits outside the verified lane"],
  ] satisfies [Partial<RiscvElfMetadata>, string][])(
    "refuses an unverified RISC-V interpretation %j",
    async (change, reason) => {
      const provider = ghidra();
      const value = target(change);
      // The provider delivers the lane's own refusal, which names the
      // offending declaration or value.
      expect(provider.inspectTargetSupport(value)).toMatchObject({
        status: "unsupported",
        code: "architecture_unsupported",
        reason: ghidraRiscvUnsupportedReason(value),
      });
      expect(ghidraRiscvUnsupportedReason(value)).toContain(reason);
      expect(await provider.resolveAnalysisProfile(value)).toEqual(
        expect.objectContaining({ ok: false }),
      );
      expect(ghidraPinnedLanguage(value)).toBeUndefined();
    },
  );

  it("refuses a caller-selected processor outside the verified generic lane", async () => {
    const resolved = await ghidra({
      REA_GHIDRA_LANGUAGE_ID: "RISCV:LE:32:AndeStar_v5",
    }).resolveAnalysisProfile(target({ elfClass: 32 }));
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("expected a refusal");
    expect(resolved.error.message).toContain("generic little-endian RISC-V");
    expect(resolved.error).toMatchObject({
      _tag: "ConfigurationError",
      settings: [{ setting: "REA_GHIDRA_LANGUAGE_ID" }],
    });
  });

  it("attributes a compiler-only pin conflict to its setting", async () => {
    const resolved = await ghidra({
      REA_GHIDRA_LANGUAGE_ID: "RISCV:LE:64:default",
      REA_GHIDRA_COMPILER_SPEC_ID: "windows",
    }).resolveAnalysisProfile(target());
    if (resolved.ok) throw new Error("expected a configuration conflict");
    expect(resolved.error).toMatchObject({
      _tag: "ConfigurationError",
      settings: [{ setting: "REA_GHIDRA_COMPILER_SPEC_ID" }],
    });
  });

  it("keeps a caller-selected language that matches the pin as configured", async () => {
    const resolved = await ghidra({
      REA_GHIDRA_LANGUAGE_ID: "RISCV:LE:64:default",
      REA_GHIDRA_COMPILER_SPEC_ID: "gcc",
    }).resolveAnalysisProfile(target());
    if (!resolved.ok || resolved.value.profile === null)
      throw new Error("expected a configured profile");
    expect(resolved.value.profile.parameters.language_selection).toBe(
      "configured-v1",
    );
    expect(resolved.value.profile.parameters.language_id).toBe(
      "RISCV:LE:64:default",
    );
  });

  it("states the linkage claim boundary in the lane limitations", () => {
    const notes = ghidraRiscvLimitations(target());
    // Facts, independent of the owner's wording and order: the pinned
    // language and the static-linkage boundary.
    expect(notes).toContainEqual(
      expect.stringContaining("RISCV:LE:64:default"),
    );
    expect(notes).toContainEqual(
      expect.stringContaining("does not establish static linkage"),
    );
    expect(
      ghidraRiscvLimitations({
        path: "/other.elf",
        sha256: "b".repeat(64),
        kind: "executable",
        format: "elf",
        architecture: "x86_64",
        availableArchitectures: ["x86_64"],
      }),
    ).toEqual([]);
  });

  it("keeps RISC-V out of unverified Hopper and IDA adapter lanes", () => {
    const hopper = new HopperProvider(
      configOf("/hopper"),
      silentLogger,
      {},
      "linux",
    );
    expect(hopper.inspectTargetSupport(target()).status).toBe("unsupported");
    expect(hopperLoaderArgsForTarget(target()).ok).toBe(false);
    expect(hopperLoaderArgsForTarget(target())).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          message: expect.stringContaining("riscv"),
        }),
      }),
    );
    const ida = new IdaProvider(configOf("/ida"), {});
    expect(ida.inspectTargetSupport(target()).status).toBe("unsupported");
  });
};

describe("RISC-V lane and calling-convention tables", () => {
  it("builds each lane id from its fields and keeps the double-float ids", () => {
    expect(GHIDRA_RISCV_LANES.map(ghidraRiscvSupportLane)).toEqual([
      "elf64-exec-le-double-float-generic-v1",
      "elf32-exec-le-double-float-generic-v1",
      "elf32-exec-le-soft-float-generic-v1",
    ]);
  });

  it("gives every non-double lane one policy and every policy one lane", () => {
    const corrected = GHIDRA_RISCV_LANES.filter(
      (lane) => lane.floatAbi !== "double",
    );
    expect(corrected.map((lane) => lane.callingConvention)).toEqual(
      GHIDRA_RISCV_CALLING_CONVENTION_IDS,
    );
    expect(
      GHIDRA_RISCV_LANES.filter((lane) => lane.floatAbi === "double").every(
        (lane) => lane.callingConvention === undefined,
      ),
    ).toBe(true);
    expect(GHIDRA_RISCV_CALLING_CONVENTIONS).toEqual({
      "ilp32-prototype-v1": { abi: "ilp32", prototype: "__rea_ilp32" },
    });
  });

  it("keeps the decision record in docs/ghidra-riscv.md in step with the tables", async () => {
    const docs = await readFile(
      new URL("../../docs/ghidra-riscv.md", import.meta.url),
      "utf8",
    );
    for (const lane of GHIDRA_RISCV_LANES)
      expect(docs).toContain(`\`${ghidraRiscvSupportLane(lane)}\``);
    for (const id of GHIDRA_RISCV_CALLING_CONVENTION_IDS) {
      const { abi, prototype } = GHIDRA_RISCV_CALLING_CONVENTIONS[id];
      expect(docs).toContain(`Policy \`${id}\`, prototype \`${prototype}\``);
      expect(docs).toContain(`### ${abi}\n`);
    }
    const decoded =
      /implements with\s+p-code: (.+?)\.\s+Any\s+other\s+extension/su.exec(
        docs,
      )?.[1];
    expect(
      new Set(
        [...(decoded ?? "").matchAll(/`([a-z0-9]+)`/gu)].map((m) => m[1]),
      ),
    ).toEqual(GHIDRA_RISCV32_DECODED_EXTENSIONS);
  });
});

describe("bounded Ghidra RISC-V admission", () => {
  registerRiscvLanguageCommitmentCases();
  registerRiscvAdmissionAndCapabilityCases();
});

describe("RISC-V ilp32 admission", () => {
  it.each([
    ["ESP32-C2/C3 base", C3_ARCH],
    [
      "ESP32-C5/C6/C61/H2/H21 base",
      "rv32i2p1_m2p0_a2p1_c2p0_zicsr2p0_zifencei2p0_zaamo1p0_zalrsc1p0_zmmul1p0_zca1p0",
    ],
    [
      "soft-float ABI on F and D hardware",
      "rv32i2p1_m2p0_a2p1_f2p2_d2p2_c2p0_zicsr2p0_zmmul1p0_zca1p0_zcf1p0_zcd1p0",
    ],
    ["the bare base", "rv32i2p1"],
  ])("admits the %s", async (_label, arch) => {
    const value = ilp32(arch);
    expect(ghidra().inspectTargetSupport(value).status).toBe("supported");
    expect(ghidraPinnedLanguage(value)).toEqual({
      languageId: "RISCV:LE:32:default",
      compilerSpecId: "gcc",
    });
    expect(ghidraRiscvCallingConvention(value)).toBe("ilp32-prototype-v1");
  });

  it.each([
    [
      "ESP-IDF's optional bit-manipulation and Zc extensions",
      `${C3_ARCH}_zba1p0_zbb1p0_zbs1p0_zcb1p0_zcmp1p0_zcmt1p0`,
      "outside the set this lane decodes: zba, zbb, zbs, zcb, zcmp, zcmt.",
    ],
    [
      "Espressif's vendor extensions",
      "rv32i2p1_m2p0_c2p0_xesploop1p0_xespv2p1_xespdsp1p0",
      "outside the set this lane decodes: xesploop, xespv, xespdsp.",
    ],
    ["an RV32E base", "rv32e2p0_m2p0_c2p0", "requires the RV32I base"],
    ["an RV64 string", "rv64i2p1_m2p0_c2p0", "requires the RV32I base"],
    [
      "a non-canonical string",
      "rv32imac",
      "readable Tag_RISCV_arch declaration: Tag_RISCV_arch does not begin",
    ],
  ])("refuses %s", async (_label, arch, reason) => {
    const value = ilp32(arch);
    expect(ghidra().inspectTargetSupport(value)).toMatchObject({
      status: "unsupported",
      code: "architecture_unsupported",
      reason: expect.stringContaining(reason),
    });
    expect((await ghidra().resolveAnalysisProfile(value)).ok).toBe(false);
    expect(ghidraPinnedLanguage(value)).toBeUndefined();
    expect(ghidraRiscvCallingConvention(value)).toBeUndefined();
  });

  it("commits the soft-float lane, its declarations and its policy", async () => {
    const resolved = await ghidra().resolveAnalysisProfile(ilp32());
    if (!resolved.ok || resolved.value.profile === null)
      throw new Error("expected an ilp32 profile");
    const parameters = resolved.value.profile.parameters;
    expect(parameters.riscv_elf).toEqual({
      elf_class: 32,
      byte_order: "little",
      type: 2,
      flags: 1,
      float_abi_double: false,
      float_abi: "soft",
      arch: C3_ARCH,
      rvc_declared: true,
      rve_declared: false,
      tso_declared: false,
    });
    expect(parameters.riscv_calling_convention).toBe("ilp32-prototype-v1");
    expect(parameters.riscv_support_lane).toBe(
      "elf32-exec-le-soft-float-generic-v1",
    );
    expect(parameters.language_id).toBe("RISCV:LE:32:default");
    expect(parameters.language_selection).toBe("provider-pinned-v1");
    const other = await ghidra().resolveAnalysisProfile(
      ilp32(`${C3_ARCH.replace("_zmmul1p0", "")}_zaamo1p0`),
    );
    if (!other.ok || other.value.profile === null)
      throw new Error("expected an ilp32 profile");
    expect(other.value.profile.digest).not.toBe(resolved.value.profile.digest);
  });

  it("keeps double-float profiles exactly as before, whatever the ISA declaration", async () => {
    const plain = await ghidra().resolveAnalysisProfile(
      target({ elfClass: 32, flags: 0x5 }),
    );
    const declared = await ghidra().resolveAnalysisProfile(
      target({
        elfClass: 32,
        flags: 0x5,
        isa: riscvIsaDeclaration("rv32i2p1_m2p0_a2p1_f2p2_d2p2_c2p0_zcmp1p0"),
      }),
    );
    if (
      !plain.ok ||
      !declared.ok ||
      plain.value.profile === null ||
      declared.value.profile === null
    )
      throw new Error("expected double-float profiles");
    expect(plain.value.profile.parameters.riscv_elf).toEqual({
      elf_class: 32,
      byte_order: "little",
      type: 2,
      flags: 5,
      float_abi_double: true,
      rvc_declared: true,
      rve_declared: false,
      tso_declared: false,
    });
    expect(plain.value.profile.parameters).not.toHaveProperty(
      "riscv_calling_convention",
    );
    expect(declared.value.profile.digest).toBe(plain.value.profile.digest);
  });

  it("states the declared ABI, the applied prototype and the declared ISA", () => {
    const notes = ghidraRiscvLimitations(ilp32());
    // One note names the declared ABI, the ABI the pinned language models
    // and the prototype REA applies, in any wording and order.
    expect(notes).toContainEqual(
      expect.stringMatching(
        /^(?=.*\(ilp32\))(?=.*\bilp32d\b)(?=.*`__rea_ilp32`)/su,
      ),
    );
    expect(notes).toContainEqual(expect.stringContaining(C3_ARCH));
  });
});

const report: GhidraRiscvCallingConventionReport = {
  policy: "ilp32-prototype-v1",
  functions: 11,
  definitions: 11,
};
const sessionInfo = (reported?: GhidraRiscvCallingConventionReport) => ({
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
    language_id: "RISCV:LE:32:default",
    compiler_spec_id: "gcc",
    image_base: "0x0",
    default_address_space: "ram",
    sha256: "a".repeat(64),
  },
  ...(reported === undefined ? {} : { riscv_calling_convention: reported }),
});
const session = async (
  value: BinaryTarget,
  reported: GhidraRiscvCallingConventionReport | undefined,
  profileFor: BinaryTarget = value,
) => {
  const counts = { starts: 0, calls: 0, closes: 0 };
  const launches: unknown[] = [];
  const provider = new GhidraProvider(
    configOf(installDir),
    silentLogger,
    {},
    host,
    (options) => {
      launches.push(options.launcher);
      return {
        start: () => {
          counts.starts++;
          return Promise.resolve(ok(sessionInfo(reported)));
        },
        callTool: () => {
          counts.calls++;
          return Promise.resolve(ok(null));
        },
        close: () => {
          counts.closes++;
          return Promise.resolve(ok(null));
        },
      };
    },
  );
  const resolved = await provider.resolveAnalysisProfile(profileFor);
  if (!resolved.ok || resolved.value.profile === null)
    throw new Error("expected a RISC-V profile");
  return {
    counts,
    launches,
    client: provider.createClient(value, resolved.value.profile),
  };
};

describe("RISC-V calling-convention handshake", () => {
  it.each([
    ["ilp32-prototype-v1", report, undefined],
    [undefined, undefined, undefined],
    [
      "ilp32-prototype-v1",
      undefined,
      "did not report the committed RISC-V calling-convention policy ilp32-prototype-v1",
    ],
    [undefined, report, "profile did not commit"],
  ] as const)(
    "expected %s with report %j fails with %s",
    (expected, reported, failure) => {
      const reason = ghidraRiscvCallingConventionFailure(expected, reported);
      if (failure === undefined) expect(reason).toBeUndefined();
      else expect(reason).toContain(failure);
    },
  );

  it("launches the policy and reports its outcome as session limitations", async () => {
    const { client, launches } = await session(ilp32(), report);
    const health = await client.execute("health", {});
    if (!health.ok) throw health.error;
    expect(launches).toEqual([
      expect.objectContaining({
        options: expect.objectContaining({
          riscvCallingConvention: "ilp32-prototype-v1",
        }),
      }),
    ]);
    expect(health.value.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "installs a program-specific `__rea_ilp32` prototype",
        ),
        expect.stringContaining(
          "11 functions and 11 function definitions use __rea_ilp32.",
        ),
        expect.stringContaining("variadic call's arguments"),
      ]),
    );
  });

  it("launches double-float sessions without a policy", async () => {
    const { client, launches } = await session(target(), undefined);
    expect((await client.execute("health", {})).ok).toBe(true);
    expect(launches).toEqual([
      expect.objectContaining({
        options: expect.not.objectContaining({
          riscvCallingConvention: expect.anything(),
        }),
      }),
    ]);
  });

  it.each([
    {
      reason: "an ilp32 session without a report before any analysis call",
      value: ilp32(),
      reported: undefined,
      operation: "list_procedures",
    },
    {
      reason: "a report from a double-float session",
      value: target(),
      reported: report,
      operation: "health",
    },
  ] as const)("rejects $reason", async ({ value, reported, operation }) => {
    const { counts, client } = await session(value, reported);
    const failed = await client.execute(operation, {});
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error._tag).toBe("ProviderAdapterError");
    expect(counts).toEqual({ starts: 1, calls: 0, closes: 1 });
  });

  it("refuses a profile whose policy disagrees with the target", async () => {
    for (const [value, profileFor] of [
      [ilp32(), target({ elfClass: 32 })],
      [target({ elfClass: 32 }), ilp32()],
    ] as const) {
      const { counts, client } = await session(value, report, profileFor);
      expect((await client.execute("health", {})).ok).toBe(false);
      expect(counts.starts).toBe(0);
    }
  });

  it("keeps a caller project's stored report as history", async () => {
    const resolved = await ghidra().resolveAnalysisProfile(ilp32());
    if (!resolved.ok || resolved.value.profile === null)
      throw new Error("expected an ilp32 profile");
    const info: GhidraSessionInfo = sessionInfo(report);
    expect(
      ghidraProjectHistoryEvidence(ilp32(), resolved.value.profile, info)
        ?.normalized_result,
    ).toEqual({ origin: "caller-project", riscv_calling_convention: report });
  });
});

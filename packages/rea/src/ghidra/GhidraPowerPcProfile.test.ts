import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse, relative } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { parseConfig } from "../config/parseConfig.js";
import type {
  BinaryTarget,
  ElfFamilyMetadata,
} from "../domain/binaryTargetTypes.js";
import { silentLogger } from "../logger.js";
import { HopperProvider } from "../hopper/HopperProvider.js";
import { hopperLoaderArgsForTarget } from "../hopper/HopperAnalysisProfile.js";
import { IdaProvider } from "../ida/IdaProvider.js";
import {
  ghidraPinnedLanguage,
  ghidraProfileLanguageOverride,
} from "./GhidraAnalysisProfile.js";
import { GhidraProvider } from "./GhidraProvider.js";
import { ghidraProfileInstallationHost as host } from "./GhidraInstallation.fixture.js";

// Abbreviated from Ghidra 12.1.4 Processors/PowerPC/data/languages/ppc.ldefs.
const PPC_LDEFS = `<?xml version="1.0" encoding="UTF-8"?>
<language_definitions>
  <language processor="PowerPC" endian="big" size="32" variant="default"
            id="PowerPC:BE:32:default">
    <compiler name="default" spec="ppc_32.cspec" id="default"/>
  </language>
  <language processor="PowerPC" endian="big" size="32" variant="e500"
            id="PowerPC:BE:32:e500">
    <compiler name="default" spec="ppc_32_e500_be.cspec" id="default"/>
  </language>
</language_definitions>
`;

const configFor = (environment: NodeJS.ProcessEnv) => {
  const parsed = parseConfig({ GHIDRA_INSTALL_DIR: "/ghidra", ...environment });
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const config = configFor({});
const target = (change: Partial<ElfFamilyMetadata> = {}): BinaryTarget => ({
  path: "/fixture.elf",
  sha256: "a".repeat(64),
  kind: "executable",
  format: "elf",
  architecture: "powerpc",
  availableArchitectures: ["powerpc"],
  powerpc: { elfClass: 32, byteOrder: "big", type: 2, flags: 0, ...change },
});

describe("bounded Ghidra PowerPC admission", () => {
  it("binds the generic language instead of the loader's e500 choice", async () => {
    const ghidra = new GhidraProvider(config, silentLogger, {}, host);
    expect(await ghidra.inspectAvailability()).toMatchObject({
      status: "available",
    });
    expect(ghidra.inspectTargetSupport(target()).status).toBe("supported");
    const resolved = await ghidra.resolveAnalysisProfile(target());
    if (!resolved.ok) throw resolved.error;
    const parameters = resolved.value.profile?.parameters ?? {};
    expect(parameters).toMatchObject({
      architecture: "powerpc",
      language_id: "PowerPC:BE:32:default",
      compiler_spec_id: "default",
      language_selection: "provider-pinned-v1",
      powerpc_elf: { elf_class: 32, byte_order: "big", type: 2, flags: 0 },
      powerpc_support_lane: "elf32-be-exec-generic-v1",
    });
    expect(ghidraPinnedLanguage(target())).toEqual({
      languageId: "PowerPC:BE:32:default",
      compilerSpecId: "default",
    });
    expect(ghidraProfileLanguageOverride(parameters)).toEqual(
      ghidraPinnedLanguage(target()),
    );
  });

  it("lets a configured language replace the lane default", async () => {
    const root =
      process.platform === "win32" ? join(process.cwd(), "build") : tmpdir();
    await mkdir(root, { recursive: true });
    const ownedInstallDir = await mkdtemp(join(root, "rea-ghidra-ppc-"));
    onTestFinished(async () => {
      await rm(ownedInstallDir, { recursive: true, force: true });
    });
    // The simulated Linux host needs a POSIX absolute path. Keep the owned
    // native path for cleanup and derive the simulated path on the same drive.
    const installDir =
      process.platform === "win32"
        ? `/${relative(parse(ownedInstallDir).root, ownedInstallDir).replaceAll("\\", "/")}`
        : ownedInstallDir;
    const languages = join(
      installDir,
      "Ghidra/Processors/PowerPC/data/languages",
    );
    await mkdir(languages, { recursive: true });
    await writeFile(join(languages, "ppc.ldefs"), PPC_LDEFS);
    const ghidra = new GhidraProvider(
      configFor({
        GHIDRA_INSTALL_DIR: installDir,
        REA_GHIDRA_LANGUAGE_ID: "PowerPC:BE:32:e500",
      }),
      silentLogger,
      {},
      host,
    );
    const resolved = await ghidra.resolveAnalysisProfile(target());
    if (!resolved.ok) throw resolved.error;
    const parameters = resolved.value.profile?.parameters ?? {};
    expect(parameters).toMatchObject({
      language_id: "PowerPC:BE:32:e500",
      language_selection: "configured-v1",
    });
    expect(ghidraProfileLanguageOverride(parameters)).toEqual({
      languageId: "PowerPC:BE:32:e500",
    });
  });

  it("commits header flags so a changed interpretation changes the profile", async () => {
    const ghidra = new GhidraProvider(config, silentLogger, {}, host);
    const left = await ghidra.resolveAnalysisProfile(target());
    const right = await ghidra.resolveAnalysisProfile(
      target({ flags: 0x00010000 }),
    );
    if (!left.ok) throw left.error;
    if (!right.ok) throw right.error;
    expect(left.value.profile?.digest).toEqual(expect.any(String));
    expect(right.value.profile?.digest).toEqual(expect.any(String));
    expect(left.value.profile?.digest).not.toBe(right.value.profile?.digest);
  });

  it("does not widen Windows P0", () => {
    const windows = new GhidraProvider(
      config,
      silentLogger,
      {},
      { ...host, platform: "win32" },
    );
    expect(windows.inspectTargetSupport(target()).status).toBe("unsupported");
  });

  it.each([
    [{ elfClass: 64 }, "ELF32"],
    [{ byteOrder: "little" }, "big-endian"],
    [{ type: 1 }, "ET_EXEC"],
    [{ type: 3 }, "ET_EXEC"],
    [{ flags: 0x80000000 }, "EF_PPC_EMB"],
  ] satisfies [Partial<ElfFamilyMetadata>, string][])(
    "refuses an unverified PowerPC interpretation %j",
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

  it("keeps PowerPC out of unverified Hopper and IDA adapter lanes", () => {
    const hopper = new HopperProvider(config, silentLogger, {}, "linux");
    expect(hopper.inspectTargetSupport(target()).status).toBe("unsupported");
    expect(hopperLoaderArgsForTarget(target()).ok).toBe(false);
    const ida = new IdaProvider(config, {});
    expect(ida.inspectTargetSupport(target()).status).toBe("unsupported");
  });
});

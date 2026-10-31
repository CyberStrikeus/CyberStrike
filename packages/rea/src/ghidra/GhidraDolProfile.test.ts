import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBinaryTarget } from "../application/BinaryTargetResolver.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { parseConfig } from "../config/parseConfig.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { buildGamecubeDol } from "../domain/gamecubeDol.fixture.js";
import { parseDolHeader } from "../domain/gamecubeDol.js";
import { silentLogger } from "../logger.js";
import {
  ghidraPinnedLanguage,
  ghidraProfileLanguageOverride,
} from "./GhidraAnalysisProfile.js";
import {
  GHIDRA_GAMECUBE_DOL_LANGUAGE,
  ghidraDolLanguageUnsupportedReason,
  ghidraDolSectionFile,
} from "./GhidraDolProfile.js";
import { GhidraProvider } from "./GhidraProvider.js";
import { ghidraProfileInstallationHost as host } from "./GhidraInstallation.fixture.js";

// Abbreviated from Ghidra 12.1.4 ppc.ldefs and x86.ldefs: the stock PowerPC
// default, the optional Broadway variant, and one little-endian language to refuse.
const LANGUAGE_DEFINITIONS = `<?xml version="1.0" encoding="UTF-8"?>
<language_definitions>
  <language processor="PowerPC" endian="big" size="32" variant="default"
            id="PowerPC:BE:32:default">
    <compiler name="default" spec="ppc_32.cspec" id="default"/>
  </language>
  <language processor="PowerPC" endian="big" size="32" variant="Gekko_Broadway"
            id="PowerPC:BE:32:Gekko_Broadway">
    <compiler name="default" spec="ppc_32.cspec" id="default"/>
  </language>
  <language processor="x86" endian="little" size="32" variant="default"
            id="x86:LE:32:default">
    <compiler name="default" spec="x86.cspec" id="default"/>
  </language>
</language_definitions>
`;

const configFor = (environment: NodeJS.ProcessEnv) => {
  const parsed = parseConfig({ GHIDRA_INSTALL_DIR: "/ghidra", ...environment });
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

const installedConfig = async (environment: NodeJS.ProcessEnv) => {
  const installDir = await createTestTempDirectory("rea-ghidra-dol-");
  const languages = join(
    installDir,
    "Ghidra/Processors/PowerPC/data/languages",
  );
  await mkdir(languages, { recursive: true });
  await writeFile(join(languages, "ppc.ldefs"), LANGUAGE_DEFINITIONS);
  return configFor({ GHIDRA_INSTALL_DIR: installDir, ...environment });
};

const dolTarget = async (
  options: Parameters<typeof buildGamecubeDol>[0] = {},
): Promise<BinaryTarget> => {
  const directory = await createTestTempDirectory("rea-dol-profile-");
  await writeFile(join(directory, "game.dol"), buildGamecubeDol(options));
  const parsed = await parseBinaryTarget("game.dol", {
    cwd: directory,
    formatHint: "gamecube-dol",
  });
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

const dataDol = (address: number) => ({
  data: { address, bytes: Buffer.alloc(16, 0x11) },
  bss: { address: 0x8000_5000, size: 0x100 },
});

describe("GameCube DOL Ghidra profile", () => {
  it("imports through BinaryLoader with the stock PowerPC language", async () => {
    const ghidra = new GhidraProvider(configFor({}), silentLogger, {}, host);
    const target = await dolTarget();
    expect(ghidra.inspectTargetSupport(target).status).toBe("supported");
    const resolved = await ghidra.resolveAnalysisProfile(target);
    if (!resolved.ok) throw resolved.error;
    const parameters = resolved.value.profile?.parameters ?? {};
    expect(parameters).toMatchObject({
      target_format: "gamecube-dol",
      architecture: "powerpc",
      loader: "BinaryLoader",
      language_id: "PowerPC:BE:32:default",
      compiler_spec_id: "default",
      language_selection: "provider-pinned-v1",
      entry_point: "0x80003100",
      dol_import: "binary-loader-sections-v2",
    });
    expect(ghidraPinnedLanguage(target)).toEqual(GHIDRA_GAMECUBE_DOL_LANGUAGE);
    expect(ghidraProfileLanguageOverride(parameters)).toEqual(
      GHIDRA_GAMECUBE_DOL_LANGUAGE,
    );
  });

  it("commits the section table so a moved data section changes the profile", async () => {
    const ghidra = new GhidraProvider(configFor({}), silentLogger, {}, host);
    const left = await ghidra.resolveAnalysisProfile(
      await dolTarget(dataDol(0x8000_4000)),
    );
    const right = await ghidra.resolveAnalysisProfile(
      await dolTarget(dataDol(0x8000_4100)),
    );
    if (!left.ok) throw left.error;
    if (!right.ok) throw right.error;
    expect(left.value.profile?.digest).toEqual(expect.any(String));
    expect(right.value.profile?.digest).toEqual(expect.any(String));
    expect(left.value.profile?.digest).not.toBe(right.value.profile?.digest);
  });

  it("lets REA_GHIDRA_LANGUAGE_ID select a Broadway variant with the language-default spec", async () => {
    const ghidra = new GhidraProvider(
      await installedConfig({
        REA_GHIDRA_LANGUAGE_ID: "PowerPC:BE:32:Gekko_Broadway",
      }),
      silentLogger,
      {},
      host,
    );
    const resolved = await ghidra.resolveAnalysisProfile(await dolTarget());
    if (!resolved.ok) throw resolved.error;
    const parameters = resolved.value.profile?.parameters ?? {};
    expect(parameters).toMatchObject({
      language_id: "PowerPC:BE:32:Gekko_Broadway",
      compiler_spec_id: "language-default",
      language_selection: "configured-v1",
    });
    expect(ghidraProfileLanguageOverride(parameters)).toEqual({
      languageId: "PowerPC:BE:32:Gekko_Broadway",
    });
  });

  it("commits an override compiler spec when REA_GHIDRA_COMPILER_SPEC_ID is set", async () => {
    const ghidra = new GhidraProvider(
      await installedConfig({
        REA_GHIDRA_LANGUAGE_ID: "PowerPC:BE:32:Gekko_Broadway",
        REA_GHIDRA_COMPILER_SPEC_ID: "default",
      }),
      silentLogger,
      {},
      host,
    );
    const resolved = await ghidra.resolveAnalysisProfile(await dolTarget());
    if (!resolved.ok) throw resolved.error;
    expect(resolved.value.profile?.parameters).toMatchObject({
      language_id: "PowerPC:BE:32:Gekko_Broadway",
      compiler_spec_id: "default",
      language_selection: "configured-v1",
    });
  });

  it("refuses an installed override that is not big-endian 32-bit PowerPC", async () => {
    const ghidra = new GhidraProvider(
      await installedConfig({ REA_GHIDRA_LANGUAGE_ID: "x86:LE:32:default" }),
      silentLogger,
      {},
      host,
    );
    const resolved = await ghidra.resolveAnalysisProfile(await dolTarget());
    if (resolved.ok) throw new Error("expected an override conflict");
    expect(resolved.error.message).toContain(
      "requires a PowerPC:BE:32:* language",
    );
    // The setting conflicts with the admitted DOL; the target stays supported.
    expect(projectAnalysisError(resolved.error)).toMatchObject({
      code: "configuration_invalid",
      details: {
        settings: [
          expect.objectContaining({ setting: "REA_GHIDRA_LANGUAGE_ID" }),
        ],
      },
    });
  });

  it("names only the language when a compiler spec accompanies a conflicting language", async () => {
    const ghidra = new GhidraProvider(
      await installedConfig({
        REA_GHIDRA_LANGUAGE_ID: "x86:LE:32:default",
        REA_GHIDRA_COMPILER_SPEC_ID: "gcc",
      }),
      silentLogger,
      {},
      host,
    );
    const resolved = await ghidra.resolveAnalysisProfile(await dolTarget());
    if (resolved.ok) throw new Error("expected an override conflict");
    // DOL accepts a compiler-spec override, so only the language is blamed.
    expect(projectAnalysisError(resolved.error)).toMatchObject({
      code: "configuration_invalid",
      details: {
        settings: [
          expect.objectContaining({ setting: "REA_GHIDRA_LANGUAGE_ID" }),
        ],
      },
    });
  });

  it("does not admit DOL through Windows Ghidra P0", async () => {
    const windows = new GhidraProvider(
      configFor({}),
      silentLogger,
      {},
      { ...host, platform: "win32" },
    );
    const support = windows.inspectTargetSupport(await dolTarget());
    expect(support).toMatchObject({
      status: "unsupported",
      code: "target_format_unsupported",
    });
    expect(support.reason).toContain("not part of Windows Ghidra P0");
  });
});

describe("GameCube DOL language and section table", () => {
  it.each([
    [undefined, null],
    [{ languageId: "PowerPC:BE:32:Gekko_Broadway" }, null],
    [{ languageId: "PowerPC:BE:32:default", compilerSpecId: "default" }, null],
    [{ languageId: "PowerPC:LE:32:default" }, "big-endian 32-bit"],
    [{ languageId: "x86:LE:32:default" }, "big-endian 32-bit"],
  ] as const)(
    "accepts only big-endian 32-bit PowerPC overrides (%j)",
    (override, reason) => {
      const result = ghidraDolLanguageUnsupportedReason(
        override === undefined ? undefined : { ...override },
      );
      if (reason === null) expect(result).toBeNull();
      else expect(result).toContain(reason);
    },
  );

  it("writes the canonical section table the pre-script reads", () => {
    const parsed = parseDolHeader(
      buildGamecubeDol({
        data: { address: 0x8000_4000, bytes: Buffer.alloc(16) },
        bss: { address: 0x8000_5000, size: 0x100 },
      }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(ghidraDolSectionFile(parsed.value)).toBe(
      [
        "plan 2 2 1",
        "section text 0 0x100 0x80003100 0x20",
        "section data 0 0x120 0x80004000 0x10",
        "bss-gap 0x80005000 0x100",
        "entry 0x80003100",
        "",
      ].join("\n"),
    );
  });

  it("writes an explicit zero-gap count when BSS is absent", () => {
    const parsed = parseDolHeader(buildGamecubeDol());
    if (!parsed.ok) throw new Error(parsed.error);
    expect(ghidraDolSectionFile(parsed.value)).toContain("plan 2 1 0\n");
    expect(ghidraDolSectionFile(parsed.value)).not.toContain("bss-gap");
  });
});

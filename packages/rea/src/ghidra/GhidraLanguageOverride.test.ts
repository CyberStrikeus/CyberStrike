import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { parseConfig } from "../config/parseConfig.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { silentLogger } from "../logger.js";
import {
  ghidraProfileLanguageOverride,
  sameGhidraLanguageOverride,
} from "./GhidraAnalysisProfile.js";
import { ghidraProfileInstallationHost as host } from "./GhidraInstallation.fixture.js";
import {
  admitGhidraLanguageOverride,
  parseGhidraLanguageDefinitions,
  readGhidraLanguageCatalog,
} from "./GhidraLanguageCatalog.js";
import { GhidraProvider } from "./GhidraProvider.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";

// Abbreviated from Ghidra 12.1.4 Processors/x86/data/languages/x86.ldefs.
const X86_LDEFS = `<?xml version="1.0" encoding="UTF-8"?>
<language_definitions>
  <language processor="x86"
            endian="little"
            size="32"
            variant="default"
            id="x86:LE:32:default">
    <description>Intel/AMD 32-bit x86</description>
    <compiler name="Visual Studio" spec="x86win.cspec" id="windows"/>
    <compiler name="gcc" spec="x86gcc.cspec" id="gcc"/>
    <compiler name="Borland C++" spec="x86borland.cspec" id="borlandcpp"/>
  </language>
  <language processor="x86" endian="little" size="16" variant="Real Mode"
            id="x86:LE:16:Real Mode">
    <compiler name="default" spec="x86-16.cspec" id="default"/>
  </language>
</language_definitions>
`;

const MIPS_LDEFS = `<?xml version="1.0" encoding="UTF-8"?>
<language_definitions>
  <language processor="MIPS" endian="little" size="32" variant="default"
            id="MIPS:LE:32:default">
    <description>MIPS 32-bit little endian</description>
    <compiler name="default" spec="mips32.cspec" id="default"/>
  </language>
</language_definitions>
`;

const pe: BinaryTarget = {
  path: process.platform === "win32" ? "C:\\fixture.exe" : "/fixture.exe",
  sha256: "a".repeat(64),
  kind: "executable",
  format: "pe",
  architecture: "x86",
  availableArchitectures: ["x86"],
  executableRole: "application",
  managed: false,
};

const fixedImportTarget = (
  format: "raw-binary" | "dos-mz" | "dos-com",
): BinaryTarget => {
  const executable = {
    path: pe.path,
    sha256: pe.sha256,
    kind: "executable",
    architecture: "x86",
    availableArchitectures: ["x86"],
  } as const;
  return format === "raw-binary"
    ? {
        ...executable,
        format,
        entryPoint: "0x0",
        entryPointSource: "0x0",
      }
    : { ...executable, format };
};

const legacyMips: BinaryTarget = {
  path: "/fixture-mips.elf",
  sha256: "b".repeat(64),
  kind: "executable",
  format: "elf",
  architecture: "mips",
  availableArchitectures: ["mips"],
  mips: {
    elfClass: 32,
    byteOrder: "little",
    type: 2,
    flags: 0x50000001,
    abiFlags: null,
    gnuAttributes: null,
  },
};

let installDir = "";
let ownedInstallDir = "";
beforeAll(async () => {
  const root =
    process.platform === "win32" ? join(process.cwd(), "build") : tmpdir();
  await mkdir(root, { recursive: true });
  ownedInstallDir = await mkdtemp(join(root, "rea-ghidra-languages-"));
  // The simulated Linux host needs a POSIX absolute path. Keep the owned
  // native path for cleanup and derive the simulated path on the same drive.
  installDir =
    process.platform === "win32"
      ? `/${relative(parse(ownedInstallDir).root, ownedInstallDir).replaceAll("\\", "/")}`
      : ownedInstallDir;
  const languages = join(installDir, "Ghidra/Processors/x86/data/languages");
  await mkdir(languages, { recursive: true });
  await writeFile(join(languages, "x86.ldefs"), X86_LDEFS);
});
afterAll(async () => {
  if (ownedInstallDir !== "")
    await rm(ownedInstallDir, { recursive: true, force: true });
});

const provider = (environment: Record<string, string>) => {
  const parsed = parseConfig({
    GHIDRA_INSTALL_DIR: installDir,
    ...environment,
  });
  if (!parsed.ok) throw parsed.error;
  return new GhidraProvider(parsed.value, silentLogger, {}, host);
};

describe("Ghidra language override configuration", () => {
  it("accepts a language with an optional compiler spec", () => {
    const parsed = parseConfig({
      REA_GHIDRA_LANGUAGE_ID: "x86:LE:32:default",
      REA_GHIDRA_COMPILER_SPEC_ID: "borlandcpp",
    });
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value.ghidraLanguageOverride).toEqual({
      languageId: "x86:LE:32:default",
      compilerSpecId: "borlandcpp",
    });
    const languageOnly = parseConfig({
      REA_GHIDRA_LANGUAGE_ID: "x86:LE:16:Real Mode",
    });
    if (!languageOnly.ok) throw languageOnly.error;
    expect(languageOnly.value.ghidraLanguageOverride).toEqual({
      languageId: "x86:LE:16:Real Mode",
    });
  });

  it.each([
    "ARM:LEBE:32:v8LEInstruction",
    "ARM:LEBE:32:v7LEInstruction",
    "M16C/60:LE:16:default",
    "M16C/80:LE:16:default",
  ])("accepts the stock Ghidra language ID %s", (languageId) => {
    const parsed = parseConfig({ REA_GHIDRA_LANGUAGE_ID: languageId });
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value.ghidraLanguageOverride).toEqual({ languageId });
  });

  it.each(["ARM:BELE:32:v8", "/x86:LE:32:default", "x86:LE:32:default "])(
    "still refuses the malformed language ID %j",
    (languageId) => {
      const parsed = parseConfig({ REA_GHIDRA_LANGUAGE_ID: languageId });
      expect(parsed.ok).toBe(false);
    },
  );

  it("requires a language for a compiler spec, as analyzeHeadless does", () => {
    const parsed = parseConfig({ REA_GHIDRA_COMPILER_SPEC_ID: "borlandcpp" });
    if (parsed.ok) throw new Error("Expected a configuration error");
    expect(projectAnalysisError(parsed.error)).toMatchObject({
      code: "configuration_invalid",
      details: {
        settings: [
          {
            setting: "REA_GHIDRA_COMPILER_SPEC_ID",
            constraint: "requires REA_GHIDRA_LANGUAGE_ID",
          },
        ],
      },
    });
  });

  it.each([
    ["REA_GHIDRA_LANGUAGE_ID", "x86 LE 32"],
    ["REA_GHIDRA_LANGUAGE_ID", "x86:LE:32: default"],
    ["REA_GHIDRA_LANGUAGE_ID", "x86:XE:32:default"],
    ["REA_GHIDRA_COMPILER_SPEC_ID", "borland cpp"],
  ])("rejects malformed %s %j without echoing it", (setting, value) => {
    const parsed = parseConfig({
      REA_GHIDRA_LANGUAGE_ID: "x86:LE:32:default",
      [setting]: value,
    });
    if (parsed.ok) throw new Error("Expected a configuration error");
    const projected = projectAnalysisError(parsed.error);
    expect(projected).toMatchObject({
      code: "configuration_invalid",
      details: { settings: [{ setting, constraint: expect.any(String) }] },
    });
    expect(JSON.stringify(projected)).not.toContain(value);
  });
});

describe("Ghidra language catalog", () => {
  it("reads quoted and escaped XML attributes without admitting comments or CDATA", () => {
    const catalog = parseGhidraLanguageDefinitions(`<language_definitions>
      <!-- <language id="removed"><compiler id="removed"/></language> -->
      <language id='x86:LE:32:default'>
        <description><![CDATA[<compiler id="not-a-compiler"/>]]></description>
        <!-- <compiler id="removed"/> -->
        <compiler id='borland&#99;pp' name='Borland &amp; C++'/>
      </language>
    </language_definitions>`);
    expect(catalog).toEqual([
      { id: "x86:LE:32:default", compilerSpecIds: ["borlandcpp"] },
    ]);
    expect(
      admitGhidraLanguageOverride(
        { languageId: "x86:LE:32:default", compilerSpecId: "removed" },
        catalog,
        "12.1.4",
      )?.settings,
    ).toEqual([
      {
        setting: "REA_GHIDRA_COMPILER_SPEC_ID",
        constraint:
          "must be one of the selected language's compiler specs: borlandcpp",
      },
    ]);
  });

  it.each([
    '<language_definitions><language id="x86:LE:32:default"></language_definitions>',
    "<language_definitions><language id=x86:LE:32:default/></language_definitions>",
    '<other><language id="x86:LE:32:default"/></other>',
  ])("rejects malformed language-definition documents", (text) => {
    expect(() => parseGhidraLanguageDefinitions(text)).toThrow();
  });

  it("parses language IDs and their compiler specs", async () => {
    expect(parseGhidraLanguageDefinitions(X86_LDEFS)).toEqual([
      {
        id: "x86:LE:32:default",
        compilerSpecIds: ["windows", "gcc", "borlandcpp"],
      },
      { id: "x86:LE:16:Real Mode", compilerSpecIds: ["default"] },
    ]);
    expect(
      await readGhidraLanguageCatalog(installDir, new ArtifactResourceScope()),
    ).toHaveLength(2);
    expect(
      await readGhidraLanguageCatalog(
        join(installDir, "absent"),
        new ArtifactResourceScope(),
      ),
    ).toEqual([]);
  });

  it("reads a UTF-8 signed definition beside an unsigned sibling", async () => {
    const root = await createTestTempDirectory("rea-ghidra-bom-");
    const module = (name: string) =>
      join(root, "Ghidra/Processors", name, "data/languages");
    await mkdir(module("probe"), { recursive: true });
    await mkdir(module("x86"), { recursive: true });
    await writeFile(
      join(module("probe"), "probe.ldefs"),
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?>\n<language_definitions><language id="probe:LE:32:default"/></language_definitions>',
        ),
      ]),
    );
    await writeFile(join(module("x86"), "x86.ldefs"), X86_LDEFS);
    expect(
      await readGhidraLanguageCatalog(root, new ArtifactResourceScope()),
    ).toEqual([
      { id: "probe:LE:32:default", compilerSpecIds: [] },
      ...parseGhidraLanguageDefinitions(X86_LDEFS),
    ]);
  });

  it("admits only languages and compiler specs the installation defines", () => {
    const catalog = parseGhidraLanguageDefinitions(X86_LDEFS);
    expect(
      admitGhidraLanguageOverride(
        { languageId: "x86:LE:32:default", compilerSpecId: "borlandcpp" },
        catalog,
        "12.1.4",
      ),
    ).toBeNull();
    const language = admitGhidraLanguageOverride(
      { languageId: "x86:LE:31:default" },
      catalog,
      "12.1.4",
    );
    expect(language?.settings).toEqual([
      {
        setting: "REA_GHIDRA_LANGUAGE_ID",
        constraint: "is not a language defined by Ghidra 12.1.4",
      },
    ]);
    const spec = admitGhidraLanguageOverride(
      { languageId: "x86:LE:32:default", compilerSpecId: "golang" },
      catalog,
      "12.1.4",
    );
    expect(spec?.settings).toEqual([
      {
        setting: "REA_GHIDRA_COMPILER_SPEC_ID",
        constraint:
          "must be one of the selected language's compiler specs: windows, gcc, borlandcpp",
      },
    ]);
  });
});

describe("Ghidra language override profile", () => {
  it("returns a provider failure for a malformed installed language definition", async () => {
    const path = join(
      installDir,
      "Ghidra/Processors/x86/data/languages/broken.ldefs",
    );
    await writeFile(
      path,
      "<language_definitions><language></language_definitions>",
    );
    try {
      const resolved = await provider({
        REA_GHIDRA_LANGUAGE_ID: "x86:LE:32:default",
      }).resolveAnalysisProfile(pe);
      if (resolved.ok) throw new Error("Expected a language catalog failure");
      expect(resolved.error).toMatchObject({
        providerId: "ghidra",
        operation: "resolve_analysis_profile",
      });
    } finally {
      await rm(path);
    }
  });

  it("commits the configured language and compiler spec", async () => {
    const resolved = await provider({
      REA_GHIDRA_LANGUAGE_ID: "x86:LE:32:default",
      REA_GHIDRA_COMPILER_SPEC_ID: "borlandcpp",
    }).resolveAnalysisProfile(pe);
    if (!resolved.ok) throw resolved.error;
    const parameters = resolved.value.profile?.parameters ?? {};
    expect(parameters).toMatchObject({
      loader: "auto-from-header",
      language_id: "x86:LE:32:default",
      compiler_spec_id: "borlandcpp",
      language_selection: "configured-v1",
    });
    expect(ghidraProfileLanguageOverride(parameters)).toEqual({
      languageId: "x86:LE:32:default",
      compilerSpecId: "borlandcpp",
    });
  });

  it("accepts the caller-selected language on the legacy MIPS lane", async () => {
    const mipsLanguages = join(
      installDir,
      "Ghidra/Processors/MIPS/data/languages",
    );
    await mkdir(mipsLanguages, { recursive: true });
    const definition = join(mipsLanguages, "mips.ldefs");
    await writeFile(definition, MIPS_LDEFS);
    try {
      const resolved = await provider({
        REA_GHIDRA_LANGUAGE_ID: "MIPS:LE:32:default",
        REA_GHIDRA_COMPILER_SPEC_ID: "default",
      }).resolveAnalysisProfile(legacyMips);
      if (!resolved.ok) throw resolved.error;
      expect(resolved.value.profile?.parameters).toMatchObject({
        language_id: "MIPS:LE:32:default",
        compiler_spec_id: "default",
        language_selection: "configured-v1",
      });
    } finally {
      await rm(mipsLanguages, { recursive: true, force: true });
    }
  });

  it("records the language default when no compiler spec is configured", async () => {
    const resolved = await provider({
      REA_GHIDRA_LANGUAGE_ID: "x86:LE:32:default",
    }).resolveAnalysisProfile(pe);
    if (!resolved.ok) throw resolved.error;
    const parameters = resolved.value.profile?.parameters ?? {};
    expect(parameters.compiler_spec_id).toBe("language-default");
    expect(ghidraProfileLanguageOverride(parameters)).toEqual({
      languageId: "x86:LE:32:default",
    });
  });

  it("keeps header auto-detection and a distinct digest without an override", async () => {
    const automatic = await provider({}).resolveAnalysisProfile(pe);
    const configured = await provider({
      REA_GHIDRA_LANGUAGE_ID: "x86:LE:32:default",
      REA_GHIDRA_COMPILER_SPEC_ID: "borlandcpp",
    }).resolveAnalysisProfile(pe);
    if (!automatic.ok) throw automatic.error;
    if (!configured.ok) throw configured.error;
    const parameters = automatic.value.profile?.parameters ?? {};
    expect(parameters).toMatchObject({
      language_id: "auto-from-header",
      compiler_spec_id: "auto-default",
    });
    expect(parameters).not.toHaveProperty("language_selection");
    expect(ghidraProfileLanguageOverride(parameters)).toBeUndefined();
    expect(automatic.value.profile?.digest).toEqual(expect.any(String));
    expect(configured.value.profile?.digest).toEqual(expect.any(String));
    expect(automatic.value.profile?.digest).not.toBe(
      configured.value.profile?.digest,
    );
  });

  it("refuses an undefined compiler spec before launching Ghidra", async () => {
    const resolved = await provider({
      REA_GHIDRA_LANGUAGE_ID: "x86:LE:32:default",
      REA_GHIDRA_COMPILER_SPEC_ID: "golang",
    }).resolveAnalysisProfile(pe);
    if (resolved.ok) throw new Error("Expected a configuration error");
    expect(projectAnalysisError(resolved.error)).toMatchObject({
      code: "configuration_invalid",
      details: {
        settings: [{ setting: "REA_GHIDRA_COMPILER_SPEC_ID" }],
      },
    });
  });

  it.each(["raw-binary", "dos-mz", "dos-com"] as const)(
    "attributes a fixed %s import override conflict to the named settings",
    async (format) => {
      const target = fixedImportTarget(format);
      const resolved = await provider({
        REA_GHIDRA_LANGUAGE_ID: "x86:LE:32:default",
        REA_GHIDRA_COMPILER_SPEC_ID: "borlandcpp",
      }).resolveAnalysisProfile(target);
      if (resolved.ok) throw new Error("Expected an override policy conflict");
      expect(projectAnalysisError(resolved.error)).toMatchObject({
        code: "configuration_invalid",
        details: {
          settings: [
            { setting: "REA_GHIDRA_LANGUAGE_ID" },
            { setting: "REA_GHIDRA_COMPILER_SPEC_ID" },
          ],
        },
      });
      const automatic = await provider({}).resolveAnalysisProfile(target);
      expect(automatic.ok).toBe(true);
    },
  );

  it("compares committed and configured selections exactly", () => {
    expect(sameGhidraLanguageOverride(undefined, undefined)).toBe(true);
    expect(
      sameGhidraLanguageOverride(
        { languageId: "x86:LE:32:default" },
        { languageId: "x86:LE:32:default", compilerSpecId: "borlandcpp" },
      ),
    ).toBe(false);
  });
});

it
  .skipIf(process.platform === "win32" || process.getuid?.() === 0)
  .each(["Ghidra/Processors", "Ghidra/Processors/x86/data/languages"])(
  "preserves a physical refusal reading the language catalog directory %s",
  async (relativePath) => {
    const root = await createTestTempDirectory(
      "rea-ghidra-catalog-permission-",
    );
    const languages = join(root, "Ghidra/Processors/x86/data/languages");
    await mkdir(languages, { recursive: true });
    await writeFile(join(languages, "x86.ldefs"), X86_LDEFS);
    const resources = new ArtifactResourceScope();
    const blocked = join(root, relativePath);
    try {
      const original = await readGhidraLanguageCatalog(root, resources);
      expect(original.length).toBeGreaterThan(0);
      await chmod(blocked, 0);
      await expect(readdir(blocked)).rejects.toMatchObject({ code: "EACCES" });
      await expect(
        readGhidraLanguageCatalog(root, resources),
      ).rejects.toMatchObject({ code: "EACCES", path: blocked });
      await chmod(blocked, 0o755);
      expect(await readGhidraLanguageCatalog(root, resources)).toEqual(
        original,
      );
    } finally {
      await chmod(blocked, 0o755);
      await resources.close();
    }
  },
);

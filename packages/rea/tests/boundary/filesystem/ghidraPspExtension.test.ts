import { AnalysisProviderRegistry } from "../../../src/application/binary/AnalysisProviderRegistry.js";
import { composeBinarySession } from "../../../src/application/binary/BinarySessionComposition.js";
import { createHash } from "node:crypto";
import type { Dir } from "node:fs";
import { GhidraClient } from "../../../src/ghidra/GhidraClient.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { ok as javaProbeOk } from "../../../src/domain/result.js";
import type { GhidraJavaObservation } from "../../../src/ghidra/GhidraJavaProbe.js";
import {
  mkdir,
  readFile,
  rename,
  symlink,
  truncate,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import { silentLogger } from "../../../src/logger.js";
import type {
  BinaryTarget,
  MipsAbiFlags,
} from "../../../src/domain/binaryTargetTypes.js";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { GhidraProvider } from "../../../src/ghidra/GhidraProvider.js";
import { ghidraProcessorUnsupportedReason } from "../../../src/ghidra/GhidraPspProfile.js";
import { inspectGhidraPspExtension } from "../../../src/ghidra/GhidraPspExtension.js";
import {
  GhidraHeadlessLauncher,
  ghidraHeadlessArguments,
} from "../../../src/ghidra/GhidraLauncher.js";
import type { GhidraInstallationHost } from "../../../src/ghidra/GhidraInstallation.js";

const controls = vi.hoisted(() => ({
  file: undefined as ((handle: FileHandle, path: string) => void) | undefined,
  directory: undefined as ((handle: Dir) => void) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      controls.file?.(handle, String(args[0]));
      return handle;
    },
    opendir: async (...args: Parameters<typeof actual.opendir>) => {
      const handle = await actual.opendir(...args);
      controls.directory?.(handle);
      return handle;
    },
  };
});
afterEach(() => {
  controls.file = undefined;
  controls.directory = undefined;
  vi.restoreAllMocks();
});

// Synthetic installation files exercise the filesystem/profile boundary, not
// Allegrex execution. Only the optional real CLI/MCP lane proves tool behavior.
// Independently inspected with PSPDEV v20261001 / GNU readelf 2.44.
const pspAbiFlags: MipsAbiFlags = {
  version: 0,
  isaLevel: 2,
  isaRevision: 0,
  gprSize: 1,
  cpr1Size: 1,
  cpr2Size: 0,
  fpAbi: 2,
  isaExtension: 0,
  ases: 0,
  flags1: 1,
  flags2: 0,
};
const target = {
  kind: "executable",
  format: "elf",
  architecture: "mips",
  availableArchitectures: ["mips"],
  path: "/caller/psp.elf",
  sha256: "a".repeat(64),
  mips: {
    elfClass: 32,
    byteOrder: "little",
    type: 2,
    flags: 0x10a23001,
    gnuAttributes: null,
    abiFlags: pspAbiFlags,
  },
} satisfies BinaryTarget;
const host: GhidraInstallationHost = {
  platform: "linux",
  architecture: "x64",
  readText: () => "application.version=12.1.3\napplication.java.min=21\n",
  executable: () => true,
  probeJava: () =>
    javaProbeOk<GhidraJavaObservation>({
      osArch: "amd64",
      osName: "Linux",
      version: "21.0.12",
      major: 21,
      home: "/jdk-21",
      bits: 64,
      runtime: "jdk",
    }),
};
async function installation() {
  const directory = await createTestTempDirectory("rea-psp-profile-");
  const root = join(directory, "Ghidra", "Extensions", "ghidra-allegrex");
  const contents = {
    "Module.manifest": "",
    "extension.properties": "name=ghidra-allegrex\nversion=12.1.3\n",
    "data/languages/allegrex.ldefs": "synthetic language definition",
    "data/languages/allegrex.sla": "synthetic compiled processor",
    "data/languages/allegrex.pspec": "synthetic processor specification",
    "data/languages/allegrex.cspec": "synthetic compiler specification",
    "lib/extension.jar": "synthetic loader artifact",
  };
  for (const [path, text] of Object.entries(contents)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  await mkdir(join(directory, "support"));
  const parsed = parseConfig({ GHIDRA_INSTALL_DIR: directory });
  if (!parsed.ok) throw parsed.error;
  return {
    directory,
    root,
    config: parsed.value,
    provider: new GhidraProvider(parsed.value, silentLogger, {}, host),
  };
}

describe.skipIf(process.platform === "win32")(
  "PSP installed-extension and profile boundary",
  () => {
    it("binds source interpretation and installed content, not mtimes or discovery order", async () => {
      const { provider, root } = await installation();
      expect(provider.inspectTargetSupport(target).status).toBe("supported");
      const first = await provider.resolveAnalysisProfile(target);
      if (!first.ok) throw first.error;
      const again = await provider.resolveAnalysisProfile(target);
      if (!again.ok) throw again.error;
      expect(first.value.profile?.digest).toEqual(expect.any(String));
      expect(again.value.profile?.digest).toBe(first.value.profile?.digest);
      expect(first.value.profile?.parameters).toMatchObject({
        architecture: "mips",
        language_id: "Allegrex:LE:32:default",
        compiler_spec_id: "default",
        loader: "PspElfLoader",
        mips_support_lane: "psp-elf32-exec-eabi32-allegrex-v2",
        mips_elf: {
          elf_class: 32,
          byte_order: "little",
          type: 2,
          flags: 0x10a23001,
          abi_flags: {
            version: 0,
            isa_level: 2,
            isa_revision: 0,
            gpr_size: 1,
            cpr1_size: 1,
            cpr2_size: 0,
            fp_abi: 2,
            isa_extension: 0,
            ases: 0,
            flags1: 1,
            flags2: 0,
          },
        },
        psp_extension: {
          id: "ghidra-allegrex",
          root,
          ghidra_version: "12.1.3",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      });
      await writeFile(
        join(root, "data/languages/allegrex.sla"),
        "changed processor semantics",
      );
      const changed = await provider.resolveAnalysisProfile(target);
      if (!changed.ok) throw changed.error;
      expect(changed.value.profile?.digest).toEqual(expect.any(String));
      expect(changed.value.profile?.digest).not.toBe(
        first.value.profile?.digest,
      );
    });

    it("fails before starting a provider after resolved extension bytes change", async () => {
      const { directory, root } = await installation();
      const extension = await inspectGhidraPspExtension(
        root,
        "12.1.3",
        new ArtifactResourceScope(),
      );
      await writeFile(join(root, "lib/extension.jar"), "changed loader");
      const spawn = vi.fn();
      const launcher = new GhidraHeadlessLauncher({
        environment: {},
        analyzeHeadlessPath: join(directory, "support/analyzeHeadless"),
        configurationDirectoryName: "ghidra_12.1.3_PUBLIC",
        javaHome: "/jdk-21",
        bridgeScriptPath: "/packaged/ReaGhidraBridge.java",
        pspExtension: extension,
        spawnProcess: spawn,
      });
      const launched = await launcher.launch(
        {
          runtimeRoot: join(directory, "runtime"),
          transport: "unix-socket",
          endpointPath: join(directory, "socket"),
          token: "test-only-token",
          runId: "00000000-0000-4000-8000-000000000001",
          targetPath: target.path,
          targetSha256: target.sha256,
          providerVersion: "12.1.3",
          profileDigest: "b".repeat(64),
        },
        { resourceScope: new ArtifactResourceScope() },
      );
      expect(launched.ok).toBe(false);
      if (launched.ok)
        throw new Error("Changed extension reached provider startup");
      expect(launched.error.cause).toBeInstanceOf(Error);
      expect(String(launched.error.cause)).toContain(
        "changed since profile resolution",
      );
      expect(spawn).not.toHaveBeenCalled();
    });

    it("requires a fresh extension when a saved profile's installation has disappeared", async () => {
      const { provider, root } = await installation();
      const before = await provider.resolveAnalysisProfile(target);
      if (!before.ok) throw before.error;
      await rename(root, `${root}-removed`);
      const missing = await provider.resolveAnalysisProfile(target);
      expect(missing.ok).toBe(false);
      if (missing.ok) throw new Error("Missing installation was accepted");
      expect(missing.error.message).toContain("PSP_EXTENSION_UNAVAILABLE");
    });
  },
);

describe.skipIf(process.platform === "win32")(
  "PSP extension admission codes",
  () => {
    it.each([
      ["name=other\nversion=12.1.3\n", "metadata_mismatch", undefined],
      [
        "name=ghidra-allegrex\nversion=12.1.4\n",
        "metadata_mismatch",
        undefined,
      ],
      [
        "name=ghidra-allegrex\nversion=12.1.\\uZZZZ\n",
        "properties_invalid",
        "malformed_unicode_escape",
      ],
    ] as const)(
      "rejects mismatched or malformed extension metadata %s",
      async (properties, code, parserCode) => {
        const { root } = await installation();
        await writeFile(join(root, "extension.properties"), properties);
        await expect(
          inspectGhidraPspExtension(
            root,
            "12.1.3",
            new ArtifactResourceScope(),
          ),
        ).rejects.toMatchObject({
          diagnostics: {
            code,
            ...(parserCode === undefined
              ? { ghidra_version: "12.1.3" }
              : { parser_code: parserCode }),
          },
        });
      },
    );

    it("does not treat an uninstall marker or missing compiled language as installed", async () => {
      const { root } = await installation();
      await rename(
        join(root, "Module.manifest"),
        join(root, "Module.manifest.uninstalled"),
      );
      await expect(
        inspectGhidraPspExtension(root, "12.1.3", new ArtifactResourceScope()),
      ).rejects.toMatchObject({
        diagnostics: {
          code: "component_missing",
          component: "Module.manifest",
        },
      });
    });

    it("rejects symlinked code instead of hashing an untracked external producer", async () => {
      const { root, directory } = await installation();
      const path = join(root, "lib/extension.jar");
      await rename(path, join(directory, "external.jar"));
      await symlink(join(directory, "external.jar"), path);
      await expect(
        inspectGhidraPspExtension(root, "12.1.3", new ArtifactResourceScope()),
      ).rejects.toMatchObject({
        diagnostics: { code: "entry_kind", relative: "lib/extension.jar" },
      });
    });

    it("bounds sparse extension input before reading or allocating its declared extent", async () => {
      const { root } = await installation();
      await truncate(join(root, "lib/extension.jar"), 64 * 1024 * 1024 + 1);
      await expect(
        inspectGhidraPspExtension(root, "12.1.3", new ArtifactResourceScope()),
      ).rejects.toMatchObject({
        diagnostics: {
          code: "bytes_exceed_limit",
          max_bytes: 64 * 1024 * 1024,
        },
      });
    });
  },
);

describe.skipIf(process.platform === "win32")(
  "PSP extension inventory bounds",
  () => {
    it.each([1, 2])(
      "bounds the total inventory across %i directories",
      async (directories) => {
        const { root } = await installation();
        for (let directory = 0; directory < directories; directory++) {
          const path = join(root, `inventory-${directory}`);
          await mkdir(path);
          await Promise.all(
            Array.from({ length: 1024 / directories }, (_, index) =>
              writeFile(join(path, `entry-${index}`), ""),
            ),
          );
        }
        await expect(
          inspectGhidraPspExtension(
            root,
            "12.1.3",
            new ArtifactResourceScope(),
          ),
        ).rejects.toMatchObject({
          diagnostics: { code: "inventory_exceeds_limit", max_entries: 1024 },
        });
      },
    );
  },
);

describe.skipIf(process.platform === "win32")(
  "PSP admission failures and explicit loader",
  () => {
    it("preserves already-aborted cancellation rather than reporting missing prerequisites", async () => {
      const { provider } = await installation();
      const result = await provider.resolveAnalysisProfile(target, {
        signal: AbortSignal.abort(),
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Cancellation was ignored");
      expect(result.error._tag).toBe("AnalysisCancelledError");
    });

    it("does not broaden the separately verified host platforms", async () => {
      const { config } = await installation();
      for (const platform of ["darwin", "win32"] as const) {
        const provider = new GhidraProvider(
          config,
          silentLogger,
          {},
          { ...host, platform },
        );
        expect(provider.inspectTargetSupport(target).status).toBe(
          "unsupported",
        );
      }
    });

    it.each([
      [{ byteOrder: "big" }, "little-endian"],
      [{ elfClass: 64 }, "ELF32"],
      [{ type: 0xffa0 }, "ET_EXEC"],
      [{ flags: 0x12a23001 }, "0x10a23001"],
      [{ flags: 0x10a23021 }, "0x10a23001"],
    ])(
      "refuses unverified PSP declarations %j before extension reads",
      async (change, reason) => {
        const { provider } = await installation();
        const altered = {
          ...target,
          mips: { ...target.mips, ...change },
        } as BinaryTarget;
        expect(ghidraProcessorUnsupportedReason(altered)).toContain(reason);
        expect(provider.inspectTargetSupport(altered).status).toBe(
          "unsupported",
        );
        const result = await provider.resolveAnalysisProfile(altered);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("Invalid target was admitted");
        expect(result.error._tag).toBe("AnalysisUnsupportedTargetError");
      },
    );

    it("refuses a separately declared unsupported MSA argument ABI", async () => {
      const { provider } = await installation();
      const altered = {
        ...target,
        mips: { ...target.mips, gnuAttributes: { fpAbi: 2, msa: 1 } },
      } as BinaryTarget;
      expect(ghidraProcessorUnsupportedReason(altered)).toMatch(/MSA ABI/u);
      expect(provider.inspectTargetSupport(altered).status).toBe("unsupported");
    });
  },
);

/**
 * A PSPSDK-shaped ELF32 whose PT_MIPS_ABIFLAGS record matches the PSP profile.
 * Optionally declare a section-header table beyond the captured file.
 */
const pspElfBytes = ({ sectionHeadersBeyondEof = false } = {}): Buffer => {
  const abiOffset = 8192;
  const bytes = Buffer.alloc(abiOffset + 24);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1]);
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(8, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeUInt32LE(52, 28);
  bytes.writeUInt32LE(0x10a23001, 36);
  bytes.writeUInt16LE(52, 40);
  bytes.writeUInt16LE(32, 42);
  bytes.writeUInt16LE(1, 44);
  if (sectionHeadersBeyondEof) {
    bytes.writeUInt32LE(bytes.length + 64, 32); // e_shoff
    bytes.writeUInt16LE(40, 46); // e_shentsize
    bytes.writeUInt16LE(2, 48); // e_shnum
  }
  bytes.writeUInt32LE(0x70000003, 52);
  bytes.writeUInt32LE(abiOffset, 56);
  bytes.writeUInt32LE(24, 68);
  bytes.writeUInt32LE(24, 72);
  // GNU readelf -x .MIPS.abiflags, not bytes generated by REA.
  bytes.set(
    Buffer.from("000002000101000200000000000000000100000000000000", "hex"),
    abiOffset,
  );
  return bytes;
};

describe.skipIf(process.platform === "win32")(
  "PSP inspected ABI declaration boundary",
  () => {
    it("refuses a PSP image whose section headers lie beyond the captured file", async () => {
      const { directory } = await installation();
      const path = join(directory, "psp-truncated-sections.elf");
      await writeFile(path, pspElfBytes({ sectionHeadersBeyondEof: true }));
      const parsed = await parseBinaryTarget(path);
      expect(parsed).toMatchObject({
        ok: false,
        error: {
          _tag: "BinaryTargetError",
          constraint: "file_format_rejected",
          reason: expect.stringContaining("truncated ELF section header table"),
        },
      });
    });

    it("retains independently inspected PSP ABI bytes through the real target reader", async () => {
      const { directory, provider } = await installation();
      const bytes = pspElfBytes();
      const path = join(directory, "psp-with-abi.elf");
      await writeFile(path, bytes);
      const parsed = await parseBinaryTarget(path);
      if (!parsed.ok) throw parsed.error;
      if (
        parsed.value.kind !== "executable" ||
        parsed.value.architecture !== "mips"
      )
        throw new Error("PSP ELF was not recognized as MIPS");
      expect(parsed.value.mips.abiFlags).toEqual(pspAbiFlags);
      expect(provider.inspectTargetSupport(parsed.value).status).toBe(
        "supported",
      );
      const profile = await provider.resolveAnalysisProfile(parsed.value);
      if (!profile.ok) throw profile.error;
      expect(profile.value.profile?.parameters.mips_elf).toMatchObject({
        flags: 0x10a23001,
        abi_flags: { isa_level: 2, fp_abi: 2, flags1: 1 },
      });
    });

    it.each([
      ["version", 1],
      ["isaLevel", 32],
      ["isaRevision", 1],
      ["gprSize", 2],
      ["cpr1Size", 2],
      ["cpr2Size", 1],
      ["fpAbi", 1],
      ["fpAbi", 3],
      ["fpAbi", 5],
      ["isaExtension", 1],
      ["ases", 1],
      ["flags1", 0],
      ["flags1", 3],
      ["flags2", 1],
    ] satisfies [keyof MipsAbiFlags, number][])(
      "rejects unverified PSP ABI field %s=%i before extension discovery",
      async (field, value) => {
        const { provider, root } = await installation();
        await rename(root, `${root}-unavailable`);
        const altered: Extract<BinaryTarget, { architecture: "mips" }> = {
          ...target,
          mips: {
            elfClass: 32,
            byteOrder: "little",
            type: 2,
            flags: 0x10a23001,
            gnuAttributes: null,
            abiFlags: { ...pspAbiFlags, [field]: value },
          },
        };
        expect(provider.inspectTargetSupport(altered).status).toBe(
          "unsupported",
        );
        const result = await provider.resolveAnalysisProfile(altered);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("Invalid ABI was admitted");
        expect(result.error._tag).toBe("AnalysisUnsupportedTargetError");
        expect(result.error.message).toContain(
          "separate MIPS ABI flags record",
        );
      },
    );

    it.each([undefined, null])(
      "does not guess an uninspected or absent PSP ABI record: %s",
      async (abiFlags) => {
        const { provider, root } = await installation();
        await rename(root, `${root}-unavailable`);
        const altered: Extract<BinaryTarget, { architecture: "mips" }> = {
          ...target,
          mips: {
            elfClass: 32,
            byteOrder: "little",
            type: 2,
            flags: 0x10a23001,
            gnuAttributes: null,
            ...(abiFlags === undefined ? {} : { abiFlags }),
          },
        };
        const result = await provider.resolveAnalysisProfile(altered);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("Missing ABI was inferred");
        expect(result.error._tag).toBe("AnalysisUnsupportedTargetError");
        expect(result.error.message).toContain(
          "inspected separate MIPS ABI flags record",
        );
      },
    );
  },
);

describe.skipIf(process.platform === "win32")(
  "PSP explicit loader boundary",
  () => {
    it("rejects mixing the PSP loader with a configured generic processor", async () => {
      const { directory } = await installation();
      const config = parseConfig({
        GHIDRA_INSTALL_DIR: directory,
        REA_GHIDRA_LANGUAGE_ID: "x86:LE:64:default",
      });
      if (!config.ok) throw config.error;
      const provider = new GhidraProvider(config.value, silentLogger, {}, host);
      const result = await provider.resolveAnalysisProfile(target);
      expect(result.ok).toBe(false);
      if (result.ok)
        throw new Error("Conflicting language override was accepted");
      expect(result.error).toMatchObject({
        _tag: "ConfigurationError",
        settings: [
          {
            setting: "REA_GHIDRA_LANGUAGE_ID",
            constraint:
              "The bounded PSP Allegrex profile does not accept processor or compiler specification overrides.",
          },
        ],
      });
    });

    it("keeps PSP and generic language-override launch paths mutually exclusive", () => {
      const paths = {
        projectRoot: "/project",
        targetPath: "/target.elf",
        bridgeScriptPath: "/bridge/Rea.java",
        descriptorPath: "/session",
        ghidraLogPath: "/log",
        scriptLogPath: "/scriptlog",
      };
      const languageOverride = { languageId: "x86:LE:64:default" };
      expect(() =>
        ghidraHeadlessArguments({ ...paths, psp: true, languageOverride }),
      ).toThrow(
        expect.objectContaining({
          _tag: "GhidraAdmissionError",
          code: "psp_combined",
        }),
      );
      expect(ghidraHeadlessArguments({ ...paths, languageOverride })).toEqual(
        expect.arrayContaining(["-processor", "x86:LE:64:default"]),
      );
      expect(ghidraHeadlessArguments({ ...paths, psp: true })).toEqual(
        expect.arrayContaining([
          "-loader",
          "PspElfLoader",
          "-processor",
          "Allegrex:LE:32:default",
        ]),
      );
    });

    it("forces the PSP loader/language only for the selected profile", () => {
      const paths = {
        projectRoot: "/project",
        targetPath: "/target.elf",
        bridgeScriptPath: "/bridge/Rea.java",
        descriptorPath: "/session",
        ghidraLogPath: "/log",
        scriptLogPath: "/scriptlog",
      };
      expect(ghidraHeadlessArguments({ ...paths, psp: true })).toEqual(
        expect.arrayContaining([
          "-loader",
          "PspElfLoader",
          "-processor",
          "Allegrex:LE:32:default",
          "-cspec",
          "default",
        ]),
      );
      expect(ghidraHeadlessArguments(paths)).not.toContain(
        "Allegrex:LE:32:default",
      );
    });
  },
);

describe.skipIf(process.platform === "win32")(
  "PSP extension property syntax",
  () => {
    it.each([
      {
        form: "escaped key and value with colon separator",
        properties: "n\\u0061me : ghidra-allegrex\nver\\u0073ion=12.1.3\n",
      },
      {
        form: "continued key and value lines",
        properties: "name=ghidra-\\\n allegrex\nversion=12.1.\\\n 3\n",
      },
      {
        form: "duplicate keys use the last value",
        properties:
          "name=wrong\nname=ghidra-allegrex\nversion=12.1.4\nversion=12.1.3\n",
      },
    ])(
      "accepts Java Properties $form and hashes raw bytes",
      async ({ properties }) => {
        const { root } = await installation();
        const canonical = await inspectGhidraPspExtension(
          root,
          "12.1.3",
          new ArtifactResourceScope(),
        );
        const latin1Properties = Buffer.from(
          `${properties}author=caf\u00e9\n`,
          "latin1",
        );
        await writeFile(join(root, "extension.properties"), latin1Properties);
        const extension = await inspectGhidraPspExtension(
          root,
          "12.1.3",
          new ArtifactResourceScope(),
        );
        expect(extension.id).toBe("ghidra-allegrex");
        expect(extension.sha256).not.toBe(canonical.sha256);
      },
    );
  },
);

describe.skipIf(process.platform === "win32")(
  "PSP inspection completion ownership",
  () => {
    it.each([true, false])(
      "preserves physical read failure when close aborts the caller (close rejection: %s)",
      async (rejectClose) => {
        const { provider, root } = await installation();
        const controller = new AbortController();
        const readFailure = new Error("controlled PSP read failure");
        let closes = 0;
        controls.file = (handle, path) => {
          if (path !== join(root, "Module.manifest")) return;
          controls.file = undefined;
          vi.spyOn(handle, "read").mockRejectedValue(readFailure);
          const close = handle.close.bind(handle);
          vi.spyOn(handle, "close").mockImplementation(async () => {
            closes++;
            if (closes === 1) {
              controller.abort({ caller: "late close" });
              if (rejectClose) throw new Error("controlled PSP close failure");
            }
            await close();
          });
        };
        try {
          const result = await provider.resolveAnalysisProfile(target, {
            signal: controller.signal,
          });
          expect(result.ok).toBe(false);
          if (result.ok) throw new Error("Failed read admitted");
          expect(result.error._tag).toBe("AnalysisCapabilityUnavailableError");
          expect(result.error.message).toContain(readFailure.message);
          expect(result.error.cleanupIncomplete).toBe(rejectClose);
          expect(provider.hasPendingOwnedResources()).toBe(rejectClose);
          expect((await provider.closeOwnedResources()).ok).toBe(true);
          expect(result.error.cleanupIncomplete).toBe(false);
          expect(provider.hasPendingOwnedResources()).toBe(false);
          expect(closes).toBe(rejectClose ? 2 : 1);
        } finally {
          await provider.closeOwnedResources();
        }
      },
    );

    it.each([true, false])(
      "preserves exact cancellation during successful read finalization (close rejection: %s)",
      async (rejectClose) => {
        const { provider, root } = await installation();
        const controller = new AbortController();
        const reason = { caller: "finalization" };
        let closes = 0;
        controls.file = (handle, path) => {
          if (path !== join(root, "Module.manifest")) return;
          controls.file = undefined;
          const close = handle.close.bind(handle);
          vi.spyOn(handle, "close").mockImplementation(async () => {
            closes++;
            if (closes === 1) {
              controller.abort(reason);
              if (rejectClose) throw new Error("controlled PSP close failure");
            }
            await close();
          });
        };
        try {
          const result = await provider.resolveAnalysisProfile(target, {
            signal: controller.signal,
          });
          expect(result.ok).toBe(false);
          if (result.ok) throw new Error("Cancelled inspection admitted");
          expect(result.error._tag).toBe("AnalysisCancelledError");
          expect(result.error.cause).toBe(reason);
          expect(result.error.cleanupIncomplete).toBe(rejectClose);
          expect((await provider.closeOwnedResources()).ok).toBe(true);
          expect(result.error.cleanupIncomplete).toBe(false);
          expect(closes).toBe(rejectClose ? 2 : 1);
        } finally {
          await provider.closeOwnedResources();
        }
      },
    );

    it("retains directory close uncertainty without retrying an invalidated native handle", async () => {
      const { provider } = await installation();
      const controller = new AbortController();
      const readFailure = new Error("controlled directory read failure");
      let closes = 0;
      controls.directory = (handle) => {
        controls.directory = undefined;
        vi.spyOn(handle, "read").mockRejectedValue(readFailure);
        const directory: { close(): Promise<void> } = handle;
        const close = directory.close.bind(handle);
        vi.spyOn(directory, "close").mockImplementation(async () => {
          closes++;
          await close();
          controller.abort({ caller: "directory finalization" });
          throw new Error("controlled native directory close rejection");
        });
      };
      const result = await provider.resolveAnalysisProfile(target, {
        signal: controller.signal,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Failed directory admitted");
      expect(result.error._tag).toBe("AnalysisCapabilityUnavailableError");
      expect(result.error.message).toContain(readFailure.message);
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(provider.hasPendingOwnedResources()).toBe(true);
      expect((await provider.closeOwnedResources()).ok).toBe(false);
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(closes).toBe(1);
      const retried = await provider.resolveAnalysisProfile(target);
      expect(retried.ok).toBe(false);
      expect(closes).toBe(1);
    });
  },
);

describe.skipIf(process.platform === "win32")(
  "PSP launch inspection ownership",
  () => {
    it("keeps the launch inspection failure through client finalization and retries its exact descriptor", async () => {
      const { directory, root } = await installation();
      const extension = await inspectGhidraPspExtension(
        root,
        "12.1.3",
        new ArtifactResourceScope(),
      );
      const controller = new AbortController();
      const readFailure = new Error(
        "controlled launch inspection read failure",
      );
      let closes = 0;
      let allowClose = false;
      controls.file = (handle, path) => {
        if (path !== join(root, "Module.manifest")) return;
        controls.file = undefined;
        vi.spyOn(handle, "read").mockRejectedValue(readFailure);
        const close = handle.close.bind(handle);
        vi.spyOn(handle, "close").mockImplementation(async () => {
          closes++;
          controller.abort({ caller: "launch finalization" });
          if (!allowClose)
            throw new Error("controlled launch inspection close failure");
          await close();
        });
      };
      const spawn = vi.fn();
      const launcher = new GhidraHeadlessLauncher({
        environment: {},
        analyzeHeadlessPath: join(directory, "support/analyzeHeadless"),
        configurationDirectoryName: "ghidra_12.1.3_PUBLIC",
        bridgeScriptPath: "/packaged/ReaGhidraBridge.java",
        pspExtension: extension,
        spawnProcess: spawn,
      });
      const targetPath = join(directory, "target.bin");
      await writeFile(targetPath, "synthetic target");
      const client = new GhidraClient({
        launcher,
        targetPath,
        targetSha256: createHash("sha256")
          .update("synthetic target")
          .digest("hex"),
        providerVersion: "12.1.3",
        profileDigest: "b".repeat(64),
      });
      try {
        const result = await client.start(controller.signal);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("Failed PSP inspection started");
        expect(result.error.kind).toBe("start");
        expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(true);
        expect(String(result.error.cause)).toContain(
          "Ghidra headless launch failed",
        );
        expect(spawn).not.toHaveBeenCalled();
        expect(closes).toBe(2); // Inspection close, then client rollback.
        allowClose = true;
        await client.close();
        expect(closes).toBe(3);
        expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(false);
      } finally {
        allowClose = true;
        await client.close();
      }
    });
  },
);

describe.skipIf(process.platform === "win32")(
  "PSP inspection admission and identity",
  () => {
    it("retains the existing sorted recursive hash framing", async () => {
      const { root } = await installation();
      await mkdir(join(root, "a"));
      await writeFile(join(root, "a/z"), "nested before sibling");
      await writeFile(join(root, "a-foo"), "sibling after directory");
      const paths = [
        "Module.manifest",
        "a/z",
        "a-foo",
        "data/languages/allegrex.cspec",
        "data/languages/allegrex.ldefs",
        "data/languages/allegrex.pspec",
        "data/languages/allegrex.sla",
        "extension.properties",
        "lib/extension.jar",
      ];
      const hash = createHash("sha256");
      for (const path of paths) {
        const bytes = await readFile(join(root, path));
        hash.update(JSON.stringify([path, bytes.length]));
        hash.update(bytes);
      }
      const extension = await inspectGhidraPspExtension(
        root,
        "12.1.3",
        new ArtifactResourceScope(),
      );
      expect(extension.sha256).toBe(hash.digest("hex"));
    });

    it.each(["growth", "truncation"] as const)(
      "rejects file %s during the bounded read and confirms close",
      async (change) => {
        const { root, provider } = await installation();
        const path = join(
          root,
          change === "growth" ? "Module.manifest" : "extension.properties",
        );
        let closes = 0;
        controls.file = (handle, openedPath) => {
          if (openedPath !== path) return;
          controls.file = undefined;
          const read = handle.read.bind(handle);
          vi.spyOn(handle, "read").mockImplementationOnce(async (...args) => {
            await writeFile(path, change === "growth" ? "extra byte" : "");
            return read(...args);
          });
          const close = handle.close.bind(handle);
          vi.spyOn(handle, "close").mockImplementation(async () => {
            closes++;
            await close();
          });
        };
        const result = await provider.resolveAnalysisProfile(target);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("Changed file admitted");
        expect(result.error).toMatchObject({
          diagnostics: {
            code:
              change === "growth" ? "component_changed" : "component_truncated",
            relative:
              change === "growth" ? "Module.manifest" : "extension.properties",
          },
        });
        expect(closes).toBe(1);
        expect(result.error.cleanupIncomplete).toBe(false);
        expect(provider.hasPendingOwnedResources()).toBe(false);
        expect((await provider.closeOwnedResources()).ok).toBe(true);
      },
    );

    it("joins active final close before provider cleanup retries the same descriptor", async () => {
      const { root, provider } = await installation();
      let markClosing: (() => void) | undefined;
      let releaseClose: (() => void) | undefined;
      const closing = new Promise<void>((resolve) => {
        markClosing = resolve;
      });
      const finishClose = new Promise<void>((resolve) => {
        releaseClose = resolve;
      });
      let closes = 0;
      controls.file = (handle, path) => {
        if (path !== join(root, "Module.manifest")) return;
        controls.file = undefined;
        const close = handle.close.bind(handle);
        vi.spyOn(handle, "close").mockImplementation(async () => {
          closes++;
          if (closes === 1) {
            markClosing?.();
            await finishClose;
            throw new Error("controlled active close rejection");
          }
          await close();
        });
      };
      const inspecting = provider.resolveAnalysisProfile(target);
      await closing;
      let cleanupSettled = false;
      const cleaning = provider.closeOwnedResources().then((result) => {
        cleanupSettled = true;
        return result;
      });
      try {
        await Promise.resolve();
        expect(cleanupSettled).toBe(false);
        expect(closes).toBe(1);
        releaseClose?.();
        const result = await inspecting;
        expect(result.ok).toBe(false);
        expect((await cleaning).ok).toBe(true);
        if (result.ok) throw new Error("Failed close admitted");
        expect(result.error.cleanupIncomplete).toBe(false);
        expect(closes).toBe(2);
        expect(provider.hasPendingOwnedResources()).toBe(false);
      } finally {
        releaseClose?.();
        await cleaning;
        await provider.closeOwnedResources();
      }
    });
  },
);

describe.skipIf(process.platform === "win32")(
  "PSP profile selection completion through composed sessions",
  () => {
    it.each(["preview", "open"] as const)(
      "preserves physical failure and live cleanup after late cancellation during %s",
      async (operation) => {
        const { directory, root, provider } = await installation();
        const path = join(directory, "controlled-psp.elf");
        await writeFile(path, pspElfBytes());
        const parsed = await parseBinaryTarget(path);
        if (!parsed.ok) throw parsed.error;
        const controller = new AbortController();
        const readFailure = new Error(
          "controlled session profile read failure",
        );
        let allowClose = false;
        let closes = 0;
        controls.file = (handle, openedPath) => {
          if (openedPath !== join(root, "Module.manifest")) return;
          controls.file = undefined;
          vi.spyOn(handle, "read").mockRejectedValue(readFailure);
          const close = handle.close.bind(handle);
          vi.spyOn(handle, "close").mockImplementation(async () => {
            closes++;
            controller.abort({ caller: "profile inspection finalization" });
            if (!allowClose)
              throw new Error("controlled session profile close failure");
            await close();
          });
        };
        const createClient = vi
          .spyOn(provider, "createClient")
          .mockImplementation(() => {
            throw new Error("Failed profile must not start an engine");
          });
        const binary = composeBinarySession(
          new AnalysisProviderRegistry([provider]),
        );
        try {
          const result =
            operation === "preview"
              ? await binary.previewTarget(parsed.value, {
                  providerId: "ghidra",
                  signal: controller.signal,
                })
              : await binary.open(path, {
                  providerId: "ghidra",
                  signal: controller.signal,
                });
          expect(result.ok).toBe(false);
          if (result.ok) throw new Error("Failed profile admitted");
          expect(result.error._tag).toBe("AnalysisCapabilityUnavailableError");
          expect(result.error.message).toContain(readFailure.message);
          expect(result.error.cleanupIncomplete).toBe(true);
          expect(await binary.status()).toMatchObject({
            cleanup_pending: true,
          });
          expect(createClient).not.toHaveBeenCalled();
          const failedClose = await binary.close();
          expect(failedClose.ok).toBe(false);
          expect(closes).toBe(2);
          expect(result.error.cleanupIncomplete).toBe(true);
          allowClose = true;
          expect(await binary.close()).toEqual({ ok: true, value: null });
          expect(closes).toBe(3);
          expect(result.error.cleanupIncomplete).toBe(false);
          if (failedClose.ok) throw new Error("Close unexpectedly succeeded");
          expect(failedClose.error.cleanupIncomplete).toBe(false);
          expect(await binary.status()).toMatchObject({
            cleanup_pending: false,
          });
        } finally {
          allowClose = true;
          await binary.close();
        }
      },
    );
  },
);

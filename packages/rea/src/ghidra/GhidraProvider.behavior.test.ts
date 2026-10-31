import { EXISTING_PROJECT_WINDOWS_UNAVAILABLE } from "./GhidraProviderCapabilities.js";
import { ProcessOutputTokenScanner } from "../process/ProcessOutputTokenScanner.js";
import { GhidraNativeAotSnapshotOwner } from "./GhidraNativeAotSnapshotOwner.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { resolvedAnalysisError } from "../domain/analysisErrorBase.js";
import { createDeferred } from "../../tests/fixtures/binarySession.js";
import { ProviderInspectionScope } from "../application/ProviderInspectionScope.js";
import { ok as javaProbeOk, err, ok } from "../domain/result.js";
import type { GhidraJavaObservation } from "./GhidraJavaProbe.js";
import type { GhidraSeedReport } from "./GhidraAnalysisSeeds.js";
import type { GhidraDisabledAnalyzerReport } from "./GhidraDisabledAnalyzers.js";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
// Fake-backed provider coverage; real Ghidra verification lives in
// `npm run verify:ghidra` and its focused variants.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import * as nativeLoader from "../windows/WindowsNativeLoader.js";
import {
  fixtureDosLoadImage,
  compareDosClientFixture,
} from "./GhidraLoadImage.fixture.js";
import { fixtureRawBinaryLoadImage } from "./GhidraRawBinaryLoadImage.fixture.js";
import {
  nativeAotPeDigest,
  nativeAotPeFixture,
  nativeAotPeHeaderIndirectionFixture,
  nativeAotPeOptionalHeaderFixture,
  nativeAotPeVirtualSectionFixture,
} from "../../tests/fixtures/nativeaotPe.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";

import { parseConfig } from "../config/parseConfig.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { parseExecutableHeader } from "../domain/binaryTarget.js";
import { elf, thinMach } from "../domain/binaryTarget.fixture.js";
import { GhidraProvider } from "./GhidraProvider.js";
import type { GhidraTargetSnapshot } from "./GhidraClient.js";
import {
  ghidraMissingProgramGuidance,
  type GhidraProviderClientFactory,
} from "./GhidraProviderClient.js";
import type { GhidraHeadlessLauncher } from "./GhidraLauncher.js";
import type { GhidraInstallationHost } from "./GhidraInstallation.js";
import {
  GHIDRA_MUTATING_OPERATIONS,
  GHIDRA_SESSION_CAPABILITIES,
} from "./GhidraSessionValues.js";
import type { Result } from "../domain/result.js";
import { GhidraSessionError } from "./GhidraSessionError.js";
import { silentLogger } from "../logger.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { ProviderStartupDeadline } from "../process/ProviderDeadline.js";
import {
  createFunctionCoordinateContext,
  functionCoordinateContextsEqual,
} from "../domain/native/functionCoordinateContext.js";
import { createAnalysisProfile } from "../domain/analysisProfile.js";
import { createAnalysisExecution } from "../application/AnalysisProvider.js";
import { AnalysisSnapshotCache } from "../application/binary/AnalysisSnapshotCache.js";
import { createEvidence } from "../domain/evidence.js";
import { createEvidenceBundle } from "../domain/evidenceBundle.js";

const INSTALL = "/opt/ghidra_12.1.4_PUBLIC";
afterEach(() => vi.restoreAllMocks());
const installationHost = (
  platform: NodeJS.Platform = "linux",
): GhidraInstallationHost => ({
  platform,
  architecture: "x64",
  readText: () => "application.version=12.1.4\napplication.java.min=21\n",
  executable: () => true,
  probeJava: () =>
    javaProbeOk<GhidraJavaObservation>({
      osArch: "amd64",
      osName: platform === "win32" ? "Windows 11" : "Linux",
      version: "21.0.11",
      major: 21,
      home: "/usr/lib/jvm/jdk-21",
      bits: 64,
      runtime: "jdk",
      vmName: "OpenJDK 64-Bit Server VM",
    }),
});

const provider = (
  host = installationHost(),
  clientFactory?: GhidraProviderClientFactory,
  environment: Readonly<Record<string, string>> = {},
): GhidraProvider => {
  const config = parseConfig({ GHIDRA_INSTALL_DIR: INSTALL, ...environment });
  if (!config.ok) throw config.error;
  return new GhidraProvider(
    config.value,
    silentLogger,
    {},
    host,
    clientFactory,
  );
};

const createElfClient = async (ghidra: GhidraProvider) => {
  const target = executableTarget("elf", "x86_64");
  const resolved = await ghidra.resolveAnalysisProfile(target);
  if (!resolved.ok) throw resolved.error;
  if (resolved.value.profile === null)
    throw new Error("Expected a bound Ghidra profile");
  return ghidra.createClient(target, resolved.value.profile);
};

it.each(["readiness", "client"] as const)(
  "keeps completed Java prerequisite failure primary across late cancellation in %s",
  async (consumer) => {
    const controller = new AbortController();
    const reason = { request: "late Java cancellation" };
    let armed = false;
    let nativeCreates = 0;
    const base = installationHost();
    const ghidra = provider(
      {
        ...base,
        probeJava: (command, environment, options) => {
          if (!armed) return base.probeJava(command, environment, options);
          controller.abort(reason);
          return err({
            _tag: "GhidraJavaProbeFailure",
            code: "version_unresolved",
            detail: "completed invalid Java report",
          });
        },
      },
      () => {
        nativeCreates++;
        throw new Error("A failed prerequisite cannot create a native client");
      },
    );
    const client =
      consumer === "client" ? await createElfClient(ghidra) : undefined;
    armed = true;
    try {
      if (client === undefined) {
        const availability = await ghidra.inspectAvailability({
          signal: controller.signal,
        });
        expect(availability).toMatchObject({
          status: "unavailable",
          diagnostics: { java_probe_failure: { code: "version_unresolved" } },
        });
      } else {
        const result = await client.execute(
          "analyze_function",
          {},
          { signal: controller.signal },
        );
        if (result.ok)
          throw new Error("Expected physical prerequisite failure");
        expect(result.error).toMatchObject({
          _tag: "ProviderAdapterError",
          operation: "analyze_function",
          diagnostics: { java_probe_failure: { code: "version_unresolved" } },
        });
        expect(projectAnalysisError(result.error).code).toBe(
          "execution_failure",
        );
      }
      expect(nativeCreates).toBe(0);
    } finally {
      await client?.close();
      await ghidra.closeOwnedResources();
    }
  },
);

it.each([
  "program-info-v1",
  "program-info-v2",
  "program-info-v3",
  "program-info-v4",
])(
  "retains historical PE PDB Evidence for %s without replaying its old projection",
  async (pdbObservations) => {
    const target = peTarget("x86_64");
    const resolved = await provider().resolveAnalysisProfile(target);
    if (!resolved.ok || resolved.value.profile === null)
      throw new Error("Expected admitted PE profile");
    const current = resolved.value.profile;
    const prior = createAnalysisProfile(current.provider, {
      ...current.parameters,
      pdb_observations: pdbObservations,
    });
    const operation = "search_procedures";
    const parameters = { pattern: "wmain" };
    const limitations = [
      pdbObservations === "program-info-v4"
        ? "Legacy projection discarded NB10 declaration when the reported GUID was omitted."
        : "Legacy projection collapsed unknown PDB load state.",
    ];
    const cache = new AnalysisSnapshotCache();
    cache.record({
      target,
      profile: prior,
      operation,
      parameters,
      execution: createAnalysisExecution([], prior.provider, {
        subject: target,
        analysisProfile: prior,
        limitations,
      }),
    });
    const evidence = createEvidence(target, prior.provider, {
      operation,
      parameters,
      result: [],
      analysisProfile: prior,
      limitations,
    });
    const exported = cache.export(
      target,
      prior,
      createEvidenceBundle([evidence]),
    );
    if (!exported.ok) throw exported.error;
    const imported = new AnalysisSnapshotCache();
    expect(imported.import(exported.value, undefined, () => ok(0)).ok).toBe(
      true,
    );
    expect(
      imported.lookup(target, current, operation, parameters),
    ).toBeUndefined();
    expect(
      imported.lookup(target, prior, operation, parameters)?.limitations,
    ).toEqual(expect.arrayContaining(limitations));
    expect(exported.value.evidence_bundle.records).toContainEqual(evidence);
  },
);

it("carries the inspected release identity into the production launcher", async () => {
  const launchers: GhidraHeadlessLauncher[] = [];
  const ghidra = provider(
    {
      ...installationHost(),
      readText: () =>
        "application.version=12.1.4\napplication.release.name=PUBLIC\napplication.java.min=21\n",
    },
    (options) => {
      launchers.push(options.launcher as GhidraHeadlessLauncher);
      return {
        start: () => Promise.resolve(ok(sessionInfo())),
        callTool: () => Promise.resolve(ok(null)),
        close: () => Promise.resolve(ok(null)),
      };
    },
  );
  const client = await createElfClient(ghidra);
  expect(launchers).toHaveLength(0);
  expect((await client.execute("health", {})).ok).toBe(true);
  expect(launchers[0]?.options).toMatchObject({
    configurationDirectoryName: "ghidra_12.1.4_PUBLIC",
  });
  await client.close();
});

describe("Ghidra provider", () => {
  it("commits DOS loader and real-mode language while retaining the CPU family", async () => {
    const ghidra = provider();
    const target: BinaryTarget = {
      path: "/tmp/legacy.exe",
      sha256: "a".repeat(64),
      kind: "executable",
      format: "dos-mz",
      architecture: "x86",
      availableArchitectures: ["x86"],
    };
    expect(ghidra.inspectTargetSupport(target).status).toBe("supported");
    const resolved = await ghidra.resolveAnalysisProfile(target);
    expect(resolved.ok && resolved.value).toMatchObject({
      profile: {
        parameters: {
          target_format: "dos-mz",
          architecture: "x86",
          loader: "MzLoader",
          load_image_evidence: "independent-mz-mapping-relocations-v2",
          language_id: "x86:LE:16:Real Mode",
          compiler_spec_id: "default",
          load_segment: "0x1000",
          address_coordinates: "linear-byte-offset",
        },
      },
    });
    const windows = provider(installationHost("win32"));
    expect(windows.inspectTargetSupport(target).status).toBe("unsupported");
  });
  it("admits parsed Hexagon ELF targets through Ghidra profile selection and declines them on Windows", async () => {
    const parsed = parseExecutableHeader(elf(1, 1, 164), "x64");
    if (!parsed.ok) throw new Error("Expected valid Hexagon ELF target");
    const target: BinaryTarget = {
      path: "/tmp/chre_pal.so",
      sha256: "a".repeat(64),
      kind: "executable",
      ...parsed.value,
    };
    const ghidra = provider();
    expect(ghidra.inspectTargetSupport(target)).toMatchObject({
      status: "supported",
    });
    const resolved = await ghidra.resolveAnalysisProfile(target);
    expect(resolved.ok && resolved.value).toMatchObject({
      profile: {
        parameters: {
          target_format: "elf",
          architecture: "hexagon",
          loader: "auto-from-header",
          language_id: "auto-from-header",
          compiler_spec_id: "auto-default",
        },
      },
    });
    const windows = provider(installationHost("win32"));
    expect(windows.inspectTargetSupport(target)).toMatchObject({
      status: "unsupported",
      code: "target_format_unsupported",
    });
  });
  it("re-observes the exact installation for each fresh task without launching Ghidra", async () => {
    let probeCount = 0;
    const host: GhidraInstallationHost = {
      ...installationHost(),
      probeJava: () => {
        probeCount += 1;
        return javaProbeOk<GhidraJavaObservation>({
          osArch: "amd64",
          osName: "Linux",
          version: "21.0.11",
          major: 21,
          home: "/usr/lib/jvm/jdk-21",
          bits: 64,
          runtime: "jdk",
        });
      },
    };
    const ghidra = provider(host);

    expect(ghidra.capabilities()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "list_procedures",
          effects: expect.objectContaining({
            mutatesArtifact: false,
            mayShowUi: false,
            mayWriteFilesystem: true,
          }),
        }),
        expect.objectContaining({
          operation: "analyze_function",
          limitations: expect.arrayContaining([
            expect.stringContaining(
              "unresolved targetless flows remain unknown",
            ),
          ]),
        }),
      ]),
    );
    expect(await ghidra.inspectAvailability()).toMatchObject({
      status: "available",
      diagnostics: {
        install_dir: INSTALL,
        provider_version: "12.1.4",
        java_version: "21.0.11",
      },
    });
    expect(await ghidra.inspectAvailability()).toMatchObject({
      status: "available",
    });
    expect(probeCount).toBe(2);
  });

  it("separates target kind, format, and concrete architecture", () => {
    const ghidra = provider();
    expect(
      ghidra.inspectTargetSupport(executableTarget("elf", "x86_64")),
    ).toMatchObject({
      status: "supported",
    });
    expect(
      ghidra.inspectTargetSupport(executableTarget("pe", "arm64")),
    ).toMatchObject({
      status: "supported",
    });
    expect(
      ghidra.inspectTargetSupport({
        path: "/tmp/fixture.asar",
        sha256: "a".repeat(64),
        kind: "archive",
        format: "asar",
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "target_kind_unsupported",
    });
    expect(
      ghidra.inspectTargetSupport({
        path: "/tmp/fixture.js",
        sha256: "a".repeat(64),
        kind: "artifact",
        format: "javascript",
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "target_kind_unsupported",
    });
  });
});

describe("Ghidra raw-binary profile", () => {
  it("admits raw 6502 on Windows and binds its 16-bit language without mutation authority", async () => {
    const ghidra = provider(installationHost("win32"));
    const target: BinaryTarget = {
      path: "/tmp/6502.bin",
      sha256: "a".repeat(64),
      kind: "executable",
      format: "raw-binary",
      architecture: "6502",
      availableArchitectures: ["6502"],
      entryPoint: "0x8001",
      entryPointSource: "0x008001",
    };
    expect(ghidra.inspectTargetSupport(target).status).toBe("supported");
    const resolved = await ghidra.resolveAnalysisProfile(target);
    if (!resolved.ok) throw resolved.error;
    expect(resolved.value.profile?.parameters).toMatchObject({
      architecture: "6502",
      loader: "BinaryLoader",
      language_id: "6502:LE:16:default",
      compiler_spec_id: "default",
      entry_point: "0x8001",
      language_selection: "caller-supplied-v1",
      load_image_evidence: "independent-raw-mapping-context-v4",
    });
    expect(
      ghidra
        .capabilities()
        .some(({ available, effects }) => available && effects.mutatesArtifact),
    ).toBe(false);
  });
  it("commits BinaryLoader language and caller-supplied entry", async () => {
    const ghidra = provider();
    const target: BinaryTarget = {
      path: "/tmp/ecu.bin",
      sha256: "a".repeat(64),
      kind: "executable",
      format: "raw-binary",
      architecture: "arm",
      availableArchitectures: ["arm"],
      entryPoint: "0x8000000",
      entryPointSource: "0x08000000",
    };
    expect(ghidra.inspectTargetSupport(target).status).toBe("supported");
    const resolved = await ghidra.resolveAnalysisProfile(target);
    expect(resolved.ok && resolved.value).toMatchObject({
      profile: {
        parameters: {
          target_format: "raw-binary",
          architecture: "arm",
          loader: "BinaryLoader",
          language_id: "ARM:LE:32:v7",
          compiler_spec_id: "default",
          language_selection: "caller-supplied-v1",
          entry_point: "0x8000000",
        },
      },
    });
    const shifted = await ghidra.resolveAnalysisProfile({
      ...target,
      entryPoint: "0x8001000",
      entryPointSource: "0x8001000",
    });
    expect(resolved.ok && shifted.ok).toBe(true);
    if (!resolved.ok || !shifted.ok || resolved.value.profile === null)
      throw new Error("expected raw-binary profiles");
    expect(shifted.value.profile?.digest).toEqual(expect.any(String));
    expect(shifted.value.profile?.digest).not.toBe(
      resolved.value.profile.digest,
    );
    const windows = provider(installationHost("win32"));
    expect(windows.inspectTargetSupport(target).status).toBe("unsupported");
  });
  it("binds raw m68k to the big-endian 68000 language outside Windows P0", async () => {
    const target: BinaryTarget = {
      path: "/tmp/m68k.bin",
      sha256: "a".repeat(64),
      kind: "executable",
      format: "raw-binary",
      architecture: "m68k",
      availableArchitectures: ["m68k"],
      entryPoint: "0x1000",
      entryPointSource: "0x00001000",
    };
    const ghidra = provider();
    expect(ghidra.inspectTargetSupport(target).status).toBe("supported");
    const resolved = await ghidra.resolveAnalysisProfile(target);
    if (!resolved.ok) throw resolved.error;
    expect(resolved.value.profile?.parameters).toMatchObject({
      target_format: "raw-binary",
      architecture: "m68k",
      loader: "BinaryLoader",
      language_id: "68000:BE:32:default",
      compiler_spec_id: "default",
      language_selection: "caller-supplied-v1",
      entry_point: "0x1000",
    });
    expect(
      provider(installationHost("win32")).inspectTargetSupport(target),
    ).toMatchObject({
      status: "unsupported",
      code: "target_format_unsupported",
    });
  });
});

describe("Ghidra Mach-O slice support", () => {
  it("declines parsed thin arm64_32 Mach-O targets, naming every admitted family", () => {
    const parsed = parseExecutableHeader(
      thinMach(0xcefaedfe, 0x0200000c),
      "arm64",
    );
    if (!parsed.ok) throw new Error("Expected valid arm64_32 Mach-O target");
    const support = provider().inspectTargetSupport({
      path: "/tmp/watch.o",
      sha256: "a".repeat(64),
      kind: "executable",
      ...parsed.value,
    });
    if (support.status !== "unsupported") throw new Error("Expected a refusal");
    expect(support.code).toBe("architecture_unsupported");
    expect(support.reason.match(/\w+/gu)).toEqual(
      expect.arrayContaining([
        "arm64_32",
        "x86",
        "x86_64",
        "arm",
        "arm64",
        "mips",
        "riscv",
        "powerpc",
        "hexagon",
        "6502",
        "m68k",
      ]),
    );
  });
  it("refuses universal targets whose selected slice cannot be enforced", () => {
    const ghidra = provider();
    const universal: BinaryTarget = {
      path: "/tmp/fixture",
      sha256: "a".repeat(64),
      kind: "executable",
      format: "mach-o-universal",
      architecture: "arm64",
      availableArchitectures: ["x86_64", "arm64"],
      universalSlice: { offset: 0, size: 32 },
    };

    expect(ghidra.inspectTargetSupport(universal)).toMatchObject({
      status: "unsupported",
      code: "architecture_unsupported",
      reason: expect.stringContaining("universal Mach-O"),
      diagnostics: {
        architecture: "arm64",
        available_architectures: ["x86_64", "arm64"],
      },
    });
    expect(
      ghidra.inspectTargetSupport(executableTarget("mach-o", "arm64")),
    ).toMatchObject({ status: "supported" });

    expect(
      ghidra.inspectTargetSupport({
        ...universal,
        availableArchitectures: ["arm64"] as const,
      }),
    ).toMatchObject({ status: "supported" });
  });
});

describe("Ghidra platform support", () => {
  it.each([
    { architecture: "arm", languageId: "ARM:LE:32:v7" },
    { architecture: "arm64", languageId: "AARCH64:LE:64:v8A" },
  ] as const)(
    "records explicit Windows $architecture processor selection without claiming loader selection",
    async ({ architecture, languageId }) => {
      const directory = await mkdtemp(
        join(tmpdir(), "rea-arm-profile-language-"),
      );
      onTestFinished(() => rm(directory, { recursive: true, force: true }));
      const languages = join(
        directory,
        "Ghidra/Processors/fixture/data/languages",
      );
      await mkdir(languages, { recursive: true });
      await writeFile(
        join(languages, "fixture.ldefs"),
        `<language_definitions><language processor="${architecture === "arm" ? "ARM" : "AARCH64"}" endian="little" size="${architecture === "arm" ? 32 : 64}" variant="fixture" id="${languageId}"><compiler name="Visual Studio" spec="fixture.cspec" id="windows"/></language></language_definitions>`,
      );
      const config = parseConfig({
        GHIDRA_INSTALL_DIR: directory,
        REA_GHIDRA_LANGUAGE_ID: languageId,
        REA_GHIDRA_COMPILER_SPEC_ID: "windows",
      });
      if (!config.ok) throw config.error;
      const ghidra = new GhidraProvider(
        config.value,
        silentLogger,
        {},
        installationHost("win32"),
      );
      const resolved = await ghidra.resolveAnalysisProfile(
        peTarget(architecture),
      );
      if (!resolved.ok) throw resolved.error;
      expect(resolved.value.profile?.parameters).toMatchObject({
        windows_arm_pe_import: "explicit-language-v1",
        windows_arm_pe_machine: peTarget(architecture).peMachine,
        language_id: languageId,
        compiler_spec_id: "windows",
      });
    },
  );

  it("versions the Windows ARM PE import without changing other profile lanes", async () => {
    for (const platform of ["win32", "linux"] as const) {
      const ghidra = provider(installationHost(platform));
      for (const architecture of ["x86", "x86_64", "arm", "arm64"] as const) {
        const resolved = await ghidra.resolveAnalysisProfile(
          peTarget(architecture),
        );
        if (!resolved.ok) throw resolved.error;
        if (resolved.value.profile === null)
          throw new Error("Expected a PE analysis profile");
        const parameters = resolved.value.profile.parameters;
        if (
          platform === "win32" &&
          (architecture === "arm" || architecture === "arm64")
        )
          expect(parameters).toHaveProperty(
            "windows_arm_pe_import",
            "loader-selected-language-v1",
          );
        else expect(parameters).not.toHaveProperty("windows_arm_pe_import");
        if (
          platform === "win32" &&
          (architecture === "arm" || architecture === "arm64")
        )
          expect(parameters.windows_arm_pe_machine).toBe(
            peTarget(architecture).peMachine,
          );
        else expect(parameters).not.toHaveProperty("windows_arm_pe_machine");
      }
    }
  });

  it("commits the PE role and managed classification to profile identity", async () => {
    const ghidra = provider(installationHost("win32"));
    const application = peTarget("x86_64");
    const library = {
      ...application,
      executableRole: "shared-library",
    } as const;
    const digests = new Set<string>();
    for (const target of [
      application,
      library,
      { ...library, managed: true },
    ]) {
      const resolved = await ghidra.resolveAnalysisProfile(target);
      if (!resolved.ok) throw resolved.error;
      const profile = resolved.value.profile;
      if (profile === null) throw new Error("Expected a PE analysis profile");
      expect(profile.parameters).toMatchObject({
        executable_role: target.executableRole,
        managed: target.managed,
        native_aot_metadata: {
          contract_revision: "rtr-9.1-x64-pe-read-only-v8",
          source_bytes: 128 * 1024 * 1024,
          work_units: 64 * 1024 * 1024,
          working_memory_bytes: 64 * 1024 * 1024,
          report_bytes: 4 * 1024 * 1024,
        },
      });
      digests.add(profile.digest);
    }
    expect(digests.size).toBe(3);
    const nonPe = await ghidra.resolveAnalysisProfile(
      executableTarget("elf", "x86_64"),
    );
    if (!nonPe.ok || nonPe.value.profile === null)
      throw new Error("Expected a non-PE analysis profile");
    expect(nonPe.value.profile.parameters).not.toHaveProperty(
      "native_aot_metadata",
    );
  });

  it("keeps Windows annotation mutation unavailable independently of native controls", () => {
    const ghidra = provider(installationHost("win32"));
    expect(
      ghidra
        .capabilities()
        .find(({ operation }) => operation === "annotate_native_function"),
    ).toMatchObject({
      available: false,
      reason: "Windows Ghidra P0 does not admit database mutation.",
      availabilityCode: "unsupported_host",
    });
  });
});

describe("Ghidra Windows platform support", () => {
  it("keeps Windows P0 unavailable until native isolation authority exists", async () => {
    const reason = "Authored native artifact unavailable diagnostic";
    const native = vi
      .spyOn(nativeLoader, "systemWindowsNativeAuthority")
      .mockReturnValue({
        available: false,
        failureStage: "artifact",
        reason,
      });
    onTestFinished(() => native.mockRestore());
    const ghidra = provider(installationHost("win32"));
    const nativeApplication = peTarget("x86_64");
    for (const architecture of ["x86", "x86_64"] as const)
      expect(ghidra.inspectTargetSupport(peTarget(architecture))).toMatchObject(
        {
          status: "supported",
          diagnostics: {
            host_platform: "win32",
            architecture,
            executable_role: "application",
            managed: false,
          },
        },
      );
    expect(await ghidra.inspectAvailability()).toMatchObject({
      status: "unavailable",
      code: "runtime_missing",
      reason,
      diagnostics: {
        windows_native_failure: {
          stage: "artifact",
          remediation: expect.any(String),
        },
        windows_security: {
          job_object_process_ownership: expect.objectContaining({
            available: false,
            proof: "not-proven",
          }),
          private_runtime_dacl: expect.objectContaining({
            available: false,
            proof: "not-proven",
          }),
          reparse_safe_path_admission: expect.objectContaining({
            available: false,
            proof: "not-proven",
          }),
        },
      },
    });
    expect(ghidra.capabilities()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "list_procedures",
          available: false,
          availabilityCode: "runtime_missing",
          limitations: expect.arrayContaining([
            expect.stringContaining(
              "matching packaged Windows x64 native addon",
            ),
            expect.stringContaining(
              "private DACLs, and Job Object ownership automatically",
            ),
          ]),
        }),
      ]),
    );
    expect(
      ghidra.inspectTargetSupport({
        ...nativeApplication,
        executableRole: "non-executable",
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "target_role_unsupported",
    });
    expect(
      ghidra.inspectTargetSupport({ ...nativeApplication, managed: true }),
    ).toMatchObject({
      status: "unsupported",
      code: "managed_target_unsupported",
    });
    expect(
      ghidra.inspectTargetSupport(executableTarget("elf", "x86_64")),
    ).toMatchObject({
      status: "unsupported",
      code: "target_format_unsupported",
    });
    // ARM64 PE is admitted on Windows P0 (bounded; see docs/windows-ghidra-p0.md).
    expect(
      ghidra.inspectTargetSupport(executableTarget("pe", "arm64")).status,
    ).toBe("supported");
    expect(
      ghidra.inspectTargetSupport(executableTarget("pe", "arm")).status,
    ).toBe("supported");
  });
});

describe("Windows Ghidra native failure diagnostics", () => {
  it.each([
    ["artifact", "runtime_missing"],
    ["self-test", "runtime_unavailable"],
    ["inspection", "runtime_unavailable"],
  ] as const)(
    "keeps Windows P0 unavailable after a %s failure",
    async (failureStage, code) => {
      const load = vi
        .spyOn(nativeLoader, "systemWindowsNativeAuthority")
        .mockReturnValue({
          available: false,
          failureStage,
          reason: "Windows native controls are unavailable: missing manifest",
        });
      const ghidra = provider(installationHost("win32"));
      const nativeApplication = peTarget("x86_64");

      for (const architecture of ["x86", "x86_64"] as const)
        expect(
          ghidra.inspectTargetSupport(peTarget(architecture)),
        ).toMatchObject({
          status: "supported",
          diagnostics: {
            host_platform: "win32",
            architecture,
            executable_role: "application",
            managed: false,
          },
        });
      expect(await ghidra.inspectAvailability()).toMatchObject({
        status: "unavailable",
        code,
        reason: expect.stringContaining(
          "Windows native controls are unavailable",
        ),
        diagnostics: {
          windows_native_failure: {
            stage: failureStage,
            remediation: expect.any(String),
          },
          windows_security: {
            job_object_process_ownership: expect.objectContaining({
              available: false,
              proof: "not-proven",
            }),
            private_runtime_dacl: expect.objectContaining({
              available: false,
              proof: "not-proven",
            }),
            reparse_safe_path_admission: expect.objectContaining({
              available: false,
              proof: "not-proven",
            }),
          },
        },
      });
      expect(load).toHaveBeenCalledTimes(1);
      expect(ghidra.capabilities()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "list_procedures",
            available: false,
            availabilityCode: code,
            limitations: expect.arrayContaining([
              expect.stringContaining(
                "matching packaged Windows x64 native addon",
              ),
              expect.stringContaining(
                "private DACLs, and Job Object ownership automatically",
              ),
            ]),
          }),
        ]),
      );
      expect(
        ghidra.inspectTargetSupport({
          ...nativeApplication,
          executableRole: "non-executable",
        }),
      ).toMatchObject({
        status: "unsupported",
        code: "target_role_unsupported",
      });
      expect(
        ghidra.inspectTargetSupport({ ...nativeApplication, managed: true }),
      ).toMatchObject({
        status: "unsupported",
        code: "managed_target_unsupported",
      });
      expect(
        ghidra.inspectTargetSupport(executableTarget("elf", "x86_64")),
      ).toMatchObject({
        status: "unsupported",
        code: "target_format_unsupported",
      });
      const client = ghidra.createClient(nativeApplication);
      const health = await client.execute("health", {});
      if (health.ok)
        throw new Error(
          "Failed native admission must not create a ready client",
        );
      expect(projectAnalysisError(health.error)).toMatchObject({
        code: "capability_unavailable",
        details: {
          reason: "Windows native controls are unavailable: missing manifest",
        },
      });
      expect(load).toHaveBeenCalledTimes(3);
    },
  );
});

describe("Ghidra Windows PE fixture admission", () => {
  it.each(["arm", "arm64"] as const)(
    "does not infer a COFF machine from an unobserved %s family",
    (architecture) => {
      const { peMachine, ...unobserved } = peTarget(architecture);
      expect(peMachine).toBeDefined();
      expect(
        provider(installationHost("win32")).inspectTargetSupport(unobserved),
      ).toMatchObject({
        status: "unsupported",
        code: "architecture_unsupported",
        diagnostics: { pe_machine: null },
      });
    },
  );

  it("admits generated PE32 and PE32+ DLLs and applications while preserving native-only Windows admission", async () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    await promisify(execFile)(process.execPath, [
      join(root, "scripts/create-ghidra-windows-fixture.mjs"),
    ]);
    const ghidra = provider(installationHost("win32"));
    for (const architecture of ["x86", "x86_64", "arm", "arm64"] as const) {
      for (const dll of [false, true]) {
        const suffix = architecture === "x86_64" ? "" : `-${architecture}`;
        const path = join(
          root,
          "build/fixtures",
          `rea-ghidra-windows${suffix}.${dll ? "dll" : "exe"}`,
        );
        const bytes = await readFile(path);
        const metadata = parseExecutableHeader(bytes, "x64");
        const role = dll ? "shared-library" : "application";
        expect(metadata).toMatchObject({
          ok: true,
          value: {
            format: "pe",
            architecture,
            executableRole: role,
            managed: false,
          },
        });
        if (!metadata.ok) throw new Error(metadata.error);
        if (metadata.value.format !== "pe")
          throw new Error("Expected a PE fixture");
        const target: BinaryTarget = {
          path,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          kind: "executable",
          ...metadata.value,
        };
        expect(ghidra.inspectTargetSupport(target).status).toBe("supported");
        if (architecture === "arm") {
          for (const peMachine of [0x01c0, 0x01c2]) {
            const legacy = Buffer.from(bytes);
            legacy.writeUInt16LE(peMachine, legacy.readUInt32LE(0x3c) + 4);
            const parsed = parseExecutableHeader(legacy, "x64");
            if (!parsed.ok) throw new Error(parsed.error);
            if (parsed.value.format !== "pe")
              throw new Error("Expected a PE fixture");
            expect(parsed.value).toMatchObject({ architecture, peMachine });
            expect(
              ghidra.inspectTargetSupport({
                ...target,
                ...parsed.value,
                sha256: createHash("sha256").update(legacy).digest("hex"),
              }),
            ).toMatchObject({
              status: "unsupported",
              code: "architecture_unsupported",
              diagnostics: { pe_machine: peMachine },
            });
          }
        }
        for (const [candidate, code] of [
          [
            { ...target, executableRole: "non-executable" },
            "target_role_unsupported",
          ],
          [{ ...target, managed: true }, "managed_target_unsupported"],
        ] as const) {
          expect(ghidra.inspectTargetSupport(candidate)).toMatchObject({
            status: "unsupported",
            code,
          });
        }
      }
    }
  });
});

describe("Ghidra startup configuration", () => {
  it("carries supplied startup settings through configuration, the provider, the timer and timeout diagnostics", async () => {
    const target = executableTarget("elf", "x86_64");
    for (const [raw, expected] of [
      [undefined, 330_000],
      ["900000", 900_000],
      ["1260000", 1_260_000],
      ["2147483647", 2_147_483_647],
    ] as const) {
      const config = parseConfig({
        GHIDRA_INSTALL_DIR: INSTALL,
        ...(raw === undefined ? {} : { REA_GHIDRA_STARTUP_TIMEOUT_MS: raw }),
      });
      if (!config.ok) throw config.error;
      let timeout: number | undefined;
      const ghidra = new GhidraProvider(
        config.value,
        silentLogger,
        {},
        installationHost(),
        (options) => {
          timeout = options.startupTimeoutMs;
          return {
            start: () =>
              Promise.resolve(
                err(
                  new GhidraSessionError(
                    "timeout",
                    "Startup deadline elapsed",
                    {},
                  ),
                ),
              ),
            callTool: () => Promise.resolve(ok([])),
            close: () => Promise.resolve(ok(null)),
          };
        },
      );
      const profile = await ghidra.resolveAnalysisProfile(target);
      if (!profile.ok) throw profile.error;
      if (profile.value.profile === null)
        throw new Error("Expected a bound profile");
      const client = ghidra.createClient(target, profile.value.profile);
      try {
        const failure = await client.execute("health", {});
        expect(timeout, String(raw)).toBe(expected);
        expect(failure).toMatchObject({
          ok: false,
          error: { _tag: "AnalysisTimeoutError", timeoutMs: expected },
        });
        if (timeout === undefined)
          throw new Error("Provider omitted startup deadline");
        const deadline = new ProviderStartupDeadline(timeout);
        try {
          expect(await deadline.wait(20)).toBe("elapsed");
          expect(deadline.signal.aborted).toBe(false);
        } finally {
          deadline.dispose();
        }
      } finally {
        await client.close();
      }
    }
  });
});

describe("Ghidra client projection", () => {
  it("commits exact provider, isolation, and resource semantics", async () => {
    const toolCalls: Array<{
      readonly operation: string;
      readonly input: unknown;
      readonly options: unknown;
    }> = [];
    let startCount = 0;
    const factoryOptions: unknown[] = [];
    const callTool: ReturnType<GhidraProviderClientFactory>["callTool"] = (
      operation,
      input,
      options,
    ) => {
      toolCalls.push({ operation, input, options });
      return Promise.resolve(
        ok([
          {
            address: "0x1000",
            value: "fixture_main",
            procedure: {
              external: false,
              thunk: false,
              thunk_target: null,
            },
          },
        ]),
      );
    };
    const clientFactory: GhidraProviderClientFactory = (options) => {
      factoryOptions.push(options);
      return {
        start: () => {
          startCount += 1;
          return Promise.resolve(ok(sessionInfo()));
        },
        callTool,
        close: () => Promise.resolve(ok(null)),
      };
    };
    const ghidra = provider(installationHost(), clientFactory);
    const resolved = await ghidra.resolveAnalysisProfile(
      executableTarget("elf", "x86_64"),
    );

    if (!resolved.ok) throw resolved.error;
    if (resolved.value.profile === null)
      throw new Error("Expected a bound Ghidra profile");
    expect(resolved.value.profile).toMatchObject({
      provider: { id: "ghidra", name: "Ghidra", version: "12.1.4" },
      parameters: {
        import_mode: "ephemeral-source-immutable",
        annotation_policy: "atomic-function-entry-metadata-v1",
        analyzer_preset: "ghidra-default",
      },
    });
    expect(resolved.value.profile.parameters).toMatchObject({
      language_id: "auto-from-header",
      compiler_spec_id: "auto-default",
      call_relationship_coverage: "function-body-call-coverage-v5",
      function_dossier_coverage: "observed-facets-and-call-relationships-v1",
    });

    const result = await ghidra
      .createClient(executableTarget("elf", "x86_64"), resolved.value.profile, {
        runId: "11111111-1111-4111-8111-111111111111",
      })
      .execute("list_procedures", {});
    expect(factoryOptions).toEqual([
      expect.objectContaining({
        runId: "11111111-1111-4111-8111-111111111111",
        platform: "linux",
        launcher: expect.objectContaining({
          options: expect.objectContaining({
            javaVmName: "OpenJDK 64-Bit Server VM",
          }),
        }),
      }),
    ]);
    expect(toolCalls).toEqual([
      {
        operation: "list_procedures",
        input: { document: null },
        options: { decompileTimeoutSeconds: null },
      },
    ]);
    expect(result).toMatchObject({
      ok: true,
      value: {
        provider: {
          id: "ghidra",
          name: "Ghidra",
          version: "12.1.4",
        },
        analysisProfile: resolved.value.profile,
        result: [{ address: "0x1000", value: "fixture_main" }],
        rawResult: null,
      },
    });
    expect(startCount).toBe(0);
  });
});

describe("Ghidra result projection", () => {
  it("rejects malformed inventory output before Evidence creation", async () => {
    const ghidra = provider(installationHost(), () => ({
      start: () => Promise.resolve(ok(sessionInfo())),
      callTool: () => Promise.resolve(ok({ items: "not-an-inventory" })),
      close: () => Promise.resolve(ok(null)),
    }));
    const client = await createElfClient(ghidra);
    await expect(client.execute("list_procedures", {})).resolves.toMatchObject({
      ok: false,
      error: { _tag: "AnalysisOutputError" },
    });
  });

  it("projects terminal-call facts from the function bridge into execution limitations", async () => {
    const limitation =
      "Ghidra Listing reports a terminal call at 0x401020 to 0x7f001000 __tls_get_addr (external=true, thunk=false, hasNoReturn=true); fallthrough is excluded by Ghidra's flow model. This records Ghidra's FunctionManager flag, not an independent verification that the callee cannot return.";
    const ghidra = provider(installationHost(), () => ({
      start: () => Promise.resolve(ok(sessionInfo())),
      callTool: () =>
        Promise.resolve(
          ok({ value: "void main() {}", limitations: [limitation] }),
        ),
      close: () => Promise.resolve(ok(null)),
    }));
    const client = await createElfClient(ghidra);
    const execution = await client.execute("procedure_pseudo_code", {
      procedure: "main",
    });
    if (!execution.ok) throw execution.error;
    expect(execution.value.result).toBe("void main() {}");
    expect(execution.value.limitations).toContain(limitation);
    expect(execution.value.rawResult).toBeNull();
    await client.close();
  });

  it.each([
    ["invalid_request", "AnalysisInputError"],
    ["not_found", "AnalysisInputError"],
    ["ambiguous", "AnalysisInputError"],
    ["method_unavailable", "AnalysisCapabilityUnavailableError"],
  ] as const)(
    "projects remote %s without losing its typed meaning",
    async (code, tag) => {
      const ghidra = provider(installationHost(), () => ({
        start: () => Promise.resolve(ok(sessionInfo())),
        callTool: () =>
          Promise.resolve(
            err(
              new GhidraSessionError(
                "remote",
                "Fixture remote failure",
                { remote_code: code },
                { remoteCode: code },
              ),
            ),
          ),
        close: () => Promise.resolve(ok(null)),
      }));
      const client = await createElfClient(ghidra);
      await expect(
        client.execute("list_procedures", {}),
      ).resolves.toMatchObject({
        ok: false,
        error: { _tag: tag },
      });
    },
  );

  it("preserves the rejected name constraint and function address", async () => {
    const message =
      "Invalid function name at 0x10100: Symbol name contains invalid characters";
    const ghidra = provider(installationHost(), () => ({
      start: () => Promise.resolve(ok(sessionInfo())),
      callTool: () =>
        Promise.resolve(
          err(
            new GhidraSessionError(
              "remote",
              message,
              {},
              { remoteCode: "invalid_function_name" },
            ),
          ),
        ),
      close: () => Promise.resolve(ok(null)),
    }));
    const client = await createElfClient(ghidra);
    await expect(
      client.execute("annotate_native_function", {
        procedure: "0x10100",
        name: "bad name",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisInputError",
        issues: [{ path: ["name"], reason: "invalid_value", message }],
      },
    });
  });

  it("projects remote decompile cancellation as a provider-neutral interruption", async () => {
    const code = "decompile_cancelled";
    const tag = "AnalysisCancelledError";
    const ghidra = provider(installationHost(), () => ({
      start: () => Promise.resolve(ok(sessionInfo())),
      callTool: () =>
        Promise.resolve(
          err(
            new GhidraSessionError(
              "remote",
              "Fixture decompiler interruption",
              { remote_code: code },
              { remoteCode: code },
            ),
          ),
        ),
      close: () => Promise.resolve(ok(null)),
    }));
    const client = await createElfClient(ghidra);
    const result = await client.execute("procedure_pseudo_code", {
      procedure: "main",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: tag },
    });
    if (!result.ok)
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "cancelled",
        details: { diagnostics: { remote_code: code } },
      });
  });

  it("returns cancellation before profile work", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider().resolveAnalysisProfile(executableTarget("elf", "x86_64"), {
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError", operation: "open_binary" },
    });
  });
});

describe("Ghidra file-offset outcome projection", () => {
  const remoteFailure = (remoteCode: string, message: string) =>
    provider(installationHost(), () => ({
      start: () => Promise.resolve(ok(sessionInfo())),
      callTool: () =>
        Promise.resolve(
          err(
            new GhidraSessionError(
              "remote",
              message,
              { remote_code: remoteCode },
              { remoteCode },
            ),
          ),
        ),
      close: () => Promise.resolve(ok(null)),
    }));

  it.each([
    [
      "address_unmapped",
      "unmapped",
      "Address 0x403030 is outside every Ghidra memory block",
    ],
    [
      "address_uninitialized",
      "uninitialized",
      "Address 0x403010 is in uninitialized Ghidra memory block .bss",
    ],
    [
      "file_mapping_absent",
      "absent",
      "Address 0x403010 in initialized Ghidra memory block auxiliary has no authoritative mapping to the admitted target file",
    ],
    [
      "file_mapping_ambiguous",
      "ambiguous",
      "Address 0x403010 has 2 authoritative mappings to the admitted target file",
    ],
    [
      "file_offset_unrepresentable",
      "unrepresentable",
      "Address 0x403010 maps to an admitted target-file offset beyond the exact JSON integer range",
    ],
  ] as const)(
    "reports %s as a conforming address without an exact offset",
    async (remoteCode, outcome, message) => {
      const client = await createElfClient(remoteFailure(remoteCode, message));
      // A non-canonical spelling the bridge accepts survives verbatim.
      const result = await client.execute("address_to_file_offset", {
        address: "0X00403010",
      });
      if (result.ok) throw new Error("Expected a file-offset outcome");
      const projected = projectAnalysisError(result.error);
      expect(projected).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
        retryable: false,
        details: {
          operation: "address_to_file_offset",
          issues: [
            {
              path: ["address"],
              reason: "invalid_value",
              message,
              observed: { address: "0X00403010", file_mapping: outcome },
            },
          ],
          diagnostics: { remote_code: remoteCode },
        },
      });
      expect(projected.message.startsWith(`${message}. `)).toBe(true);
      expect(projected.message).not.toContain("Analysis input is invalid");
      expect(projected).not.toHaveProperty("recovery");
      expect(projected.remediation.action).toContain(
        "inspect_native_load_image",
      );
      expect(projected.remediation.action).not.toContain("schema");
      expect(projected.remediation.action).not.toContain("tools/list");
      await client.close();
    },
  );

  it.each([
    ["address_to_file_offset", "invalid_request"],
    ["procedure_pseudo_code", "not_found"],
  ] as const)(
    "keeps schema recovery for an ordinary %s %s refusal",
    async (operation, remoteCode) => {
      const client = await createElfClient(
        remoteFailure(remoteCode, "Fixture bridge rejected the request"),
      );
      const result = await client.execute(
        operation,
        operation === "address_to_file_offset"
          ? { address: "0x403010" }
          : { procedure: "missing" },
      );
      if (result.ok) throw new Error("Expected an input refusal");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "invalid_request",
        message:
          "Analysis input is invalid. Check the arguments and try again.",
        recovery: { kind: "inspect_input_contract", operation },
        details: {
          issues: [
            { path: [], message: "Fixture bridge rejected the request" },
          ],
        },
      });
      await client.close();
    },
  );
});

describe("Ghidra decompiler failure projection", () => {
  it("reports a procedure decompiler failure without blaming the environment", async () => {
    const code = "decompile_failed";
    const message =
      "Ghidra decompilation failed: Low-level Error: Fixture decompiler failure";
    const ghidra = provider(installationHost(), () => ({
      start: () => Promise.resolve(ok(sessionInfo())),
      callTool: () =>
        Promise.resolve(
          err(
            new GhidraSessionError(
              "remote",
              message,
              { remote_code: code },
              { remoteCode: code },
            ),
          ),
        ),
      close: () => Promise.resolve(ok(null)),
    }));
    const client = await createElfClient(ghidra);
    const result = await client.execute("procedure_pseudo_code", {
      procedure: "main",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "ProviderAdapterError" },
    });
    if (!result.ok) {
      const projected = projectAnalysisError(result.error);
      expect(projected).toMatchObject({
        code: "execution_failure",
        retryable: false,
        message: `${message}. Only the decompiler failed for this procedure; the Ghidra session remains usable.`,
        details: { diagnostics: { remote_code: code } },
      });
      expect(projected.message).not.toContain("rea doctor");
      expect(projected.remediation.action).toContain("analyze_function");
      expect(projected.remediation.action).toContain(
        "facet_availability.pseudocode",
      );
      expect(projected.remediation.action).not.toContain("rea doctor");
    }
  });

  it("reports one procedure's decompile limit as a request timeout", async () => {
    const code = "decompile_timed_out";
    const message =
      "Ghidra decompilation of 0x401000 exceeded the 5-second configured decompilation limit (ghidra.decompile_timeout_seconds; launch seed REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS)";
    const ghidra = provider(
      installationHost(),
      () => ({
        start: () => Promise.resolve(ok(sessionInfo())),
        callTool: () =>
          Promise.resolve(
            err(
              new GhidraSessionError(
                "remote",
                message,
                { remote_code: code },
                { remoteCode: code },
              ),
            ),
          ),
        close: () => Promise.resolve(ok(null)),
      }),
      { REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS: "5" },
    );
    const client = await createElfClient(ghidra);
    const result = await client.execute("procedure_pseudo_code", {
      procedure: "main",
    });
    // Not a ProviderAdapterError: BinarySession keeps other Ghidra
    // operations available after a request-level timeout.
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisTimeoutError", timeoutMs: 5000 },
    });
    if (!result.ok) {
      const projected = projectAnalysisError(result.error);
      expect(projected).toMatchObject({
        code: "provider_timeout",
        retryable: true,
        message: `${message}. Only this procedure's decompilation was stopped; the Ghidra session remains usable.`,
        recovery: { kind: "inspect_timeout_state", timeout_ms: 5000 },
        details: { diagnostics: { remote_code: code } },
      });
      const action = projected.remediation.action;
      expect(action).toContain("analyze_function");
      expect(action).toContain("REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS");
      expect(action).toContain("tool-call deadline");
      expect(action).toContain("new Codex/Kimi registrations");
      expect(action).toContain("preserves existing positive values");
      expect(action).toContain("edit existing deadlines yourself");
      expect(action).not.toContain("rea doctor");
    }
  });
});

describe("Ghidra failures during cancellation cleanup", () => {
  it.each(
    [
      {
        remoteCode: "decompile_failed",
        projectedCode: "execution_failure",
        message: "Ghidra decompilation failed: Injected backend failure",
      },
      {
        remoteCode: "decompile_timed_out",
        projectedCode: "provider_timeout",
        message:
          "Ghidra decompilation of 0x401000 exceeded the 5-second configured decompilation limit (ghidra.decompile_timeout_seconds; launch seed REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS)",
      },
      {
        remoteCode: "regex_stack_exhausted",
        projectedCode: "resource_constraint",
        message:
          "Ghidra's Java regex engine exhausted its stack while matching pattern (a+)+$.",
      },
    ].flatMap((entry) => [
      { ...entry, cancelled: false, cleanupFailed: false },
      { ...entry, cancelled: true, cleanupFailed: false },
      { ...entry, cancelled: true, cleanupFailed: true },
    ]),
  )(
    "reports observed session state for $remoteCode (cancelled: $cancelled, cleanup failed: $cleanupFailed)",
    async ({
      remoteCode,
      projectedCode,
      message,
      cancelled,
      cleanupFailed,
    }) => {
      const cleanup = new ProviderCleanupError("ghidra", ["owned session"], {
        reason: "Fixture cleanup still needs retry",
      });
      const observed = new GhidraSessionError(
        "remote",
        message,
        { remote_code: remoteCode },
        { remoteCode },
      );
      const remote = cancelled
        ? observed.withConcurrentCancellation({ reason: "client deadline" })
        : observed;
      const ghidra = provider(
        installationHost(),
        () => ({
          start: () => Promise.resolve(ok(sessionInfo())),
          callTool: () =>
            Promise.resolve(
              err(cleanupFailed ? remote.withCleanupFailure(cleanup) : remote),
            ),
          close: () => Promise.resolve(ok(null)),
        }),
        { REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS: "5" },
      );
      const client = await createElfClient(ghidra);
      const result =
        remoteCode === "regex_stack_exhausted"
          ? await client.execute("search_procedures", { pattern: "(a+)+$" })
          : await client.execute("procedure_pseudo_code", {
              procedure: "main",
            });
      if (result.ok) throw new Error("Expected the observed remote failure");
      const projected = projectAnalysisError(result.error);
      expect(projected.code).toBe(
        cleanupFailed ? "cleanup_incomplete" : projectedCode,
      );
      expect(projected.message).toContain(message);
      if (!cancelled) {
        expect(projected.message).toContain(
          remoteCode === "regex_stack_exhausted"
            ? "remain available"
            : "remains usable",
        );
        expect(projected.remediation.action).not.toContain("remain available");
        return;
      }
      const explanation = JSON.stringify(projected);
      expect(explanation).not.toContain("remains usable");
      expect(explanation).not.toContain("remain available");
      expect(explanation).toContain(
        cleanupFailed
          ? "retry retained cleanup"
          : "REA closed the Ghidra session",
      );
      if (cleanupFailed) {
        expect(explanation).not.toContain(
          "the next request starts a new session",
        );
        expect(result.error).toMatchObject({ cleanupIncomplete: true });
      }
      expect(projected.details).toMatchObject({
        diagnostics: cleanupFailed
          ? {
              primary_error: {
                code: projectedCode,
                details: {
                  diagnostics: { session_closed_by_cancellation: true },
                },
              },
            }
          : { session_closed_by_cancellation: true },
      });
    },
  );
});

describe("Ghidra PE CodeView debug symbol limitations", () => {
  it.each([
    ["absent report", undefined, "load state unknown"],
    ["unknown load", null, "load state unknown"],
    ["not loaded", false, "reports not loaded"],
    ["loaded", true, "reports a loaded PDB"],
  ] as const)(
    "preserves %s in operation and health Evidence without duplicate caveats",
    async (_, loaded, expected) => {
      const ghidra = provider(installationHost(), () => ({
        start: () =>
          Promise.resolve(
            ok({
              ...sessionInfo(),
              ...(loaded === undefined
                ? {}
                : {
                    pdb: {
                      file: "test.pdb",
                      guid: "01234567-89ab-cdef-0123-456789abcdef",
                      age: "1",
                      signature: null,
                      version: "RSDS",
                      loaded,
                    },
                  }),
            }),
          ),
        callTool: () => Promise.resolve(ok([])),
        close: () => Promise.resolve(ok(null)),
      }));
      const target = {
        ...peTarget("x86_64"),
        codeView: {
          pdbPath: "test.pdb",
          pdbFileName: "test.pdb",
          guid: "01234567-89ab-cdef-0123-456789abcdef",
          age: 1,
        },
      };
      const profile = await ghidra.resolveAnalysisProfile(target);
      if (!profile.ok || profile.value.profile === null)
        throw new Error("expected PE profile");
      const client = ghidra.createClient(target, profile.value.profile);
      try {
        const search = await client.execute("search_procedures", {
          pattern: "add_numbers",
        });
        if (!search.ok) throw search.error;
        const health = await client.execute("health", {});
        if (!health.ok) throw health.error;
        for (const observation of [search.value, health.value]) {
          const caveats = observation.limitations.filter((limit) =>
            limit.includes("PDB"),
          );
          expect(caveats).toHaveLength(1);
          expect(caveats[0]).toContain(expected);
          expect(caveats[0]).not.toContain("names are analysis-generated");
          expect(caveats[0]).not.toContain("that were not applied");
        }
      } finally {
        await client.close();
      }
    },
  );
});

describe("Ghidra relationship coverage", () => {
  it("marks the full direct call-reference response complete while keeping static caveats", async () => {
    const ghidra = provider(installationHost(), () => ({
      start: () => Promise.resolve(ok(sessionInfo())),
      callTool: (operation) =>
        Promise.resolve(
          ok(
            operation === "procedure_callees"
              ? {
                  value: ["0x2000"],
                  limitations: [],
                  relationship_coverage: {
                    status: "complete",
                    diagnostics: [
                      "Only resolved Ghidra call references are returned; unresolved computed or indirect calls remain unknown, while function classifications distinguish thunks and externals.",
                    ],
                  },
                }
              : { value: [], limitations: [] },
          ),
        ),
      close: () => Promise.resolve(ok(null)),
    }));
    const client = await createElfClient(ghidra);
    const execution = await client.execute("procedure_callees", {
      procedure: "0x1000",
      document: "fixture",
    });
    if (!execution.ok) throw execution.error;
    expect(execution.value.relationshipCoverage).toEqual({
      status: "complete",
      diagnostics: [
        "Only resolved Ghidra call references are returned; unresolved computed or indirect calls remain unknown, while function classifications distinguish thunks and externals.",
      ],
    });
    expect(execution.value.limitations).not.toContain(
      "Only resolved Ghidra call references are returned; unresolved computed or indirect calls remain unknown, while function classifications distinguish thunks and externals.",
    );
    await client.close();
  });
});

describe("Ghidra measured raw load-image projection", () => {
  it.each([
    "verified",
    "mapping-mismatch",
    "changed-snapshot",
    "cancelled",
    "malformed-coordinate",
  ] as const)(
    "streams raw snapshot identity and preserves %s outcomes",
    async (state) => {
      const fixture = fixtureRawBinaryLoadImage();
      if (state === "malformed-coordinate")
        fixture.observation.image_base = "not-an-address";
      if (state === "mapping-mismatch") {
        const mapping = fixture.observation.mappings[0];
        if (mapping === undefined)
          throw new Error("Missing source mapping fixture");
        mapping.overlay = true;
      }
      const controller = new AbortController();
      const signals: (AbortSignal | undefined)[] = [];
      const ghidra = provider(installationHost(), () => ({
        start: () => Promise.resolve(ok(sessionInfo())),
        callTool: (operation) => {
          if (operation !== "inspect_native_load_image")
            throw new Error(`unexpected operation ${operation}`);
          return Promise.resolve(
            ok(jsonValueSchema.parse(fixture.observation)),
          );
        },
        readTargetSnapshot: () => {
          throw new Error(
            "raw verification must not capture the complete file",
          );
        },
        hashTargetSnapshot: (signal) => {
          signals.push(signal);
          if (state === "cancelled") {
            controller.abort();
            return Promise.resolve(
              err(
                new GhidraSessionError(
                  "cancelled",
                  "Snapshot hashing cancelled",
                ),
              ),
            );
          }
          return Promise.resolve(
            ok({
              ...fixture.snapshot,
              ...(state === "changed-snapshot"
                ? { sha256: "f".repeat(64) }
                : {}),
            }),
          );
        },
        close: () => Promise.resolve(ok(null)),
      }));
      const resolved = await ghidra.resolveAnalysisProfile(fixture.target);
      if (!resolved.ok) throw resolved.error;
      if (resolved.value.profile === null)
        throw new Error("expected raw profile");
      const client = ghidra.createClient(
        fixture.target,
        resolved.value.profile,
      );
      try {
        const result = await client.execute(
          "inspect_native_load_image",
          {},
          { signal: controller.signal },
        );
        expect(signals).toEqual(
          state === "malformed-coordinate" ? [] : [controller.signal],
        );
        if (state === "verified" || state === "mapping-mismatch") {
          if (!result.ok) throw result.error;
          expect(result.value.result).toMatchObject({
            status: state === "verified" ? "verified" : "mismatch",
            observations: fixture.observation,
          });
          if (state === "mapping-mismatch") {
            expect(result.value.result).toMatchObject({
              checks: expect.arrayContaining([
                expect.objectContaining({
                  name: "mapping.overlay",
                  observed: true,
                  matched: false,
                }),
              ]),
            });
          }
        } else {
          expect(result).toMatchObject({
            ok: false,
            error: {
              _tag:
                state === "cancelled"
                  ? "AnalysisCancelledError"
                  : state === "malformed-coordinate"
                    ? "AnalysisOutputError"
                    : "ProviderAdapterError",
            },
          });
        }
      } finally {
        await client.close();
      }
    },
  );
});

describe("Ghidra measured DOS load-image projection", () => {
  it.each([
    "verified",
    "mismatch",
    "changed-snapshot",
    "unsupported",
    "missing-snapshot",
  ] as const)(
    "preserves %s state and producing observations",
    async (state) => {
      const fixture = fixtureDosLoadImage();
      if (state === "mismatch") fixture.observation.entry_points = ["0x10001"];
      if (state === "changed-snapshot") fixture.bytes[0] = 0;
      const factory: GhidraProviderClientFactory = () => ({
        start: () => Promise.resolve(ok(sessionInfo())),
        callTool: () =>
          Promise.resolve(ok(jsonValueSchema.parse(fixture.observation))),
        close: () => Promise.resolve(ok(null)),
        ...(state === "missing-snapshot"
          ? {}
          : {
              attestDosTargetSnapshot: async (observations) =>
                compareDosClientFixture(
                  fixture.bytes,
                  fixture.sha256,
                  observations,
                ),
            }),
      });
      const ghidra = provider(installationHost(), factory);
      const target: BinaryTarget = {
        path: "/tmp/source-owned-fixture.exe",
        sha256: fixture.sha256,
        kind: "executable",
        format: state === "unsupported" ? "elf" : "dos-mz",
        architecture: "x86",
        availableArchitectures: ["x86"],
      };
      const profile = await ghidra.resolveAnalysisProfile(target);
      if (!profile.ok || profile.value.profile === null)
        throw new Error("Expected admitted profile");
      const result = await ghidra
        .createClient(target, profile.value.profile)
        .execute("inspect_native_load_image", {});
      if (state === "changed-snapshot" || state === "missing-snapshot") {
        expect(result).toMatchObject({
          ok: false,
          error: {
            _tag: "ProviderAdapterError",
            diagnostics: { reason: expect.stringContaining("snapshot") },
          },
        });
      } else {
        expect(result).toMatchObject({
          ok: true,
          value: {
            result: { status: state, observations: fixture.observation },
            rawResult: null,
            analysisProfile: profile.value.profile,
          },
        });
      }
    },
  );
});

const unavailableNativeAotDatabaseType = (address: string | null) => ({
  status: "unavailable",
  reason:
    "No exact database type or defined typed data exists at the selected identity",
  id: null,
  name: null,
  kind: "unavailable",
  source: "analysis-database",
  source_archive: null,
  address,
  size_bytes: null,
  alignment_bytes: null,
  packing_enabled: null,
  referenced_type: null,
  array_count: null,
  array_stride_bytes: null,
  fields: [],
  members: [],
  total_fields: 0,
  truncated: false,
  limitations: [],
});

it("returns read-only NativeAOT metadata inline and drills down by derived MethodTable address", async () => {
  const bytes = nativeAotPeFixture();
  const readSnapshot = vi.fn(async () =>
    ok({ kind: "captured" as const, bytes }),
  );
  const observations = fixtureDosLoadImage().observation;
  observations.image_base = "0x140000000";
  const factory: GhidraProviderClientFactory = () => ({
    start: () =>
      Promise.resolve(
        ok({
          ...sessionInfo(),
          target: { ...sessionInfo().target, image_base: "0x140000000" },
        }),
      ),
    callTool: (operation) =>
      Promise.resolve(
        ok(
          jsonValueSchema.parse(
            operation === "inspect_native_load_image"
              ? observations
              : unavailableNativeAotDatabaseType("0x140002280"),
          ),
        ),
      ),
    readTargetSnapshot: readSnapshot,
    close: () => Promise.resolve(ok(null)),
  });
  const ghidra = provider(installationHost(), factory);
  const target = { ...peTarget("x86_64"), sha256: nativeAotPeDigest(bytes) };
  const profile = await ghidra.resolveAnalysisProfile(target);
  if (!profile.ok || profile.value.profile === null)
    throw new Error("Expected admitted PE profile");
  const client = ghidra.createClient(target, profile.value.profile);
  const image = await client.execute("inspect_native_load_image", {});
  expect(image).toMatchObject({
    ok: true,
    value: {
      result: {
        status: "unsupported",
        observations: {
          metadata_recovery: [
            {
              status: "complete",
              analysis_mode: "read-only-derived-overlay",
              method_tables: 3,
              frozen_strings: [{ value: "REA_NATIVEAOT_FROZEN" }],
            },
          ],
        },
      },
      rawResult: null,
    },
  });
  for (const address of [
    "0x140002280",
    "140002280",
    "ram:0x140002280",
    "%72am:0x140002280",
    "0X0140002280",
  ]) {
    const detail = await client.execute("inspect_native_data_type", {
      address,
    });
    expect(detail).toMatchObject({
      ok: true,
      value: {
        rawResult: unavailableNativeAotDatabaseType("0x140002280"),
        result: {
          status: "unavailable",
          source: "analysis-database",
          metadata_recovery: {
            source: "read-only-derived-overlay",
            method_table_address: "0x140002280",
            related_type: { address: "0x140002200", type: null },
          },
        },
      },
    });
  }
  expect(readSnapshot).toHaveBeenCalledOnce();
  await client.close();
});

it.each([
  ["0x140002280", "0x140002280", "0x140002280"],
  ["140002280", "0x140002280", "0x140002280"],
  ["ram:0x140002280", "0x140002280", "0x140002280"],
  ["%72am:0x140002280", "0x140002280", "0x140002280"],
  ["0X0140002280", "0x140002280", "0x140002280"],
  ["0x140002280", "0x140002200", "0x140002200"],
  ["0x140002280", null, null],
  ["0x140002280", "register:0x140002280", null],
  ["0x140002280", "overlay%3Aspace:0x140002280", null],
  ["0x140002280", "0x140002288", null],
  ["register:0x140002280", "register:0x140002280", null],
] as const)(
  "looks up NativeAOT type %s using resolved identity %s",
  async (address, resolvedAddress, expectedTable) => {
    const bytes = nativeAotPeFixture();
    const operations: string[] = [];
    const callerAddresses: unknown[] = [];
    const readSnapshot = vi.fn(async () =>
      ok({ kind: "captured" as const, bytes }),
    );
    const factory: GhidraProviderClientFactory = () => ({
      start: () =>
        Promise.resolve(
          ok({
            ...sessionInfo(),
            target: { ...sessionInfo().target, image_base: "0x140000000" },
          }),
        ),
      callTool: (operation, parameters) => {
        operations.push(operation);
        callerAddresses.push(parameters.address);
        return Promise.resolve(
          ok(
            jsonValueSchema.parse(
              unavailableNativeAotDatabaseType(resolvedAddress),
            ),
          ),
        );
      },
      readTargetSnapshot: readSnapshot,
      close: () => Promise.resolve(ok(null)),
    });
    const ghidra = provider(installationHost(), factory);
    const target = { ...peTarget("x86_64"), sha256: nativeAotPeDigest(bytes) };
    const profile = await ghidra.resolveAnalysisProfile(target);
    if (!profile.ok || profile.value.profile === null)
      throw new Error("Expected admitted PE profile");
    const client = ghidra.createClient(target, profile.value.profile);
    const detail = await client.execute("inspect_native_data_type", {
      address,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) throw detail.error;
    expect(detail.value.result).toMatchObject({ address: resolvedAddress });
    if (expectedTable === null) {
      expect(detail.value.result).not.toHaveProperty("metadata_recovery");
    } else {
      expect(detail.value.result).toMatchObject({
        metadata_recovery: {
          source: "read-only-derived-overlay",
          method_table_address: expectedTable,
        },
      });
    }
    expect(callerAddresses).toEqual([address]);
    expect(readSnapshot).toHaveBeenCalledTimes(
      resolvedAddress === null ? 0 : 1,
    );
    expect(operations).toEqual(["inspect_native_data_type"]);
    await client.close();
  },
);

it("retains engine-provided NativeAOT metadata without deriving another snapshot", async () => {
  const bytes = nativeAotPeFixture();
  const metadata = {
    format: "dotnet-nativeaot",
    source: "analysis-database",
    status: "partial",
    header_address: "0x140002000",
    format_major: 9,
    format_minor: 1,
    method_table_address: "0x140002280",
    name_origin: "generated",
    original_name: null,
    base_size_bytes: 32,
    related_type: null,
    interfaces: [],
    virtual_slots: [],
    derived_memory: null,
    diagnostics: ["Engine-provided fixture metadata"],
    limitations: ["Fixture has no original managed names"],
  };
  const readSnapshot = vi.fn(async () => {
    throw new Error("Unexpected source snapshot read");
  });
  const factory: GhidraProviderClientFactory = () => ({
    start: async () =>
      ok({
        ...sessionInfo(),
        target: { ...sessionInfo().target, image_base: "0x140000000" },
      }),
    callTool: async () =>
      ok(
        jsonValueSchema.parse({
          ...unavailableNativeAotDatabaseType("0x140002280"),
          status: "available",
          reason: null,
          id: "/NativeAOT/Example_MT",
          name: "Example_MT",
          kind: "struct",
          size_bytes: 32,
          alignment_bytes: 8,
          packing_enabled: false,
          metadata_recovery: metadata,
        }),
      ),
    readTargetSnapshot: readSnapshot,
    close: async () => ok(null),
  });
  const ghidra = provider(installationHost(), factory);
  const target = { ...peTarget("x86_64"), sha256: nativeAotPeDigest(bytes) };
  const profile = await ghidra.resolveAnalysisProfile(target);
  if (!profile.ok || profile.value.profile === null)
    throw new Error("Expected admitted PE profile");
  const client = ghidra.createClient(target, profile.value.profile);
  const detail = await client.execute("inspect_native_data_type", {
    address: "0x140002280",
  });
  expect(detail).toMatchObject({
    ok: true,
    value: { result: { status: "available", metadata_recovery: metadata } },
  });
  expect(readSnapshot).not.toHaveBeenCalled();
  await client.close();
});

it("shares one session snapshot across callers while isolating cancellation and rejecting a changed base", async () => {
  const bytes = nativeAotPeFixture();
  const baseObservation = fixtureDosLoadImage().observation;
  baseObservation.image_base = "0x140000000";
  let calls = 0;
  let snapshotReads = 0;
  let snapshotSignal: AbortSignal | undefined;
  let releaseSnapshot:
    | ((value: Result<GhidraTargetSnapshot, GhidraSessionError>) => void)
    | undefined;
  let markSnapshotStarted: (() => void) | undefined;
  const snapshotStarted = new Promise<void>((resolve) => {
    markSnapshotStarted = resolve;
  });
  const snapshotResult = new Promise<
    Result<GhidraTargetSnapshot, GhidraSessionError>
  >((resolve) => {
    releaseSnapshot = resolve;
  });
  const factory: GhidraProviderClientFactory = () => ({
    start: () => Promise.resolve(ok(sessionInfo())),
    callTool: (operation) => {
      calls += 1;
      const observation = {
        ...baseObservation,
        source_files: [
          { ...baseObservation.source_files[0]!, name: `caller-${calls}` },
        ],
      };
      return Promise.resolve(
        ok(
          jsonValueSchema.parse(
            operation === "inspect_native_load_image"
              ? observation
              : unavailableNativeAotDatabaseType("0x140002280"),
          ),
        ),
      );
    },
    readTargetSnapshot: (_maximumBytes, signal) => {
      snapshotReads += 1;
      snapshotSignal = signal;
      markSnapshotStarted?.();
      return snapshotResult;
    },
    close: () => Promise.resolve(ok(null)),
  });
  const ghidra = provider(installationHost(), factory);
  const target = { ...peTarget("x86_64"), sha256: nativeAotPeDigest(bytes) };
  const profile = await ghidra.resolveAnalysisProfile(target);
  if (!profile.ok || profile.value.profile === null)
    throw new Error("Expected admitted PE profile");
  const client = ghidra.createClient(target, profile.value.profile);
  const firstCaller = new AbortController();
  const secondCaller = new AbortController();
  const first = client.execute(
    "inspect_native_load_image",
    {},
    {
      signal: firstCaller.signal,
    },
  );
  const second = client.execute(
    "inspect_native_load_image",
    {},
    {
      signal: secondCaller.signal,
    },
  );
  await snapshotStarted;
  expect(snapshotReads).toBe(1);
  expect(snapshotSignal).toBeDefined();
  expect(snapshotSignal).not.toBe(firstCaller.signal);
  expect(snapshotSignal).not.toBe(secondCaller.signal);
  firstCaller.abort();
  await expect(first).resolves.toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  releaseSnapshot?.(ok({ kind: "captured", bytes }));
  const secondResult = await second;
  expect(secondResult).toMatchObject({
    ok: true,
    value: {
      rawResult: null,
      result: {
        observations: {
          source_files: [{ name: "caller-2" }],
        },
      },
    },
  });
  expect(snapshotReads).toBe(1);
  expect(calls).toBe(2);

  baseObservation.image_base = "0x150000000";
  const conflictingBase = await client.execute("inspect_native_load_image", {});
  expect(conflictingBase).toMatchObject({
    ok: false,
    error: {
      _tag: "ProviderAdapterError",
      diagnostics: {
        reason: expect.stringContaining("different loaded image base"),
      },
    },
  });
  expect(snapshotReads).toBe(1);
  await client.close();
  // The completed producer needs no stop; active-close joining is covered below.
  expect(snapshotSignal?.aborted).toBe(false);
});

it("retries a failed NativeAOT snapshot read without retaining a failed derivation", async () => {
  const bytes = nativeAotPeFixture();
  const observations = fixtureDosLoadImage().observation;
  observations.image_base = "0x140000000";
  let snapshotReads = 0;
  const factory: GhidraProviderClientFactory = () => ({
    start: () => Promise.resolve(ok(sessionInfo())),
    callTool: () => Promise.resolve(ok(jsonValueSchema.parse(observations))),
    readTargetSnapshot: () => {
      snapshotReads += 1;
      return Promise.resolve(
        snapshotReads === 1
          ? err(
              new GhidraSessionError(
                "process",
                "temporary snapshot read failure",
              ),
            )
          : ok({ kind: "captured", bytes }),
      );
    },
    close: () => Promise.resolve(ok(null)),
  });
  const ghidra = provider(installationHost(), factory);
  const target = { ...peTarget("x86_64"), sha256: nativeAotPeDigest(bytes) };
  const profile = await ghidra.resolveAnalysisProfile(target);
  if (!profile.ok || profile.value.profile === null)
    throw new Error("Expected admitted PE profile");
  const client = ghidra.createClient(target, profile.value.profile);
  await expect(
    client.execute("inspect_native_load_image", {}),
  ).resolves.toMatchObject({
    ok: false,
    error: { _tag: "ProviderAdapterError" },
  });
  await expect(
    client.execute("inspect_native_load_image", {}),
  ).resolves.toMatchObject({
    ok: true,
    value: {
      result: {
        observations: {
          metadata_recovery: [{ status: "complete" }],
        },
      },
    },
  });
  expect(snapshotReads).toBe(2);
  await client.close();
});

it.each(["captured", "cancelled-with-facts"] as const)(
  "rejects all waiters when the loaded image base changes during derivation (%s)",
  async (outcome) => {
    const bytes = nativeAotPeFixture();
    const observation = fixtureDosLoadImage().observation;
    let calls = 0;
    let resolveSnapshot:
      | ((value: Result<GhidraTargetSnapshot, GhidraSessionError>) => void)
      | undefined;
    let markSnapshotStarted: (() => void) | undefined;
    const snapshotStarted = new Promise<void>((resolve) => {
      markSnapshotStarted = resolve;
    });
    const snapshot = new Promise<
      Result<GhidraTargetSnapshot, GhidraSessionError>
    >((resolve) => {
      resolveSnapshot = resolve;
    });
    const factory: GhidraProviderClientFactory = () => ({
      start: () => Promise.resolve(ok(sessionInfo())),
      callTool: () => {
        calls += 1;
        return Promise.resolve(
          ok(
            jsonValueSchema.parse({
              ...observation,
              image_base: calls === 1 ? "0x140000000" : "0x150000000",
            }),
          ),
        );
      },
      readTargetSnapshot: () => {
        markSnapshotStarted?.();
        return snapshot;
      },
      close: () => Promise.resolve(ok(null)),
    });
    const ghidra = provider(installationHost(), factory);
    const target = { ...peTarget("x86_64"), sha256: nativeAotPeDigest(bytes) };
    const profile = await ghidra.resolveAnalysisProfile(target);
    if (!profile.ok || profile.value.profile === null)
      throw new Error("Expected admitted PE profile");
    const client = ghidra.createClient(target, profile.value.profile);
    const originalBase = client.execute("inspect_native_load_image", {});
    await snapshotStarted;
    const changedBase = await client.execute("inspect_native_load_image", {});
    expect(changedBase).toMatchObject({
      ok: false,
      error: {
        _tag: "ProviderAdapterError",
        diagnostics: {
          observed_image_base: "0x150000000",
          measured_observation: { image_base: "0x150000000" },
        },
      },
    });
    resolveSnapshot?.(
      outcome === "captured"
        ? ok({ kind: "captured", bytes })
        : err(
            new GhidraSessionError(
              "cancelled",
              "Controlled identity stop",
              {},
              {
                cancellation: { reason: "identity conflict" },
                partialObservation: {
                  kind: "file-snapshot-hash",
                  path: "/controlled/snapshot",
                  sha256: "a".repeat(64),
                  bytes: 17,
                },
              },
            ),
          ),
    );
    const originalResult = await originalBase;
    expect(originalResult).toMatchObject({
      ok: false,
      error: {
        _tag: "ProviderAdapterError",
        diagnostics: {
          reason: expect.stringContaining("conflicting loaded image bases"),
          measured_observation: { image_base: "0x140000000" },
          conflicting_observation: { image_base: "0x150000000" },
        },
      },
    });
    if (outcome === "cancelled-with-facts") {
      expect(originalResult).toMatchObject({
        ok: false,
        error: {
          partialObservation: { kind: "file-snapshot-hash", bytes: 17 },
        },
      });
    }
    expect(calls).toBe(2);
    await client.close();
  },
);

it("preserves the observed NativeAOT snapshot digest with source-change recovery", async () => {
  const bytes = nativeAotPeFixture();
  const expected = "0".repeat(64);
  const owner = new GhidraNativeAotSnapshotOwner({
    targetSha256: expected,
    targetPath: "/fixtures/admitted.exe",
    readSnapshot: async () => ok({ kind: "captured", bytes }),
    projectFailure: () => {
      throw new Error("Identity mismatch must retain source-change recovery");
    },
  });
  try {
    const result = await owner.derive(
      "0x140000000",
      "inspect_native_load_image",
      undefined,
      {},
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      _tag: "AnalysisArtifactChangedError",
      path: "/fixtures/admitted.exe",
      diagnostics: {
        expected_sha256: expected,
        observed_sha256: nativeAotPeDigest(bytes),
      },
      partialObservation: {
        kind: "native-aot-snapshot",
        analysis_artifact_sha256: expected,
        capture: { status: "captured", bytes: bytes.length },
      },
    });
  } finally {
    await owner.close();
  }
});

it("preserves NativeAOT source facts and cleanup when a later caller contradicts identity", async () => {
  const partial = {
    kind: "file-snapshot-hash" as const,
    path: "/controlled/snapshot",
    sha256: "a".repeat(64),
    bytes: 17,
  };
  const cleanup = new ProviderCleanupError("ghidra", [partial.path], {
    reason: "controlled close failure",
  });
  const lease = new AnalysisCleanupLease(async () => {}, [partial.path]);
  lease.bindCleanupError(cleanup);
  onTestFinished(() => lease.release());
  const owner = new GhidraNativeAotSnapshotOwner({
    targetSha256: partial.sha256,
    targetPath: partial.path,
    readSnapshot: async () =>
      err(
        new GhidraSessionError(
          "protocol",
          "Controlled snapshot failure",
          {},
          { partialObservation: partial },
        ).withCleanupFailure(cleanup),
      ),
    projectFailure: () => cleanup,
  });
  await owner.derive("0x140000000", "inspect_native_load_image", undefined, {
    image_base: "0x140000000",
  });
  const conflict = await owner.derive(
    "0x150000000",
    "inspect_native_load_image",
    undefined,
    { image_base: "0x150000000" },
  );
  if (conflict.ok) throw new Error("Expected conflicting snapshot identity");
  expect(conflict.error.partialObservation).toEqual(partial);
  expect(conflict.error.cleanupIncomplete).toBe(true);
  await lease.release();
  expect(conflict.error.cleanupIncomplete).toBe(false);
  await owner.close();
});

const nativeAotWaiterClient = async () => {
  const bytes = nativeAotPeFixture();
  const observations = fixtureDosLoadImage().observation;
  observations.image_base = "0x140000000";
  const started = createDeferred<AbortSignal>();
  const snapshot =
    createDeferred<Result<GhidraTargetSnapshot, GhidraSessionError>>();
  const close = vi.fn(async () => ok(null));
  const readSnapshot = vi.fn(
    (_maximum: number | undefined, signal: AbortSignal | undefined) => {
      if (signal === undefined) throw new Error("Missing owned read signal");
      started.resolve(signal);
      return snapshot.promise;
    },
  );
  const factory: GhidraProviderClientFactory = () => ({
    start: async () => ok(sessionInfo()),
    callTool: async (operation) =>
      ok(
        jsonValueSchema.parse(
          operation === "inspect_native_load_image"
            ? observations
            : unavailableNativeAotDatabaseType("0x140002280"),
        ),
      ),
    readTargetSnapshot: readSnapshot,
    close,
  });
  const ghidra = provider(installationHost(), factory);
  const target = { ...peTarget("x86_64"), sha256: nativeAotPeDigest(bytes) };
  const profile = await ghidra.resolveAnalysisProfile(target);
  if (!profile.ok || profile.value.profile === null)
    throw new Error("Expected admitted PE profile");
  const client = ghidra.createClient(target, profile.value.profile);
  onTestFinished(async () => {
    snapshot.resolve(ok({ kind: "captured", bytes }));
    await client.close();
  });
  return { client, bytes, started, snapshot, close, readSnapshot };
};

it("joins the in-flight NativeAOT producer before closing its owning client", async () => {
  const fixture = await nativeAotWaiterClient();
  const pending = fixture.client.execute("inspect_native_load_image", {});
  const signal = await fixture.started.promise;
  let closed = false;
  const closing = fixture.client.close().then((result) => {
    closed = true;
    return result;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(signal.aborted).toBe(true);
  expect(closed).toBe(false);
  expect(fixture.close).not.toHaveBeenCalled();
  fixture.snapshot.resolve(ok({ kind: "captured", bytes: fixture.bytes }));
  await expect(pending).resolves.toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect((await closing).ok).toBe(true);
});

it("joins final NativeAOT waiter cancellation and retains exact producer cleanup", async () => {
  const fixture = await nativeAotWaiterClient();
  const caller = new AbortController();
  const reason = { caller: "final snapshot waiter" };
  let settled = false;
  const pending = fixture.client
    .execute("inspect_native_load_image", {}, { signal: caller.signal })
    .then((result) => {
      settled = true;
      return result;
    });
  const signal = await fixture.started.promise;
  const cleanup = new ProviderCleanupError(
    "ghidra",
    ["controlled snapshot descriptor"],
    { reason: "controlled close failure" },
  );
  const lease = new AnalysisCleanupLease(async () => {}, [
    "controlled snapshot descriptor",
  ]);
  lease.bindCleanupError(cleanup);
  onTestFinished(() => lease.release());
  caller.abort(reason);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(signal.aborted).toBe(true);
  expect(signal.reason).toBe(reason);
  expect(settled).toBe(false);
  fixture.snapshot.resolve(
    err(
      new GhidraSessionError(
        "cancelled",
        "Controlled snapshot cancelled",
        {},
        { cancellation: { reason }, cause: reason },
      ).withCleanupFailure(cleanup),
    ),
  );
  const result = await pending;
  if (result.ok) throw new Error("Expected cancelled snapshot cleanup");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupPrimary?.cause).toBe(reason);
  const refused = await fixture.client.execute("inspect_native_load_image", {});
  expect(refused.ok).toBe(false);
  expect(fixture.readSnapshot).toHaveBeenCalledTimes(1);
  await lease.release();
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(resolvedAnalysisError(result.error).cause).toBe(reason);
});

it.each([null, "caller stopped", new Error("caller stopped")])(
  "preserves final NativeAOT cancellation reason and late capture (%s)",
  async (reason) => {
    const fixture = await nativeAotWaiterClient();
    const caller = new AbortController();
    const pending = fixture.client.execute(
      "inspect_native_load_image",
      {},
      { signal: caller.signal },
    );
    const signal = await fixture.started.promise;
    caller.abort(reason);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
    fixture.snapshot.resolve(ok({ kind: "captured", bytes: fixture.bytes }));
    const cancelled = await pending;
    if (cancelled.ok) throw new Error("Expected final caller cancellation");
    expect(cancelled.error.cause).toBe(reason);
    expect(cancelled.error.partialObservation).toMatchObject({
      kind: "native-aot-snapshot",
      capture: { status: "captured", bytes: fixture.bytes.length },
    });
    const retried = await fixture.client.execute(
      "inspect_native_load_image",
      {},
    );
    expect(retried.ok).toBe(true);
    expect(fixture.readSnapshot).toHaveBeenCalledTimes(2);
    await fixture.client.execute("inspect_native_load_image", {});
    expect(fixture.readSnapshot).toHaveBeenCalledTimes(2);
  },
);

it.each(["caller", "owner"] as const)(
  "preserves NativeAOT physical failure and retained cleanup across %s cancellation",
  async (interruption) => {
    const fixture = await nativeAotWaiterClient();
    const caller = new AbortController();
    const pending = fixture.client.execute(
      "inspect_native_load_image",
      {},
      { signal: caller.signal },
    );
    await fixture.started.promise;
    const cleanup = new ProviderCleanupError(
      "ghidra",
      ["controlled snapshot descriptor"],
      { reason: "controlled close failure" },
    );
    const lease = new AnalysisCleanupLease(async () => {}, [
      "controlled snapshot descriptor",
    ]);
    lease.bindCleanupError(cleanup);
    onTestFinished(() => lease.release());
    const closing =
      interruption === "owner" ? fixture.client.close() : undefined;
    if (interruption === "caller") caller.abort("late caller");
    await new Promise<void>((resolve) => setImmediate(resolve));
    fixture.snapshot.resolve(
      err(
        new GhidraSessionError(
          "protocol",
          "Controlled independent physical failure",
          { physical_failure: "read rejected" },
          {
            partialObservation: {
              kind: "file-snapshot-hash",
              path: "/controlled/snapshot",
              sha256: "a".repeat(64),
              bytes: 17,
            },
          },
        ).withCleanupFailure(cleanup),
      ),
    );
    const result = await pending;
    if (result.ok) throw new Error("Expected retained physical failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        partial_observation: { bytes: 17 },
        diagnostics: { primary_error: { code: "execution_failure" } },
      },
    });
    if (closing !== undefined) {
      const closed = await closing;
      expect(closed.ok).toBe(false);
    }
    expect(result.error.cleanupPrimary?.diagnostics).toMatchObject({
      measured_observation: { image_base: "0x140000000" },
    });
    await lease.release();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(resolvedAnalysisError(result.error).diagnostics).toMatchObject({
      measured_observation: { image_base: "0x140000000" },
    });
    expect((await fixture.client.close()).ok).toBe(true);
  },
);

it("lets a new NativeAOT caller join a draining attempt before retrying", async () => {
  const fixture = await nativeAotWaiterClient();
  const caller = new AbortController();
  const first = fixture.client.execute(
    "inspect_native_load_image",
    {},
    { signal: caller.signal },
  );
  await fixture.started.promise;
  caller.abort("first caller");
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = fixture.client.execute("inspect_native_load_image", {});
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(fixture.readSnapshot).toHaveBeenCalledTimes(1);
  fixture.snapshot.resolve(ok({ kind: "captured", bytes: fixture.bytes }));
  expect((await first).ok).toBe(false);
  expect((await second).ok).toBe(true);
  expect(fixture.readSnapshot).toHaveBeenCalledTimes(2);
});

it("preserves a draining NativeAOT physical failure before later caller cancellation", async () => {
  const fixture = await nativeAotWaiterClient();
  const firstCaller = new AbortController();
  const first = fixture.client.execute(
    "inspect_native_load_image",
    {},
    { signal: firstCaller.signal },
  );
  await fixture.started.promise;
  firstCaller.abort("first caller");
  await new Promise<void>((resolve) => setImmediate(resolve));
  const secondCaller = new AbortController();
  const second = fixture.client.execute(
    "inspect_native_load_image",
    {},
    { signal: secondCaller.signal },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const cleanup = new ProviderCleanupError(
    "ghidra",
    ["controlled snapshot descriptor"],
    { reason: "controlled close failure" },
  );
  const lease = new AnalysisCleanupLease(async () => {}, [
    "controlled snapshot descriptor",
  ]);
  lease.bindCleanupError(cleanup);
  onTestFinished(() => lease.release());
  // The reader resumes first. Abort after its result settles the shared producer,
  // while the caller is still awaiting consumption of that completed result.
  void fixture.snapshot.promise.then(() =>
    queueMicrotask(() => secondCaller.abort("late second caller")),
  );
  fixture.snapshot.resolve(
    err(
      new GhidraSessionError(
        "protocol",
        "Controlled draining physical failure",
      ).withCleanupFailure(cleanup),
    ),
  );
  const result = await second;
  if (result.ok) throw new Error("Expected draining physical failure");
  expect(secondCaller.signal.aborted).toBe(true);
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "cleanup_incomplete",
    details: { diagnostics: { primary_error: { code: "execution_failure" } } },
  });
  expect(fixture.readSnapshot).toHaveBeenCalledTimes(1);
  expect((await first).ok).toBe(false);
  await lease.release();
});

it("retains drained NativeAOT capture facts with the later caller's exact abort reason", async () => {
  const fixture = await nativeAotWaiterClient();
  const firstCaller = new AbortController();
  const first = fixture.client.execute(
    "inspect_native_load_image",
    {},
    { signal: firstCaller.signal },
  );
  await fixture.started.promise;
  firstCaller.abort("first caller");
  await new Promise<void>((resolve) => setImmediate(resolve));
  const secondCaller = new AbortController();
  const reason = { caller: "later draining waiter" };
  const second = fixture.client.execute(
    "inspect_native_load_image",
    {},
    { signal: secondCaller.signal },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  void fixture.snapshot.promise.then(() =>
    queueMicrotask(() => secondCaller.abort(reason)),
  );
  fixture.snapshot.resolve(ok({ kind: "captured", bytes: fixture.bytes }));
  const result = await second;
  if (result.ok) throw new Error("Expected draining caller cancellation");
  expect(result.error.cause).toBe(reason);
  expect(result.error.partialObservation).toMatchObject({
    kind: "native-aot-snapshot",
    capture: { status: "captured", bytes: fixture.bytes.length },
  });
  expect(fixture.readSnapshot).toHaveBeenCalledTimes(1);
  expect((await first).ok).toBe(false);
});

it("attributes shared NativeAOT producer failure to each requesting operation", async () => {
  const fixture = await nativeAotWaiterClient();
  const image = fixture.client.execute("inspect_native_load_image", {});
  await fixture.started.promise;
  const detail = fixture.client.execute("inspect_native_data_type", {
    address: "0x140002280",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  fixture.snapshot.resolve(
    err(new GhidraSessionError("protocol", "Controlled shared failure")),
  );
  await expect(image).resolves.toMatchObject({
    ok: false,
    error: { operation: "inspect_native_load_image" },
  });
  await expect(detail).resolves.toMatchObject({
    ok: false,
    error: { operation: "inspect_native_data_type" },
  });
  expect(fixture.readSnapshot).toHaveBeenCalledTimes(1);
});

describe("Ghidra NativeAOT snapshot budget", () => {
  it("reports snapshot-capacity omissions inline through the load-image result", async () => {
    const observations = fixtureDosLoadImage().observation;
    const target = peTarget("x86_64");
    const factory: GhidraProviderClientFactory = () => ({
      start: () => Promise.resolve(ok(sessionInfo())),
      callTool: () => Promise.resolve(ok(jsonValueSchema.parse(observations))),
      readTargetSnapshot: () =>
        Promise.resolve(
          ok({
            kind: "over-capacity",
            sourceBytesAtLeast: 128 * 1024 * 1024 + 1,
            maximumBytes: 128 * 1024 * 1024,
          }),
        ),
      close: () => Promise.resolve(ok(null)),
    });
    const ghidra = provider(installationHost(), factory);
    const profile = await ghidra.resolveAnalysisProfile(target);
    if (!profile.ok || profile.value.profile === null)
      throw new Error("Expected admitted PE profile");
    const client = ghidra.createClient(target, profile.value.profile);
    const image = await client.execute("inspect_native_load_image", {});
    expect(image).toMatchObject({
      ok: true,
      value: {
        result: {
          observations: {
            metadata_recovery: [
              {
                status: "partial",
                truncated: true,
                coverage: { truncation_reason: "source-byte-budget" },
              },
            ],
          },
        },
      },
    });
    await client.close();
  });
});

const sessionInfo = () => ({
  name: "REA Ghidra bridge" as const,
  run_id: "11111111-1111-4111-8111-111111111111",
  profile_digest: "a".repeat(64),
  provider: { id: "ghidra" as const, version: "12.1.4" },
  read_only: false as const,
  analysis_complete: true,
  analysis_timed_out: false,
  capabilities: [...GHIDRA_SESSION_CAPABILITIES],
  target: {
    name: "fixture",
    language_id: "x86:LE:64:default",
    compiler_spec_id: "gcc",
    image_base: "0x1000",
    default_address_space: "ram",
    sha256: "a".repeat(64),
  },
});

describe("Ghidra PDB coverage", () => {
  it.each([
    { name: "missing bridge report", pdb: undefined, warns: true },
    {
      name: "report without a PDB reference",
      pdb: {
        file: null,
        guid: null,
        age: null,
        signature: null,
        version: null,
        loaded: null,
      },
      warns: false,
    },
  ])("distinguishes $name in direct PE searches", async ({ pdb, warns }) => {
    const ghidra = provider(installationHost(), () => ({
      start: () =>
        Promise.resolve(
          ok(pdb === undefined ? sessionInfo() : { ...sessionInfo(), pdb }),
        ),
      callTool: () => Promise.resolve(ok([])),
      close: () => Promise.resolve(ok(null)),
    }));
    const target = executableTarget("pe", "x86_64");
    const resolved = await ghidra.resolveAnalysisProfile(target);
    if (!resolved.ok || resolved.value.profile === null)
      throw new Error("Expected a PE profile");
    const client = ghidra.createClient(target, resolved.value.profile);
    try {
      const searched = await client.execute("search_procedures", {
        pattern: "add_numbers",
      });
      if (!searched.ok) throw searched.error;
      expect(searched.value.result).toEqual([]);
      const warnings = searched.value.limitations.filter((limitation) =>
        limitation.includes("PDB"),
      );
      expect(warnings).toEqual(
        warns
          ? [
              "Ghidra did not report PDB attributes; debug-symbol coverage is unknown.",
            ]
          : [],
      );
    } finally {
      await client.close();
    }
  });
  const pdb = {
    file: "C:\\build\\fixture.pdb",
    guid: "01234567-89AB-CDEF-0123-456789ABCDEF",
    age: "a",
    signature: null,
    version: "RSDS",
    loaded: false as boolean | null,
  };
  it.each([false, null, true])(
    "carries PDB load state %s into direct search and health Evidence",
    async (loaded) => {
      let starts = 0;
      const ghidra = provider(installationHost(), () => ({
        start: () => {
          starts += 1;
          return Promise.resolve(
            ok({ ...sessionInfo(), pdb: { ...pdb, loaded } }),
          );
        },
        callTool: () => Promise.resolve(ok([])),
        close: () => Promise.resolve(ok(null)),
      }));
      const target = executableTarget("pe", "x86_64");
      const resolved = await ghidra.resolveAnalysisProfile(target);
      if (!resolved.ok || resolved.value.profile === null)
        throw new Error("Expected a PE profile");
      const client = ghidra.createClient(target, resolved.value.profile);
      // No preceding health call: a name search must establish symbol coverage itself.
      const searched = await client.execute("search_procedures", {
        pattern: "add_numbers",
      });
      expect(starts).toBe(1);
      if (!searched.ok) throw searched.error;
      expect(searched.value.result).toEqual([]);
      const health = await client.execute("health", {});
      if (!health.ok) throw health.error;
      expect(health.value.result).toMatchObject({ pdb: { ...pdb, loaded } });
      for (const observation of [searched.value, health.value]) {
        const limitations = observation.limitations.join("\n");
        if (loaded === true) {
          expect(limitations).toContain("loaded PDB");
          expect(limitations).toContain("not an independent PDB identity");
          expect(limitations).toContain("empty name search does not prove");
        } else {
          expect(limitations).toContain(pdb.file);
          expect(limitations).toContain(pdb.guid);
          expect(limitations).toContain("age (hex) a");
          expect(limitations).toContain("list_procedures");
          expect(limitations).toContain(
            loaded === null ? "unknown" : "not loaded",
          );
        }
      }
      await client.close();
    },
  );
});

const executableTarget = (
  format: "mach-o" | "elf" | "pe",
  architecture: Extract<BinaryTarget, { format: "pe" }>["architecture"],
): BinaryTarget =>
  format === "pe"
    ? peTarget(architecture)
    : {
        path: "/tmp/fixture",
        sha256: "a".repeat(64),
        kind: "executable",
        format,
        architecture,
        availableArchitectures: [architecture],
      };

const peTarget = (
  architecture: Extract<BinaryTarget, { format: "pe" }>["architecture"],
): Extract<BinaryTarget, { format: "pe" }> => ({
  path: "/tmp/fixture",
  sha256: "a".repeat(64),
  kind: "executable",
  format: "pe",
  peMachine: { x86: 0x014c, x86_64: 0x8664, arm: 0x01c4, arm64: 0xaa64 }[
    architecture
  ],
  architecture,
  availableArchitectures: [architecture],
  executableRole: "application",
  managed: false,
});

describe("Ghidra extension failures", () => {
  it.each(["unsupported", "failed", "malformed"] as const)(
    "preserves %s recovery diagnostics and closes without restarting",
    async (status) => {
      const directory = await mkdtemp(
        join(tmpdir(), "rea-provider-extension-"),
      );
      try {
        const jar = join(directory, "addon.jar");
        await writeFile(jar, Buffer.from([0x50, 0x4b, 3, 4]));
        const config = parseConfig({
          GHIDRA_INSTALL_DIR: INSTALL,
          REA_GHIDRA_NATIVEAOT_JAR: jar,
        });
        if (!config.ok) throw config.error;
        let starts = 0,
          calls = 0,
          closes = 0;
        const ghidra = new GhidraProvider(
          config.value,
          silentLogger,
          {},
          installationHost(),
          () => ({
            start: () => {
              starts++;
              return Promise.resolve(
                ok({
                  ...sessionInfo(),
                  analysis_extensions: [
                    {
                      id: "nativeaot",
                      sha256:
                        status === "malformed"
                          ? "0".repeat(64)
                          : createHash("sha256")
                              .update(Buffer.from([0x50, 0x4b, 3, 4]))
                              .digest("hex"),
                      status: status === "malformed" ? "failed" : status,
                      reason:
                        "directory-discovery: Unsupported layout at 0x401000",
                      result: {
                        id: "nativeaot",
                        integration_api: 1,
                        source_revision:
                          "effeb734fc570c32650f88b159608979dc7b423e",
                        source_revision_authority: "build-reported-unattested",
                        status: status === "malformed" ? "failed" : status,
                        reason:
                          "directory-discovery: Unsupported layout at 0x401000",
                        method_tables: 0,
                        diagnostics: ["exact producer diagnostic"],
                      },
                    },
                  ],
                }),
              );
            },
            callTool: () => {
              calls++;
              return Promise.resolve(ok(null));
            },
            close: () => {
              closes++;
              return Promise.resolve(ok(null));
            },
          }),
        );
        const target = executableTarget("elf", "x86_64");
        const resolved = await ghidra.resolveAnalysisProfile(target);
        if (!resolved.ok || resolved.value.profile === null)
          throw new Error("expected extension profile");
        const client = ghidra.createClient(target, resolved.value.profile);
        const failed = await client.execute("health", {});
        expect(failed.ok).toBe(false);
        if (!failed.ok) {
          expect(failed.error._tag).toBe(
            status === "unsupported"
              ? "AnalysisCapabilityUnavailableError"
              : "ProviderAdapterError",
          );
          expect(JSON.stringify(failed.error)).toContain(
            status === "malformed"
              ? "identity mismatch"
              : "Unsupported layout at 0x401000",
          );
        }
        expect(await client.execute("list_procedures", {})).toEqual(failed);
        expect({ starts, calls, closes }).toEqual({
          starts: 1,
          calls: 0,
          closes: 1,
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});

describe("compatible Ghidra builds", () => {
  it("accepts the build and reports that it is unverified", async () => {
    const ghidra = provider(
      {
        ...installationHost(),
        readText: () =>
          "application.version=12.1.2\napplication.java.min=21\napplication.java.max=\n",
        probeJava: () =>
          javaProbeOk<GhidraJavaObservation>({
            osArch: "amd64",
            osName: "Linux",
            version: "27",
            major: 27,
            home: "/usr/lib/jvm/java-27-openjdk",
            bits: 64,
            runtime: "jdk",
          }),
      },
      () => ({
        start: () =>
          Promise.resolve(
            ok({
              ...sessionInfo(),
              provider: { id: "ghidra", version: "12.1.2" },
            }),
          ),
        callTool: () =>
          Promise.resolve(
            ok([
              {
                address: "0x1000",
                value: "fixture_main",
                procedure: {
                  external: false,
                  thunk: false,
                  thunk_target: null,
                },
              },
            ]),
          ),
        close: () => Promise.resolve(ok(null)),
      }),
    );
    const resolved = await ghidra.resolveAnalysisProfile(
      executableTarget("elf", "x86_64"),
    );
    if (!resolved.ok || resolved.value.profile === null)
      throw new Error("expected a compatible Ghidra profile");
    const client = ghidra.createClient(
      executableTarget("elf", "x86_64"),
      resolved.value.profile,
    );
    const health = await client.execute("health", {});
    const procedures = await client.execute("list_procedures", {});
    expect(await ghidra.inspectAvailability()).toMatchObject({
      status: "available",
      diagnostics: { provider_version: "12.1.2", java_version: "27" },
    });
    expect(health.ok && health.value.provider.version).toBe("12.1.2");
    const unverified = expect.stringContaining("12.1.2");
    expect(health.ok && health.value.limitations).toEqual(
      expect.arrayContaining([unverified]),
    );
    expect(procedures.ok && procedures.value.limitations).toEqual(
      expect.arrayContaining([unverified]),
    );
    expect(procedures.ok && procedures.value.provider.version).toBe("12.1.2");
  });
});

it("projects Ghidra startup failure and its incomplete cleanup together", async () => {
  const cleanup = new ProviderCleanupError("ghidra", ["owned-ghidra-process"], {
    reason: "process cleanup unconfirmed",
  });
  const ghidra = provider(installationHost(), () => ({
    start: async () =>
      err(
        new GhidraSessionError(
          "timeout",
          "Ghidra startup deadline elapsed",
          { failure_kind: "timeout" },
          { timeoutMs: 250, cleanupFailure: cleanup },
        ),
      ),
    callTool: async () => ok(null),
    close: async () => err(cleanup),
  }));
  const target = executableTarget("elf", "x86_64");
  const profile = await ghidra.resolveAnalysisProfile(target);
  if (!profile.ok || profile.value.profile === null)
    throw new Error("Expected Ghidra analysis profile");
  const result = await ghidra
    .createClient(target, profile.value.profile)
    .execute("health", {});
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        resources: ["owned-ghidra-process"],
        diagnostics: {
          primary_error: {
            code: "provider_timeout",
            details: {
              timeout_ms: 250,
              diagnostics: { failure_kind: "timeout" },
            },
          },
          cleanup_error: { code: "cleanup_incomplete" },
        },
      },
    });
});

describe("Ghidra deadline guidance", () => {
  const timedOut = async (
    phase: "start" | "request",
    message: string,
    environment: Readonly<Record<string, string>> = {},
  ) => {
    const failure = new GhidraSessionError(
      "timeout",
      message,
      { failure_kind: "timeout" },
      { timeoutMs: 250 },
    );
    const ghidra = provider(
      installationHost(),
      () => ({
        start: async () =>
          phase === "start" ? err(failure) : ok(sessionInfo()),
        callTool: async () => err(failure),
        close: async () => ok(null),
      }),
      environment,
    );
    onTestFinished(async () => {
      await ghidra.closeOwnedResources();
    });
    const target = executableTarget("elf", "x86_64");
    const profile = await ghidra.resolveAnalysisProfile(target);
    if (!profile.ok || profile.value.profile === null)
      throw new Error("Expected Ghidra analysis profile");
    const result = await ghidra
      .createClient(target, profile.value.profile)
      .execute("list_documents", {});
    if (result.ok) throw new Error("Expected a Ghidra timeout");
    return projectAnalysisError(result.error);
  };

  it("names the startup deadline setting and its value when startup times out", async () => {
    const projected = await timedOut(
      "start",
      "Ghidra startup deadline elapsed",
    );
    expect(projected).toMatchObject({
      code: "provider_timeout",
      details: { timeout_ms: 250 },
    });
    expect(projected.message).toContain(
      "250 ms startup deadline (REA_GHIDRA_STARTUP_TIMEOUT_MS)",
    );
    expect(projected.remediation.action).toContain(
      "ghidra.startup_timeout_ms and action set above 250",
    );
    expect(projected.remediation.action).toContain(
      "REA_GHIDRA_DISABLED_ANALYZERS",
    );
    expect(projected.remediation.action).toContain("REA_GHIDRA_PROJECT_PATH");
    expect(projected.remediation.action).toContain("without restarting REA");
    expect(projected.remediation.action).toContain("Export useful Evidence");
    expect(projected.details).toMatchObject({
      limit: {
        setting: "ghidra.startup_timeout_ms",
        effective_value: 250,
        applies_at: "next_startup",
      },
    });
    expect(projected.remediation.action).not.toContain("rea doctor");
  });

  it("describes an existing-project startup timeout without import or analyzer advice", async () => {
    const root = await mkdtemp(join(tmpdir(), "rea-timeout-project-"));
    onTestFinished(async () => {
      await rm(root, { recursive: true, force: true });
    });
    await mkdir(join(root, "large.rep"));
    await writeFile(join(root, "large.gpr"), "marker");
    const projected = await timedOut(
      "start",
      "Ghidra startup deadline elapsed",
      { REA_GHIDRA_PROJECT_PATH: join(root, "large.gpr") },
    );
    expect(projected).toMatchObject({
      code: "provider_timeout",
      details: {
        timeout_ms: 250,
        limit: { setting: "ghidra.startup_timeout_ms" },
      },
    });
    expect(projected.message).toContain(
      "copying and opening the selected project within its configured 250 ms startup deadline (REA_GHIDRA_STARTUP_TIMEOUT_MS)",
    );
    expect(projected.message).not.toContain("importing and analyzing");
    expect(projected.remediation.action).toContain(
      "ghidra.startup_timeout_ms and action set above 250",
    );
    expect(projected.remediation.action).not.toContain(
      "REA_GHIDRA_DISABLED_ANALYZERS",
    );
    expect(projected.remediation.action).not.toContain(
      "Reopening repeats import",
    );
    expect(projected.remediation.action).not.toContain("rea doctor");
  });

  it("keeps generic guidance for a bridge request deadline", async () => {
    const projected = await timedOut(
      "request",
      "Ghidra bridge request timed out",
    );
    expect(projected.code).toBe("provider_timeout");
    expect(projected.message).not.toContain("REA_GHIDRA_STARTUP_TIMEOUT_MS");
    expect(projected.remediation.action).not.toContain(
      "REA_GHIDRA_STARTUP_TIMEOUT_MS",
    );
  });
});

describe("Ghidra missing project program", () => {
  const startFailure = async (
    stdout: string,
    environment: Readonly<Record<string, string>> = {},
  ) => {
    const root = await mkdtemp(join(tmpdir(), "rea-missing-program-"));
    onTestFinished(async () => {
      await rm(root, { recursive: true, force: true });
    });
    await mkdir(join(root, "selected.rep"));
    await writeFile(join(root, "selected.gpr"), "marker");
    const failure = new GhidraSessionError(
      "start",
      "Ghidra exited before the bridge was ready",
      {
        failure_kind: "start",
        exit_code: 1,
        failure_output: failureOutput(stdout),
      },
    );
    const ghidra = provider(
      installationHost(),
      () => ({
        start: async () => err(failure),
        callTool: async () => err(failure),
        close: async () => ok(null),
      }),
      {
        REA_GHIDRA_PROJECT_PATH: join(root, "selected.gpr"),
        ...environment,
      },
    );
    onTestFinished(async () => {
      await ghidra.closeOwnedResources();
    });
    const target = executableTarget("elf", "x86_64");
    const profile = await ghidra.resolveAnalysisProfile(target);
    if (!profile.ok || profile.value.profile === null)
      throw new Error("Expected Ghidra analysis profile");
    const result = await ghidra
      .createClient(target, profile.value.profile)
      .execute("list_documents", {});
    if (result.ok) throw new Error("Expected a Ghidra start failure");
    return projectAnalysisError(result.error);
  };
  const abort = (name: string) =>
    `ERROR Abort due to Headless analyzer error: Requested project program file(s) not found: ${name} (HeadlessAnalyzer) java.io.IOException: Requested project program file(s) not found: ${name}`;

  const expectMissingProgram = (
    projected: Awaited<ReturnType<typeof startFailure>>,
    programName: string,
    configured: boolean,
  ) => {
    const guidance = ghidraMissingProgramGuidance(programName, configured);
    expect(projected).toMatchObject({
      code: "configuration_invalid",
      details: {
        settings: [
          {
            setting: "REA_GHIDRA_PROGRAM_NAME",
            constraint: guidance.constraint,
          },
        ],
      },
    });
    expect(projected.remediation.action).toBe(guidance.remediationAction);
    expect(projected.message).toContain(JSON.stringify(programName));
  };

  it("reports the program name defaulted from the target as REA_GHIDRA_PROGRAM_NAME", async () => {
    expectMissingProgram(
      await startFailure(abort("fixture")),
      "fixture",
      false,
    );
  });

  it("reports an explicitly configured program name that the project lacks", async () => {
    const projected = await startFailure(abort("program_gamma"), {
      REA_GHIDRA_PROGRAM_NAME: "program_gamma",
    });
    expectMissingProgram(projected, "program_gamma", true);
  });

  it("keeps the generic start failure when Ghidra names a different program", async () => {
    const projected = await startFailure(abort("fixture_other"));
    expect(projected.code).toBe("execution_failure");
  });

  it("keeps the generic start failure for unrelated launch output", async () => {
    const projected = await startFailure("ERROR Unable to lock project");
    expect(projected.code).toBe("execution_failure");
  });
});

describe("Ghidra analysis seeds and configured language", () => {
  const seedSession = async (
    report: (sha256: string) => GhidraSeedReport | undefined,
  ) => {
    const directory = await mkdtemp(join(tmpdir(), "rea-provider-seeds-"));
    const seeds = join(directory, "seeds.tsv");
    await writeFile(seeds, "0x401000\tfunction\tentry\n0x401010\tcode\n");
    const config = parseConfig({
      GHIDRA_INSTALL_DIR: INSTALL,
      REA_GHIDRA_SEED_FILE: seeds,
    });
    if (!config.ok) throw config.error;
    const counts = { starts: 0, calls: 0, closes: 0 };
    const ghidra = new GhidraProvider(
      config.value,
      silentLogger,
      {},
      installationHost(),
      () => ({
        start: () => {
          counts.starts++;
          const seedReport = report(
            createHash("sha256")
              .update("0x401000\tfunction\tentry\n0x401010\tcode\n")
              .digest("hex"),
          );
          return Promise.resolve(
            ok({
              ...sessionInfo(),
              ...(seedReport === undefined
                ? {}
                : { analysis_seeds: seedReport }),
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
    const target = executableTarget("elf", "x86_64");
    const resolved = await ghidra.resolveAnalysisProfile(target);
    if (!resolved.ok || resolved.value.profile === null)
      throw new Error("expected seed profile");
    return {
      directory,
      counts,
      client: ghidra.createClient(target, resolved.value.profile),
    };
  };
  const applied = (sha256: string): GhidraSeedReport => ({
    format: "rea-ghidra-seeds-v1",
    sha256,
    entries: 2,
    function_created: 1,
    function_existing: 0,
    function_failed: 0,
    code_decoded: 0,
    code_failed: 1,
    label_applied: 0,
    label_failed: 0,
    unmapped: 0,
  });

  it("reports the verified seed outcome as a session limitation", async () => {
    const { directory, client } = await seedSession(applied);
    try {
      const health = await client.execute("health", {});
      if (!health.ok) throw health.error;
      expect(health.value.limitations).toEqual(
        expect.arrayContaining([
          expect.stringContaining("caller assertions, not Ghidra discoveries"),
          expect.stringContaining(
            "1 functions created, 0 already present, 0 failed; 0 code seeds decoded, 1 failed",
          ),
        ]),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["no seed report", () => undefined],
    [
      "a report for other seeds",
      (sha256: string): GhidraSeedReport => ({
        ...applied(sha256),
        sha256: "0".repeat(64),
      }),
    ],
  ])("fails closed on %s before any analysis call", async (_label, report) => {
    const { directory, counts, client } = await seedSession(report);
    try {
      const failed = await client.execute("list_procedures", {});
      expect(failed.ok).toBe(false);
      if (!failed.ok) expect(failed.error._tag).toBe("ProviderAdapterError");
      expect(counts).toEqual({ starts: 1, calls: 0, closes: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses a profile resolved without the configured seeds or language", async () => {
    const plain = parseConfig({ GHIDRA_INSTALL_DIR: INSTALL });
    if (!plain.ok) throw plain.error;
    const target = executableTarget("elf", "x86_64");
    const resolved = await new GhidraProvider(
      plain.value,
      silentLogger,
      {},
      installationHost(),
    ).resolveAnalysisProfile(target);
    if (!resolved.ok || resolved.value.profile === null)
      throw new Error("expected profile");
    for (const environment of [
      { REA_GHIDRA_SEED_FILE: "/seeds.tsv" },
      { REA_GHIDRA_LANGUAGE_ID: "x86:LE:32:default" },
    ]) {
      const configured = parseConfig({
        GHIDRA_INSTALL_DIR: INSTALL,
        ...environment,
      });
      if (!configured.ok) throw configured.error;
      let starts = 0;
      const client = new GhidraProvider(
        configured.value,
        silentLogger,
        {},
        installationHost(),
        () => ({
          start: () => {
            starts++;
            return Promise.resolve(ok(sessionInfo()));
          },
          callTool: () => Promise.resolve(ok(null)),
          close: () => Promise.resolve(ok(null)),
        }),
      ).createClient(target, resolved.value.profile);
      const failed = await client.execute("health", {});
      expect(failed.ok).toBe(false);
      expect(starts).toBe(0);
    }
  });
});

const configuredProvider = (
  environment: Record<string, string>,
  clientFactory?: GhidraProviderClientFactory,
) => {
  const config = parseConfig({ GHIDRA_INSTALL_DIR: INSTALL, ...environment });
  if (!config.ok) throw config.error;
  return new GhidraProvider(
    config.value,
    silentLogger,
    {},
    installationHost(),
    clientFactory,
  );
};

const analyzerReport = (
  ...analyzers: readonly (readonly [
    name: string,
    status: GhidraDisabledAnalyzerReport["analyzers"][number]["status"],
  ])[]
): GhidraDisabledAnalyzerReport => ({
  format: "rea-ghidra-disabled-analyzers-v1",
  analyzers: analyzers.map(([name, status]) => ({ name, status })),
});

describe("Ghidra disabled analyzer options", () => {
  it("records the configured analyzer options in the analysis profile", async () => {
    const ghidra = configuredProvider({
      REA_GHIDRA_DISABLED_ANALYZERS:
        "Objective-C Message Analyzer,Decompiler Switch Analysis",
    });
    const resolved = await ghidra.resolveAnalysisProfile(
      executableTarget("elf", "x86_64"),
    );
    if (!resolved.ok || resolved.value.profile === null)
      throw new Error("expected a bound Ghidra profile");
    expect(resolved.value.profile.parameters).toMatchObject({
      analyzer_preset:
        "ghidra-default+disabled:Objective-C Message Analyzer,Decompiler Switch Analysis",
      analysis_options: {
        disabled_analyzers: [
          "Objective-C Message Analyzer",
          "Decompiler Switch Analysis",
        ],
      },
    });
  });

  it("hands the configured analyzers to the launcher for a matching profile", async () => {
    const launchers: GhidraHeadlessLauncher[] = [];
    const ghidra = configuredProvider(
      { REA_GHIDRA_DISABLED_ANALYZERS: "Objective-C Message Analyzer" },
      (options) => {
        launchers.push(options.launcher as GhidraHeadlessLauncher);
        return {
          start: () =>
            Promise.resolve(
              ok({
                ...sessionInfo(),
                disabled_analyzers: analyzerReport([
                  "Objective-C Message Analyzer",
                  "not_applicable",
                ]),
              }),
            ),
          callTool: () => Promise.resolve(ok(null)),
          close: () => Promise.resolve(ok(null)),
        };
      },
    );
    const target = executableTarget("elf", "x86_64");
    const resolved = await ghidra.resolveAnalysisProfile(target);
    if (!resolved.ok || resolved.value.profile === null)
      throw new Error("expected a bound Ghidra profile");
    const client = ghidra.createClient(target, resolved.value.profile);
    const health = await client.execute("health", {});
    expect(health.ok).toBe(true);
    expect(launchers).toHaveLength(1);
    expect(launchers[0]?.options.disabledAnalyzers).toEqual([
      "Objective-C Message Analyzer",
    ]);
  });

  it("binds analyzer overrides and raw import settings in one profile", async () => {
    const launchers: GhidraHeadlessLauncher[] = [];
    const ghidra = configuredProvider(
      { REA_GHIDRA_DISABLED_ANALYZERS: "Decompiler Switch Analysis" },
      (options) => {
        launchers.push(options.launcher as GhidraHeadlessLauncher);
        return {
          start: () =>
            Promise.resolve(
              ok({
                ...sessionInfo(),
                disabled_analyzers: analyzerReport([
                  "Decompiler Switch Analysis",
                  "disabled",
                ]),
              }),
            ),
          callTool: () => Promise.resolve(ok(null)),
          close: () => Promise.resolve(ok(null)),
        };
      },
    );
    const target: BinaryTarget = {
      path: "/tmp/entry.bin",
      sha256: "a".repeat(64),
      kind: "executable",
      format: "raw-binary",
      architecture: "x86",
      availableArchitectures: ["x86"],
      entryPoint: "0x1000",
      entryPointSource: "0x1000",
    };
    const resolved = await ghidra.resolveAnalysisProfile(target);
    if (!resolved.ok || resolved.value.profile === null)
      throw new Error("expected a bound raw-binary profile");
    expect(resolved.value.profile.parameters).toMatchObject({
      target_format: "raw-binary",
      entry_point: "0x1000",
      analyzer_preset: "ghidra-default+disabled:Decompiler Switch Analysis",
      analysis_options: { disabled_analyzers: ["Decompiler Switch Analysis"] },
    });
    const client = ghidra.createClient(target, resolved.value.profile);
    expect(launchers).toHaveLength(0);
    expect((await client.execute("health", {})).ok).toBe(true);
    expect(launchers).toHaveLength(1);
    expect(launchers[0]?.options).toMatchObject({
      disabledAnalyzers: ["Decompiler Switch Analysis"],
      rawBinary: {
        languageId: "x86:LE:32:default",
        compilerSpecId: "gcc",
        baseAddr: "0x1000",
      },
    });
    await client.close();
  });

  it("refuses a profile resolved without or with other analyzer options", async () => {
    const target = executableTarget("elf", "x86_64");
    const plainProvider = configuredProvider({});
    const plain = await plainProvider.resolveAnalysisProfile(target);
    if (!plain.ok || plain.value.profile === null)
      throw new Error("expected profile");
    const configuredProvider2 = configuredProvider({
      REA_GHIDRA_DISABLED_ANALYZERS: "Objective-C Message Analyzer",
    });
    const configured = await configuredProvider2.resolveAnalysisProfile(target);
    if (!configured.ok || configured.value.profile === null)
      throw new Error("expected configured profile");
    for (const [profile, environment] of [
      [
        plain.value.profile,
        { REA_GHIDRA_DISABLED_ANALYZERS: "Objective-C Message Analyzer" },
      ],
      [configured.value.profile, {}],
      [
        configured.value.profile,
        { REA_GHIDRA_DISABLED_ANALYZERS: "Decompiler Switch Analysis" },
      ],
    ] as const) {
      let starts = 0;
      const client = configuredProvider(environment, () => ({
        start: () => {
          starts++;
          return Promise.resolve(ok(sessionInfo()));
        },
        callTool: () => Promise.resolve(ok(null)),
        close: () => Promise.resolve(ok(null)),
      })).createClient(target, profile);
      const failed = await client.execute("health", {});
      expect(failed.ok).toBe(false);
      if (!failed.ok) expect(failed.error._tag).toBe("ProviderAdapterError");
      expect(starts).toBe(0);
    }
  });
});

describe("Ghidra disabled analyzer applicability per program", () => {
  const analyzerSession = async (
    setting: string | undefined,
    report: GhidraDisabledAnalyzerReport | undefined,
  ) => {
    const counts = { starts: 0, calls: 0, closes: 0 };
    const ghidra = configuredProvider(
      setting === undefined ? {} : { REA_GHIDRA_DISABLED_ANALYZERS: setting },
      () => ({
        start: () => {
          counts.starts++;
          return Promise.resolve(
            ok({
              ...sessionInfo(),
              ...(report === undefined ? {} : { disabled_analyzers: report }),
            }),
          );
        },
        callTool: () => {
          counts.calls++;
          return Promise.resolve(
            ok([
              {
                address: "0x1000",
                value: "fixture_main",
                procedure: {
                  external: false,
                  thunk: false,
                  thunk_target: null,
                },
              },
            ]),
          );
        },
        close: () => {
          counts.closes++;
          return Promise.resolve(ok(null));
        },
      }),
    );
    const target = executableTarget("elf", "x86_64");
    const resolved = await ghidra.resolveAnalysisProfile(target);
    if (!resolved.ok || resolved.value.profile === null)
      throw new Error("expected a bound Ghidra profile");
    return {
      counts,
      profile: resolved.value.profile,
      client: ghidra.createClient(target, resolved.value.profile),
    };
  };

  it("adds no limitation when every configured analyzer was disabled", async () => {
    const { client } = await analyzerSession(
      "Decompiler Switch Analysis",
      analyzerReport(["Decompiler Switch Analysis", "disabled"]),
    );
    const health = await client.execute("health", {});
    if (!health.ok) throw health.error;
    expect(health.value.limitations).not.toEqual(
      expect.arrayContaining([expect.stringContaining("(n/a)")]),
    );
    await client.close();
  });

  it("opens a program for which a configured analyzer is not applicable", async () => {
    const { counts, profile, client } = await analyzerSession(
      "Decompiler Switch Analysis,Objective-C Message Analyzer",
      analyzerReport(
        ["Decompiler Switch Analysis", "disabled"],
        ["Objective-C Message Analyzer", "not_applicable"],
      ),
    );
    const procedures = await client.execute("list_procedures", {});
    expect(counts.calls).toBe(1);
    if (!procedures.ok) throw procedures.error;
    expect(procedures.value.analysisProfile?.parameters).toMatchObject({
      analyzer_preset:
        "ghidra-default+disabled:Decompiler Switch Analysis,Objective-C Message Analyzer",
    });
    expect(procedures.value.analysisProfile?.digest).toBe(profile.digest);
    expect(procedures.value.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Applied analyzer preset: ghidra-default+disabled:Decompiler Switch Analysis,Objective-C Message Analyzer(n/a).",
        ),
      ]),
    );
    await client.close();
  });

  it.each([
    ["no analyzer report", undefined],
    [
      "a report for other analyzers",
      analyzerReport(["Decompiler Switch Analysis", "not_applicable"]),
    ],
    [
      "a report missing a configured analyzer",
      analyzerReport(["Objective-C Message Analyzer", "not_applicable"]),
    ],
  ])("fails closed on %s before any analysis call", async (_label, report) => {
    const { counts, client } = await analyzerSession(
      "Objective-C Message Analyzer,Demangler Swift",
      report,
    );
    const failed = await client.execute("list_procedures", {});
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error._tag).toBe("ProviderAdapterError");
      expect(failed.error.diagnostics?.reason).toEqual(
        expect.stringContaining("REA_GHIDRA_DISABLED_ANALYZERS"),
      );
    }
    expect(counts).toEqual({ starts: 1, calls: 0, closes: 1 });
  });

  it("fails closed on an analyzer report the profile did not commit", async () => {
    const { counts, client } = await analyzerSession(
      undefined,
      analyzerReport(["Objective-C Message Analyzer", "not_applicable"]),
    );
    const failed = await client.execute("health", {});
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error._tag).toBe("ProviderAdapterError");
    expect(counts).toEqual({ starts: 1, calls: 0, closes: 1 });
  });
});

describe("Ghidra queries after the owned provider is lost", () => {
  const lostProviderSession = async (
    state: "exited" | "unreachable" | "idle",
    failureKind: "process" | "protocol" | "remote" = "process",
    answeredBeforeLoss = true,
  ) => {
    let calls = 0;
    const ghidra = provider(installationHost(), () => ({
      start: async () =>
        err(new GhidraSessionError("start", "startup is not exercised")),
      callTool: async () => {
        calls += 1;
        if (answeredBeforeLoss && calls === 1) return ok(null);
        return err(
          new GhidraSessionError(
            failureKind,
            "Ghidra bridge socket closed",
            { failure_kind: failureKind },
            failureKind === "remote" ? { remoteCode: "internal" } : {},
          ),
        );
      },
      close: async () => ok(null),
      operationHealthSnapshot: () =>
        state === "idle"
          ? undefined
          : {
              state,
              stage: null,
              retryAction: "restart_provider",
              exitCode: state === "exited" ? 137 : null,
              requests: [],
            },
    }));
    const target = executableTarget("elf", "x86_64");
    const profile = await ghidra.resolveAnalysisProfile(target);
    if (!profile.ok || profile.value.profile === null)
      throw new Error("Expected Ghidra analysis profile");
    const client = ghidra.createClient(target, profile.value.profile);
    if (answeredBeforeLoss) await client.execute("list_documents", {});
    return client;
  };

  it("tells the caller to reopen the target when Ghidra exited", async () => {
    const client = await lostProviderSession("exited");
    const result = await client.execute("list_documents", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({
      code: "execution_failure",
      retryable: false,
      details: { provider_id: "ghidra", operation: "list_documents" },
    });
    expect(projected.message).toContain("exited with code 137");
    expect(projected.message).toContain("Call open_binary");
    expect(projected.remediation.action).toContain("Call open_binary");
    expect(projected.remediation.action).not.toContain("rea doctor");
  });

  it("tells the caller to reopen the target when the bridge became unreachable", async () => {
    const client = await lostProviderSession("unreachable", "protocol");
    const result = await client.execute("list_procedures", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const projected = projectAnalysisError(result.error);
    expect(projected.message).toContain("became unreachable");
    expect(projected.remediation.action).toContain("Call open_binary");
  });

  it("keeps installation guidance when Ghidra dies before it ever answered", async () => {
    const client = await lostProviderSession("exited", "process", false);
    const result = await client.execute("list_documents", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const projected = projectAnalysisError(result.error);
    expect(projected.message).not.toContain("Call open_binary");
    expect(projected.remediation.action).toContain("rea doctor");
  });

  it("keeps the generic failure when the provider is not known to be lost", async () => {
    const client = await lostProviderSession("idle");
    const result = await client.execute("list_documents", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(projectAnalysisError(result.error).remediation.action).toContain(
      "rea doctor",
    );
  });

  it("does not reinterpret a bridge-reported failure as a lost provider", async () => {
    const client = await lostProviderSession("exited", "remote");
    const result = await client.execute("list_documents", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(projectAnalysisError(result.error).message).not.toContain(
      "Call open_binary",
    );
  });
});

const output = (text: string) => ({
  text,
  bytes: Buffer.byteLength(text),
  retained_bytes: Buffer.byteLength(text),
});
const failureOutput = (stdout = "", stderr = "") => ({
  stdout: output(stdout),
  stderr: output(stderr),
  complete: true,
  observed_oome: (["stdout", "stderr"] as const).flatMap((stream) => {
    const bytes = Buffer.from(stream === "stdout" ? stdout : stderr);
    const scanner = new ProcessOutputTokenScanner("java.lang.OutOfMemoryError");
    scanner.scan(bytes, 0);
    scanner.finish();
    const observed = scanner.latestWithin(0, bytes.length);
    return observed === undefined
      ? []
      : [
          {
            stream,
            offset: observed.offset,
            line: observed.line,
            truncated: observed.truncated,
          },
        ];
  }),
});
const projectFailure = async (
  kind: "cancelled" | "process" | "protocol" | "remote" | "start" | "timeout",
  diagnostics: Readonly<Record<string, JsonValue>>,
) => {
  const ghidra = provider(installationHost(), () => ({
    start: async () =>
      err(new GhidraSessionError("start", "startup is not exercised")),
    callTool: async () =>
      err(
        new GhidraSessionError(
          kind,
          "Ghidra request failed",
          { failure_kind: kind, ...diagnostics },
          kind === "remote" ? { remoteCode: "internal" } : {},
        ),
      ),
    close: async () => ok(null),
  }));
  const target = executableTarget("elf", "x86_64");
  const profile = await ghidra.resolveAnalysisProfile(target);
  if (!profile.ok || profile.value.profile === null)
    throw new Error("Expected Ghidra analysis profile");
  const result = await ghidra
    .createClient(target, profile.value.profile)
    .execute("list_documents", {});
  if (result.ok) throw new Error("Expected a Ghidra failure");
  return projectAnalysisError(result.error);
};

const issueOutput = [
  "INFO  ANALYZING all memory and code: /hugo (HeadlessAnalyzer)",
  "ERROR Abort due to Headless analyzer error: Java heap space (HeadlessAnalyzer) java.lang.OutOfMemoryError:",
  "\tat ghidra.app.plugin.core.analysis.GolangSymbolAnalyzer$PropagateRttiBackgroundCommand.applyTo",
].join("\n");

describe("Ghidra exit-signal evidence", () => {
  it("preserves observed SIGKILL without guessing its cause or installation recovery", async () => {
    const projected = await projectFailure("process", {
      exit_code: null,
      exit_signal: "SIGKILL",
      failure_output: failureOutput(),
    });
    expect(projected.code).toBe("execution_failure");
    expect(projected.message).toContain("SIGKILL");
    expect(projected.message).toContain("does not establish its cause");
    expect(projected.remediation.action).toContain(
      "host or container termination records",
    );
    expect(projected.remediation.action).not.toContain("rea doctor");
    expect(projected.remediation.action).not.toContain(
      "GHIDRA_HEADLESS_MAXMEM",
    );
  });

  it("keeps operation-scoped JVM memory evidence stronger than an exit signal", async () => {
    const projected = await projectFailure("process", {
      exit_signal: "SIGKILL",
      failure_output: failureOutput(
        "",
        "java.lang.OutOfMemoryError: Java heap space",
      ),
    });
    expect(projected.code).toBe("resource_constraint");
    expect(projected.message).toContain("Java heap space");
    expect(projected.remediation.action).toContain("GHIDRA_HEADLESS_MAXMEM");
  });
});

describe("Ghidra OOME error projection", () => {
  it("recognizes the headless analyzer's real detail-before-class output", async () => {
    const projected = await projectFailure("process", {
      stdout: output(issueOutput),
      stderr: output(""),
      failure_output: failureOutput(issueOutput),
      configured_jvm_max_heap: "4G",
    });
    expect(projected).toMatchObject({
      code: "resource_constraint",
      details: {
        resource: "memory",
        reported_limits: { configured_jvm_max_heap: "4G" },
      },
    });
    expect(projected.message).toContain("Java heap space");
    expect(projected.remediation.action).toContain("GHIDRA_HEADLESS_MAXMEM");
    expect(projected.remediation.action).toContain(
      "REA_GHIDRA_DISABLED_ANALYZERS",
    );
  });

  it("retains an unknown heap for GC overhead when the launch did not report one", async () => {
    const projected = await projectFailure("timeout", {
      stdout: output(""),
      stderr: output(""),
      failure_output: failureOutput(
        "",
        'Exception in thread "main" java.lang.OutOfMemoryError: GC overhead limit exceeded',
      ),
    });
    expect(projected).toMatchObject({
      code: "resource_constraint",
      details: {
        resource: "memory",
        reported_limits: { configured_jvm_max_heap: null },
      },
    });
    expect(projected.remediation.action).toContain("GHIDRA_HEADLESS_MAXMEM");
  });

  it.each([
    ["Metaspace", "java.lang.OutOfMemoryError: Metaspace"],
    [
      "array VM limit",
      "java.lang.OutOfMemoryError: Requested array size exceeds VM limit",
    ],
  ])("does not recommend a larger Java heap for %s", async (_name, text) => {
    const projected = await projectFailure("process", {
      stdout: output(""),
      stderr: output(""),
      failure_output: failureOutput("", text),
      configured_jvm_max_heap: "4G",
    });
    expect(projected.code).toBe("resource_constraint");
    expect(projected.message).toContain(text);
    expect(projected.remediation.action).not.toContain(
      "GHIDRA_HEADLESS_MAXMEM",
    );
  });

  it("reports native-thread exhaustion as capacity without inventing a limit", async () => {
    const projected = await projectFailure("process", {
      stdout: output(""),
      stderr: output(""),
      failure_output: failureOutput(
        "",
        "java.lang.OutOfMemoryError: unable to create native thread: possibly out of memory or process/resource limits reached",
      ),
      configured_jvm_max_heap: "4G",
    });
    expect(projected).toMatchObject({
      code: "resource_constraint",
      details: { resource: "capacity", reported_limits: null },
    });
    expect(projected.remediation.action).not.toContain(
      "GHIDRA_HEADLESS_MAXMEM",
    );
  });

  it("keeps a bare OOME class at unknown subtype without heap advice", async () => {
    const projected = await projectFailure("process", {
      failure_output: failureOutput("", "java.lang.OutOfMemoryError"),
    });
    expect(projected).toMatchObject({
      code: "resource_constraint",
      details: { resource: "memory", reported_limits: null },
    });
    expect(projected.remediation.action).not.toContain(
      "GHIDRA_HEADLESS_MAXMEM",
    );
  });

  it("does not reclassify a later failure from OOME retained after an earlier success", async () => {
    let calls = 0;
    const ghidra = provider(installationHost(), () => ({
      start: async () =>
        err(new GhidraSessionError("start", "startup is not exercised")),
      callTool: async () => {
        calls += 1;
        if (calls === 1) return ok(["fixture"]);
        return err(
          new GhidraSessionError(
            "protocol",
            "Ghidra returned an invalid later response",
            {
              stdout: output(issueOutput),
              stderr: output(""),
              // The OOME remains visible in full process history above, but
              // the current operation produced no such error.
              failure_output: failureOutput(),
            },
          ),
        );
      },
      close: async () => ok(null),
    }));
    const target = executableTarget("elf", "x86_64");
    const profile = await ghidra.resolveAnalysisProfile(target);
    if (!profile.ok || profile.value.profile === null)
      throw new Error("Expected Ghidra analysis profile");
    const client = ghidra.createClient(target, profile.value.profile);
    const earlier = await client.execute("list_documents", {});
    expect(earlier.ok).toBe(true);
    const later = await client.execute("list_procedures", {});
    expect(later.ok).toBe(false);
    if (later.ok) return;
    const projected = projectAnalysisError(later.error);
    expect(projected.code).toBe("execution_failure");
    expect(projected.details?.diagnostics).toMatchObject({
      stdout: { text: issueOutput },
    });
  });

  it("keeps cancellation primary even when the current operation reports an OOME", async () => {
    const projected = await projectFailure("cancelled", {
      stdout: output(""),
      stderr: output(""),
      failure_output: failureOutput(issueOutput),
      configured_jvm_max_heap: "4G",
    });
    expect(projected.code).toBe("cancelled");
  });

  it("does not reinterpret a bridge-reported OOME as a local process failure", async () => {
    const projected = await projectFailure("remote", {
      stdout: output(""),
      stderr: output(""),
      failure_output: failureOutput(issueOutput),
      configured_jvm_max_heap: "4G",
    });
    expect(projected.code).not.toBe("resource_constraint");
  });
});

describe("Ghidra OOME beyond the retention budget", () => {
  it("projects an observed OOME line that the retained text omits", async () => {
    const projected = await projectFailure("process", {
      stdout: output(""),
      stderr: output(""),
      failure_output: {
        ...failureOutput("", ""),
        complete: false,
        observed_oome: [
          {
            stream: "stderr",
            offset: 9_000_000,
            line: "ERROR Abort due to Headless analyzer error: Java heap space (HeadlessAnalyzer) java.lang.OutOfMemoryError: Java heap space",
          },
        ],
      },
      configured_jvm_max_heap: "4G",
    });
    expect(projected).toMatchObject({
      code: "resource_constraint",
      details: {
        resource: "memory",
        reported_limits: { configured_jvm_max_heap: "4G" },
      },
    });
    expect(projected.message).toContain("Java heap space");
  });

  it("keeps the original failure when incomplete output shows no OOME", async () => {
    const projected = await projectFailure("process", {
      stdout: output(""),
      stderr: output(""),
      failure_output: { ...failureOutput("", ""), complete: false },
      configured_jvm_max_heap: "4G",
    });
    expect(projected.code).toBe("execution_failure");
  });
});

describe("Ghidra SIGKILL projection", () => {
  const killed = {
    stdout: output("WARN Decompiling 14005c790, pcode error"),
    stderr: output(""),
    failure_output: failureOutput("WARN Decompiling 14005c790, pcode error"),
    configured_jvm_max_heap: "2G",
    exit_code: null,
    exit_signal: "SIGKILL",
  };
  const cgroup = (oomKillAfter: number, memoryMax: number | "max" | null) => ({
    path: "/",
    oom_kill_before: 0,
    oom_kill_after: oomKillAfter,
    memory_max: memoryMax,
  });

  it.each(["process", "protocol"] as const)(
    "reports a %s failure after a cgroup OOM kill as a memory constraint",
    async (kind) => {
      const projected = await projectFailure(kind, {
        ...killed,
        stop_requested: false,
        memory_cgroup: cgroup(1, 3_221_225_472),
      });
      expect(projected).toMatchObject({
        code: "resource_constraint",
        details: {
          resource: "memory",
          reported_limits: {
            cgroup_memory_max: 3_221_225_472,
            configured_jvm_max_heap: "2G",
          },
        },
      });
      expect(projected.message).toContain("oom_kill");
      expect(projected.message).toContain("child groups");
      expect(projected.message).not.toContain("process tree");
      expect(projected.remediation.action).toContain("decompiler");
      expect(projected.remediation.action).not.toContain("rea doctor");
      expect(projected.remediation.action).not.toMatch(
        /increas\w* GHIDRA_HEADLESS_MAXMEM/u,
      );
    },
  );

  it.each([
    ["an unlimited group", "max"],
    ["an unread limit", null],
  ] as const)("reports %s as observed", async (_name, memoryMax) => {
    const projected = await projectFailure("process", {
      ...killed,
      stop_requested: false,
      memory_cgroup: cgroup(2, memoryMax),
    });
    expect(projected).toMatchObject({
      code: "resource_constraint",
      details: { reported_limits: { cgroup_memory_max: memoryMax } },
    });
  });

  it.each([
    { state: "unreported", stop: {} },
    { state: "requested", stop: { stop_requested: true } },
  ] as const)(
    "does not attribute a SIGKILL when the stop request is $state",
    async ({ stop }) => {
      const diagnostics = {
        ...killed,
        ...stop,
        memory_cgroup: cgroup(1, 3_221_225_472),
      };
      const projected = await projectFailure("process", diagnostics);
      expect(projected.code).toBe("execution_failure");
      expect(projected.message).toContain("SIGKILL");
      expect(projected.message).toContain("does not establish its cause");
      expect(projected.message).not.toContain("before REA stopped it");
      expect(projected.message).not.toContain("oom_kill");
      expect(projected.details?.diagnostics).toMatchObject(diagnostics);
    },
  );

  it("keeps start-failure SIGKILL cause unknown despite a cgroup OOM delta", async () => {
    const diagnostics = {
      ...killed,
      stop_requested: false,
      memory_cgroup: cgroup(1, 3_221_225_472),
    };
    const projected = await projectFailure("start", diagnostics);
    expect(projected.code).toBe("execution_failure");
    expect(projected.message).toContain("SIGKILL");
    expect(projected.message).toContain("does not establish its cause");
    expect(projected.details?.diagnostics).toMatchObject(diagnostics);
    expect(projected.remediation.action).toContain(
      "host or container termination records",
    );
  });

  it.each([
    ["without cgroup evidence", {}],
    [
      "when the cgroup recorded no new OOM kill",
      { memory_cgroup: cgroup(0, 3_221_225_472) },
    ],
  ])("names the signal instead of doctor advice %s", async (_name, extra) => {
    const projected = await projectFailure("process", {
      ...killed,
      stop_requested: false,
      ...extra,
    });
    expect(projected.code).toBe("execution_failure");
    expect(projected.message).toContain("SIGKILL");
    expect(projected.message).toContain("does not establish its cause");
    expect(projected.message).not.toContain("rea doctor");
    expect(projected.remediation.action).toContain(
      "host or container termination records",
    );
    expect(projected.remediation.action).not.toContain(
      "GHIDRA_HEADLESS_MAXMEM",
    );
    expect(projected.details?.diagnostics).toMatchObject({
      ...killed,
      ...extra,
    });
  });

  it("keeps an observed OOME primary over the kill", async () => {
    const projected = await projectFailure("process", {
      ...killed,
      stop_requested: false,
      failure_output: failureOutput(issueOutput),
      memory_cgroup: cgroup(1, 3_221_225_472),
    });
    expect(projected.message).toContain("Java heap space");
  });

  it.each(["timeout", "cancelled", "remote"] as const)(
    "does not reinterpret a %s failure that ended in SIGKILL",
    async (kind) => {
      const projected = await projectFailure(kind, {
        ...killed,
        stop_requested: false,
        memory_cgroup: cgroup(1, 3_221_225_472),
      });
      expect(projected.code).not.toBe("resource_constraint");
      expect(projected.message).not.toContain("SIGKILL");
    },
  );
});

it("reuses readiness only inside its active task and provider lifetime", async () => {
  let probes = 0;
  let version = "21.0.11";
  const base = installationHost();
  const ghidra = provider({
    ...base,
    probeJava: async (command, environment, options) => {
      probes++;
      const observed = await base.probeJava(command, environment, options);
      return observed.ok
        ? javaProbeOk({ ...observed.value, version })
        : observed;
    },
  });
  const scope = new ProviderInspectionScope();
  try {
    expect((await ghidra.inspectAvailability({ scope })).status).toBe(
      "available",
    );
    expect(
      (
        await ghidra.resolveAnalysisProfile(executableTarget("elf", "x86_64"), {
          scope,
        })
      ).ok,
    ).toBe(true);
    expect(probes).toBe(1);
    version = "21.0.12";
    expect(await ghidra.closeOwnedResources()).toMatchObject({ ok: true });
    expect(
      (await ghidra.inspectAvailability({ scope })).diagnostics.java_version,
    ).toBe(version);
    expect(probes).toBe(2);
    scope.close();
    version = "21.0.13";
    expect(
      (await ghidra.inspectAvailability({ scope })).diagnostics.java_version,
    ).toBe(version);
    expect(probes).toBe(3);
  } finally {
    scope.close();
    await ghidra.closeOwnedResources();
  }
});

it("refuses a changed installation before creating a target-bound native client", async () => {
  let release = "12.1.4",
    nativeCreates = 0;
  const ghidra = provider(
    {
      ...installationHost(),
      readText: () =>
        `application.version=${release}\napplication.java.min=21\n`,
    },
    () => {
      nativeCreates++;
      throw new Error("Changed installation must not create a native client");
    },
  );
  const target = executableTarget("elf", "x86_64");
  const resolved = await ghidra.resolveAnalysisProfile(target);
  if (!resolved.ok || resolved.value.profile === null)
    throw new Error("Expected initial profile");
  const client = ghidra.createClient(target, resolved.value.profile);
  release = "12.1.5";
  try {
    const result = await client.execute("analyze_function", {});
    if (result.ok) throw new Error("Changed installation was admitted");
    expect(result.error).toMatchObject({
      operation: "analyze_function",
      diagnostics: {
        selected_provider_version: "12.1.4",
        current_installation: { provider_version: "12.1.5" },
      },
    });
    expect(client.reuseReadiness?.()).toBe("blocked");
    expect(nativeCreates).toBe(0);
  } finally {
    await client.close();
    await ghidra.closeOwnedResources();
  }
});

it("rejects an absent profile before probing Java and attributes it to the requested operation", async () => {
  let probes = 0;
  const base = installationHost();
  const ghidra = provider({
    ...base,
    probeJava: (...args) => {
      probes++;
      return base.probeJava(...args);
    },
  });
  const client = ghidra.createClient(executableTarget("elf", "x86_64"));
  try {
    const result = await client.execute("analyze_function", {});
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "ProviderAdapterError", operation: "analyze_function" },
    });
    expect(probes).toBe(0);
  } finally {
    await client.close();
    await ghidra.closeOwnedResources();
  }
});

it.each([
  {
    layout: "crossed header interval",
    fixture: () => nativeAotPeHeaderIndirectionFixture(0x3fc),
    basis: "no-rtr-header",
  },
  {
    layout: "short optional header",
    fixture: () => nativeAotPeOptionalHeaderFixture(56),
    basis: "unsupported-layout",
  },
  {
    layout: "overlapping virtual sections",
    fixture: () => nativeAotPeVirtualSectionFixture(0x2000, 0x400),
    basis: "unsupported-layout",
  },
  {
    layout: "section overlapping headers",
    fixture: () => nativeAotPeVirtualSectionFixture(0x200, 0x80),
    basis: "unsupported-layout",
  },
])(
  "retains NativeAOT unsupported-layout facts for a $layout through the provider",
  async ({ fixture, basis }) => {
    const bytes = fixture();
    const observations = fixtureDosLoadImage().observation;
    observations.image_base = "0x140000000";
    const readSnapshot = vi.fn(async () =>
      ok({ kind: "captured" as const, bytes }),
    );
    const factory: GhidraProviderClientFactory = () => ({
      start: () =>
        Promise.resolve(
          ok({
            ...sessionInfo(),
            target: { ...sessionInfo().target, image_base: "0x140000000" },
          }),
        ),
      callTool: (operation) =>
        Promise.resolve(
          ok(
            jsonValueSchema.parse(
              operation === "inspect_native_load_image"
                ? observations
                : unavailableNativeAotDatabaseType("0x140002280"),
            ),
          ),
        ),
      readTargetSnapshot: readSnapshot,
      close: () => Promise.resolve(ok(null)),
    });
    const ghidra = provider(installationHost(), factory);
    const target = { ...peTarget("x86_64"), sha256: nativeAotPeDigest(bytes) };
    const profile = await ghidra.resolveAnalysisProfile(target);
    if (!profile.ok || profile.value.profile === null)
      throw new Error("Expected admitted PE profile");
    const client = ghidra.createClient(target, profile.value.profile);
    try {
      const result = await client.execute("inspect_native_load_image", {});
      expect(result).toMatchObject({
        ok: true,
        value: {
          result: {
            observations: {
              metadata_recovery: [
                {
                  status: "not_applicable",
                  header_address: null,
                  method_tables: 0,
                  analysis_artifact_sha256: target.sha256,
                  coverage: { basis },
                },
              ],
            },
          },
        },
      });
      const detail = await client.execute("inspect_native_data_type", {
        address: "0x140002280",
      });
      if (!detail.ok) throw detail.error;
      expect(detail.value.result).not.toHaveProperty("metadata_recovery");
      expect(readSnapshot).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
    }
  },
);

it.each([
  {
    unrelated: "INFO unrelated capacity: unable to create native thread",
    reported: "Java heap space",
    heapAdvice: true,
  },
  {
    unrelated: "INFO unrelated configuration: Java heap space",
    reported: "Metaspace",
    heapAdvice: false,
  },
])(
  "binds Ghidra OOME detail to the reporting line instead of unrelated output ($reported)",
  async ({ unrelated, reported, heapAdvice }) => {
    const projected = await projectFailure("process", {
      failure_output: failureOutput(
        `${unrelated}\njava.lang.OutOfMemoryError: ${reported}\n`,
      ),
      configured_jvm_max_heap: "4G",
    });
    expect(projected).toMatchObject({
      code: "resource_constraint",
      details: { resource: "memory" },
    });
    expect(projected.message).toContain(reported);
    expect(
      projected.remediation.action.includes("GHIDRA_HEADLESS_MAXMEM"),
    ).toBe(heapAdvice);
  },
);

it("does not infer a complete OOME token from a budget-cut text prefix", async () => {
  const projected = await projectFailure("process", {
    failure_output: {
      stdout: output("java.lang.OutOfMemoryError"),
      stderr: output(""),
      complete: false,
      observed_oome: [],
    },
  });
  expect(projected.code).toBe("execution_failure");
  expect(projected.message).toContain("a memory cause cannot be ruled out");
});

it.each([false, true])(
  "preserves valid OOME facts among malformed observations without inventing a constraint (confirmed=%s)",
  async (confirmed) => {
    const malformed: JsonValue[] = [
      null,
      {},
      { stream: "stderr", offset: 0, line: "" },
      { stream: "unknown", offset: 0, line: "java.lang.OutOfMemoryError" },
    ];
    const projected = await projectFailure("process", {
      failure_output: {
        complete: false,
        observed_oome: [
          ...malformed,
          ...(confirmed
            ? [
                {
                  stream: "stderr",
                  offset: 0,
                  line: "java.lang.OutOfMemoryError: Metaspace",
                },
              ]
            : []),
        ],
      },
    });
    expect(projected.code).toBe(
      confirmed ? "resource_constraint" : "execution_failure",
    );
    expect(projected.message).toContain(
      confirmed ? "Metaspace" : "a memory cause cannot be ruled out",
    );
  },
);

it("commits native coordinates independently of analyzer choices and preserves raw base identity", async () => {
  const resolve = async (ghidra: GhidraProvider, target: BinaryTarget) => {
    const resolved = await ghidra.resolveAnalysisProfile(target);
    if (!resolved.ok) throw resolved.error;
    if (resolved.value.profile === null)
      throw new Error("expected native profile");
    return resolved.value.profile;
  };
  const defaultProvider = provider();
  const configured = configuredProvider({
    REA_GHIDRA_DISABLED_ANALYZERS: "Decompiler Switch Analysis",
  });
  const target = executableTarget("elf", "x86_64");
  const baseline = await resolve(defaultProvider, target);
  const changedOptions = await resolve(configured, target);
  expect(baseline.parameters.function_coordinate_context).toEqual(
    createFunctionCoordinateContext({
      loader: "auto-from-header",
      language_id: "auto-from-header",
      compiler_spec_id: "auto-default",
      load_segment: null,
      address_coordinates: null,
      entry_point: null,
    }),
  );
  expect(baseline.digest).not.toBe(changedOptions.digest);
  expect(functionCoordinateContextsEqual(baseline, changedOptions)).toBe(true);
  const raw = fixtureRawBinaryLoadImage().target;
  const rawProfile = await resolve(defaultProvider, raw);
  const shifted = await resolve(defaultProvider, {
    ...raw,
    entryPoint: "0x8001000",
    entryPointSource: "0x8001000",
  });
  expect(rawProfile.parameters.function_coordinate_context).toMatchObject({
    kind: "native-function-coordinate-context-v1",
    selected_image: null,
    mapping_sha256: expect.any(String),
  });
  expect(functionCoordinateContextsEqual(rawProfile, shifted)).toBe(false);
});

it("session-observation failure clears only its resolved cleanup dependency after close retry", async () => {
  const retained = new ProviderCleanupError("ghidra", ["owned-session"], {
    reason: "fixture first close refused",
  });
  let closes = 0;
  let calls = 0;
  const ghidra = configuredProvider(
    { REA_GHIDRA_DISABLED_ANALYZERS: "Decompiler Switch Analysis" },
    () => ({
      start: async () => ok(sessionInfo()),
      callTool: async () => {
        calls++;
        return ok(null);
      },
      close: async () => {
        closes++;
        if (closes === 1) return err(retained);
        retained.resolveCleanup();
        return ok(null);
      },
    }),
  );
  const client = await createElfClient(ghidra);
  const failed = await client.execute("list_procedures", {});
  if (failed.ok) throw new Error("Missing analyzer observation accepted");
  expect(projectAnalysisError(failed.error)).toMatchObject({
    code: "cleanup_incomplete",
  });
  expect(calls).toBe(0);
  expect(await client.close()).toEqual({ ok: true, value: null });
  expect(closes).toBe(2);
  expect(failed.error.cleanupIncomplete).toBe(false);
  expect(projectAnalysisError(failed.error)).toMatchObject({
    code: "execution_failure",
  });
  await ghidra.closeOwnedResources();
});

it("reports every Windows existing-project capability unavailable before open", async () => {
  const ghidra = provider(installationHost("win32"), undefined, {
    REA_GHIDRA_PROJECT_PATH: join(process.cwd(), "selected.gpr"),
  });
  try {
    const capabilities = ghidra.capabilities();
    expect(capabilities.length).toBeGreaterThan(0);
    expect(
      capabilities.every(
        (capability) =>
          !capability.available &&
          capability.availabilityCode === "unsupported_host",
      ),
    ).toBe(true);
    const readiness = await ghidra.inspectReadinessSnapshot();
    expect(readiness.availability).toMatchObject({
      status: "unavailable",
      code: "unsupported_host",
      reason: EXISTING_PROJECT_WINDOWS_UNAVAILABLE,
    });
    expect(readiness.capabilities.map(({ operation }) => operation)).toEqual(
      capabilities.map(({ operation }) => operation),
    );
    expect(
      readiness.capabilities.every(
        (capability) =>
          !capability.available &&
          capability.availabilityCode === "unsupported_host",
      ),
    ).toBe(true);
  } finally {
    await ghidra.closeOwnedResources();
  }
});

it("reports an unsupported existing-project target as an invalid REA_GHIDRA_PROJECT_PATH setting", async () => {
  const ghidra = provider(installationHost(), undefined, {
    REA_GHIDRA_PROJECT_PATH: join(process.cwd(), "selected.gpr"),
  });
  try {
    const resolved = await ghidra.resolveAnalysisProfile({
      ...executableTarget("elf", "x86_64"),
      format: "dos-com",
    } as unknown as BinaryTarget);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error).toMatchObject({
      _tag: "ConfigurationError",
      settings: [{ setting: "REA_GHIDRA_PROJECT_PATH" }],
    });
  } finally {
    await ghidra.closeOwnedResources();
  }
});

it("keeps saved project reports as shared historical Evidence without applying fresh overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-history-project-"));
  await mkdir(join(root, "history.rep"));
  await writeFile(join(root, "history.gpr"), "marker");
  const prior = {
    analysis_seeds: {
      format: "rea-ghidra-seeds-v1" as const,
      sha256: "b".repeat(64),
      entries: 0,
      function_created: 0,
      function_existing: 0,
      function_failed: 0,
      code_decoded: 0,
      code_failed: 0,
      label_applied: 0,
      label_failed: 0,
      unmapped: 0,
    },
    disabled_analyzers: {
      format: "rea-ghidra-disabled-analyzers-v1" as const,
      analyzers: [
        { name: "Decompiler Parameter ID", status: "disabled" as const },
      ],
    },
  };
  const close = vi.fn(async () => ok(null));
  const ghidra = provider(
    installationHost(),
    () => ({
      start: async () =>
        ok({
          ...sessionInfo(),
          read_only: true,
          existing_project: true as const,
          analysis_complete: null,
          ...prior,
          capabilities: GHIDRA_SESSION_CAPABILITIES.filter(
            (name) => !GHIDRA_MUTATING_OPERATIONS.has(name),
          ),
        }),
      callTool: async () => ok([]),
      close,
    }),
    { REA_GHIDRA_PROJECT_PATH: join(root, "history.gpr") },
  );
  onTestFinished(async () => {
    await ghidra.closeOwnedResources();
    await rm(root, { recursive: true, force: true });
  });
  const target = executableTarget("elf", "x86_64");
  const resolved = await ghidra.resolveAnalysisProfile(target);
  if (!resolved.ok || resolved.value.profile === null)
    throw new Error("expected existing profile");
  const client = ghidra.createClient(target, resolved.value.profile);
  onTestFinished(async () => {
    await client.close();
  });
  const first = await client.execute("list_procedures", {});
  if (!first.ok) throw first.error;
  expect(close).not.toHaveBeenCalled();
  expect(first.value.sourceEvidence).toHaveLength(1);
  expect(first.value.sourceEvidence?.[0]).toMatchObject({
    operation: "health",
    normalized_result: { origin: "caller-project", ...prior },
  });
  const repeated = await client.execute("list_procedures", {});
  if (!repeated.ok) throw repeated.error;
  expect(repeated.value.sourceEvidence?.[0]).toBe(
    first.value.sourceEvidence?.[0],
  );
});

it.each(["search_procedures", "search_strings"] as const)(
  "%s applies shared folding after validation and preserves native source rows",
  async (operation) => {
    const rows = [
      { address: "0x1000", value: "ſource" },
      { address: "0x1001", value: "SOURCE" },
      { address: "0x1002", value: "İource" },
      { address: "0x1003", value: "unrelated" },
    ];
    const ghidra = provider(installationHost(), () => ({
      start: () => Promise.resolve(ok(sessionInfo())),
      callTool: () => Promise.resolve(ok(jsonValueSchema.parse(rows))),
      close: () => Promise.resolve(ok(null)),
    }));
    const client = await createElfClient(ghidra);
    try {
      const result = await client.execute(operation, { pattern: "source" });
      if (!result.ok) throw result.error;
      expect(result.value.result).toEqual(rows.slice(0, 2));
      expect(result.value.rawResult).toEqual(rows);
      const regex = await client.execute(operation, {
        pattern: "source",
        mode: "regex",
      });
      if (!regex.ok) throw regex.error;
      expect(regex.value.result).toEqual(rows);
      const sensitive = await client.execute(operation, {
        pattern: "source",
        case_sensitive: true,
      });
      if (!sensitive.ok) throw sensitive.error;
      expect(sensitive.value.result).toEqual(rows);
    } finally {
      await client.close();
    }
  },
);

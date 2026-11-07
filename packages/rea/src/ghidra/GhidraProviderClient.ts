import { filterGhidraLiteralCandidates } from "./GhidraLiteralSearch.js";
import { ghidraProjectHistoryEvidence } from "./GhidraProjectHistory.js";
import type { Evidence, EvidenceLocation } from "../domain/evidence.js";
import { ghidraProjectCommitmentSchema } from "./GhidraProjectSnapshot.js";
import { analysisSettingLimit } from "../domain/analysisSettingDefinitions.js";
import { z } from "zod";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { artifactFilePrimaryFacts } from "../artifacts/ArtifactFileOperation.js";
import { fileURLToPath } from "node:url";
import { GHIDRA_BRIDGE_SOURCES } from "./GhidraBridgeSources.js";

import {
  createAnalysisExecution,
  type AnalysisClient,
  type AnalysisClientContext,
  type AnalysisOperation,
  type ExecutionOptions,
} from "../application/AnalysisProvider.js";
import type { AppConfig } from "../config/types.js";
import {
  ghidraSeedCommitmentSchema,
  ghidraSeedFailure,
  ghidraSeedLimitations,
} from "./GhidraAnalysisSeeds.js";
import {
  ghidraPinnedLanguage,
  ghidraProfileDisabledAnalyzers,
  ghidraProfileLanguageOverride,
  ghidraProfilePinnedLanguage,
  sameGhidraDisabledAnalyzers,
  sameGhidraLanguageOverride,
} from "./GhidraAnalysisProfile.js";
import {
  ghidraDisabledAnalyzerFailure,
  ghidraDisabledAnalyzerLimitations,
} from "./GhidraDisabledAnalyzers.js";
import {
  ghidraMipsProfileMismatchReason,
  GHIDRA_MIPS_SOFT_FLOAT_STORAGE,
  ghidraMips1Limitations,
  ghidraMipsSoftFloatFailure,
  ghidraMipsRelocatableLimitations,
  ghidraMipsSharedLimitations,
  ghidraMipsSoftFloatLimitations,
  isGhidraMipsSoftFloatTarget,
} from "./GhidraMipsProfile.js";
import type { AnalysisProfileCommitment } from "../domain/analysisProfile.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import {
  AnalysisCancelledError,
  AnalysisArtifactChangedError,
  AnalysisAccessDeniedError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
  resourceConstraintRecovery,
} from "../domain/analysisErrorCore.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { RelationshipCoverage } from "../domain/relationshipCoverage.js";
import {
  providerRetryAction,
  type ProviderOperationHealth,
} from "../domain/providerOperationHealth.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";
import { ConfigurationError } from "../domain/configurationErrors.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { err, ok, type Result } from "../domain/result.js";
import type { Logger } from "pino";
import { GhidraClient } from "./GhidraClient.js";
import type { GhidraClientOptions } from "./GhidraClientTypes.js";
import {
  isGhidraFunctionOperation,
  parseGhidraFunctionInput,
  parseGhidraFunctionResult,
} from "./GhidraFunctionValues.js";
import {
  isGhidraInventoryOperation,
  parseGhidraInventoryInput,
  parseGhidraInventoryResult,
} from "./GhidraInventoryValues.js";
import {
  ghidraInstallationDiagnostics,
  type GhidraInstallationInspection,
} from "./GhidraInstallation.js";
import {
  isGhidraPspTarget,
  GHIDRA_PSP_LIMITATIONS,
} from "./GhidraPspProfile.js";
import { ghidraPspExtensionSchema } from "./GhidraPspExtension.js";
import {
  ghidraRiscvCallingConvention,
  ghidraRiscvCallingConventionFailure,
  ghidraRiscvCallingConventionLimitations,
  ghidraRiscvLimitations,
} from "./GhidraRiscvProfile.js";
import { ghidraPePdbLimitations } from "./GhidraPeProfile.js";
import { unverifiedGhidraBuildLimitation } from "./GhidraReleasePolicy.js";
import { GhidraHeadlessLauncher } from "./GhidraLauncher.js";
import { attestGhidraNativeLoadImage } from "./GhidraLoadImageAttest.js";
import type { NativeAotPeResult } from "../domain/native/nativeAotPe.js";
import { GhidraNativeAotSnapshotOwner } from "./GhidraNativeAotSnapshotOwner.js";
import {
  GHIDRA_PROVIDER_IDENTITY,
  ghidraHealthLimitations,
  windowsP0Limitations,
  limitationsFor,
} from "./GhidraProviderCapabilities.js";
import {
  GHIDRA_STARTUP_DEADLINE_ELAPSED,
  isGhidraInputFailureCode,
  type GhidraSessionError,
} from "./GhidraSessionError.js";
import {
  ghidraFileOffsetOutcome,
  ghidraFileOffsetUnavailable,
} from "./GhidraFileOffsetFailure.js";
import type { GhidraSessionInfo } from "./GhidraSessionValues.js";
import { ghidraExtensionFailure } from "./extensions/GhidraExtensionFailures.js";
import {
  ghidraExtensionSchema,
  validateGhidraExtensionProfile,
  ghidraExtensionLimitations,
} from "./extensions/GhidraExtensions.js";
import { inspectWindowsNativeReadiness } from "../process/WindowsAuthority.js";
import { ghidraRawBinaryLanguage } from "./GhidraRawBinaryLanguage.js";
import { ghidraDolLanguage, ghidraDolSectionFile } from "./GhidraDolProfile.js";

/** Production seam for exercising provider projection without a real process. */
export type GhidraProviderClientFactory = (
  options: GhidraClientOptions,
) => Pick<GhidraClient, "start" | "callTool" | "close"> &
  Partial<
    Pick<
      GhidraClient,
      | "callToolIfReady"
      | "operationHealthSnapshot"
      | "runtimeLineage"
      | "readTargetSnapshot"
      | "hashTargetSnapshot"
      | "hashTargetSnapshotRanges"
      | "attestDosTargetSnapshot"
    >
  >;

type GhidraProviderClientInstance = ReturnType<GhidraProviderClientFactory>;

interface GhidraExecutionMetadata {
  readonly sourceEvidence?: readonly Evidence[];
  readonly cachePolicy?: "live";
  readonly rawResult?: JsonValue;
  readonly limitations?: readonly string[];
  readonly locations?: readonly EvidenceLocation[];
  readonly relationshipCoverage?: RelationshipCoverage;
}

/** Build one AnalysisClient for an admitted Ghidra target and profile. */
export const createGhidraProviderClient = (input: {
  readonly config: AppConfig;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly logger: Logger;
  readonly clientFactory: GhidraProviderClientFactory;
  readonly admission: GhidraClientAdmission;
  readonly context?: AnalysisClientContext;
  readonly installation: GhidraInstallationInspection;
  readonly signal: AbortSignal;
}): Result<AnalysisClient, AnalysisError> => {
  const { config, logger, clientFactory, context, installation } = input;
  const { target, profile } = input.admission;
  const prerequisites = ghidraClientPrerequisites(profile, installation);
  if (!prerequisites.ok) return err(prerequisites.error);
  const committedProfile = prerequisites.value.profile;
  const psp = isGhidraPspTarget(target);
  const pspExtension = psp
    ? ghidraPspExtensionSchema.safeParse(
        committedProfile.parameters.psp_extension,
      )
    : null;
  if (
    pspExtension !== null &&
    (!pspExtension.success ||
      committedProfile.parameters.language_id !== "Allegrex:LE:32:default" ||
      committedProfile.parameters.loader !== "PspElfLoader")
  )
    return err(
      new ProviderAdapterError("ghidra", "open_binary", {
        diagnostics: {
          reason:
            "Resolve the supported PSP profile and installed Allegrex extension before opening the session.",
        },
      }),
    );
  const softFloat = isGhidraMipsSoftFloatTarget(target);
  if (
    softFloat !==
    (committedProfile.parameters.mips_soft_float_storage ===
      GHIDRA_MIPS_SOFT_FLOAT_STORAGE)
  )
    return err(
      new ProviderAdapterError("ghidra", "open_binary", {
        diagnostics: {
          reason:
            "Resolve the soft-float MIPS storage policy into the analysis profile before opening the session.",
        },
      }),
    );
  const riscvCallingConvention = ghidraRiscvCallingConvention(target);
  if (
    riscvCallingConvention !==
    committedProfile.parameters.riscv_calling_convention
  )
    return err(
      new ProviderAdapterError("ghidra", "open_binary", {
        diagnostics: {
          reason:
            "Resolve the RISC-V calling-convention policy into the analysis profile before opening the session.",
        },
      }),
    );
  const extensionProfile = ghidraExtensionSchema
    .array()
    .safeParse(committedProfile.parameters.analysis_extensions ?? []);
  if (
    !extensionProfile.success ||
    (config.ghidraNativeAotJar !== undefined &&
      extensionProfile.data.length === 0)
  )
    return err(
      new ProviderAdapterError("ghidra", "open_binary", {
        diagnostics: {
          reason:
            "Resolve the configured Ghidra extensions into an analysis profile before opening the session.",
        },
      }),
    );
  const extensions = extensionProfile.data;
  const projectProfile = ghidraProjectCommitmentSchema
    .optional()
    .safeParse(committedProfile.parameters.existing_project);
  if (
    !projectProfile.success ||
    (config.ghidraExistingProject === undefined) !==
      (projectProfile.data === undefined) ||
    (projectProfile.data !== undefined &&
      (projectProfile.data.configured_path !==
        config.ghidraExistingProject?.path ||
        (config.ghidraExistingProject?.programName !== undefined &&
          config.ghidraExistingProject.programName !==
            projectProfile.data.program_name)))
  )
    return err(
      new ProviderAdapterError("ghidra", "open_binary", {
        diagnostics: {
          reason:
            "Resolve the selected Ghidra project into a fresh analysis profile before opening the session.",
        },
      }),
    );
  const project = projectProfile.data;
  const projection: GhidraProjection = {
    limits: config,
    programName: project?.program_name,
  };
  const seedProfile = ghidraSeedCommitmentSchema
    .optional()
    .safeParse(committedProfile.parameters.analysis_seeds);
  if (
    !seedProfile.success ||
    (config.ghidraSeedFile === undefined) !== (seedProfile.data === undefined)
  )
    return err(
      new ProviderAdapterError("ghidra", "open_binary", {
        diagnostics: {
          reason:
            "Resolve REA_GHIDRA_SEED_FILE into an analysis profile before opening the session.",
        },
      }),
    );
  const seeds = seedProfile.data;
  const parameterLanguage = ghidraProfileLanguageOverride(
    committedProfile.parameters,
  );
  const pinnedLanguage = ghidraProfilePinnedLanguage(
    committedProfile.parameters,
  );
  const targetLanguage = ghidraPinnedLanguage(target);
  if (pinnedLanguage !== undefined && targetLanguage === undefined)
    return err(
      new ProviderAdapterError("ghidra", "open_binary", {
        diagnostics: {
          reason: `The committed profile pins the ${pinnedLanguage.languageId} language, which the current target does not establish; reopen an admitted target to resolve a new profile.`,
        },
      }),
    );
  // Provider-pinned profiles declare their language through the same
  // parameter slot caller-configured profiles use, so only an environment
  // override conflicts with the pin; the slot itself carries it.
  if (
    pinnedLanguage !== undefined &&
    config.ghidraLanguageOverride !== undefined
  )
    return err(
      new ProviderAdapterError("ghidra", "open_binary", {
        diagnostics: {
          reason: `The committed profile pins its import language, ${pinnedLanguage.languageId}; REA_GHIDRA_LANGUAGE_ID/REA_GHIDRA_COMPILER_SPEC_ID cannot be combined with it. Reopen the target without the override.`,
        },
      }),
    );
  if (
    !sameGhidraLanguageOverride(
      parameterLanguage,
      config.ghidraLanguageOverride ?? targetLanguage,
    )
  )
    return err(
      new ProviderAdapterError("ghidra", "open_binary", {
        diagnostics: {
          reason:
            "The committed analysis profile and REA_GHIDRA_LANGUAGE_ID/REA_GHIDRA_COMPILER_SPEC_ID differ; reopen the target to resolve a new profile.",
        },
      }),
    );
  // Both caller-selected and provider-pinned languages use the validated
  // committed slot; the profile cannot supply its own applicability proof.
  const mipsProfileMismatch = ghidraMipsProfileMismatchReason(
    target,
    committedProfile.parameters,
  );
  if (mipsProfileMismatch !== null)
    return err(
      new ProviderAdapterError("ghidra", "open_binary", {
        diagnostics: { reason: mipsProfileMismatch },
      }),
    );
  const importLanguage = parameterLanguage;
  const disabledAnalyzers = ghidraProfileDisabledAnalyzers(
    committedProfile.parameters,
  );
  if (
    !sameGhidraDisabledAnalyzers(
      disabledAnalyzers,
      config.ghidraDisabledAnalyzers,
    )
  )
    return err(
      new ProviderAdapterError("ghidra", "open_binary", {
        diagnostics: {
          reason:
            "The committed analysis profile and REA_GHIDRA_DISABLED_ANALYZERS differ; reopen the target to resolve a new profile.",
        },
      }),
    );

  const invalidProfile = validateGhidraExtensionProfile(
    extensions,
    config,
    target,
    installation.platform,
  );
  if (invalidProfile !== null)
    return err(
      new ProviderAdapterError("ghidra", "open_binary", {
        diagnostics: { reason: invalidProfile },
      }),
    );
  let extensionFailure: AnalysisError | undefined;
  // Replaced by the reported outcome once the session handshake is checked.
  const seedLimitations: string[] = [...ghidraSeedLimitations(seeds)];
  const pdbLimitations: string[] = [];
  // Replaced by the reported storage outcome once the handshake is checked.
  const softFloatLimitations: string[] = [
    ...ghidraMipsSoftFloatLimitations(softFloat),
  ];
  // Replaced by the reported prototype outcome once the handshake is checked.
  const riscvCallingConventionLimitations: string[] = [
    ...ghidraRiscvCallingConventionLimitations(riscvCallingConvention),
  ];
  // Replaced by the reported per-program outcome once the handshake is checked.
  const disabledAnalyzerLimitations: string[] = [];
  const rawLanguage =
    target.format === "raw-binary"
      ? ghidraRawBinaryLanguage(target.architecture)
      : undefined;
  const targetLimitations = [
    ...(target.format === "dos-mz"
      ? [
          "DOS MZ uses 16-bit x86 real mode with the Ghidra load segment 0x1000. Returned addresses are linear byte coordinates; they do not identify a unique segment:offset alias.",
          "Static DOS analysis does not emulate BIOS, DOS interrupts, device ports, or self-modifying unpacking code. Packed targets require a separately identified unpacked artifact for original-program analysis; appended overlays are not the initialized load module.",
        ]
      : []),
    ...(target.format === "gamecube-dol"
      ? [
          "GameCube DOL analysis maps the header's text and data sections at their load addresses; file bytes outside those sections (the 256-byte header and any padding) are not mapped.",
          "The default language is stock Ghidra PowerPC:BE:32:default. Broadway-specific paired-single and Gekko instructions are not decoded unless REA_GHIDRA_LANGUAGE_ID selects an installed variant such as PowerPC:BE:32:Gekko_Broadway.",
          "BSS is mapped uninitialized only outside the data sections it overlaps. The DOL header is not an identification of the producing SDK, and no runtime initialization, OS, or hardware state is modeled.",
        ]
      : []),
    ...(target.format === "raw-binary"
      ? [
          "Headerless raw-binary analysis uses the caller-supplied architecture and entry address; file offset 0 is mapped at that address. Headers are not discovered from file bytes.",
          "Little-endian generic Ghidra languages are used for x86, x86_64, arm, arm64, and NMOS 6502; m68k uses the big-endian 68000 default language, which decodes the 68040 superset. Big-endian ARM, Thumb-only, Cortex-M, 65C02, 65816, separate 68020/68030/CPU32/ColdFire variants, and other processor variants are unsupported in this increment.",
          "Static analysis does not emulate reset vectors, memory-mapped I/O, or firmware boot sequences.",
        ]
      : []),
    ...(target.architecture === "mips" ? (target.mips.limitations ?? []) : []),
    ...(committedProfile.parameters.mips_abi_basis ===
    "inferred-o32-assumption-v1"
      ? [
          "The ELF header declares no ABI field and no ABI flags record was observed; o32 calling conventions are an analysis assumption of this lane, not a declared fact.",
          "Floating-point ABI semantics are unverified for this recordless legacy admission.",
        ]
      : []),
    ...ghidraMips1Limitations(
      target,
      importLanguage,
      pinnedLanguage !== undefined,
    ),
    ...ghidraMipsRelocatableLimitations(target),
    ...ghidraMipsSharedLimitations(target),
    ...ghidraRiscvLimitations(target),
  ];
  const providerLimitations =
    installation.platform === "win32"
      ? windowsP0Limitations
      : installation.platform === "darwin"
        ? [
            "macOS sessions require a matching executable Ghidra native decompiler; REA checks for it but does not build native components or change Gatekeeper quarantine state.",
          ]
        : [];
  if (input.signal.aborted)
    return err(
      new AnalysisCancelledError("create_analysis_client", {
        cause: input.signal.reason,
        diagnostics: ghidraInstallationDiagnostics(installation),
      }),
    );
  const client = clientFactory({
    startupTimeoutMs: config.ghidraStartupTimeoutMs,
    readStartupTimeoutMs: () => config.ghidraStartupTimeoutMs,
    bridgeMaxRequestBytes: config.bridgeMaxRequestBytes,
    platform: installation.platform,
    ...(project === undefined ? {} : { existingProject: true }),
    launcher: new GhidraHeadlessLauncher({
      ...(project === undefined
        ? {}
        : {
            existingProject: {
              projectPath: project.project_path,
              projectName: project.project_name,
              programName: project.program_name,
              sha256: project.sha256,
            },
          }),
      environment: input.environment,
      analyzeHeadlessPath: prerequisites.value.analyzeHeadlessPath,
      configurationDirectoryName:
        prerequisites.value.configurationDirectoryName,
      javaHome: prerequisites.value.javaHome,
      ...(installation.javaVmName === undefined
        ? {}
        : { javaVmName: installation.javaVmName }),
      bridgeScriptPath: fileURLToPath(
        new URL(
          `../../bridge/ghidra/${GHIDRA_BRIDGE_SOURCES.bridge}`,
          import.meta.url,
        ),
      ),
      ...(pspExtension?.success === true
        ? { pspExtension: pspExtension.data }
        : {}),
      ...(softFloat ? { mipsSoftFloat: true as const } : {}),
      ...(riscvCallingConvention === undefined
        ? {}
        : { riscvCallingConvention }),
      ...(target.format === "dos-mz" ? { dosMz: true } : {}),
      ...(target.format === "dos-com" ? { dosCom: true } : {}),
      ...(rawLanguage === undefined || target.format !== "raw-binary"
        ? {}
        : {
            rawBinary: {
              languageId: rawLanguage.languageId,
              compilerSpecId: rawLanguage.compilerSpecId,
              baseAddr: target.entryPoint,
            },
          }),
      ...(target.format === "gamecube-dol"
        ? {
            gamecubeDol: {
              ...ghidraDolLanguage(importLanguage),
              sectionFile: ghidraDolSectionFile(target.dol),
            },
          }
        : importLanguage === undefined
          ? {}
          : { languageOverride: importLanguage }),
      ...(config.ghidraDisabledAnalyzers === undefined
        ? {}
        : { disabledAnalyzers: config.ghidraDisabledAnalyzers }),
      ...(config.ghidraDecompileTimeoutSeconds === undefined
        ? {}
        : { decompileTimeoutSeconds: config.ghidraDecompileTimeoutSeconds }),
      ...(seeds === undefined ? {} : { analysisSeeds: seeds }),
      platform: installation.platform,
      ...(extensions.length === 0 ? {} : { analysisExtensions: extensions }),
    }),
    targetPath:
      installation.platform === "win32"
        ? (target.sourcePath ?? target.path)
        : target.path,
    targetSha256: target.sha256,
    transport:
      installation.platform === "win32"
        ? "authenticated-loopback-tcp"
        : "unix-socket",
    providerVersion: prerequisites.value.providerVersion,
    profileDigest: committedProfile.digest,
    ...(["dos-mz", "dos-com"].includes(target.format)
      ? {
          expectedLanguageId: "x86:LE:16:Real Mode",
          expectedCompilerSpecId: "default",
        }
      : rawLanguage === undefined
        ? importLanguage === undefined
          ? {}
          : {
              expectedLanguageId: importLanguage.languageId,
              ...(importLanguage.compilerSpecId === undefined
                ? {}
                : { expectedCompilerSpecId: importLanguage.compilerSpecId }),
            }
        : {
            expectedLanguageId: rawLanguage.languageId,
            expectedCompilerSpecId: rawLanguage.compilerSpecId,
          }),
    ...(psp
      ? {
          expectedLanguageId: "Allegrex:LE:32:default",
          expectedCompilerSpecId: "default",
        }
      : {}),
    ...(context === undefined ? {} : { runId: context.runId }),
    logger: logger.child({ layer: "ghidra-bridge" }),
  });
  // Startup failures retain installation guidance; only a previously running
  // provider can be described as lost and reopened.
  let providerStarted = false;
  const lostProviderHealth = (): ProviderOperationHealth | undefined =>
    providerStarted ? client.operationHealthSnapshot?.() : undefined;
  let projectHistory: Evidence | undefined;
  const checkSessionObservations = async (
    operation: AnalysisOperation,
    info: GhidraSessionInfo,
  ): Promise<AnalysisError | undefined> => {
    if (target.format === "pe") {
      pdbLimitations.splice(
        0,
        pdbLimitations.length,
        ...ghidraPePdbLimitations(target, info.pdb),
      );
    }
    if (project !== undefined) {
      extensionFailure = ghidraExtensionFailure(
        extensions,
        info.analysis_extensions ?? [],
        operation,
      );
      if (extensionFailure === undefined)
        projectHistory ??= ghidraProjectHistoryEvidence(
          target,
          committedProfile,
          info,
        );
    } else {
      const callingConventionReason =
        ghidraMipsSoftFloatFailure(softFloat, info.mips_soft_float_storage) ??
        ghidraRiscvCallingConventionFailure(
          riscvCallingConvention,
          info.riscv_calling_convention,
        );
      extensionFailure =
        ghidraExtensionFailure(
          extensions,
          info.analysis_extensions ?? [],
          operation,
        ) ??
        ghidraSeedFailure(seeds, info.analysis_seeds, operation) ??
        ghidraDisabledAnalyzerFailure(
          disabledAnalyzers,
          info.disabled_analyzers,
          operation,
        ) ??
        (callingConventionReason === undefined
          ? undefined
          : new ProviderAdapterError("ghidra", operation, {
              diagnostics: { reason: callingConventionReason },
            }));
      if (extensionFailure === undefined && info.analysis_seeds !== undefined)
        seedLimitations.splice(
          0,
          seedLimitations.length,
          ...ghidraSeedLimitations(seeds, info.analysis_seeds),
        );
      if (extensionFailure === undefined)
        softFloatLimitations.splice(
          0,
          softFloatLimitations.length,
          ...ghidraMipsSoftFloatLimitations(
            softFloat,
            info.mips_soft_float_storage,
          ),
        );
      if (extensionFailure === undefined)
        riscvCallingConventionLimitations.splice(
          0,
          riscvCallingConventionLimitations.length,
          ...ghidraRiscvCallingConventionLimitations(
            riscvCallingConvention,
            info.riscv_calling_convention,
          ),
        );
      if (extensionFailure === undefined)
        disabledAnalyzerLimitations.splice(
          0,
          disabledAnalyzerLimitations.length,
          ...ghidraDisabledAnalyzerLimitations(info.disabled_analyzers),
        );
    }
    if (extensionFailure === undefined) return undefined;
    const closed = await client.close();
    return closed.ok
      ? extensionFailure
      : analysisErrorWithCleanupFailure(
          extensionFailure,
          closed.error,
          operation,
        ).bindCleanupDependencies([extensionFailure, closed.error]);
  };
  const startSession = async (
    operation: AnalysisOperation,
    options?: ExecutionOptions,
  ): Promise<Result<GhidraSessionInfo, AnalysisError>> => {
    const started = await client.start(options?.signal, options?.progress);
    if (!started.ok)
      return err(
        projectSessionError(
          operation,
          started.error,
          projection,
          lostProviderHealth(),
        ),
      );
    providerStarted = true;
    const failed = await checkSessionObservations(operation, started.value);
    return failed === undefined ? started : err(failed);
  };
  const releaseLimitation = unverifiedGhidraBuildLimitation(
    prerequisites.value.providerVersion,
  );
  const sessionLimitations = (): readonly string[] => [
    ...providerLimitations,
    ...targetLimitations,
    ...(psp ? GHIDRA_PSP_LIMITATIONS : []),
    ...softFloatLimitations,
    ...riscvCallingConventionLimitations,
    ...ghidraExtensionLimitations(extensions),
    ...seedLimitations,
    ...disabledAnalyzerLimitations,
    ...pdbLimitations,
    ...(releaseLimitation === undefined ? [] : [releaseLimitation]),
  ];
  const nativeAotOwner =
    target.format === "pe"
      ? new GhidraNativeAotSnapshotOwner({
          targetSha256: target.sha256,
          targetPath: target.path,
          readSnapshot: client.readTargetSnapshot?.bind(client),
          projectFailure: (operation, failure) =>
            projectSessionError(operation, failure, projection),
        })
      : undefined;
  const projectExecution = (
    operation: AnalysisOperation,
    normalized: JsonValue,
    observation: GhidraExecutionMetadata = {},
  ) => {
    return createAnalysisExecution(normalized, committedProfile.provider, {
      ...observation,
      ...(projectHistory === undefined
        ? {}
        : {
            sourceEvidence: [
              ...(observation.sourceEvidence ?? []),
              projectHistory,
            ],
          }),
      analysisProfile: committedProfile,
      limitations: [
        ...limitationsFor(operation, project !== undefined),
        ...(observation.limitations ?? []),
        ...sessionLimitations(),
      ],
    });
  };
  const inventoryExecution = (
    operation: "list_documents" | "list_procedures",
    called: Result<JsonValue, GhidraSessionError>,
  ) => {
    if (!called.ok)
      return err(
        projectSessionError(
          operation,
          called.error,
          projection,
          lostProviderHealth(),
        ),
      );
    const parsed = parseGhidraInventoryResult(operation, called.value);
    if (!parsed.ok) return parsed;
    const { value, ...observation } = parsed.value;
    return ok(projectExecution(operation, value, observation));
  };
  const loadImageExecution = async (raw: JsonValue, signal?: AbortSignal) => {
    const operation = "inspect_native_load_image";
    const measured = parseGhidraInventoryResult(operation, raw);
    if (!measured.ok) return measured;
    const { value: observed, ...observation } = measured.value;
    let derived: NativeAotPeResult | undefined;
    if (target.format === "pe") {
      if (nativeAotOwner === undefined)
        return err(
          new ProviderAdapterError("ghidra", operation, {
            diagnostics: {
              reason:
                "The admitted PE session has no read-only NativeAOT snapshot owner.",
            },
          }),
        );
      const result = await nativeAotOwner.derive(
        observed.image_base,
        operation,
        signal,
        raw,
      );
      if (!result.ok) return result;
      derived = result.value;
    }
    const attested = await attestGhidraNativeLoadImage({
      target,
      operation,
      measured: observed,
      client,
      languageOverride: importLanguage,
      mapSessionError: (failure) =>
        projectSessionError(
          operation,
          failure,
          projection,
          lostProviderHealth(),
        ),
      nativeAotResult: derived,
      signal,
    });
    return attested.ok
      ? ok(
          projectExecution(
            operation,
            jsonValueSchema.parse(attested.value),
            observation,
          ),
        )
      : attested;
  };
  return ok<AnalysisClient>({
    execute: async (operation, parameters, options) => {
      if (extensionFailure !== undefined) return err(extensionFailure);
      if (
        operation !== "health" &&
        !isGhidraInventoryOperation(operation) &&
        !isGhidraFunctionOperation(operation)
      )
        return err(
          new AnalysisCapabilityUnavailableError(
            GHIDRA_PROVIDER_IDENTITY.id,
            operation,
            "The Ghidra adapter does not declare this operation.",
          ),
        );
      if (operation === "health") {
        const started = await startSession(operation, options);
        if (!started.ok) return started;
        return ok(
          createAnalysisExecution(started.value, committedProfile.provider, {
            analysisProfile: committedProfile,
            limitations: [
              ...ghidraHealthLimitations(project !== undefined),
              ...sessionLimitations(),
            ],
          }),
        );
      }
      const input = isGhidraFunctionOperation(operation)
        ? parseGhidraFunctionInput(operation, parameters)
        : parseGhidraInventoryInput(operation, parameters);
      if (!input.ok) return input;
      if (
        project !== undefined ||
        target.format === "pe" ||
        extensions.length > 0 ||
        seeds !== undefined ||
        disabledAnalyzers !== undefined ||
        softFloat ||
        riscvCallingConvention !== undefined
      ) {
        const started = await startSession(operation, options);
        if (!started.ok) return started;
      }
      const called = await client.callTool(operation, input.value, {
        decompileTimeoutSeconds: config.ghidraDecompileTimeoutSeconds ?? null,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        ...(options?.progress === undefined
          ? {}
          : { progress: options.progress }),
      });
      if (called.ok) providerStarted = true;
      if (operation === "list_documents" || operation === "list_procedures")
        return inventoryExecution(operation, called);
      if (!called.ok)
        return err(
          projectSessionError(
            operation,
            called.error,
            projection,
            lostProviderHealth(),
            input.value,
          ),
        );
      if (operation === "inspect_native_load_image")
        return loadImageExecution(called.value, options?.signal);
      const result = isGhidraFunctionOperation(operation)
        ? parseGhidraFunctionResult(operation, called.value)
        : parseGhidraInventoryResult(operation, called.value);
      if (!result.ok) return result;
      let { value: normalized, ...observation } = result.value;
      if (
        (operation === "search_procedures" || operation === "search_strings") &&
        input.value.mode === "literal" &&
        input.value.case_sensitive === false &&
        typeof input.value.pattern === "string"
      ) {
        normalized = filterGhidraLiteralCandidates(
          normalized,
          input.value.pattern,
        );
        observation = { ...observation, rawResult: called.value };
      }
      if (
        operation === "inspect_native_data_type" &&
        normalized !== null &&
        typeof normalized === "object" &&
        !Array.isArray(normalized) &&
        normalized.metadata_recovery === undefined
      ) {
        // The bridge owns address-space resolution. Enrich its parsed identity;
        // request parameters retain the caller's spelling.
        const address = normalized.address;
        if (typeof address === "string") {
          if (target.format === "pe" && nativeAotOwner !== undefined) {
            const started = await client.start(
              options?.signal,
              options?.progress,
            );
            if (!started.ok)
              return err(
                projectSessionError(
                  operation,
                  started.error,
                  projection,
                  lostProviderHealth(),
                ),
              );
            const derived = await nativeAotOwner.derive(
              started.value.target.image_base,
              operation,
              options?.signal,
              normalized,
            );
            if (!derived.ok) return derived;
          }
          const metadata = nativeAotOwner?.readTypeDetail(address);
          if (metadata !== undefined) {
            // Preserve the database reply independently of the derived overlay.
            observation = { ...observation, rawResult: called.value };
            normalized = jsonValueSchema.parse({
              ...normalized,
              metadata_recovery: metadata,
            });
          }
        }
      }
      return ok(projectExecution(operation, normalized, observation));
    },
    executeIfReady: async (operation, parameters, options) => {
      if (operation !== "list_documents" && operation !== "list_procedures")
        return undefined;
      if (extensionFailure !== undefined) return err(extensionFailure);
      const input = parseGhidraInventoryInput(operation, parameters);
      if (!input.ok) return input;
      if (client.callToolIfReady === undefined) return undefined;
      const called = await client.callToolIfReady(
        operation,
        input.value,
        options?.signal === undefined ? {} : { signal: options.signal },
      );
      if (called === undefined) return undefined;
      return inventoryExecution(operation, called);
    },
    operationHealthSnapshot: () => client.operationHealthSnapshot?.(),
    runtimeLineageSnapshots: () => {
      const observation = client.runtimeLineage?.() ?? null;
      return observation === null
        ? []
        : [{ provider: committedProfile.provider, observation }];
    },
    close: async () => {
      await nativeAotOwner?.close();
      const closed = await client.close();
      const retained = nativeAotOwner?.cleanupFailure;
      if (retained === undefined) return closed;
      return closed.ok
        ? err(retained)
        : err(
            analysisErrorWithCleanupFailure(
              closed.error,
              retained,
            ).bindCleanupDependencies([closed.error, retained]),
          );
    },
  });
};

interface GhidraClientCoordinates {
  readonly analyzeHeadlessPath: string;
  readonly configurationDirectoryName: string | null;
  readonly javaHome: string;
  readonly providerVersion: string;
  readonly profile: AnalysisProfileCommitment;
}

export interface GhidraClientAdmission {
  readonly target: Extract<BinaryTarget, { readonly kind: "executable" }>;
  readonly profile: AnalysisProfileCommitment;
}

/** Admit caller inputs and native authority before Java work starts. */
export const admitGhidraClient = (
  target: BinaryTarget,
  profile: AnalysisProfileCommitment | undefined,
  platform: NodeJS.Platform,
): Result<GhidraClientAdmission, AnalysisError> => {
  if (target.kind !== "executable")
    return err(
      new AnalysisCapabilityUnavailableError(
        "ghidra",
        "health",
        `Ghidra cannot import ${target.kind} targets through this adapter.`,
      ),
    );
  if (platform === "win32") {
    const readiness = inspectWindowsNativeReadiness(platform);
    if (!readiness.available)
      return err(
        new AnalysisCapabilityUnavailableError(
          "ghidra",
          "health",
          readiness.reason,
        ),
      );
  }
  if (profile === undefined || profile.provider.id !== "ghidra")
    return err(new ProviderAdapterError("ghidra", "health"));
  return ok({ target, profile });
};

const ghidraClientPrerequisites = (
  profile: AnalysisProfileCommitment,
  installation: GhidraInstallationInspection,
): Result<GhidraClientCoordinates, AnalysisError> => {
  if (installation.status === "unavailable")
    return err(
      new ProviderAdapterError("ghidra", "health", {
        diagnostics: ghidraInstallationDiagnostics(installation),
      }),
    );
  const readiness =
    installation.platform === "win32"
      ? inspectWindowsNativeReadiness(installation.platform)
      : undefined;
  if (readiness?.available === false)
    return err(
      new AnalysisCapabilityUnavailableError(
        "ghidra",
        "health",
        readiness.reason,
      ),
    );
  if (profile.provider.version !== installation.providerVersion)
    return err(
      new ProviderAdapterError("ghidra", "health", {
        diagnostics: {
          reason:
            "The current installation version differs from the selected analysis profile; resolve the profile again.",
          selected_provider_version: profile.provider.version,
          current_installation: ghidraInstallationDiagnostics(installation),
        },
      }),
    );
  return ok({
    analyzeHeadlessPath: installation.analyzeHeadlessPath,
    configurationDirectoryName: installation.configurationDirectoryName,
    javaHome: installation.javaHome,
    providerVersion: installation.providerVersion,
    profile,
  });
};

/** Configured deadlines that Ghidra failure projections name. */
type GhidraProjectionLimits = Pick<
  AppConfig,
  | "ghidraStartupTimeoutMs"
  | "ghidraDecompileTimeoutSeconds"
  | "ghidraExistingProject"
>;

/** Projection inputs: live configured limits and the program passed to `-process`. */
interface GhidraProjection {
  readonly limits: GhidraProjectionLimits;
  readonly programName: string | undefined;
}

const projectSessionError = (
  operation: AnalysisOperation,
  failure: GhidraSessionError,
  projection: GhidraProjection,
  health?: ProviderOperationHealth,
  request?: Readonly<Record<string, JsonValue>>,
): AnalysisError => {
  const primary = projectPrimarySessionError(
    operation,
    failure,
    projection,
    health,
    request,
  );
  return failure.cleanupFailure === undefined
    ? primary
    : analysisErrorWithCleanupFailure(
        primary,
        failure.cleanupFailure,
        operation,
      ).bindCleanupDependencies([primary, failure.cleanupFailure]);
};

const projectPrimarySessionError = (
  operation: AnalysisOperation,
  failure: GhidraSessionError,
  { limits, programName }: GhidraProjection,
  health?: ProviderOperationHealth,
  request?: Readonly<Record<string, JsonValue>>,
): AnalysisError => {
  const startupTimeoutMs = limits.ghidraStartupTimeoutMs;
  const context = {
    cause: failure,
    diagnostics: failure.diagnostics,
    ...(failure.partialObservation === undefined
      ? {}
      : { partialObservation: failure.partialObservation }),
  };
  const { cause: physicalCause, origin } = artifactFilePrimaryFacts(
    failure.cause,
  );
  // A client-side ceiling refusal travels as the cause; re-attribute it to this
  // operation so callers see a typed resource constraint rather than a generic
  // session failure, matching how Hopper and Cutter report the same ceiling.
  if (physicalCause instanceof AnalysisResourceConstraintError)
    return new AnalysisResourceConstraintError(
      operation,
      physicalCause.resource,
      physicalCause.reason,
      physicalCause.reportedLimits,
      { ...context, ...resourceConstraintRecovery(physicalCause) },
    );
  if (
    origin === "owned-or-classified" &&
    physicalCause instanceof AnalysisAccessDeniedError
  )
    return new AnalysisAccessDeniedError(
      operation,
      physicalCause.path,
      physicalCause.systemCode,
      context,
    );
  if (
    origin === "owned-or-classified" &&
    physicalCause instanceof AnalysisArtifactChangedError
  )
    return new AnalysisArtifactChangedError(
      operation,
      physicalCause.path,
      physicalCause.reason,
      context,
    );
  // A well-formed address that lacks one exact source offset keeps the
  // bridge's reason and the caller's exact spelling, not schema advice.
  const fileOffset =
    failure.kind === "remote"
      ? ghidraFileOffsetOutcome(failure.remoteCode)
      : undefined;
  if (fileOffset !== undefined)
    return ghidraFileOffsetUnavailable(
      operation,
      fileOffset,
      failure.message,
      typeof request?.address === "string" ? request.address : undefined,
      context,
    );
  if (
    operation === "annotate_native_function" &&
    failure.kind === "remote" &&
    failure.remoteCode === "invalid_function_name"
  )
    return new AnalysisInputError(operation, context, [
      { path: ["name"], reason: "invalid_value", message: failure.message },
    ]);
  if (
    failure.kind === "cancelled" ||
    (failure.kind === "remote" && failure.remoteCode === "decompile_cancelled")
  )
    return new AnalysisCancelledError(operation, {
      ...context,
      cause:
        failure.cancellation === undefined
          ? failure
          : failure.cancellation.reason,
    });
  if (failure.kind === "remote" && failure.remoteCode === "decompile_failed")
    return new ProviderAdapterError("ghidra", operation, {
      ...context,
      userMessage: `${failure.message.trim().replace(/\.$/u, "")}. ${ghidraSessionContinuationMessage(
        failure,
        "Only the decompiler failed for this procedure; the Ghidra session remains usable.",
      )}`,
      remediationAction:
        "Call analyze_function (CLI: `rea function`) for the same procedure. It returns assembly, callers, callees, references and basic blocks from the Ghidra listing and records this decompiler failure under facet_availability.pseudocode. Repeating the unchanged decompile request is not expected to succeed.",
    });
  // A request-level deadline, not a provider failure: other operations stay
  // available. Only promise session reuse when no caller cancellation closed
  // the session while the timeout settled.
  if (
    failure.kind === "remote" &&
    failure.remoteCode === "decompile_timed_out" &&
    limits.ghidraDecompileTimeoutSeconds !== undefined
  )
    return new AnalysisTimeoutError(
      operation,
      limits.ghidraDecompileTimeoutSeconds * 1000,
      {
        ...context,
        limit: analysisSettingLimit(
          "ghidra.decompile_timeout_seconds",
          limits.ghidraDecompileTimeoutSeconds,
          undefined,
        ),
        userMessage: `${failure.message.trim().replace(/\.$/u, "")}. ${ghidraSessionContinuationMessage(
          failure,
          "Only this procedure's decompilation was stopped; the Ghidra session remains usable.",
        )}`,
        remediationAction:
          "Use analyze_function (CLI: `rea function`) for listing facts. Call update_analysis_settings with setting ghidra.decompile_timeout_seconds and action set to raise the per-function deadline for the next operation on this Program. For CLI or future REA processes, set REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS. Set the MCP tool-call deadline to cover startup and the full call; earlier cancellation closes the session. `rea setup` estimates deadlines for new Codex/Kimi registrations and preserves existing positive values; edit existing deadlines yourself.",
      },
    );
  if (failure.kind === "analysis_timeout")
    return new AnalysisTimeoutError(
      operation,
      failure.timeoutMs ?? startupTimeoutMs,
      context,
    );
  if (
    failure.kind === "remote" &&
    failure.remoteCode === "regex_stack_exhausted"
  )
    return new AnalysisResourceConstraintError(
      operation,
      "memory",
      `${failure.message.trim().replace(/\.$/u, "")}. ${ghidraSessionContinuationMessage(
        failure,
        "The active analysis session and annotations remain available.",
      )}`,
      null,
      {
        ...context,
        remediationAction:
          "Retry this search in literal mode or simplify the regex.",
      },
    );
  if (failure.kind === "remote" && isGhidraInputFailureCode(failure.remoteCode))
    return new AnalysisInputError(operation, context, [
      { path: [], reason: "invalid_value", message: failure.message },
    ]);
  if (failure.kind === "remote" && failure.remoteCode === "method_unavailable")
    return new AnalysisCapabilityUnavailableError(
      "ghidra",
      operation,
      failure.message,
      context,
    );
  const output =
    failure.kind === "start" ||
    failure.kind === "process" ||
    failure.kind === "protocol" ||
    failure.kind === "timeout"
      ? readGhidraFailureOutput(failure.diagnostics.failure_output)
      : undefined;
  const memoryFailure = projectObservedJvmMemoryFailure(
    operation,
    failure,
    context,
    output,
  );
  const uncertainty =
    output?.complete === false
      ? "Ghidra's output for this operation is incomplete. No OutOfMemoryError was confirmed; a memory cause cannot be ruled out."
      : undefined;
  if (memoryFailure !== undefined) return memoryFailure;
  if (
    programName !== undefined &&
    output?.text.some((text) => reportsMissingProgram(text, programName))
  )
    return missingProjectProgram(
      programName,
      limits.ghidraExistingProject?.programName !== undefined,
      context,
    );
  const killed = projectSigkill(operation, failure, context, {
    restart: exitedProviderMessage(operation, failure, health),
    uncertainty,
  });
  if (killed !== undefined) return killed;
  if (failure.kind === "timeout") {
    const timeoutMs = failure.timeoutMs ?? startupTimeoutMs;
    const guidance =
      failure.message === GHIDRA_STARTUP_DEADLINE_ELAPSED
        ? ghidraStartupTimeoutGuidance(
            timeoutMs,
            limits.ghidraExistingProject !== undefined,
          )
        : undefined;
    return new AnalysisTimeoutError(operation, timeoutMs, {
      ...context,
      ...guidance,
      ...(uncertainty === undefined
        ? {}
        : {
            userMessage: `${
              guidance?.userMessage ??
              `Ghidra did not finish within its ${String(timeoutMs)} ms deadline.`
            } ${uncertainty}`,
          }),
    });
  }
  const exited = exitedProviderMessage(operation, failure, health);
  if (exited !== undefined)
    return new ProviderAdapterError("ghidra", operation, {
      ...context,
      userMessage:
        uncertainty === undefined ? exited : `${exited} ${uncertainty}`,
    });
  return new ProviderAdapterError("ghidra", operation, {
    ...context,
    ...(uncertainty === undefined
      ? {}
      : {
          userMessage: uncertainty,
          remediationAction:
            "Review the retained Ghidra diagnostics and capture complete launcher output before choosing resource-specific recovery.",
        }),
  });
};

const observedJvmFailureSchema = z.object({
  stream: z.enum(["stdout", "stderr"]),
  offset: z.number().int().nonnegative(),
  line: z.string().min(1),
});

interface GhidraFailureOutputView {
  readonly oomText: string | undefined;
  readonly complete: boolean | undefined;
  readonly text: readonly string[];
}

/** Ghidra's headless refusal when `-process` names no program in the project. */
const GHIDRA_MISSING_PROGRAM = "Requested project program file(s) not found: ";

/**
 * Match only the exact name REA passed to `-process`, so a longer program name
 * or unrelated output cannot be read as this refusal.
 */
const reportsMissingProgram = (text: string, programName: string): boolean =>
  text.split(/\r?\n/u).some((line) => {
    const needle = `${GHIDRA_MISSING_PROGRAM}${programName}`;
    const at = line.indexOf(needle);
    if (at === -1) return false;
    const next = line.charAt(at + needle.length);
    return next === "" || next === " ";
  });

/** Guidance for a `-process` name that selects no root program in the project. */
export const ghidraMissingProgramGuidance = (
  programName: string,
  configured: boolean,
) => {
  const origin = configured
    ? "set by REA_GHIDRA_PROGRAM_NAME"
    : "defaulted from the target file name because REA_GHIDRA_PROGRAM_NAME is unset";
  return {
    constraint: `Ghidra found no root program named ${JSON.stringify(programName)} (${origin}) in the selected REA_GHIDRA_PROJECT_PATH project.`,
    remediationAction:
      "Set REA_GHIDRA_PROGRAM_NAME to the exact name of a root program in the selected project, in the environment that starts REA (your shell or the MCP client's registration), then restart REA and open the target again. REA did not modify the project or fall back to a fresh import.",
  };
};

/** The selected project is preserved; only the program choice is reported. */
const missingProjectProgram = (
  programName: string,
  configured: boolean,
  context: {
    readonly cause: GhidraSessionError;
    readonly diagnostics: Readonly<Record<string, JsonValue>>;
  },
): ConfigurationError => {
  const { constraint, remediationAction } = ghidraMissingProgramGuidance(
    programName,
    configured,
  );
  return new ConfigurationError(constraint, {
    ...context,
    settings: [{ setting: "REA_GHIDRA_PROGRAM_NAME", constraint }],
    remediationAction,
  });
};

/** Read the scoped capture once; unavailable fields remain unconfirmed. */
const readGhidraFailureOutput = (
  scoped: JsonValue | undefined,
): GhidraFailureOutputView | undefined => {
  if (scoped === null || typeof scoped !== "object" || Array.isArray(scoped))
    return undefined;
  const observedLines = Array.isArray(scoped.observed_oome)
    ? scoped.observed_oome.flatMap((observed) => {
        const parsed = observedJvmFailureSchema.safeParse(observed);
        return parsed.success ? [parsed.data.line] : [];
      })
    : [];
  return {
    oomText: observedLines.length === 0 ? undefined : observedLines.join("\n"),
    complete:
      typeof scoped.complete === "boolean" ? scoped.complete : undefined,
    text: [scoped.stdout, scoped.stderr].flatMap((stream) =>
      stream !== null &&
      typeof stream === "object" &&
      !Array.isArray(stream) &&
      typeof stream.text === "string"
        ? [stream.text]
        : [],
    ),
  };
};

/**
 * Project OOME evidence captured during the operation that failed, including
 * OOME lines the process supervisor observed beyond the retention budget.
 */
const projectObservedJvmMemoryFailure = (
  operation: AnalysisOperation,
  failure: GhidraSessionError,
  context: {
    readonly cause: GhidraSessionError;
    readonly diagnostics: Readonly<Record<string, JsonValue>>;
  },
  scoped: GhidraFailureOutputView | undefined,
): AnalysisResourceConstraintError | undefined => {
  const output = scoped?.oomText;
  if (output === undefined) return undefined;
  const threadCapacity = /unable to create native thread/iu.test(output);
  const heapExhaustion = /Java heap space|GC overhead limit exceeded/iu.test(
    output,
  );
  const detail = [
    "Java heap space",
    "GC overhead limit exceeded",
    "Metaspace",
    "Requested array size exceeds VM limit",
    "unable to create native thread",
  ].find((candidate) => output.includes(candidate));
  if (threadCapacity)
    return new AnalysisResourceConstraintError(
      operation,
      "capacity",
      "Ghidra's process output reports an OutOfMemoryError while creating a native thread. This is observed capacity evidence; it does not establish a process limit or the precise cause.",
      null,
      {
        ...context,
        remediationAction:
          "Reduce concurrent analysis processes or review the host's available thread and process capacity, then retry.",
      },
    );
  const configuredHeap = failure.diagnostics.configured_jvm_max_heap;
  const reportedLimits = heapExhaustion
    ? {
        configured_jvm_max_heap:
          typeof configuredHeap === "string" ? configuredHeap : null,
      }
    : null;
  return new AnalysisResourceConstraintError(
    operation,
    "memory",
    `Ghidra's operation-scoped process output reports java.lang.OutOfMemoryError${detail === undefined ? "" : `: ${detail}`}. This is reported evidence and does not prove the exact allocation failure.`,
    reportedLimits,
    {
      ...context,
      ...(heapExhaustion
        ? {
            remediationAction:
              "If the host has available memory, consider increasing GHIDRA_HEADLESS_MAXMEM or disabling expensive analyzers with REA_GHIDRA_DISABLED_ANALYZERS, then retry.",
          }
        : {}),
    },
  );
};

/** Interpret the queue's observed cancellation and cleanup outcome once. */
const ghidraSessionContinuationMessage = (
  failure: GhidraSessionError,
  healthyMessage: string,
): string => {
  if (failure.concurrentCancellation === undefined) return healthyMessage;
  return failure.cleanupFailure === undefined
    ? "The request was also cancelled before the failure settled, so REA closed the Ghidra session; the next request starts a new session and repeats import and analysis."
    : "The request was also cancelled, and Ghidra session shutdown left cleanup unconfirmed. Close the target to retry retained cleanup before starting another Ghidra session.";
};

const memoryCgroupSchema = z.object({
  path: z.string(),
  oom_kill_before: z.number().int().nonnegative(),
  oom_kill_after: z.number().int().nonnegative(),
  memory_max: z
    .union([z.number().int().nonnegative(), z.literal("max")])
    .nullable(),
});

const GHIDRA_PROCESS_TREE_MEMORY_ACTION =
  "A memory limit covers Ghidra's native decompiler processes as well as its Java heap, and their number follows the available CPUs, so a larger GHIDRA_HEADLESS_MAXMEM does not help. Raise the container or host memory limit, or allow fewer CPUs with a longer REA_GHIDRA_STARTUP_TIMEOUT_MS.";

/**
 * Own SIGKILL interpretation for startup and running-provider failures.
 * The signal alone leaves its cause unknown. For process/protocol failures
 * observed before REA requested a stop, a rising cgroup oom_kill count supplies
 * separate memory evidence. That count covers the cgroup and its child groups,
 * not only REA's process tree.
 */
const projectSigkill = (
  operation: AnalysisOperation,
  failure: GhidraSessionError,
  context: {
    readonly cause: GhidraSessionError;
    readonly diagnostics: Readonly<Record<string, JsonValue>>;
  },
  guidance: {
    readonly restart: string | undefined;
    readonly uncertainty: string | undefined;
  },
): AnalysisError | undefined => {
  if (
    (failure.kind !== "start" &&
      failure.kind !== "process" &&
      failure.kind !== "protocol") ||
    failure.diagnostics.exit_signal !== "SIGKILL"
  )
    return undefined;
  const retry = guidance.restart ?? "Then retry.";
  const cgroup = memoryCgroupSchema.safeParse(
    failure.diagnostics.memory_cgroup,
  );
  if (
    (failure.kind === "process" || failure.kind === "protocol") &&
    failure.diagnostics.stop_requested === false &&
    cgroup.success &&
    cgroup.data.oom_kill_after > cgroup.data.oom_kill_before
  ) {
    const configuredHeap = failure.diagnostics.configured_jvm_max_heap;
    return new AnalysisResourceConstraintError(
      operation,
      "memory",
      `Ghidra was killed by SIGKILL while the oom_kill count of REA's cgroup ${cgroup.data.path} rose from ${String(cgroup.data.oom_kill_before)} to ${String(cgroup.data.oom_kill_after)}, so the kernel OOM killer ended a process in that cgroup or one of its child groups. The Java heap need not have been full.`,
      {
        cgroup_memory_max: cgroup.data.memory_max,
        configured_jvm_max_heap:
          typeof configuredHeap === "string" ? configuredHeap : null,
      },
      {
        ...context,
        remediationAction: `${GHIDRA_PROCESS_TREE_MEMORY_ACTION} ${retry}`,
      },
    );
  }
  return new ProviderAdapterError("ghidra", operation, {
    ...context,
    userMessage: `Ghidra process diagnostics report termination by SIGKILL. The signal alone does not establish its cause or an out-of-memory failure.${guidance.uncertainty === undefined ? "" : ` ${guidance.uncertainty}`}`,
    remediationAction:
      "Review the retained process output and host or container termination records before choosing a resource-specific remedy. Export useful Evidence, close the binary and resolve any cleanup failure, then call open_binary for the same target to start a new Ghidra session. Session-only annotations are not retained.",
  });
};

/** Name the settings that change Ghidra's startup deadline for the configured startup mode. */
const ghidraStartupTimeoutGuidance = (
  timeoutMs: number,
  existingProject: boolean,
) => {
  const raise = `use update_analysis_settings with setting ghidra.startup_timeout_ms and action set above ${String(timeoutMs)}, or set REA_GHIDRA_STARTUP_TIMEOUT_MS in the launch environment for future REA processes`;
  const retry =
    "Export useful Evidence and resolve any retained cleanup before starting a new provider attempt. Runtime updates apply to the next startup attempt without restarting REA.";
  const client =
    "The MCP client's tool-call deadline must also allow startup and the query.";
  return {
    limit: analysisSettingLimit(
      "ghidra.startup_timeout_ms",
      timeoutMs,
      undefined,
    ),
    userMessage: existingProject
      ? `Ghidra did not finish copying and opening the selected project within its configured ${String(timeoutMs)} ms startup deadline (REA_GHIDRA_STARTUP_TIMEOUT_MS).`
      : `Ghidra did not finish importing and analyzing the target within its configured ${String(timeoutMs)} ms startup deadline (REA_GHIDRA_STARTUP_TIMEOUT_MS).`,
    remediationAction: existingProject
      ? `Large projects can need longer: ${raise}. Existing-project mode does not run auto-analysis, so analyzer settings do not shorten this startup. ${retry} ${client}`
      : `Large binaries can need longer: ${raise}; REA_GHIDRA_DISABLED_ANALYZERS can skip selected expensive analyzers with reduced coverage. ${retry} Reopening repeats import from scratch; for repeated work on the same native ELF, PE or Mach-O binary on a POSIX host, analyze it once into a Ghidra project and set REA_GHIDRA_PROJECT_PATH to reuse that analysis. ${client}`,
  };
};

/** A provider already observed as running can be restarted by reopening. */
const exitedProviderMessage = (
  operation: AnalysisOperation,
  failure: GhidraSessionError,
  health: ProviderOperationHealth | undefined,
): string | undefined => {
  if (failure.kind !== "process" && failure.kind !== "protocol")
    return undefined;
  if (
    health === undefined ||
    providerRetryAction(health.state) !== "restart_provider"
  )
    return undefined;
  const observed =
    health.state === "exited"
      ? `exited${health.exitCode === null ? "" : ` with code ${String(health.exitCode)}`}`
      : "became unreachable";
  return `The Ghidra provider for this session ${observed} before ${operation} could complete. Call open_binary for the same target to start a new Ghidra session, then retry; session-only annotations from the previous provider are not retained.`;
};

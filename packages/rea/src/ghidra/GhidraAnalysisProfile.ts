import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import type {
  AnalysisProfileResolution,
  ProviderIdentity,
} from "../application/AnalysisProvider.js";
import { createFunctionCoordinateContext } from "../domain/native/functionCoordinateContext.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { createAnalysisProfile } from "../domain/analysisProfile.js";
import type { GhidraLanguageOverride } from "../config/ghidraLanguageOverride.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import {
  AnalysisCancelledError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import { ConfigurationError } from "../domain/configurationErrors.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { err, ok, type Result } from "../domain/result.js";
import { ghidraDisabledAnalyzerPreset } from "./GhidraDisabledAnalyzers.js";
import type { GhidraInstallationInspection } from "./GhidraInstallation.js";
import {
  isLegacyMipsAdmission,
  ghidraMipsProfileParameters,
  ghidraMipsLanguageOverride,
} from "./GhidraMipsProfile.js";
import {
  ghidraRiscvLanguageOverride,
  ghidraRiscvProfileParameters,
} from "./GhidraRiscvProfile.js";
import {
  ghidraPowerPcLanguage,
  ghidraPowerPcProfileParameters,
} from "./GhidraPowerPcProfile.js";
import { ghidraRawBinaryLanguage } from "./GhidraRawBinaryLanguage.js";
import {
  GHIDRA_GAMECUBE_DOL_LANGUAGE,
  ghidraDolLanguage,
  ghidraDolLanguageUnsupportedReason,
  ghidraDolProfileParameters,
} from "./GhidraDolProfile.js";

import {
  ghidraProcessorUnsupportedReason,
  isGhidraPspTarget,
} from "./GhidraPspProfile.js";
import { resolveGhidraPspExtension } from "./GhidraPspExtension.js";
import {
  NATIVE_AOT_MAX_REPORT_BYTES,
  NATIVE_AOT_MAX_SOURCE_BYTES,
  NATIVE_AOT_MAX_WORKING_MEMORY_BYTES,
  NATIVE_AOT_MAX_WORK_UNITS,
  NATIVE_AOT_PROFILE_CONTRACT_REVISION,
} from "../domain/native/nativeAotPe.js";

/** Shared analysis commitments for raw and header-selected imports. */
const sharedAnalysisSemantics = {
  annotation_policy: "atomic-function-entry-metadata-v1",
  load_image_observations: "source-mappings-entry-context-v2",
  function_body_evidence: "complete-inclusive-ranges-v1",
  function_references: "complete-body-and-entry-reference-manager-v2",
  call_relationship_coverage: "function-body-call-coverage-v5",
  function_dossier_coverage: "observed-facets-and-call-relationships-v1",
  string_inventory_evidence: "defined-data-coverage-v1",
  location_resolution: "explicit-address-exact-entry-symbol-first-v3",
  procedure_file_offset_resolution:
    "address-first-unique-target-source-mapping-v2",
  instruction_flow_evidence: "decoded-return-pcode-v1",
  instruction_status: "unlisted-address-without-decode-v1",
  instruction_references: "exact-address-incoming-without-synthetic-entry-v2",
  function_boundary_observations: "ghidra-function-boundary-limitations-v4",
} as const;

/**
 * The processor language REA pins for this target, or undefined when Ghidra may
 * select from the header. The committed profile and the session readback both
 * compare against this single owner rather than re-deriving a lane.
 */
export const ghidraPinnedLanguage = (
  target: BinaryTarget,
): GhidraLanguageOverride | undefined =>
  ghidraMipsLanguageOverride(target) ??
  ghidraRiscvLanguageOverride(target) ??
  ghidraPowerPcLanguage(target);

/** Policy conflicts belong to the selected settings, not to the target's support. */
const languageOverrideConflict = (
  override: GhidraLanguageOverride,
  constraint: string,
  pinned?: GhidraLanguageOverride,
): ConfigurationError =>
  new ConfigurationError(constraint, {
    settings: [
      ...(pinned?.languageId === override.languageId
        ? []
        : [{ setting: "REA_GHIDRA_LANGUAGE_ID", constraint }]),
      ...(override.compilerSpecId === undefined ||
      pinned?.compilerSpecId === override.compilerSpecId
        ? []
        : [{ setting: "REA_GHIDRA_COMPILER_SPEC_ID", constraint }]),
    ],
  });

/**
 * Analysis policy shared by lanes that import one file image through
 * BinaryLoader. Each lane adds its own loader, language, and entry facts.
 */
const binaryLoaderPolicy = (
  target: Extract<BinaryTarget, { format: "raw-binary" | "gamecube-dol" }>,
  installation: GhidraInstallationInspection,
): Readonly<Record<string, JsonValue>> => ({
  target_kind: target.kind,
  target_format: target.format,
  architecture: target.architecture,
  available_architectures: [...target.availableArchitectures].sort(),
  import_mode: "ephemeral-source-immutable",
  ...sharedAnalysisSemantics,
  no_return_repair:
    installation.platform === "win32"
      ? "disabled-windows-p0"
      : "returning-imports-decoded-return-v2",
  process_launch:
    installation.platform === "win32"
      ? "official-headless-script-v1"
      : "inspected-jvm-launch-support-v1",
  jump_table_evidence: "typed-case-default-blocks-v1",
  decompiler_jump_loads: true,
});

/** Resolve version-bound, deterministic semantics before Ghidra imports a target. */
export const resolveGhidraAnalysisProfile = async (
  target: BinaryTarget,
  identity: ProviderIdentity,
  installation: GhidraInstallationInspection,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
  languageOverride?: GhidraLanguageOverride,
  disabledAnalyzers?: readonly string[],
): Promise<Result<AnalysisProfileResolution, AnalysisError>> => {
  if (signal?.aborted === true)
    return Promise.resolve(
      err(new AnalysisCancelledError("open_binary", { cause: signal.reason })),
    );
  if (target.kind !== "executable")
    return Promise.resolve(ok({ profile: null }));
  if (installation.status === "unavailable")
    return Promise.resolve(
      err(new ProviderAdapterError(identity.id, "resolve_analysis_profile")),
    );
  const mipsReason = ghidraProcessorUnsupportedReason(target);
  if (mipsReason !== null)
    return Promise.resolve(
      err(
        new AnalysisUnsupportedTargetError(
          "resolve_analysis_profile",
          target.path,
          mipsReason,
        ),
      ),
    );
  // A caller-selected generic processor cannot override this verified PSP loader.
  if (isGhidraPspTarget(target) && languageOverride !== undefined)
    return err(
      languageOverrideConflict(
        languageOverride,
        "The bounded PSP Allegrex profile does not accept processor or compiler specification overrides.",
      ),
    );
  const pspExtension = isGhidraPspTarget(target)
    ? await resolveGhidraPspExtension(installation, resources, signal)
    : null;
  if (pspExtension !== null && !pspExtension.ok) return pspExtension;
  const provider = { ...identity, version: installation.providerVersion };
  const createProfile = (parameters: Readonly<Record<string, JsonValue>>) =>
    createGhidraProfile(provider, parameters, target);
  const analyzerParameters =
    disabledAnalyzers === undefined || disabledAnalyzers.length === 0
      ? { analyzer_preset: "ghidra-default" }
      : {
          analyzer_preset: ghidraDisabledAnalyzerPreset(disabledAnalyzers),
          analysis_options: { disabled_analyzers: [...disabledAnalyzers] },
        };
  if (target.format === "gamecube-dol") {
    // The DOL admission owns the processor family; only a BE32 PowerPC variant may replace the stock language.
    const reason = ghidraDolLanguageUnsupportedReason(languageOverride);
    // The DOL is admitted; only the selected language conflicts with it.
    if (reason !== null && languageOverride !== undefined)
      return Promise.resolve(
        err(
          languageOverrideConflict(languageOverride, reason, {
            languageId: GHIDRA_GAMECUBE_DOL_LANGUAGE.languageId,
            ...(languageOverride.compilerSpecId === undefined
              ? {}
              : { compilerSpecId: languageOverride.compilerSpecId }),
          }),
        ),
      );
    const language = ghidraDolLanguage(languageOverride);
    return Promise.resolve(
      ok({
        profile: createProfile({
          ...binaryLoaderPolicy(target, installation),
          load_image_evidence: "independent-dol-section-mapping-v1",
          loader: "BinaryLoader",
          language_id: language.languageId,
          compiler_spec_id: language.compilerSpecId ?? "language-default",
          language_selection:
            languageOverride === undefined
              ? "provider-pinned-v1"
              : "configured-v1",
          entry_point: target.entryPoint,
          entry_seed: "external-entry-and-function-before-analysis-v1",
          ...ghidraDolProfileParameters(target.dol),
          ...analyzerParameters,
        }),
      }),
    );
  }
  if (target.format === "raw-binary") {
    if (languageOverride !== undefined)
      return Promise.resolve(
        err(
          languageOverrideConflict(
            languageOverride,
            "Processor or compiler specification overrides cannot replace the admitted raw-binary import.",
          ),
        ),
      );
    const language = ghidraRawBinaryLanguage(target.architecture);
    return Promise.resolve(
      ok({
        profile: createProfile({
          ...binaryLoaderPolicy(target, installation),
          load_image_evidence: "independent-raw-mapping-context-v4",
          loader: "BinaryLoader",
          language_id: language.languageId,
          compiler_spec_id: language.compilerSpecId,
          language_selection: "caller-supplied-v1",
          entry_point: target.entryPoint,
          entry_seed: "external-entry-and-function-before-analysis-v1",
          ...analyzerParameters,
        }),
      }),
    );
  }
  const dosMz = target.format === "dos-mz";
  const dosCom = target.format === "dos-com";
  const dos = dosMz || dosCom;
  const pinnedLanguage = ghidraPinnedLanguage(target);
  const callerMaySelectLegacyMipsLanguage =
    target.architecture === "mips" && isLegacyMipsAdmission(target);
  if (
    pinnedLanguage !== undefined &&
    target.architecture !== "powerpc" &&
    !callerMaySelectLegacyMipsLanguage &&
    languageOverride !== undefined &&
    (languageOverride.languageId !== pinnedLanguage.languageId ||
      (languageOverride.compilerSpecId !== undefined &&
        languageOverride.compilerSpecId !== pinnedLanguage.compilerSpecId))
  )
    return err(
      languageOverrideConflict(
        languageOverride,
        `The caller-selected processor or compiler specification is outside the verified ${
          target.architecture === "riscv"
            ? "generic little-endian RISC-V"
            : "endian-matched MIPS32"
        } profile. The requested override has not been changed.`,
        pinnedLanguage,
      ),
    );
  const selectedLanguage = languageOverride ?? pinnedLanguage;
  // DOS imports already force an admitted loader, language, and context.
  if (dos && languageOverride !== undefined)
    return Promise.resolve(
      err(
        languageOverrideConflict(
          languageOverride,
          "Processor or compiler specification overrides cannot replace the admitted DOS real-mode import.",
        ),
      ),
    );
  return Promise.resolve(
    ok({
      profile: createProfile({
        target_kind: target.kind,
        target_format: target.format,
        ...(target.format === "pe"
          ? {
              executable_role: target.executableRole ?? null,
              managed: target.managed ?? null,
              native_aot_metadata: {
                contract_revision: NATIVE_AOT_PROFILE_CONTRACT_REVISION,
                source_bytes: NATIVE_AOT_MAX_SOURCE_BYTES,
                work_units: NATIVE_AOT_MAX_WORK_UNITS,
                working_memory_bytes: NATIVE_AOT_MAX_WORKING_MEMORY_BYTES,
                report_bytes: NATIVE_AOT_MAX_REPORT_BYTES,
              },
            }
          : {}),
        architecture: target.architecture ?? null,
        available_architectures: [
          ...(target.availableArchitectures ?? []),
        ].sort(),
        import_mode: "ephemeral-source-immutable",
        ...(target.format === "pe"
          ? { pdb_observations: "program-info-v5" }
          : {}),
        ...(installation.platform === "win32" &&
        target.format === "pe" &&
        (target.architecture === "arm" || target.architecture === "arm64")
          ? {
              windows_arm_pe_import:
                selectedLanguage === undefined
                  ? "loader-selected-language-v1"
                  : "explicit-language-v1",
              windows_arm_pe_machine: target.peMachine ?? null,
            }
          : {}),
        ...sharedAnalysisSemantics,
        no_return_repair:
          installation.platform === "win32"
            ? "disabled-windows-p0"
            : "returning-imports-decoded-return-v2",
        process_launch:
          installation.platform === "win32"
            ? "official-headless-script-v1"
            : "inspected-jvm-launch-support-v1",
        ...(dos
          ? {
              load_image_evidence: dosCom
                ? "independent-com-mapping-context-v1"
                : "independent-mz-mapping-relocations-v2",
            }
          : {}),
        jump_table_evidence: "typed-case-default-blocks-v1",
        decompiler_jump_loads: true,
        loader: dosMz
          ? "MzLoader"
          : dosCom
            ? "BinaryLoader"
            : "auto-from-header",
        language_id: dos
          ? "x86:LE:16:Real Mode"
          : (selectedLanguage?.languageId ?? "auto-from-header"),
        compiler_spec_id: dos
          ? "default"
          : selectedLanguage === undefined
            ? "auto-default"
            : (selectedLanguage.compilerSpecId ?? "language-default"),
        ...(languageOverride === undefined
          ? pinnedLanguage === undefined
            ? {}
            : { language_selection: "provider-pinned-v1" }
          : { language_selection: "configured-v1" }),
        ...(dos
          ? {
              load_segment: "0x1000",
              address_coordinates: "linear-byte-offset",
            }
          : {}),
        ...(dosCom
          ? {
              entry_offset: "0x100",
              register_context: {
                CS: "0x1000",
                DS: "0x1000",
                ES: "0x1000",
                SS: "0x1000",
              },
              entry_seed: "external-entry-and-function-before-analysis-v1",
            }
          : {}),
        ...analyzerParameters,
        ...ghidraMipsProfileParameters(target, languageOverride),
        ...ghidraRiscvProfileParameters(target),
        ...ghidraPowerPcProfileParameters(target),
        ...(pspExtension?.ok === true
          ? {
              mips_support_lane: "psp-elf32-exec-eabi32-allegrex-v2",
              loader: "PspElfLoader",
              language_id: "Allegrex:LE:32:default",
              compiler_spec_id: "default",
              psp_extension: { ...pspExtension.value },
            }
          : {}),
      }),
    }),
  );
};

/** Read the import-language commitment back from a resolved profile. */
export const ghidraProfileLanguageOverride = (
  parameters: Readonly<Record<string, unknown>>,
): GhidraLanguageOverride | undefined => {
  if (
    parameters.language_selection !== "configured-v1" &&
    parameters.language_selection !== "provider-pinned-v1"
  )
    return undefined;
  const languageId = parameters.language_id;
  const compilerSpecId = parameters.compiler_spec_id;
  if (typeof languageId !== "string" || typeof compilerSpecId !== "string")
    return undefined;
  return compilerSpecId === "language-default"
    ? { languageId }
    : { languageId, compilerSpecId };
};

/** Read back the language a provider-pinned profile imports with, for any pinned lane. */
export const ghidraProfilePinnedLanguage = (
  parameters: Readonly<Record<string, unknown>>,
): GhidraLanguageOverride | undefined =>
  parameters.language_selection === "provider-pinned-v1"
    ? ghidraProfileLanguageOverride(parameters)
    : undefined;

/** Whether a committed profile and the active configuration select the same language. */
export const sameGhidraLanguageOverride = (
  left: GhidraLanguageOverride | undefined,
  right: GhidraLanguageOverride | undefined,
): boolean =>
  left?.languageId === right?.languageId &&
  left?.compilerSpecId === right?.compilerSpecId;

/** Read the analyzer-option commitment back from a resolved profile. */
export const ghidraProfileDisabledAnalyzers = (
  parameters: Readonly<Record<string, unknown>>,
): readonly string[] | undefined => {
  const options = parameters.analysis_options;
  if (typeof options !== "object" || options === null) return undefined;
  const disabled = (options as Record<string, unknown>).disabled_analyzers;
  if (!Array.isArray(disabled)) return undefined;
  return disabled.every((name) => typeof name === "string")
    ? (disabled as readonly string[])
    : undefined;
};

/** Whether a committed profile and the active configuration disable the same analyzers. */
export const sameGhidraDisabledAnalyzers = (
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean =>
  left === undefined || right === undefined
    ? left === right
    : left.length === right.length &&
      left.every((name, index) => name === right[index]);

/** Keep coordinate-affecting import facts with the provider that interprets them. */
const createGhidraProfile = (
  provider: Parameters<typeof createAnalysisProfile>[0],
  parameters: Readonly<Record<string, JsonValue>>,
  target: BinaryTarget,
) =>
  createAnalysisProfile(provider, {
    ...parameters,
    // Ghidra does not currently commit an exact universal-container slice selection.
    ...(target.kind === "executable" && target.format !== "mach-o-universal"
      ? {
          function_coordinate_context: createFunctionCoordinateContext({
            loader: parameters.loader ?? null,
            language_id: parameters.language_id ?? null,
            compiler_spec_id: parameters.compiler_spec_id ?? null,
            load_segment: parameters.load_segment ?? null,
            address_coordinates: parameters.address_coordinates ?? null,
            entry_point: parameters.entry_point ?? null,
          }),
        }
      : {}),
  });

/** A caller database supplies analysis state; no import or completion claims are inferred. */
export const existingGhidraAnalysisProfile = (
  target: BinaryTarget,
  provider: Parameters<typeof createAnalysisProfile>[0],
  project: JsonValue,
) =>
  createAnalysisProfile(provider, {
    target_kind: target.kind,
    target_format: target.format,
    architecture: target.architecture ?? null,
    import_mode: "existing-project-private-copy-v1",
    ...sharedAnalysisSemantics,
    annotation_policy: "read-only-existing-project-v1",
    existing_project: project,
    original_analysis: { completeness: "unknown", settings: "unknown" },
    no_return_repair: "disabled-existing-project",
    process_launch: "inspected-jvm-launch-support-v1",
  });

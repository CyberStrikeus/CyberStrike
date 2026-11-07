import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { bindArtifactFileCleanup } from "../artifacts/ArtifactFileOperation.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { STARTUP_OWNER_CLOSED } from "../process/SharedStartupAttempt.js";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import type { RetainedResourceScope } from "./AnalysisProvider.js";
import {
  inspectNativeAnalysisConfiguration,
  type NativeAnalysisConfigurationInspection,
} from "../config/parseConfig.js";
import { homeDirectoryFromEnvironment } from "../config/homeDirectory.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import { appendCallerPath } from "../filesystem/callerPath.js";

import { analysisErrorRemediationAction } from "../domain/analysisErrorPresentation.js";
import { BinaryTargetError } from "../domain/configurationErrors.js";
import { parseBinaryTarget } from "./BinaryTargetResolver.js";
import {
  execFileOutput,
  ExecFileOutputCancelledError,
  execFileOutputFailure,
  execFileFailureCapturedOutput,
} from "../process/ExecFileOutput.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";
import {
  javaScriptRuntime,
  type JavaScriptRuntime,
} from "../domain/runtimeVersion.js";
import { installedCaskAppdir, probeHomebrew } from "./homebrew.js";
import { readMacHopperRenamedLauncherCandidates } from "./MacHopperPaths.js";
import {
  inspectLinuxHopperLauncher,
  linuxSharedLibrariesAvailable,
  readLinuxDistribution,
  type LinuxDistribution,
} from "./LinuxHopper.js";
import type { Result } from "../domain/result.js";
import type { HopperReleaseError } from "./HopperReleaseFeed.js";
import type { VerifiedLinuxHopperLauncher } from "./LinuxHopperPublisher.js";
import {
  readInstalledSkillIdentity,
  type InstalledSkillIdentity,
  type SkillPathIssue,
} from "./SetupSkill.js";
import { DEFAULT_CATALOG_IDENTITY } from "../catalogIdentity.js";
import { PRODUCT_IDENTITY, SDK_IDENTITY } from "../identity.js";
import {
  readClientRegistrationStatuses,
  type ClientRegistrationStatus,
  type UnhealthyClientRegistrationStatus,
} from "./ClientRegistrationStatus.js";
import type { ProviderRequestBudgetResolver } from "./ClientRegistrationEnvironment.js";
import {
  collectDoctorDiagnostics,
  doctorHealthy,
} from "./DoctorDiagnostics.js";
import {
  normalizeDoctorScope,
  scopeDoctorChecks,
  type DoctorScopeReport,
} from "./DoctorScope.js";

/** One actionable environment diagnostic. */
export interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly classification:
    | "healthy"
    | "missing_dependency"
    | "runtime_failure"
    | "unsupported_host"
    | "unsupported_target"
    | "missing_analysis_engine"
    | "unknown"
    | "config_drift";
  readonly detail?: string;
  readonly details?: Readonly<Record<string, JsonValue>>;
  readonly remediation?: string;
}

/** One provider-owned check projected without importing its adapter types. */
export interface DoctorProviderCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly code: string | null;
  readonly detail: string;
  readonly remediation: string | null;
  readonly classification: Exclude<DoctorCheck["classification"], "healthy">;
  readonly details?: Readonly<Record<string, JsonValue>>;
}

/** Read-only provider inspection supplied by an outer composition adapter. */
export interface DoctorProviderInspection {
  readonly id: string;
  readonly configured: boolean;
  readonly available: boolean;
  readonly providerVersion: string | null;
  /** Validated discoveries used as registration defaults. Setup preserves
   * caller-selected configuration separately from these readiness facts. */
  readonly registrationEnvironment: Readonly<Record<string, string>>;
  readonly checks: readonly DoctorProviderCheck[];
}
/** Read-only host capabilities required by diagnostics. */
export interface DoctorHost {
  readonly signal?: AbortSignal;
  readonly platform: NodeJS.Platform;
  readonly architecture: NodeJS.Architecture;
  readonly runtime: JavaScriptRuntime;
  readonly homeDirectory: string;
  readonly configuredHopperPath?: string;
  /**
   * Settings `parseConfig` rejects before native analysis starts.
   * Undefined means this host did not run that admission.
   */
  readonly nativeConfiguration?: NativeAnalysisConfigurationInspection;
  readonly configuredIlspyCmdPath?: string;
  macosVersion(): Promise<string | undefined>;
  linuxDistribution(): Promise<LinuxDistribution | undefined>;
  validTarget(path: string): Promise<boolean>;
  /** Route-specific target admission details, when supplied by the host. */
  inspectTarget?(path: string): Promise<DoctorCheck>;
  executable(path: string): Promise<boolean>;
  inspectLinuxHopper(
    path: string,
  ): Promise<Result<VerifiedLinuxHopperLauncher, HopperReleaseError>>;
  linuxDemoRuntimeCheck(): Promise<DoctorCheck>;
  /** Homebrew cask launcher; consulted only where macOS bundles are probed. */
  brewHopperPath(): Promise<string | undefined>;
  /** Renamed `Hopper*.app` launchers; consulted only where macOS bundles are probed. */
  manualHopperPaths(): Promise<readonly string[]>;
  providerInspections?(): Promise<readonly DoctorProviderInspection[]>;
  /** Resolve a parsed upstream request budget from the effective client environment. */
  resolveProviderRequestBudget?: ProviderRequestBudgetResolver;
  installationPaths?(): Promise<readonly string[]>;
  /** Undefined checks installed skill roots; explicit selections stay scoped. */
  installedSkillIdentity?(
    clientIds: readonly string[] | undefined,
  ): Promise<InstalledSkillIdentity | undefined>;
  close?(): Promise<string | undefined>;
  clientRegistrations?(
    selectedClientIds?: readonly string[],
  ): Promise<readonly ClientRegistrationStatus[]>;
  ilspyCmdVersion?(path: string): Promise<string | undefined>;
}

/** Structured result returned by the read-only doctor workflow. */
export interface DoctorReport {
  readonly healthy: boolean;
  readonly environment_healthy: boolean;
  readonly scope: DoctorScopeReport;
  readonly scope_checks: readonly DoctorCheck[];
  readonly informational_checks: readonly DoctorCheck[];
  readonly hopperPath?: string;
  readonly providerInspections?: readonly DoctorProviderInspection[];
  readonly checks: readonly DoctorCheck[];
  readonly identity?: DoctorIdentity;
}

/** Caller-selected readiness boundary; omitted values retain audit semantics. */
export interface DoctorScope {
  readonly clients?: readonly string[];
  readonly skillClients?: readonly string[];
  readonly providers?: readonly string[];
  readonly skill?: boolean;
}

/** Installed-package, skill, client, and runtime identity observations. */
export type DoctorSkillState =
  | "aligned"
  | "stale"
  | "missing"
  | "unmanaged"
  | "unknown";

interface DoctorIdentity {
  readonly cli_package_version: string;
  readonly expected_skill_version: string;
  readonly sdk: typeof SDK_IDENTITY;
  /** Package default advertisement; the active server reports its selected profile. */
  readonly catalog: typeof DEFAULT_CATALOG_IDENTITY;
  readonly live_server: {
    readonly state: "unknown";
    readonly remediation: string;
  };
  readonly installations: {
    readonly paths: readonly string[];
    readonly state: "single" | "multiple" | "unknown";
  };
  readonly skill: {
    readonly installed_version: string | null;
    readonly installed_tool_count: number | null;
    readonly state: DoctorSkillState;
    readonly issues?: readonly SkillPathIssue[];
    readonly remediation: string | null;
  };
  readonly registrations: readonly ClientRegistrationStatus[];
}

/**
 * Check requirements and an optional target without mutating the host.
 * Every failed check includes remediation suitable for either the one-shot CLI
 * or an agent consuming the structured result.
 */
export const runDoctor = async (
  target?: string,
  selectedHost?: DoctorHost,
  requestedScope?: DoctorScope,
): Promise<DoctorReport> =>
  selectedHost === undefined
    ? runDoctorOwned(target, systemDoctorHost(), requestedScope)
    : inspectDoctor(target, selectedHost, requestedScope);

/** Inspect with a host whose lifetime belongs to this operation. */
export const runDoctorOwned = async (
  target: string | undefined,
  host: DoctorHost,
  requestedScope?: DoctorScope,
): Promise<DoctorReport> => {
  let report: DoctorReport;
  try {
    report = await inspectDoctor(target, host, requestedScope);
  } catch (cause: unknown) {
    const cleanup = await closeDoctorHost(host);
    if (cleanup !== undefined && cause instanceof AnalysisError) {
      const cleanupError =
        typeof cleanup === "string"
          ? new ProviderCleanupError(
              "rea",
              [],
              { reason: cleanup },
              { operation: "doctor" },
            )
          : cleanup;
      throw analysisErrorWithCleanupFailure(
        cause,
        cleanupError,
        "doctor",
      ).bindCleanupDependencies([cause, cleanupError]);
    }
    if (cleanup !== undefined)
      throw new AggregateError(
        [cause, typeof cleanup === "string" ? new Error(cleanup) : cleanup],
        "Doctor failed and its resource cleanup remains incomplete.",
        { cause },
      );
    throw cause;
  }
  const cleanup = await closeDoctorHost(host);
  if (cleanup === undefined && report.healthy && host.signal?.aborted)
    throw new AnalysisCancelledError("doctor", {
      cause: host.signal.reason,
      diagnostics: { doctor_report: jsonValueSchema.parse(report) },
    });
  return cleanup === undefined
    ? report
    : doctorReportWithCleanup(report, cleanup);
};

const inspectDoctor = async (
  target: string | undefined,
  host: DoctorHost,
  requestedScope?: DoctorScope,
): Promise<DoctorReport> => {
  if (host.signal?.aborted)
    throw new AnalysisCancelledError("doctor", { cause: host.signal.reason });
  const scope = normalizeDoctorScope(requestedScope, target);
  const {
    checks: diagnosticChecks,
    hopperPath,
    providerInspections,
  } = await collectDoctorDiagnostics(target, host);
  const identity = await collectDoctorIdentity(host, scope);
  const checks = [
    ...diagnosticChecks,
    ...identity.checks,
    ...registrationAdvisoryChecks(identity.value.registrations),
  ];
  const providers = {
    hopperAvailable:
      hopperPath !== undefined &&
      checks
        .filter(({ name }) => name.startsWith("hopper"))
        .every(({ ok }) => ok),
    hopperConfigured: host.configuredHopperPath !== undefined,
    providerInspections,
  };
  const environmentHealthy = doctorHealthy(checks, providers);
  const scoped = scopeDoctorChecks({
    checks,
    registrations: identity.value.registrations,
    skillState: identity.value.skill.state,
    providers,
    scope,
  });
  return {
    healthy: scope.mode === "audit-wide" ? environmentHealthy : scoped.healthy,
    environment_healthy: environmentHealthy,
    scope,
    scope_checks: scope.mode === "audit-wide" ? checks : scoped.scopeChecks,
    informational_checks:
      scope.mode === "audit-wide" ? [] : scoped.informationalChecks,
    ...(hopperPath === undefined ? {} : { hopperPath }),
    ...(providerInspections === undefined ? {} : { providerInspections }),
    checks,
    identity: identity.value,
  };
};

const registrationAdvisoryChecks = (
  registrations: readonly ClientRegistrationStatus[],
): readonly DoctorCheck[] =>
  registrations.flatMap(({ client, advisory }) =>
    advisory === undefined
      ? []
      : [
          {
            name: `registration_timeout:${client}`,
            ok: true,
            classification: "healthy" as const,
            detail: advisory,
          },
        ],
  );

const closeDoctorHost = async (
  host: DoctorHost,
): Promise<string | AnalysisError | undefined> => {
  try {
    return await host.close?.();
  } catch (cause: unknown) {
    if (cause instanceof AnalysisError) return cause;
    return `Doctor host cleanup failed: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
};

const doctorReportWithCleanup = (
  report: DoctorReport,
  cleanup: string | AnalysisError,
): DoctorReport => {
  const check: DoctorCheck = {
    name: "doctor-resource-cleanup",
    ok: false,
    classification: "config_drift",
    detail:
      typeof cleanup === "string"
        ? cleanup
        : `${cleanup.message} ${cleanup.cleanupResources.join(", ")}`,
    ...(typeof cleanup === "string"
      ? {}
      : { details: { cleanup_failure: projectAnalysisError(cleanup) } }),
    remediation: "Resolve the reported cleanup failure, then rerun rea doctor.",
  };
  return {
    ...report,
    healthy: false,
    environment_healthy: false,
    checks: [...report.checks, check],
    scope_checks: [...report.scope_checks, check],
  };
};

const collectDoctorIdentity = async (
  host: DoctorHost,
  scope: DoctorScopeReport,
): Promise<{
  readonly checks: readonly DoctorCheck[];
  readonly value: DoctorIdentity;
}> => {
  const installationPaths = (await host.installationPaths?.()) ?? [];
  const registrations = (await host.clientRegistrations?.(scope.clients)) ?? [];
  const skillClientIds =
    scope.skill_clients ??
    (scope.clients.length > 0 ? scope.clients : undefined);
  const installedSkillIdentity =
    await host.installedSkillIdentity?.(skillClientIds);
  const skillAligned = skillIdentityAligned(installedSkillIdentity);
  return {
    checks: [
      ...(skillAligned ? [] : [skillIdentityCheck(installedSkillIdentity)]),
      ...registrations
        .filter(
          (registration): registration is UnhealthyClientRegistrationStatus =>
            registration.state !== "aligned" && registration.state !== "manual",
        )
        .map(registrationCheck),
    ],
    value: {
      cli_package_version: PRODUCT_IDENTITY.packageVersion,
      expected_skill_version: PRODUCT_IDENTITY.skillVersion,
      sdk: SDK_IDENTITY,
      catalog: {
        counts: DEFAULT_CATALOG_IDENTITY.counts,
        digests: DEFAULT_CATALOG_IDENTITY.digests,
      },
      live_server: {
        state: "unknown",
        // `binary_session` is advertised only when the saved scope includes
        // `session`, so the remediation also names the scope requirement: doctor
        // cannot see the saved selection here, and one sentence has to fit both
        // a complete registration and a scope that omits the session family.
        remediation:
          "Call binary_session in the active client to inspect the running server identity; a registration whose saved scope omits the session family cannot report it, so include session through rea setup --tool-families and restart first.",
      },
      installations: {
        paths: installationPaths,
        state: installationState(installationPaths),
      },
      skill: {
        installed_version: installedSkillIdentity?.version ?? null,
        installed_tool_count: installedSkillIdentity?.toolCount ?? null,
        state: skillIdentityState(installedSkillIdentity),
        ...(installedSkillIdentity?.issues === undefined
          ? {}
          : { issues: installedSkillIdentity.issues }),
        remediation: skillAligned
          ? null
          : skillIdentityRemediation(installedSkillIdentity),
      },
      registrations,
    },
  };
};

const skillIdentityAligned = (
  identity: InstalledSkillIdentity | undefined,
): boolean =>
  identity?.version === PRODUCT_IDENTITY.skillVersion &&
  identity.toolCount === DEFAULT_CATALOG_IDENTITY.counts.mcp_tools &&
  identity.canonical;

const skillIdentityState = (
  identity: InstalledSkillIdentity | undefined,
): DoctorSkillState => {
  if (
    identity?.issues?.some(
      ({ kind }) => kind === "unreadable" || kind === "unresolved",
    )
  )
    return "unknown";
  if (
    identity?.issues?.some(
      ({ kind }) => kind === "symbolic_link" || kind === "not_directory",
    )
  )
    return "unmanaged";
  if (identity?.issues?.some(({ kind }) => kind === "stale")) return "stale";
  if (identity?.issues?.some(({ kind }) => kind === "missing"))
    return "missing";
  return identity === undefined
    ? "missing"
    : skillIdentityAligned(identity)
      ? "aligned"
      : "stale";
};

const skillIdentityRemediation = (
  identity: InstalledSkillIdentity | undefined,
): string => {
  const issues = identity?.issues;
  if (issues !== undefined && issues.length > 0)
    return issues
      .map(({ path, detail, kind, client }) => {
        const repair =
          kind === "stale" || kind === "missing"
            ? `Run rea setup --skill-client ${client ?? "shared"} --skill to repair this copy.`
            : "Repair the selected path/profile before rerunning setup, or use --skill=false to configure clients without installing the skill.";
        return `${detail} (${path}). ${repair}`;
      })
      .join(" ");
  return "Run rea setup to update the installed REA skill.";
};

const skillIdentityCheck = (
  identity: InstalledSkillIdentity | undefined,
): DoctorCheck => {
  const issues = identity?.issues;
  return {
    name: "skill:identity",
    ok: false,
    // An unreadable or unresolved copy is unknown, not proven drift.
    classification:
      skillIdentityState(identity) === "unknown" ? "unknown" : "config_drift",
    detail:
      issues !== undefined && issues.length > 0
        ? `Selected skill identity is ${skillIdentityState(identity)}: ${issues.map(({ path }) => path).join(", ")}.`
        : identity === undefined
          ? "Installed REA skill identity is missing."
          : "Installed REA skill identity is stale.",
    remediation: skillIdentityRemediation(identity),
  };
};

const registrationCheck = (
  registration: UnhealthyClientRegistrationStatus,
): DoctorCheck => ({
  name: `registration:${registration.client}`,
  ok: false,
  classification: registration.state === "unknown" ? "unknown" : "config_drift",
  detail: registration.config_path,
  remediation: registration.remediation,
});

const installationState = (
  paths: readonly string[],
): DoctorIdentity["installations"]["state"] =>
  paths.length === 0 ? "unknown" : paths.length === 1 ? "single" : "multiple";

/** Optional outer-adapter diagnostics composed without reversing dependencies. */
export interface SystemDoctorHostOptions {
  readonly signal?: AbortSignal;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: NodeJS.Architecture;
  readonly environment?: NodeJS.ProcessEnv;
  readonly execFileOutput?: typeof execFileOutput;
  readonly providerInspections?: (
    resourceScope: RetainedResourceScope,
    signal: AbortSignal,
  ) => Promise<readonly DoctorProviderInspection[]>;
  readonly resolveProviderRequestBudget?: (
    provider: Parameters<ProviderRequestBudgetResolver>[0],
    environment: Parameters<ProviderRequestBudgetResolver>[1],
    resources: RetainedResourceScope,
    signal: AbortSignal,
  ) => ReturnType<ProviderRequestBudgetResolver>;
  readonly linuxDemoRuntimeCheck?: (
    resourceScope: RetainedResourceScope,
    signal: AbortSignal,
  ) => Promise<DoctorCheck>;
}

/** Create diagnostics backed by the current process and host commands. */
export const systemDoctorHost = (
  options: SystemDoctorHostOptions = {},
): DoctorHost => {
  const resources = new ArtifactResourceScope();
  const controller = new AbortController();
  const inspectionSignal =
    options.signal === undefined
      ? controller.signal
      : AbortSignal.any([options.signal, controller.signal]);
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const environment = options.environment ?? process.env;
  const nativeConfiguration = inspectNativeAnalysisConfiguration(
    snapshotEnvironment(environment, platform),
  );
  const execute = options.execFileOutput ?? execFileOutput;
  // These commands report short host facts, not analysis output. Reuse the
  // ILSpy probe's ten-second allowance and bound each captured stream to 64 KiB.
  // Baseline diagnostics must work without provider ownership prerequisites.
  const hostExecFileOutput: typeof execFileOutput = (command, args, input) =>
    resources.run(async () => {
      try {
        const output = await execute(command, args, {
          ...input,
          timeout: 10_000,
          maxBuffer: 64 * 1024,
          stopSignal: "SIGTERM",
          signal: inspectionSignal,
        });
        if (inspectionSignal.aborted)
          throw new AnalysisCancelledError("doctor", {
            cause: inspectionSignal.reason,
            capturedOutput: {
              stdout: output.stdout,
              stderr: output.stderr,
              stdout_bytes: output.stdoutBytes,
              stderr_bytes: output.stderrBytes,
              exit_code: 0,
              signal: null,
              truncated: false,
            },
          });
        return output;
      } catch (cause: unknown) {
        if (cause instanceof ExecFileOutputCancelledError) {
          const output = execFileOutputFailure(cause);
          throw new AnalysisCancelledError("doctor", {
            cause: cause.cause,
            ...(output === undefined
              ? {}
              : { capturedOutput: execFileFailureCapturedOutput(output) }),
          });
        }
        throw cause;
      }
    });
  const homeDirectory = homeDirectoryFromEnvironment(environment, platform);
  const commandEnvironment = { env: environment };
  const resourceScope: RetainedResourceScope = {
    retain: (owner, resource) =>
      resources.retain({
        kind: "lease",
        resource,
        lease: AnalysisCleanupLease.forCloseOwner(owner, resource),
      }),
    run: (operation) => resources.run(operation),
  };
  const resolveProviderRequestBudget =
    options.resolveProviderRequestBudget === undefined
      ? undefined
      : (
          provider: Parameters<ProviderRequestBudgetResolver>[0],
          environment: Parameters<ProviderRequestBudgetResolver>[1],
        ) =>
          options.resolveProviderRequestBudget!(
            provider,
            environment,
            resourceScope,
            inspectionSignal,
          );
  return {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    platform,
    architecture,
    runtime: javaScriptRuntime(process.versions),
    homeDirectory,
    ...(environment.HOPPER_LAUNCHER_PATH === undefined
      ? {}
      : { configuredHopperPath: environment.HOPPER_LAUNCHER_PATH }),
    nativeConfiguration,
    ...(environment.REA_ILSPY_CMD_PATH === undefined
      ? {}
      : { configuredIlspyCmdPath: environment.REA_ILSPY_CMD_PATH }),
    macosVersion: () =>
      readMacosVersion(hostExecFileOutput, commandEnvironment),
    linuxDistribution: () => readLinuxDistribution(architecture),
    async validTarget(path) {
      return (
        await parseBinaryTarget(path, {
          cwd: process.cwd(),
          hostArchitecture: architecture,
        })
      ).ok;
    },
    async inspectTarget(path) {
      const result = await parseBinaryTarget(path, {
        cwd: process.cwd(),
        hostArchitecture: architecture,
      });
      if (result.ok)
        return {
          name: "target",
          ok: true,
          classification: "healthy",
          detail: path,
        };
      const error = result.error;
      const targetError =
        error instanceof BinaryTargetError ? error : undefined;
      return {
        name: "target",
        ok: false,
        classification:
          targetError?.constraint !== undefined
            ? "unsupported_target"
            : "config_drift",
        detail: path,
        details: {
          reason: targetError?.reason ?? error.message,
          ...(targetError?.constraint === undefined
            ? {}
            : { constraint: targetError.constraint }),
        },
        remediation: analysisErrorRemediationAction(error),
      };
    },
    executable: (path) =>
      executableAvailable(
        path,
        platform,
        hostExecFileOutput,
        commandEnvironment,
      ),
    linuxDemoRuntimeCheck: () =>
      options.linuxDemoRuntimeCheck === undefined
        ? uncomposedLinuxDemoRuntimeCheck()
        : options.linuxDemoRuntimeCheck(resourceScope, inspectionSignal),
    inspectLinuxHopper: (path) => inspectLinuxHopperLauncher(path, environment),
    async brewHopperPath() {
      return probeHomebrew(async (command) => {
        let caskroom: string;
        try {
          // Without a cask argument, `--caskroom` does not load Homebrew's
          // cask API, so doctor writes no Homebrew cache files.
          caskroom = (
            await hostExecFileOutput(
              command,
              ["--caskroom"],
              commandEnvironment,
            )
          ).stdout.trim();
        } catch (cause: unknown) {
          if (cause instanceof AnalysisCancelledError) throw cause;
          // best-effort cleanup: optional Homebrew probing; absence means uninstalled.
          void cause;
          return undefined;
        }
        const appdir = await installedCaskAppdir(
          caskroom,
          "hopper-disassembler",
          homeDirectory,
        );
        return appdir === undefined
          ? undefined
          : appendCallerPath(
              appdir,
              "Hopper Disassembler.app/Contents/MacOS/hopper",
            );
      });
    },
    manualHopperPaths: () =>
      readMacHopperRenamedLauncherCandidates(homeDirectory),
    ...(options.providerInspections === undefined
      ? {}
      : {
          providerInspections: () =>
            resources.run(() =>
              options.providerInspections!(resourceScope, inspectionSignal),
            ),
        }),
    ...(resolveProviderRequestBudget === undefined
      ? {}
      : { resolveProviderRequestBudget }),
    async ilspyCmdVersion(path) {
      try {
        await access(path, constants.X_OK);
        return firstIlspyVersionLine(
          (await hostExecFileOutput(path, ["--version"], commandEnvironment))
            .stdout,
        );
      } catch (cause: unknown) {
        if (cause instanceof AnalysisCancelledError) throw cause;
        // best-effort cleanup: optional version probing; failure means unavailable.
        void cause;
        return undefined;
      }
    },
    async installationPaths() {
      try {
        const command = platform === "win32" ? "where" : "which";
        const arguments_ = platform === "win32" ? ["rea"] : ["-a", "rea"];
        return uniqueLines(
          (await hostExecFileOutput(command, arguments_, commandEnvironment))
            .stdout,
        );
      } catch (cause: unknown) {
        if (cause instanceof AnalysisCancelledError) throw cause;
        // best-effort cleanup: optional path probing; failure means none found.
        void cause;
        return [];
      }
    },
    installedSkillIdentity: (clientIds) =>
      readInstalledSkillIdentity(
        homeDirectory,
        clientIds,
        environment,
        platform,
        resources,
      ),
    close: async () => {
      controller.abort(STARTUP_OWNER_CLOSED);
      try {
        await resources.close();
        return undefined;
      } catch (cause: unknown) {
        const observation = ArtifactReaderFailure.cleanupObservation(
          cause,
          "doctor resources",
        );
        const failure = new ProviderCleanupError(
          "rea",
          observation.resources,
          { reason: observation.reason },
          { cause, operation: "doctor" },
        );
        bindArtifactFileCleanup(cause, failure);
        throw failure;
      }
    },
    clientRegistrations: (selectedClientIds) =>
      readClientRegistrationStatuses(homeDirectory, undefined, {
        platform,
        environment,
        resources,
        ...(selectedClientIds === undefined ? {} : { selectedClientIds }),
        ...(resolveProviderRequestBudget === undefined
          ? {}
          : {
              resolveProviderRequestBudget,
            }),
      }),
  };
};

const readMacosVersion = async (
  run: typeof execFileOutput,
  options: { readonly env: NodeJS.ProcessEnv },
): Promise<string | undefined> => {
  try {
    return (
      await run("/usr/bin/sw_vers", ["-productVersion"], options)
    ).stdout.trim();
  } catch (cause: unknown) {
    if (cause instanceof AnalysisCancelledError) throw cause;
    // best-effort cleanup: optional OS version probing; failure means unknown.
    void cause;
    return undefined;
  }
};

const executableAvailable = async (
  path: string,
  platform: NodeJS.Platform,
  run: typeof execFileOutput,
  options: { readonly env: NodeJS.ProcessEnv },
): Promise<boolean> => {
  try {
    await access(path, constants.X_OK);
    if (!(await stat(path)).isFile()) return false;
    if (platform !== "linux") return true;
    const linked = await run("ldd", [path], options);
    return linuxSharedLibrariesAvailable(`${linked.stdout}\n${linked.stderr}`);
  } catch (cause: unknown) {
    if (cause instanceof AnalysisCancelledError) throw cause;
    // best-effort cleanup: optional executable probing; failure means unavailable.
    void cause;
    return false;
  }
};

const uncomposedLinuxDemoRuntimeCheck = (): Promise<DoctorCheck> =>
  Promise.resolve({
    name: "hopper-demo-runtime",
    ok: false,
    classification: "config_drift",
    detail: "Linux Hopper private-display diagnostics were not composed",
    remediation: "Run rea doctor through the production CLI adapter.",
  });

const uniqueLines = (value: string): string[] => [
  ...new Set(
    value
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  ),
];

const firstIlspyVersionLine = (value: string): string | undefined =>
  uniqueLines(value).find((line) => line.startsWith("ilspycmd:"));

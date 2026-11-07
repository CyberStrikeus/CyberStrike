import {
  SUPPORTED_NODE_VERSION_PROSE,
  supportsJavaScriptRuntime,
} from "../domain/runtimeVersion.js";
import { hopperLauncherDiscovery } from "./HopperLauncherDiscovery.js";
import { macosMajorVersion } from "../domain/macosVersion.js";
import { LINUX_HOPPER_SETUP_HOSTS, supportsReaHost } from "./LinuxHopper.js";
import type {
  DoctorCheck,
  DoctorHost,
  DoctorProviderInspection,
} from "./Doctor.js";

/** Ordered environment diagnostics consumed by the Doctor report assembler. */
export interface DoctorDiagnostics {
  readonly checks: readonly DoctorCheck[];
  readonly hopperPath?: string;
  readonly providerInspections?: readonly DoctorProviderInspection[];
}

/** Collect host, provider, and optional-target diagnostics without mutation. */
export const collectDoctorDiagnostics = async (
  target: string | undefined,
  host: DoctorHost,
): Promise<DoctorDiagnostics> => {
  const checks: DoctorCheck[] = [nodeCheck(host)];
  checks.push(await hostCheck(host));

  const hopperPath = await findHopper(host);
  checks.push(hopperCheck(host, hopperPath));
  const hopperTimeoutCheck = optionalHopperStartupTimeoutCheck(host);
  if (hopperTimeoutCheck !== undefined) checks.push(hopperTimeoutCheck);
  checks.push(...runtimeConfigurationChecks(host));
  const hopperVersionCheck = await optionalHopperVersionCheck(host, hopperPath);
  if (hopperVersionCheck !== undefined) checks.push(hopperVersionCheck);

  const providerInspections = await host.providerInspections?.();
  if (providerInspections !== undefined)
    checks.push(...providerInspections.flatMap(providerDoctorChecks));

  const ilspyCheck = await optionalIlspyCheck(host);
  if (ilspyCheck !== undefined) checks.push(ilspyCheck);
  const hopperDemoCheck = await optionalHopperDemoCheck(host, hopperPath);
  if (hopperDemoCheck !== undefined) checks.push(hopperDemoCheck);
  const targetCheck = await optionalTargetCheck(target, host);
  if (targetCheck !== undefined) checks.push(targetCheck);

  return {
    checks,
    ...(hopperPath === undefined ? {} : { hopperPath }),
    ...(providerInspections === undefined ? {} : { providerInspections }),
  };
};

/** Evaluate core health while treating unconfigured providers as optional. */
export const doctorHealthy = (
  checks: readonly DoctorCheck[],
  providers: {
    readonly hopperAvailable: boolean;
    readonly hopperConfigured: boolean;
    readonly providerInspections:
      | readonly DoctorProviderInspection[]
      | undefined;
  },
): boolean => {
  if (providers.providerInspections === undefined)
    return checks.every(({ ok }) => ok);
  const providerChecks = checks.filter(
    ({ name }) =>
      name.startsWith("hopper") ||
      providers.providerInspections?.some((inspection) =>
        providerCheckName(inspection.id, name),
      ) === true,
  );
  const coreHealthy = checks
    .filter((candidate) => !providerChecks.includes(candidate))
    .every(({ ok }) => ok);
  const configuredProvidersHealthy = providerChecks
    .filter(({ name }) => {
      // Validate the supplied setting independently of provider discovery.
      if (name === "hopper-startup-timeout") return true;
      if (name.startsWith("hopper")) return providers.hopperConfigured;
      return providers.providerInspections?.some(
        (inspection) =>
          inspection.configured && providerCheckName(inspection.id, name),
      );
    })
    .every(({ ok }) => ok);
  return (
    coreHealthy &&
    configuredProvidersHealthy &&
    (providers.hopperAvailable ||
      providers.providerInspections.some(({ available }) => available))
  );
};

/** Runtime support follows the shared rule, which judges Bun by its Node.js compatibility. */
const nodeCheck = ({ runtime }: DoctorHost): DoctorCheck => {
  const failure = {
    remediation: `Install ${SUPPORTED_NODE_VERSION_PROSE}.`,
    classification: "missing_dependency",
  } as const;
  if (runtime.id === "node")
    return {
      ...check(
        "node",
        supportsJavaScriptRuntime(runtime),
        runtime.version,
        failure,
      ),
      details: { runtime: "node", version: runtime.version },
    };
  return {
    ...check(
      "node",
      supportsJavaScriptRuntime(runtime),
      `Bun ${runtime.version} (Node.js ${runtime.nodeCompatibilityVersion} compatibility)`,
      failure,
    ),
    details: {
      runtime: "bun",
      version: runtime.version,
      node_compatibility_version: runtime.nodeCompatibilityVersion,
    },
  };
};

const hostCheck = async (host: DoctorHost): Promise<DoctorCheck> => {
  const macosVersion =
    host.platform === "darwin" ? await host.macosVersion() : undefined;
  const linuxDistribution =
    host.platform === "linux" ? await host.linuxDistribution() : undefined;
  const macosMajor = macosMajorVersion(macosVersion);
  if (host.platform === "darwin" && macosMajor === undefined)
    return {
      name: "host",
      ok: false,
      classification: "unknown",
      detail:
        macosVersion === undefined
          ? "The macOS version could not be determined."
          : `The macOS version probe returned an unrecognized value: ${JSON.stringify(macosVersion)}.`,
      remediation: "Check /usr/bin/sw_vers -productVersion and rerun doctor.",
    };
  const supported =
    (host.platform === "darwin" &&
      macosMajor !== undefined &&
      macosMajor >= 12) ||
    (host.platform === "linux" && supportsReaHost(linuxDistribution)) ||
    (host.platform === "win32" && host.architecture === "x64");
  const detail =
    macosVersion ??
    (linuxDistribution === undefined
      ? `${host.platform} ${host.architecture}`
      : `${linuxDistribution.id} ${linuxDistribution.versionId ?? "unknown"}`);
  return check("host", supported, detail, {
    remediation: `REA supports macOS 12+, Linux distributions with a recognized apt, dnf, or pacman package family, and the experimental Windows x64 Ghidra P0 boundary; automated Hopper setup on Linux additionally requires ${LINUX_HOPPER_SETUP_HOSTS}.`,
    classification: "unsupported_host",
  });
};

const findHopper = async (host: DoctorHost): Promise<string | undefined> => {
  if (host.configuredHopperPath !== undefined)
    return firstExecutable(host, [host.configuredHopperPath]);
  const discovery = hopperLauncherDiscovery(host.platform, host.homeDirectory);
  const fixed = await firstExecutable(host, discovery.candidates);
  if (fixed !== undefined || !discovery.probesMacApplicationBundles)
    return fixed;
  const renamed = await firstExecutable(host, await host.manualHopperPaths());
  if (renamed !== undefined) return renamed;
  const brewCandidate = await host.brewHopperPath();
  return firstExecutable(
    host,
    brewCandidate === undefined ? [] : [brewCandidate],
  );
};

const firstExecutable = async (
  host: DoctorHost,
  candidates: readonly string[],
): Promise<string | undefined> => {
  for (const candidate of new Set(candidates))
    if (await host.executable(candidate)) return candidate;
  return undefined;
};

const hopperCheck = (
  host: DoctorHost,
  hopperPath: string | undefined,
): DoctorCheck =>
  check(
    "hopper",
    hopperPath !== undefined,
    hopperPath ?? host.configuredHopperPath,
    {
      remediation:
        host.configuredHopperPath === undefined
          ? "Run rea setup to install Hopper, or set HOPPER_LAUNCHER_PATH."
          : "Unset or update HOPPER_LAUNCHER_PATH to an executable Hopper launcher.",
      classification:
        host.configuredHopperPath === undefined
          ? "missing_analysis_engine"
          : "config_drift",
    },
  );

const optionalHopperStartupTimeoutCheck = (
  host: DoctorHost,
): DoctorCheck | undefined => {
  const parsed = host.nativeConfiguration?.configuredHopperStartupTimeout;
  if (parsed === undefined) return undefined;
  return check(
    "hopper-startup-timeout",
    parsed.ok,
    parsed.ok
      ? `REA_HOPPER_STARTUP_TIMEOUT_MS=${String(parsed.value)}`
      : `REA_HOPPER_STARTUP_TIMEOUT_MS: ${parsed.error.settings.map(({ constraint }) => constraint).join("; ")}`,
    {
      classification: "config_drift",
      remediation:
        "Unset REA_HOPPER_STARTUP_TIMEOUT_MS to use the default, or set it to a positive decimal integer from 1 to 2147483647 milliseconds.",
    },
  );
};

/**
 * Project every native-analysis admission failure except the Hopper timeout,
 * which already has its own check. Provider scopes include engine settings.
 * Settings that block process start are marked for every doctor scope.
 */
const runtimeConfigurationChecks = (
  host: DoctorHost,
): readonly DoctorCheck[] => {
  const issues = host.nativeConfiguration?.issues;
  if (issues === undefined || issues.length === 0) return [];
  const grouped: { setting: string; constraints: string[] }[] = [];
  for (const issue of issues) {
    if (issue.setting === "REA_HOPPER_STARTUP_TIMEOUT_MS") continue;
    const existing = grouped.find((item) => item.setting === issue.setting);
    if (existing === undefined)
      grouped.push({ setting: issue.setting, constraints: [issue.constraint] });
    else existing.constraints.push(issue.constraint);
  }
  return grouped.map(({ setting, constraints }) => ({
    ...check(
      `runtime-configuration:${setting}`,
      false,
      constraints
        .map((constraint) =>
          constraint.includes(setting)
            ? constraint.replace(/\.$/u, "")
            : `${setting}: ${constraint}`,
        )
        .join("; "),
      {
        classification: "config_drift",
        remediation: `Correct ${setting} in the environment that starts REA (your shell or the MCP client's registration), then rerun.`,
      },
    ),
    details: { setting },
  }));
};

const optionalHopperVersionCheck = async (
  host: DoctorHost,
  hopperPath: string | undefined,
): Promise<DoctorCheck | undefined> => {
  if (host.platform !== "linux" || hopperPath === undefined) return undefined;
  const inspected = await host.inspectLinuxHopper(hopperPath);
  const buildCheck = check("hopper-version", inspected.ok, hopperPath, {
    remediation: unsupportedHopperRemediation(
      host.configuredHopperPath === hopperPath,
    ),
    classification:
      !inspected.ok &&
      [
        "release_metadata",
        "download",
        "verification_unavailable",
        "cancelled",
        "cleanup_failed",
      ].includes(inspected.error.reason)
        ? "unknown"
        : "config_drift",
  });
  return {
    ...buildCheck,
    details: inspected.ok
      ? {
          reported_release_version: inspected.value.version,
          launcher_sha256: inspected.value.sha256,
          primary_fingerprint: inspected.value.primaryFingerprint,
          source: inspected.value.source,
        }
      : { reason: inspected.error.reason, message: inspected.error.message },
  };
};

const optionalHopperDemoCheck = async (
  host: DoctorHost,
  hopperPath: string | undefined,
): Promise<DoctorCheck | undefined> =>
  host.platform !== "linux" || hopperPath === undefined
    ? undefined
    : host.linuxDemoRuntimeCheck();

const optionalIlspyCheck = async (
  host: DoctorHost,
): Promise<DoctorCheck | undefined> => {
  if (host.configuredIlspyCmdPath === undefined) return undefined;
  const version = await host.ilspyCmdVersion?.(host.configuredIlspyCmdPath);
  return check(
    "ilspycmd",
    version !== undefined,
    version === undefined
      ? host.configuredIlspyCmdPath
      : `${host.configuredIlspyCmdPath} (${version})`,
    {
      remediation:
        "Unset REA_ILSPY_CMD_PATH or point it at a runnable ilspycmd executable.",
      classification: "config_drift",
    },
  );
};

const optionalTargetCheck = async (
  target: string | undefined,
  host: DoctorHost,
): Promise<DoctorCheck | undefined> =>
  target === undefined
    ? undefined
    : host.inspectTarget !== undefined
      ? host.inspectTarget(target)
      : check("target", await host.validTarget(target), target, {
          remediation: "Supply a readable local app or program path.",
          classification: "config_drift",
        });

const check = (
  name: string,
  ok: boolean,
  detail: string | undefined,
  failure: {
    readonly remediation: string;
    readonly classification: Exclude<DoctorCheck["classification"], "healthy">;
  },
): DoctorCheck => ({
  name,
  ok,
  classification: ok ? "healthy" : failure.classification,
  ...(detail === undefined ? {} : { detail }),
  ...(ok ? {} : { remediation: failure.remediation }),
});

const providerDoctorChecks = (
  inspection: DoctorProviderInspection,
): readonly DoctorCheck[] =>
  inspection.checks.map((candidate) => ({
    name:
      candidate.name === "configuration"
        ? inspection.id
        : `${inspection.id}-${candidate.name}`,
    ok: candidate.ok,
    classification: candidate.ok ? "healthy" : candidate.classification,
    detail: candidate.detail,
    ...(candidate.remediation === null
      ? {}
      : { remediation: candidate.remediation }),
    ...(candidate.details === undefined ? {} : { details: candidate.details }),
  }));

const unsupportedHopperRemediation = (configured: boolean): string =>
  configured
    ? "Check HOPPER_LAUNCHER_PATH and its publisher verification evidence. Run rea setup to install and retain an authenticated official Hopper package for offline use."
    : "Run rea setup to install and retain an authenticated official Hopper package for offline use.";

const providerCheckName = (providerId: string, name: string): boolean =>
  name === providerId || name.startsWith(`${providerId}-`);

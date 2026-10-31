import { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import type { RetainedResourceScope } from "../application/AnalysisProvider.js";
import {
  probeGhidraJava,
  type GhidraJavaObservation,
  type GhidraJavaProbeFailure,
  type GhidraJavaProbeOptions,
} from "./GhidraJavaProbe.js";
import { ok, type Result } from "../domain/result.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { readGhidraExecutableHeader } from "./GhidraExecutableHeader.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import {
  absoluteCallerPath,
  appendCallerPath,
} from "../filesystem/callerPath.js";
import {
  readGhidraInstallationProperties,
  type GhidraInstallationFileOptions,
} from "./GhidraInstallationProperties.js";
import { constants, accessSync, realpathSync, statSync } from "node:fs";
import { delimiter as pathDelimiter, dirname, posix, win32 } from "node:path";

import type { ProviderRejectionCode } from "../domain/providerSelection.js";
import {
  parseExecutableHeader,
  readFatArchitectureFamilies,
  type ExecutableMetadata,
} from "../domain/binaryTarget.js";
import {
  isMachOFormat,
  type BinaryArchitecture,
} from "../domain/binaryTargetTypes.js";
import type { JsonValue } from "../domain/jsonValue.js";
import {
  ghidraApplicationProperties,
  ghidraJavaMajorAccepted,
  ghidraJavaRangeLabel,
  ghidraJavaRequirement,
  type GhidraApplicationProperties,
  type GhidraJavaRequirement,
} from "./GhidraInstallationPolicy.js";
import {
  ghidraReleaseAccepted,
  ghidraReleaseCompatibility,
  ghidraReleaseLine,
  ghidraVersionDetail,
  SUPPORTED_GHIDRA_VERSION,
} from "./GhidraReleasePolicy.js";

const NATIVE_PLATFORMS: Readonly<
  Partial<
    Record<
      NodeJS.Platform,
      Readonly<Partial<Record<NodeJS.Architecture, string>>>
    >
  >
> = {
  linux: { x64: "linux_x86_64", arm64: "linux_arm_64" },
  darwin: { x64: "mac_x86_64", arm64: "mac_arm_64" },
  win32: { x64: "win_x86_64" },
};

/** Executable format each supported host runs its own Ghidra native tools as. */
const NATIVE_TOOL_FORMATS: Readonly<
  Partial<Record<NodeJS.Platform, ExecutableMetadata["format"]>>
> = {
  linux: "elf",
  darwin: "mach-o",
  win32: "pe",
};

/** Node architecture identifiers as the executable-header parser reports them. */
const NATIVE_ARCHITECTURES: readonly {
  readonly node: NodeJS.Architecture;
  readonly binary: BinaryArchitecture;
}[] = [
  { node: "x64", binary: "x86_64" },
  { node: "ia32", binary: "x86" },
  { node: "arm", binary: "arm" },
  { node: "arm64", binary: "arm64" },
];

/** Compatibility of one present native decompiler with the inspected host. */
type NativeDecompilerCompatibility =
  | {
      readonly status: "incompatible";
      readonly detail: string;
      readonly remediation: string;
    }
  | { readonly status: "compatible"; readonly detail: string }
  | { readonly status: "unknown"; readonly detail: string };

/**
 * Judge a native decompiler by its own executable header instead of the
 * directory name that admits it.
 *
 * Only a header that positively contradicts the host is `incompatible`. An
 * absent, unreadable, truncated, or unrecognized header stays `unknown`, so a
 * file the other checks already accept is never refused on missing evidence.
 */
const assessNativeDecompiler = (
  path: string,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
  probe: GhidraExecutableHeaderProbe | undefined,
): NativeDecompilerCompatibility => {
  const expectedFormat = NATIVE_TOOL_FORMATS[platform];
  const expectedArchitecture = NATIVE_ARCHITECTURES.find(
    ({ node }) => node === architecture,
  )?.binary;
  if (expectedFormat === undefined || expectedArchitecture === undefined)
    return {
      status: "unknown",
      detail: `${path} is executable, but no native tool format is defined for ${platform}/${architecture}`,
    };
  const parsed =
    probe === undefined
      ? undefined
      : parseExecutableHeader(probe.bytes, architecture, probe.size);
  // Slice selection can refuse a FAT table that still proves this host is
  // excluded, such as one declaring only arm64 and arm64e; its validated
  // families decide. A malformed host slice remains an unknown outcome.
  const families =
    probe !== undefined && parsed !== undefined && !parsed.ok
      ? readFatArchitectureFamilies(probe.bytes, probe.size)
      : null;
  const header = parsed?.ok
    ? parsed.value
    : families?.ok &&
        !families.value.some((family) => family === expectedArchitecture)
      ? {
          format: "mach-o-universal" as const,
          architecture: families.value.join("/") || "no supported architecture",
        }
      : undefined;
  if (header === undefined)
    return {
      status: "unknown",
      detail: `${path} is executable, but its executable format for ${platform}/${architecture} could not be established`,
    };
  const observed = `${header.format} ${header.architecture}`;
  const expected = `${expectedFormat} ${expectedArchitecture}`;
  const formatMatches = isMachOFormat(expectedFormat)
    ? isMachOFormat(header.format)
    : header.format === expectedFormat;
  if (formatMatches && header.architecture === expectedArchitecture)
    return {
      status: "compatible",
      detail: `${path} reports ${observed}, which matches ${platform}/${architecture}`,
    };
  const nativeDirectory = NATIVE_PLATFORMS[platform]?.[architecture];
  const executable = platform === "win32" ? "decompile.exe" : "decompile";
  return {
    status: "incompatible",
    detail: `${path} reports ${observed}, but ${platform}/${architecture} requires ${expected}`,
    remediation: `Provide an executable Ghidra/Features/Decompiler/os/${nativeDirectory ?? "<platform>"}/${executable} built for ${expected}, or its build/os equivalent. REA does not build or install native tools.`,
  };
};

/** Caller-owned paths and host coordinates used for one installation probe. */
export interface GhidraInstallationOptions {
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly resourceOwner: RetainedResourceScope;
  readonly signal?: AbortSignal;
  readonly installDir?: string;
  readonly javaHome?: string;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: NodeJS.Architecture;
}

/** One independently actionable part of the supported-installation contract. */
export type GhidraInstallationCheck =
  | {
      readonly status: "passed";
      readonly name: GhidraInstallationCheckName;
      readonly detail: string;
    }
  | {
      readonly status: "failed";
      readonly name: GhidraInstallationCheckName;
      readonly code: ProviderRejectionCode;
      readonly detail: string;
      readonly remediation: string;
    };

/** Stable identity for one Ghidra installation check. */
export type GhidraInstallationCheckName =
  | "configuration"
  | "platform"
  | "architecture"
  | "installation"
  | "version"
  | "headless"
  | "native_decompiler"
  | "java";

interface GhidraInstallationObservation {
  readonly platform: NodeJS.Platform;
  readonly architecture: NodeJS.Architecture;
  readonly applicationPropertiesPath: string | null;
  /** Parsed release identity, never inferred from the installation directory name. */
  readonly configurationDirectoryName: string | null;
  readonly nativeDecompilerPath: string | null;
  readonly nativeDecompilerHeaderFailure?: AnalysisError;
  readonly javaDiscoveryFailures?: readonly {
    readonly command: string;
    readonly failure: GhidraJavaProbeFailure;
  }[];
  readonly javaCommand: string;
  readonly javaProbeFailure?: GhidraJavaProbeFailure;
  /** Observed java.vm.name; omitted when the probe cannot establish VM identity. */
  readonly javaVmName?: string;
  /**
   * Observed JVM os.arch; omitted when the probe cannot establish it. Ghidra
   * selects its native decompiler directory from this value.
   */
  readonly javaOsArch?: string;
  /**
   * Observed JVM os.name; omitted when the probe cannot establish it. Ghidra
   * selects its native decompiler OS directory from the JVM OS/architecture
   * pair, so a non-host value selects an unvalidated directory.
   */
  readonly javaOsName?: string;
  readonly checks: readonly GhidraInstallationCheck[];
}

/** Bounded observation of a supported BYO Ghidra installation and JDK. */
export interface AvailableGhidraInstallation extends GhidraInstallationObservation {
  readonly status: "available";
  readonly installDir: string;
  readonly analyzeHeadlessPath: string;
  readonly applicationPropertiesPath: string;
  readonly providerVersion: string;
  readonly javaHome: string;
  readonly javaVersion: string;
}

/** Bounded observation explaining why a BYO Ghidra installation is unusable. */
export interface UnavailableGhidraInstallation extends GhidraInstallationObservation {
  readonly status: "unavailable";
  readonly installDir: string | null;
  readonly analyzeHeadlessPath: string | null;
  readonly providerVersion: string | null;
  readonly javaHome: string | null;
  readonly javaVersion: string | null;
  readonly rejection: Readonly<{
    code: ProviderRejectionCode;
    reason: string;
  }>;
}

/** Parsed available or unavailable state of one BYO Ghidra installation. */
export type GhidraInstallationInspection =
  | AvailableGhidraInstallation
  | UnavailableGhidraInstallation;

/** A bounded executable-header probe: a small prefix plus the whole file size. */
export interface GhidraExecutableHeaderProbe {
  /** A bounded prefix; a larger or unreadable header remains unknown. */
  readonly bytes: Buffer;
  /** Whole-file size, since header commitments are checked against it, not the prefix. */
  readonly size: number;
}

/** Host observations and owned Java prerequisite work; never launches Ghidra. */
export interface GhidraInstallationHost {
  readonly platform?: NodeJS.Platform;
  readonly architecture?: NodeJS.Architecture;
  readText(
    path: string,
    options: GhidraInstallationFileOptions,
  ): string | undefined | Promise<string | undefined>;
  executable(path: string): boolean;
  /**
   * Read a bounded header prefix of one executable so admission can reject a
   * tool built for another platform or architecture. An omitted seam, or an
   * unreadable file, reports the header as unknown and never rejects an
   * installation that the other checks already accept. Cancellation and
   * incomplete descriptor cleanup propagate as failures.
   */
  executableHeader?(
    path: string,
    options: GhidraInstallationFileOptions,
  ):
    | Result<GhidraExecutableHeaderProbe | undefined, AnalysisError>
    | Promise<Result<GhidraExecutableHeaderProbe | undefined, AnalysisError>>;
  probeJava(
    command: string,
    environment: NodeJS.ProcessEnv,
    options: GhidraJavaProbeOptions,
  ):
    | Result<GhidraJavaObservation, GhidraJavaProbeFailure | AnalysisError>
    | Promise<
        Result<GhidraJavaObservation, GhidraJavaProbeFailure | AnalysisError>
      >;
  /** Resolve a PATH launcher to a validated installation without executing it. */
  discoverInstallDirOnPath?(
    environment: Readonly<NodeJS.ProcessEnv>,
    platform: NodeJS.Platform,
  ): string | undefined;
}

interface GhidraInstallationCoordinates {
  readonly installDir: string | null;
  readonly applicationPropertiesPath: string | null;
  readonly analyzeHeadlessPath: string | null;
  readonly nativeDecompilerPath: string | null;
  readonly nativeDecompilerHeader: Result<
    GhidraExecutableHeaderProbe | undefined,
    AnalysisError
  >;
  readonly properties: GhidraApplicationProperties | undefined;
  readonly javaDiscoveryFailures?: readonly {
    readonly command: string;
    readonly failure: GhidraJavaProbeFailure;
  }[];
  readonly javaCommand: string;
  readonly java: GhidraJavaObservation | undefined;
  readonly javaProbeFailure: GhidraJavaProbeFailure | undefined;
}

interface GhidraInstallationCheckContext {
  readonly coordinates: GhidraInstallationCoordinates;
  readonly platform: NodeJS.Platform;
  readonly architecture: NodeJS.Architecture;
  readonly javaHome: string | undefined;
  readonly host: GhidraInstallationHost;
}

/** Inspect an installation without importing a target or modifying Ghidra. */
export const inspectGhidraInstallation = async (
  options: GhidraInstallationOptions,
  host: GhidraInstallationHost = systemGhidraInstallationHost(),
): Promise<GhidraInstallationInspection> => {
  if (options.signal?.aborted)
    throw new AnalysisCancelledError("ghidra:installation", {
      cause: options.signal.reason,
    });
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const coordinates = await installationCoordinates(
    options,
    platform,
    architecture,
    host,
  );
  const checks = installationChecks({
    coordinates,
    platform,
    architecture,
    javaHome: options.javaHome,
    host,
  });
  const failed = checks.find(
    (check): check is Extract<GhidraInstallationCheck, { status: "failed" }> =>
      check.status === "failed",
  );
  const javaObservation =
    coordinates.java ?? coordinates.javaProbeFailure?.properties;
  const observation = {
    platform,
    architecture,
    applicationPropertiesPath: coordinates.applicationPropertiesPath,
    configurationDirectoryName:
      coordinates.properties?.configurationDirectoryName ?? null,
    nativeDecompilerPath: coordinates.nativeDecompilerPath,
    ...(coordinates.nativeDecompilerHeader.ok
      ? {}
      : {
          nativeDecompilerHeaderFailure:
            coordinates.nativeDecompilerHeader.error,
        }),
    ...(coordinates.javaDiscoveryFailures === undefined
      ? {}
      : { javaDiscoveryFailures: coordinates.javaDiscoveryFailures }),
    javaCommand: coordinates.javaCommand,
    ...(coordinates.javaProbeFailure === undefined
      ? {}
      : { javaProbeFailure: coordinates.javaProbeFailure }),
    ...(javaObservation?.vmName == null
      ? {}
      : { javaVmName: javaObservation.vmName }),
    ...(javaObservation?.osArch == null
      ? {}
      : { javaOsArch: javaObservation.osArch }),
    ...(javaObservation?.osName == null
      ? {}
      : { javaOsName: javaObservation.osName }),
    checks,
  };
  if (failed !== undefined)
    return {
      status: "unavailable",
      ...observation,
      installDir: coordinates.installDir,
      analyzeHeadlessPath: coordinates.analyzeHeadlessPath,
      providerVersion: coordinates.properties?.providerVersion ?? null,
      javaHome: javaObservation?.home ?? options.javaHome ?? null,
      javaVersion: javaObservation?.version ?? null,
      rejection: { code: failed.code, reason: failed.remediation },
    };
  if (options.signal?.aborted)
    throw new AnalysisCancelledError("ghidra:installation", {
      cause: options.signal.reason,
      diagnostics: ghidraInstallationDiagnostics(
        availableInstallation(coordinates, observation, options.javaHome),
      ),
    });
  return availableInstallation(coordinates, observation, options.javaHome);
};

const availableInstallation = (
  coordinates: GhidraInstallationCoordinates,
  observation: GhidraInstallationObservation,
  selectedJavaHome: string | undefined,
): AvailableGhidraInstallation => {
  const providerVersion = coordinates.properties?.providerVersion;
  if (
    coordinates.installDir === null ||
    coordinates.applicationPropertiesPath === null ||
    coordinates.analyzeHeadlessPath === null ||
    providerVersion === null ||
    providerVersion === undefined ||
    coordinates.java === undefined
  )
    throw new TypeError(
      "Passing Ghidra installation checks produced incomplete coordinates",
    );
  return {
    status: "available",
    ...observation,
    installDir: coordinates.installDir,
    analyzeHeadlessPath: coordinates.analyzeHeadlessPath,
    applicationPropertiesPath: coordinates.applicationPropertiesPath,
    providerVersion,
    javaHome: stableJavaHome(
      coordinates.java.home,
      selectedJavaHome,
      observation.platform,
    ),
    javaVersion: coordinates.java.version,
  };
};

const installationCoordinates = async (
  options: GhidraInstallationOptions,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
  host: GhidraInstallationHost,
): Promise<GhidraInstallationCoordinates> => {
  const path = platform === "win32" ? win32 : posix;
  // An explicit setting remains authoritative even when malformed or stale;
  // automatic discovery is only a fallback when the caller supplied none.
  const installDir =
    options.installDir ??
    host.discoverInstallDirOnPath?.(options.environment, platform) ??
    null;
  const applicationPropertiesPath =
    installDir === null
      ? null
      : appendCallerPath(installDir, "Ghidra/application.properties", platform);
  const analyzeHeadlessPath =
    installDir === null
      ? null
      : appendCallerPath(
          installDir,
          `support/${platform === "win32" ? "analyzeHeadless.bat" : "analyzeHeadless"}`,
          platform,
        );
  const decompilerPlatform = NATIVE_PLATFORMS[platform]?.[architecture];
  const decompilerExecutable =
    platform === "win32" ? "decompile.exe" : "decompile";
  const nativeDecompilerPath =
    installDir === null || decompilerPlatform === undefined
      ? null
      : ([
          appendCallerPath(
            installDir,
            `Ghidra/Features/Decompiler/os/${decompilerPlatform}/${decompilerExecutable}`,
            platform,
          ),
          appendCallerPath(
            installDir,
            `Ghidra/Features/Decompiler/build/os/${decompilerPlatform}/${decompilerExecutable}`,
            platform,
          ),
        ].find((candidate) => host.executable(candidate)) ?? null);
  const properties =
    applicationPropertiesPath === null
      ? undefined
      : await host.readText(applicationPropertiesPath, {
          resourceOwner: options.resourceOwner,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
  const nativeDecompilerHeader =
    nativeDecompilerPath === null || host.executableHeader === undefined
      ? ok(undefined)
      : await host.executableHeader(nativeDecompilerPath, {
          resourceOwner: options.resourceOwner,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
  if (
    !nativeDecompilerHeader.ok &&
    (nativeDecompilerHeader.error instanceof AnalysisCancelledError ||
      nativeDecompilerHeader.error.cleanupIncomplete)
  )
    throw nativeDecompilerHeader.error;
  const homebrewJavaCandidates = () =>
    (architecture === "arm64"
      ? ["/opt/homebrew", "/usr/local"]
      : ["/usr/local", "/opt/homebrew"]
    )
      .map((prefix) =>
        path.join(
          prefix,
          "opt/openjdk/libexec/openjdk.jdk/Contents/Home/bin/java",
        ),
      )
      .filter((candidate) => host.executable(candidate));
  const selectedJava: {
    command: string;
    source: "configured" | "path" | "homebrew" | "default";
  } = (() => {
    if (options.javaHome !== undefined)
      return {
        source: "configured",
        command: appendCallerPath(
          options.javaHome,
          `bin/${platform === "win32" ? "java.exe" : "java"}`,
          platform,
        ),
      };
    if (platform !== "darwin")
      return {
        source: "default",
        command: platform === "win32" ? "java.exe" : "java",
      };
    // Check the caller's PATH, never a file named java in the working directory.
    const javaOnPath = options.environment.PATH?.split(":")
      .filter((directory) => path.isAbsolute(directory))
      .map((directory) => absoluteCallerPath(`${directory}/java`, { platform }))
      .find((candidate) => host.executable(candidate));
    if (javaOnPath !== undefined)
      return { source: "path", command: javaOnPath };
    const homebrew = homebrewJavaCandidates()[0];
    return homebrew === undefined
      ? { source: "default", command: "/usr/bin/java" }
      : { source: "homebrew", command: homebrew };
  })();
  let javaCommand = selectedJava.command;
  // Java is a prerequisite of a selected installation. Without one, or with a
  // relative JAVA_HOME, configuration validation refuses Ghidra before Java can
  // matter, so callers such as setup and doctor must not execute a host JVM.
  let javaProbe =
    installDir !== null &&
    (options.javaHome === undefined || path.isAbsolute(options.javaHome))
      ? await host.probeJava(
          javaCommand,
          ghidraJavaEnvironment(
            options.javaHome,
            options.environment,
            platform,
          ),
          {
            resourceOwner: options.resourceOwner,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          },
        )
      : undefined;
  if (
    javaProbe !== undefined &&
    !javaProbe.ok &&
    javaProbe.error instanceof AnalysisError
  )
    throw javaProbe.error;
  const javaDiscoveryFailures: {
    command: string;
    failure: GhidraJavaProbeFailure;
  }[] = [];
  if (
    platform === "darwin" &&
    options.javaHome === undefined &&
    (selectedJava.source === "path" || selectedJava.source === "default") &&
    javaProbe !== undefined &&
    !javaProbe.ok &&
    !(javaProbe.error instanceof AnalysisError) &&
    javaProbe.error.code !== "version_unresolved" &&
    javaProbe.error.cancellation === undefined &&
    !options.signal?.aborted
  ) {
    javaDiscoveryFailures.push({
      command: javaCommand,
      failure: javaProbe.error,
    });
    for (const candidate of homebrewJavaCandidates()) {
      const fallback = await host.probeJava(
        candidate,
        ghidraJavaEnvironment(undefined, options.environment, platform),
        {
          resourceOwner: options.resourceOwner,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      );
      if (fallback.ok) {
        javaCommand = candidate;
        javaProbe = fallback;
        break;
      }
      const failure = fallback.error;
      if (failure instanceof AnalysisError) throw failure;
      javaDiscoveryFailures.push({ command: candidate, failure });
      if (failure.cancellation !== undefined || options.signal?.aborted) {
        javaCommand = candidate;
        javaProbe = fallback;
        break;
      }
    }
  }
  return {
    installDir,
    applicationPropertiesPath,
    analyzeHeadlessPath,
    nativeDecompilerPath,
    nativeDecompilerHeader,
    properties:
      properties === undefined
        ? undefined
        : ghidraApplicationProperties(properties),
    ...(javaDiscoveryFailures.length === 0 ? {} : { javaDiscoveryFailures }),
    javaCommand,
    java: javaProbe?.ok === true ? javaProbe.value : undefined,
    javaProbeFailure:
      javaProbe !== undefined &&
      !javaProbe.ok &&
      !(javaProbe.error instanceof AnalysisError)
        ? javaProbe.error
        : undefined,
  };
};

const installationChecks = ({
  coordinates,
  platform,
  architecture,
  javaHome,
  host,
}: GhidraInstallationCheckContext): readonly GhidraInstallationCheck[] => [
  configurationCheck(coordinates.installDir, javaHome, platform),
  installationCheck({
    name: "platform",
    passed: NATIVE_PLATFORMS[platform] !== undefined,
    code: "unsupported_host",
    detail: platform,
    remediation:
      "Use Linux or macOS x64/arm64, or Windows x64 with matching native Ghidra tools.",
  }),
  installationCheck({
    name: "architecture",
    passed: NATIVE_PLATFORMS[platform]?.[architecture] !== undefined,
    code: "unsupported_host",
    detail: architecture,
    remediation: "Use x64/arm64 on Linux or macOS, or x64 on Windows.",
  }),
  installationCheck({
    name: "installation",
    passed: coordinates.properties !== undefined,
    code: "executable_missing",
    detail:
      coordinates.applicationPropertiesPath ??
      "Ghidra application properties unavailable",
    remediation:
      "Point GHIDRA_INSTALL_DIR at the root of an extracted official Ghidra release.",
  }),
  versionCheck(coordinates.properties),
  installationCheck({
    name: "headless",
    passed:
      coordinates.analyzeHeadlessPath !== null &&
      host.executable(coordinates.analyzeHeadlessPath),
    code: "executable_missing",
    detail: coordinates.analyzeHeadlessPath ?? "analyzeHeadless unavailable",
    remediation:
      "Restore support/analyzeHeadless or support/analyzeHeadless.bat from the official Ghidra release.",
  }),
  nativeDecompilerCheck({ coordinates, platform, architecture }),
  javaCheck(
    coordinates.java,
    coordinates.javaCommand,
    javaHome,
    coordinates.properties,
    platform,
    coordinates.javaProbeFailure,
  ),
];

/**
 * REA's configuration parser, and so the MCP server and analysis, accept only
 * absolute paths; a relative one that happens to resolve here must not pass.
 */
const configurationCheck = (
  installDir: string | null,
  javaHome: string | undefined,
  platform: NodeJS.Platform,
): GhidraInstallationCheck => {
  const { isAbsolute } = platform === "win32" ? win32 : posix;
  const relative = [
    ...(installDir !== null && !isAbsolute(installDir)
      ? ["GHIDRA_INSTALL_DIR"]
      : []),
    ...(javaHome !== undefined && !isAbsolute(javaHome) ? ["JAVA_HOME"] : []),
  ];
  if (installDir === null || relative.length === 0)
    return installationCheck({
      name: "configuration",
      passed: installDir !== null,
      code: "not_configured",
      detail: installDir ?? "GHIDRA_INSTALL_DIR is not set",
      remediation: `Set GHIDRA_INSTALL_DIR to an extracted Ghidra ${ghidraReleaseLine()} release directory.`,
    });
  const settings = relative.join(" and ");
  return installationCheck({
    name: "configuration",
    passed: false,
    code: "not_configured",
    detail: `${settings} must be absolute`,
    remediation: `Set ${settings} to ${relative.length === 1 ? "an absolute path" : "absolute paths"}. REA's analysis and MCP server reject relative paths even when they resolve from the current directory.`,
  });
};

/** Project an installation probe into caller-visible, bounded diagnostics. */
export const ghidraInstallationDiagnostics = (
  inspection: GhidraInstallationInspection,
): Readonly<Record<string, JsonValue>> => ({
  install_dir: inspection.installDir,
  analyze_headless_path: inspection.analyzeHeadlessPath,
  native_decompiler_path: inspection.nativeDecompilerPath,
  ...(inspection.nativeDecompilerHeaderFailure === undefined
    ? {}
    : {
        native_decompiler_header_failure: projectAnalysisError(
          inspection.nativeDecompilerHeaderFailure,
        ),
      }),
  application_properties_path: inspection.applicationPropertiesPath,
  provider_version: inspection.providerVersion,
  java_command: inspection.javaCommand,
  ...(inspection.javaProbeFailure === undefined
    ? {}
    : {
        java_probe_failure: {
          code: inspection.javaProbeFailure.code,
          ...(inspection.javaProbeFailure.processErrorCode === undefined
            ? {}
            : {
                process_error_code:
                  inspection.javaProbeFailure.processErrorCode,
              }),
          detail: inspection.javaProbeFailure.detail,
          ...(inspection.javaProbeFailure.cancellation === undefined
            ? {}
            : { cancellation_observed: true }),
          ...(inspection.javaProbeFailure.properties === undefined
            ? {}
            : { properties: { ...inspection.javaProbeFailure.properties } }),
          ...(inspection.javaProbeFailure.output === undefined
            ? {}
            : { output: { ...inspection.javaProbeFailure.output } }),
        },
      }),
  ...(inspection.javaDiscoveryFailures === undefined
    ? {}
    : {
        java_discovery_failures: inspection.javaDiscoveryFailures.map(
          ({ command, failure }) => ({
            command,
            code: failure.code,
            detail: failure.detail,
            ...(failure.output === undefined
              ? {}
              : { output: { ...failure.output } }),
            ...(failure.properties === undefined
              ? {}
              : { properties: { ...failure.properties } }),
            ...(failure.cancellation === undefined
              ? {}
              : { cancellation_observed: true }),
          }),
        ),
      }),
  java_home: inspection.javaHome,
  java_version: inspection.javaVersion,
  java_vm_name: inspection.javaVmName ?? null,
  java_os_arch: inspection.javaOsArch ?? null,
  java_os_name: inspection.javaOsName ?? null,
  platform: inspection.platform,
  architecture: inspection.architecture,
  checks: inspection.checks.map((check) => ({
    name: check.name,
    ok: check.status === "passed",
    code: check.status === "failed" ? check.code : null,
    detail: check.detail,
  })),
});

/** Environment that makes an explicitly selected JDK win over PATH discovery. */
export const ghidraJavaEnvironment = (
  javaHome: string | undefined,
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv => {
  const selectedEnvironment = snapshotEnvironment(environment, platform);
  const boundedEnvironment = {
    ...selectedEnvironment,
    _JAVA_OPTIONS: "",
    JAVA_TOOL_OPTIONS: "",
    JDK_JAVA_OPTIONS: "",
    GHIDRA_JAVA_OPTIONS: "",
  };
  return javaHome === undefined
    ? boundedEnvironment
    : {
        ...boundedEnvironment,
        JAVA_HOME: javaHome,
        PATH: `${appendCallerPath(javaHome, "bin", platform)}${platform === "win32" ? win32.delimiter : posix.delimiter}${selectedEnvironment.PATH ?? ""}`,
      };
};

const installationCheck = (options: {
  readonly name: GhidraInstallationCheckName;
  readonly passed: boolean;
  readonly detail: string;
  readonly code: ProviderRejectionCode;
  readonly remediation: string;
}): GhidraInstallationCheck =>
  options.passed
    ? {
        status: "passed",
        name: options.name,
        detail: options.detail,
      }
    : {
        status: "failed",
        name: options.name,
        code: options.code,
        detail: options.detail,
        remediation: options.remediation,
      };

/** Require a present native decompiler without positively incompatible bytes. */
const nativeDecompilerCheck = ({
  coordinates,
  platform,
  architecture,
}: Pick<
  GhidraInstallationCheckContext,
  "coordinates" | "platform" | "architecture"
>): GhidraInstallationCheck => {
  const path = coordinates.nativeDecompilerPath;
  const compatibility =
    path === null
      ? undefined
      : !coordinates.nativeDecompilerHeader.ok
        ? {
            status: "unknown" as const,
            detail: `${path} header is unknown: ${coordinates.nativeDecompilerHeader.error.message}`,
          }
        : assessNativeDecompiler(
            path,
            platform,
            architecture,
            coordinates.nativeDecompilerHeader.value,
          );
  // Ghidra resolves its native decompiler directory from the JVM's os.arch,
  // not the host process architecture. A JDK running under emulation (for
  // example x86_64 under Rosetta on Apple silicon) selects a directory that
  // was never validated, so every analysis fails after a passing doctor.
  // Ghidra resolves the OS directory from the JVM os.name/os.arch pair, so a
  // JVM reporting a non-host os.name (for example through -Dos.name=Windows)
  // selects a different OS directory even when os.arch matches.
  const osArch =
    coordinates.java?.osArch ??
    coordinates.javaProbeFailure?.properties?.osArch ??
    undefined;
  const osName =
    coordinates.java?.osName ??
    coordinates.javaProbeFailure?.properties?.osName ??
    undefined;
  const selectedDirectory = jvmOsArchNativeDirectory(platform, osArch);
  const validatedDirectory = NATIVE_PLATFORMS[platform]?.[architecture];
  // Without a JVM observation the java check reports the missing runtime;
  // the decompiler directory cannot be selected, so this check defers to it.
  if (coordinates.java !== undefined) {
    if (selectedDirectory === undefined)
      return installationCheck({
        name: "native_decompiler",
        passed: false,
        code: "executable_missing",
        detail:
          osArch === undefined
            ? "The Java probe did not report os.arch; the JVM-selected native decompiler directory is unknown and cannot be matched to the validated host directory"
            : `JVM reports unrecognized os.arch=${osArch}; its selected native decompiler directory is unknown and cannot be matched to the validated host directory`,
        remediation: `Point JAVA_HOME at a JDK whose reported architecture maps to the validated Ghidra decompiler (${validatedDirectory ?? "unsupported host"}). REA does not build or install native tools.`,
      });
    if (
      validatedDirectory !== undefined &&
      selectedDirectory !== validatedDirectory &&
      path !== null
    )
      return installationCheck({
        name: "native_decompiler",
        passed: false,
        code: "executable_missing",
        detail: `JVM reports os.arch=${osArch}, so Ghidra selects its native decompiler from os/${selectedDirectory}, but the validated decompiler targets ${validatedDirectory} (host ${platform}/${architecture})`,
        remediation: `Point JAVA_HOME at a JDK whose architecture matches the built decompiler (${validatedDirectory}). REA does not build or install native tools.`,
      });
    if (osName === undefined)
      return installationCheck({
        name: "native_decompiler",
        passed: false,
        code: "executable_missing",
        detail:
          "The Java probe did not report os.name; the JVM-selected native decompiler OS directory is unknown and cannot be matched to the validated host platform",
        remediation: `Point JAVA_HOME at a JDK whose reported operating system matches the host platform (${platform}). REA does not build or install native tools.`,
      });
    if (!jvmOsNameMatchesPlatform(platform, osName) && path !== null)
      return installationCheck({
        name: "native_decompiler",
        passed: false,
        code: "executable_missing",
        detail: `JVM reports os.name=${osName}, which does not match the validated host platform ${platform} (host ${platform}/${architecture})`,
        remediation: `Point JAVA_HOME at a JDK whose reported operating system matches the host platform (${platform}). REA does not build or install native tools.`,
      });
  }
  return installationCheck({
    name: "native_decompiler",
    passed: path !== null && compatibility?.status !== "incompatible",
    code: "executable_missing",
    detail:
      compatibility?.detail ??
      `Matching native decompiler for ${platform}/${architecture} was not found`,
    remediation:
      compatibility?.status === "incompatible"
        ? compatibility.remediation
        : `Provide an executable Ghidra/Features/Decompiler/os/${NATIVE_PLATFORMS[platform]?.[architecture] ?? "<platform>"}/${platform === "win32" ? "decompile.exe" : "decompile"}, or its build/os equivalent. REA does not build or install native tools.`,
  });
};

/**
 * Whether a JVM os.name value selects the host platform's native OS directory.
 * Unknown values never align with the validated host directory; admission
 * must not treat them as matching.
 */
const jvmOsNameMatchesPlatform = (
  platform: NodeJS.Platform,
  osName: string,
): boolean => {
  const normalized = osName.toLowerCase();
  if (platform === "win32") return normalized.startsWith("windows");
  if (platform === "darwin")
    return normalized.startsWith("mac") || normalized.startsWith("darwin");
  if (platform === "linux") return normalized.startsWith("linux");
  return false;
};

/**
 * Map a JVM os.arch value to the Ghidra native directory that JVM selects.
 * Unknown values stay unknown; admission must not treat them as aligned with
 * the validated host directory.
 */
const jvmOsArchNativeDirectory = (
  platform: NodeJS.Platform,
  osArch: string | undefined,
): string | undefined => {
  if (osArch === undefined) return undefined;
  const normalized = osArch.toLowerCase();
  const node: NodeJS.Architecture | undefined =
    normalized === "x86_64" || normalized === "amd64" || normalized === "x64"
      ? "x64"
      : normalized === "aarch64" || normalized === "arm64"
        ? "arm64"
        : undefined;
  return node === undefined ? undefined : NATIVE_PLATFORMS[platform]?.[node];
};

const versionCheck = (
  properties: GhidraApplicationProperties | undefined,
): GhidraInstallationCheck => {
  const raw = properties?.providerVersion;
  const parseError = properties?.parseError;
  return installationCheck({
    name: "version",
    passed: parseError == null && ghidraReleaseAccepted(raw),
    code:
      parseError != null
        ? "version_unresolved"
        : ghidraReleaseCompatibility(raw).status === "unsupported"
          ? "unsupported_version"
          : "version_unresolved",
    detail:
      parseError == null
        ? ghidraVersionDetail(raw)
        : `application.properties could not be parsed: ${parseError}`,
    remediation: `Install a Ghidra ${ghidraReleaseLine()} release (verified with ${SUPPORTED_GHIDRA_VERSION}), or update REA for another Ghidra line.`,
  });
};

const javaCheck = (
  observation: GhidraJavaObservation | undefined,
  command: string,
  configuredHome: string | undefined,
  properties: GhidraApplicationProperties | undefined,
  platform: NodeJS.Platform,
  failure: GhidraJavaProbeFailure | undefined,
): GhidraInstallationCheck => {
  const requirement = ghidraJavaRequirement(properties);
  const range = ghidraJavaRangeLabel(requirement);
  const supported =
    observation !== undefined &&
    ghidraJavaMajorAccepted(observation.major, requirement) &&
    observation.bits === 64 &&
    observation.runtime === "jdk";
  const bitness =
    observation === undefined
      ? undefined
      : observation.bits === null
        ? `bitness unknown${observation.unparsedBits === undefined ? "" : ` (sun.arch.data.model = ${JSON.stringify(observation.unparsedBits)})`}`
        : `${String(observation.bits)}-bit`;
  const knownMismatch =
    observation !== undefined &&
    (!ghidraJavaMajorAccepted(observation.major, requirement) ||
      (observation.bits !== null && observation.bits !== 64) ||
      observation.runtime !== "jdk");
  const detail =
    observation === undefined
      ? requirement.unresolved === null
        ? (failure?.detail ?? `${command}: Java probe was not attempted`)
        : `${failure?.detail ?? command}; ${requirement.unresolved}`
      : `${observation.version}; ${bitness}; ${observation.runtime === "jdk" ? "JDK" : "runtime only"}; ${observation.home}; accepted ${range}`;
  return installationCheck({
    name: "java",
    passed: supported,
    code:
      requirement.unresolved !== null
        ? "version_unresolved"
        : observation === undefined
          ? (failure?.code ?? "version_unresolved")
          : knownMismatch
            ? "unsupported_version"
            : "version_unresolved",
    detail,
    remediation: javaRemediation(requirement, configuredHome, range, platform),
  });
};

const javaRemediation = (
  requirement: GhidraJavaRequirement,
  configuredHome: string | undefined,
  range: string,
  platform: NodeJS.Platform,
): string => {
  if (requirement.unresolved !== null)
    return `The Ghidra installation's Java bounds could not be read (${requirement.unresolved}). Install a 64-bit full JDK inside the declared application.java.min and application.java.max.`;
  return configuredHome === undefined
    ? `Select ${range} on PATH, or set JAVA_HOME to its installation root before starting REA.${platform === "darwin" ? " Homebrew OpenJDK can be keg-only: set JAVA_HOME to the selected formula's libexec/openjdk.jdk/Contents/Home (for example /opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home or /usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home). The installed JDK must satisfy the declared Ghidra Java bounds." : ""}`
    : `Update JAVA_HOME to the root of ${range} installation.`;
};

export const systemGhidraInstallationHost = (): GhidraInstallationHost => ({
  readText: readGhidraInstallationProperties,
  executableHeader: readGhidraExecutableHeader,
  executable(path) {
    try {
      accessSync(path, constants.X_OK);
      return statSync(path).isFile();
    } catch (cause: unknown) {
      // best-effort cleanup: optional executable probing; failure means missing.
      void cause;
      return false;
    }
  },
  probeJava: probeGhidraJava,
  discoverInstallDirOnPath: discoverGhidraInstallationOnPath,
});

/** Find a PATH launcher whose real target is inside a complete Ghidra tree. */
export const discoverGhidraInstallationOnPath = (
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform,
): string | undefined => {
  if (platform !== process.platform) return undefined;
  const path = platform === "win32" ? win32 : posix;
  const pathValue = environment.PATH;
  if (pathValue === undefined) return undefined;
  const launchers =
    platform === "win32"
      ? ["ghidra.bat", "ghidraRun.bat", "ghidra.exe", "ghidraRun.exe"]
      : ["ghidra", "ghidraRun"];
  for (const directory of pathValue.split(pathDelimiter)) {
    // POSIX empty PATH entries select cwd, including an entirely empty PATH.
    if (directory.length === 0 && platform === "win32") continue;
    for (const launcher of launchers) {
      let resolved: string;
      try {
        const candidate = absoluteCallerPath(
          appendCallerPath(directory, launcher, platform),
          { platform },
        );
        if (!executablePath(candidate)) continue;
        resolved = realpathSync.native(candidate);
      } catch (cause: unknown) {
        void cause;
        continue;
      }
      const root = dirname(resolved);
      const properties = path.join(root, "Ghidra", "application.properties");
      const headless = path.join(
        root,
        "support",
        platform === "win32" ? "analyzeHeadless.bat" : "analyzeHeadless",
      );
      try {
        if (statSync(properties).isFile() && executablePath(headless))
          return stableGhidraInstallationRoot(root, platform);
      } catch (cause: unknown) {
        void cause;
      }
    }
  }
  return undefined;
};

/**
 * Keep a Homebrew Ghidra registration stable across keg upgrades when its
 * `opt` alias resolves to this exact, already validated installation.
 */
const stableGhidraInstallationRoot = (
  root: string,
  platform: NodeJS.Platform,
): string => {
  if (platform !== "darwin") return root;
  const parsed = posix.parse(root);
  const segments = root.slice(parsed.root.length).split(posix.sep);
  const cellarIndex = segments.length - 4;
  const formula = segments[cellarIndex + 1];
  const version = segments[cellarIndex + 2];
  if (
    cellarIndex < 0 ||
    segments[cellarIndex] !== "Cellar" ||
    formula === undefined ||
    formula.length === 0 ||
    version === undefined ||
    version.length === 0 ||
    segments[cellarIndex + 3] !== "libexec"
  )
    return root;

  const prefix = posix.join(parsed.root, ...segments.slice(0, cellarIndex));
  const candidate = posix.join(prefix, "opt", formula, "libexec");
  try {
    return realpathSync.native(candidate) === root ? candidate : root;
  } catch (cause: unknown) {
    // An absent or unresolved alias cannot establish a stable installation identity.
    void cause;
    return root;
  }
};

/** Preserve a proven caller alias, or an active Homebrew keg alias. */
const stableJavaHome = (
  observedHome: string,
  selectedHome: string | undefined,
  platform: NodeJS.Platform,
): string => {
  // Compare paths only with the matching host filesystem semantics.
  if (platform !== process.platform) return observedHome;
  const sameHome = (candidate: string): boolean => {
    try {
      return (
        realpathSync.native(candidate) === realpathSync.native(observedHome)
      );
    } catch (cause: unknown) {
      // Missing or unresolved aliases do not prove identity.
      void cause;
      return false;
    }
  };
  if (selectedHome !== undefined)
    return sameHome(selectedHome) ? selectedHome : observedHome;
  if (platform !== "darwin") return observedHome;
  const parsed = posix.parse(observedHome);
  const segments = observedHome.slice(parsed.root.length).split(posix.sep);
  const cellarIndex = segments.length - 7;
  const formula = segments[cellarIndex + 1];
  const version = segments[cellarIndex + 2];
  if (
    cellarIndex < 0 ||
    segments[cellarIndex] !== "Cellar" ||
    formula === undefined ||
    formula.length === 0 ||
    version === undefined ||
    version.length === 0 ||
    segments.slice(cellarIndex + 3).join("/") !==
      "libexec/openjdk.jdk/Contents/Home"
  )
    return observedHome;
  const prefix = posix.join(parsed.root, ...segments.slice(0, cellarIndex));
  const candidate = posix.join(
    prefix,
    "opt",
    formula,
    "libexec/openjdk.jdk/Contents/Home",
  );
  return sameHome(candidate) ? candidate : observedHome;
};

const executablePath = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch (cause: unknown) {
    // best-effort cleanup: optional executable probing; failure means missing.
    void cause;
    return false;
  }
};

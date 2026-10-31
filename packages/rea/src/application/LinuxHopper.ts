import { appendCallerPath } from "../filesystem/callerPath.js";
import type { AnalysisCleanupObservation } from "../domain/analysisErrorBase.js";
import type { HopperInstallFailureReason } from "./SetupInstallFailure.js";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";

import { execFileBoundedOutput } from "../process/ExecFileBoundedOutput.js";
import { execFileOutput } from "../process/ExecFileOutput.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  downloadHopperPackage,
  type HopperDownload,
} from "./HopperDownload.js";
import {
  inspectLinuxHopperPythonRuntime,
  linuxHopperPythonUnavailable,
  LinuxHopperPythonError,
} from "./LinuxHopperPython.js";
import { RegularFileCleanupFailure } from "../filesystem/OwnedRegularFile.js";
import { err, type Result } from "../domain/result.js";
import {
  HOPPER_RELEASES_URL,
  HOPPER_PUBLIC_KEY_URL,
  HOPPER_DOWNLOAD_PREFIX,
  HOPPER_LINUX_PRIMARY_FINGERPRINT,
  HopperReleaseError,
  type LinuxHopperRelease,
  type LinuxPackageFamily,
} from "./HopperReleaseFeed.js";
import {
  LinuxHopperPublisher,
  retryLinuxHopperPublisherCleanup,
  type VerifiedLinuxHopperPackage,
  type VerifiedLinuxHopperLauncher,
} from "./LinuxHopperPublisher.js";

/** Package-manager output retained per stream without stopping the command. */
const PACKAGE_MANAGER_OUTPUT_BYTES = 64 * 1024;
/**
 * The only host architecture the published Linux packages declare: `dpkg-deb`
 * reports `Architecture: amd64`, the RPM lead is `x86_64`, and `.PKGINFO` has
 * `arch = x86_64`.
 */
const SUPPORTED_RELEASE_ARCHITECTURE: NodeJS.Architecture = "x64";

/** Hosts the automated Linux Hopper installer supports, for remediation text. */
export const LINUX_HOPPER_SETUP_HOSTS =
  "an x86_64 host running Ubuntu 24.04+, Fedora 41+, Nobara 44+, Arch Linux, CachyOS, or Omarchy";

/** Package mutations disclosed before a Linux Hopper installation. */
export interface LinuxHopperInstallDisclosure {
  readonly networkOrigins: readonly string[];
  readonly integrity: string;
  readonly commands: readonly string[];
}

/** Describe the release and package-manager commands without downloading or writing. */
export const linuxHopperInstallDisclosure = (
  family: LinuxPackageFamily,
  isRoot: boolean,
): LinuxHopperInstallDisclosure => {
  return {
    networkOrigins: [
      HOPPER_RELEASES_URL,
      HOPPER_PUBLIC_KEY_URL,
      HOPPER_DOWNLOAD_PREFIX,
    ],
    integrity: `Detached PGP signature · primary ${HOPPER_LINUX_PRIMARY_FINGERPRINT} · package byte identity and installed launcher SHA-256 from the official feed`,
    commands: [
      ...linuxPackageManagerCommands(
        family,
        `<verified-hopper.${family}>`,
        isRoot,
      ),
      ...(family === "deb"
        ? [
            debianPythonLibraryCommand(
              "<libpython matching /usr/bin/python3, if not loadable>",
              isRoot,
            ),
          ]
        : []),
    ].map(({ executable, args }) => formatCommandForDisplay(executable, args)),
  };
};

interface LinuxDistributionIdentity {
  readonly id: string;
  readonly versionId?: string;
}

/**
 * Parsed Linux distribution information used for package selection.
 *
 * `hopperSetupSupported` is the automated Hopper installer's tested list,
 * restricted to hosts whose architecture matches the pinned package. It is
 * narrower than the hosts where REA itself runs, which {@link supportsReaHost}
 * answers from the package family.
 */
export type LinuxDistribution = LinuxDistributionIdentity &
  (
    | {
        readonly packageFamily: LinuxPackageFamily;
        readonly hopperSetupSupported: true;
      }
    | {
        readonly packageFamily: LinuxPackageFamily | undefined;
        readonly hopperSetupSupported: false;
      }
  );

/**
 * Whether REA's analysis providers run on this distribution. A recognized
 * package family means a glibc host with a known package layout, which is what
 * the providers need; downloading and installing the official Hopper package
 * additionally requires a distribution on its tested list.
 */
export const supportsReaHost = (
  distribution: LinuxDistribution | undefined,
): boolean => distribution?.packageFamily !== undefined;

/** One failed package-manager command, with the output that explains it. */
export interface LinuxPackageInstallFailure {
  /** The executed executable and arguments, joined for display. */
  readonly command: string;
  readonly exitCode: string | number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Whether the command produced more output than was retained. */
  readonly outputTruncated: boolean;
}

/** Whether the package-manager step installed the verified package. */
type LinuxPackageCommandOutcome =
  | { readonly status: "installed" }
  | {
      readonly status: "failed";
      readonly failure: LinuxPackageInstallFailure;
    };

export type LinuxPackageInstallOutcome =
  | LinuxPackageCommandOutcome
  | { readonly status: "cancelled"; readonly cause: unknown }
  | {
      readonly status: "runtime_unavailable";
      readonly failure: LinuxHopperPythonError;
    };

/** External effects required to install the official Linux package. */
export interface LinuxHopperInstallHost {
  distribution(): Promise<LinuxDistribution | undefined>;
  release(
    family: LinuxPackageFamily,
    signal?: AbortSignal,
  ): Promise<Result<LinuxHopperRelease, HopperReleaseError>>;
  download(
    url: string,
    options: { readonly signal?: AbortSignal },
  ): Promise<HopperDownload>;
  createTemporaryDirectory(): Promise<string>;
  writeArchive(path: string, bytes: Uint8Array): Promise<void>;
  installPackage(
    family: LinuxPackageFamily,
    archive: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<LinuxPackageInstallOutcome>;
  verifyArchive(
    family: LinuxPackageFamily,
    release: LinuxHopperRelease,
    archive: string,
    signal?: AbortSignal,
  ): Promise<Result<VerifiedLinuxHopperPackage, HopperReleaseError>>;
  retainVerifiedArchive(
    verified: VerifiedLinuxHopperPackage,
    archive: string,
    signal?: AbortSignal,
  ): Promise<Result<void, HopperReleaseError>>;
  launcherStatus(
    path: string,
    expectedSha256: string,
  ): Promise<LinuxHopperLauncherStatus>;
  cleanup(path: string): Promise<void>;
  close?(): Promise<void>;
}

interface LinuxHopperOperationFailure {
  readonly operation:
    | HopperInstallFailureReason
    | "access"
    | "dependencies"
    | "hash";
  readonly detail: string;
  readonly path?: string;
  readonly systemCode?: string;
}

const operationFailure = (
  operation: LinuxHopperOperationFailure["operation"],
  cause: unknown,
  path?: string,
): LinuxHopperOperationFailure => {
  const code: unknown =
    cause instanceof Error ? Reflect.get(cause, "code") : undefined;
  return {
    operation,
    detail: cause instanceof Error ? cause.message : String(cause),
    ...(path === undefined ? {} : { path }),
    ...(typeof code === "string" ? { systemCode: code } : {}),
  };
};

/** Structured outcome for every expected Linux installation failure. */
export type LinuxHopperInstallResult =
  | ({ readonly status: "installed"; readonly launcherPath: string } & {
      readonly cleanupFailure?: LinuxHopperTemporaryCleanupFailure;
    })
  | ({
      readonly status: "failed";
      readonly reason:
        | "unsupported_host"
        | "release_metadata"
        | "download"
        | "archive_write"
        | "launcher_inspection"
        | "integrity"
        | "authorization_or_package_manager"
        | "launcher_missing"
        | "runtime_dependencies"
        | "unsupported_hopper_build"
        | "publisher_verification_failed"
        | "verification_unavailable"
        | "cleanup_failed"
        | "cancelled";
      /**
       * The failing package-manager command and its output. Present only when
       * the package-manager step itself failed, so setup can report what the
       * package manager said instead of assuming an authorization problem.
       */
      readonly packageFailure?: LinuxPackageInstallFailure;
      /** Publisher-owned failure, retained for the public setup diagnostic. */
      readonly verificationFailure?: HopperReleaseError;
      /** System-interpreter inspection, kept separate from package-manager output. */
      readonly pythonRuntimeFailure?: LinuxHopperPythonError;
      /** The operation that threw, retained separately from its outcome class. */
      readonly operationFailure?: LinuxHopperOperationFailure;
      /** Original caller cancellation, without flattening its value into text. */
      readonly cancellationReason?: unknown;
    } & { readonly cleanupFailure?: LinuxHopperTemporaryCleanupFailure });

/** Failed removal of an owned temporary install directory. */
export interface LinuxHopperTemporaryCleanupFailure {
  readonly path: string;
  readonly reason: string;
}

/** Own failed temporary cleanup until a later retry succeeds. */
export class LinuxHopperTemporaryCleanupOwner {
  private readonly pending = new Map<
    string,
    LinuxHopperTemporaryCleanupFailure
  >();

  retain(failure: LinuxHopperTemporaryCleanupFailure): void {
    this.pending.set(failure.path, failure);
  }

  async retry(
    cleanup: (path: string) => Promise<void>,
  ): Promise<AnalysisCleanupObservation | undefined> {
    const failures: string[] = [];
    for (const path of this.pending.keys()) {
      try {
        await cleanup(path);
        this.pending.delete(path);
      } catch (cause: unknown) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        failures.push(
          `Linux Hopper temporary cleanup failed for ${path}: ${reason}`,
        );
      }
    }
    return failures.length === 0
      ? undefined
      : {
          reason: failures.join("; "),
          resources: [...this.pending.keys()],
        };
  }
}

export type LinuxHopperLauncherStatus =
  | "ready"
  | "missing"
  | "runtime_dependencies"
  | "unsupported_hopper_build"
  | "cleanup_failed"
  | {
      readonly status: "inspection_failed";
      readonly operation: "access" | "dependencies" | "hash";
      readonly detail: string;
      readonly path: string;
      readonly systemCode?: string;
    };

/**
 * Parse an os-release document without executing its shell syntax, and
 * classify automated Hopper setup for the host architecture.
 */
export const parseLinuxDistribution = (
  text: string,
  architecture: NodeJS.Architecture,
): LinuxDistribution => {
  const fields = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = /^([A-Z_]+)=(.*)$/u.exec(line.trim());
    if (match === null) continue;
    const key = match[1];
    const encoded = match[2];
    if (key === undefined || encoded === undefined) continue;
    const quote = encoded[0];
    const quoted = (quote === "'" || quote === '"') && encoded.endsWith(quote);
    const value = !quoted
      ? encoded
      : quote === "'"
        ? encoded.slice(1, -1)
        : encoded.slice(1, -1).replace(/\\(["\\$`])/gu, "$1");
    fields.set(key, value);
  }
  const id = (fields.get("ID") ?? "unknown").toLowerCase();
  const versionId = fields.get("VERSION_ID");
  const packageFamily = packageFamilyFor(id, fields.get("ID_LIKE"));
  const hopperSetupSupported =
    packageFamily !== undefined &&
    architecture === SUPPORTED_RELEASE_ARCHITECTURE &&
    (id === "arch" ||
      id === "cachyos" ||
      (id === "omarchy" && packageFamily === "arch") ||
      (id === "ubuntu" && versionAtLeast(versionId, 24)) ||
      (id === "fedora" && versionAtLeast(versionId, 41)) ||
      (id === "nobara" && versionAtLeast(versionId, 44)));
  const identity = {
    id,
    ...(versionId === undefined ? {} : { versionId }),
  };
  return hopperSetupSupported
    ? { ...identity, packageFamily, hopperSetupSupported: true }
    : { ...identity, packageFamily, hopperSetupSupported: false };
};

/** Read and classify the current Linux distribution on a host architecture. */
export const readLinuxDistribution = async (
  architecture: NodeJS.Architecture,
): Promise<LinuxDistribution | undefined> => {
  try {
    return parseLinuxDistribution(
      await readFile("/etc/os-release", "utf8"),
      architecture,
    );
  } catch (cause: unknown) {
    // best-effort cleanup: optional host probing; unknown distribution means unsupported.
    void cause;
    return undefined;
  }
};

/** Download, verify, install, and read back the official Hopper Linux package. */
export const installLinuxHopper = async (
  host: LinuxHopperInstallHost,
  options: {
    readonly signal?: AbortSignal;
  } = {},
): Promise<LinuxHopperInstallResult> => {
  if (isAborted(options.signal))
    return cancelledInstall(options.signal?.reason);
  const distribution = await host.distribution();
  if (distribution?.hopperSetupSupported !== true)
    return { status: "failed", reason: "unsupported_host" };
  let temporary: string | undefined;
  let result: LinuxHopperInstallResult;
  let stage: Extract<LinuxHopperInstallResult, { status: "failed" }>["reason"] =
    "release_metadata";
  let operationPath: string | undefined;
  try {
    result = await (async (): Promise<LinuxHopperInstallResult> => {
      const selected = await host.release(
        distribution.packageFamily,
        options.signal,
      );
      if (!selected.ok)
        return {
          status: "failed",
          verificationFailure: selected.error,
          reason:
            selected.error.reason === "cancelled"
              ? "cancelled"
              : "release_metadata",
        };
      const release = selected.value;
      stage = "download";
      const archiveDownload = await host.download(release.filename, options);
      if (!archiveDownload.ok)
        return {
          status: "failed",
          reason: "download",
          ...(archiveDownload.httpStatus === undefined
            ? {}
            : {
                operationFailure: {
                  operation: "download",
                  detail: `Package download returned HTTP ${archiveDownload.httpStatus}.`,
                },
              }),
        };
      stage = "archive_write";
      temporary = await host.createTemporaryDirectory();
      // Linux package paths stay POSIX even when this host is exercised from
      // a non-Linux test process.
      const archive = posix.join(
        temporary,
        `hopper.${distribution.packageFamily}`,
      );
      operationPath = archive;
      await host.writeArchive(archive, archiveDownload.bytes);
      stage = "publisher_verification_failed";
      const verified = await host.verifyArchive(
        distribution.packageFamily,
        release,
        archive,
        options.signal,
      );
      if (!verified.ok)
        return {
          status: "failed",
          verificationFailure: verified.error,
          reason:
            verified.error.reason === "cache_missing"
              ? "verification_unavailable"
              : verified.error.reason,
        };
      const retained = await host.retainVerifiedArchive(
        verified.value,
        archive,
        options.signal,
      );
      if (!retained.ok)
        return {
          status: "failed",
          verificationFailure: retained.error,
          reason:
            retained.error.reason === "cache_missing"
              ? "verification_unavailable"
              : retained.error.reason,
        };
      if (isAborted(options.signal))
        return cancelledInstall(options.signal?.reason);
      stage = "authorization_or_package_manager";
      const install = await host.installPackage(
        distribution.packageFamily,
        archive,
        options,
      );
      if (install.status === "cancelled")
        return cancelledInstall(install.cause);
      if (install.status === "failed")
        return {
          status: "failed",
          reason: "authorization_or_package_manager",
          packageFailure: install.failure,
        };
      if (install.status === "runtime_unavailable")
        return {
          status: "failed",
          reason: "runtime_dependencies",
          pythonRuntimeFailure: install.failure,
        };
      stage = "launcher_inspection";
      const launcherPath = "/opt/hopper/bin/Hopper";
      operationPath = launcherPath;
      const launcherStatus = await host.launcherStatus(
        launcherPath,
        release.main_exe_hash,
      );
      if (typeof launcherStatus !== "string")
        return {
          status: "failed",
          reason: "launcher_inspection",
          operationFailure: launcherStatus,
        };
      if (launcherStatus !== "ready")
        return {
          status: "failed",
          reason:
            launcherStatus === "missing" ? "launcher_missing" : launcherStatus,
        };
      return { status: "installed", launcherPath };
    })();
  } catch (cause: unknown) {
    result = {
      status: "failed",
      reason:
        isAborted(options.signal) || isAbortCause(cause) ? "cancelled" : stage,
      operationFailure: operationFailure(stage, cause, operationPath),
    };
  }
  if (
    result.status === "failed" &&
    result.reason === "cancelled" &&
    isAborted(options.signal)
  )
    result = { ...result, cancellationReason: options.signal?.reason };
  if (temporary === undefined) return result;
  try {
    await host.cleanup(temporary);
    return result;
  } catch (cause: unknown) {
    return {
      ...result,
      cleanupFailure: {
        path: temporary,
        reason: cause instanceof Error ? cause.message : String(cause),
      },
    };
  }
};

/** Canonical launcher path for a legacy user-local Linux Hopper installation. */
export const linuxHopperLauncherPath = (home: string): string =>
  appendCallerPath(home, ".local/share/rea/hopper/bin/Hopper", "linux");

/** REA's managed Linux install path, preferred when no explicit launcher is set. */
export const REA_MANAGED_LINUX_HOPPER_LAUNCHER = "/opt/hopper/bin/Hopper";

/** Other system-wide Hopper paths used by package installations. */
const systemLinuxHopperLauncherCandidates: readonly string[] = [
  "/opt/hopper-v4/bin/hopper",
  "/usr/bin/hopper",
];

/** Probe REA-managed and user-local installs before arbitrary system builds. */
export const linuxHopperLauncherCandidates = (
  home: string,
): readonly string[] => [
  REA_MANAGED_LINUX_HOPPER_LAUNCHER,
  linuxHopperLauncherPath(home),
  ...systemLinuxHopperLauncherCandidates,
];

/**
 * Compose package-manager and linker checks from the selected caller
 * environment. The distribution comes from the caller's host-fact owner, so
 * installation follows the same architecture classification as the plan.
 */
export const systemLinuxHopperInstallHost = (
  environment: Readonly<NodeJS.ProcessEnv>,
  distribution: LinuxHopperInstallHost["distribution"],
): LinuxHopperInstallHost => {
  const publisher = systemLinuxHopperPublisher(environment);
  return {
    distribution,
    release: (family, signal) => publisher.currentRelease(family, signal),
    download: downloadHopperPackage,
    createTemporaryDirectory: () => mkdtemp(join(tmpdir(), "rea-hopper-")),
    writeArchive: (path, bytes) => writeFile(path, bytes, { mode: 0o600 }),
    installPackage: (family, archive, options) =>
      installSystemPackage(family, archive, environment, options?.signal),
    verifyArchive: (family, release, archive, signal) =>
      publisher.verifyArchive(family, release, archive, signal),
    retainVerifiedArchive: (verified, archive, signal) =>
      publisher.retainVerifiedArchive(verified, archive, signal),
    async launcherStatus(path, expectedSha256) {
      let operation: "access" | "dependencies" | "hash" = "access";
      try {
        await access(path);
        operation = "dependencies";
        const linked = await execFileOutput("ldd", [path], {
          env: environment,
        });
        if (
          !linuxSharedLibrariesAvailable(`${linked.stdout}\n${linked.stderr}`)
        )
          return "runtime_dependencies";
        operation = "hash";
        return (await publisher.hashLauncher(path)) === expectedSha256
          ? "ready"
          : "unsupported_hopper_build";
      } catch (cause: unknown) {
        if (
          cause instanceof RegularFileCleanupFailure ||
          (cause instanceof HopperReleaseError &&
            cause.reason === "cleanup_failed") ||
          (cause instanceof ArtifactReaderFailure &&
            cause.cleanup !== undefined)
        )
          return "cleanup_failed";
        if (
          operation === "access" &&
          cause instanceof Error &&
          "code" in cause &&
          cause.code === "ENOENT"
        )
          return "missing";
        return {
          status: "inspection_failed",
          ...operationFailure(operation, cause, path),
          operation,
          path,
        };
      }
    },
    cleanup: (path) => rm(path, { recursive: true, force: true }),
    close: () => closePublisherAndRetainedScopes(publisher),
  };
};

export const systemLinuxHopperPublisher = (
  environment: Readonly<NodeJS.ProcessEnv>,
): LinuxHopperPublisher =>
  new LinuxHopperPublisher(
    environment,
    // Only the package family is read here; it does not depend on the
    // architecture that gates automated setup.
    async () => (await readLinuxDistribution(process.arch))?.packageFamily,
  );

/** Read-only authentication; persistent package retention belongs to approved setup. */
export const inspectLinuxHopperLauncher = async (
  path: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  signal?: AbortSignal,
): Promise<Result<VerifiedLinuxHopperLauncher, HopperReleaseError>> => {
  const publisher = systemLinuxHopperPublisher(environment);
  const result = await publisher.inspectLauncher(path, signal);
  try {
    await closePublisherAndRetainedScopes(publisher);
    return result;
  } catch (cause: unknown) {
    return err(
      new HopperReleaseError(
        "cleanup_failed",
        "Hopper publisher verification retains incomplete cleanup.",
        {
          cause: new AggregateError(
            result.ok ? [cause] : [result.error, cause],
            "Publisher verification outcomes",
          ),
        },
      ),
    );
  }
};

/** The publisher retains a failed close before throwing; retry every retained owner. */
const closePublisherAndRetainedScopes = async (
  publisher: LinuxHopperPublisher,
): Promise<void> => {
  try {
    await publisher.close();
  } catch {
    // The following producer-owned drain includes this scope and earlier ones.
    // Its result reports the resources still unresolved after every attempt.
  }
  await retryLinuxHopperPublisherCleanup();
};

/** Interpret ldd output conservatively so a present but broken launcher is unhealthy. */
export const linuxSharedLibrariesAvailable = (output: string): boolean =>
  !/(?:=>\s+not found|error while loading shared libraries)/iu.test(output);

const installSystemPackage = async (
  family: LinuxPackageFamily,
  archive: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  signal?: AbortSignal,
): Promise<LinuxPackageInstallOutcome> => {
  const cancelled = (): LinuxPackageInstallOutcome => ({
    status: "cancelled",
    cause: signal?.reason,
  });
  const isRoot = process.getuid?.() === 0;
  for (const command of linuxPackageManagerCommands(family, archive, isRoot)) {
    if (isAborted(signal)) return cancelled();
    // Let a running package transaction settle; do not start another after
    // the caller cancels. Interrupting dpkg can leave configured state partial.
    const result = await runPackageManagerCommand(command, environment);
    if (result.status === "failed") return result;
  }
  if (isAborted(signal)) return cancelled();
  if (family !== "deb") return { status: "installed" };

  // Ubuntu splits the executable/stdlib from the embedding library. Resolve
  // the installed distribution interpreter only after python3 is configured.
  const python = await inspectLinuxHopperPythonRuntime(environment, signal);
  if (isAborted(signal)) return cancelled();
  if (!python.ok) return pythonInspectionFailure(python.error);
  if (python.value.library.status === "loadable")
    return { status: "installed" };
  if (python.value.library.status === "unknown")
    return {
      status: "runtime_unavailable",
      failure: linuxHopperPythonUnavailable(python.value.library),
    };
  const packageName = "libpython" + python.value.version.join(".");
  const libraryPath = python.value.library.path;
  // Only the standard Ubuntu shared ABI/layout establishes this APT mapping.
  // Preserve alternate prefixes/SONAMEs as unknown instead of guessing a package.
  if (
    posix.basename(libraryPath) !== packageName + ".so.1.0" ||
    !/^\/usr\/lib\/[a-z0-9_]+-linux-gnu[a-z0-9_]*$/u.test(
      posix.dirname(libraryPath),
    )
  )
    return {
      status: "runtime_unavailable",
      failure: new LinuxHopperPythonError(
        "configuration_unknown",
        "Cannot determine the matching APT runtime package for " +
          libraryPath +
          ". Repair this interpreter's shared runtime before retrying.",
      ),
    };
  if (isAborted(signal)) return cancelled();
  const installed = await runPackageManagerCommand(
    debianPythonLibraryCommand(packageName, isRoot),
    environment,
  );
  if (installed.status === "failed") return installed;
  if (isAborted(signal)) return cancelled();
  // A successful APT exit is not proof that the selected runtime can load.
  const verified = await inspectLinuxHopperPythonRuntime(environment, signal);
  if (isAborted(signal)) return cancelled();
  if (!verified.ok) return pythonInspectionFailure(verified.error);
  if (verified.value.library.status !== "loadable")
    return {
      status: "runtime_unavailable",
      failure: linuxHopperPythonUnavailable(verified.value.library),
    };
  return { status: "installed" };
};

const isAborted = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;

const cancelledInstall = (cause: unknown): LinuxHopperInstallResult => ({
  status: "failed",
  reason: "cancelled",
  cancellationReason: cause,
});

const pythonInspectionFailure = (
  failure: LinuxHopperPythonError,
): LinuxPackageInstallOutcome =>
  failure.reason === "cancelled"
    ? { status: "cancelled", cause: failure.cause }
    : { status: "runtime_unavailable", failure };

interface PackageCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

const withPackagePrivilege = (
  executable: string,
  args: readonly string[],
  isRoot: boolean,
): PackageCommand =>
  isRoot
    ? { executable, args }
    : { executable: "pkexec", args: [executable, ...args] };

const debianPythonLibraryCommand = (
  packageName: string,
  isRoot: boolean,
): PackageCommand =>
  withPackagePrivilege("apt-get", ["install", "-y", packageName], isRoot);

const runPackageManagerCommand = async (
  command: PackageCommand,
  environment: Readonly<NodeJS.ProcessEnv>,
): Promise<LinuxPackageCommandOutcome> => {
  const output = await execFileBoundedOutput(command.executable, command.args, {
    env: environment,
    limit: PACKAGE_MANAGER_OUTPUT_BYTES,
  });
  return output.exitCode === 0
    ? { status: "installed" }
    : {
        status: "failed",
        failure: {
          command: formatCommandForDisplay(command.executable, command.args),
          exitCode: output.exitCode,
          // Preserve the separately captured streams and truncation marker.
          stdout: output.stdout,
          stderr: output.stderr,
          outputTruncated: output.outputTruncated,
        },
      };
};

/** Preserve argument boundaries in a command shown to the user. */
export const formatCommandForDisplay = (
  executable: string,
  args: readonly string[],
): string =>
  [executable, ...args]
    .map((part) =>
      /^[A-Za-z0-9_./:@%+=,-]+$/u.test(part) ? part : JSON.stringify(part),
    )
    .join(" ");

/** Select the native package manager and authorization boundary without shell evaluation. */
export const linuxPackageManagerCommands = (
  family: LinuxPackageFamily,
  archive: string,
  isRoot: boolean,
): readonly PackageCommand[] => {
  const runtimeDependencies =
    family === "deb"
      ? ["xvfb", "xauth", "python3", "libx11-6", "libxtst6"]
      : family === "rpm"
        ? [
            "xorg-x11-server-Xvfb",
            "xorg-x11-xauth",
            "python3",
            "libX11",
            "libXtst",
          ]
        : ["xorg-server-xvfb", "xorg-xauth", "python", "libx11", "libxtst"];
  const commands =
    family === "deb"
      ? [
          // apt-get install upgrades listed packages that are already
          // installed, so dependencies are not named as upgrade targets.
          ["apt-get", "install", "-y", "--no-upgrade", ...runtimeDependencies],
          ["apt-get", "install", "-y", archive],
        ]
      : family === "rpm"
        ? [["dnf", "install", "-y", archive, ...runtimeDependencies]]
        : [
            ["pacman", "-S", "--needed", "--noconfirm", ...runtimeDependencies],
            ["pacman", "-U", "--noconfirm", archive],
          ];
  return commands.map((command) => {
    const executable = command[0];
    if (executable === undefined) throw new Error("package command is empty");
    return withPackagePrivilege(executable, command.slice(1), isRoot);
  });
};

const packageFamilyFor = (
  id: string,
  idLike: string | undefined,
): LinuxPackageFamily | undefined => {
  const identities = new Set([
    id,
    ...(idLike?.toLowerCase().split(/\s+/u) ?? []),
  ]);
  if (identities.has("ubuntu") || identities.has("debian")) return "deb";
  if (identities.has("fedora") || identities.has("rhel")) return "rpm";
  if (identities.has("arch")) return "arch";
  return undefined;
};

const versionAtLeast = (
  version: string | undefined,
  minimum: number,
): boolean =>
  version !== undefined &&
  Number.parseInt(version.split(".")[0] ?? "0", 10) >= minimum;
const isAbortCause = (cause: unknown): boolean =>
  cause instanceof Error && cause.name === "AbortError";

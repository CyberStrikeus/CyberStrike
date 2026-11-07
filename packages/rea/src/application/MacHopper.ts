import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { promisify } from "node:util";

import { appendCallerPath } from "../filesystem/callerPath.js";
import { homeDirectoryFromEnvironment } from "../config/homeDirectory.js";
import type { AnalysisCleanupObservation } from "../domain/analysisErrorBase.js";
import { HOPPER_PUBLISHER } from "../domain/hopperPublisher.js";
import { macDeveloperIdRequirement } from "../process/MacCodeSignature.js";
import { macHopperUserApplicationPath } from "./MacHopperPaths.js";
import { downloadHopperPackage } from "./HopperDownload.js";
import {
  HOPPER_RELEASES_URL,
  HOPPER_DOWNLOAD_PREFIX,
  parseHopperReleaseJson,
  parseMacHopperReleases,
  hopperArchiveIntegrityMatches,
} from "./HopperReleaseFeed.js";
import type { HopperInstallFailureReason } from "./SetupInstallFailure.js";

const execFileAsync = promisify(execFile);
const HOPPER_PUBLISHER_REQUIREMENT = macDeveloperIdRequirement(
  HOPPER_PUBLISHER.bundleIdentifier,
  HOPPER_PUBLISHER.teamIdentifier,
);

/** Outcome of reading a mounted bundle's signature and publisher identity. */
export type MacHopperBundleVerification =
  | "verified"
  | "invalid_signature"
  | "unverified_publisher";

type MacHopperInstallFailureReason = Extract<
  HopperInstallFailureReason,
  | "release_metadata"
  | "download"
  | "integrity"
  | "launcher_missing"
  | "destination_exists"
  | "destination_inspection"
  | "mount"
  | "bundle"
  | "publisher_verification_failed"
  | "copy"
>;

export type MacHopperBundleInstallResult =
  | { readonly status: "installed"; readonly cleanupFailure?: string }
  | {
      readonly status: "failed";
      readonly reason: "copy" | "launcher_missing";
      readonly diagnostic: string;
      readonly cleanupFailure?: string;
    };

/** Filesystem effects for one installer-owned bundle replacement transaction. */
export interface MacHopperBundleInstallOperations {
  createStagingRoot(parent: string): Promise<string>;
  copyBundle(source: string, stage: string): Promise<void>;
  requireLauncher(path: string): Promise<void>;
  pathExists(path: string): Promise<boolean>;
  rename(source: string, destination: string): Promise<void>;
  removeStagingRoot(path: string): Promise<void>;
}

/** Stable network and command effects disclosed before macOS Hopper setup. */
export const macHopperInstallDisclosure = {
  networkOrigins: [HOPPER_RELEASES_URL, HOPPER_DOWNLOAD_PREFIX] as const,
  commands: [
    "hdiutil attach -readonly -nobrowse -mountpoint <private-mount> <verified-hopper.dmg>",
    "codesign --verify --deep --strict <mounted-hopper.app>",
    `codesign --verify --strict '-R${HOPPER_PUBLISHER_REQUIREMENT}' <mounted-hopper.app>`,
    "ditto <mounted-hopper.app> <user-Applications-stage>",
    "open <installed-hopper.app>",
  ] as const,
};

/** Result of installing the official Hopper macOS application. */
export type MacHopperInstallResult =
  | {
      readonly status: "installed";
      readonly launcherPath: string;
      readonly cleanupFailure?: string;
      readonly openFailure?: string;
    }
  | {
      readonly status: "failed";
      readonly reason: MacHopperInstallFailureReason;
      readonly diagnostic?: string;
      readonly cleanupFailure?: string;
    };

/** External effects used by the bounded macOS Hopper installer. */
export interface MacHopperInstallHost {
  download(
    url: string,
  ): Promise<{ readonly ok: boolean; readonly bytes: Uint8Array }>;
  createTemporaryDirectory(): Promise<string>;
  createMountDirectory(path: string): Promise<void>;
  writePackage(path: string, bytes: Uint8Array): Promise<void>;
  mount(packagePath: string, mountPath: string): Promise<boolean>;
  unmount(mountPath: string): Promise<void>;
  appBundle(mountPath: string): Promise<string | undefined>;
  validBundle(appPath: string): Promise<MacHopperBundleVerification>;
  destinationExists(path: string): Promise<boolean>;
  installBundle(
    source: string,
    destination: string,
    replaceExisting: boolean,
  ): Promise<MacHopperBundleInstallResult>;
  openApplication(path: string): Promise<void>;
  cleanup(path: string): Promise<void>;
  /** Retain the cleanup capability until the owning setup host retries it. */
  retainCleanup?(
    cleanup: () => Promise<void>,
    resources: readonly string[],
  ): void;
  destination(): string;
}

/** Download, verify, and install Hopper into the current user's Applications directory. */
export const installMacHopper = async (
  options: { readonly replaceExisting?: boolean } = {},
  host: MacHopperInstallHost = systemMacHopperInstallHost(
    homeDirectoryFromEnvironment(process.env, process.platform),
    process.env,
  ),
): Promise<MacHopperInstallResult> => {
  let temporary: string | undefined;
  let mounted = false;
  let bundleCleanupFailure: string | undefined;
  let installStage: MacHopperInstallFailureReason = "release_metadata";
  let result: MacHopperInstallResult;
  try {
    result = await (async (): Promise<MacHopperInstallResult> => {
      const metadata = await host.download(HOPPER_RELEASES_URL);
      if (!metadata.ok) return { status: "failed", reason: "release_metadata" };
      const decoded = parseHopperReleaseJson(metadata.bytes);
      if (!decoded.ok) throw decoded.cause;
      const parsed = parseMacHopperReleases(decoded.value);
      if (!parsed.ok) return { status: "failed", reason: "release_metadata" };
      const release = parsed.value;
      installStage = "download";
      const archive = await host.download(release.filename);
      if (!archive.ok) return { status: "failed", reason: "download" };
      installStage = "integrity";
      if (!hopperArchiveIntegrityMatches(archive.bytes, release))
        return { status: "failed", reason: "integrity" };

      installStage = "destination_inspection";
      const destination = host.destination();
      const destinationExists = await host.destinationExists(destination);
      if (destinationExists && options.replaceExisting !== true)
        return { status: "failed", reason: "destination_exists" };
      installStage = "mount";
      temporary = await host.createTemporaryDirectory();
      const packagePath = posix.join(temporary, "hopper.dmg");
      const mountPath = posix.join(temporary, "mounted");
      await host.createMountDirectory(mountPath);
      await host.writePackage(packagePath, archive.bytes);
      if (!(await host.mount(packagePath, mountPath)))
        return { status: "failed", reason: "mount" };
      mounted = true;
      installStage = "bundle";
      const source = await host.appBundle(mountPath);
      if (source === undefined) return { status: "failed", reason: "bundle" };
      const verification = await host.validBundle(source);
      if (verification === "invalid_signature")
        return { status: "failed", reason: "bundle" };
      if (verification === "unverified_publisher")
        return { status: "failed", reason: "publisher_verification_failed" };
      installStage = "copy";
      const installation = await host.installBundle(
        source,
        destination,
        destinationExists,
      );
      if (installation.status === "failed")
        return {
          status: "failed",
          reason: installation.reason,
          diagnostic: installation.diagnostic,
          ...(installation.cleanupFailure === undefined
            ? {}
            : { cleanupFailure: installation.cleanupFailure }),
        };
      bundleCleanupFailure = installation.cleanupFailure;
      const launcherPath = appendCallerPath(
        destination,
        "Contents/MacOS/hopper",
        "darwin",
      );
      let openFailure: string | undefined;
      try {
        await host.openApplication(destination);
      } catch (cause: unknown) {
        openFailure = failureMessage(cause);
      }
      return {
        status: "installed",
        launcherPath,
        ...(openFailure === undefined ? {} : { openFailure }),
      };
    })();
  } catch (cause: unknown) {
    result = {
      status: "failed",
      reason: installStage,
      diagnostic: failureMessage(cause),
    };
  }

  let cleanupFailure: string | undefined;
  if (temporary !== undefined) {
    const temporaryPath = temporary;
    const mountPath = posix.join(temporary, "mounted");
    const cleanup = async (): Promise<void> => {
      if (mounted) {
        await host.unmount(mountPath);
        mounted = false;
      }
      await host.cleanup(temporaryPath);
    };
    try {
      await cleanup();
    } catch (cause: unknown) {
      cleanupFailure = `Hopper DMG cleanup failed: ${failureMessage(cause)}`;
      host.retainCleanup?.(cleanup, [temporaryPath]);
    }
  }

  const retainedCleanupFailure = [
    bundleCleanupFailure,
    cleanupFailure,
    result.cleanupFailure,
  ]
    .filter((failure): failure is string => failure !== undefined)
    .join(" ");
  return retainedCleanupFailure === ""
    ? result
    : { ...result, cleanupFailure: retainedCleanupFailure };
};

/** Replace a bundle through a fresh same-volume root owned by this transaction. */
export const installMacHopperBundle = async (
  source: string,
  destination: string,
  replaceExisting: boolean,
  operations: MacHopperBundleInstallOperations,
  retainCleanup: (
    cleanup: () => Promise<void>,
    resources: readonly string[],
  ) => void,
): Promise<MacHopperBundleInstallResult> => {
  const stagingRoot = await operations.createStagingRoot(
    posix.dirname(destination),
  );
  const stagedBundle = appendCallerPath(stagingRoot, "new.app", "darwin");
  const previousBundle = appendCallerPath(
    stagingRoot,
    "previous.app",
    "darwin",
  );
  let originalBackedUp = false;
  let newCommitted = false;
  let failureReason: "copy" | "launcher_missing" = "copy";

  try {
    await operations.copyBundle(source, stagedBundle);
    failureReason = "launcher_missing";
    await operations.requireLauncher(
      appendCallerPath(stagedBundle, "Contents/MacOS/hopper", "darwin"),
    );
    failureReason = "copy";
    if (replaceExisting) {
      await operations.rename(destination, previousBundle);
      originalBackedUp = true;
    }
    await operations.rename(stagedBundle, destination);
    newCommitted = true;
  } catch (cause: unknown) {
    const diagnostics = [failureMessage(cause)];
    if (originalBackedUp && !newCommitted) {
      try {
        if (await operations.pathExists(destination))
          throw new Error(
            "destination now contains another installation; preserving the previous bundle in its owned staging root",
          );
        await operations.rename(previousBundle, destination);
        originalBackedUp = false;
      } catch (rollbackCause: unknown) {
        diagnostics.push(`rollback failed: ${failureMessage(rollbackCause)}`);
        const cleanupFailure = `The previous Hopper bundle remains owned at ${previousBundle}; cleanup will retry restoration only if the destination is empty.`;
        retainCleanup(async () => {
          if (originalBackedUp) {
            if (await operations.pathExists(destination))
              throw new Error(
                `Hopper destination is occupied; preserving owned backup ${previousBundle}`,
              );
            await operations.rename(previousBundle, destination);
            originalBackedUp = false;
          }
          await operations.removeStagingRoot(stagingRoot);
        }, [stagingRoot]);
        return {
          status: "failed",
          reason: failureReason,
          diagnostic: diagnostics.join("; "),
          cleanupFailure,
        };
      }
    }
    try {
      await operations.removeStagingRoot(stagingRoot);
    } catch (cleanupCause: unknown) {
      const cleanupFailure = `Hopper staging root cleanup failed: ${failureMessage(cleanupCause)}`;
      retainCleanup(
        () => operations.removeStagingRoot(stagingRoot),
        [stagingRoot],
      );
      diagnostics.push(cleanupFailure);
      return {
        status: "failed",
        reason: failureReason,
        diagnostic: diagnostics.join("; "),
        cleanupFailure,
      };
    }
    return {
      status: "failed",
      reason: failureReason,
      diagnostic: diagnostics.join("; "),
    };
  }

  try {
    await operations.removeStagingRoot(stagingRoot);
    return { status: "installed" };
  } catch (cause: unknown) {
    const cleanupFailure = `Hopper staging root cleanup failed after installation committed: ${failureMessage(cause)}`;
    retainCleanup(
      () => operations.removeStagingRoot(stagingRoot),
      [stagingRoot],
    );
    return { status: "installed", cleanupFailure };
  }
};

/** Compose installer paths and subprocesses from one selected caller context. */
export const systemMacHopperInstallHost = (
  homeDirectory: string,
  environment: Readonly<NodeJS.ProcessEnv>,
): MacHopperInstallHost & {
  close(): Promise<AnalysisCleanupObservation | undefined>;
} => {
  const pendingCleanup = new Map<() => Promise<void>, readonly string[]>();
  return {
    download: downloadHopperPackage,
    createTemporaryDirectory: () => mkdtemp(join(tmpdir(), "rea-hopper-mac-")),
    createMountDirectory: (path) => mkdir(path),
    writePackage: (path, bytes) => writeFile(path, bytes, { mode: 0o600 }),
    async mount(packagePath, mountPath) {
      await execFileAsync(
        "hdiutil",
        [
          "attach",
          "-readonly",
          "-nobrowse",
          "-mountpoint",
          mountPath,
          packagePath,
        ],
        { env: environment },
      );
      return true;
    },
    async unmount(mountPath) {
      await execFileAsync("hdiutil", ["detach", mountPath, "-force"], {
        env: environment,
      });
    },
    async appBundle(mountPath) {
      const entries = await readdir(mountPath, { withFileTypes: true });
      const app = entries.find(
        (entry) => entry.isDirectory() && /^Hopper.*\.app$/iu.test(entry.name),
      );
      return app === undefined ? undefined : posix.join(mountPath, app.name);
    },
    async validBundle(appPath) {
      if (
        !(await commandSucceeds(
          "codesign",
          ["--verify", "--deep", "--strict", appPath],
          environment,
        ))
      )
        return "invalid_signature";
      if (
        !(await commandSucceeds(
          "codesign",
          [
            "--verify",
            "--strict",
            `-R${HOPPER_PUBLISHER_REQUIREMENT}`,
            appPath,
          ],
          environment,
        ))
      )
        return "unverified_publisher";
      return "verified";
    },
    async destinationExists(path) {
      try {
        await access(path);
        return true;
      } catch (cause: unknown) {
        if (isMissingPath(cause)) return false;
        throw cause;
      }
    },
    installBundle: (source, destination, replaceExisting) =>
      installMacHopperBundle(
        source,
        destination,
        replaceExisting,
        {
          async createStagingRoot(parent) {
            await mkdir(parent, { recursive: true });
            return mkdtemp(
              appendCallerPath(parent, ".rea-hopper-stage-", "darwin"),
            );
          },
          copyBundle: async (bundle, staged) => {
            await execFileAsync("ditto", [bundle, staged], {
              env: environment,
            });
          },
          requireLauncher: (path) => access(path).then(() => undefined),
          pathExists,
          rename,
          removeStagingRoot: (path) => rm(path, { recursive: true }),
        },
        (cleanup, resources) => pendingCleanup.set(cleanup, resources),
      ),
    async openApplication(path) {
      await execFileAsync("open", [path], { env: environment });
    },
    cleanup: (path) => rm(path, { recursive: true, force: true }),
    retainCleanup: (cleanup, resources) =>
      pendingCleanup.set(cleanup, resources),
    async close() {
      const failures: string[] = [];
      for (const cleanup of pendingCleanup.keys()) {
        try {
          await cleanup();
          pendingCleanup.delete(cleanup);
        } catch (cause: unknown) {
          failures.push(failureMessage(cause));
        }
      }
      return failures.length === 0
        ? undefined
        : {
            reason: `Hopper installer cleanup remains incomplete: ${failures.join("; ")}`,
            resources: [...new Set([...pendingCleanup.values()].flat())],
          };
    },
    destination: () => macHopperUserApplicationPath(homeDirectory),
  };
};

const commandSucceeds = async (
  command: string,
  args: readonly string[],
  environment: Readonly<NodeJS.ProcessEnv>,
): Promise<boolean> => {
  try {
    await execFileAsync(command, args, { env: environment });
    return true;
  } catch (cause: unknown) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      typeof cause.code === "number"
    )
      return false;
    throw cause;
  }
};
const failureMessage = (cause: unknown): string =>
  cause instanceof Error
    ? [
        cause.message,
        "stderr" in cause && typeof cause.stderr === "string"
          ? cause.stderr.trim()
          : "",
      ]
        .filter((value) => value !== "")
        .join(": ")
    : String(cause);
const isMissingPath = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  cause.code === "ENOENT";
const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch (cause: unknown) {
    if (isMissingPath(cause)) return false;
    throw cause;
  }
};

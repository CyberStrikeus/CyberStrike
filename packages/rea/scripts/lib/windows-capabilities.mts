import { constants } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  windowsNativeCapabilities,
  type WindowsNativeCapabilitySet,
} from "../../src/process/WindowsAuthority.js";
import {
  probeProcessCaptureCapability,
  type ProcessCaptureCapability,
} from "../../src/process/capture/ProcessCaptureCapability.js";

/** One named Windows host observation without inferred authority. */
export type WindowsCapabilityOutcome =
  | { readonly available: true; readonly reason: null }
  | { readonly available: false; readonly reason: string };

/** Injectable host probes used by CI and deterministic unit tests. */
export interface WindowsCapabilityDependencies {
  readonly platform: NodeJS.Platform;
  readonly architecture: NodeJS.Architecture;
  probeSymlinkCreation(): Promise<WindowsCapabilityOutcome>;
  probeNoFollowOpen(): WindowsCapabilityOutcome;
  probePrivateAcl(): WindowsCapabilityOutcome;
  probeUnixDomainSocket(): WindowsCapabilityOutcome;
  probePty(): Promise<ProcessCaptureCapability>;
  nativeCapabilities?(): WindowsNativeCapabilitySet;
}

/** Machine-readable facts for features that need Windows-specific security. */
export interface WindowsCapabilityReport {
  readonly platform: NodeJS.Platform;
  readonly architecture: NodeJS.Architecture;
  readonly capabilities: Readonly<{
    symlink_creation: WindowsCapabilityOutcome;
    no_follow_open: WindowsCapabilityOutcome;
    private_acl: WindowsCapabilityOutcome;
    unix_domain_socket: WindowsCapabilityOutcome;
    pty: WindowsCapabilityOutcome;
  }>;
  /** Security controls that are unavailable until native authority exists. */
  readonly security: WindowsNativeCapabilitySet;
}

/** Probe named prerequisites without converting missing controls into support. */
export const probeWindowsCapabilities = async (
  dependencies: WindowsCapabilityDependencies = systemDependencies(),
): Promise<WindowsCapabilityReport> => {
  const [symlinkCreation, pty] = await Promise.all([
    dependencies.probeSymlinkCreation(),
    dependencies.probePty(),
  ]);
  return {
    platform: dependencies.platform,
    architecture: dependencies.architecture,
    capabilities: {
      symlink_creation: symlinkCreation,
      no_follow_open: dependencies.probeNoFollowOpen(),
      private_acl: dependencies.probePrivateAcl(),
      unix_domain_socket: dependencies.probeUnixDomainSocket(),
      pty: pty.available
        ? { available: true, reason: null }
        : { available: false, reason: pty.reason },
    },
    security:
      dependencies.nativeCapabilities?.() ??
      windowsNativeCapabilities(dependencies.platform),
  };
};

const systemDependencies = (): WindowsCapabilityDependencies => {
  const security = windowsNativeCapabilities(process.platform);
  return {
    platform: process.platform,
    architecture: process.arch,
    probeSymlinkCreation,
    probeNoFollowOpen: () =>
      systemNoFollowOpenCapability(process.platform, constants.O_NOFOLLOW),
    probePrivateAcl: () => security.private_runtime_dacl,
    nativeCapabilities: () => security,
    probeUnixDomainSocket: () =>
      process.platform === "win32"
        ? {
            available: false,
            reason: "Node path-based IPC uses named pipes on Windows",
          }
        : { available: true, reason: null },
    probePty: probeProcessCaptureCapability,
  };
};

/** Report pathname no-follow support without treating it as Windows authority. */
export const systemNoFollowOpenCapability = (
  platform: NodeJS.Platform,
  noFollow: number | undefined,
): WindowsCapabilityOutcome => {
  if (platform === "win32")
    return {
      available: false,
      reason:
        "Node pathname O_NOFOLLOW is not Windows handle authority; native admission is reported separately in security.",
    };
  return typeof noFollow === "number"
    ? { available: true, reason: null }
    : {
        available: false,
        reason: "O_NOFOLLOW is unavailable in this Node runtime",
      };
};

const probeSymlinkCreation = async (): Promise<WindowsCapabilityOutcome> => {
  const root = await mkdtemp(join(tmpdir(), "rea-symlink-probe-"));
  const target = join(root, "target");
  const link = join(root, "link");
  try {
    await writeFile(target, "probe");
    await symlink(target, link, "file");
    return { available: true, reason: null };
  } catch (cause: unknown) {
    return {
      available: false,
      reason:
        cause instanceof Error &&
        "code" in cause &&
        typeof cause.code === "string"
          ? cause.code
          : "symlink creation failed",
    };
  } finally {
    try {
      await rm(root, { recursive: true, force: true });
    } catch (cause: unknown) {
      // Cleanup failure must not replace the machine-readable probe outcome.
      // The probe root lives beneath the OS temporary directory and is unique.
      void cause;
    }
  }
};

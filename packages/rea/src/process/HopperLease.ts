import { realpath } from "node:fs/promises";
import { join } from "node:path";

import {
  ArtifactFileCleanupFailure,
  bindArtifactFileCleanup,
} from "../artifacts/ArtifactFileOperation.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { HopperStartError } from "../domain/hopperErrors.js";
import {
  acquireOwnedLease,
  OwnedLeaseCleanupFailure,
  type LeaseAcquisition,
  type LeaseFailure,
} from "./OwnedLease.js";

/** Shared private parent of Hopper lease sockets; it outlives individual sessions. */
export const HOPPER_TARGET_LEASE_DIRECTORY = join(
  "/tmp",
  `rea-hopper-${process.getuid?.() ?? 0}`,
);

/** Keep two REA processes from opening duplicate Hopper documents for one target/profile. */
export const acquireHopperTargetLease = async (input: {
  readonly targetPath: string;
  readonly targetKind: "executable" | "database";
  readonly loaderArgs: readonly string[];
  readonly runId: string;
  readonly directory?: string;
  readonly resources?: ArtifactResourceScope | undefined;
}): Promise<LeaseAcquisition> => {
  // Canonicalization is required for lease identity. A lexical fallback could
  // let two aliases reserve independent sockets for the same Hopper document.
  let targetPath: string;
  try {
    targetPath = await realpath(input.targetPath);
  } catch (cause: unknown) {
    throw new HopperStartError({
      cause,
      userMessage: `REA could not resolve Hopper target ${JSON.stringify(input.targetPath)} to a canonical path before reserving the document. Confirm that the target exists and its path is accessible.`,
    });
  }
  return acquireLease({
    ...input,
    identity: {
      targetPath,
      targetKind: input.targetKind,
      loaderArgs: input.loaderArgs,
    },
  });
};

/** Reserve the Linux demo's singleton application before it can forward a target to another owner. */
export const acquireLinuxHopperApplicationLease = (input: {
  readonly runId: string;
  readonly directory?: string;
  readonly resources?: ArtifactResourceScope | undefined;
}): Promise<LeaseAcquisition> =>
  acquireLease({ ...input, identity: { application: "linux-hopper-demo" } });

/** Serialize approved publication/repair of one canonical signed-package entry. */
export const acquireHopperReleaseCacheLease = async (input: {
  readonly cacheDirectory: string;
  readonly launcherSha256: string;
  readonly runId: string;
  readonly resources?: ArtifactResourceScope | undefined;
}): Promise<LeaseAcquisition> =>
  acquireLease({
    runId: input.runId,
    resources: input.resources,
    identity: {
      cacheDirectory: await realpath(input.cacheDirectory),
      launcherSha256: input.launcherSha256,
      operation: "signed-package-retention",
    },
  });

const acquireLease = async (input: {
  readonly identity: Readonly<Record<string, unknown>>;
  readonly runId: string;
  readonly directory?: string;
  readonly resources?: ArtifactResourceScope | undefined;
}): Promise<LeaseAcquisition> =>
  acquireOwnedLease({
    identity: input.identity,
    runId: input.runId,
    directory: input.directory ?? HOPPER_TARGET_LEASE_DIRECTORY,
    failure: hopperLeaseFailure,
    resources: input.resources,
  });

const hopperLeaseFailure = (
  failure: LeaseFailure,
  cause?: unknown,
): HopperStartError => {
  const primary =
    cause instanceof OwnedLeaseCleanupFailure
      ? cause.primary
      : cause instanceof ArtifactFileCleanupFailure &&
          cause.fileCleanupFailure.outcome.kind === "failed"
        ? cause.fileCleanupFailure.outcome.cause
        : undefined;
  const error = new HopperStartError({
    ...(cause === undefined ? {} : { cause }),
    ...(primary instanceof HopperStartError ? { cleanupPrimary: primary } : {}),
    ...(cause instanceof ArtifactFileCleanupFailure ||
    cause instanceof OwnedLeaseCleanupFailure
      ? { cleanup: cause.cleanup }
      : {}),
    userMessage:
      primary instanceof HopperStartError
        ? (primary.userMessage ?? hopperLeaseMessage(failure))
        : hopperLeaseMessage(failure),
  });
  bindArtifactFileCleanup(cause, error);
  return error;
};

const hopperLeaseMessage = (failure: LeaseFailure): string => {
  switch (failure.kind) {
    case "directory_create":
      return "REA could not create its private Hopper lease directory.";
    case "directory_not_private":
      return "REA's Hopper lease directory is not a private directory owned by this user.";
    case "directory_permissions":
      return "REA's Hopper lease directory permissions could not be secured.";
    case "directory_access_denied":
      return `REA could not access its Hopper lease directory at ${JSON.stringify(failure.directory)}. Check its ownership and parent-directory access. For a directory you own, restore owner-only read, write, and search permissions (0700), then retry.`;
    case "socket_permissions":
      return "REA could not secure its lease socket permissions.";
    case "directory_close":
      return "REA could not confirm closure of its Hopper lease directory handle.";
    case "directory_inspect":
      return "REA could not inspect its private Hopper lease directory.";
    case "recovery_busy":
      return `REA could not reserve Hopper lease recovery at ${JSON.stringify(failure.path)}; the existing socket was left unchanged. Retry after concurrent startup finishes. If recovery was interrupted, stop REA sessions and remove this recovery directory before retrying.`;
    case "recovery_create":
      return `REA could not create its Hopper recovery directory at ${JSON.stringify(failure.path)}; the existing socket was left unchanged. Check the parent directory's write access before retrying.`;
    case "recovery_remove":
      return `REA could not remove its Hopper recovery directory at ${JSON.stringify(failure.path)}. Check this directory's write access before retrying.`;
    case "owner_unverified":
      return `REA could not verify the existing Hopper lease (${failure.reason}); it was left unchanged. Retry when the owning REA session is responsive.`;
    case "unrecoverable":
      return "REA could not reserve Hopper for this request. Close competing REA sessions and retry.";
  }
};

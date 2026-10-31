import { constants, type Stats } from "node:fs";
import { link, lstat, mkdtemp, open, realpath, rename } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { fileHandleMatchesBytes } from "../filesystem/fileHandleMatchesBytes.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import { OwnedStagedOutput } from "../filesystem/OwnedStagedOutput.js";
import {
  RegularFileChangedError,
  sameRegularFileState,
} from "../filesystem/RegularFile.js";
import type { RegularFileOperationOutcome } from "../filesystem/OwnedRegularFile.js";
import { readRegularFileTextSnapshot } from "./RegularFileRead.js";
import { ClientConfigurationPublicationFailure } from "./ClientConfigurationCleanup.js";
import { resolveClientConfigTransactionPath } from "./ClientConfigPath.js";
import { ConfigurationError } from "../domain/configurationErrors.js";

/** Facts captured where a configuration write operation failed. */
export interface ClientConfigurationWriteProblem {
  readonly kind: "write";
  readonly operation:
    | "serialize"
    | "publish"
    | "preserve_ownership"
    | "preserve_mode";
  readonly path: string;
  readonly detail: string;
  readonly systemCode?: string;
  readonly syscall?: string;
  readonly requestedOwnership?: { readonly uid: number; readonly gid: number };
}

/** Preserve the operation and original cause before publication cleanup runs. */
export class ClientConfigurationWriteError extends Error {
  readonly _tag = "ClientConfigurationWriteError";
  readonly problem: ClientConfigurationWriteProblem;
  constructor(
    path: string,
    operation: ClientConfigurationWriteProblem["operation"],
    cause: unknown,
    requestedOwnership?: { readonly uid: number; readonly gid: number },
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Configuration ${operation} failed at ${path}: ${detail}`, { cause });
    const code: unknown =
      cause instanceof Error ? Reflect.get(cause, "code") : undefined;
    const syscall: unknown =
      cause instanceof Error ? Reflect.get(cause, "syscall") : undefined;
    this.problem = {
      kind: "write",
      operation,
      path,
      detail,
      ...(typeof code === "string" ? { systemCode: code } : {}),
      ...(typeof syscall === "string" ? { syscall } : {}),
      ...(requestedOwnership === undefined ? {} : { requestedOwnership }),
    };
  }
}

/** The original read owner's selection, before merging and preparing a backup. */
export interface ClientConfigurationSelection {
  readonly requestedPath: string;
  readonly state: Stats | undefined;
}

/** The exact staged file retained through publication, verification and recovery. */
export class ClientConfigurationPublication {
  private constructor(
    readonly path: string,
    private readonly contents: string,
    private readonly owner: OwnedFileHandle,
    private readonly staging: OwnedStagedOutput,
    private readonly cleanup: AnalysisCleanupLease,
  ) {}

  static async write(
    path: string,
    contents: string,
    previous: string | undefined,
    selection?: ClientConfigurationSelection,
  ): Promise<ClientConfigurationPublication> {
    const parent = await realpath(dirname(path));
    // Retain the transaction owner's directory requirement through final-file
    // publication rather than allowing basename/join to select a regular file.
    const destination =
      join(parent, basename(path)) + (path.endsWith(sep) ? sep : "");
    const input = await selectedConfiguration(destination, previous);
    if (selection !== undefined) {
      await assertRequestedConfigurationPath(path, selection.requestedPath);
      if (
        selection.state === undefined
          ? input !== undefined
          : input === undefined || !sameRegularFileState(selection.state, input)
      )
        throw new RegularFileChangedError(destination);
    }
    const directory = await mkdtemp(`${parent}${sep}.rea-config-`);
    const staging = await OwnedStagedOutput.create(directory);
    const cleanup = new AnalysisCleanupLease(
      () => staging.close(),
      [directory],
    );
    try {
      const stagedPath = `${directory}${sep}content`;
      const owner = new OwnedFileHandle(
        await open(
          stagedPath,
          constants.O_RDWR |
            constants.O_CREAT |
            constants.O_EXCL |
            (constants.O_NONBLOCK ?? 0) |
            (constants.O_NOFOLLOW ?? 0),
          0o600,
        ),
      );
      staging.setFile(owner);
      await owner.handle.writeFile(contents, { encoding: "utf8" });
      await preserveConfigurationAttributes(owner, input, destination);
      await owner.handle.sync();
      if ((await owner.handle.stat()).ino === 0)
        throw new RegularFileChangedError(stagedPath);
      await staging.assertReadyForPublication(stagedPath);
      if (selection !== undefined)
        await assertRequestedConfigurationPath(path, selection.requestedPath);
      await assertSelectedConfiguration(destination, input);
      if (input === undefined) {
        // An exclusive link cannot overwrite a file created after absence was checked.
        try {
          await link(stagedPath, destination);
        } catch (cause: unknown) {
          if (
            selection !== undefined &&
            cause instanceof Error &&
            "code" in cause &&
            cause.code === "EEXIST"
          )
            throw new RegularFileChangedError(destination, { cause });
          throw cause;
        }
      } else {
        // The destination is explicit: rename never follows its final symlink.
        await rename(stagedPath, destination);
        staging.recordPublishedRename();
      }
      return new ClientConfigurationPublication(
        destination,
        contents,
        owner,
        staging,
        cleanup,
      );
    } catch (cause: unknown) {
      await releaseStaging(path, staging, cleanup, { kind: "failed", cause });
      throw cause;
    }
  }

  /** Keep all publication resources owned through the complete operation. */
  async verify<Value>(operation: () => Promise<Value>): Promise<Value> {
    let outcome: RegularFileOperationOutcome<Value>;
    try {
      outcome = { kind: "completed", value: await operation() };
    } catch (cause: unknown) {
      outcome = { kind: "failed", cause };
    }
    await releaseStaging(this.path, this.staging, this.cleanup, outcome);
    if (outcome.kind === "failed") throw outcome.cause;
    return outcome.value;
  }

  async assertCurrent(readback: string): Promise<void> {
    const owned = await this.owner.handle.stat();
    const named = await lstat(this.path);
    if (
      owned.ino === 0 ||
      readback !== this.contents ||
      named.isSymbolicLink() ||
      !sameRegularFileState(owned, named)
    )
      throw new RegularFileChangedError(this.path);
  }

  /** State checks do not exclude a concurrent writer to the same inode. */
  async restore(original: string | undefined): Promise<void> {
    const handle = this.owner.handle;
    const before = await handle.stat();
    const named = await lstat(this.path);
    if (
      before.ino === 0 ||
      !before.isFile() ||
      named.isSymbolicLink() ||
      !sameRegularFileState(before, named) ||
      !(await fileHandleMatchesBytes(
        handle,
        Buffer.from(this.contents, "utf8"),
      )) ||
      !sameRegularFileState(before, await handle.stat()) ||
      !sameRegularFileState(before, await lstat(this.path))
    )
      throw new RegularFileChangedError(this.path);
    if (original === undefined)
      throw new Error(
        "First-run configuration recovery requires manual removal; pathname deletion cannot prove ownership",
      );
    const bytes = Buffer.from(original, "utf8");
    for (let position = 0; position < bytes.length;) {
      const { bytesWritten } = await handle.write(
        bytes,
        position,
        bytes.length - position,
        position,
      );
      if (bytesWritten === 0)
        throw new Error("Configuration restoration made no write progress");
      position += bytesWritten;
    }
    await handle.truncate(bytes.length);
    if (!sameRegularFileState(await handle.stat(), await lstat(this.path)))
      throw new RegularFileChangedError(this.path);
  }
}

const preserveConfigurationAttributes = async (
  owner: OwnedFileHandle,
  input: Stats | undefined,
  destination: string,
): Promise<void> => {
  const created = await owner.handle.stat();
  if (
    input !== undefined &&
    (input.uid !== created.uid || input.gid !== created.gid)
  ) {
    try {
      await owner.handle.chown(input.uid, input.gid);
    } catch (cause: unknown) {
      throw new ClientConfigurationWriteError(
        destination,
        "preserve_ownership",
        cause,
        {
          uid: input.uid,
          gid: input.gid,
        },
      );
    }
  }
  try {
    await owner.handle.chmod((input?.mode ?? 0o600) & 0o7777);
  } catch (cause: unknown) {
    throw new ClientConfigurationWriteError(
      destination,
      "preserve_mode",
      cause,
    );
  }
};

const assertRequestedConfigurationPath = async (
  path: string,
  requestedPath: string,
): Promise<void> => {
  const current = await resolveClientConfigTransactionPath(requestedPath);
  if (current === undefined)
    throw new ConfigurationError(
      `Client configuration path could not be safely verified: ${requestedPath}`,
    );
  if (resolve(current) === resolve(path)) return;
  // `path` is the canonical file selected for this transaction. A later
  // retarget of a parent-directory alias keeps that file. A configuration
  // symlink that now names another target, or a path whose parent is already
  // canonical, still conflicts.
  if (await isParentAliasRetarget(requestedPath, path, current)) return;
  throw new RegularFileChangedError(path);
};

const isParentAliasRetarget = async (
  requestedPath: string,
  path: string,
  current: string,
): Promise<boolean> => {
  if (basename(current) !== basename(path)) return false;
  let requestedStats: { isSymbolicLink(): boolean };
  try {
    requestedStats = await lstat(requestedPath);
  } catch (cause: unknown) {
    if (isNodeErrorCode(cause, "ENOENT")) return false;
    throw new ConfigurationError(
      `Client configuration path could not be safely verified: ${requestedPath}`,
    );
  }
  if (requestedStats.isSymbolicLink()) return false;
  const requestedParent = dirname(absoluteCallerPath(requestedPath));
  try {
    const canonicalParent = await realpath(requestedParent);
    return canonicalParent !== requestedParent;
  } catch (cause: unknown) {
    void cause;
    return false;
  }
};

const isNodeErrorCode = (cause: unknown, code: string): boolean =>
  cause instanceof Error && "code" in cause && cause.code === code;

const selectedConfiguration = async (
  path: string,
  previous: string | undefined,
): Promise<Stats | undefined> => {
  let selected:
    | Awaited<ReturnType<typeof readRegularFileTextSnapshot>>
    | undefined;
  try {
    selected = await readRegularFileTextSnapshot(path, { symlinks: "reject" });
  } catch (cause: unknown) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT"))
      throw cause;
  }
  if (selected?.text !== previous || selected?.state.ino === 0)
    throw new RegularFileChangedError(path);
  return selected?.state;
};

const assertSelectedConfiguration = async (
  path: string,
  selected: Stats | undefined,
): Promise<void> => {
  let current: Stats | undefined;
  try {
    current = await lstat(path);
  } catch (cause: unknown) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT"))
      throw cause;
  }
  if (
    selected === undefined
      ? current !== undefined
      : current === undefined ||
        current.isSymbolicLink() ||
        !sameRegularFileState(selected, current)
  )
    throw new RegularFileChangedError(path);
};

const releaseStaging = async <Value>(
  path: string,
  staging: OwnedStagedOutput,
  cleanup: AnalysisCleanupLease,
  outcome: RegularFileOperationOutcome<Value>,
): Promise<void> => {
  try {
    await cleanup.release();
  } catch (cause: unknown) {
    throw new ClientConfigurationPublicationFailure(
      path,
      outcome,
      cause,
      { kind: "staged-output", resource: staging.directory, output: staging },
      cleanup,
    );
  }
};

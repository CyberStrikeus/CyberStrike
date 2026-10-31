import { constants, type Stats } from "node:fs";
import { link, lstat, mkdtemp, open, realpath, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { fileHandleMatchesBytes } from "../filesystem/fileHandleMatchesBytes.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import { OwnedStagedOutput } from "../filesystem/OwnedStagedOutput.js";
import { sameRegularFileState } from "../filesystem/RegularFile.js";

/** The read owner's byte-exact original and selected identity. */
export interface SkillFileSnapshot {
  readonly bytes: Buffer;
  readonly mode: number;
  readonly state: Stats;
}

/** The selected destination no longer has the state admitted for publication. */
export class SkillDestinationChangedError extends Error {
  readonly _tag = "SkillDestinationChangedError";
  constructor(
    readonly path: string,
    cause?: unknown,
  ) {
    super(
      `Skill destination appeared or changed during installation: ${path}`,
      {
        cause,
      },
    );
  }
}

export interface SkillPublicationCleanupOwner {
  readonly path: string;
  readonly kind: "lease";
  readonly resource: string;
  readonly lease: AnalysisCleanupLease;
  close(): Promise<void>;
}

/** Staging cleanup failed before a publication could be returned to its caller. */
export class SkillFilePreparationFailure extends Error {
  readonly _tag = "SkillFilePreparationFailure";
  constructor(
    readonly publication: SkillPublicationCleanupOwner,
    readonly primary: unknown,
    readonly cleanupCause: unknown,
  ) {
    super(
      `Skill staging cleanup failed for ${publication.path}: ${primary instanceof Error ? primary.message : String(primary)}; cleanup: ${cleanupCause instanceof Error ? cleanupCause.message : String(cleanupCause)}`,
      {
        cause: new AggregateError([primary, cleanupCause]),
      },
    );
  }
}

/** One byte-oriented publication, retained before entering a fallible publish. */
export class SkillFilePublication {
  #attempted = false;
  #restored = false;
  #publishedState: Stats | undefined;
  readonly kind = "lease";
  readonly resource: string;
  readonly lease: AnalysisCleanupLease;

  private constructor(
    readonly path: string,
    private readonly bytes: Buffer,
    private readonly original: SkillFileSnapshot | undefined,
    private readonly staging: OwnedStagedOutput,
    private readonly owner: OwnedFileHandle,
    private readonly stagedPath: string,
  ) {
    this.resource = staging.directory;
    this.lease = new AnalysisCleanupLease(
      () => staging.close(),
      [staging.directory],
    );
  }

  static async prepare(
    path: string,
    bytes: Buffer,
    original: SkillFileSnapshot | undefined,
  ): Promise<SkillFilePublication> {
    const parent = await realpath(dirname(path));
    const destination = join(parent, basename(path));
    const directory = await mkdtemp(join(parent, ".rea-skill-"));
    const staging = await OwnedStagedOutput.create(directory);
    let publication: SkillFilePublication | undefined;
    try {
      const stagedPath = join(directory, "content");
      const owner = new OwnedFileHandle(
        await open(
          stagedPath,
          constants.O_RDWR |
            constants.O_CREAT |
            constants.O_EXCL |
            (constants.O_NOFOLLOW ?? 0),
          0o600,
        ),
      );
      staging.setFile(owner);
      publication = new SkillFilePublication(
        destination,
        Buffer.from(bytes),
        original,
        staging,
        owner,
        stagedPath,
      );
      await owner.handle.writeFile(bytes);
      const created = await owner.handle.stat();
      if (
        original !== undefined &&
        (created.uid !== original.state.uid ||
          created.gid !== original.state.gid)
      )
        await owner.handle.chown(original.state.uid, original.state.gid);
      await owner.handle.chmod(original?.mode ?? 0o600);
      await owner.handle.sync();
      await staging.assertReadyForPublication(stagedPath);
      return publication;
    } catch (primary: unknown) {
      try {
        await staging.close();
      } catch (cleanupCause: unknown) {
        // Even an open failure leaves the staging directory owned and retryable.
        if (publication === undefined) {
          const lease = new AnalysisCleanupLease(
            () => staging.close(),
            [directory],
          );
          throw new SkillFilePreparationFailure(
            {
              path: destination,
              kind: "lease",
              resource: directory,
              lease,
              close: () => lease.release(),
            },
            primary,
            cleanupCause,
          );
        }
        throw new SkillFilePreparationFailure(
          publication,
          primary,
          cleanupCause,
        );
      }
      throw primary;
    }
  }

  async publish(): Promise<void> {
    await this.staging.assertReadyForPublication(this.stagedPath);
    await this.#assertSelected();
    this.#attempted = true;
    if (this.original === undefined) {
      // Exclusive creation preserves a file created after the absence check.
      try {
        await link(this.stagedPath, this.path);
      } catch (cause: unknown) {
        if (
          cause instanceof Error &&
          "code" in cause &&
          cause.code === "EEXIST"
        ) {
          // EEXIST proves the exclusive link did not publish our staging file.
          this.#attempted = false;
          throw new SkillDestinationChangedError(this.path, cause);
        }
        throw cause;
      }
    } else {
      await rename(this.stagedPath, this.path);
      this.staging.recordPublishedRename();
    }
    this.#publishedState = await this.owner.handle.stat();
  }

  async assertCurrent(): Promise<void> {
    const before = this.#publishedState;
    if (
      before === undefined ||
      !sameRegularFileState(before, await this.owner.handle.stat())
    )
      throw new SkillDestinationChangedError(this.path);
    await this.#assertNamed(before);
    if (!(await fileHandleMatchesBytes(this.owner.handle, this.bytes)))
      throw new SkillDestinationChangedError(this.path);
    if (!sameRegularFileState(before, await this.owner.handle.stat()))
      throw new SkillDestinationChangedError(this.path);
    await this.#assertNamed(before);
  }

  /** Restore through the owned descriptor; a changed name never grants write authority. */
  async restore(): Promise<void> {
    if (!this.#attempted || this.#restored) return;
    // A rejected exclusive link or rename may leave the original selection intact.
    const named = await optionalState(this.path);
    if (
      this.original !== undefined &&
      named !== undefined &&
      sameRegularFileState(this.original.state, named)
    )
      return;
    if (this.original === undefined && named === undefined) return;
    await this.assertCurrent();
    if (this.original === undefined)
      throw new Error(
        "First-install skill recovery requires manual removal; pathname deletion cannot prove ownership",
      );
    const original = this.original;
    for (let position = 0; position < original.bytes.length;) {
      const { bytesWritten } = await this.owner.handle.write(
        original.bytes,
        position,
        original.bytes.length - position,
        position,
      );
      if (bytesWritten === 0)
        throw new Error("Skill restoration made no write progress");
      position += bytesWritten;
    }
    await this.owner.handle.truncate(original.bytes.length);
    await this.owner.handle.chmod(original.mode);
    await this.owner.handle.sync();
    await this.#assertNamed(await this.owner.handle.stat());
    if (!(await fileHandleMatchesBytes(this.owner.handle, original.bytes)))
      throw new SkillDestinationChangedError(this.path);
    this.#restored = true;
  }

  close(): Promise<void> {
    return this.lease.release();
  }

  async #assertNamed(expected: Stats): Promise<void> {
    const named = await optionalState(this.path);
    if (
      expected.ino === 0 ||
      named === undefined ||
      named.isSymbolicLink() ||
      !sameRegularFileState(expected, named)
    )
      throw new SkillDestinationChangedError(this.path);
  }

  async #assertSelected(): Promise<void> {
    const current = await optionalState(this.path);
    if (
      this.original === undefined
        ? current !== undefined
        : current === undefined ||
          current.isSymbolicLink() ||
          !sameRegularFileState(this.original.state, current)
    )
      throw new SkillDestinationChangedError(this.path);
  }
}

const optionalState = async (path: string): Promise<Stats | undefined> => {
  try {
    return await lstat(path);
  } catch (cause: unknown) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
      return undefined;
    throw cause;
  }
};

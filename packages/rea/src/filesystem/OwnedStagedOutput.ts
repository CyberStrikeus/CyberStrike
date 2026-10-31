import { StagedOutputError } from "./StagedOutputError.js";
import { lstat, readdir, rmdir, unlink } from "node:fs/promises";
import type { Stats } from "node:fs";

import { OwnedFileHandle } from "./OwnedFileHandle.js";

interface Identity {
  readonly dev: number;
  readonly ino: number;
}

const identityOf = (stats: Stats): Identity => ({
  dev: stats.dev,
  ino: stats.ino,
});

const sameIdentity = (stats: Stats, identity: Identity): boolean =>
  stats.dev === identity.dev && stats.ino === identity.ino;

/** One atomically staged file and directory retained through verified cleanup. */
export class OwnedStagedOutput {
  #file: OwnedFileHandle | undefined;
  #fileIdentity: Identity | undefined;
  #fileClosed = false;
  #fileRemovedByOwner = false;
  #publishedRename = false;
  #closeAttempt: Promise<void> | undefined;
  #closed = false;
  #identityFailure: unknown;

  private constructor(
    readonly directory: string,
    private readonly directoryIdentity: Identity | undefined,
  ) {}

  static async create(directory: string): Promise<OwnedStagedOutput> {
    try {
      const stats = await lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink())
        return new OwnedStagedOutput(directory, undefined);
      return new OwnedStagedOutput(directory, identityOf(stats));
    } catch (cause: unknown) {
      // Keep an owner that refuses deletion when creation identity is unknown.
      const owner = new OwnedStagedOutput(directory, undefined);
      owner.#identityFailure = cause;
      return owner;
    }
  }

  setFile(file: OwnedFileHandle): void {
    if (this.#file !== undefined)
      throw new StagedOutputError("handle_already_owned");
    this.#file = file;
  }

  /** Verify the staged name against its descriptor after the last write. */
  async assertReadyForPublication(content: string): Promise<void> {
    await this.#verifiedDirectory();
    if (this.#file !== undefined && !this.#fileClosed)
      await this.#observeFileIdentity();
    if (this.#fileIdentity === undefined)
      throw new StagedOutputError("identity_unverified", undefined, {
        cause: this.#identityFailure,
      });
    const stagedFile = await lstat(content);
    if (
      !stagedFile.isFile() ||
      stagedFile.isSymbolicLink() ||
      !sameIdentity(stagedFile, this.#fileIdentity)
    )
      throw new StagedOutputError("identity_changed", { path: content });
  }

  /** Observe the descriptor's identity after its last write, then close it. */
  async closeFile(): Promise<void> {
    const file = this.#file;
    if (file === undefined || this.#fileClosed) return;
    await this.#observeFileIdentity();
    await file.close();
    this.#fileClosed = true;
  }

  async #observeFileIdentity(): Promise<void> {
    const file = this.#file;
    if (file === undefined) return;
    // FAT and exFAT assign a file ID when the first write allocates storage,
    // so only the descriptor's final identity can prove the staged pathname.
    try {
      this.#fileIdentity = identityOf(await file.handle.stat());
    } catch (cause: unknown) {
      // The handle remains owned; cleanup will close it and refuse pathname removal.
      this.#fileIdentity = undefined;
      this.#identityFailure = cause;
    }
  }

  /** Record that the staged file moved to the published destination by rename. */
  recordPublishedRename(): void {
    this.#publishedRename = true;
  }

  /** Close the owned descriptor and remove only the exact staged entries. */
  close(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (this.#closeAttempt !== undefined) return this.#closeAttempt;
    const attempt = Promise.resolve().then(() => this.#cleanup());
    this.#closeAttempt = attempt;
    void attempt.then(
      () => {
        this.#closed = true;
        this.#closeAttempt = undefined;
      },
      () => {
        this.#closeAttempt = undefined;
      },
    );
    return attempt;
  }

  async #cleanup(): Promise<void> {
    await this.closeFile();
    await this.#verifiedDirectory();

    // No descriptor was acquired when creating /content failed. Enumerate
    // the owned directory instead of probing a possibly overlong child path.
    if (this.#file !== undefined) {
      const content = `${this.directory}/content`;
      let stagedFile: Stats | undefined;
      try {
        stagedFile = await lstat(content);
      } catch (cause: unknown) {
        if (
          errorCode(cause) === "ENOENT" &&
          (this.#fileRemovedByOwner || this.#publishedRename)
        ) {
          stagedFile = undefined;
        } else if (errorCode(cause) === "ENOENT") {
          throw new StagedOutputError(
            "file_disappeared",
            { path: content },
            { cause },
          );
        } else {
          throw cause;
        }
      }
      if (stagedFile !== undefined) {
        if (
          !stagedFile.isFile() ||
          stagedFile.isSymbolicLink() ||
          this.#fileIdentity === undefined ||
          !sameIdentity(stagedFile, this.#fileIdentity)
        )
          throw new StagedOutputError("identity_changed", { path: content });
        await unlink(content);
        this.#fileRemovedByOwner = true;
      }
    }

    const remaining = await readdir(this.directory);
    if (remaining.length > 0)
      throw new StagedOutputError("unexpected_entries", {
        count: remaining.length,
        entries: remaining.join(","),
      });
    await this.#verifiedDirectory();
    await rmdir(this.directory);
  }

  async #verifiedDirectory(): Promise<void> {
    if (this.directoryIdentity === undefined)
      throw new StagedOutputError(
        "directory_unverified",
        { directory: this.directory },
        { cause: this.#identityFailure },
      );
    const directory = await lstat(this.directory);
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      !sameIdentity(directory, this.directoryIdentity)
    )
      throw new StagedOutputError("directory_identity_changed", {
        directory: this.directory,
      });
  }
}

const errorCode = (cause: unknown): unknown =>
  typeof cause === "object" && cause !== null && "code" in cause
    ? cause.code
    : undefined;

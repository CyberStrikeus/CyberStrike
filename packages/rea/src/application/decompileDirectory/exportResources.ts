import {
  link,
  lstat,
  mkdtemp,
  open,
  rename,
  rmdir,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";

import { AnalysisCleanupLease } from "../../artifacts/AnalysisCleanupLease.js";
import { ArtifactFileCleanupFailure } from "../../artifacts/ArtifactFileOperation.js";
import { RegularFileCleanupFailure } from "../../filesystem/OwnedRegularFile.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { DECOMPILE_DIRECTORY_JOURNAL_NAME } from "../../contracts/decompileDirectory.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import { err, ok, type Result } from "../../domain/result.js";
import { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";
import { OwnedStagedOutput } from "../../filesystem/OwnedStagedOutput.js";
import {
  hashStableFile,
  stableFileHashCause,
} from "../../filesystem/StableFileHash.js";
import type { OwnedLease } from "../../process/OwnedLease.js";
import type { RetainedResourceScope } from "../AnalysisProvider.js";

/** Own every descriptor and staging area until cleanup, then release the directory lease. */
export class ExportResources {
  readonly #files = new ArtifactResourceScope();
  readonly #cleanup: AnalysisCleanupLease;
  #removeRoot = false;
  #journalIdentity: FileIdentity | undefined;
  #rootRemoved = false;
  #retained = false;
  #functionsRemoved = false;
  #journalRemoved = false;
  #leaseReleased = false;
  #functionsIdentity: FileIdentity | undefined;

  constructor(
    readonly root: string,
    private readonly identity: FileIdentity,
    private readonly lease: OwnedLease,
    private readonly scope: RetainedResourceScope | undefined,
  ) {
    const resources = this;
    this.#cleanup = AnalysisCleanupLease.forCloseOwner(
      {
        close: async () => {
          await this.#files.retryCleanup();
          if (this.#removeRoot && !this.#rootRemoved)
            await this.#removeCreatedRoot();
          await this.lease.release();
          this.#leaseReleased = true;
        },
        get cleanupResources() {
          return resources.cleanupResources;
        },
      },
      root,
    );
  }

  get cleanupResources(): readonly string[] {
    return [
      ...this.#files.cleanupResources,
      ...(this.#removeRoot && !this.#rootRemoved ? [this.root] : []),
      ...(this.#leaseReleased ? [] : [this.lease.socketPath ?? this.root]),
    ];
  }

  ownFunctionsDirectory(identity: FileIdentity): void {
    this.#functionsIdentity = identity;
  }

  ownFile(handle: FileHandle, path: string, journal = false) {
    const file = new OwnedFileHandle(handle);
    const owner = {
      kind: "lease" as const,
      resource: path,
      lease: {
        release: async () => {
          if (journal && handle.fd >= 0)
            this.#journalIdentity = await handle
              .stat({ bigint: true })
              .catch(() => undefined);
          await file.close();
        },
      },
    };
    this.#files.retain(owner);
    return async (): Promise<boolean> =>
      (await this.#files.release(owner)).kind === "released";
  }

  /** Check existing output with bounded memory and the shared file identity owner. */
  async hashFile(path: string, signal?: AbortSignal): Promise<string> {
    let cleanupLease: AnalysisCleanupLease | undefined;
    try {
      const hash = await hashStableFile(path, {
        ...(signal === undefined ? {} : { signal }),
        retainFailedClose: (handle) => {
          cleanupLease = new AnalysisCleanupLease(() => handle.close(), [path]);
          this.#files.retain({
            kind: "lease",
            resource: path,
            lease: cleanupLease,
          });
        },
      });
      return hash.sha256;
    } catch (cause: unknown) {
      if (
        cause instanceof RegularFileCleanupFailure &&
        cleanupLease !== undefined
      )
        throw new ArtifactFileCleanupFailure(cause, cleanupLease);
      throw stableFileHashCause(cause);
    }
  }

  /** Publish only a verified staged file; failed close or removal stays owned. */
  async publish(
    bytes: string | Buffer,
    destination: string,
    mode: "link" | "rename",
  ): Promise<void> {
    const directory = await mkdtemp(join(this.root, ".decompile-stage-"));
    const staging = await OwnedStagedOutput.create(directory);
    const owner = {
      kind: "staged-output" as const,
      resource: directory,
      output: staging,
    };
    this.#files.retain(owner);
    let outcome:
      | { readonly kind: "completed" }
      | { readonly kind: "failed"; readonly cause: unknown } = {
      kind: "completed",
    };
    try {
      const path = join(directory, "content");
      const handle = await open(path, "wx", 0o600);
      staging.setFile(new OwnedFileHandle(handle));
      await handle.writeFile(bytes);
      await handle.sync();
      await staging.closeFile();
      await staging.assertReadyForPublication(path);
      if (mode === "link") await link(path, destination);
      else {
        await rename(path, destination);
        staging.recordPublishedRename();
      }
    } catch (cause: unknown) {
      outcome = { kind: "failed", cause };
    }
    const released = await this.#files.release(owner);
    if (released.kind === "failed")
      throw this.#files.cleanupFailure(outcome, [released]);
    if (outcome.kind === "failed") throw outcome.cause;
  }

  /** Keep the lease through all initialization cleanup, including any retry. */
  async failedInitialization(
    error: AnalysisError,
  ): Promise<Result<never, AnalysisError>> {
    this.#removeRoot = true;
    const closed = await this.close();
    return closed.ok
      ? err(error)
      : err(
          analysisErrorWithCleanupFailure(
            error,
            closed.error,
            "decompile_all",
          ).bindCleanupDependencies([closed.error]),
        );
  }

  async close(): Promise<Result<void, AnalysisError>> {
    try {
      await this.#cleanup.release();
      return ok(undefined);
    } catch (cause: unknown) {
      const error = new AnalysisOutputError(
        "decompile_all",
        "decompile export cleanup failed",
        {
          cause,
          cleanup: {
            reason: "Owned export resources could not be released.",
            resources: [this.root],
          },
        },
      );
      error.bindCleanupResourceOwner(this.#cleanup);
      this.#cleanup.bindCleanupError(error);
      if (!this.#retained && this.scope !== undefined) {
        this.#retained = true;
        const cleanup = this.#cleanup;
        this.scope.retain(
          {
            close: () => cleanup.release(),
            get cleanupResources() {
              return cleanup.cleanupResources;
            },
          },
          this.root,
        );
      }
      return err(error);
    }
  }

  async #removeCreatedRoot(): Promise<void> {
    const root = await lstat(this.root, { bigint: true });
    if (
      !sameIdentity(root, this.identity) ||
      !root.isDirectory() ||
      root.isSymbolicLink()
    )
      throw new Error("Export directory identity changed during cleanup");
    // Initialization has not exported functions. Refuse unexpected entries rather
    // than recursively deleting work introduced by another owner.
    if (!this.#journalRemoved) {
      const journal = join(this.root, DECOMPILE_DIRECTORY_JOURNAL_NAME);
      const stat = await lstat(journal, { bigint: true }).catch(
        (cause: unknown) => {
          if (isMissing(cause)) return undefined;
          throw cause;
        },
      );
      if (stat !== undefined) {
        if (
          this.#journalIdentity === undefined ||
          !sameIdentity(stat, this.#journalIdentity)
        )
          throw new Error(
            "Cannot establish ownership of the journal during cleanup",
          );
        await unlink(journal);
      }
      this.#journalRemoved = true;
    }
    if (!this.#functionsRemoved) {
      const path = join(this.root, "functions");
      const stat = await lstat(path, { bigint: true }).catch(
        (cause: unknown) => {
          if (isMissing(cause) && this.#functionsIdentity === undefined)
            return undefined;
          throw cause;
        },
      );
      if (stat !== undefined) {
        if (
          this.#functionsIdentity === undefined ||
          !sameIdentity(stat, this.#functionsIdentity)
        )
          throw new Error(
            "Functions directory identity changed during cleanup",
          );
        await rmdir(path);
      }
      this.#functionsRemoved = true;
    }
    await rmdir(this.root);
    this.#rootRemoved = true;
  }
}

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

const sameIdentity = (left: FileIdentity, right: FileIdentity): boolean =>
  left.dev === right.dev && left.ino === right.ino;

const isMissing = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";

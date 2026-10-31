import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appendCallerPath } from "../filesystem/callerPath.js";

import { z } from "zod";
import {
  ArtifactResourceScope,
  type ArtifactResourceOwner,
} from "../artifacts/ArtifactResourceScope.js";
import type { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import {
  ArtifactReaderFailure,
  artifactPrimaryCleanupLeases,
} from "../artifacts/ArtifactReader.js";
import { linuxHopperReleaseCacheDirectory } from "./LinuxHopperCacheDirectory.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  hashStableFile,
  StableFileHashFailure,
} from "../filesystem/StableFileHash.js";
import type { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import {
  RegularFileCleanupFailure,
  RegularFileCancelled,
  regularFileCancellation,
} from "../filesystem/OwnedRegularFile.js";
import { readBoundedFileBytes } from "../process/BoundedFileBytes.js";
import { verifyDetachedPgpSignature } from "../process/DetachedPgpSignature.js";
import { execFileOutput } from "../process/ExecFileOutput.js";
import { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import { waitForAbortableDelay } from "../process/ProviderDeadline.js";
import { acquireHopperReleaseCacheLease } from "../process/HopperLease.js";
import type { OwnedLease } from "../process/OwnedLease.js";
import {
  downloadHopperPackage,
  HOPPER_DOWNLOAD_BYTES,
} from "./HopperDownload.js";
import {
  HOPPER_LINUX_PRIMARY_FINGERPRINT,
  HOPPER_PUBLIC_KEY_URL,
  HOPPER_RELEASES_URL,
  HopperReleaseError,
  hopperArchiveIntegrityMatches,
  parseHopperReleaseJson,
  parseLinuxHopperRelease,
  parseLinuxHopperReleases,
  type LinuxHopperRelease,
  type LinuxPackageFamily,
} from "./HopperReleaseFeed.js";
import { withRegularFile } from "./RegularFileRead.js";

/** Metadata/key inspection budget, independent of the compressed package budget. */
const RELEASE_METADATA_BYTES = 1024 * 1024;
/** Small feed/key requests must not consume the full package-download deadline. */
const RELEASE_METADATA_TIMEOUT_MS = 10_000;
const cacheRecordSchema = z.object({
  format: z.literal("rea-signed-hopper-release-v1"),
  family: z.enum(["deb", "rpm", "arch"]),
  release: z.unknown(),
});

export interface VerifiedLinuxHopperPackage {
  readonly release: LinuxHopperRelease;
  readonly family: LinuxPackageFamily;
  readonly packageSha256: string;
  readonly publicKey: string;
  readonly primaryFingerprint: string;
  readonly signingFingerprint: string;
}

export interface VerifiedLinuxHopperLauncher {
  readonly sha256: string;
  /** Display value from release metadata; the package signature binds bytes, not this row. */
  readonly version: string;
  readonly primaryFingerprint: string;
  readonly signingFingerprint: string;
  readonly source:
    | "signed_package_cache"
    | "signed_vendor_release"
    | "verified_process_cache";
}

/** Retain failed ephemeral cleanup independently of the caller's lifetime. */
const pendingCleanup = new Set<ArtifactResourceScope>();
/** Immutable cryptographic facts, bounded to eight packages for this process lifetime. */
const packageProofs = new Map<
  string,
  Pick<VerifiedLinuxHopperPackage, "primaryFingerprint" | "signingFingerprint">
>();
const liveLauncherProofs = new Map<string, VerifiedLinuxHopperLauncher>();
const retainProof = <T>(cache: Map<string, T>, key: string, proof: T): void => {
  cache.delete(key);
  cache.set(key, proof);
  const oldest = cache.keys().next().value;
  if (cache.size > 8 && oldest !== undefined) cache.delete(oldest);
};

/** Authenticated package facts shared by setup, doctor, and the launch boundary. */
export class LinuxHopperPublisher {
  readonly #resources = new ArtifactResourceScope();
  #feed: ReturnType<typeof parseLinuxHopperReleases> | undefined;

  constructor(
    readonly environment: Readonly<NodeJS.ProcessEnv>,
    readonly packageFamily: () => Promise<LinuxPackageFamily | undefined>,
  ) {}

  get cacheRoot(): string {
    const location = linuxHopperReleaseCacheDirectory(this.environment);
    if (!location.ok) throw location.error;
    return location.value;
  }

  async currentRelease(
    family: LinuxPackageFamily,
    signal?: AbortSignal,
  ): Promise<Result<LinuxHopperRelease, HopperReleaseError>> {
    try {
      signal?.throwIfAborted();
      if (this.#feed === undefined) {
        const response = await downloadHopperPackage(HOPPER_RELEASES_URL, {
          ...(signal === undefined ? {} : { signal }),
          maxBytes: RELEASE_METADATA_BYTES,
          timeoutMs: RELEASE_METADATA_TIMEOUT_MS,
        });
        if (!response.ok)
          throw new HopperReleaseError(
            "release_metadata",
            "The official Hopper release feed is unavailable.",
          );
        const decoded = parseHopperReleaseJson(response.bytes);
        if (!decoded.ok) throw decoded.cause;
        this.#feed = parseLinuxHopperReleases(decoded.value);
      }
      if (!this.#feed.ok) return this.#feed;
      return this.#feed.value[family];
    } catch (cause: unknown) {
      return err(releaseFailure(cause, signal, "release_metadata"));
    }
  }

  async verifyArchive(
    family: LinuxPackageFamily,
    release: LinuxHopperRelease,
    archive: string,
    signal?: AbortSignal,
    suppliedPublicKey?: string,
  ): Promise<Result<VerifiedLinuxHopperPackage, HopperReleaseError>> {
    return this.#runOperation(signal, (resources) =>
      this.#verifyArchive(
        family,
        release,
        archive,
        signal,
        suppliedPublicKey,
        resources,
      ),
    );
  }

  async #verifyArchive(
    family: LinuxPackageFamily,
    release: LinuxHopperRelease,
    archive: string,
    signal: AbortSignal | undefined,
    suppliedPublicKey: string | undefined,
    resources: ArtifactResourceScope,
  ): Promise<Result<VerifiedLinuxHopperPackage, HopperReleaseError>> {
    try {
      const bytes = await this.#read(
        archive,
        HOPPER_DOWNLOAD_BYTES,
        signal,
        resources,
      );
      if (!hopperArchiveIntegrityMatches(bytes, release))
        return err(
          new HopperReleaseError(
            "integrity",
            "The Hopper package does not match the selected release bytes.",
          ),
        );
      let publicKey = suppliedPublicKey;
      if (publicKey === undefined) {
        const response = await downloadHopperPackage(HOPPER_PUBLIC_KEY_URL, {
          ...(signal === undefined ? {} : { signal }),
          maxBytes: RELEASE_METADATA_BYTES,
          timeoutMs: RELEASE_METADATA_TIMEOUT_MS,
        });
        if (!response.ok)
          throw new HopperReleaseError(
            "verification_unavailable",
            "The official Hopper public key is unavailable.",
          );
        publicKey = decodeUtf8(response.bytes);
      }
      const packageSha256 = createHash("sha256").update(bytes).digest("hex");
      // Every read still validates file identity, byte bounds and selected metadata.
      // Reuse only proof of the exact signed bytes/key/signature/payload interpretation.
      const proofKey = createHash("sha256")
        .update(
          JSON.stringify([
            family,
            packageSha256,
            publicKey,
            release.signature,
            release.main_exe_hash,
          ]),
        )
        .digest("hex");
      signal?.throwIfAborted();
      const existingProof = packageProofs.get(proofKey);
      if (existingProof !== undefined)
        return ok({
          release,
          family,
          packageSha256,
          publicKey,
          ...existingProof,
        });
      const verified = await verifyDetachedPgpSignature(
        bytes,
        Buffer.from(release.signature, "base64"),
        publicKey,
        HOPPER_LINUX_PRIMARY_FINGERPRINT,
        signal,
      );
      if (!verified.ok)
        return err(
          new HopperReleaseError(
            verified.error.reason === "cancelled"
              ? "cancelled"
              : "publisher_verification_failed",
            verified.error.message,
            { cause: verified.error },
          ),
        );
      const mainExeHash = await this.#withTemporary(
        async (root, temporaryResources) => {
          // Extract only after authentication, from this operation's private byte snapshot.
          const snapshot = join(root, "package");
          await writeFile(snapshot, bytes, { flag: "wx", mode: 0o600 });
          return this.#packageLauncherHash(
            family,
            snapshot,
            root,
            signal,
            temporaryResources,
          );
        },
      );
      if (mainExeHash !== release.main_exe_hash)
        return err(
          new HopperReleaseError(
            "integrity",
            `The signed ${family} package launcher SHA-256 ${mainExeHash} differs from the release main_exe_hash ${release.main_exe_hash}.`,
          ),
        );
      retainProof(packageProofs, proofKey, verified.value);
      return ok({
        release,
        family,
        packageSha256,
        publicKey,
        ...verified.value,
      });
    } catch (cause: unknown) {
      return err(releaseFailure(cause, signal, "verification_unavailable"));
    }
  }

  /** Durable evidence contains the signed bytes; an editable digest receipt cannot authorize a build. */
  async retainVerifiedArchive(
    verified: VerifiedLinuxHopperPackage,
    archive: string,
    signal?: AbortSignal,
  ): Promise<Result<void, HopperReleaseError>> {
    return this.#runOperation(signal, (resources) =>
      this.#retainVerifiedArchive(verified, archive, signal, resources),
    );
  }

  async #retainVerifiedArchive(
    verified: VerifiedLinuxHopperPackage,
    archive: string,
    signal: AbortSignal | undefined,
    resources: ArtifactResourceScope,
  ): Promise<Result<void, HopperReleaseError>> {
    try {
      signal?.throwIfAborted();
      await mkdir(this.cacheRoot, { recursive: true, mode: 0o700 });
      const parent = await lstat(this.cacheRoot);
      if (
        !parent.isDirectory() ||
        parent.isSymbolicLink() ||
        parent.uid !== process.getuid?.()
      )
        throw new HopperReleaseError(
          "verification_unavailable",
          "The Hopper release cache is not a caller-owned directory.",
        );
      const target = appendCallerPath(
        this.cacheRoot,
        verified.release.main_exe_hash,
      );
      const lease = await this.#acquireCacheLease(
        verified.release.main_exe_hash,
        resources,
        signal,
      );
      await this.#withOwnedResource(
        {
          kind: "lease",
          resource: lease.socketPath ?? "hopper-release-cache-lease",
          lease,
        },
        async () => {
          signal?.throwIfAborted();
          await this.#withTemporary(async (stage, temporaryResources) => {
            await copyFile(archive, join(stage, "archive"));
            if (
              (
                await this.#hashFileWithResources(
                  join(stage, "archive"),
                  signal,
                  temporaryResources,
                )
              ).sha256 !== verified.packageSha256
            )
              throw new HopperReleaseError(
                "integrity",
                "The verified package changed before cache retention.",
              );
            await writeFile(join(stage, "public-key.asc"), verified.publicKey, {
              flag: "wx",
              mode: 0o600,
            });
            await writeFile(
              join(stage, "release.json"),
              JSON.stringify({
                format: "rea-signed-hopper-release-v1",
                family: verified.family,
                release: verified.release,
              }) + "\n",
              { flag: "wx", mode: 0o600 },
            );
            await this.#publishCacheStage(
              stage,
              target,
              verified.release.main_exe_hash,
              signal,
              resources,
            );
          }, this.cacheRoot);
        },
      );
      return ok(undefined);
    } catch (cause: unknown) {
      return err(releaseFailure(cause, signal, "verification_unavailable"));
    }
  }

  async #publishCacheStage(
    stage: string,
    target: string,
    digest: string,
    signal: AbortSignal | undefined,
    resources: ArtifactResourceScope,
  ): Promise<void> {
    const existing = await this.#cachedPackage(digest, signal, resources);
    if (existing.ok) return;
    if (existing.error.reason === "cache_missing") {
      await rename(stage, target);
      return;
    }
    if (
      ![
        "integrity",
        "release_metadata",
        "publisher_verification_failed",
      ].includes(existing.error.reason)
    )
      throw existing.error;
    signal?.throwIfAborted();
    const previous = await lstat(target);
    if (
      !previous.isDirectory() ||
      previous.isSymbolicLink() ||
      previous.uid !== process.getuid?.()
    )
      throw existing.error;
    // Only approved retention under the publication lease may repair an entry.
    // Preserve malformed evidence without following links or deleting content.
    const backup = `${target}.backup-${randomUUID()}`;
    await rename(target, backup);
    try {
      const moved = await lstat(backup);
      if (moved.dev !== previous.dev || moved.ino !== previous.ino)
        throw new Error("The Hopper cache entry changed during repair.");
      await rename(stage, target);
    } catch (cause: unknown) {
      const replacement = await this.#cachedPackage(digest, signal, resources);
      if (replacement.ok) return;
      await this.#failedCachePublication(
        target,
        backup,
        [cause, replacement.error],
        replacement.error.reason === "cleanup_failed",
      );
    }
  }

  async #acquireCacheLease(
    digest: string,
    resources: ArtifactResourceScope,
    signal?: AbortSignal,
  ): Promise<OwnedLease> {
    const deadline = performance.now() + 120_000;
    const runId = randomUUID();
    let delay = 25;
    while (true) {
      signal?.throwIfAborted();
      const acquired = await acquireHopperReleaseCacheLease({
        cacheDirectory: this.cacheRoot,
        launcherSha256: digest,
        runId,
        resources,
      });
      if (acquired.acquired) return acquired.lease;
      const remaining = deadline - performance.now();
      if (remaining <= 0)
        throw new HopperReleaseError(
          "verification_unavailable",
          "Another approved Hopper setup still owns this release cache. Retry after it finishes.",
        );
      await waitForAbortableDelay(Math.min(delay, remaining), signal);
      delay = Math.min(delay * 2, 200);
    }
  }

  async #failedCachePublication(
    target: string,
    backup: string,
    causes: unknown[],
    cleanupFailed = false,
  ): Promise<never> {
    let preserved = backup;
    try {
      // Under the publication lease, restore the previous directory on failure.
      // POSIX rename cannot replace another nonempty evidence directory.
      await rename(backup, target);
      preserved = target;
    } catch (cause: unknown) {
      causes.push(cause);
    }
    throw new HopperReleaseError(
      cleanupFailed ? "cleanup_failed" : "verification_unavailable",
      `The Hopper cache repair did not finish; previous evidence is preserved at ${preserved}. Retry approved setup.`,
      {
        cause: new AggregateError(
          causes,
          "Hopper cache publication and recovery outcomes",
        ),
      },
    );
  }

  async inspectLauncher(
    path: string,
    signal?: AbortSignal,
  ): Promise<Result<VerifiedLinuxHopperLauncher, HopperReleaseError>> {
    return this.#runOperation(signal, (resources) =>
      this.#inspectLauncher(path, signal, resources),
    );
  }

  async #inspectLauncher(
    path: string,
    signal: AbortSignal | undefined,
    resources: ArtifactResourceScope,
  ): Promise<Result<VerifiedLinuxHopperLauncher, HopperReleaseError>> {
    try {
      const observed = await this.#hashFileWithResources(
        path,
        signal,
        resources,
      );
      const cached = await this.#cachedPackage(
        observed.sha256,
        signal,
        resources,
      );
      if (cached.ok) {
        if (
          (await this.#hashFileWithResources(path, signal, resources))
            .sha256 !== observed.sha256
        )
          return err(
            new HopperReleaseError(
              "integrity",
              "The Hopper launcher changed during publisher verification.",
            ),
          );
        return ok(launcherIdentity(cached.value, "signed_package_cache"));
      }
      if (cached.error.reason !== "cache_missing") return cached;
      signal?.throwIfAborted();
      const processProof = liveLauncherProofs.get(observed.sha256);
      if (processProof !== undefined)
        return ok({ ...processProof, source: "verified_process_cache" });
      const family = await this.packageFamily();
      if (family === undefined)
        return err(
          new HopperReleaseError(
            "verification_unavailable",
            "No native Linux package family is available for Hopper publisher verification.",
          ),
        );
      const selected = await this.currentRelease(family, signal);
      if (!selected.ok) return selected;
      if (selected.value.main_exe_hash !== observed.sha256)
        return err(
          new HopperReleaseError(
            "unsupported_hopper_build",
            "The selected Hopper launcher does not match an authenticated cached release or the official current Linux demo.",
          ),
        );
      const verified = await this.#withTemporary(
        async (root, temporaryResources) => {
          const response = await downloadHopperPackage(
            selected.value.filename,
            signal === undefined ? {} : { signal },
          );
          if (!response.ok)
            throw new HopperReleaseError(
              "download",
              "The official Hopper package is unavailable for publisher verification.",
            );
          const archive = join(root, "archive");
          await writeFile(archive, response.bytes, { flag: "wx", mode: 0o600 });
          const verified = await this.#verifyArchive(
            family,
            selected.value,
            archive,
            signal,
            undefined,
            temporaryResources,
          );
          if (!verified.ok) throw verified.error;
          return verified.value;
        },
      );
      if (
        (await this.#hashFileWithResources(path, signal, resources)).sha256 !==
        observed.sha256
      )
        return err(
          new HopperReleaseError(
            "integrity",
            "The Hopper launcher changed during publisher verification.",
          ),
        );
      const identity = launcherIdentity(verified, "signed_vendor_release");
      retainProof(liveLauncherProofs, observed.sha256, identity);
      return ok(identity);
    } catch (cause: unknown) {
      return err(releaseFailure(cause, signal, "verification_unavailable"));
    }
  }

  async close(): Promise<void> {
    try {
      await this.#resources.close();
      pendingCleanup.delete(this.#resources);
    } catch (cause: unknown) {
      pendingCleanup.add(this.#resources);
      throw cause;
    }
  }

  /** Admit once at the publisher boundary; file reads use this operation's child scope. */
  async #runOperation<T>(
    signal: AbortSignal | undefined,
    operation: (
      resources: ArtifactResourceScope,
    ) => Promise<Result<T, HopperReleaseError>>,
  ): Promise<Result<T, HopperReleaseError>> {
    try {
      return await this.#resources.run(async () => {
        const resources = new ArtifactResourceScope();
        let result: Result<T, HopperReleaseError>;
        try {
          result = await operation(resources);
        } catch (cause: unknown) {
          result = err(
            releaseFailure(cause, signal, "verification_unavailable"),
          );
        }

        const cleanup = await resources.close().then(
          () => ({ ok: true as const }),
          (cause: unknown) => ({ ok: false as const, cause }),
        );
        if (!cleanup.ok) {
          const owner: ArtifactResourceOwner = {
            kind: "lease",
            resource: "hopper-publisher-operation-resources",
            lease: { release: () => resources.close() },
          };
          this.#resources.retain(owner);
          pendingCleanup.add(this.#resources);
          throw new HopperReleaseError(
            "cleanup_failed",
            "Hopper publisher retained operation resource cleanup.",
            {
              cause: new AggregateError(
                result.ok ? [cleanup.cause] : [result.error, cleanup.cause],
                "Publisher operation and resource cleanup outcomes",
              ),
            },
          );
        }
        return result;
      });
    } catch (cause: unknown) {
      return err(releaseFailure(cause, signal, "verification_unavailable"));
    }
  }

  /** Hash an installed launcher under this publisher's cleanup lifetime. */
  async hashLauncher(path: string): Promise<string> {
    const result = await this.#runOperation(undefined, async (resources) =>
      ok(
        (await this.#hashFileWithResources(path, undefined, resources)).sha256,
      ),
    );
    if (!result.ok) throw result.error;
    return result.value;
  }

  async #hashFileWithResources(
    path: string,
    signal: AbortSignal | undefined,
    resources: ArtifactResourceScope,
  ): Promise<Awaited<ReturnType<typeof hashStableFile>>> {
    let retainedOwner: ArtifactResourceOwner | undefined;
    try {
      return await hashStableFile(path, {
        ...(signal === undefined ? {} : { signal }),
        retainFailedClose: (handle: OwnedFileHandle) => {
          retainedOwner = {
            kind: "file-handle",
            resource: path,
            handle,
          };
          resources.retain(retainedOwner);
          if (resources === this.#resources) pendingCleanup.add(resources);
        },
      });
    } catch (cause: unknown) {
      if (!(cause instanceof RegularFileCleanupFailure)) throw cause;
      const hashFailure = cause as RegularFileCleanupFailure<
        Awaited<ReturnType<typeof hashStableFile>>
      >;
      const owner =
        retainedOwner ??
        ({
          kind: "file-handle",
          resource: path,
          handle: hashFailure.owner,
        } satisfies ArtifactResourceOwner);
      const released = await resources.release(owner);
      if (released.kind === "failed") {
        if (resources === this.#resources) pendingCleanup.add(resources);
        throw new HopperReleaseError(
          "cleanup_failed",
          `Hopper publisher retained file descriptor cleanup for ${path}.`,
          {
            cause: new AggregateError(
              [cause, released.cause],
              "Stable file hash and descriptor cleanup failed",
              { cause },
            ),
          },
        );
      }
      if (hashFailure.outcome.kind === "failed") {
        if (regularFileCancellation(hashFailure) !== undefined)
          throw hashFailure.outcome.cause;
        throw new StableFileHashFailure(path, hashFailure.outcome.cause);
      }
      const cancellation = regularFileCancellation(hashFailure);
      if (cancellation !== undefined)
        throw new RegularFileCancelled(path, hashFailure.owner, {
          outcome: hashFailure.outcome,
          reason: cancellation.reason,
        });
      return hashFailure.outcome.value;
    }
  }

  async #cachedPackage(
    digest: string,
    signal: AbortSignal | undefined,
    resources: ArtifactResourceScope,
  ): Promise<Result<VerifiedLinuxHopperPackage, HopperReleaseError>> {
    try {
      const root = appendCallerPath(this.cacheRoot, digest);
      try {
        const directory = await lstat(root);
        if (!directory.isDirectory() || directory.isSymbolicLink())
          throw new HopperReleaseError(
            "integrity",
            "The retained Hopper cache entry is not a regular directory.",
          );
      } catch (cause: unknown) {
        if (cause instanceof Error && Reflect.get(cause, "code") === "ENOENT") {
          return err(
            new HopperReleaseError(
              "cache_missing",
              "No retained signed Hopper package identifies this launcher.",
              { cause },
            ),
          );
        }
        throw cause;
      }
      // Distinguish proven malformed/missing evidence from unavailable reads or
      // inspection tools. Only the former authorize approved cache replacement.
      for (const name of ["release.json", "public-key.asc", "archive"])
        await this.#assertCacheFile(appendCallerPath(root, name));
      const metadata = await this.#read(
        appendCallerPath(root, "release.json"),
        RELEASE_METADATA_BYTES,
        signal,
        resources,
      );
      const decoded = parseHopperReleaseJson(metadata);
      if (!decoded.ok)
        throw new HopperReleaseError(
          "release_metadata",
          "The retained Hopper package metadata is malformed.",
          { cause: decoded.cause },
        );
      const parsed = cacheRecordSchema.safeParse(decoded.value);
      if (!parsed.success)
        throw new HopperReleaseError(
          "release_metadata",
          "The retained Hopper package metadata is malformed.",
        );
      const release = parseLinuxHopperRelease(
        parsed.data.release,
        parsed.data.family,
      );
      if (!release.ok) return release;
      if (release.value.main_exe_hash !== digest)
        throw new HopperReleaseError(
          "integrity",
          "The retained Hopper metadata does not identify this launcher.",
        );
      const keyBytes = await this.#read(
        appendCallerPath(root, "public-key.asc"),
        RELEASE_METADATA_BYTES,
        signal,
        resources,
      );
      let key: string;
      try {
        key = decodeUtf8(keyBytes);
      } catch (cause: unknown) {
        throw new HopperReleaseError(
          "publisher_verification_failed",
          "The retained Hopper public key is malformed.",
          { cause },
        );
      }
      return await this.#verifyArchive(
        parsed.data.family,
        release.value,
        appendCallerPath(root, "archive"),
        signal,
        key,
        resources,
      );
    } catch (cause: unknown) {
      return err(releaseFailure(cause, signal, "verification_unavailable"));
    }
  }

  async #assertCacheFile(path: string): Promise<void> {
    try {
      const stats = await lstat(path);
      if (!stats.isFile() || stats.isSymbolicLink())
        throw new HopperReleaseError(
          "integrity",
          `Required Hopper evidence is not a regular file: ${path}.`,
        );
    } catch (cause: unknown) {
      if (cause instanceof Error && Reflect.get(cause, "code") === "ENOENT")
        throw new HopperReleaseError(
          "integrity",
          `Required Hopper evidence is missing: ${path}.`,
          { cause },
        );
      throw cause;
    }
  }

  async #packageLauncherHash(
    family: LinuxPackageFamily,
    archive: string,
    root: string,
    signal: AbortSignal | undefined,
    resources: ArtifactResourceScope,
  ): Promise<string> {
    const commandOptions = {
      env: this.environment,
      signal,
      timeout: 120_000,
      stopSignal: "SIGKILL" as const,
      maxBuffer: RELEASE_METADATA_BYTES,
    };
    if (family === "rpm") {
      const output = await execFileOutput(
        "rpm",
        [
          "-qp",
          "--nosignature",
          "--nodigest",
          "--qf",
          "%{FILEDIGESTALGO}\n[%{FILENAMES}\t%{FILEDIGESTS}\n]",
          archive,
        ],
        commandOptions,
      );
      const rows = output.stdout.split("\n");
      if (rows.shift() !== "8")
        throw new HopperReleaseError(
          "integrity",
          "The signed RPM header does not use SHA-256 file digests.",
        );
      const matches = rows.filter((row) =>
        row.startsWith("/opt/hopper/bin/Hopper\t"),
      );
      const digest = matches[0]?.split("\t")[1];
      if (
        matches.length !== 1 ||
        digest === undefined ||
        !/^[a-f0-9]{64}$/u.test(digest)
      )
        throw new HopperReleaseError(
          "integrity",
          "The signed RPM header has no unique Hopper launcher digest.",
        );
      return digest;
    }
    const extracted = join(root, "extracted");
    await mkdir(extracted, { mode: 0o700 });
    if (family === "deb")
      await execFileOutput(
        "dpkg-deb",
        ["--extract", archive, extracted],
        commandOptions,
      );
    else
      await execFileOutput(
        "tar",
        ["-xf", archive, "-C", extracted, "--", "opt/hopper/bin/Hopper"],
        commandOptions,
      );
    return (
      await this.#hashFileWithResources(
        join(extracted, "opt", "hopper", "bin", "Hopper"),
        signal,
        resources,
      )
    ).sha256;
  }

  #read(
    path: string,
    limit: number,
    signal: AbortSignal | undefined,
    resources: ArtifactResourceScope,
  ): Promise<Buffer> {
    return withRegularFile(
      path,
      async (handle, stats) => {
        if (stats.size > limit)
          throw new HopperReleaseError(
            "integrity",
            "Retained Hopper evidence exceeds its resource byte budget.",
          );
        const bytes = await readBoundedFileBytes(handle, stats.size, {
          signal,
        });
        if (bytes === undefined)
          throw new HopperReleaseError(
            "integrity",
            "Retained Hopper evidence changed during inspection.",
          );
        return bytes;
      },
      { signal, symlinks: "reject", resources },
    ).catch((cause: unknown) => {
      if (
        resources === this.#resources &&
        cause instanceof RegularFileCleanupFailure
      )
        pendingCleanup.add(resources);
      throw cause;
    });
  }

  async #withTemporary<T>(
    operation: (path: string, resources: ArtifactResourceScope) => Promise<T>,
    parent?: string,
  ): Promise<T> {
    const root = await PrivateRuntimeRoot.create({
      prefix: "rea-hopper-publisher-",
      ...(parent === undefined ? {} : { parent }),
    });
    const temporaryResources = new ArtifactResourceScope();
    const dependency = {
      kind: "lease" as const,
      resource: root.path,
      lease: {
        release: async () => {
          await temporaryResources.close();
          await root.close();
        },
      },
    };
    let outcome:
      | { readonly ok: true; readonly value: T }
      | { readonly ok: false; readonly cause: unknown };
    try {
      outcome = {
        ok: true,
        value: await operation(root.path, temporaryResources),
      };
    } catch (cause: unknown) {
      outcome = { ok: false, cause };
    }
    const released = await temporaryResources.close().then(
      () => ({ ok: true as const }),
      (cause: unknown) => ({ ok: false as const, cause }),
    );
    if (!released.ok) {
      this.#resources.retain(dependency);
      pendingCleanup.add(this.#resources);
      throw new HopperReleaseError(
        "cleanup_failed",
        `Hopper publisher verification retained temporary cleanup ownership for ${root.path}.`,
        {
          cause: new AggregateError(
            outcome.ok ? [released.cause] : [outcome.cause, released.cause],
            "Temporary operation and descendant cleanup outcomes",
          ),
        },
      );
    }
    try {
      await root.close();
    } catch (cleanupCause: unknown) {
      this.#resources.retain(dependency);
      pendingCleanup.add(this.#resources);
      throw new HopperReleaseError(
        "cleanup_failed",
        `Hopper publisher verification retained temporary cleanup ownership for ${root.path}.`,
        {
          cause: new AggregateError(
            outcome.ok ? [cleanupCause] : [outcome.cause, cleanupCause],
            "Temporary operation and cleanup outcomes",
          ),
        },
      );
    }
    if (!outcome.ok) throw outcome.cause;
    return outcome.value;
  }

  async #withOwnedResource<T>(
    owner: ArtifactResourceOwner,
    operation: () => Promise<T>,
  ): Promise<T> {
    let outcome:
      | { readonly ok: true; readonly value: T }
      | { readonly ok: false; readonly cause: unknown };
    try {
      outcome = { ok: true, value: await operation() };
    } catch (cause: unknown) {
      outcome = { ok: false, cause };
    }
    if (this.#resources.hasPending) {
      this.#resources.retain(owner);
      pendingCleanup.add(this.#resources);
      throw new HopperReleaseError(
        "cleanup_failed",
        `Hopper publisher verification retained cleanup ownership for ${owner.resource}.`,
        {
          cause: new AggregateError(
            outcome.ok ? [] : [outcome.cause],
            "Publisher operation and descendant cleanup outcomes",
          ),
        },
      );
    }
    const cleanup = await this.#resources.release(owner);
    if (cleanup.kind === "failed") {
      pendingCleanup.add(this.#resources);
      const causes = outcome.ok
        ? [cleanup.cause]
        : [outcome.cause, cleanup.cause];
      throw new HopperReleaseError(
        "cleanup_failed",
        `Hopper publisher verification retained cleanup ownership for ${owner.resource}.`,
        {
          cause: new AggregateError(
            causes,
            "Publisher inspection and cleanup outcomes",
          ),
        },
      );
    }
    if (!outcome.ok) throw outcome.cause;
    return outcome.value;
  }
}

/** Retry only resources retained by this producer after failed cleanup. */
export const retryLinuxHopperPublisherCleanup = async (): Promise<void> => {
  const causes: unknown[] = [];
  const observations = [];
  const cleanupLeases = new Set<AnalysisCleanupLease>();
  let cleanupLeaseAuthorityKnown = true;
  for (const scope of pendingCleanup) {
    try {
      await scope.close();
      pendingCleanup.delete(scope);
    } catch (cause: unknown) {
      causes.push(cause);
      const leases = artifactPrimaryCleanupLeases(cause);
      if (leases === undefined) cleanupLeaseAuthorityKnown = false;
      else for (const lease of leases) cleanupLeases.add(lease);
      observations.push(
        ArtifactReaderFailure.cleanupObservation(
          cause,
          "hopper-publisher-verification",
        ),
      );
    }
  }
  if (causes.length > 0) {
    const cleanup = {
      reason: observations.map(({ reason }) => reason).join("; "),
      resources: [
        ...new Set(observations.flatMap(({ resources }) => resources)),
      ],
    };
    throw new ArtifactReaderFailure(
      "unavailable",
      `Hopper publisher cleanup remains incomplete: ${cleanup.resources.join(", ")}`,
      {
        cause: new AggregateError(causes, "Hopper publisher cleanup failures"),
        cleanup,
        cleanupLeases: cleanupLeaseAuthorityKnown
          ? [...cleanupLeases]
          : undefined,
      },
    );
  }
};

const decodeUtf8 = (bytes: Uint8Array): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const releaseFailure = (
  cause: unknown,
  signal: AbortSignal | undefined,
  fallback: HopperReleaseError["reason"],
): HopperReleaseError => {
  if (cause instanceof HopperReleaseError) return cause;
  if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined)
    return new HopperReleaseError(
      "cleanup_failed",
      "Hopper publisher cleanup remains incomplete.",
      { cause },
    );
  const cancellation = regularFileCancellation(cause);
  if (cancellation !== undefined)
    return new HopperReleaseError(
      "cancelled",
      "Hopper publisher verification was cancelled.",
      { cause: cancellation.reason },
    );
  if (!(cause instanceof StableFileHashFailure) && signal?.aborted === true)
    return new HopperReleaseError(
      "cancelled",
      "Hopper publisher verification was cancelled.",
      { cause },
    );
  return new HopperReleaseError(
    fallback,
    "Hopper publisher verification could not complete.",
    { cause },
  );
};
const launcherIdentity = (
  verified: VerifiedLinuxHopperPackage,
  source: VerifiedLinuxHopperLauncher["source"],
): VerifiedLinuxHopperLauncher => ({
  sha256: verified.release.main_exe_hash,
  version: verified.release.version,
  primaryFingerprint: verified.primaryFingerprint,
  signingFingerprint: verified.signingFingerprint,
  source,
});

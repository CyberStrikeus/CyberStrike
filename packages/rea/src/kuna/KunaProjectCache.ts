import {
  regularFileState,
  sameRegularFileState,
  type RegularFileState,
} from "../filesystem/RegularFile.js";
import type { Stats } from "node:fs";
import {
  assertKunaProjectState,
  type KunaProjectFileStates,
} from "./KunaProjectState.js";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  lstat,
  mkdtemp,
  readdir,
  realpath,
  readFile,
  rename,
  rm,
  utimes,
} from "node:fs/promises";
import { basename, join } from "node:path";

import canonicalize from "canonicalize";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";
import { utcDateTimeSchema } from "../domain/offsetDateTime.js";

import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  observeStableFile,
  type StableFileObservation,
  stableFileHashCause,
} from "../filesystem/StableFileHash.js";
import {
  RegularFileCleanupFailure,
  regularFileCancellation,
} from "../filesystem/OwnedRegularFile.js";
import type { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import type { KunaInstallation } from "./KunaInstallation.js";
import {
  kunaExportFileNames,
  exportKunaProject,
  KUNA_EXPORT_OPERATION,
  kunaExportFailure,
  readKunaExport,
  type KunaExport,
  type KunaExportStatus,
} from "./KunaProjectExport.js";
import type { ProviderProcessSupervisor } from "../process/ProviderProcess.js";
import type { KunaProcessLauncher } from "./KunaCommand.js";
import type {
  KunaInventoryFunction,
  KunaProjectFunction,
} from "./KunaProjectFiles.js";
import { KUNA_PROVIDER_ID } from "./KunaRelease.js";

/** Bumped whenever the entry layout or manifest meaning changes. */
const CACHE_LAYOUT = 3;

/** A manifest names five files and their digests; anything larger is not ours. */
const MANIFEST_MAX_BYTES = 64 * 1024;

const KEY_PATTERN = /^[0-9a-f]{64}$/u;

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

/** Inputs that determine an export's content. Each one is part of the cache key. */
export interface KunaProjectKeyInputs {
  readonly targetSha256: string;
  readonly targetBasename: string;
  readonly kunaSha256: string;
  readonly kunaCommand: string;
  readonly kunaExecutable: string;
  readonly kunaVersion: string;
  /**
   * `--jobs 1` is Kuna's reference answer; more jobs decompile without
   * callee-first prototypes and change some bodies.
   */
  readonly jobs: number;
}

/** Content address of one export: every input that can change its bytes. */
export const kunaProjectKey = (inputs: KunaProjectKeyInputs): string =>
  createHash("sha256")
    .update(
      canonicalize({
        layout: CACHE_LAYOUT,
        target_sha256: inputs.targetSha256,
        target_basename: inputs.targetBasename,
        kuna_sha256: inputs.kunaSha256,
        kuna_command: inputs.kunaCommand,
        kuna_executable: inputs.kunaExecutable,
        kuna_version: inputs.kunaVersion,
        export: { command: "decompile-project", jobs: inputs.jobs },
      }) ?? "",
    )
    .digest("hex");

const fileSchema = z.strictObject({
  path: z.string().min(1),
  bytes: z.int().nonnegative(),
  sha256: z.string().regex(SHA256_PATTERN),
});

const manifestSchema = z
  .strictObject({
    layout: z.literal(CACHE_LAYOUT),
    key: z.string().regex(KEY_PATTERN),
    inputs: z.strictObject({
      target_sha256: z.string().regex(SHA256_PATTERN),
      target_basename: z.string().min(1),
      kuna_sha256: z.string().regex(SHA256_PATTERN),
      kuna_command: z.string(),
      kuna_executable: z.string(),
      kuna_version: z.string().min(1),
      jobs: z.int().positive(),
    }),
    files: z.strictObject({
      c: fileSchema,
      h: fileSchema,
      asm: fileSchema,
      readme: fileSchema,
      inventory: fileSchema,
    }),
    summary: z.strictObject({
      decompiled: z.int().nonnegative(),
      failed: z.int().nonnegative(),
    }),
    created_at: utcDateTimeSchema,
  })
  .superRefine(({ files, inputs, key }, context) => {
    if (
      key !==
      kunaProjectKey({
        targetSha256: inputs.target_sha256,
        targetBasename: inputs.target_basename,
        kunaSha256: inputs.kuna_sha256,
        kunaCommand: inputs.kuna_command,
        kunaExecutable: inputs.kuna_executable,
        kunaVersion: inputs.kuna_version,
        jobs: inputs.jobs,
      })
    )
      context.addIssue({
        code: "custom",
        path: ["key"],
        message: "Export cache key does not match its producing inputs",
      });
    const stem = inputs.target_basename;
    if (
      stem.length === 0 ||
      stem === "." ||
      stem === ".." ||
      stem.includes("\0") ||
      basename(stem) !== stem
    ) {
      context.addIssue({
        code: "custom",
        path: ["files", "c", "path"],
        message: "Export source must use the target's native basename",
      });
      return;
    }
    const expected = kunaExportFileNames(stem);
    for (const role of Object.keys(expected) as (keyof typeof expected)[])
      if (files[role].path !== expected[role])
        context.addIssue({
          code: "custom",
          path: ["files", role, "path"],
          message: "Export file does not match its producer role and basename",
        });
  });

/** Immutable description of one published export, written once at publish. */
export type KunaProjectManifest = z.infer<typeof manifestSchema>;

/** One verified, published export. */
export interface KunaProject {
  readonly fileStates: KunaProjectFileStates;
  readonly key: string;
  /** Directory holding the export's `.c`, `.h`, `.asm`, README and inventory. */
  readonly directory: string;
  readonly manifest: KunaProjectManifest;
  /** Decompiled function blocks in `.c` order. */
  readonly functions: readonly KunaProjectFunction[];
  /** Every callable entry Kuna found, including imports it does not decompile. */
  readonly inventory: readonly KunaInventoryFunction[];
}

/** Publication succeeded; only its stopped staging still needs cleanup. */
export class KunaPublishedProjectCleanupError extends ProviderCleanupError {
  constructor(
    readonly project: KunaProject,
    cleanup: ProviderCleanupError,
  ) {
    super(
      KUNA_PROVIDER_ID,
      cleanup.cleanupResources,
      {
        ...cleanup.diagnostics,
        published_export: {
          kind: "project-export",
          key: project.key,
          directory: project.directory,
          manifest: project.manifest,
        },
      },
      {
        operation: KUNA_EXPORT_OPERATION,
        cause: cleanup,
        remediationAction:
          "The immutable project export is published and remains available. Retry only the retained staging cleanup with close_binary; do not rerun the export to recover it.",
      },
    );
    this.bindCleanupDependencies([cleanup]);
  }
}

/** One request to produce or reuse the export for a target. */
export interface KunaProjectRequest {
  readonly installation: KunaInstallation;
  /** Caller-selected target path; REA decompiles a verified copy of it. */
  readonly targetPath: string;
  readonly targetSha256: string;
  readonly signal?: AbortSignal;
  readonly onStatus?: (status: KunaExportStatus) => void;
}

/** One build whose process tree REA could not prove stopped. */
interface RetainedProcess {
  readonly key: string;
  readonly error: ProviderCleanupError;
  /** Retries stopping the process tree, when the launcher left one. */
  readonly owner: ProviderProcessSupervisor | undefined;
  readonly staging: string;
}

interface RetainedHashFile {
  readonly key: string;
  readonly staging: string | null;
  readonly resource: string;
  readonly lease: AnalysisCleanupLease;
  /** The first failure tied to this owner; kept stable across retry attempts. */
  originatingFailure?: AnalysisError;
  /** Most recent close failure, reported without wrapping prior retry errors. */
  lastCloseFailure?: ProviderCleanupError;
}

interface CleanupErrorReport {
  readonly error: WeakRef<AnalysisError>;
  readonly pendingOwners: Set<object>;
}

interface CleanupFailureOwner {
  readonly error: AnalysisError;
  readonly owners: readonly object[];
}

interface StagedResult {
  readonly result: Result<KunaProject, AnalysisError>;
  readonly fileCleanupFailure?: RegularFileCleanupFailure;
  /** Set when an owned process may still write into staging. */
  readonly retainStaging: boolean;
}

interface InflightBuild {
  readonly key: string;
  readonly promise: Promise<Result<KunaProject, AnalysisError>>;
  readonly controller: AbortController;
  readonly listeners: Set<(status: KunaExportStatus) => void>;
  /** The latest status, replayed to requests that join after it was reported. */
  status: KunaExportStatus | undefined;
  waiters: number;
}

const isMissing = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause.code === "ENOENT" || cause.code === "ENOTDIR");

/** A file an entry's manifest names is gone, replaced or changed under it. */
const isDamaged = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  ["ENOENT", "ENOTDIR", "EISDIR", "ENOTFILE", "ESTALE"].includes(
    String(cause.code),
  );

const isPublishedByAnother = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause.code === "EEXIST" || cause.code === "ENOTEMPTY");

const parseManifest = (text: string): KunaProjectManifest | undefined => {
  try {
    const parsed = manifestSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

const manifestBytes = (manifest: KunaProjectManifest): number =>
  Object.values(manifest.files).reduce((sum, file) => sum + file.bytes, 0);

/**
 * REA-owned on-disk cache of `kuna decompile-project` exports.
 *
 * Layout under the root: `projects/<key>/` holds published entries
 * (`manifest.json` plus the export and inventory in `project/`), `staging/`
 * holds builds whose processes may still be live, `trash/` holds retired
 * workspaces and evicted entries awaiting removal,
 * and `home/` is Kuna's own HOME so its spec cache stays inside REA's
 * ownership.
 *
 * Entries are content-addressed and immutable. A build runs in private
 * staging and is published by one directory rename, so a reader sees a
 * complete entry or none, and concurrent publishers of one key keep the first.
 * File digests are recorded once at publish and checked on every first read.
 * Recency is the entry directory's mtime; publishing evicts the least recently
 * used entries above the size cap, never an entry pinned by this process.
 */
export class KunaProjectCache {
  readonly #selectedRoot: string;
  #canonicalRoot: string | undefined;
  readonly #maxBytes: number;
  readonly #launcher: KunaProcessLauncher | undefined;
  /** Builds new requests may join, at most one per key. */
  readonly #inflight = new Map<string, InflightBuild>();
  /** Every build not yet settled, including abandoned ones a retry replaced. */
  readonly #unfinished = new Set<InflightBuild>();
  readonly #verified = new Map<
    string,
    {
      readonly project: KunaProject;
      readonly manifestState: RegularFileState;
    }
  >();
  readonly #pins = new Map<string, number>();
  /** One eviction decision at a time; exports themselves remain concurrent. */
  #eviction: Promise<void> = Promise.resolve();
  #capacity: "within_limit" | "pinned" | "building" = "within_limit";
  #maintenance: Promise<void> | undefined;
  #maintenanceRequested = false;
  /** Builds whose process tree could not be proven stopped; their staging stays. */
  readonly #retainedProcesses: RetainedProcess[] = [];
  /** Only resources whose process cleanup is proven may be retried as files. */
  readonly #retainedFiles = new Map<
    string,
    {
      readonly key: string | null;
      readonly error: ProviderCleanupError;
      readonly cleanupOwner: object;
    }
  >();
  /** Hash descriptors whose close was not confirmed; staging stays until retry. */
  readonly #retainedHashFiles = new Map<OwnedFileHandle, RetainedHashFile>();
  /** Keep the exact close lease available for errors bound after a retry ends. */
  readonly #hashRecords = new WeakMap<OwnedFileHandle, RetainedHashFile>();
  /** Serialize owner release and staging retirement across concurrent lookups. */
  #hashRetry: Promise<void> = Promise.resolve();
  /** Weakly track caller errors against every resource owner they report. */
  readonly #cleanupErrorReports: CleanupErrorReport[] = [];
  readonly #stagingCleanupOwners = new Map<string, object>();

  constructor(
    root: string,
    options: {
      readonly maxBytes: number;
      readonly launcher?: KunaProcessLauncher;
    },
  ) {
    this.#selectedRoot = root;
    this.#maxBytes = options.maxBytes;
    this.#launcher = options.launcher;
  }

  /** Resolve native traversal once; all cache consumers use this filesystem identity. */
  async #resolveRoot(): Promise<string> {
    return (this.#canonicalRoot ??= await realpath(this.#selectedRoot));
  }

  /** Report cleanup owners retained after failed process or file cleanup. */
  get hasPendingCleanup(): boolean {
    return (
      this.#retainedProcesses.length > 0 ||
      this.#retainedFiles.size > 0 ||
      this.#retainedHashFiles.size > 0
    );
  }

  /** Keep an entry from eviction while this process serves it. */
  pin(key: string): () => void {
    this.#pins.set(key, (this.#pins.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.#pins.get(key) ?? 1) - 1;
      if (count === 0) {
        this.#pins.delete(key);
        if (this.#capacity !== "within_limit") this.#scheduleEviction();
      } else this.#pins.set(key, count);
    };
  }

  /**
   * Return the verified published entry for a key, or undefined when none is
   * usable. A corrupt or tampered entry is removed and reported as absent.
   */
  async lookup(
    key: string,
    signal?: AbortSignal,
  ): Promise<KunaProject | undefined> {
    if (!KEY_PATTERN.test(key))
      throw new ProviderAdapterError(KUNA_PROVIDER_ID, KUNA_EXPORT_OPERATION, {
        userMessage:
          "Kuna cache lookup requires a content-addressed project key",
      });
    await this.#retryHashFiles(key);
    const cleanup = this.#cleanupResult(this.#hashCleanupFailures(key));
    if (!cleanup.ok) throw cleanup.error;
    let root: string;
    try {
      root = await this.#resolveRoot();
    } catch (cause: unknown) {
      if (isMissing(cause)) return undefined;
      throw cause;
    }
    const projects = await this.#admitProjects(root);
    if (projects === undefined) return undefined;
    const admitted = await this.#admitEntry(projects, key);
    if (admitted === undefined) {
      await this.#discard(key);
      return undefined;
    }
    let verified = this.#verified.get(key);
    if (
      verified !== undefined &&
      !sameRegularFileState(verified.manifestState, admitted.manifest)
    ) {
      this.#verified.delete(key);
      verified = undefined;
    }
    if (verified !== undefined) {
      try {
        await assertKunaProjectState(
          verified.project.directory,
          verified.project.manifest.files,
          verified.project.fileStates,
          signal,
        );
      } catch (cause: unknown) {
        if (!isDamaged(cause)) throw cause;
        await this.#discard(key);
        return undefined;
      }
      if (await this.#touch(key)) return verified.project;
      this.#verified.delete(key);
      return undefined;
    }
    const entry = join(root, "projects", key);
    let text: string;
    try {
      text = await readFile(join(entry, "manifest.json"), "utf8");
    } catch (cause: unknown) {
      if (isMissing(cause)) return undefined;
      throw cause;
    }
    const manifest = parseManifest(text);
    if (manifest?.key !== key) {
      await this.#discard(key);
      return undefined;
    }
    const directory = join(entry, "project");
    const fileStates: Partial<
      Record<keyof KunaProjectFileStates, RegularFileState>
    > = {};
    for (const role of Object.keys(
      manifest.files,
    ) as (keyof KunaProjectFileStates)[]) {
      const file = manifest.files[role];
      let observed: StableFileObservation;
      try {
        const path = join(directory, file.path);
        observed = await observeStableFile(path, {
          ...(signal === undefined ? {} : { signal }),
          retainFailedClose: (owner) =>
            this.#retainHashFile(owner, key, null, path),
        });
      } catch (cause: unknown) {
        if (cause instanceof RegularFileCleanupFailure)
          throw this.#replaceHashCloseError(
            key,
            null,
            kunaExportFailure(cause, signal),
            cause,
          );
        if (regularFileCancellation(cause) !== undefined) throw cause;
        if (!isDamaged(stableFileHashCause(cause))) throw cause;
        await this.#discard(key);
        return undefined;
      }
      fileStates[role] = observed.state;
      if (observed.sha256 !== file.sha256 || observed.bytes !== file.bytes) {
        await this.#discard(key);
        return undefined;
      }
    }
    const parsed = await readKunaExport(
      directory,
      manifest.files,
      manifest.summary,
      fileStates as KunaProjectFileStates,
      signal,
    ).catch((cause: unknown) => {
      if (!isDamaged(cause)) throw cause;
      return undefined;
    });
    if (parsed === undefined || !parsed.ok) {
      await this.#discard(key);
      return undefined;
    }
    const project = {
      key,
      directory,
      manifest,
      fileStates: fileStates as KunaProjectFileStates,
      ...parsed.value,
    };
    if (!(await this.#touch(key))) return undefined;
    this.#verified.set(key, {
      project,
      manifestState: regularFileState(admitted.manifest),
    });
    return project;
  }

  /**
   * Return the entry for a request, building and publishing it when absent.
   * Concurrent requests for one key share one Kuna run; the run is cancelled
   * only when every waiting request has been cancelled.
   */
  async build(
    request: KunaProjectRequest,
  ): Promise<Result<KunaProject, AnalysisError>> {
    if (request.signal?.aborted === true)
      return err(new AnalysisCancelledError(KUNA_EXPORT_OPERATION));
    const key = kunaProjectKey({
      targetSha256: request.targetSha256,
      targetBasename: basename(request.targetPath),
      kunaSha256: request.installation.sha256,
      kunaCommand: request.installation.configuration.command,
      kunaExecutable: request.installation.executable,
      kunaVersion: request.installation.version,
      jobs: request.installation.configuration.jobs,
    });
    const running = this.#inflight.get(key);
    // A build whose waiters all left is winding down; a new request starts afresh.
    if (running !== undefined && !running.controller.signal.aborted)
      return this.#await(running, request);
    const controller = new AbortController();
    const listeners = new Set<(status: KunaExportStatus) => void>();
    // #produce reports its first status only after an await, once `created` exists.
    const promise = this.#produce(key, request, controller.signal, (status) => {
      created.status = status;
      for (const listener of listeners) listener(status);
    });
    const created: InflightBuild = {
      key,
      promise,
      controller,
      listeners,
      status: undefined,
      waiters: 0,
    };
    this.#inflight.set(key, created);
    this.#unfinished.add(created);
    void promise.then(() => {
      this.#unfinished.delete(created);
      if (this.#inflight.get(key) === created) this.#inflight.delete(key);
      if (this.#unfinished.size === 0 && this.#capacity === "building")
        this.#scheduleEviction();
    });
    return this.#await(created, request);
  }

  /**
   * Wait until a build that every waiter abandoned has stopped its Kuna
   * process and removed its staging. A build another request still waits for
   * keeps running and is not awaited.
   */
  async settled(key: string): Promise<Result<null, ProviderCleanupError>> {
    await Promise.allSettled(
      [...this.#unfinished]
        .filter((entry) => entry.key === key && entry.controller.signal.aborted)
        .map((entry) => entry.promise),
    );
    await this.#retryProcesses((retained) => retained.key === key);
    await this.#retryFiles(key);
    return this.#cleanupResult(this.#retainedCleanupFailures(key));
  }

  /** Wait for builds, retry safe file removal, and report unresolved cleanup. */
  async close(): Promise<Result<null, ProviderCleanupError>> {
    await Promise.allSettled(
      [...this.#unfinished].map((entry) => entry.promise),
    );
    while (this.#maintenance !== undefined) await this.#maintenance;
    await this.#retryProcesses(() => true);
    await this.#retryFiles();
    return this.#cleanupResult(this.#retainedCleanupFailures());
  }

  /** Retry stopping retained process trees; retire the staging of each one proven stopped. */
  async #retryProcesses(
    selected: (retained: RetainedProcess) => boolean,
  ): Promise<void> {
    for (const retained of this.#retainedProcesses.filter(selected)) {
      const stopped = await retained.owner?.stop();
      if (stopped === undefined || stopped.status === "incomplete") continue;
      this.#retainedProcesses.splice(
        this.#retainedProcesses.indexOf(retained),
        1,
      );
      this.#resolveCleanupOwner(retained);
      await this.#retireStaging(retained.staging, retained.key);
    }
  }

  /** Retry only stopped file resources belonging to the closing task, or all. */
  async #retryFiles(key?: string): Promise<void> {
    await this.#retryHashFiles(key);
    for (const [path, retained] of [...this.#retainedFiles])
      if (key === undefined || retained.key === key)
        await this.#removeRetired(path).catch(() => undefined);
  }

  /** Retry retained hash descriptors before admitting another read for a key. */
  async #retryHashFiles(key?: string): Promise<void> {
    const previous = this.#hashRetry;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#hashRetry = previous.then(() => current);
    await previous;
    try {
      const staging = new Map<string, string>();
      for (const [owner, retained] of [...this.#retainedHashFiles]) {
        if (key !== undefined && retained.key !== key) continue;
        try {
          await retained.lease.release();
          this.#retainedHashFiles.delete(owner);
          this.#resolveCleanupOwner(owner);
          if (retained.staging !== null)
            staging.set(retained.staging, retained.key);
        } catch (cause: unknown) {
          const original = retained.originatingFailure;
          const closeFailure = new ProviderCleanupError(
            KUNA_PROVIDER_ID,
            [retained.resource],
            { reason: cause instanceof Error ? cause.message : String(cause) },
            {
              operation: KUNA_EXPORT_OPERATION,
              cause:
                original === undefined
                  ? cause
                  : new AggregateError(
                      [original, cause],
                      "Hash operation and descriptor cleanup both failed",
                    ),
            },
          );
          retained.lastCloseFailure = closeFailure;
          this.#bindCleanupError(closeFailure, [
            owner,
            ...(retained.staging === null
              ? []
              : [this.#stagingCleanupOwner(retained.staging)]),
          ]);
        }
      }
      for (const [path, retainedKey] of staging)
        if (
          ![...this.#retainedHashFiles.values()].some(
            ({ staging: ownerStaging }) => ownerStaging === path,
          )
        )
          await this.#retireStaging(path, retainedKey);
    } finally {
      release();
    }
  }

  #hashCleanupFailures(key?: string): CleanupFailureOwner[] {
    return [...this.#retainedHashFiles.entries()]
      .filter(([, retained]) => key === undefined || retained.key === key)
      .flatMap(([owner, retained]) => {
        const failure =
          retained.lastCloseFailure ?? retained.originatingFailure;
        return failure === undefined
          ? []
          : [
              {
                error: failure,
                owners: [
                  owner,
                  ...(retained.staging === null
                    ? []
                    : [this.#stagingCleanupOwner(retained.staging)]),
                ],
              },
            ];
      });
  }

  #retainedCleanupFailures(key?: string): CleanupFailureOwner[] {
    return [
      ...this.#retainedProcesses
        .filter((retained) => key === undefined || retained.key === key)
        .map((retained) => ({
          error: retained.error,
          owners: [retained, this.#stagingCleanupOwner(retained.staging)],
        })),
      ...[...this.#retainedFiles.values()]
        .filter((retained) => key === undefined || retained.key === key)
        .map((retained) => ({
          error: retained.error,
          owners: [retained.cleanupOwner],
        })),
      ...this.#hashCleanupFailures(key),
    ];
  }

  #cleanupResult(
    failures: readonly CleanupFailureOwner[],
  ): Result<null, ProviderCleanupError> {
    const result = cleanupResult(failures.map(({ error }) => error));
    if (result.ok) return result;
    const owners = new Set(failures.flatMap(({ owners }) => owners));
    this.#bindCleanupError(result.error, [...owners]);
    return result;
  }

  #bindCleanupError(error: AnalysisError, owners: readonly object[]): void {
    this.#pruneCleanupErrorReports();
    const report = this.#cleanupErrorReports.find(
      (candidate) => candidate.error.deref() === error,
    );
    const pending = report?.pendingOwners ?? new Set<object>();
    for (const owner of owners) pending.add(owner);
    if (report === undefined && pending.size > 0)
      this.#cleanupErrorReports.push({
        error: new WeakRef(error),
        pendingOwners: pending,
      });
  }

  #fileCleanupOwner(path: string): object {
    return this.#retainedFiles.get(path)?.cleanupOwner ?? {};
  }

  #stagingCleanupOwner(path: string): object {
    let owner = this.#stagingCleanupOwners.get(path);
    if (owner === undefined) {
      owner = {};
      this.#stagingCleanupOwners.set(path, owner);
    }
    return owner;
  }

  #resolveCleanupOwner(owner: object): void {
    for (const report of [...this.#cleanupErrorReports]) {
      const error = report.error.deref();
      if (error === undefined) {
        this.#cleanupErrorReports.splice(
          this.#cleanupErrorReports.indexOf(report),
          1,
        );
        continue;
      }
      report.pendingOwners.delete(owner);
      if (report.pendingOwners.size === 0) {
        error.resolveCleanup();
        this.#cleanupErrorReports.splice(
          this.#cleanupErrorReports.indexOf(report),
          1,
        );
      }
    }
  }

  #transferCleanupOwner(from: object, to: object): void {
    this.#pruneCleanupErrorReports();
    for (const report of this.#cleanupErrorReports)
      if (report.pendingOwners.delete(from)) report.pendingOwners.add(to);
  }

  #pruneCleanupErrorReports(): void {
    for (
      let index = this.#cleanupErrorReports.length - 1;
      index >= 0;
      index -= 1
    )
      if (this.#cleanupErrorReports[index]?.error.deref() === undefined)
        this.#cleanupErrorReports.splice(index, 1);
  }

  /**
   * Move proven-stopped staging into trash and remove it. A failed removal
   * stays owned as a file cleanup that close retries.
   */
  async #retireStaging(
    staging: string,
    key: string,
  ): Promise<ProviderCleanupError | undefined> {
    let cleanupPath = staging;
    const stagingOwner = this.#stagingCleanupOwners.get(staging);
    try {
      const retired = join(
        await this.#resolveRoot(),
        "trash",
        `build-${randomUUID()}`,
      );
      await rename(staging, retired);
      cleanupPath = retired;
      await this.#removeRetired(retired, key);
      if (stagingOwner !== undefined) this.#resolveCleanupOwner(stagingOwner);
      return undefined;
    } catch (cause: unknown) {
      const failure =
        cause instanceof ProviderCleanupError
          ? cause
          : this.#retainFileCleanup(cleanupPath, cause, key);
      if (stagingOwner !== undefined)
        this.#transferCleanupOwner(
          stagingOwner,
          this.#fileCleanupOwner(cleanupPath),
        );
      return failure;
    } finally {
      this.#stagingCleanupOwners.delete(staging);
    }
  }

  #await(
    entry: InflightBuild,
    request: KunaProjectRequest,
  ): Promise<Result<KunaProject, AnalysisError>> {
    entry.waiters += 1;
    const onStatus = request.onStatus;
    // Each waiter owns its registration, even when callers reuse a callback.
    const listener =
      onStatus === undefined
        ? undefined
        : (status: KunaExportStatus) => onStatus(status);
    if (listener !== undefined) entry.listeners.add(listener);
    return new Promise((resolve) => {
      let settled = false;
      const leave = () => {
        if (listener !== undefined) entry.listeners.delete(listener);
        entry.waiters -= 1;
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        leave();
        if (entry.waiters === 0) entry.controller.abort();
        resolve(err(new AnalysisCancelledError(KUNA_EXPORT_OPERATION)));
      };
      request.signal?.addEventListener("abort", onAbort, { once: true });
      void entry.promise.then((result) => {
        request.signal?.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        leave();
        resolve(result);
      });
      // Replay only once cancellation is registered, so a listener may abort.
      if (listener !== undefined && entry.status !== undefined)
        listener(entry.status);
    });
  }

  async #produce(
    key: string,
    request: KunaProjectRequest,
    signal: AbortSignal,
    onStatus: (status: KunaExportStatus) => void,
  ): Promise<Result<KunaProject, AnalysisError>> {
    let staging: string;
    try {
      const existing = await this.lookup(key, signal);
      if (existing !== undefined) return ok(existing);
      await mkdir(this.#canonicalRoot ?? this.#selectedRoot, {
        recursive: true,
        mode: 0o700,
      });
      const root = await this.#resolveRoot();
      await Promise.all(
        ["projects", "staging", "trash", "home"].map((name) =>
          mkdir(join(root, name), { recursive: true, mode: 0o700 }),
        ),
      );
      await this.#sweep(signal);
      staging = await mkdtemp(join(root, "staging", "build-"));
    } catch (cause: unknown) {
      return err(kunaExportFailure(cause, signal));
    }
    const built = await this.#exportAndPublish(
      key,
      staging,
      request,
      signal,
      onStatus,
    ).catch((cause: unknown): StagedResult => ({
      result: err(kunaExportFailure(cause, signal)),
      retainStaging: false,
      ...(cause instanceof RegularFileCleanupFailure
        ? { fileCleanupFailure: cause }
        : {}),
    }));
    if (built.retainStaging) return built.result;
    const retainedStaging = [...this.#retainedHashFiles.values()].some(
      (retained) => retained.staging === staging,
    );
    if (retainedStaging) {
      if (
        !built.result.ok &&
        built.result.error.cleanupIncomplete &&
        built.fileCleanupFailure !== undefined
      )
        this.#replaceHashCloseError(
          key,
          staging,
          built.result.error,
          built.fileCleanupFailure,
        );
      return built.result;
    }
    // Only a proven-stopped build may enter trash. A failed write, crash or
    // lost cleanup identity therefore never makes live staging reclaimable.
    const retired = await this.#retireStaging(staging, key);
    if (retired !== undefined)
      return err(
        built.result.ok
          ? new KunaPublishedProjectCleanupError(built.result.value, retired)
          : analysisErrorWithCleanupFailure(
              built.result.error,
              retired,
              KUNA_EXPORT_OPERATION,
            ).bindCleanupDependencies([built.result.error, retired]),
      );
    if (built.result.ok)
      // The entry is published either way; a failed eviction retries on the next publish.
      await this.#evict(key).catch(() => undefined);
    return built.result;
  }

  async #exportAndPublish(
    key: string,
    staging: string,
    request: KunaProjectRequest,
    signal: AbortSignal,
    onStatus: (status: KunaExportStatus) => void,
  ): Promise<StagedResult> {
    const outcome = await exportKunaProject({
      installation: request.installation,
      targetPath: request.targetPath,
      targetSha256: request.targetSha256,
      workspace: staging,
      output: join(staging, "entry", "project"),
      signal,
      onStatus,
      launcher: this.#launcher,
      retainFailedFileClose: (owner, resource) =>
        this.#retainHashFile(owner, key, staging, resource),
    });
    if (outcome.kind === "retained") {
      const retained: RetainedProcess = {
        key,
        error: outcome.error,
        owner: outcome.owner,
        staging,
      };
      this.#retainedProcesses.push(retained);
      this.#bindCleanupError(outcome.error, [
        retained,
        this.#stagingCleanupOwner(staging),
      ]);
      return { result: err(outcome.error), retainStaging: true };
    }
    return {
      result: outcome.result.ok
        ? await this.#publish(
            key,
            staging,
            request,
            outcome.result.value,
            signal,
          )
        : outcome.result,
      retainStaging: false,
      ...(outcome.fileCleanupFailure === undefined
        ? {}
        : { fileCleanupFailure: outcome.fileCleanupFailure }),
    };
  }

  /** Record the manifest and publish the staged export under its key. */
  async #publish(
    key: string,
    staging: string,
    request: KunaProjectRequest,
    exported: KunaExport,
    signal: AbortSignal,
  ): Promise<Result<KunaProject, AnalysisError>> {
    const manifest: KunaProjectManifest = {
      layout: CACHE_LAYOUT,
      key,
      inputs: {
        target_sha256: request.targetSha256,
        target_basename: basename(request.targetPath),
        kuna_sha256: request.installation.sha256,
        kuna_command: request.installation.configuration.command,
        kuna_executable: request.installation.executable,
        kuna_version: request.installation.version,
        jobs: request.installation.configuration.jobs,
      },
      files: exported.files,
      summary: exported.summary,
      created_at: new Date().toISOString(),
    };
    const total = manifestBytes(manifest);
    if (total > this.#maxBytes)
      return err(
        new AnalysisResourceConstraintError(
          KUNA_EXPORT_OPERATION,
          "capacity",
          `This export occupies ${String(total)} bytes, more than the whole Kuna cache may hold.`,
          { cache_max_bytes: this.#maxBytes, export_bytes: total },
          {
            remediationAction:
              "Raise REA_KUNA_CACHE_MAX_BYTES above the export size, or analyze this target with another provider.",
          },
        ),
      );
    await writeFileAtomic(
      join(staging, "entry", "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 },
    );
    const manifestState = regularFileState(
      await lstat(join(staging, "entry", "manifest.json")),
    );
    const destination = join(await this.#resolveRoot(), "projects", key);
    try {
      await rename(join(staging, "entry"), destination);
    } catch (cause: unknown) {
      if (!isPublishedByAnother(cause)) throw cause;
      const winner = await this.lookup(key, signal);
      if (winner !== undefined) return ok(winner);
      throw cause;
    }
    const project = {
      key,
      directory: join(destination, "project"),
      manifest,
      fileStates: exported.fileStates,
      functions: exported.functions,
      inventory: exported.inventory,
    };
    this.#verified.set(key, { project, manifestState });
    return ok(project);
  }

  /**
   * Remove retired resources only. Age and a missing marker cannot establish
   * that a process stopped, so unresolved staging is never swept.
   */
  async #sweep(signal: AbortSignal): Promise<void> {
    const root = await this.#resolveRoot();
    for (const name of await readdir(join(root, "trash"))) {
      signal.throwIfAborted();
      await this.#removeRetired(join(root, "trash", name)).catch(
        () => undefined,
      );
    }
  }

  /** Evict least recently used entries above the cap, keeping pinned ones. */
  #evict(keep: string | null): Promise<void> {
    const eviction = this.#eviction.then(() => this.#evictUnpinned(keep));
    this.#eviction = eviction.catch(() => undefined);
    return eviction;
  }

  /** Coalesce deferred reclamation after callers have had a turn to pin results. */
  #scheduleEviction(): void {
    this.#maintenanceRequested = true;
    if (this.#maintenance !== undefined) return;
    const maintenance = (async () => {
      while (this.#maintenanceRequested) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        this.#maintenanceRequested = false;
        await this.#evict(null).catch(() => undefined);
      }
    })();
    this.#maintenance = maintenance;
    void maintenance.then(() => {
      if (this.#maintenance === maintenance) this.#maintenance = undefined;
      if (this.#maintenanceRequested) this.#scheduleEviction();
    });
  }

  async #evictUnpinned(keep: string | null): Promise<void> {
    const root = await this.#resolveRoot();
    const projects = await this.#admitProjects(root);
    if (projects === undefined) {
      this.#capacity = "within_limit";
      return;
    }
    // A successful build must reach its callers before they can pin its entry.
    // Protect every unfinished build while reading this eviction snapshot.
    const building = new Set([...this.#unfinished].map(({ key }) => key));
    const entries: { key: string; bytes: number; mtimeMs: number }[] = [];
    for (const name of await readdir(projects)) {
      if (!KEY_PATTERN.test(name)) continue;
      const path = join(root, "projects", name);
      const status = await this.#admitEntry(projects, name);
      const manifest =
        status === undefined
          ? undefined
          : await readFile(join(path, "manifest.json"), "utf8")
              .then(parseManifest)
              .catch((cause: unknown) => {
                if (isMissing(cause)) return undefined;
                throw cause;
              });
      // An owned entry without a valid manifest is unusable; evict it first.
      entries.push(
        manifest === undefined || status === undefined
          ? { key: name, bytes: 0, mtimeMs: -1 }
          : {
              key: name,
              bytes: manifestBytes(manifest),
              mtimeMs: status.mtimeMs,
            },
      );
    }
    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    let deferredByBuild = false;
    for (const entry of entries.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= this.#maxBytes && entry.mtimeMs >= 0) break;
      if (building.has(entry.key) || this.#inflight.has(entry.key)) {
        deferredByBuild = true;
        continue;
      }
      if (entry.key === keep || this.#pins.has(entry.key)) continue;
      await this.#discard(entry.key);
      total -= entry.bytes;
    }
    this.#capacity =
      total <= this.#maxBytes
        ? "within_limit"
        : deferredByBuild
          ? "building"
          : "pinned";
  }

  /** Atomically retire one owned entry, then remove it. */
  async #discard(key: string): Promise<void> {
    this.#verified.delete(key);
    const root = await this.#resolveRoot();
    const projects = await this.#admitProjects(root);
    if (projects === undefined) return;
    const trash = join(root, "trash", `${key}-${randomUUID()}`);
    try {
      await mkdir(join(root, "trash"), { recursive: true, mode: 0o700 });
      await rename(join(projects, key), trash);
    } catch (cause: unknown) {
      if (isMissing(cause)) return;
      throw cause;
    }
    await this.#removeRetired(trash, key);
  }

  /** Keep each failed removal owned until that path is successfully removed. */
  async #removeRetired(path: string, key?: string): Promise<void> {
    try {
      await rm(path, { recursive: true, force: true });
      const retained = this.#retainedFiles.get(path);
      this.#retainedFiles.delete(path);
      if (retained !== undefined)
        this.#resolveCleanupOwner(retained.cleanupOwner);
    } catch (cause: unknown) {
      throw this.#retainFileCleanup(path, cause, key);
    }
  }

  /** Mark an entry recently used; false when it is no longer published. */
  async #touch(key: string): Promise<boolean> {
    const now = new Date();
    try {
      await utimes(join(await this.#resolveRoot(), "projects", key), now, now);
      return true;
    } catch (cause: unknown) {
      // Recency is advisory; only a missing entry changes the answer.
      return !isMissing(cause);
    }
  }

  /** A replaced projects parent does not confer ownership of its children. */
  async #admitProjects(root: string): Promise<string | undefined> {
    const projects = join(root, "projects");
    const parent = await lstat(projects).catch((cause: unknown) => {
      if (isMissing(cause)) return undefined;
      throw cause;
    });
    if (parent === undefined) return undefined;
    if (!parent.isDirectory() || parent.isSymbolicLink())
      throw new ProviderAdapterError(KUNA_PROVIDER_ID, KUNA_EXPORT_OPERATION, {
        userMessage: `Kuna cache project ownership is unknown: ${projects} is not a regular directory`,
      });
    return projects;
  }

  /** Admit the owned entry layout before reading any manifest or project bytes. */
  async #admitEntry(
    projects: string,
    key: string,
  ): Promise<
    | {
        readonly mtimeMs: number;
        readonly manifest: Stats;
      }
    | undefined
  > {
    const entry = join(projects, key);
    try {
      const status = await lstat(entry);
      if (!status.isDirectory() || status.isSymbolicLink()) return undefined;
      const project = await lstat(join(entry, "project"));
      if (!project.isDirectory() || project.isSymbolicLink()) return undefined;
      const manifest = await lstat(join(entry, "manifest.json"));
      if (
        !manifest.isFile() ||
        manifest.isSymbolicLink() ||
        manifest.size > MANIFEST_MAX_BYTES
      )
        return undefined;
      return {
        mtimeMs: status.mtimeMs,
        manifest,
      };
    } catch (cause: unknown) {
      if (isMissing(cause)) return undefined;
      throw cause;
    }
  }

  #retainFileCleanup(
    path: string,
    cause: unknown,
    key?: string,
  ): ProviderCleanupError {
    const error = new ProviderCleanupError(
      KUNA_PROVIDER_ID,
      [path],
      { reason: cause instanceof Error ? cause.message : String(cause) },
      { operation: KUNA_EXPORT_OPERATION, cause },
    );
    const retained = {
      key: key ?? this.#retainedFiles.get(path)?.key ?? null,
      error,
      cleanupOwner: this.#retainedFiles.get(path)?.cleanupOwner ?? {},
    };
    this.#retainedFiles.set(path, retained);
    this.#bindCleanupError(error, [retained.cleanupOwner]);
    return error;
  }

  #retainHashFile(
    owner: OwnedFileHandle,
    key: string,
    staging: string | null,
    resource: string,
  ): void {
    const retained: RetainedHashFile = {
      key,
      staging,
      resource,
      lease: new AnalysisCleanupLease(async () => owner.close(), [resource]),
    };
    this.#hashRecords.set(owner, retained);
    this.#retainedHashFiles.set(owner, retained);
  }

  #replaceHashCloseError(
    key: string,
    staging: string | null,
    failure: AnalysisError,
    fileCleanupFailure: RegularFileCleanupFailure,
  ): AnalysisError {
    const owner = fileCleanupFailure.owner;
    const retained = this.#hashRecords.get(owner);
    if (retained !== undefined) {
      retained.lease.bindCleanupError(failure);
      if (retained.key === key && retained.staging === staging)
        retained.originatingFailure ??= failure;
    }
    return failure;
  }
}

/** One cleanup error aggregating what remains owned, or success when nothing does. */
const cleanupResult = (
  remaining: readonly AnalysisError[],
): Result<null, ProviderCleanupError> => {
  if (remaining.length === 0) return ok(null);
  return err(
    new ProviderCleanupError(
      KUNA_PROVIDER_ID,
      remaining.flatMap((entry) => entry.cleanupResources),
      {
        reason: remaining
          .map((entry) =>
            String(entry.diagnostics?.["reason"] ?? entry.message),
          )
          .join("; "),
      },
      {
        operation: KUNA_EXPORT_OPERATION,
        cause: new AggregateError(
          remaining,
          "Kuna cache cleanup is incomplete",
        ),
      },
    ),
  );
};

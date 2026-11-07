import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../artifacts/AnalysisCleanupLease.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { regularFileCancellation } from "../filesystem/OwnedRegularFile.js";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, open as openFile, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import {
  type ExecutionOptions,
  type ProviderAvailability,
  createAnalysisExecution,
  type AnalysisExecution,
} from "../application/AnalysisProvider.js";
import { createAnalysisExecutionEvidence } from "../domain/analysisObservation.js";
import {
  MAX_FLUTTER_LIBRARY_PATH_BYTES,
  type FlutterRequest,
} from "../domain/flutter/flutterBuildAnalysis.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
  AnalysisProtocolError,
} from "../domain/analysisErrorCore.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import { fixedAllowanceOptions } from "../domain/fixedAllowanceRemediation.js";
import {
  AnalysisError,
  type AnalysisPartialObservation,
} from "../domain/analysisErrorBase.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  ArtifactReaderFailure,
  type ArtifactEntry,
} from "../artifacts/ArtifactReader.js";
import { ZipArtifactReader } from "../artifacts/ZipArtifactReader.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import {
  NonRegularFileReadError,
  openRegularFile,
  RegularFileAdmissionFailure,
  sameRegularFileState,
} from "../filesystem/RegularFile.js";
import {
  MAX_SNAPSHOT_HASH_CANDIDATES,
  LabeledStringScanner,
  SnapshotHashScanner,
} from "./FlutterPayloadScan.js";
import {
  ELF_HEADER_MAX_BYTES,
  readElfHeader,
  readElfSymbols,
  readSnapshotHeader,
} from "./DartElf.js";
import { readElfBuildIds } from "./ElfBuildId.js";
import { privateWorkspaceFailure } from "../process/privateWorkspaceFailure.js";

/** Stable identity for the Flutter build-identification provider. */
export const FLUTTER_PROVIDER_IDENTITY = {
  id: "flutter",
  name: "Flutter build identification",
  version: null,
} as const;

const APK_METADATA_READ_MAX_BYTES = 8 * 1024 * 1024;
const LIBRARY_MAX_BYTES = 256 * 1024 * 1024;
/** Cumulative cap across every library entry in one identification. */
const TOTAL_EXTRACTION_MAX_BYTES = 768 * 1024 * 1024;
/** The APK itself must fit within this budget before any copy. */
const APK_MAX_BYTES = 2 * 1024 * 1024 * 1024;
// At most 32 ABI projections (two libraries each). With bounded hashes and
// engine labels this keeps expanded result metadata below 512 KiB for ordinary
// ABI names, independently of the archive's compressed-byte budget.
const MAX_FLUTTER_ABIS = 32;
const flutterBudget = (allowance: string, kind: "parser" | "input") =>
  fixedAllowanceOptions(allowance, kind);
const MAX_POOL_URIS = 500;
const MAX_POOL_TOKENS = 2_000;
/** A complete AOT image carries exactly one VM and one isolate section. */
const SYMBOL_PAIR_COUNT = 2;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

/**
 * Stream a local file digest without retaining large files in memory.
 * Aborts between chunks so a cancellation cannot run a digest to completion.
 */
const sha256File = async (
  operation: string,
  path: string,
  signal: AbortSignal | undefined,
): Promise<string> => {
  const hash = createHash("sha256");
  const stream = createReadStream(path, signal === undefined ? {} : { signal });
  for await (const chunk of stream) {
    if (signal?.aborted === true)
      throw new AnalysisCancelledError(operation, { cause: signal.reason });
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
};

/** One owned snapshot root: a read-only copy of the admitted input. */
interface OwnedSnapshot {
  readonly root: string;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface LibraryFacts {
  readonly libapp: {
    present: boolean;
    bytes: number | null;
    sha256: string | null;
    elfHeaderValid: boolean | null;
    sources: number;
    candidates: readonly string[];
  };
  readonly libflutter: {
    present: boolean;
    bytes: number | null;
    sha256: string | null;
    buildId: string | null;
    buildIdCandidates: readonly string[];
    buildIdFailures: readonly string[];
    dartVersion: string | null;
    dartVersionCapped: boolean;
    toolchainLines: readonly string[];
    toolchainCapped: boolean;
  };
}

const emptyFacts = (): LibraryFacts => ({
  libapp: {
    present: false,
    bytes: null,
    sha256: null,
    elfHeaderValid: null,
    sources: 0,
    candidates: [],
  },
  libflutter: {
    present: false,
    bytes: null,
    sha256: null,
    buildId: null,
    buildIdCandidates: [],
    buildIdFailures: [],
    dartVersion: null,
    dartVersionCapped: false,
    toolchainLines: [],
    toolchainCapped: false,
  },
});

/** Translate a ZIP reader rejection into the typed analysis error algebra. */
const isCancellation = (cause: unknown): boolean =>
  cause instanceof AnalysisCancelledError ||
  (cause instanceof ArtifactReaderFailure && cause.reason === "cancelled") ||
  (cause instanceof Error && cause.name === "AbortError") ||
  (typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "ABORT_ERR");

const mapInputFailure = (
  operation: string,
  path: string,
  cause: unknown,
): AnalysisError => {
  if (cause instanceof AnalysisError) return cause;
  const cancellation = regularFileCancellation(cause);
  if (cancellation !== undefined)
    return new AnalysisCancelledError(operation, {
      cause: cancellation.reason,
    });
  if (isCancellation(cause))
    return new AnalysisCancelledError(operation, { cause });
  if (
    cause instanceof Error &&
    "code" in cause &&
    (cause.code === "EACCES" || cause.code === "EPERM")
  )
    return new AnalysisAccessDeniedError(operation, path, cause.code, {
      cause,
    });
  if (cause instanceof ArtifactReaderFailure && cause.reason === "limit")
    return new AnalysisResourceConstraintError(
      operation,
      "memory",
      cause.message,
      { max_metadata_read_bytes: APK_METADATA_READ_MAX_BYTES },
      {
        cause,
        ...flutterBudget("The Flutter APK metadata read allowance", "parser"),
      },
    );
  return new AnalysisInputError(operation, { cause }, [
    {
      path: ["path"],
      reason: "invalid_format",
      message: inputFailureMessage(path, cause),
    },
  ]);
};

/** Name a missing or non-file selection instead of blaming package bytes. */
const inputFailureMessage = (path: string, cause: unknown): string => {
  if (
    cause instanceof Error &&
    "code" in cause &&
    (cause.code === "ENOENT" || cause.code === "ENOTDIR")
  )
    return `Selected APK does not exist: ${path}`;
  if (cause instanceof NonRegularFileReadError)
    return `Selected APK is not a regular file: ${path}`;
  const message = cause instanceof Error ? cause.message : String(cause);
  return `The APK could not be read as a package: ${path}: ${message}`;
};

/**
 * Provider-owned storage failures must never be attributed to caller input.
 * `workspacePath` is the owned root once allocated, so a failure without its
 * own errno path still names the workspace it occurred in.
 */
const mapOwnedIoFailure = (
  operation: string,
  cause: unknown,
  workspacePath: string | null,
): AnalysisError => {
  if (cause instanceof AnalysisError) return cause;
  const cancellation = regularFileCancellation(cause);
  if (cancellation !== undefined)
    return new AnalysisCancelledError(operation, {
      cause: cancellation.reason,
    });
  if (isCancellation(cause))
    return new AnalysisCancelledError(operation, { cause });
  if (
    cause instanceof Error &&
    "code" in cause &&
    typeof cause.code === "string"
  )
    return privateWorkspaceFailure(
      FLUTTER_PROVIDER_IDENTITY.id,
      operation,
      cause,
      workspacePath,
    );
  return new AnalysisProtocolError(operation, { cause });
};

/**
 * ZIP format failures describe caller bytes. A system error comes from the
 * provider-owned snapshot descriptor, so it propagates unchanged to the
 * snapshot owner, which maps it against the owned workspace.
 */
const mapPackageFailure = (
  operation: string,
  path: string,
  cause: unknown,
): unknown =>
  cause instanceof Error && "code" in cause && typeof cause.code === "string"
    ? cause
    : mapInputFailure(operation, path, cause);

interface FlutterLibrary {
  readonly entry: ArtifactEntry;
  readonly abi: string;
  readonly kind: "libapp" | "libflutter";
}

/** One inventory owns occurrence ambiguity and metadata expansion for both tools. */
const collectFlutterLibraries = async (
  reader: ZipArtifactReader,
  operation: string,
  path: string,
  signal: AbortSignal | undefined,
): Promise<FlutterLibrary[]> => {
  const libraries: FlutterLibrary[] = [];
  const paths = new Set<string>();
  const abis = new Set<string>();
  try {
    for await (const entry of reader.entries(signal)) {
      if (entry.kind !== "file") continue;
      const match = /^lib\/([^/]+)\/(libapp|libflutter)\.so$/u.exec(entry.path);
      if (match === null) continue;
      if (paths.has(entry.path))
        throw new AnalysisInputError(operation, undefined, [
          {
            path: ["path"],
            reason: "invalid_format",
            message: `The selected APK has duplicate Flutter library members: ${path}: ${entry.path}`,
          },
        ]);
      paths.add(entry.path);
      abis.add(match[1]!);
      if (
        abis.size > MAX_FLUTTER_ABIS ||
        Buffer.byteLength(entry.path) > MAX_FLUTTER_LIBRARY_PATH_BYTES
      )
        throw new AnalysisResourceConstraintError(
          operation,
          "memory",
          "Flutter library inventory exceeds the bounded ABI projection budget",
          {
            max_flutter_abis: MAX_FLUTTER_ABIS,
            max_library_path_bytes: MAX_FLUTTER_LIBRARY_PATH_BYTES,
          },
          flutterBudget("The Flutter ABI inventory allowance", "parser"),
        );
      libraries.push({
        entry,
        abi: match[1]!,
        kind: match[2] === "libapp" ? "libapp" : "libflutter",
      });
    }
    return libraries;
  } catch (cause) {
    throw mapPackageFailure(operation, path, cause);
  }
};

/** The generator owns iterator closure, including early extraction failures. */
async function* openEntrySafely(
  reader: ZipArtifactReader,
  entry: ArtifactEntry,
  operation: string,
  path: string,
  signal: AbortSignal | undefined,
): AsyncGenerator<Buffer> {
  try {
    yield* await reader.open(entry, signal);
  } catch (cause) {
    throw mapPackageFailure(operation, path, cause);
  }
}

const checkApkSize = (operation: string, bytes: number): void => {
  if (bytes > APK_MAX_BYTES)
    throw new AnalysisResourceConstraintError(
      operation,
      "file-size",
      `The selected APK exceeds the ${String(APK_MAX_BYTES)}-byte snapshot budget`,
      { max_apk_bytes: APK_MAX_BYTES, observed_bytes: bytes },
      flutterBudget("the Flutter APK snapshot allowance", "input"),
    );
};

export interface FlutterProviderOptions {
  /** Deterministic root removal for tests; production removes recursively. */
  readonly removeRoot?: (path: string) => Promise<void>;
}

/**
 * Flutter build identification by pure parsing: reads `lib/<abi>/libapp.so`
 * and `libflutter.so` through the hardened ZIP reader and reports the Dart
 * snapshot hash, GNU build-id, and any labeled version strings verbatim.
 * Runs no engine, installs nothing, and performs no external lookups.
 */
export class FlutterBuildProvider {
  private readonly ownedRoots = new Map<
    string,
    Set<{ close(): Promise<void> }>
  >();
  private readonly removeRoot: (path: string) => Promise<void>;
  private readonly cleanupFailures = new Map<string, readonly unknown[]>();
  private readonly rootLeases = new Map<string, AnalysisCleanupLease>();
  private readonly operations = new ArtifactResourceScope();

  constructor(options: FlutterProviderOptions = {}) {
    this.operations.addCloseHook(() => this.closeRoots());
    this.removeRoot =
      options.removeRoot ??
      ((path) => rm(path, { recursive: true, force: true }));
  }

  /**
   * Snapshot the admitted input into a provider-owned, read-only copy so a
   * concurrently modified original cannot mix into one observation. The
   * digest is taken from the snapshot, and every later read uses the
   * snapshot path.
   */
  private async ownSnapshot(
    operation: string,
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<OwnedSnapshot> {
    let root: string;
    try {
      root = await mkdtemp(join(tmpdir(), "rea-flutter-"));
    } catch (cause) {
      // No workspace exists yet; the errno path names the attempted template.
      throw mapOwnedIoFailure(operation, cause, null);
    }
    this.ownedRoots.set(root, new Set());
    this.rootLeases.set(
      root,
      new AnalysisCleanupLease(async () => {
        if (!(await this.cleanupRoot(root)))
          throw this.cleanupError(root, operation);
      }, [root]),
    );
    const snapshotPath = join(root, "input.apk");
    const readSource = async <T>(read: () => Promise<T>): Promise<T> => {
      try {
        return await read();
      } catch (cause) {
        throw mapInputFailure(operation, path, cause);
      }
    };
    try {
      // Pin the admitted source: capture its identity before the copy and
      // revalidate after, so an in-place replacement or swap mid-copy is
      // refused instead of publishing mixed bytes under the original path.
      // The copy itself is streamed and abort-checked so cancellation
      // stops the write promptly instead of draining the whole file.
      let source: OwnedFileHandle;
      try {
        const { handle } = await openRegularFile(path, {
          symlinks: "follow",
          signal,
        });
        source = this.ownResource(root, new OwnedFileHandle(handle));
      } catch (cause) {
        if (cause instanceof RegularFileAdmissionFailure) {
          this.ownResource(root, cause.owner);
          throw mapInputFailure(operation, path, cause.cause);
        }
        throw mapInputFailure(operation, path, cause);
      }
      const before = await readSource(() =>
        source.handle.stat({ bigint: true }),
      );
      checkApkSize(operation, Number(before.size));
      const output = this.ownResource(
        root,
        new OwnedFileHandle(await openFile(snapshotPath, "wx")),
      );
      const chunk = Buffer.alloc(64 * 1024);
      let copiedBytes = 0;
      while (copiedBytes <= Number(before.size)) {
        signal?.throwIfAborted();
        const { bytesRead } = await readSource(() =>
          source.handle.read(
            chunk,
            0,
            Math.min(chunk.length, Number(before.size) - copiedBytes + 1),
            copiedBytes,
          ),
        );
        signal?.throwIfAborted();
        if (bytesRead === 0) break;
        copiedBytes += bytesRead;
        if (BigInt(copiedBytes) > before.size)
          throw new AnalysisArtifactChangedError(
            operation,
            path,
            "Selected file grew during snapshotting",
          );
        await output.handle.writeFile(chunk.subarray(0, bytesRead));
      }
      await this.releaseResource(root, output);
      const [after, currentPath] = await Promise.all([
        readSource(() => source.handle.stat({ bigint: true })),
        stat(path, { bigint: true }).catch((cause: unknown) => {
          if (
            cause instanceof Error &&
            "code" in cause &&
            (cause.code === "EACCES" || cause.code === "EPERM")
          )
            throw mapInputFailure(operation, path, cause);
          throw new AnalysisArtifactChangedError(
            operation,
            path,
            "Selected path became unavailable during snapshotting",
            { cause },
          );
        }),
      ]);
      if (
        BigInt(copiedBytes) !== before.size ||
        !sameRegularFileState(before, after) ||
        !sameRegularFileState(before, currentPath)
      )
        throw new AnalysisArtifactChangedError(
          operation,
          path,
          "Selected file identity or contents changed during snapshotting",
        );
      await this.releaseResource(root, source);
      await chmod(snapshotPath, 0o400);
      const info = await stat(snapshotPath);
      const sha256 = await sha256File(operation, snapshotPath, signal);
      return { root, path: snapshotPath, bytes: info.size, sha256 };
    } catch (cause) {
      const primary =
        signal?.aborted === true
          ? new AnalysisCancelledError(operation, { cause: signal.reason })
          : mapOwnedIoFailure(operation, cause, root);
      const released = await this.discardRoot(root);
      if (!released)
        throw this.withCleanup(
          primary,
          this.cleanupError(root, operation),
          operation,
        );
      throw primary;
    }
  }

  private readerFor(snapshot: OwnedSnapshot): ZipArtifactReader {
    return this.ownResource(
      snapshot.root,
      new ZipArtifactReader(snapshot.path, "apk", APK_METADATA_READ_MAX_BYTES),
    );
  }

  private ownResource<T extends { close(): Promise<void> }>(
    root: string,
    resource: T,
  ): T {
    this.ownedRoots.get(root)!.add(resource);
    return resource;
  }

  private async releaseResource(
    root: string,
    resource: { close(): Promise<void> },
  ): Promise<void> {
    await resource.close();
    this.ownedRoots.get(root)?.delete(resource);
  }

  /** Close every owned handle before removing its root; retain any failure. */
  private async discardRoot(root: string): Promise<boolean> {
    const lease = this.rootLeases.get(root);
    if (lease === undefined) return true;
    try {
      await lease.release();
      this.rootLeases.delete(root);
      return true;
    } catch {
      return false;
    }
  }

  private async cleanupRoot(root: string): Promise<boolean> {
    const resources = this.ownedRoots.get(root);
    if (resources === undefined) return true;
    const attempts = await Promise.allSettled(
      [...resources].map((resource) => this.releaseResource(root, resource)),
    );
    const failures = attempts.flatMap((attempt) =>
      attempt.status === "rejected" ? [attempt.reason as unknown] : [],
    );
    if (failures.length > 0) {
      this.cleanupFailures.set(root, failures);
      return false;
    }
    try {
      await this.removeRoot(root);
      this.ownedRoots.delete(root);
      this.cleanupFailures.delete(root);
      return true;
    } catch (cause) {
      this.cleanupFailures.set(root, [cause]);
      return false;
    }
  }

  /** Pure parsing; the provider is always available. */
  async inspectAvailability(): Promise<ProviderAvailability> {
    return {
      status: "available",
      code: null,
      reason: null,
      diagnostics: { engine: "static-apk-parsing" },
    };
  }

  private cleanupError(
    root: string,
    operation: string,
    completedObservation?: AnalysisPartialObservation,
  ): ProviderCleanupError {
    const causes = this.cleanupFailures.get(root) ?? [];
    const error = new ProviderCleanupError(
      FLUTTER_PROVIDER_IDENTITY.id,
      [root],
      {
        reason: causes
          .map((cause) =>
            cause instanceof Error ? cause.message : String(cause),
          )
          .join("; "),
        retained_roots: [
          {
            path: root,
            failures: causes.map((cause) => ({
              name: cause instanceof Error ? cause.name : "UnknownError",
              message: cause instanceof Error ? cause.message : String(cause),
              ...(cause instanceof Error &&
              "code" in cause &&
              typeof cause.code === "string"
                ? { code: cause.code }
                : {}),
            })),
          },
        ],
      },
      {
        cause: new AggregateError(causes, "Flutter snapshot cleanup failed"),
        operation,
        ...(completedObservation === undefined ? {} : { completedObservation }),
      },
    );
    const lease = this.rootLeases.get(root);
    if (lease !== undefined) new AnalysisCleanupLeaseGroup(error, [lease]);
    return error;
  }

  private withCleanup(
    primary: AnalysisError,
    cleanup: AnalysisError,
    operation: string,
  ): AnalysisError {
    return analysisErrorWithCleanupFailure(
      primary,
      cleanup,
      operation,
    ).bindCleanupDependencies([primary, cleanup]);
  }

  /** Stop admission and drain active snapshots before attempting retained cleanup. */
  async close(): Promise<void> {
    await this.operations.close();
  }

  private async closeRoots(
    roots = [...this.ownedRoots.keys()],
    operation = "close_flutter_build",
  ): Promise<void> {
    const failures: AnalysisError[] = [];
    for (const root of roots) {
      if (!(await this.discardRoot(root)))
        failures.push(this.cleanupError(root, operation));
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new ProviderCleanupError(
        FLUTTER_PROVIDER_IDENTITY.id,
        failures.flatMap((failure) => failure.cleanupResources),
        {
          reason: failures
            .map((failure) => failure.diagnostics?.reason ?? failure.message)
            .join("; "),
          retained_roots: failures.flatMap((failure) => {
            const roots = failure.diagnostics?.retained_roots;
            return Array.isArray(roots) ? roots : [];
          }),
        },
        {
          cause: new AggregateError(failures),
          operation,
        },
      ).bindCleanupDependencies(failures);
  }

  async execute(
    request: FlutterRequest,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    try {
      return await this.operations.run(() =>
        this.executeOwned(request, options),
      );
    } catch (cause) {
      return err(mapOwnedIoFailure(request.operation, cause, null));
    }
  }

  private async executeOwned(
    request: FlutterRequest,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const cancellation = (): AnalysisCancelledError | undefined =>
      options?.signal?.aborted === true
        ? new AnalysisCancelledError(request.operation, {
            cause: options.signal.reason,
          })
        : undefined;
    const beforeCleanup = cancellation();
    if (beforeCleanup !== undefined) return err(beforeCleanup);
    // Only failed roots are safe to retry here: concurrent admitted snapshots
    // retain their own live resources until their operations finish.
    try {
      await this.closeRoots(
        [...this.cleanupFailures.keys()],
        request.operation,
      );
    } catch (cause) {
      return err(mapOwnedIoFailure(request.operation, cause, null));
    }
    const afterCleanup = cancellation();
    if (afterCleanup !== undefined) return err(afterCleanup);
    const { path } = request.input;
    const signal = options?.signal;
    let snapshot: OwnedSnapshot | undefined;
    let result: Result<AnalysisExecution, AnalysisError>;
    try {
      snapshot = await this.ownSnapshot(request.operation, path, signal);
      const reader = this.readerFor(snapshot);
      const libraries = await collectFlutterLibraries(
        reader,
        request.operation,
        path,
        signal,
      );
      result =
        request.operation === "inspect_dart_aot"
          ? await this.inspectDartAot(
              path,
              request.input.abi,
              signal,
              snapshot,
              reader,
              libraries,
            )
          : await this.identifyFlutterBuild(
              path,
              signal,
              snapshot,
              reader,
              libraries,
            );
    } catch (cause) {
      result = err(
        mapOwnedIoFailure(request.operation, cause, snapshot?.root ?? null),
      );
    }
    const cleanup =
      snapshot !== undefined && !(await this.discardRoot(snapshot.root))
        ? this.cleanupError(
            snapshot.root,
            request.operation,
            result.ok
              ? createAnalysisExecutionEvidence(
                  request.operation,
                  request.input,
                  result.value,
                  "observed",
                )
              : undefined,
          )
        : undefined;
    // Cancellation observed after the awaited snapshot removal still keeps
    // the completed facts, composed exactly as the uncancelled Evidence.
    if (signal?.aborted === true && result.ok) {
      result = err(
        new AnalysisCancelledError(request.operation, {
          cause: signal.reason,
          partialObservation: createAnalysisExecutionEvidence(
            request.operation,
            request.input,
            result.value,
            "observed",
          ),
        }),
      );
    }
    if (cleanup !== undefined) {
      if (!result.ok)
        return err(this.withCleanup(result.error, cleanup, request.operation));
      cleanup.retainPartialObservation(
        createAnalysisExecutionEvidence(
          request.operation,
          request.input,
          result.value,
          "observed",
        ),
      );
      return err(cleanup);
    }
    return result;
  }

  private async identifyFlutterBuild(
    path: string,
    signal: AbortSignal | undefined,
    snapshot: OwnedSnapshot,
    reader: ZipArtifactReader,
    flutterEntries: readonly FlutterLibrary[],
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const operation = "identify_flutter_build";
    for (const { entry } of flutterEntries) {
      if (entry.declaredSize !== null && entry.declaredSize > LIBRARY_MAX_BYTES)
        return err(
          new AnalysisResourceConstraintError(
            operation,
            "file-size",
            `${entry.path} exceeds the library read budget`,
            { max_library_bytes: LIBRARY_MAX_BYTES, entry_path: entry.path },
            flutterBudget("the Flutter library read allowance", "input"),
          ),
        );
    }
    // Preflight: refuse before any I/O when the declared entry sizes
    // already exceed the cumulative budget, even though streaming might
    // discover smaller actual sizes.
    const declaredTotal = flutterEntries.reduce(
      (total, { entry }) => total + (entry.declaredSize ?? 0),
      0,
    );
    if (declaredTotal > TOTAL_EXTRACTION_MAX_BYTES)
      return err(
        new AnalysisResourceConstraintError(
          operation,
          "file-size",
          `declared library sizes total ${String(declaredTotal)} bytes, exceeding the ${String(TOTAL_EXTRACTION_MAX_BYTES)}-byte cumulative budget before any extraction`,
          {
            max_total_bytes: TOTAL_EXTRACTION_MAX_BYTES,
            declared_total: declaredTotal,
          },
          flutterBudget("the Flutter cumulative extraction allowance", "input"),
        ),
      );

    const facts = new Map<string, LibraryFacts>();
    let extractedTotal = 0;
    let libraryIndex = 0;
    for (const { entry, abi, kind } of flutterEntries) {
      const stream = openEntrySafely(reader, entry, operation, path, signal);
      const hash = createHash("sha256");
      const snapshotScanner = new SnapshotHashScanner();
      const labeledScanner = new LabeledStringScanner();
      const engineFile =
        kind === "libflutter"
          ? this.ownResource(
              snapshot.root,
              new OwnedFileHandle(
                await openFile(
                  join(snapshot.root, `engine-${libraryIndex++}.so`),
                  "wx+",
                ),
              ),
            )
          : null;
      let bytes = 0;
      const headerPrefix = Buffer.alloc(ELF_HEADER_MAX_BYTES);
      let headerBytes = 0;
      for await (const chunk of stream) {
        if (signal?.aborted === true)
          return err(
            new AnalysisCancelledError(operation, {
              cause: signal.reason,
            }),
          );
        const view = chunk as Buffer;
        headerBytes += view.copy(
          headerPrefix,
          headerBytes,
          0,
          Math.min(view.length, headerPrefix.length - headerBytes),
        );
        bytes += view.byteLength;
        if (bytes > LIBRARY_MAX_BYTES)
          return err(
            new AnalysisResourceConstraintError(
              operation,
              "file-size",
              `${entry.path} exceeds the ${String(LIBRARY_MAX_BYTES)}-byte read budget while streaming`,
              {
                max_library_bytes: LIBRARY_MAX_BYTES,
                entry_path: entry.path,
              },
              flutterBudget("the Flutter library read allowance", "input"),
            ),
          );
        hash.update(view);
        if (kind === "libapp") snapshotScanner.push(view);
        else {
          labeledScanner.push(view);
          await engineFile!.handle.writeFile(view);
        }
        // Enforce the cumulative cap inside the chunk loop so refusal
        // happens before the remaining bytes are streamed and hashed.
        if (extractedTotal + bytes > TOTAL_EXTRACTION_MAX_BYTES)
          return err(
            new AnalysisResourceConstraintError(
              operation,
              "file-size",
              `cumulative library extraction across ${String(flutterEntries.length)} entries exceeds the ${String(TOTAL_EXTRACTION_MAX_BYTES)}-byte budget`,
              { max_total_bytes: TOTAL_EXTRACTION_MAX_BYTES },
              flutterBudget(
                "the Flutter cumulative extraction allowance",
                "input",
              ),
            ),
          );
      }
      extractedTotal += bytes;
      const digest = hash.digest("hex");
      const current = facts.get(abi) ?? emptyFacts();
      if (kind === "libapp") {
        const scan = snapshotScanner.result();
        if (scan.capped)
          return err(
            new AnalysisResourceConstraintError(
              operation,
              "memory",
              "Snapshot hash candidates exceed the retained evidence budget",
              {
                max_snapshot_hash_candidates: MAX_SNAPSHOT_HASH_CANDIDATES,
                entry_path: entry.path,
              },
              flutterBudget(
                "The Flutter snapshot-hash candidate allowance",
                "parser",
              ),
            ),
          );
        facts.set(abi, {
          ...current,
          libapp: {
            present: true,
            bytes,
            sha256: digest,
            elfHeaderValid:
              readElfHeader(headerPrefix.subarray(0, headerBytes), bytes)
                .header !== undefined,
            sources: scan.sources,
            candidates: scan.candidates,
          },
        });
      } else {
        const labeled = labeledScanner.result();
        const buildIds = await readElfBuildIds(
          engineFile!.handle,
          bytes,
          signal,
        );
        await this.releaseResource(snapshot.root, engineFile!);
        facts.set(abi, {
          ...current,
          libflutter: {
            present: true,
            bytes,
            sha256: digest,
            buildId:
              buildIds.failures.length === 0 && buildIds.candidates.length === 1
                ? buildIds.candidates[0]!
                : null,
            buildIdCandidates: buildIds.candidates,
            buildIdFailures: buildIds.failures.map((failure) => failure.reason),
            ...labeled,
          },
        });
      }
    }
    const abis = [...facts.entries()]
      .map(([abi, value]) => ({
        abi,
        libapp: {
          present: value.libapp.present,
          bytes: value.libapp.bytes,
          sha256: value.libapp.sha256,
          elf_header_valid: value.libapp.elfHeaderValid,
          snapshot_hash_sources: value.libapp.sources,
          snapshot_hash_candidates: [...value.libapp.candidates],
          snapshot_hash:
            value.libapp.candidates.length === 1
              ? value.libapp.candidates[0]!
              : null,
        },
        libflutter: {
          present: value.libflutter.present,
          bytes: value.libflutter.bytes,
          sha256: value.libflutter.sha256,
          build_id: value.libflutter.buildId,
          build_id_candidates: [...value.libflutter.buildIdCandidates],
          dart_version: value.libflutter.dartVersion,
          dart_version_capped: value.libflutter.dartVersionCapped,
          toolchain_lines: [...value.libflutter.toolchainLines],
          toolchain_capped: value.libflutter.toolchainCapped,
        },
      }))
      .sort((left, right) => compareUnicodeCodePoints(left.abi, right.abi));
    const flutterDetected = abis.some((entry) => entry.libapp.present);
    const partial =
      abis.some(
        (entry) =>
          (entry.libapp.present &&
            (entry.libapp.snapshot_hash === null ||
              entry.libapp.snapshot_hash_sources !== 2 ||
              entry.libapp.elf_header_valid !== true)) ||
          entry.libflutter.toolchain_capped ||
          entry.libflutter.dart_version_capped ||
          entry.libapp.present !== entry.libflutter.present,
      ) ||
      [...facts.values()].some(
        (value) =>
          value.libflutter.buildIdFailures.length > 0 ||
          value.libflutter.buildIdCandidates.length > 1,
      );
    return ok(
      createAnalysisExecution(
        {
          target: { path, bytes: snapshot.bytes, sha256: snapshot.sha256 },
          flutter_detected: flutterDetected,
          abis,
          coverage: partial ? "partial" : "complete",
        },
        FLUTTER_PROVIDER_IDENTITY,
        {
          subject: { path, format: "apk", sha256: snapshot.sha256 },
          locations: [{ kind: "artifact-path", path }],
          limitations: [
            "The APK is read through an owned read-only snapshot; concurrent changes to the original cannot mix into this observation",
            "The snapshot hash identifies a Dart SDK build only against an external mapping dataset; REA performs no lookup",
            "Release engine builds often carry no labeled Dart version string; absence is reported, not guessed",
            "Engine build IDs come only from ELF-declared PT_NOTE/SHT_NOTE records; conflicting or incompletely examined notes preserve candidates and report partial coverage",
            ...[...facts].flatMap(([abi, value]) => [
              ...value.libflutter.buildIdFailures.map(
                (reason) => `lib/${abi}/libflutter.so: ${reason}`,
              ),
              ...(value.libflutter.buildIdCandidates.length > 1
                ? [`lib/${abi}/libflutter.so has conflicting GNU build IDs`]
                : []),
            ]),
            ...abis
              .filter((entry) => entry.libflutter.toolchain_capped)
              .map(
                (entry) =>
                  `lib/${entry.abi}/libflutter.so has toolchain labels omitted by the complete-label grammar or the 4-line projection`,
              ),
            ...abis
              .filter((entry) => entry.libflutter.dart_version_capped)
              .map(
                (entry) =>
                  `lib/${entry.abi}/libflutter.so has Dart version labels omitted by the complete-label grammar or the single-version projection`,
              ),
            "The snapshot hash sits 20 bytes after each snapshot magic in the AOT payload; findings are observations of that layout",
            "ELF header validity checks the supported header layout and declared table extents; identification does not resolve symbols or validate table contents",
            ...abis
              .filter(
                (entry) =>
                  entry.libapp.present &&
                  entry.libapp.snapshot_hash_sources !== 2,
              )
              .map(
                (entry) =>
                  `lib/${entry.abi}/libapp.so carries ${String(entry.libapp.snapshot_hash_sources)} observed snapshot header(s); complete coverage of the supported legacy split VM/isolate profile requires two independent sources. Unified and other layouts remain unverified`,
              ),
            ...abis
              .filter(
                (entry) =>
                  entry.libapp.present &&
                  entry.libapp.elf_header_valid !== true,
              )
              .map(
                (entry) =>
                  `lib/${entry.abi}/libapp.so has a truncated, malformed, or unsupported ELF header or table extent; byte-scanned hashes remain observations only`,
              ),
            ...(flutterDetected
              ? []
              : [
                  "No lib/*/libapp.so was found; the target does not carry a Flutter AOT payload",
                ]),
          ],
        },
      ),
    );
  }

  private async inspectDartAot(
    path: string,
    abi: string | undefined,
    signal: AbortSignal | undefined,
    snapshot: OwnedSnapshot,
    reader: ZipArtifactReader,
    libraries: readonly FlutterLibrary[],
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const candidates = libraries.filter((library) => library.kind === "libapp");
    if (candidates.length === 0)
      return err(
        new AnalysisUnsupportedTargetError(
          "inspect_dart_aot",
          path,
          "No lib/<abi>/libapp.so was found; the target carries no Dart AOT payload",
        ),
      );
    const preference = ["arm64-v8a", "x86_64", "x86", "armeabi-v7a"];
    const selected =
      abi === undefined
        ? [...candidates].sort(
            (left, right) =>
              (preference.indexOf(left.abi) + 1 || preference.length + 1) -
                (preference.indexOf(right.abi) + 1 || preference.length + 1) ||
              compareUnicodeCodePoints(left.abi, right.abi),
          )[0]!
        : candidates.find((candidate) => candidate.abi === abi);
    if (selected === undefined)
      return err(
        new AnalysisUnsupportedTargetError(
          "inspect_dart_aot",
          path,
          `No libapp.so was found for ABI ${abi ?? "(none)"}; available: ${candidates
            .map((candidate) => candidate.abi)
            .join(", ")}`,
        ),
      );
    const declared = selected.entry.declaredSize ?? LIBRARY_MAX_BYTES + 1;
    if (declared > LIBRARY_MAX_BYTES)
      return err(
        new AnalysisResourceConstraintError(
          "inspect_dart_aot",
          "file-size",
          `lib/${selected.abi}/libapp.so declares ${String(declared)} bytes, exceeding the ${String(LIBRARY_MAX_BYTES)}-byte read budget`,
          { max_library_bytes: LIBRARY_MAX_BYTES },
          flutterBudget("the Flutter library read allowance", "input"),
        ),
      );
    const imagePath = join(snapshot.root, "libapp.so");
    const imageHash = createHash("sha256");
    const imageWriter = this.ownResource(
      snapshot.root,
      new OwnedFileHandle(await openFile(imagePath, "wx")),
    );
    {
      const stream = openEntrySafely(
        reader,
        selected.entry,
        "inspect_dart_aot",
        path,
        signal,
      );
      let total = 0;
      for await (const chunk of stream) {
        if (signal?.aborted === true)
          return err(new AnalysisCancelledError("inspect_dart_aot"));
        const view = chunk as Buffer;
        total += view.byteLength;
        if (total > LIBRARY_MAX_BYTES)
          return err(
            new AnalysisResourceConstraintError(
              "inspect_dart_aot",
              "file-size",
              `lib/${selected.abi}/libapp.so exceeds the ${String(LIBRARY_MAX_BYTES)}-byte read budget while streaming`,
              { max_library_bytes: LIBRARY_MAX_BYTES },
              flutterBudget("the Flutter library read allowance", "input"),
            ),
          );
        imageHash.update(view);
        await imageWriter.handle.writeFile(view);
      }
    }
    await this.releaseResource(snapshot.root, imageWriter);
    const imageSha256 = imageHash.digest("hex");
    // Allocate exactly the budget-checked size before reading, so the
    // buffer cannot exceed the declared library size plus one byte.
    const image = Buffer.alloc(declared + 1);
    let imageLength = 0;
    {
      const file = this.ownResource(
        snapshot.root,
        new OwnedFileHandle(await openFile(imagePath, "r")),
      );
      while (imageLength < image.length) {
        if (signal?.aborted === true)
          return err(new AnalysisCancelledError("inspect_dart_aot"));
        const result = await file.handle.read(
          image,
          imageLength,
          image.length - imageLength,
          null,
        );
        signal?.throwIfAborted();
        if (result.bytesRead === 0) break;
        imageLength += result.bytesRead;
      }
      await this.releaseResource(snapshot.root, file);
    }
    signal?.throwIfAborted();
    const bounded = image.subarray(0, imageLength);
    const symbolNames = [
      "_kDartVmSnapshotData",
      "_kDartVmSnapshotInstructions",
      "_kDartIsolateSnapshotData",
      "_kDartIsolateSnapshotInstructions",
    ];
    const sections: {
      name: string;
      offset: number;
      size: number;
      magic_valid: boolean;
      kind: number | null;
      header_length: number | null;
    }[] = [];
    const dataHeaders: {
      name: string;
      offset: number;
      size: number;
      header: ReturnType<typeof readSnapshotHeader>;
    }[] = [];
    let isolateData: Buffer | null = null;
    const inventory = await readElfSymbols(bounded, symbolNames, signal);
    for (const symbol of inventory.symbols) {
      const name = symbol.name;
      const header = name.endsWith("Data")
        ? readSnapshotHeader(
            bounded.subarray(symbol.offset, symbol.offset + symbol.size),
            0,
          )
        : null;
      sections.push({
        name,
        offset: symbol.offset,
        size: symbol.size,
        magic_valid: header?.magicValid ?? false,
        kind: header?.kind ?? null,
        header_length: header?.headerLength ?? null,
      });
      if (header !== null) dataHeaders.push({ ...symbol, header });
      if (name === "_kDartIsolateSnapshotData")
        isolateData = image.subarray(
          symbol.offset,
          symbol.offset + symbol.size,
        );
    }
    // Each exported data symbol owns one header at its start. Matching
    // records elsewhere in a symbol are not evidence for the other
    // symbol's hash. Count a physical header only once for aliased exports.
    const observedOffsets = new Set<number>();
    let aliasedDataSymbols = false;
    const hashes: string[] = [];
    for (const section of dataHeaders) {
      if (observedOffsets.has(section.offset)) {
        aliasedDataSymbols = true;
        continue;
      }
      observedOffsets.add(section.offset);
      if (section.header.hash !== null) hashes.push(section.header.hash);
    }
    const hashScan = {
      sources: hashes.length,
      candidates: [...new Set(hashes)],
    };
    const overlappingDataSymbols = dataHeaders.some((section, index) =>
      dataHeaders
        .slice(0, index)
        .some(
          (previous) =>
            previous.offset < section.offset + section.size &&
            section.offset < previous.offset + previous.size,
        ),
    );
    if (sections.length === 0) {
      // This is a profile diagnostic, not aliases for the split data sources.
      // Probe only after the legacy selection fails, leaving its normal path
      // and two-source completeness rule unchanged.
      const unified = await readElfSymbols(
        bounded,
        ["_kDartSnapshotData", "_kDartSnapshotText"],
        signal,
      );
      if (unified.symbols.length > 0)
        return err(
          new AnalysisUnsupportedTargetError(
            "inspect_dart_aot",
            path,
            "Observed unified Dart snapshot exports; this reader supports the legacy split VM/isolate profile (Dart 2.14 FullAOT kind 3). The unified profile is unsupported, not missing legacy data",
            {
              diagnostics: {
                supported_profile: "dart-2.14-split-full-aot",
                observed_exports: unified.symbols.map(
                  ({ name, offset, size }) => ({ name, offset, size }),
                ),
                abi: selected.abi,
                libapp_sha256: imageSha256,
                libapp_bytes: imageLength,
              },
            },
          ),
        );
      return err(
        new AnalysisUnsupportedTargetError(
          "inspect_dart_aot",
          path,
          `No recognizable legacy split Dart snapshot symbols were found: ${inventory.failures.map((failure) => failure.reason).join("; ")}`,
        ),
      );
    }
    const pool = await projectStringPool(isolateData, signal);
    const snapshotPartial =
      inventory.failures.length > 0 ||
      aliasedDataSymbols ||
      overlappingDataSymbols ||
      sections.length < symbolNames.length ||
      dataHeaders.length !== SYMBOL_PAIR_COUNT ||
      dataHeaders.some((section) => !section.header.complete) ||
      hashScan.candidates.length !== 1 ||
      hashScan.sources !== SYMBOL_PAIR_COUNT;
    const poolPartial =
      isolateData === null ||
      pool.collectionCapped ||
      pool.packageUriCount > MAX_POOL_URIS ||
      pool.dartUriCount > MAX_POOL_URIS ||
      pool.classLikeTokenCount > MAX_POOL_TOKENS;
    return ok(
      createAnalysisExecution(
        {
          target: { path, bytes: snapshot.bytes, sha256: snapshot.sha256 },
          abi: selected.abi,
          libapp: {
            coverage: snapshotPartial ? "partial" : "complete",
            bytes: imageLength,
            sha256: imageSha256,
            snapshot_hash:
              hashScan.candidates.length === 1 ? hashScan.candidates[0]! : null,
            snapshot_hash_candidates: [...hashScan.candidates],
            snapshot_hash_sources: hashScan.sources,
            sections,
          },
          string_pool: {
            coverage: poolPartial ? "partial" : "complete",
            package_uris: pool.packageUris.slice(0, MAX_POOL_URIS),
            package_uri_count_at_least: pool.packageUriCount,
            dart_uris: pool.dartUris.slice(0, MAX_POOL_URIS),
            dart_uri_count_at_least: pool.dartUriCount,
            class_like_tokens: pool.classLikeTokens.slice(0, MAX_POOL_TOKENS),
            class_like_token_count_at_least: pool.classLikeTokenCount,
            printable_run_count: pool.printableRunCount,
          },
          coverage: snapshotPartial || poolPartial ? "partial" : "complete",
        },
        FLUTTER_PROVIDER_IDENTITY,
        {
          subject: { path, format: "apk", sha256: snapshot.sha256 },
          locations: [{ kind: "artifact-path", path }],
          limitations: [
            "The APK is read through an owned read-only snapshot; concurrent changes to the original cannot mix into this observation",
            "Snapshot sections are located through the ELF dynamic symbol table; a payload without exported snapshot symbols is refused rather than guessed",
            "Snapshot hash sources are the headers at the start of the VM and isolate data symbols; complete decoding supports kind 3 (the Dart 2.14 FullAOT layout), a valid hash and a declared length that fits its symbol, including the four magic bytes; other kind values remain observed with partial coverage",
            "String-pool entries are byte-pattern observations from the isolate data section, not deserialized cluster semantics; typed class and function recovery needs an SDK-specific parser",
            "class_like_tokens are identifier-shaped runs and include incidental matches",
            "string-pool counts are lower bounds: collection stops at twice each projection bound, and any value beyond that is counted only through the capped flag",
            ...inventory.failures.map((failure) => failure.reason),
            ...(sections.length < symbolNames.length
              ? [
                  `Only ${String(sections.length)} of 4 snapshot symbols were present`,
                ]
              : []),
            ...(aliasedDataSymbols
              ? [
                  "Two or more snapshot data symbols share one header offset; its hash counts as one source instead of two agreeing ones",
                ]
              : []),
            ...(overlappingDataSymbols && !aliasedDataSymbols
              ? [
                  "Snapshot data symbol ranges overlap; independent VM/isolate coverage is not established",
                ]
              : []),
            ...dataHeaders
              .filter((section) => !section.header.complete)
              .map(
                (section) =>
                  `${section.name} has an incomplete or invalid snapshot header: kind ${String(section.header.kind)} (AOT app requires 3), declared length ${String(section.header.headerLength)} excludes the four magic bytes, symbol size ${String(section.size)}, valid hash ${String(section.header.hash !== null)}`,
              ),
            ...(pool.collectionCapped
              ? [
                  "String-pool collection or printable-run capacity was exceeded; counts are lower bounds and overflowed runs are omitted",
                ]
              : []),
            ...(pool.dartUriCount > MAX_POOL_URIS
              ? [
                  `dart_uris reports ${String(MAX_POOL_URIS)} of at least ${String(pool.dartUriCount)} distinct URIs`,
                ]
              : []),
            ...(pool.packageUriCount > MAX_POOL_URIS
              ? [
                  `package_uris reports ${String(MAX_POOL_URIS)} of at least ${String(pool.packageUriCount)} distinct URIs`,
                ]
              : []),
            ...(pool.classLikeTokenCount > MAX_POOL_TOKENS
              ? [
                  `class_like_tokens reports ${String(MAX_POOL_TOKENS)} of at least ${String(pool.classLikeTokenCount)} distinct tokens`,
                ]
              : []),
          ],
        },
      ),
    );
  }
}

/**
 * Categorize printable runs from one snapshot data section. Collection stops
 * admitting new distinct entries once each category reaches its projection
 * bound times a slack factor, so allocation and sorting stay proportional to
 * the response rather than to an adversarial payload; counts still reflect
 * how far scanning proceeded before the collection cap tripped.
 */
const projectStringPool = async (
  section: Buffer | null,
  signal: AbortSignal | undefined,
): Promise<{
  packageUris: string[];
  packageUriCount: number;
  dartUris: string[];
  dartUriCount: number;
  classLikeTokens: string[];
  classLikeTokenCount: number;
  printableRunCount: number;
  collectionCapped: boolean;
}> => {
  const packages = new Set<string>();
  const darts = new Set<string>();
  const tokens = new Set<string>();
  let runCount = 0;
  let collectionCapped = false;
  const COLLECTION_SLACK = 2;
  /** One printable run never materializes beyond this length. */
  const MAX_RUN_BYTES = 1024;
  const packageBudget = MAX_POOL_URIS * COLLECTION_SLACK;
  const dartBudget = MAX_POOL_URIS * COLLECTION_SLACK;
  const tokenBudget = MAX_POOL_TOKENS * COLLECTION_SLACK;
  if (section !== null) {
    let run = "";
    const consider = (text: string): void => {
      if (text.length < 5) return;
      runCount += 1;
      if (text.startsWith("package:")) {
        if (!packages.has(text) && packages.size >= packageBudget)
          collectionCapped = true;
        else packages.add(text);
      } else if (text.startsWith("dart:")) {
        if (!darts.has(text) && darts.size >= dartBudget)
          collectionCapped = true;
        else darts.add(text);
      } else if (
        text.length <= 128 &&
        text.length >= 5 &&
        IDENTIFIER_PATTERN.test(text)
      ) {
        if (!tokens.has(text) && tokens.size >= tokenBudget)
          collectionCapped = true;
        else tokens.add(text);
      }
    };
    let overflowed = false;
    for (let start = 0; start < section.length; start += 64 * 1024) {
      await yieldToEventLoop();
      signal?.throwIfAborted();
      for (const byte of section.subarray(start, start + 64 * 1024)) {
        if (byte >= 0x20 && byte < 0x7f) {
          // A single unbounded run (an adversarial NUL-free section) never
          // materializes: growth stops at the cap and the entire run is
          // discarded at its delimiter, since a truncated prefix would be
          // fabricated evidence rather than an observation.
          if (run.length < MAX_RUN_BYTES) run += String.fromCharCode(byte);
          else {
            overflowed = true;
            collectionCapped = true;
          }
        } else {
          if (!overflowed) consider(run);
          overflowed = false;
          run = "";
        }
      }
    }
    if (!overflowed) consider(run);
  }
  signal?.throwIfAborted();
  return {
    packageUris: [...packages].sort(),
    packageUriCount: packages.size,
    dartUris: [...darts].sort(),
    dartUriCount: darts.size,
    classLikeTokens: [...tokens].sort(),
    classLikeTokenCount: tokens.size,
    printableRunCount: runCount,
    collectionCapped,
  };
};

import type { RegularFileState } from "../filesystem/RegularFile.js";
import {
  RegularFileChangedError,
  sameRegularFileState,
  RegularFileOperationCancelled,
} from "../filesystem/RegularFile.js";
import { KunaDocumentError } from "./KunaDocumentError.js";
import { assertKunaFileState } from "./KunaProjectState.js";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";

import { AnalysisError } from "../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import {
  AnalysisCancelledError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { err, ok, type Result } from "../domain/result.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import { readFileHandleRange } from "../filesystem/readFileHandleRange.js";
import {
  RegularFileCancelled,
  RegularFileCleanupFailure,
  OwnedRegularFileOperationFailure,
  withOwnedFileHandle,
} from "../filesystem/OwnedRegularFile.js";
import { ABORTED, waitForAbortable } from "../process/AbortablePromise.js";
import type { KunaProject } from "./KunaProjectCache.js";
import {
  scanKunaAssembly,
  type KunaAssemblyIndex,
  type KunaProjectFunction,
} from "./KunaProjectFiles.js";
import { KUNA_PROVIDER_ID } from "./KunaRelease.js";
import { KUNA_FUNCTION_TEXT_BYTES } from "./KunaLimits.js";
import { kunaUnavailable } from "./KunaUnavailable.js";

/** The exact producing range for one facet, including a failed C block. */
export interface KunaProjectFileSpan {
  readonly facet: "pseudocode" | "assembly";
  readonly path: string;
  readonly byteOffset: number;
  readonly byteLength: number;
}

export interface KunaProjectText {
  readonly result: string | null;
  readonly files?: readonly KunaProjectFileSpan[];
  readonly limitations: readonly string[];
}

/** Session scope that adopts a span descriptor before the read opens it. */
export interface KunaSpanOwnership {
  readonly retainFailedClose?: (path: string, owner: OwnedFileHandle) => void;
  readonly bindSpanCleanup?: (
    owner: OwnedFileHandle,
    marker: ProviderCleanupError,
  ) => void;
  /**
   * Check retained cleanup and open one descriptor. The session holds this
   * together with finishSpan so a failed close is retained before the next open.
   */
  readonly admitSpan?: <T>(
    operation: string,
    signal: AbortSignal | undefined,
    open: () => Promise<T>,
  ) => Promise<Result<T, AnalysisError>>;
  /** Close one admitted descriptor before another span may open. */
  readonly finishSpan?: <T>(finish: () => Promise<T>) => Promise<T>;
}

const readSpan = async (
  operation: string,
  path: string,
  expected: RegularFileState,
  offset: number,
  length: number,
  ownership: KunaSpanOwnership,
  signal?: AbortSignal,
): Promise<Result<string, AnalysisError>> => {
  if (length > KUNA_FUNCTION_TEXT_BYTES)
    return err(
      new AnalysisResourceConstraintError(
        operation,
        "capacity",
        "Kuna's function text exceeds the buffered source-facet capacity; the complete export remains accessible locally.",
        {
          limit_bytes: KUNA_FUNCTION_TEXT_BYTES,
          requested_bytes: length,
          file: path,
          byte_offset: offset,
        },
      ),
    );
  const callerAborted = (): AbortSignal | undefined =>
    signal?.aborted === true ? signal : undefined;
  const cancelled = callerAborted();
  if (cancelled !== undefined)
    return err(
      new AnalysisCancelledError(operation, { cause: cancelled.reason }),
    );
  const opened =
    ownership.admitSpan === undefined
      ? ok(await open(path, "r"))
      : await ownership.admitSpan(operation, signal, () => open(path, "r"));
  if (!opened.ok) return opened;
  const owner = new OwnedFileHandle(opened.value);
  let read: Result<string, unknown>;
  let spanCancellation: AnalysisCancelledError | undefined;
  try {
    if (!sameRegularFileState(expected, await owner.handle.stat()))
      throw new RegularFileChangedError(path);
    const buffer = await readFileHandleRange(
      owner.handle,
      offset,
      length,
      (bytesRead) => {
        // Preserve a fully acquired span for owned finalization, which records
        // cancellation alongside its text if descriptor cleanup fails.
        if (bytesRead < length && signal?.aborted)
          throw (spanCancellation = new AnalysisCancelledError(operation, {
            cause: signal.reason,
          }));
      },
    );
    if (buffer.length !== length)
      throw new KunaDocumentError("span_short", { path });
    if (!sameRegularFileState(expected, await owner.handle.stat()))
      throw new RegularFileChangedError(path);
    await assertKunaFileState(path, expected);
    read = ok(buffer.toString("utf8"));
  } catch (cause: unknown) {
    read = err(cause);
  }
  const finish = () =>
    withOwnedFileHandle(
      path,
      owner,
      {
        // A failed read keeps its own diagnostic. A completed read records
        // cancellation when the caller aborts before the queued close settles.
        ...(read.ok && signal !== undefined ? { signal } : {}),
        ...(ownership.retainFailedClose === undefined
          ? {}
          : {
              retainFailedClose: (failed) =>
                ownership.retainFailedClose?.(path, failed),
            }),
      },
      async () => {
        if (
          !read.ok &&
          spanCancellation !== undefined &&
          read.error === spanCancellation
        )
          throw read.error;
        if (!read.ok) throw new OwnedRegularFileOperationFailure(read.error);
        return read.value;
      },
    );
  try {
    const value =
      ownership.finishSpan === undefined
        ? await finish()
        : await ownership.finishSpan(finish);
    return ok(value);
  } catch (cause: unknown) {
    if (spanCancellation !== undefined && cause === spanCancellation)
      return err(spanCancellation);
    if (cause instanceof OwnedRegularFileOperationFailure) {
      if (cause.operationCause instanceof RegularFileChangedError)
        throw cause.operationCause;
      return err(
        new ProviderAdapterError(KUNA_PROVIDER_ID, operation, {
          cause: cause.operationCause,
        }),
      );
    }
    if (cause instanceof RegularFileCleanupFailure)
      return err(
        spanCloseFailure(
          operation,
          path,
          offset,
          length,
          spanCloseAfterRead(cause, read, signal),
          ownership,
        ),
      );
    // Close succeeded. The caller's abort reason is the cancellation cause,
    // not the wrapper thrown after that close.
    const aborted = callerAborted();
    if (
      aborted !== undefined &&
      (cause instanceof RegularFileOperationCancelled ||
        cause instanceof RegularFileCancelled)
    )
      return err(
        new AnalysisCancelledError(operation, { cause: aborted.reason }),
      );
    throw cause;
  }
};

/**
 * Finalization checks the signal before replaying a read that already
 * finished. Put that text back on the close failure so cancellation stays
 * the primary error and the descriptor stays retained.
 */
const spanCloseAfterRead = (
  failure: RegularFileCleanupFailure<string>,
  read: Result<string, unknown>,
  signal: AbortSignal | undefined,
): RegularFileCleanupFailure<string> => {
  if (
    failure.completionCancellation !== undefined ||
    !read.ok ||
    signal?.aborted !== true ||
    failure.outcome.kind !== "failed" ||
    !(failure.outcome.cause instanceof RegularFileOperationCancelled)
  )
    return failure;
  return new RegularFileCleanupFailure({
    ...failure,
    outcome: { kind: "completed", value: read.value },
    completionCancellation: { reason: signal.reason },
    operationFailure: undefined,
  });
};

/** Keep the span text or the short-read diagnostic with the exact handle. */
const spanCloseFailure = (
  operation: string,
  path: string,
  offset: number,
  length: number,
  failure: RegularFileCleanupFailure<string>,
  ownership: KunaSpanOwnership,
): AnalysisError => {
  const reason =
    failure.cleanupCause instanceof Error
      ? failure.cleanupCause.message
      : String(failure.cleanupCause);
  const completed = failure.outcome.kind === "completed";
  const marker = new ProviderCleanupError(
    KUNA_PROVIDER_ID,
    [failure.path],
    {
      reason,
      path,
      byte_offset: offset,
      byte_length: length,
      span_read: completed ? "completed" : "failed",
      ...(completed ? { span_text: failure.outcome.value } : {}),
    },
    { operation, cause: failure },
  );
  ownership.bindSpanCleanup?.(failure.owner, marker);
  if (failure.completionCancellation !== undefined)
    return analysisErrorWithCleanupFailure(
      new AnalysisCancelledError(operation, {
        cause: failure.completionCancellation.reason,
      }),
      marker,
      operation,
    ).bindCleanupDependencies([marker]);
  if (failure.outcome.kind !== "failed") return marker;
  const primaryCause = failure.outcome.cause;
  const primary =
    failure.operationFailure === undefined &&
    primaryCause instanceof AnalysisError
      ? primaryCause
      : new ProviderAdapterError(KUNA_PROVIDER_ID, operation, {
          cause: primaryCause,
          userMessage:
            primaryCause instanceof Error
              ? primaryCause.message
              : String(primaryCause),
        });
  return analysisErrorWithCleanupFailure(
    primary,
    marker,
    operation,
  ).bindCleanupDependencies([marker]);
};

/** One immutable export owns both its text ranges and its parsed label indexes. */
export class KunaProjectReader {
  #blocks: ReadonlyMap<string, KunaProjectFunction> | undefined;
  #assembly: Promise<Result<KunaAssemblyIndex, string>> | undefined;

  constructor(
    readonly project: KunaProject,
    readonly lifetime: {
      readonly signal: AbortSignal;
      readonly own: <T>(work: Promise<T>) => Promise<T>;
    } & KunaSpanOwnership,
  ) {}

  async pseudocode(
    address: string,
    operation: string,
    signal?: AbortSignal,
  ): Promise<Result<KunaProjectText, AnalysisError>> {
    await assertKunaFileState(
      join(this.project.directory, this.project.manifest.files.c.path),
      this.project.fileStates.c,
      signal ?? this.lifetime.signal,
    );
    this.#blocks ??= new Map(
      this.project.functions.map((block) => [block.address, block]),
    );
    const block = this.#blocks.get(address);
    if (block === undefined)
      return ok({
        result: null,
        limitations: [
          "Kuna's export decompiles code entries only; this inventory entry, such as an import slot, has no body.",
        ],
      });
    const files = [
      {
        facet: "pseudocode" as const,
        path: this.project.manifest.files.c.path,
        byteOffset: block.cOffset,
        byteLength: block.cLength,
      },
    ];
    if (block.error !== null)
      return ok({
        result: null,
        files,
        limitations: [`Kuna could not decompile this function: ${block.error}`],
      });
    const text = await readSpan(
      operation,
      join(this.project.directory, this.project.manifest.files.c.path),
      this.project.fileStates.c,
      block.cOffset,
      block.cLength,
      this.lifetime,
      signal ?? this.lifetime.signal,
    );
    if (!text.ok) return text;
    return ok({
      result: text.value
        .slice(text.value.indexOf("\n") + 1)
        .replace(/\n+$/u, ""),
      files,
      limitations: [],
    });
  }

  async assembly(
    address: string,
    operation: string,
    signal?: AbortSignal,
  ): Promise<Result<KunaProjectText, AnalysisError>> {
    const index = await this.#index(operation, signal);
    if (!index.ok) return index;
    const span = index.value.code.get(address);
    if (span === undefined)
      return err(
        kunaUnavailable(
          operation,
          `Kuna's export lists no code at ${address}; import slots and data entries have no listing.`,
        ),
      );
    const text = await readSpan(
      operation,
      join(this.project.directory, this.project.manifest.files.asm.path),
      this.project.fileStates.asm,
      span.offset,
      span.length,
      this.lifetime,
      signal ?? this.lifetime.signal,
    );
    if (!text.ok) return text;
    return ok({
      result: text.value.replace(/\n+$/u, ""),
      files: [
        {
          facet: "assembly",
          path: this.project.manifest.files.asm.path,
          byteOffset: span.offset,
          byteLength: span.length,
        },
      ],
      limitations: [],
    });
  }

  async dataName(
    address: string,
    operation: string,
    signal?: AbortSignal,
  ): Promise<Result<string | null, AnalysisError>> {
    const index = await this.#index(operation, signal);
    return index.ok ? ok(index.value.data.get(address) ?? null) : index;
  }

  async #index(
    operation: string,
    signal: AbortSignal | undefined,
  ): Promise<Result<KunaAssemblyIndex, AnalysisError>> {
    const path = join(
      this.project.directory,
      this.project.manifest.files.asm.path,
    );
    await assertKunaFileState(
      path,
      this.project.fileStates.asm,
      signal ?? this.lifetime.signal,
    );
    this.#assembly ??= this.lifetime.own(
      scanKunaAssembly(
        createReadStream(
          join(this.project.directory, this.project.manifest.files.asm.path),
          { signal: this.lifetime.signal },
        ),
      ).then(async (index) => {
        await assertKunaFileState(
          path,
          this.project.fileStates.asm,
          this.lifetime.signal,
        );
        return index;
      }),
    );
    const index = await waitForAbortable(this.#assembly, signal);
    if (index === ABORTED)
      return err(
        new AnalysisCancelledError(operation, { cause: signal?.reason }),
      );
    return index.ok
      ? index
      : err(
          new ProviderAdapterError(KUNA_PROVIDER_ID, operation, {
            userMessage: `Kuna's .asm cannot be indexed: ${index.error}`,
          }),
        );
  }
}

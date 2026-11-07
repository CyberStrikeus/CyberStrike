import type { Dir } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../../artifacts/AnalysisCleanupLease.js";
import {
  ProcessCaptureError,
  describeProcessCaptureExecutionFailure,
} from "./ProcessCaptureError.js";
import { OwnedDirectoryHandle } from "../../filesystem/OwnedDirectoryHandle.js";
import { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";
import {
  RegularFileCancelled,
  RegularFileCleanupFailure,
  withOwnedFileHandle,
  type RegularFileOperationOutcome,
} from "../../filesystem/OwnedRegularFile.js";
import { RegularFileOperationCancelled } from "../../filesystem/RegularFile.js";

/** The capture's existing scope retains exact leases without admitting work. */
export interface ProcessCaptureCleanupRetainer {
  retain(lease: AnalysisCleanupLease): void;
}

type Cancellation = { readonly reason: unknown };

type CloseRetention = RegularFileCleanupFailure["retention"];

/** One physical read outcome plus any exact descriptor owners still unresolved. */
export class ProcessCaptureReadFailure<
  Value = unknown,
> extends ProcessCaptureError {
  readonly path: string;
  readonly outcome: RegularFileOperationOutcome<Value>;
  readonly cleanupLeases: readonly AnalysisCleanupLease[];
  readonly cleanupCause: unknown;
  readonly retention: CloseRetention;
  /** An observed abort is independent of whether cancellation caused the read failure. */
  readonly cancellation: Cancellation | undefined;

  constructor(options: {
    readonly path: string;
    readonly outcome: RegularFileOperationOutcome<Value>;
    readonly cleanupCause?: unknown;
    readonly cleanupLease?: AnalysisCleanupLease;
    readonly retention?: CloseRetention;
    readonly completionCancellation?: Cancellation | undefined;
    readonly signal: AbortSignal | undefined;
  }) {
    const cleanupLeases =
      options.cleanupLease === undefined ? [] : [options.cleanupLease];
    const primaryCancellation =
      options.outcome.kind === "failed"
        ? operationCancellation(options.outcome.cause, options.signal)
        : options.completionCancellation;
    const cancellation =
      primaryCancellation ??
      (options.signal?.aborted === true
        ? { reason: options.signal.reason }
        : undefined);
    const primary =
      primaryCancellation !== undefined
        ? primaryCancellation.reason
        : options.outcome.kind === "failed"
          ? options.outcome.cause
          : options.cleanupCause;
    const cleanupCause = options.cleanupCause;
    const cleanupReason =
      describeProcessCaptureExecutionFailure(cleanupCause) ??
      "descriptor close rejected without a value";
    const reasons = [
      ...(options.outcome.kind === "failed"
        ? [
            describeProcessCaptureExecutionFailure(options.outcome.cause) ??
              "read rejected without a value",
          ]
        : []),
      ...(options.cleanupLease === undefined
        ? []
        : [`descriptor close failed: ${cleanupReason}`]),
    ];
    super(
      `Process capture read failed for ${options.path}${reasons.length === 0 ? "" : `: ${reasons.join("; ")}`}`,
      {
        cause: primary,
        ...(primaryCancellation === undefined
          ? {}
          : {
              userCategory: "cancelled" as const,
              reason: "cancelled" as const,
            }),
        ...(options.cleanupLease === undefined
          ? {}
          : {
              cleanup: {
                reason: cleanupReason,
                resources: options.cleanupLease?.cleanupResources ?? [
                  options.path,
                ],
              },
            }),
      },
    );
    this.path = options.path;
    this.outcome = options.outcome;
    this.cleanupLeases = cleanupLeases;
    this.cleanupCause = cleanupCause;
    this.retention = options.retention ?? { kind: "not_requested" };
    this.cancellation = cancellation;
    if (cleanupLeases.length > 0)
      new AnalysisCleanupLeaseGroup(this, cleanupLeases);
  }
}

const operationCancellation = (
  cause: unknown,
  signal: AbortSignal | undefined,
): Cancellation | undefined => {
  if (cause instanceof RegularFileOperationCancelled)
    return { reason: cause.reason };
  if (
    cause instanceof ProcessCaptureError &&
    cause.userCategory === "cancelled"
  )
    return {
      reason: Object.hasOwn(cause, "cause") ? cause.cause : cause,
    };
  if (
    signal?.aborted === true &&
    (cause === signal.reason ||
      (cause instanceof Error && cause.name === "AbortError"))
  )
    return { reason: signal.reason };
  return undefined;
};

/** Keep an admitted file descriptor, its operation result, and close owner together. */
export const withProcessCaptureFile = async <Value>(
  path: string,
  handle: FileHandle,
  signal: AbortSignal | undefined,
  retainer: ProcessCaptureCleanupRetainer | undefined,
  operation: (file: FileHandle) => Promise<Value>,
): Promise<Value> => {
  const owner = new OwnedFileHandle(handle);
  const cleanupLease = AnalysisCleanupLease.forCloseOwner(owner, path);
  try {
    return await withOwnedFileHandle(
      path,
      owner,
      {
        ...(signal === undefined ? {} : { signal }),
        ...(retainer === undefined
          ? {}
          : { retainFailedClose: () => retainer.retain(cleanupLease) }),
      },
      operation,
    );
  } catch (cause: unknown) {
    if (cause instanceof RegularFileCleanupFailure)
      throw new ProcessCaptureReadFailure({
        path,
        outcome: cause.outcome as RegularFileOperationOutcome<Value>,
        cleanupCause: cause.cleanupCause,
        cleanupLease,
        retention: cause.retention,
        ...(cause.completionCancellation === undefined
          ? {}
          : { completionCancellation: cause.completionCancellation }),
        signal,
      });
    if (cause instanceof RegularFileCancelled)
      throw new ProcessCaptureReadFailure({
        path,
        outcome: cause.outcome,
        completionCancellation: { reason: cause.reason },
        signal,
      });
    throw new ProcessCaptureReadFailure({
      path,
      outcome: { kind: "failed", cause },
      signal,
    });
  }
};

/** Read and close an explicit directory without losing completed entries on close failure. */
export const withProcessCaptureDirectory = async <Value>(
  path: string,
  directory: Dir,
  signal: AbortSignal | undefined,
  retainer: ProcessCaptureCleanupRetainer | undefined,
  operation: (directory: Dir) => Promise<Value>,
): Promise<Value> => {
  const owner = new OwnedDirectoryHandle(directory);
  const cleanupLease = AnalysisCleanupLease.forCloseOwner(owner, path);
  let outcome: RegularFileOperationOutcome<Value>;
  try {
    if (signal?.aborted === true)
      throw new RegularFileOperationCancelled(signal.reason);
    outcome = { kind: "completed", value: await operation(directory) };
  } catch (cause: unknown) {
    outcome = { kind: "failed", cause };
  }

  try {
    await owner.close();
  } catch (cleanupCause: unknown) {
    let retention: CloseRetention = { kind: "not_requested" };
    if (retainer !== undefined) {
      try {
        retainer.retain(cleanupLease);
        retention = { kind: "callback_returned" };
      } catch (cause: unknown) {
        retention = { kind: "callback_threw", cause };
      }
    }
    throw new ProcessCaptureReadFailure({
      path,
      outcome,
      cleanupCause,
      cleanupLease,
      retention,
      ...(outcome.kind === "completed" && signal?.aborted === true
        ? { completionCancellation: { reason: signal.reason } }
        : {}),
      signal,
    });
  }

  if (outcome.kind === "failed") {
    throw new ProcessCaptureReadFailure({
      path,
      outcome,
      signal,
    });
  }
  if (signal?.aborted === true)
    throw new ProcessCaptureReadFailure({
      path,
      outcome,
      completionCancellation: { reason: signal.reason },
      signal,
    });
  return outcome.value;
};

import type { FileHandle } from "node:fs/promises";

import { OwnedFileHandle } from "./OwnedFileHandle.js";
import {
  openRegularFile,
  RegularFileAdmissionFailure,
  assertRegularFileActive,
  RegularFileOperationCancelled,
  type StableRegularFileDescriptor,
} from "./RegularFile.js";

export type RegularFileOperationOutcome<Value> =
  | { readonly kind: "completed"; readonly value: Value }
  | { readonly kind: "failed"; readonly cause: unknown };

type CompletedRegularFileOutcome<Value> = Extract<
  RegularFileOperationOutcome<Value>,
  { readonly kind: "completed" }
>;

/** Physical operation origin kept separate from caller-provided error values. */
export class OwnedRegularFileOperationFailure extends Error {
  readonly _tag: string = "OwnedRegularFileOperationFailure";

  constructor(readonly operationCause: unknown) {
    super("Owned regular-file operation failed", { cause: operationCause });
    this.name = this._tag;
  }
}

/** Cancellation after confirmed close, retaining the completed physical read. */
export class RegularFileCancelled<Value = unknown> extends Error {
  readonly _tag = "RegularFileCancelled";
  readonly outcome: CompletedRegularFileOutcome<Value>;
  readonly reason: unknown;

  constructor(
    readonly path: string,
    readonly owner: OwnedFileHandle,
    completion: {
      readonly outcome: CompletedRegularFileOutcome<Value>;
      readonly reason: unknown;
    },
  ) {
    super(`Regular file operation cancelled after closing ${path}`, {
      cause: completion.reason,
    });
    this.name = this._tag;
    this.outcome = completion.outcome;
    this.reason = completion.reason;
  }
}

/** A failed close transfers its exact descriptor owner and operation outcome. */
export interface RegularFileCleanupFacts<Value = unknown> {
  readonly path: string;
  readonly owner: OwnedFileHandle;
  readonly outcome: RegularFileOperationOutcome<Value>;
  readonly cleanupCause: unknown;
  readonly retention?:
    | { readonly kind: "not_requested" }
    | { readonly kind: "callback_returned" }
    | { readonly kind: "callback_threw"; readonly cause: unknown }
    | undefined;
  readonly completionCancellation?: { readonly reason: unknown } | undefined;
  readonly operationFailure?: OwnedRegularFileOperationFailure | undefined;
}

export class RegularFileCleanupFailure<Value = unknown> extends Error {
  readonly path: string;
  readonly owner: OwnedFileHandle;
  readonly outcome: RegularFileOperationOutcome<Value>;
  readonly cleanupCause: unknown;
  readonly retention: NonNullable<RegularFileCleanupFacts["retention"]>;
  readonly completionCancellation: { readonly reason: unknown } | undefined;
  readonly operationFailure: OwnedRegularFileOperationFailure | undefined;

  constructor(facts: RegularFileCleanupFacts<Value>) {
    const {
      path,
      owner,
      outcome,
      cleanupCause,
      retention = { kind: "not_requested" },
      completionCancellation,
      operationFailure,
    } = facts;
    super(`Regular file cleanup failed for ${path}`, {
      cause: new AggregateError(
        [
          ...(outcome.kind === "failed" ? [outcome.cause] : []),
          cleanupCause,
          ...(retention.kind === "callback_threw" ? [retention.cause] : []),
        ],
        "File operation and cleanup failures",
      ),
    });
    this.name = "RegularFileCleanupFailure";
    this.path = path;
    this.owner = owner;
    this.outcome = outcome;
    this.cleanupCause = cleanupCause;
    this.retention = retention;
    this.completionCancellation = completionCancellation;
    this.operationFailure = operationFailure;
  }
}

export interface OwnedFileOperationOptions {
  readonly signal?: AbortSignal;
  readonly retainFailedClose?: (owner: OwnedFileHandle) => void;
}

/** Read only cancellation facts recorded by the operation or its final close. */
export const regularFileCancellation = (
  cause: unknown,
): { readonly reason: unknown } | undefined => {
  if (
    cause instanceof RegularFileCleanupFailure &&
    cause.operationFailure !== undefined
  )
    return cause.outcome.kind === "completed"
      ? cause.completionCancellation
      : undefined;
  const primary =
    cause instanceof RegularFileCleanupFailure &&
    cause.outcome.kind === "failed"
      ? cause.outcome.cause
      : cause;
  if (
    primary instanceof RegularFileOperationCancelled ||
    primary instanceof RegularFileCancelled
  )
    return { reason: primary.reason };
  return cause instanceof RegularFileCleanupFailure &&
    cause.outcome.kind === "completed"
    ? cause.completionCancellation
    : undefined;
};

export interface OwnedRegularFileOptions extends OwnedFileOperationOptions {
  readonly symlinks?: "follow" | "reject";
}

/** Run an operation while one admitted descriptor and its cleanup owner stay together. */
export const withOwnedRegularFile = async <Value>(
  path: string,
  options: OwnedRegularFileOptions,
  operation: (source: StableRegularFileDescriptor) => Promise<Value>,
): Promise<Value> => {
  const source = await openRegularFile(path, {
    symlinks: options.symlinks ?? "follow",
    signal: options.signal,
  }).catch((cause: unknown) => {
    if (!(cause instanceof RegularFileAdmissionFailure)) throw cause;
    const retention = retainOwner(options.retainFailedClose, cause.owner);
    throw new RegularFileCleanupFailure({
      path,
      owner: cause.owner,
      outcome: { kind: "failed", cause: cause.cause },
      cleanupCause: cause.cleanupCause,
      retention,
    });
  });
  return withOwnedFileHandle(
    path,
    new OwnedFileHandle(source.handle),
    options,
    () => operation(source),
  );
};

/** Own an already admitted descriptor through its operation and final close. */
export const withOwnedFileHandle = async <Value>(
  path: string,
  owner: OwnedFileHandle,
  options: OwnedFileOperationOptions,
  operation: (handle: FileHandle) => Promise<Value>,
): Promise<Value> => {
  const handle = owner.handle;
  let outcome: RegularFileOperationOutcome<Value>;
  try {
    assertRegularFileActive(options.signal);
    outcome = { kind: "completed", value: await operation(handle) };
  } catch (cause: unknown) {
    outcome = { kind: "failed", cause };
  }
  try {
    await owner.close();
  } catch (cleanupCause: unknown) {
    const operationFailure =
      outcome.kind === "failed" &&
      outcome.cause instanceof OwnedRegularFileOperationFailure
        ? outcome.cause
        : undefined;
    const retainedOutcome =
      operationFailure === undefined
        ? outcome
        : {
            kind: "failed" as const,
            cause: operationFailure.operationCause,
          };
    const completionCancellation =
      outcome.kind === "completed" && options.signal?.aborted === true
        ? { reason: options.signal.reason }
        : undefined;
    // Retain the physical read outcome even if the caller cancelled during
    // close: consumers may need completed observations such as a file digest.
    throw new RegularFileCleanupFailure({
      path,
      owner,
      outcome: retainedOutcome,
      cleanupCause,
      retention: retainOwner(options.retainFailedClose, owner),
      completionCancellation,
      operationFailure,
    });
  }
  if (outcome.kind === "failed") throw outcome.cause;
  if (options.signal?.aborted === true)
    throw new RegularFileCancelled(path, owner, {
      outcome,
      reason: options.signal.reason,
    });
  return outcome.value;
};

const retainOwner = (
  retain: OwnedRegularFileOptions["retainFailedClose"],
  owner: OwnedFileHandle,
): RegularFileCleanupFailure["retention"] => {
  if (retain === undefined) return { kind: "not_requested" };
  try {
    retain(owner);
    return { kind: "callback_returned" };
  } catch (cause: unknown) {
    return { kind: "callback_threw", cause };
  }
};

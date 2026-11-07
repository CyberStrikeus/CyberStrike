import {
  AnalysisError,
  type AnalysisErrorOptions,
} from "./analysisErrorBase.js";
import type { AnalysisInputIssue } from "./analysisErrorCore.js";

/** Receipt retained when publication succeeded but staging cleanup did not. */
export interface PublishedEvidenceFile {
  readonly path: string;
  readonly bytes: number;
}

/** Publication completion survives an explicitly excluded path identity. */
export interface PublishedEvidenceFileObservation {
  readonly path?: string;
  readonly bytes: number;
}

/** Evidence identity, schema, or bundle manifests failed integrity checks. */
export class EvidenceIntegrityError extends AnalysisError {
  readonly _tag = "EvidenceIntegrityError";
  override readonly userMessage: string | undefined;

  constructor(
    message: string,
    options?: AnalysisErrorOptions & { readonly userMessage?: string },
  ) {
    super(message, options);
    this.userMessage = options?.userMessage;
  }
}

/** A valid snapshot belongs to a different target, provider, or analysis profile. */
export class AnalysisSnapshotMismatchError extends EvidenceIntegrityError {}

/** A resource session cannot import or export a binary analysis snapshot. */
export class ResourceSnapshotMismatchError extends AnalysisSnapshotMismatchError {
  constructor(readonly operation: "import" | "export") {
    super(
      "Analysis snapshots do not apply to a resource-only app session because it has no executable identity or replay binding.",
    );
  }
}

/** A session Evidence reference is missing or has the wrong semantic identity. */
export class EvidenceReferenceError extends EvidenceIntegrityError {
  readonly expected: string;
  readonly actual: string | null;
  /** Set when the consuming workflow requires retained closure. */
  readonly referenceScope: "retained-closure" | undefined;

  constructor(
    readonly evidenceId: string,
    readonly reason:
      | "missing"
      | "wrong_operation"
      | "wrong_predicate"
      | "identity_mismatch",
    options: AnalysisErrorOptions & {
      readonly expected: string;
      readonly actual: string | null;
      readonly referenceScope?: "retained-closure" | undefined;
    },
  ) {
    super(`Evidence reference ${reason}: ${evidenceId}`, options);
    this.expected = options.expected;
    this.actual = options.actual;
    this.referenceScope = options.referenceScope;
  }
}

/** Evidence bundle filesystem access failed within the configured policy. */
export class EvidenceFileError extends AnalysisError {
  readonly _tag = "EvidenceFileError";
  override readonly userMessage: string | undefined;

  /** Caller-selected path that failed, resolved against the working directory. */
  readonly path: string | undefined;
  /** Present only when a write committed before cleanup failed. */
  readonly published: PublishedEvidenceFileObservation | undefined;
  /** Schema issues relative to the selected file's JSON root, never the request envelope. */
  readonly contentIssues: readonly AnalysisInputIssue[] | undefined;
  readonly systemCode: "EFBIG" | "ENOSPC" | "EDQUOT" | undefined;

  constructor(
    readonly operation: "read" | "write",
    readonly reason:
      | "not-file"
      | "exists"
      | "wrong-kind"
      | "invalid-json"
      | "missing"
      | "path-limit"
      | "storage-limit"
      | "symlink-traversal"
      | "io",
    options?: AnalysisErrorOptions & {
      readonly path?: string;
      readonly published?: PublishedEvidenceFileObservation;
      readonly userMessage?: string;
      readonly contentIssues?: readonly AnalysisInputIssue[];
      readonly systemCode?: "EFBIG" | "ENOSPC" | "EDQUOT";
    },
  ) {
    super(`Evidence bundle ${operation} failed: ${reason}`, options);
    this.path = options?.path;
    this.published = options?.published;
    this.userMessage = options?.userMessage;
    this.contentIssues = options?.contentIssues;
    this.systemCode = options?.systemCode;
  }
}

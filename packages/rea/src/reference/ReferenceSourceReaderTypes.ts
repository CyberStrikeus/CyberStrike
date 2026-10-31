import type { BigIntStats } from "node:fs";

import type { Result } from "../domain/result.js";
import type { AnalysisCleanupObservation } from "../domain/analysisErrorBase.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";

export type ReferenceSourceEntryKind =
  | "file"
  | "directory"
  | "symlink"
  | "other";

/**
 * Kind offered to exclusion predicates. `unknown` marks an entry whose
 * metadata could not be read, so its concrete kind cannot be claimed.
 */
export type ReferenceSourceExclusionKind = ReferenceSourceEntryKind | "unknown";

export interface ReferenceSourceReaderOptions {
  readonly signal?: AbortSignal;
  /** Prepare policy after identity admission and opening, before enumeration; refusal closes the owned handle. */
  readonly beforeDirectory?: (
    path: string,
  ) => Promise<ReferenceSourceResult<undefined>>;
  readonly shouldExclude?: (
    path: string,
    kind: ReferenceSourceExclusionKind,
  ) => boolean;
}

export type ReferenceSourceFailureCode =
  | "cancelled"
  | "changed"
  | "io"
  | "symlink"
  | "unsupported";

export type ReferenceSourceEntry =
  | {
      readonly status: "read";
      readonly kind: "file";
      readonly path: string;
      readonly bytes: Uint8Array;
      readonly size: number;
    }
  | {
      readonly status: "read";
      readonly kind: "directory";
      readonly path: string;
    }
  | {
      readonly status: "read";
      readonly kind: "symlink";
      readonly path: string;
      /** Internal and relative missing targets are resolved from the inventory root. */
      readonly target: string;
      readonly targetState: "internal" | "external" | "missing";
    }
  | {
      readonly status: "failed";
      readonly kind: "file" | "directory" | "symlink" | "other" | "unknown";
      readonly path: string;
      readonly code: ReferenceSourceFailureCode;
      readonly message: string;
      /** Exact filesystem presentation; may contain the selected local root path. */
      readonly localDiagnostic?: string;
      readonly size?: number;
    };

/** A failure enumerating an already admitted root, separate from its children. */
export interface ReferenceSourceRootFailure {
  readonly code: ReferenceSourceFailureCode;
  readonly message: string;
}

export interface ReferenceSourceRead {
  readonly root: string;
  readonly rootFailure?: ReferenceSourceRootFailure;
  readonly entries: readonly ReferenceSourceEntry[];
  readonly bytesRead: number;
  /** Node exposes no portable openat traversal; pathname identity is checked around each operation. */
  readonly limitations: readonly string[];
}

export interface ReferenceSourceReaderError {
  readonly tag: "reference-source-reader";
  readonly code: "cancelled" | "invalid-root" | "io" | "unsupported";
  readonly message: string;
  readonly remediationAction?: string;
  readonly cleanup?: AnalysisCleanupObservation;
  /** Captured entries before failure; this does not establish complete tree coverage. */
  readonly partial?: ReferenceSourceRead;
  readonly cause?: unknown;
}

export type PendingDirectory = {
  readonly path: string;
};

export type TraversalState = {
  readonly resources: ArtifactResourceScope;
  readonly root: string;
  readonly rootIdentity: BigIntStats;
  readonly signal?: AbortSignal;
  /** Prepare policy after identity admission and opening, before enumeration; refusal closes the owned handle. */
  readonly beforeDirectory?: (
    path: string,
  ) => Promise<ReferenceSourceResult<undefined>>;
  readonly shouldExclude?: (
    path: string,
    kind: ReferenceSourceExclusionKind,
  ) => boolean;
  readonly entries: ReferenceSourceEntry[];
  readonly exclusions: Array<{
    readonly path: string;
    readonly kind: ReferenceSourceExclusionKind;
  }>;
  readonly pending: PendingDirectory[];
  rootFailure?: ReferenceSourceRootFailure;
  bytesRead: number;
};

export type StableFileRequest = {
  readonly resources: ArtifactResourceScope;
  readonly root: string;
  readonly rootIdentity: BigIntStats;
  readonly absolute: string;
  readonly path: string;
  readonly expected: BigIntStats;
  readonly signal?: AbortSignal;
};

export type ReferenceSourceResult<T> = Result<T, ReferenceSourceReaderError>;

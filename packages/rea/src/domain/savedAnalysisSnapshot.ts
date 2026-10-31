import type {
  AnalysisError,
  AnalysisPartialObservation,
} from "./analysisErrorBase.js";

/** Receipt for an atomically published analysis snapshot. */
export interface SavedAnalysisSnapshot {
  readonly path: string;
  readonly bytes: number;
  /** Eligible primitive query bindings. */
  readonly primitive_entries: number;
  /** Eligible composed workflow bindings, separate from primitive queries. */
  readonly workflow_entries: number;
  /** Includes retained observations without a replay binding. */
  readonly evidence_records: number;
}

/** Publication remains committed even when subsequent lifecycle cleanup fails. */
export interface SavedAnalysisSnapshotPartialObservation {
  readonly saved_snapshot: SavedAnalysisSnapshot;
  readonly cleanup_observation?: AnalysisPartialObservation;
}

/** Attach publication facts without discarding a cleanup producer's own observation. */
export const retainSavedAnalysisSnapshot = (
  error: AnalysisError,
  receipt: SavedAnalysisSnapshot,
): AnalysisError => {
  error.partialObservation = {
    saved_snapshot: Object.freeze({ ...receipt }),
    ...(error.partialObservation === undefined
      ? {}
      : { cleanup_observation: error.partialObservation }),
  };
  return error;
};

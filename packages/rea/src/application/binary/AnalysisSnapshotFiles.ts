import { setImmediate } from "node:timers/promises";

import {
  prepareSnapshotEntry,
  parsePreparedAnalysisSnapshot,
  type PreparedSnapshotEntry,
  serializeAnalysisSnapshot,
  type AnalysisSnapshot,
} from "../../domain/analysisSnapshot.js";
import {
  EvidenceFileError,
  EvidenceIntegrityError,
} from "../../domain/evidenceErrors.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";
import { AnalysisCancelledError } from "../../domain/analysisErrorCore.js";
import { readJsonObjectMembersFile, writeTextFile } from "../JsonFiles.js";
import type { JsonObjectMemberReader } from "../JsonInputFile.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";

type SnapshotFailure = EvidenceFileError | EvidenceIntegrityError;
const READ_OPERATION = "open_binary";

/** Read and validate an analysis snapshot from the caller's path. */
export const readAnalysisSnapshot = async (
  path: string,
  signal?: AbortSignal,
  resources?: ArtifactResourceScope,
): Promise<
  Result<
    AnalysisSnapshot,
    SnapshotFailure | AnalysisResourceConstraintError | AnalysisCancelledError
  >
> => {
  const entries = snapshotEntryReader("provider");
  const workflows = snapshotEntryReader("workflow");
  const header: Record<string, unknown> = {};
  const metadata = new Map<string, JsonObjectMemberReader>(
    ["target", "binding", "evidence_bundle"].map((name) => [
      name,
      {
        mode: "value",
        begin: () => {
          delete header[name];
        },
        accept: (value) => {
          header[name] = value;
        },
        reject: (cause) => {
          throw cause;
        },
      },
    ]),
  );
  try {
    const loaded = await readJsonObjectMembersFile(
      path,
      [
        new Map([
          ["entries", entries.reader],
          ["workflow_entries", workflows.reader],
        ]),
        metadata,
      ],
      signal,
      resources,
      READ_OPERATION,
    );
    if (!loaded.ok) return loaded;
    signal?.throwIfAborted();
    const snapshot = parsePreparedAnalysisSnapshot(
      header,
      entries.finish(),
      workflows.finish(),
    );
    // Deliver queued cancellation before handing a complete cache to the session.
    await setImmediate();
    signal?.throwIfAborted();
    return ok(snapshot);
  } catch (cause: unknown) {
    if (signal?.aborted === true)
      return err(
        new AnalysisCancelledError(READ_OPERATION, { cause: signal.reason }),
      );
    return err(
      new EvidenceIntegrityError(snapshotValidationMessage(cause), { cause }),
    );
  }
};

const snapshotEntryReader = (kind: "provider" | "workflow") => {
  let seen = false;
  let entries: PreparedSnapshotEntry[] = [];
  let failure: { readonly cause: unknown } | undefined;
  const reader: JsonObjectMemberReader = {
    mode: "array",
    begin: () => {
      seen = true;
      entries = [];
      failure = undefined;
    },
    accept: (value) => {
      if (failure === undefined)
        entries.push(prepareSnapshotEntry(value, kind));
    },
    reject: (cause) => {
      failure ??= { cause };
    },
  };
  return {
    reader,
    finish: (): PreparedSnapshotEntry[] => {
      if (!seen)
        throw new TypeError(
          `Analysis snapshot ${kind === "provider" ? "entries" : "workflow_entries"} is missing`,
        );
      if (failure !== undefined) throw failure.cause;
      return entries;
    },
  };
};

/** Atomically write a deterministic analysis snapshot to the caller's path. */
export const writeAnalysisSnapshot = async (
  snapshot: AnalysisSnapshot,
  path: string,
  overwrite: boolean,
  resources: ArtifactResourceScope,
): Promise<
  Result<{ readonly path: string; readonly bytes: number }, SnapshotFailure>
> => {
  let encoded: string;
  try {
    encoded = serializeAnalysisSnapshot(snapshot);
  } catch (cause: unknown) {
    return err(
      new EvidenceIntegrityError(snapshotValidationMessage(cause), { cause }),
    );
  }
  return writeTextFile(encoded, path, overwrite, resources);
};

const snapshotValidationMessage = (cause: unknown): string =>
  cause instanceof TypeError
    ? cause.message
    : "Analysis snapshot validation failed";

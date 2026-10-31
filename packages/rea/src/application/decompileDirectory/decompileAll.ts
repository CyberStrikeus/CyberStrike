import { join } from "node:path";
import { z } from "zod";

import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";

import {
  DECOMPILE_DIRECTORY_INDEX_NAME,
  DECOMPILE_DIRECTORY_INLINE_FAILURE_LIMIT,
  DECOMPILE_DIRECTORY_INLINE_FAILURE_BYTES,
  decompileDirectoryManifestSchema,
  type DecompileDirectoryFunctionRecord,
  type DecompileDirectoryInput,
  type DecompileDirectoryInlineFailure,
} from "../../contracts/decompileDirectory.js";
import { jsonValueByteLength } from "../../domain/jsonValueByteLength.js";
import { digestSchema } from "../../domain/digests.js";
import type {
  AnalysisExecution,
  AnalysisOperationPort,
} from "../AnalysisProvider.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
  AnalysisTimeoutError,
} from "../../domain/analysisErrorCore.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { procedureInfoSchema } from "../../domain/native/procedureInfo.js";
import { addressedValueSchema } from "../../domain/native/nativeInventory.js";
import { addressCoordinate } from "../../domain/native/addressCoordinate.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  classifyOutputPath,
  DecompileExport,
  exportOutputFailure,
  type ExportIdentity,
} from "./exportTree.js";
import {
  bodyRecord,
  functionFileText,
  type FunctionBody,
} from "./functionFile.js";
import {
  selectProcedures,
  validateDecompileBounds,
  type SelectedProcedure,
} from "./selection.js";

const DWARF_LAYOUT_UNAVAILABLE =
  "Debug compilation-unit layout is unavailable. Files are named by canonical address.";
const BODY_UNAVAILABLE =
  "procedure_info is unavailable, so function body ranges are unknown.";
const TARGET_DIGEST_UNAVAILABLE =
  "Target SHA-256 was not observed, so this export cannot be resumed.";
const PROFILE_UNAVAILABLE =
  "The provider did not commit an analysis profile, so this export cannot be resumed.";
const DUPLICATE_ADDRESSES =
  "Duplicate procedure addresses were coalesced to the first matching inventory row.";
/** Consecutive output_io failures after which an export stops. */
export const OUTPUT_IO_STREAK_LIMIT = 5;
const unaddressedRows = (count: number): string =>
  `${count.toString()} inventory row(s) had no address and were not exported.`;

interface FailureReason {
  readonly code: string;
  readonly message: string;
}

type InlineFailure = DecompileDirectoryInlineFailure;
type NamedFailure = Extract<InlineFailure, { readonly name: string | null }>;

interface PublishState {
  /** Functions this call took on after skipping verified files; bounded by limit. */
  attempted: number;
  written: number;
  failed: number;
  /** Functions procedure_info classifies as external: not decompiled, no file. */
  external: number;
  skipped: number;
  readonly failures: InlineFailure[];
  inlineFailureBytes: number;
  readonly recentFailures: PublishState["failures"];
  bodyUnavailable: boolean;
  /** Failure code of the function being attempted, if it failed. */
  lastFailureCode: string | undefined;
  /**
   * Consecutive output_io failures. A verified file, a write, or any other
   * outcome ends the run of failures; a recorded external function does not.
   */
  outputIoStreak: number;
}

/**
 * Write one pseudocode file per selected function and return only a manifest.
 * Files already committed stay in place when a later function fails or the
 * caller cancels.
 */
export const decompileAll = async (
  analysis: AnalysisOperationPort,
  input: DecompileDirectoryInput,
  signal?: AbortSignal,
): Promise<Result<JsonValue, AnalysisError>> => {
  const bounds = validateDecompileBounds(input);
  if (!bounds.ok) return bounds;
  const placement = await classifyOutputPath(
    input.output_directory,
    input.resume,
  );
  if (!placement.ok) return placement;
  if (isAborted(signal)) return err(cancelled(signal));
  const loaded = await loadProcedures(analysis, input.layout, signal);
  if (!loaded.ok) return loaded;
  if (isAborted(signal)) return err(cancelled(signal));
  const selection = selectProcedures(
    loaded.value.procedures,
    input,
    bounds.value,
  );
  const opened = await DecompileExport.open({
    placement: placement.value,
    identity: loaded.value.identity,
    resourceScope: analysis.resourceScope,
  });
  if (!opened.ok) return opened;
  const session = opened.value;
  const state: PublishState = {
    attempted: 0,
    written: 0,
    failed: 0,
    external: 0,
    skipped: 0,
    failures: [],
    inlineFailureBytes: 2,
    recentFailures: [],
    bodyUnavailable: false,
    lastFailureCode: undefined,
    outputIoStreak: 0,
  };
  let published: Result<void, AnalysisError> | undefined;
  let indexed: Result<void, AnalysisError> | undefined;
  let limitations: readonly string[] = [];
  let closed: Result<void, AnalysisError> | undefined;
  // The journal handle is closed on every path, including an unexpected throw.
  try {
    published = await publishSelected({
      analysis,
      session,
      procedures: attemptOrder(session, selection.procedures),
      identity: loaded.value.identity,
      signal,
      limit: input.limit,
      state,
    });
    limitations = exportLimitations(
      input.layout,
      loaded.value.identity,
      selection.collapsedDuplicates,
      state.bodyUnavailable,
      loaded.value.unaddressed,
    );
    indexed = await session.writeIndex({
      layoutStatus: layoutStatus(input.layout),
      limitations,
    });
  } finally {
    closed = await session.close();
  }
  // A publish, index or close failure stays primary: the journal or index
  // may be incomplete and the caller needs that reason. Cancellation only
  // replaces success, so an index or close failure after the caller's abort
  // stopped the publish loop is still reported. A provider's own
  // cancellation, without a caller abort, is a publish failure like any other.
  const callerStoppedPublish =
    !published.ok &&
    published.error instanceof AnalysisCancelledError &&
    !published.error.cleanupIncomplete &&
    isAborted(signal);
  const failures = [
    ...(!published.ok && !callerStoppedPublish ? [published.error] : []),
    ...(indexed.ok ? [] : [indexed.error]),
    ...(closed.ok ? [] : [closed.error]),
  ];
  const primary = failures[0];
  if (primary !== undefined) {
    if (
      isAborted(signal) &&
      !(
        primary instanceof AnalysisCancelledError &&
        primary.cause === signal?.reason
      )
    )
      primary.retainSecondaryFailure(cancelled(signal));
    for (const failure of failures.slice(1))
      primary.retainSecondaryFailure(failure);
    return !closed.ok &&
      primary !== closed.error &&
      closed.error.cleanupIncomplete
      ? err(
          analysisErrorWithCleanupFailure(
            primary,
            closed.error,
            "decompile_all",
          ).bindCleanupDependencies([primary, closed.error]),
        )
      : err(primary);
  }
  // Finalization succeeded, so committed files and the index are usable on
  // resume, but a caller abort that stopped the loop or arrived meanwhile is
  // not a success. Report it with the caller's own reason.
  if (isAborted(signal)) return err(cancelled(signal));
  const manifest = decompileDirectoryManifestSchema.safeParse(
    manifestOf({
      root: session.root,
      input,
      identity: loaded.value.identity,
      selected: selection.procedures.length,
      excluded: selection.excluded,
      state,
      limitations,
    }),
  );
  return manifest.success
    ? ok(manifest.data)
    : err(
        new AnalysisOutputError(
          "decompile_all",
          "decompile manifest could not be built",
        ),
      );
};

/**
 * Functions with no recorded failure go first, so a limited resume reaches
 * new work instead of retrying the same failures every call.
 */
const attemptOrder = (
  session: DecompileExport,
  procedures: readonly SelectedProcedure[],
): readonly SelectedProcedure[] => {
  const failedBefore = (procedure: SelectedProcedure): boolean =>
    session.record(procedure.address)?.status === "failed";
  return [
    ...procedures.filter((procedure) => !failedBefore(procedure)),
    ...procedures.filter(failedBefore),
  ];
};

const loadProcedures = async (
  analysis: AnalysisOperationPort,
  layout: DecompileDirectoryInput["layout"],
  signal: AbortSignal | undefined,
): Promise<
  Result<
    {
      readonly procedures: readonly SelectedProcedure[];
      readonly identity: ExportIdentity;
      readonly unaddressed: number;
    },
    AnalysisError
  >
> => {
  const observed = await analysis.execute(
    "list_procedures",
    {},
    executionOptions(signal),
  );
  if (!observed.ok) return observed;
  const parsed = z.array(addressedValueSchema).safeParse(observed.value.result);
  if (!parsed.success)
    return err(
      new AnalysisOutputError(
        "list_procedures",
        "provider returned an invalid procedure inventory",
      ),
    );
  const identity = identityFrom(observed.value, layout);
  if (!identity.ok) return identity;
  // An empty address cannot name a file or a journal record.
  const addressed = parsed.data.filter((row) => row.address.length > 0);
  return ok({
    procedures: addressed.map((row) => ({
      address: row.address,
      name: row.value.length === 0 ? null : row.value,
    })),
    identity: identity.value,
    unaddressed: parsed.data.length - addressed.length,
  });
};

const identityFrom = (
  execution: AnalysisExecution,
  layout: DecompileDirectoryInput["layout"],
): Result<ExportIdentity, AnalysisError> => {
  const sha = execution.subject?.sha256 ?? null;
  if (sha !== null && !digestSchema.safeParse(sha).success)
    return err(
      new AnalysisOutputError(
        "list_procedures",
        "provider returned a target digest that is not a SHA-256",
      ),
    );
  const profile = execution.analysisProfile?.digest ?? null;
  if (profile !== null && !digestSchema.safeParse(profile).success)
    return err(
      new AnalysisOutputError(
        "list_procedures",
        "provider returned an analysis profile digest that is not a SHA-256",
      ),
    );
  const provider = execution.provider;
  if (provider.id.length === 0 || provider.name.length === 0)
    return err(
      new AnalysisOutputError(
        "list_procedures",
        "provider identity is incomplete",
      ),
    );
  if (provider.version !== null && provider.version.length === 0)
    return err(
      new AnalysisOutputError(
        "list_procedures",
        "provider identity is incomplete",
      ),
    );
  return ok({
    targetSha256: sha,
    provider: {
      id: provider.id,
      name: provider.name,
      version: provider.version,
    },
    analysisProfileDigest: profile,
    layout,
  });
};

interface PublishInput {
  readonly analysis: AnalysisOperationPort;
  readonly session: DecompileExport;
  readonly procedures: readonly SelectedProcedure[];
  readonly identity: ExportIdentity;
  readonly signal: AbortSignal | undefined;
  readonly limit: number | undefined;
  readonly state: PublishState;
}

const publishSelected = async (
  input: PublishInput,
): Promise<Result<void, AnalysisError>> => {
  let bodySupport: "unknown" | "unavailable" = "unknown";
  for (const procedure of input.procedures) {
    if (isAborted(input.signal)) return err(cancelled(input.signal));
    const existing = await existingFile(
      input.session,
      procedure.address,
      input.signal,
    );
    if (typeof existing === "object") return err(existing.error);
    if (isAborted(input.signal)) return err(cancelled(input.signal));
    if (existing === "skip") {
      input.state.skipped += 1;
      // A file that reads back and verifies shows the directory works.
      input.state.outputIoStreak = 0;
      // The file verified again after a later failure, so the journal and
      // index report it as written instead of keeping the stale failure.
      const written = input.session.lastWritten(procedure.address);
      if (
        written !== undefined &&
        input.session.record(procedure.address) !== written
      ) {
        const appended = await input.session.append(written);
        if (!appended.ok) return appended;
      }
      continue;
    }
    // The journal header pins the target, provider and profile, so a
    // recorded external classification still holds. Asking again would only
    // spend the limit, and a limit below the external count would leave
    // functions remaining on every resume.
    // A conflicting or unreadable file at its reserved path is still reported
    // below rather than hidden by the skip.
    if (
      existing === "write" &&
      input.session.record(procedure.address)?.status === "external"
    ) {
      input.state.skipped += 1;
      continue;
    }
    if (input.limit !== undefined && input.state.attempted >= input.limit)
      continue;
    input.state.attempted += 1;
    input.state.lastFailureCode = undefined;
    const outcome = await attemptOne(input, procedure, existing, bodySupport);
    bodySupport = outcome.bodySupport;
    if (!outcome.result.ok) return outcome.result;
    input.state.outputIoStreak =
      input.state.lastFailureCode === "output_io"
        ? input.state.outputIoStreak + 1
        : 0;
    // Repeated write failures mean the directory has stopped accepting files,
    // for example a full disk. Stop instead of decompiling every remaining
    // function only to fail its write. Committed files and records are kept.
    if (input.state.outputIoStreak >= OUTPUT_IO_STREAK_LIMIT)
      return err(outputStoppedAccepting(input.state));
  }
  return ok(undefined);
};

/** One function this call takes on: report a file problem or decompile it. */
const attemptOne = async (
  input: PublishInput,
  procedure: SelectedProcedure,
  existing: "write" | "conflict" | "io",
  bodySupport: "unknown" | "unavailable",
): Promise<{
  readonly result: Result<void, AnalysisError>;
  readonly bodySupport: "unknown" | "unavailable";
}> => {
  if (existing === "conflict") {
    const reason = {
      code: "output_exists",
      message:
        "The function file already exists and does not match this export.",
    };
    recordFailure(input.state, procedure, reason);
    const retained = retainedObservation(input.session, procedure.address);
    const appended = await input.session.append(
      failureRecord(procedure, retained.body, reason, {
        relativePath: input.session.pathFor(procedure.address),
        ...retained.options,
      }),
    );
    return { result: appended, bodySupport };
  }
  if (existing === "io") {
    const reason = {
      code: "output_io",
      message: "The existing function file could not be read.",
    };
    recordFailure(input.state, procedure, reason);
    const retained = retainedObservation(input.session, procedure.address);
    const appended = await input.session.append(
      failureRecord(procedure, retained.body, reason, {
        relativePath: input.session.pathFor(procedure.address),
        ...retained.options,
      }),
    );
    return { result: appended, bodySupport };
  }
  return publishOne({
    ...input,
    procedure,
    bodySupport,
  });
};

const publishOne = async (input: {
  readonly analysis: AnalysisOperationPort;
  readonly session: DecompileExport;
  readonly procedure: SelectedProcedure;
  readonly identity: ExportIdentity;
  readonly signal: AbortSignal | undefined;
  readonly state: PublishState;
  readonly bodySupport: "unknown" | "unavailable";
}): Promise<{
  readonly result: Result<void, AnalysisError>;
  readonly bodySupport: "unknown" | "unavailable";
}> => {
  const body = await readBody(
    input.analysis,
    input.procedure.address,
    input.identity,
    input.signal,
    input.bodySupport,
  );
  if (body.kind === "error")
    return { result: err(body.error), bodySupport: input.bodySupport };
  if (body.kind === "unavailable") input.state.bodyUnavailable = true;
  // Caveats of the observations this attempt used. The journal record keeps
  // the complete list, written or failed, so the bounded Evidence summary and
  // the length-capped file header never hold the only copy.
  const infoCaveats = body.kind === "body" ? (body.limitations ?? []) : [];
  // procedure_info classifies the function as external, so this target holds
  // no code of its own to decompile. The record keeps the provider's body
  // fact as observed; it is reported as external, not as a failure.
  if (body.kind === "body" && body.external === true) {
    input.state.external += 1;
    return {
      result: await input.session.append(
        externalRecord(input.procedure, body.fact, infoCaveats),
      ),
      bodySupport: body.support,
    };
  }
  const decompiled = await input.analysis.execute(
    "procedure_pseudo_code",
    { procedure: input.procedure.address },
    executionOptions(input.signal),
  );
  // A provider still owns cleanup even if the caller aborted meanwhile.
  if (!decompiled.ok && decompiled.error.cleanupIncomplete)
    return { result: decompiled, bodySupport: body.support };
  if (isAborted(input.signal))
    return { result: err(cancelled(input.signal)), bodySupport: body.support };
  if (!decompiled.ok) {
    if (decompiled.error instanceof AnalysisCancelledError)
      return { result: decompiled, bodySupport: body.support };
    const reason = failureReason(decompiled.error);
    recordFailure(input.state, input.procedure, reason);
    return {
      result: await input.session.append(
        failureRecord(input.procedure, body.fact, reason, {
          limitations: infoCaveats,
        }),
      ),
      bodySupport: body.support,
    };
  }
  const mismatch = observationMismatch(input.identity, decompiled.value);
  if (mismatch !== undefined) {
    const reason = mismatch;
    recordFailure(input.state, input.procedure, reason);
    return {
      result: await input.session.append(
        failureRecord(input.procedure, body.fact, reason, {
          limitations: infoCaveats,
        }),
      ),
      bodySupport: body.support,
    };
  }
  const caveats = [
    ...new Set([...infoCaveats, ...decompiled.value.limitations]),
  ];
  const pseudocode = decompiled.value.result;
  if (typeof pseudocode !== "string" || pseudocode.length === 0) {
    const reason = pseudocodeFailure(pseudocode);
    recordFailure(input.state, input.procedure, reason);
    return {
      result: await input.session.append(
        failureRecord(input.procedure, body.fact, reason, {
          limitations: caveats,
        }),
      ),
      bodySupport: body.support,
    };
  }
  const relativePath = input.session.pathFor(input.procedure.address);
  const bytes = Buffer.from(
    functionFileText({
      procedure: input.procedure,
      body: body.fact,
      identity: input.identity,
      limitations: caveats,
      pseudocode,
    }),
    "utf8",
  );
  const committed = await input.session.commitFunctionFile(relativePath, bytes);
  if (committed.status === "error")
    return { result: err(committed.error), bodySupport: body.support };
  if (committed.status === "conflict" || committed.status === "io") {
    const reason =
      committed.status === "conflict"
        ? {
            code: "output_exists",
            message:
              "The function file already exists and does not match this export.",
          }
        : {
            code: "output_io",
            message: "The function file could not be written.",
          };
    recordFailure(input.state, input.procedure, reason);
    return {
      result: await input.session.append(
        failureRecord(input.procedure, body.fact, reason, {
          relativePath,
          limitations: caveats,
        }),
      ),
      bodySupport: body.support,
    };
  }
  const appended = await input.session.append({
    address: input.procedure.address,
    name: input.procedure.name,
    status: "written",
    relative_path: relativePath,
    sha256: committed.sha256,
    body: bodyRecord(body.fact),
    // The header may truncate; the journal keeps the complete list.
    ...(caveats.length === 0 ? {} : { limitations: caveats }),
  });
  if (!appended.ok) return { result: appended, bodySupport: body.support };
  input.state.written += committed.status === "written" ? 1 : 0;
  input.state.skipped += committed.status === "matched" ? 1 : 0;
  return { result: ok(undefined), bodySupport: body.support };
};

const readBody = async (
  analysis: AnalysisOperationPort,
  address: string,
  identity: ExportIdentity,
  signal: AbortSignal | undefined,
  support: "unknown" | "unavailable",
): Promise<
  | {
      readonly kind: "body";
      readonly fact: FunctionBody;
      readonly support: "unknown" | "unavailable";
      /**
       * Caveats of a procedure_info observation for this export's target and
       * profile. An observation for another target or profile is foreign and
       * contributes none.
       */
      readonly limitations?: readonly string[];
      /**
       * procedure_info for this export classifies the function as external.
       * Absent when the classification is unknown or not external.
       */
      readonly external?: true;
    }
  | {
      readonly kind: "unavailable";
      readonly fact: FunctionBody;
      readonly support: "unavailable";
    }
  | { readonly kind: "error"; readonly error: AnalysisError }
> => {
  if (support === "unavailable")
    return {
      kind: "unavailable",
      fact: unavailableBody(BODY_UNAVAILABLE),
      support,
    };
  const observed = await analysis.execute(
    "procedure_info",
    { procedure: address },
    executionOptions(signal),
  );
  if (!observed.ok) {
    if (
      observed.error.cleanupIncomplete ||
      observed.error instanceof AnalysisCancelledError
    )
      return { kind: "error", error: observed.error };
    if (observed.error instanceof AnalysisCapabilityUnavailableError)
      return {
        kind: "unavailable",
        fact: unavailableBody(BODY_UNAVAILABLE),
        support: "unavailable",
      };
    return {
      kind: "body",
      fact: unavailableBody(failureReason(observed.error).message),
      support,
    };
  }
  const mismatch = observationMismatch(identity, observed.value);
  if (mismatch !== undefined)
    return {
      kind: "body",
      fact: unavailableBody(`procedure_info: ${mismatch.message}`),
      support,
    };
  const parsed = procedureInfoSchema.safeParse(observed.value.result);
  if (!parsed.success)
    return {
      kind: "body",
      fact: unavailableBody("procedure_info returned an invalid body."),
      support,
      limitations: observed.value.limitations,
    };
  if (!sameAddress(parsed.data.entrypoint, address))
    return {
      kind: "body",
      fact: unavailableBody(
        "procedure_info described a different entry point than this function.",
      ),
      support,
      limitations: observed.value.limitations,
    };
  const external =
    parsed.data.classification?.external === true
      ? { external: true as const }
      : {};
  if (!parsed.data.body.available)
    return {
      kind: "body",
      fact: unavailableBody(parsed.data.body.reason),
      support,
      limitations: observed.value.limitations,
      ...external,
    };
  return {
    kind: "body",
    fact: {
      available: true,
      ranges: parsed.data.body.ranges,
      non_contiguous: parsed.data.body.non_contiguous,
    },
    support,
    limitations: observed.value.limitations,
    ...external,
  };
};

type ExistingFile =
  | "skip"
  | "write"
  | "conflict"
  | "io"
  | { readonly error: AnalysisError };

const existingFile = async (
  session: DecompileExport,
  address: string,
  signal: AbortSignal | undefined,
): Promise<ExistingFile> => {
  const record = session.lastWritten(address);
  if (
    record === undefined ||
    record.sha256 === undefined ||
    record.relative_path === undefined
  )
    return "write";
  const digest = await session
    .hashFile(record.relative_path, signal)
    .catch((cause: unknown) => cause);
  if (digest instanceof ArtifactReaderFailure && digest.cleanup !== undefined)
    return {
      error: exportOutputFailure(
        "decompile file verification cleanup failed",
        digest,
      ),
    };
  if (typeof digest === "string")
    return digest === record.sha256 ? "skip" : "conflict";
  return nodeAbsent(digest) ? "write" : "io";
};

const PROFILE_CHANGED: FailureReason = {
  code: "profile_changed",
  message:
    "The decompiler observation does not match this export's provider or analysis profile.",
};

const TARGET_CHANGED: FailureReason = {
  code: "target_changed",
  message:
    "The decompiler observation names a different target than this export.",
};

/** Why a per-function observation cannot join this export, if it cannot. */
const observationMismatch = (
  identity: ExportIdentity,
  execution: AnalysisExecution,
): FailureReason | undefined => {
  const provider = execution.provider;
  if (
    provider.id !== identity.provider.id ||
    provider.name !== identity.provider.name ||
    provider.version !== identity.provider.version
  )
    return PROFILE_CHANGED;
  // A missing profile is unknown, not a match for a committed one.
  if (
    (execution.analysisProfile?.digest ?? null) !==
    identity.analysisProfileDigest
  )
    return PROFILE_CHANGED;
  // A per-function observation may omit its subject; one that names a
  // different target is not this export's target.
  const target = execution.subject?.sha256;
  return target === undefined || target === identity.targetSha256
    ? undefined
    : TARGET_CHANGED;
};

/** Same canonical address; numeric when both parse, otherwise exact text. */
const sameAddress = (left: string, right: string): boolean => {
  const a = addressCoordinate(left);
  const b = addressCoordinate(right);
  return a === null || b === null
    ? left === right
    : a.space === b.space && a.offset === b.offset;
};

const failureReason = (error: AnalysisError): FailureReason => {
  if (error instanceof AnalysisTimeoutError)
    return { code: "deadline", message: "The decompiler deadline elapsed." };
  const projected = projectAnalysisError(error);
  const message = projected.message.replace(/\s+/gu, " ").trim().slice(0, 300);
  return {
    code: projected.code.slice(0, 80),
    message: message.length === 0 ? projected.code : message,
  };
};

const outputStoppedAccepting = (state: PublishState): AnalysisOutputError =>
  new AnalysisOutputError(
    "decompile_all",
    "output directory stopped accepting function files",
    {
      userMessage: `Stopped after ${OUTPUT_IO_STREAK_LIMIT.toString()} function files in a row could not be written or read, for example because the disk is full or permissions changed. Files already written are kept and recorded in ${DECOMPILE_DIRECTORY_INDEX_NAME}. Fix the output directory, then resume.`,
      remediationAction:
        "Free space or restore write access in the output directory, then rerun with resume.",
      diagnostics: {
        attempted: state.attempted,
        written: state.written,
        failed: state.failed,
        external: state.external,
        skipped: state.skipped,
        consecutive_output_io: state.outputIoStreak,
        last_failures: state.recentFailures.map((failure) => ({ ...failure })),
        last_failures_omitted:
          Math.min(state.failed, OUTPUT_IO_STREAK_LIMIT) -
          state.recentFailures.length,
      },
    },
  );

const recordFailure = (
  state: PublishState,
  procedure: SelectedProcedure,
  reason: FailureReason,
): void => {
  state.failed += 1;
  state.lastFailureCode = reason.code;
  const failure = {
    address: procedure.address,
    name: procedure.name,
    code: reason.code,
    message: reason.message,
  };
  if (state.failures.length < DECOMPILE_DIRECTORY_INLINE_FAILURE_LIMIT) {
    const comma = state.failures.length === 0 ? 0 : 1;
    const fitted = fitInlineFailure(
      failure,
      DECOMPILE_DIRECTORY_INLINE_FAILURE_BYTES -
        state.inlineFailureBytes -
        comma,
    );
    if (fitted !== undefined) {
      state.failures.push(fitted.row);
      state.inlineFailureBytes += comma + fitted.bytes;
    }
  }
  const recent = fitInlineFailure(
    failure,
    DECOMPILE_DIRECTORY_INLINE_FAILURE_BYTES - 2,
  );
  // An oversized latest row cannot leave an older example labelled as recent.
  if (recent === undefined) state.recentFailures.length = 0;
  else state.recentFailures.push(recent.row);
  while (
    state.recentFailures.length > OUTPUT_IO_STREAK_LIMIT ||
    jsonValueByteLength(
      state.recentFailures,
      DECOMPILE_DIRECTORY_INLINE_FAILURE_BYTES,
    ) > DECOMPILE_DIRECTORY_INLINE_FAILURE_BYTES
  )
    state.recentFailures.shift();
};

const fitInlineFailure = (
  failure: NamedFailure,
  budget: number,
): { readonly row: InlineFailure; readonly bytes: number } | undefined => {
  const bytes = jsonValueByteLength(failure, budget);
  if (bytes <= budget) return { row: failure, bytes };
  // Name is display context; address remains the complete lookup identity.
  const { name: _name, ...withoutName } = failure;
  const compactBytes = jsonValueByteLength(withoutName, budget);
  return compactBytes <= budget
    ? { row: withoutName, bytes: compactBytes }
    : undefined;
};

const failureRecord = (
  procedure: SelectedProcedure,
  body: FunctionBody,
  reason: FailureReason,
  options: {
    readonly relativePath?: string;
    /** Caveats of the observations this attempt used. */
    readonly limitations?: readonly string[];
  } = {},
): DecompileDirectoryFunctionRecord => ({
  address: procedure.address,
  name: procedure.name,
  status: "failed",
  body: bodyRecord(body),
  failure: reason,
  ...(options.relativePath === undefined
    ? {}
    : { relative_path: options.relativePath }),
  ...(options.limitations === undefined || options.limitations.length === 0
    ? {}
    : { limitations: [...options.limitations] }),
});

/** Why a successful pseudocode observation still produced no file. */
const pseudocodeFailure = (pseudocode: unknown): FailureReason => {
  if (pseudocode === null)
    return {
      code: "no_pseudocode",
      message: "The provider returned null pseudocode for this function.",
    };
  return typeof pseudocode === "string"
    ? {
        code: "empty_pseudocode",
        message: "The provider returned no pseudocode.",
      }
    : {
        code: "invalid_pseudocode",
        message: "The provider returned pseudocode that is not text.",
      };
};

const externalRecord = (
  procedure: SelectedProcedure,
  body: FunctionBody,
  limitations: readonly string[],
): DecompileDirectoryFunctionRecord => ({
  address: procedure.address,
  name: procedure.name,
  status: "external",
  body: bodyRecord(body),
  ...(limitations.length === 0 ? {} : { limitations: [...limitations] }),
});

const unavailableBody = (reason: string): FunctionBody => ({
  available: false,
  reason: reason.length === 0 ? "unavailable" : reason,
});

/** Preserve the observations and their caveats when a file cannot be reused. */
const retainedObservation = (
  session: DecompileExport,
  address: string,
): { body: FunctionBody; options: { limitations?: readonly string[] } } => {
  const record = session.record(address);
  return {
    body: record?.body ?? unavailableBody("not rewritten"),
    options:
      record?.limitations === undefined
        ? {}
        : { limitations: record.limitations },
  };
};

const exportLimitations = (
  layout: DecompileDirectoryInput["layout"],
  identity: ExportIdentity,
  collapsedDuplicates: boolean,
  bodyUnavailable: boolean,
  unaddressed: number,
): readonly string[] => [
  ...(layout === "dwarf" ? [DWARF_LAYOUT_UNAVAILABLE] : []),
  ...(identity.targetSha256 === null ? [TARGET_DIGEST_UNAVAILABLE] : []),
  ...(identity.analysisProfileDigest === null ? [PROFILE_UNAVAILABLE] : []),
  ...(collapsedDuplicates ? [DUPLICATE_ADDRESSES] : []),
  ...(unaddressed > 0 ? [unaddressedRows(unaddressed)] : []),
  ...(bodyUnavailable ? [BODY_UNAVAILABLE] : []),
];

const layoutStatus = (
  layout: DecompileDirectoryInput["layout"],
): "address" | "debug_layout_unavailable" =>
  layout === "dwarf" ? "debug_layout_unavailable" : "address";

const manifestOf = (input: {
  readonly root: string;
  readonly input: DecompileDirectoryInput;
  readonly identity: ExportIdentity;
  readonly selected: number;
  readonly excluded: number;
  readonly state: PublishState;
  readonly limitations: readonly string[];
}) => {
  const requested =
    input.state.written + input.state.failed + input.state.external;
  const shown = input.state.failures.slice(
    0,
    DECOMPILE_DIRECTORY_INLINE_FAILURE_LIMIT,
  );
  return {
    output_directory: input.root,
    index_path: join(input.root, DECOMPILE_DIRECTORY_INDEX_NAME),
    layout: input.input.layout,
    layout_status: layoutStatus(input.input.layout),
    counts: {
      selected: input.selected,
      excluded: input.excluded,
      requested,
      written: input.state.written,
      failed: input.state.failed,
      external: input.state.external,
      skipped: input.state.skipped,
      remaining: input.selected - input.state.skipped - requested,
    },
    failures: shown,
    failures_omitted: input.state.failed - shown.length,
    provider: input.identity.provider,
    analysis_profile_digest: input.identity.analysisProfileDigest,
    target_sha256: input.identity.targetSha256,
    limitations: [...input.limitations],
    resume: input.input.resume,
  };
};

const executionOptions = (signal: AbortSignal | undefined) => ({
  ...(signal === undefined ? {} : { signal }),
  selectorOrigin: "provider" as const,
});

const cancelled = (signal: AbortSignal | undefined): AnalysisCancelledError =>
  new AnalysisCancelledError("decompile_all", { cause: signal?.reason });

const isAborted = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;

const nodeAbsent = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  cause.code === "ENOENT";

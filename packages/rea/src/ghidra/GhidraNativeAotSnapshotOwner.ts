import type { AnalysisOperation } from "../application/AnalysisProvider.js";
import type {
  AnalysisError,
  AnalysisPartialObservation,
} from "../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import {
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
} from "../domain/analysisErrorCore.js";
import type { JsonValue } from "../domain/jsonValue.js";
import {
  NativeAotSnapshotIdentityError,
  NATIVE_AOT_MAX_REPORT_BYTES,
  NATIVE_AOT_MAX_SOURCE_BYTES,
  nativeAotSnapshotOverCapacity,
  parseNativeAotPe,
  type NativeAotPeResult,
} from "../domain/native/nativeAotPe.js";
import {
  nativeAotSnapshotObservationSchema,
  type NativeAotSnapshotObservation,
} from "../domain/native/nativeAotSnapshotObservation.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  SharedStartupAttempt,
  STARTUP_OWNER_CLOSED,
} from "../process/SharedStartupAttempt.js";
import type { GhidraClient, GhidraTargetSnapshot } from "./GhidraClient.js";
import { GhidraSessionError } from "./GhidraSessionError.js";

type Derivation = Result<NativeAotPeResult, GhidraSessionError>;

/** Own one captured PE derivation; each caller owns only its wait and projection. */
export class GhidraNativeAotSnapshotOwner {
  #base: string | undefined;
  #conflict: { imageBase: string; observations: JsonValue } | undefined;
  #closed = false;
  #cached: NativeAotPeResult | undefined;
  #attempt: SharedStartupAttempt<Derivation> | undefined;
  #failure: GhidraSessionError | undefined;
  #capture: NativeAotSnapshotObservation["capture"] | undefined;

  constructor(
    private readonly input: {
      readonly targetSha256: string;
      readonly targetPath: string;
      readonly readSnapshot: GhidraClient["readTargetSnapshot"] | undefined;
      readonly projectFailure: (
        operation: AnalysisOperation,
        failure: GhidraSessionError,
      ) => AnalysisError;
    },
  ) {}

  get cleanupFailure(): AnalysisError | undefined {
    const cleanup = this.#failure?.cleanupFailure;
    return cleanup?.cleanupIncomplete ? cleanup : undefined;
  }

  async derive(
    imageBase: string,
    operation: AnalysisOperation,
    callerSignal: AbortSignal | undefined,
    observations: JsonValue,
  ): Promise<Result<NativeAotPeResult, AnalysisError>> {
    if (callerSignal?.aborted)
      return err(this.#cancelled(operation, callerSignal.reason, observations));
    if (this.#closed)
      return err(
        this.#cancelled(operation, STARTUP_OWNER_CLOSED, observations),
      );
    if (this.#conflict !== undefined)
      return err(this.#identityError(operation, imageBase, observations));
    let normalized: string;
    try {
      const base = BigInt(imageBase);
      if (base < 0n)
        throw new RangeError("Loaded image base must be nonnegative");
      normalized = `0x${base.toString(16)}`;
    } catch (cause: unknown) {
      return err(
        new ProviderAdapterError("ghidra", operation, {
          diagnostics: {
            reason:
              "Ghidra returned an invalid loaded image base for NativeAOT identity binding.",
            observed_image_base: imageBase,
            measured_observation: observations,
          },
          cause,
        }),
      );
    }
    if (this.#base !== undefined && this.#base !== normalized) {
      this.#conflict = { imageBase, observations };
      this.#cached = undefined;
      this.#attempt?.close();
      return err(this.#identityError(operation, imageBase, observations));
    }
    this.#base ??= normalized;
    if (this.cleanupFailure !== undefined && this.#failure !== undefined)
      return err(
        this.#projectFailure(operation, this.#failure, imageBase, observations),
      );
    if (this.#cached !== undefined) {
      const cached = this.#cached;
      await Promise.resolve();
      if (this.#conflict !== undefined)
        return err(this.#identityError(operation, imageBase, observations));
      return this.#closed || callerSignal?.aborted
        ? err(
            this.#cancelled(
              operation,
              callerSignal?.aborted
                ? callerSignal.reason
                : STARTUP_OWNER_CLOSED,
              observations,
              this.#observation(cached),
            ),
          )
        : ok(cached);
    }
    const draining = this.#attempt;
    if (draining?.signal.aborted) {
      const waited = await draining.wait(callerSignal);
      if (
        waited.status !== "cancelled" &&
        !waited.value.ok &&
        (waited.value.error.kind !== "cancelled" ||
          waited.value.error.cleanupFailure?.cleanupIncomplete)
      )
        return err(
          this.#projectFailure(
            operation,
            waited.value.error,
            imageBase,
            observations,
          ),
        );
      if (waited.status === "cancelled")
        return err(
          this.#cancelled(operation, callerSignal?.reason, observations),
        );
      if (callerSignal?.aborted)
        return err(
          waited.value.ok
            ? this.#cancelled(
                operation,
                callerSignal.reason,
                observations,
                this.#observation(waited.value.value),
              )
            : this.#cancelled(
                operation,
                callerSignal.reason,
                observations,
                waited.value.error.partialObservation,
              ),
        );
      return this.derive(imageBase, operation, callerSignal, observations);
    }
    const attempt = this.#attempt ?? this.#start(normalized);
    const waited = await attempt.wait(callerSignal);
    if (waited.status === "cancelled")
      return err(
        this.#cancelled(operation, callerSignal?.reason, observations),
      );
    const settled = waited.value;
    // A completed physical failure or retained cleanup outranks a later abort.
    if (!settled.ok) {
      return err(
        this.#projectFailure(operation, settled.error, imageBase, observations),
      );
    }
    if (this.#conflict !== undefined)
      return err(this.#identityError(operation, imageBase, observations));
    if (this.#closed || attempt.signal.aborted || callerSignal?.aborted)
      return err(
        this.#cancelled(
          operation,
          callerSignal?.aborted
            ? callerSignal.reason
            : this.#closed
              ? STARTUP_OWNER_CLOSED
              : attempt.signal.reason,
          observations,
          this.#observation(settled.value),
        ),
      );
    return settled;
  }

  readTypeDetail(address: string) {
    return this.#closed || this.#conflict !== undefined
      ? undefined
      : this.#cached?.readTypeDetail(address, NATIVE_AOT_MAX_REPORT_BYTES);
  }

  #projectFailure(
    operation: AnalysisOperation,
    failure: GhidraSessionError,
    imageBase: string,
    observations: JsonValue,
  ): AnalysisError {
    if (failure.cause instanceof NativeAotSnapshotIdentityError) {
      const mismatch = failure.cause;
      const primary = new AnalysisArtifactChangedError(
        operation,
        this.input.targetPath,
        mismatch.message,
        {
          cause: mismatch,
          diagnostics: {
            expected_sha256: mismatch.expectedSha256,
            observed_sha256: mismatch.observedSha256,
          },
          partialObservation: failure.partialObservation,
        },
      );
      return failure.cleanupFailure?.cleanupIncomplete
        ? analysisErrorWithCleanupFailure(
            primary,
            failure.cleanupFailure,
            operation,
          ).bindCleanupDependencies([primary, failure.cleanupFailure])
        : primary;
    }
    if (failure.kind !== "cancelled" || this.#conflict === undefined)
      return this.input.projectFailure(
        operation,
        failure.withDiagnostics({
          ...failure.diagnostics,
          measured_observation: observations,
        }),
      );
    return this.#identityError(operation, imageBase, observations, failure);
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#cached = undefined;
    const attempt = this.#attempt;
    attempt?.close();
    await attempt?.promise;
  }

  #start(imageBase: string): SharedStartupAttempt<Derivation> {
    this.#failure = undefined;
    this.#capture = undefined;
    const attempt = new SharedStartupAttempt((signal) =>
      this.#read(imageBase, signal),
    );
    this.#attempt = attempt;
    void attempt.promise.then((settled) => {
      if (this.#attempt !== attempt) return;
      this.#attempt = undefined;
      if (!settled.ok) this.#failure = settled.error;
      else if (
        !this.#closed &&
        this.#conflict === undefined &&
        !attempt.signal.aborted
      )
        this.#cached = settled.value;
    });
    return attempt;
  }

  async #read(imageBase: string, signal: AbortSignal): Promise<Derivation> {
    try {
      if (this.input.readSnapshot === undefined)
        return err(
          new GhidraSessionError(
            "protocol",
            "The Ghidra client does not expose its immutable target snapshot for NativeAOT metadata inspection.",
          ),
        );
      const snapshot = await this.input.readSnapshot(
        NATIVE_AOT_MAX_SOURCE_BYTES,
        signal,
      );
      if (!snapshot.ok) return snapshot;
      this.#capture = this.#captureFacts(snapshot.value);
      const partialObservation = this.#observation();
      if (signal.aborted)
        return err(
          new GhidraSessionError(
            "cancelled",
            "NativeAOT snapshot derivation stopped",
            {},
            {
              cause: signal.reason,
              cancellation: { reason: signal.reason },
              ...(partialObservation === undefined
                ? {}
                : { partialObservation }),
            },
          ),
        );
      const parsed =
        snapshot.value.kind === "over-capacity"
          ? {
              summary: nativeAotSnapshotOverCapacity(
                this.input.targetSha256,
                snapshot.value.sourceBytesAtLeast,
                NATIVE_AOT_MAX_REPORT_BYTES,
              ),
              readTypeDetail: () => undefined,
            }
          : parseNativeAotPe(
              snapshot.value.bytes,
              this.input.targetSha256,
              NATIVE_AOT_MAX_REPORT_BYTES,
              imageBase,
            );
      return ok(parsed);
    } catch (cause: unknown) {
      const partialObservation = this.#observation();
      return err(
        new GhidraSessionError(
          "protocol",
          "NativeAOT metadata could not be derived from the captured target snapshot.",
          {},
          {
            cause,
            ...(partialObservation === undefined ? {} : { partialObservation }),
          },
        ),
      );
    }
  }

  #captureFacts(
    snapshot: GhidraTargetSnapshot,
  ): NativeAotSnapshotObservation["capture"] {
    return snapshot.kind === "captured"
      ? { status: "captured", bytes: snapshot.bytes.length }
      : {
          status: "over-capacity",
          source_bytes_at_least: snapshot.sourceBytesAtLeast,
          maximum_bytes: snapshot.maximumBytes,
        };
  }

  #observation(
    result?: NativeAotPeResult,
  ): NativeAotSnapshotObservation | undefined {
    if (this.#capture === undefined || this.#base === undefined)
      return undefined;
    return nativeAotSnapshotObservationSchema.parse({
      kind: "native-aot-snapshot",
      analysis_artifact_sha256: this.input.targetSha256,
      image_base: this.#base,
      capture: this.#capture,
      ...(result === undefined ? {} : { metadata_recovery: result.summary }),
    });
  }

  #cancelled(
    operation: AnalysisOperation,
    reason: unknown,
    observations: JsonValue,
    partialObservation?: AnalysisPartialObservation,
  ): AnalysisError {
    return new AnalysisCancelledError(operation, {
      cause: reason,
      diagnostics: { measured_observation: observations },
      partialObservation,
    });
  }

  #identityError(
    operation: AnalysisOperation,
    imageBase: string,
    observations: JsonValue,
    source:
      | Pick<GhidraSessionError, "partialObservation" | "cleanupFailure">
      | undefined = this.#failure,
  ): AnalysisError {
    const primary = new ProviderAdapterError("ghidra", operation, {
      partialObservation: source?.partialObservation ?? this.#observation(),
      diagnostics: {
        reason:
          "The Ghidra session reported conflicting loaded image bases (a different loaded image base after binding); reopen the analysis session to establish a new identity.",
        artifact_sha256: this.input.targetSha256,
        bound_image_base: this.#base ?? null,
        observed_image_base: imageBase,
        measured_observation: observations,
        conflicting_image_base: this.#conflict?.imageBase ?? null,
        conflicting_observation: this.#conflict?.observations ?? null,
      },
    });
    const cleanup = source?.cleanupFailure ?? this.cleanupFailure;
    return cleanup?.cleanupIncomplete
      ? analysisErrorWithCleanupFailure(
          primary,
          cleanup,
          operation,
        ).bindCleanupDependencies([primary, cleanup])
      : primary;
  }
}

import { translateNativeCommandFailure } from "./NativeCommandAnalysisError.js";
import { DEFAULT_NATIVE_COMMAND_TIMEOUT_MS } from "../domain/native/nativeDeadlines.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";
import { EvidenceIntegrityError } from "../domain/evidenceErrors.js";
import type {
  AnalysisError,
  AnalysisCleanupObservation,
} from "../domain/analysisErrorBase.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { NativeCallPartialObservation } from "../domain/native/nativeCallPartialObservation.js";
import {
  nativeCallEventSchema,
  nativeCallProcessOutcomeSchema,
  nativeCodeLocationSchema,
  type NativeCallObservationInput,
} from "../domain/native/nativeCallObservation.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { err, ok, type Result } from "../domain/result.js";
import { safeParseJson } from "../domain/safeJson.js";
import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
} from "../process/ProviderProcess.js";
import { cleanupOwnedProcessGroup } from "../process/ProcessOwnership.js";
import {
  observeProcessStartIdentity,
  signalProcessWithStartIdentity,
} from "../process/ProcessOwnershipObservation.js";
import type { ProcessIdentityObservation } from "../process/ProcessOwnership.js";
import {
  ProviderStartupDeadline,
  waitForAbortableDelay,
} from "../process/ProviderDeadline.js";
import { DarwinProcessOwnershipInspectionError } from "../process/DarwinProcessRunTokenReader.js";
import { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import {
  NativeCommandFailure,
  resolveXcrunTool,
  type ResolvedTool,
} from "./CommandRunner.js";
import { projectPartialNativeCalls } from "./NativeCallObservation.js";
import { LldbReadbackFiles } from "./LldbReadbackFiles.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { resolvedAnalysisError } from "../domain/analysisErrorBase.js";
import {
  readLldbObservationJournal,
  readBoundedPrefix,
  readPartialCapture,
  projectLldbPartialObservation,
} from "./LldbRetainedObservations.js";

const OPERATION = "observe_native_calls";
const PROVIDER = "native-macos";
const LLDB_REQUIREMENT =
  "LLDB from Xcode or the Command Line Tools is not available";
/** Captured target output kept per stream; the rest is counted, not stored. */
const MAX_OUTPUT_BYTES = 1024 * 1024;
/**
 * LLDB startup, symbol loading and teardown beyond the observation window.
 * This grace has no runtime override; duration_ms is the caller-selected window.
 */
const DEADLINE_GRACE_MS = 60_000;
const DIAGNOSTIC_BYTES = 16 * 1024;

const lldbGraceRecovery = (
  durationMs: number,
): { readonly userMessage: string; readonly remediationAction: string } => {
  const total = durationMs + DEADLINE_GRACE_MS;
  return {
    userMessage: `observe_native_calls reached its ${String(total)} ms server/provider deadline: duration_ms ${String(durationMs)} plus a fixed ${String(DEADLINE_GRACE_MS)} ms LLDB startup, symbol loading, and teardown grace. This is not the MCP client deadline.`,
    remediationAction: `This release has no runtime override for the ${String(DEADLINE_GRACE_MS)} ms grace. Increase duration_ms on the next call when the observation window was too short; the grace stays added to that window. Captured output beyond ${String(MAX_OUTPUT_BYTES)} bytes per stream is counted and not kept, and that byte allowance has no runtime override. Failure diagnostics keep at most ${String(DIAGNOSTIC_BYTES)} bytes and that excerpt has no runtime override. Allow execution, cleanup, and delivery headroom in the outer MCP client deadline. Confirm the owned process was killed and cleanup finished before retrying.`,
  };
};

const BRIDGE = fileURLToPath(
  new URL("../../bridge/native/rea_lldb_tracer.py", import.meta.url),
);

/** JSON the LLDB bridge writes after a completed run. */
const tracedSchema = z.strictObject({
  status: z.literal("traced"),
  version: z.string(),
  pid: z.int().positive(),
  outcome: nativeCallProcessOutcomeSchema,
  exit_status: z.int().nullable(),
  exit_description: z.string().nullable(),
  killed: z.boolean(),
  terminated: z.boolean(),
  target_identity: z.strictObject({
    loaded_image_sha256: z.null(),
    selected_file_sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .nullable(),
    file_device: z.string().nullable(),
    file_inode: z.string().nullable(),
    module_path: z.string().nullable(),
    module_uuid: z.string().nullable(),
    stable: z.boolean(),
  }),
  resource_limit_reached: z.boolean(),
  breakpoint_locations_truncated: z.boolean().optional(),
  target_output: z.strictObject({
    stdout_bytes: z.int().nonnegative(),
    stderr_bytes: z.int().nonnegative(),
    stdout_truncated: z.boolean(),
    stderr_truncated: z.boolean(),
    stdout_complete: z.boolean(),
    stderr_complete: z.boolean(),
  }),
  elapsed_ms: z.number().nonnegative(),
  breakpoints: z.array(
    z.strictObject({
      index: z.int().nonnegative(),
      location_count: z.int().nonnegative(),
      locations: z.array(nativeCodeLocationSchema),
    }),
  ),
  events: z.array(nativeCallEventSchema),
  other_stops: z.array(z.string()),
});

const tracerOutputSchema = z.discriminatedUnion("status", [
  tracedSchema,
  z.strictObject({
    status: z.enum([
      "target-error",
      "target-integrity-error",
      "target-identity-unavailable",
      "launch-error",
      "tracer-error",
    ]),
    error: z.string().nullable(),
    target_process_created: z.boolean().optional(),
    target_process_exit_observed: z.boolean().optional(),
  }),
]);

/** Bounded text of one target output stream. */
export interface CapturedOutput {
  readonly text: string;
  /** Bytes drained from the target, which may exceed the retained prefix. */
  readonly bytes: number;
  readonly truncated: boolean;
  /** Whether the bridge confirms it drained the stream through EOF. */
  readonly complete: boolean;
}

type CapturedOutputRead =
  | { readonly ok: true; readonly value: CapturedOutput }
  | {
      readonly ok: false;
      readonly error: unknown;
      readonly partial?: CapturedOutput;
    };

/** One completed LLDB observation, before projection into the result contract. */
export interface NativeCallTrace {
  readonly debugger: {
    readonly path: string;
    readonly sha256: string;
    readonly version: string | null;
  };
  readonly run: z.infer<typeof tracedSchema>;
  readonly stdout: CapturedOutput;
  readonly stderr: CapturedOutput;
  /** REA confirmed the traced process no longer exists. */
  readonly terminated: boolean;
}

const debuggerIdentity = (
  tool: ResolvedTool,
  version: string | null,
): NativeCallTrace["debugger"] => ({
  path: tool.invocationPath,
  sha256: tool.sha256,
  version,
});

/** Launch one owned process under a debugger and record calls. */
export interface NativeCallTracer {
  trace(
    request: {
      readonly executable: string;
      readonly architecture: string;
      readonly expectedSha256: string;
      readonly input: NativeCallObservationInput;
    },
    signal?: AbortSignal,
  ): Promise<Result<NativeCallTrace, AnalysisError>>;
  /** Retry cleanup retained after a trace could not verify process exit. */
  close(): Promise<Result<null, AnalysisError>>;
}

/** Remediation for a target LLDB may not debug. */
const ATTACH_REMEDIATION =
  "Allow debugging for this user (Developer Tools access: `DevToolsSecurity -enable`, or membership in the _developer group). A hardened-runtime target is debuggable only with the com.apple.security.get-task-allow entitlement; inspect_signature reports hardened_runtime and entitlements.";

/** Production tracer: `lldb --batch` running the REA LLDB bridge. */
export class LldbCallTracer implements NativeCallTracer {
  private readonly environment: NodeJS.ProcessEnv;
  #tail: Promise<void> = Promise.resolve();
  #pendingCleanup: RetainedLldbResources | undefined;
  /** Resolver supervisors owned by this tracer, distinct from the shared Darwin reader. */
  readonly #resolverCleanup = new Map<
    ProviderProcessSupervisor,
    ProviderCleanupError
  >();
  constructor(
    environment: Readonly<NodeJS.ProcessEnv>,
    private readonly launch: typeof runLldb = runLldb,
    private readonly resolveTool: (
      tool: string,
      signal?: AbortSignal,
    ) => ReturnType<typeof resolveXcrunTool> = (tool, signal) =>
      resolveXcrunTool(tool, this.environment, signal),
  ) {
    this.environment = snapshotEnvironment(environment);
  }

  async trace(
    request: Parameters<NativeCallTracer["trace"]>[0],
    signal?: AbortSignal,
  ): Promise<Result<NativeCallTrace, AnalysisError>> {
    return this.#serialize(() => this.#trace(request, signal));
  }

  async #trace(
    request: Parameters<NativeCallTracer["trace"]>[0],
    signal?: AbortSignal,
  ): Promise<Result<NativeCallTrace, AnalysisError>> {
    const resolverCleanup = await this.#retryResolverCleanup();
    if (resolverCleanup !== undefined) return err(resolverCleanup);
    const pendingCleanup = await this.#retryPendingCleanup();
    if (pendingCleanup !== undefined) return err(pendingCleanup);
    const lldb = await this.resolveTool("lldb", signal);
    if (!lldb.ok) return err(this.#discoveryFailure(lldb.error));
    const root = await PrivateRuntimeRoot.create({ prefix: "rea-lldb-" });
    const paths = lldbRuntimePaths(root.path);
    const owner: RetainedLldbResources = {
      root,
      rootLease: new AnalysisCleanupLease(() => root.close(), [root.path]),
      files: new LldbReadbackFiles(),
      supervisor: undefined,
      pidPath: paths.pid,
      resultPath: paths.result,
      targetIdentity: undefined,
      targetPid: undefined,
      processStopped: true,
      targetStopped: true,
    };
    let result: Result<NativeCallTrace, AnalysisError>;
    try {
      result = await this.#run(lldb.value, owner, request, signal);
    } catch (cause: unknown) {
      const partial = await partialNativeObservation({
        request,
        files: owner.files,
        pidPath: paths.pid,
        stdoutPath: paths.stdoutCapture,
        stderrPath: paths.stderrCapture,
        observationPath: paths.observations,
        version: null,
        reason: "tracer-failure",
      });
      if (
        !owner.processStopped ||
        !owner.targetStopped ||
        owner.files.hasPending
      )
        this.#pendingCleanup = owner;
      const failure = new ProviderAdapterError(PROVIDER, OPERATION, {
        cause,
        diagnostics: { reason: errorReason(cause) },
        partialObservation: partial.observation,
        ...(this.#pendingCleanup === owner
          ? {
              cleanup: {
                reason: "LLDB trace failed while owned resources remain",
                resources: lldbCleanupResources(owner),
              },
            }
          : {}),
      });
      result = err(retainPartialReadFailures(failure, partial.readFailures));
    }
    if (result.ok && signal?.aborted)
      result = err(
        new AnalysisCancelledError(OPERATION, {
          cause: signal.reason,
          partialObservation: partialObservationFromTrace(
            request,
            result.value,
            "cancelled",
          ),
        }),
      );
    if (owner.files.hasPending) this.#pendingCleanup = owner;
    if (this.#pendingCleanup === owner) {
      if (!result.ok && result.error.cleanupIncomplete) {
        if (owner.files.hasPending) {
          const files = lldbCleanupFailure(
            owner,
            "LLDB readback descriptor cleanup remains incomplete",
            owner.files.cleanupCause,
          );
          result.error.retainSecondaryFailure(files, {
            readback_cleanup: projectAnalysisError(files),
          });
        }
        return err(bindLldbCleanup(result.error, owner));
      }
      const cleanup = lldbCleanupFailure(
        owner,
        "LLDB readback descriptor cleanup remains incomplete",
        owner.files.cleanupCause,
        result.ok
          ? partialObservationFromTrace(request, result.value)
          : undefined,
      );
      return result.ok
        ? err(cleanup)
        : err(
            analysisErrorWithCleanupFailure(
              result.error,
              cleanup,
              OPERATION,
            ).bindCleanupDependencies([result.error, cleanup]),
          );
    }
    let rootCleanup: Result<void, unknown>;
    try {
      await releaseLldbRuntime(owner);
      rootCleanup = ok(undefined);
    } catch (cause: unknown) {
      rootCleanup = err(cause);
      this.#pendingCleanup = owner;
    }
    if (result.ok && signal?.aborted)
      result = err(
        new AnalysisCancelledError(OPERATION, {
          cause: signal.reason,
          partialObservation: partialObservationFromTrace(
            request,
            result.value,
            "cancelled",
          ),
        }),
      );
    if (!rootCleanup.ok) {
      const cleanup = lldbCleanupFailure(
        owner,
        errorReason(rootCleanup.error),
        rootCleanup.error,
        result.ok
          ? partialObservationFromTrace(request, result.value)
          : undefined,
      );
      if (!result.ok && result.error.cleanupIncomplete)
        bindLldbCleanup(result.error, owner);
      return result.ok
        ? err(cleanup)
        : err(
            analysisErrorWithCleanupFailure(
              result.error,
              cleanup,
              OPERATION,
            ).bindCleanupDependencies([result.error, cleanup]),
          );
    }
    return result.ok
      ? result
      : err(resolvedAnalysisError(bindLldbCleanup(result.error, owner)));
  }

  /** Retry retained LLDB cleanup without abandoning its process or runtime owner. */
  async close(): Promise<Result<null, AnalysisError>> {
    return this.#serialize(() => this.#close());
  }

  async #close(): Promise<Result<null, AnalysisError>> {
    const resolverCleanup = await this.#retryResolverCleanup();
    const failure = await this.#retryPendingCleanup();
    if (resolverCleanup !== undefined && failure !== undefined)
      return err(
        analysisErrorWithCleanupFailure(
          resolverCleanup,
          failure,
          OPERATION,
        ).bindCleanupDependencies([resolverCleanup, failure]),
      );
    if (resolverCleanup !== undefined) return err(resolverCleanup);
    return failure === undefined ? ok(null) : err(failure);
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const call = this.#tail.then(operation, operation);
    this.#tail = call.then(
      () => undefined,
      () => undefined,
    );
    return call;
  }

  async #retryPendingCleanup(): Promise<ProviderCleanupError | undefined> {
    const owner = this.#pendingCleanup;
    if (owner === undefined) return undefined;
    const failures: unknown[] = [];
    // Files are independent children: release them even while process cleanup fails.
    try {
      await owner.files.retryCleanup();
    } catch (cause: unknown) {
      failures.push(cause);
    }
    if (!owner.processStopped) {
      if (owner.supervisor === undefined)
        failures.push(
          new Error("LLDB process cleanup ownership was unavailable"),
        );
      else {
        try {
          const stopped = await owner.supervisor.stop();
          if (stopped.status === "incomplete")
            failures.push(new Error(stopped.reason));
          else {
            owner.supervisor.dispose();
            owner.processStopped = true;
          }
        } catch (cause: unknown) {
          failures.push(cause);
        }
      }
    }
    if (owner.processStopped && !owner.targetStopped) {
      owner.targetPid = await owner.files.readTargetPid(owner.pidPath);
      // A stopped LLDB may have published its result before interruption.
      const published = await readTracerOutput(owner.resultPath, owner.files);
      if (
        bridgeProvesTargetGone(
          published.ok ? published.value : undefined,
          owner.targetPid,
        )
      )
        owner.targetStopped = true;
      else {
        try {
          const targetTermination = await ensureTerminated(
            owner.targetPid,
            owner.targetIdentity,
          );
          if (targetTermination !== "terminated")
            failures.push(
              new Error(targetTerminationReason(targetTermination)),
            );
          else owner.targetStopped = true;
        } catch (cause: unknown) {
          failures.push(cause);
        }
      }
    }
    if (failures.length === 0) {
      try {
        await releaseLldbRuntime(owner);
        this.#pendingCleanup = undefined;
        return undefined;
      } catch (cause: unknown) {
        failures.push(cause);
      }
    }
    return lldbCleanupFailure(
      owner,
      failures.map(errorReason).join("; "),
      new AggregateError(failures, "LLDB cleanup remains incomplete"),
    );
  }

  /**
   * Keep a tracer-owned resolver process for retry. A foreign helper marker
   * stays on the preparation error and is not adopted here.
   */
  #retainResolverCleanup(failure: NativeCommandFailure): void {
    const owned = [
      ...failure.cleanupFailures.map((entry) => ({
        owner: entry.owner,
        marker: entry.marker,
        reason: entry.reason,
        resources: entry.resources,
      })),
      ...(failure.cleanupOwner === undefined
        ? []
        : [
            {
              owner: failure.cleanupOwner,
              marker: failure.cleanupMarker,
              reason:
                failure.cleanupFailure ??
                "LLDB resolver cleanup remains incomplete",
              resources: [...failure.cleanupResources],
            },
          ]),
    ];
    for (const entry of owned) {
      if (this.#resolverCleanup.has(entry.owner)) continue;
      const marker =
        entry.marker ??
        new ProviderCleanupError(
          PROVIDER,
          entry.resources.length > 0
            ? entry.resources
            : ["lldb-resolver-process"],
          { reason: entry.reason },
          { operation: OPERATION, cause: failure },
        );
      this.#resolverCleanup.set(entry.owner, marker);
    }
  }

  #discoveryFailure(failure: NativeCommandFailure): AnalysisError {
    this.#retainResolverCleanup(failure);
    const markers = [
      ...new Set(
        [
          failure.cleanupOwner,
          ...failure.cleanupFailures.map((entry) => entry.owner),
        ].flatMap((owner) => {
          if (owner === undefined) return [];
          const marker = this.#resolverCleanup.get(owner);
          return marker === undefined ? [] : [marker];
        }),
      ),
    ];
    const error = translateNativeCommandFailure(
      OPERATION,
      failure,
      DEFAULT_NATIVE_COMMAND_TIMEOUT_MS,
      {
        unavailableMessage: LLDB_REQUIREMENT,
        timeoutRecovery: {
          userMessage: `LLDB discovery reached REA's ${String(DEFAULT_NATIVE_COMMAND_TIMEOUT_MS)}ms xcrun deadline. This is not the client deadline.`,
          remediationAction:
            "Inspect the retained discovery output and cleanup state, then resolve the xcrun/toolchain condition before retrying. This LLDB discovery deadline has no runtime override; duration_ms controls the later target observation window.",
        },
      },
    );
    return markers.length === 0
      ? error
      : error.bindCleanupDependencies(markers);
  }

  /** Retry only resolver processes this tracer spawned. */
  async #retryResolverCleanup(): Promise<ProviderCleanupError | undefined> {
    const retained = [...this.#resolverCleanup];
    if (retained.length === 0) return undefined;
    const unresolved: ProviderCleanupError[] = [];
    for (const [owner, marker] of retained) {
      let released = false;
      try {
        const stopped = await owner.stop();
        released =
          stopped.status !== "incomplete" && stopped.status !== "not-owned";
      } catch {
        released = false;
      }
      if (!released) {
        unresolved.push(marker);
        continue;
      }
      marker.resolveCleanup();
      this.#resolverCleanup.delete(owner);
    }
    if (unresolved.length === 0) return undefined;
    if (unresolved.length === 1) return unresolved[0];
    return new ProviderCleanupError(
      PROVIDER,
      [...new Set(unresolved.flatMap((marker) => marker.cleanupResources))],
      { reason: "LLDB resolver cleanup remains incomplete" },
      {
        operation: OPERATION,
        cause: new AggregateError(
          unresolved,
          "LLDB resolver cleanup remains incomplete",
        ),
      },
    ).bindCleanupDependencies(unresolved);
  }

  async #run(
    lldb: ResolvedTool,
    retained: RetainedLldbResources,
    request: Parameters<NativeCallTracer["trace"]>[0],
    signal?: AbortSignal,
  ): Promise<Result<NativeCallTrace, AnalysisError>> {
    const directory = retained.root.path;
    const paths = lldbRuntimePaths(directory);
    const { input } = request;
    await writeFile(
      paths.config,
      JSON.stringify({
        executable: request.executable,
        architecture: request.architecture,
        expected_sha256: request.expectedSha256,
        arguments: input.arguments,
        environment: input.environment,
        working_directory: input.working_directory ?? null,
        breakpoints: input.breakpoints.map((breakpoint) =>
          breakpoint.kind === "function"
            ? { ...breakpoint, module: breakpoint.module ?? null }
            : { ...breakpoint, class_name: breakpoint.class_name ?? null },
        ),
        duration_ms: input.duration_ms,
        max_events: input.max_events,
        argument_registers: input.argument_registers,
        backtrace_frames: input.backtrace_frames,
        max_output_bytes: MAX_OUTPUT_BYTES,
        stdout_path: paths.stdout,
        stderr_path: paths.stderr,
        stdout_capture_path: paths.stdoutCapture,
        stderr_capture_path: paths.stderrCapture,
        result_path: paths.result,
        pid_path: paths.pid,
        identity_ack_path: paths.identityAck,
        observation_path: paths.observations,
      }),
      { mode: 0o600 },
    );
    retained.processStopped = false;
    retained.targetStopped = false;
    this.#pendingCleanup = retained;
    const exited = await this.launch(
      lldb.invocationPath,
      [
        "--batch",
        "--no-lldbinit",
        "--no-use-colors",
        "-o",
        `command script import ${quote(BRIDGE)}`,
        "-o",
        `rea_trace ${paths.config}`,
      ],
      {
        deadlineMs: input.duration_ms + DEADLINE_GRACE_MS,
        pidPath: paths.pid,
        identityAckPath: paths.identityAck,
        environment: this.environment,
        files: retained.files,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    if (exited.kind === "preparation-failed") {
      // LLDB was never spawned. Release only this tracer's runtime and keep
      // the shared helper marker on the preparation error.
      retained.processStopped = true;
      retained.targetStopped = true;
      if (this.#pendingCleanup === retained) this.#pendingCleanup = undefined;
      return err(lldbPreparationFailure(exited.cause));
    }
    retained.supervisor = exited.cleanupOwner;
    retained.targetIdentity = exited.targetIdentity;
    retained.processStopped =
      exited.cleanupOwner === undefined && exited.cleanupFailure === undefined;
    retained.targetStopped = !exited.targetLaunched;
    // The bridge publishes its result once, at the end of rea_trace. Once LLDB
    // stopped, an interrupted run still owns that result's target facts, while
    // only an exited LLDB selects it as the primary outcome.
    const readback =
      exited.kind === "exited" ||
      (exited.targetLaunched && retained.processStopped)
        ? await readTracerOutput(paths.result, retained.files)
        : undefined;
    const published = readback?.ok ? readback.value : undefined;
    const output = exited.kind === "exited" ? published : undefined;
    retained.targetPid = await retained.files.readTargetPid(paths.pid);
    const targetTermination: TargetTermination =
      exited.targetLaunched &&
      !bridgeProvesTargetGone(published, retained.targetPid)
        ? await ensureTerminated(retained.targetPid, exited.targetIdentity)
        : "terminated";
    retained.targetStopped = targetTermination === "terminated";
    if (
      retained.processStopped &&
      retained.targetStopped &&
      !retained.files.hasPending
    )
      this.#pendingCleanup = undefined;
    const terminated = targetTermination === "terminated";
    const cleanupDetails = [
      exited.cleanupFailure,
      ...(terminated ? [] : [targetTerminationReason(targetTermination)]),
    ].filter((detail): detail is string => detail !== undefined);
    const lifecycleCleanup =
      cleanupDetails.length === 0
        ? undefined
        : {
            reason: cleanupDetails.join("; "),
            resources: lldbCleanupResources(retained),
          };
    const partialReason =
      exited.kind === "cancelled"
        ? "cancelled"
        : exited.kind === "timeout"
          ? "timeout"
          : lifecycleCleanup !== undefined
            ? "cleanup-failure"
            : "tracer-failure";
    const readCompletedCaptures = async (
      run: z.infer<typeof tracedSchema>,
    ) => ({
      stdout: await capturedOutput(
        paths.stdoutCapture,
        run.target_output.stdout_bytes,
        run.target_output.stdout_truncated,
        run.target_output.stdout_complete,
        retained.files,
      ),
      stderr: await capturedOutput(
        paths.stderrCapture,
        run.target_output.stderr_bytes,
        run.target_output.stderr_truncated,
        run.target_output.stderr_complete,
        retained.files,
      ),
    });
    const getPartialObservation = async (
      reason: NativeCallPartialObservation["coverage"]["reason"] = partialReason,
    ): Promise<PartialNativeObservationRead> => {
      // Cleanup uncertainty does not invalidate a completed, validated result.
      // Keep host termination proof separate from the bridge's reported facts.
      if (output?.status === "traced") {
        const { stdout, stderr } = await readCompletedCaptures(output);
        return {
          observation: projectPartialNativeCalls(
            {
              path: request.executable,
              sha256: request.expectedSha256,
              architecture: request.architecture,
            },
            request.input,
            {
              debugger: debuggerIdentity(lldb, output.version),
              run: output,
              stdout: stdout.ok ? stdout.value : (stdout.partial ?? null),
              stderr: stderr.ok ? stderr.value : (stderr.partial ?? null),
              terminated,
            },
            reason,
          ),
          readFailures: [
            ...(stdout.ok ? [] : [stdout.error]),
            ...(stderr.ok ? [] : [stderr.error]),
          ],
        };
      }
      return partialNativeObservation({
        request,
        files: retained.files,
        pidPath: paths.pid,
        stdoutPath: paths.stdoutCapture,
        stderrPath: paths.stderrCapture,
        observationPath: paths.observations,
        version: null,
        reason,
      });
    };
    const failureWithPartial = async <Failure extends AnalysisError>(
      createFailure: (observation: NativeCallPartialObservation) => Failure,
      reason?: NativeCallPartialObservation["coverage"]["reason"],
    ): Promise<Result<NativeCallTrace, AnalysisError>> => {
      const partial = await getPartialObservation(reason);
      return err(
        retainPartialReadFailures(
          createFailure(partial.observation),
          partial.readFailures,
        ),
      );
    };
    if (exited.kind === "cancelled")
      return failureWithPartial(
        (partialObservation) =>
          new AnalysisCancelledError(OPERATION, {
            cause: signal?.reason,
            ...(lifecycleCleanup === undefined
              ? {}
              : { cleanup: lifecycleCleanup }),
            partialObservation,
          }),
      );
    if (exited.kind === "timeout")
      return failureWithPartial(
        (partialObservation) =>
          new AnalysisTimeoutError(
            OPERATION,
            input.duration_ms + DEADLINE_GRACE_MS,
            {
              ...(lifecycleCleanup === undefined
                ? {}
                : { cleanup: lifecycleCleanup }),
              partialObservation,
              ...lldbGraceRecovery(input.duration_ms),
            },
          ),
      );
    if (output !== undefined && output.status !== "traced")
      return failureWithPartial((partialObservation) =>
        tracerFailure(output, lifecycleCleanup, partialObservation),
      );
    const processCleanupFailure = exited.cleanupFailure;
    if (processCleanupFailure !== undefined)
      return failureWithPartial(
        (partialObservation) =>
          new ProviderCleanupError(
            PROVIDER,
            lldbCleanupResources(retained),
            {
              reason: "LLDB process-group cleanup could not be verified",
              cleanup_failure: processCleanupFailure,
              ...(lifecycleCleanup === undefined
                ? {}
                : { target_cleanup: lifecycleCleanup }),
            },
            {
              operation: OPERATION,
              partialObservation,
            },
          ),
      );
    if (!terminated)
      return failureWithPartial(
        (partialObservation) =>
          new ProviderCleanupError(
            PROVIDER,
            lldbCleanupResources(retained),
            {
              reason: "LLDB target process termination could not be verified",
              ...(lifecycleCleanup === undefined
                ? {}
                : { target_cleanup: lifecycleCleanup }),
            },
            {
              operation: OPERATION,
              partialObservation,
            },
          ),
      );
    if (output === undefined)
      return failureWithPartial(
        (partialObservation) =>
          new ProviderAdapterError(PROVIDER, OPERATION, {
            ...(readback !== undefined && !readback.ok
              ? { cause: readback.error }
              : {}),
            diagnostics: {
              reason: "LLDB exited without a usable tracer result",
              ...(readback !== undefined && !readback.ok
                ? {
                    result_failure:
                      readback.error instanceof z.ZodError
                        ? `Tracer result failed schema validation (${readback.error.issues.length} issues)`
                        : readback.error instanceof Error
                          ? readback.error.message
                          : String(readback.error),
                  }
                : {}),
              exit_code: exited.exitCode,
              lldb_output: exited.output,
              ...(lifecycleCleanup === undefined
                ? {}
                : { target_cleanup: lifecycleCleanup }),
            },
            partialObservation,
            ...(lifecycleCleanup === undefined
              ? {}
              : { cleanup: lifecycleCleanup }),
          }),
      );
    const { stdout, stderr } = await readCompletedCaptures(output);
    if (!stdout.ok || !stderr.ok) {
      return err(
        new ProviderAdapterError(PROVIDER, OPERATION, {
          cause: new AggregateError(
            [
              ...(stdout.ok ? [] : [stdout.error]),
              ...(stderr.ok ? [] : [stderr.error]),
            ],
            "LLDB capture readback failed",
          ),
          partialObservation: projectPartialNativeCalls(
            {
              path: request.executable,
              sha256: request.expectedSha256,
              architecture: request.architecture,
            },
            request.input,
            {
              debugger: debuggerIdentity(lldb, output.version),
              run: output,
              stdout: stdout.ok ? stdout.value : (stdout.partial ?? null),
              stderr: stderr.ok ? stderr.value : (stderr.partial ?? null),
              terminated,
            },
            "capture-failure",
          ),
          diagnostics: {
            reason: "LLDB target output capture could not be read",
            ...(stdout.ok
              ? {}
              : { stdout_capture_error: errorReason(stdout.error) }),
            ...(stderr.ok
              ? {}
              : { stderr_capture_error: errorReason(stderr.error) }),
            ...(lifecycleCleanup === undefined
              ? {}
              : { target_cleanup: lifecycleCleanup }),
          },
          ...(lifecycleCleanup === undefined
            ? {}
            : { cleanup: lifecycleCleanup }),
        }),
      );
    }
    const trace: NativeCallTrace = {
      debugger: debuggerIdentity(lldb, output.version),
      run: output,
      stdout: stdout.value,
      stderr: stderr.value,
      terminated,
    };
    if (exited.lateTimeout === true)
      return err(
        new AnalysisTimeoutError(
          OPERATION,
          input.duration_ms + DEADLINE_GRACE_MS,
          {
            partialObservation: partialObservationFromTrace(
              request,
              trace,
              "timeout",
            ),
            ...lldbGraceRecovery(input.duration_ms),
          },
        ),
      );
    return ok(trace);
  }
}

/** LLDB command arguments are quoted; the bridge path is REA's own install path. */
const quote = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/** Preserve a decoded bridge failure's type independently of cleanup outcome. */
const tracerFailure = (
  output: {
    readonly status:
      | "target-error"
      | "target-integrity-error"
      | "target-identity-unavailable"
      | "launch-error"
      | "tracer-error";
    readonly error: string | null;
  },
  cleanup?: AnalysisCleanupObservation,
  partialObservation?: NativeCallPartialObservation,
): AnalysisError => {
  const options = {
    ...(cleanup === undefined ? {} : { cleanup }),
    ...(partialObservation === undefined ? {} : { partialObservation }),
  };
  const message = output.error ?? "no LLDB error text";
  if (output.status === "target-integrity-error")
    return new EvidenceIntegrityError(
      message || "The launched native target did not match its session digest",
      options,
    );
  if (output.status === "target-identity-unavailable")
    return new ProviderAdapterError(PROVIDER, OPERATION, {
      ...options,
      diagnostics: {
        reason: message,
        constraint: "target process start identity could not be verified",
      },
    });
  if (output.status === "tracer-error")
    return new ProviderAdapterError(PROVIDER, OPERATION, {
      ...options,
      diagnostics: { reason: `LLDB bridge failed: ${message}` },
    });
  if (output.status === "target-error")
    return new AnalysisCapabilityUnavailableError(
      PROVIDER,
      OPERATION,
      `lldb-target-unloadable: ${message}`,
      options,
    );
  // debugserver reports denied task access as an attach failure.
  return /attach|not allowed|permission|denied|debugserver/iu.test(message)
    ? new AnalysisCapabilityUnavailableError(
        PROVIDER,
        OPERATION,
        `debugger-attach-denied: ${message}`,
        { userMessage: ATTACH_REMEDIATION, ...options },
      )
    : new AnalysisCapabilityUnavailableError(
        PROVIDER,
        OPERATION,
        `launch-failed: ${message}`,
        options,
      );
};

interface PartialNativeObservationRead {
  readonly observation: NativeCallPartialObservation;
  readonly readFailures: readonly unknown[];
}

const retainPartialReadFailures = <Failure extends AnalysisError>(
  failure: Failure,
  readFailures: readonly unknown[],
): Failure => {
  if (readFailures.length === 0) return failure;
  const readbackFailure = new ProviderAdapterError(PROVIDER, OPERATION, {
    cause:
      readFailures.length === 1
        ? readFailures[0]
        : new AggregateError(readFailures, "LLDB partial readback failed"),
    diagnostics: {
      reason: "LLDB could not read all available partial observation data",
      read_failures: readFailures.map(errorReason),
    },
  });
  return failure.retainSecondaryFailure(readbackFailure, {
    partial_readback_failure: projectAnalysisError(readbackFailure),
  });
};

const partialNativeObservation = async (options: {
  readonly request: Parameters<NativeCallTracer["trace"]>[0];
  readonly files: LldbReadbackFiles;
  readonly pidPath: string;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly observationPath: string;
  readonly version: string | null;
  readonly reason: NativeCallPartialObservation["coverage"]["reason"];
}): Promise<PartialNativeObservationRead> => {
  const [journal, pid, stdout, stderr] = await Promise.all([
    readLldbObservationJournal(options.observationPath, options.files),
    options.files.readTargetPid(options.pidPath),
    readPartialCapture(options.stdoutPath, options.files),
    readPartialCapture(options.stderrPath, options.files),
  ]);
  const observation = projectLldbPartialObservation({
    target: {
      path: options.request.executable,
      sha256: options.request.expectedSha256,
      architecture: options.request.architecture,
      arguments: options.request.input.arguments,
      environment: options.request.input.environment,
      working_directory: options.request.input.working_directory ?? null,
    },
    pid,
    stdout: stdout.ok ? stdout.value.capture : null,
    stderr: stderr.ok ? stderr.value.capture : null,
    version: options.version,
    journal: journal.ok
      ? journal.value.parsed
      : { events: [], otherStops: [], limitations: [] },
    journalLimitations: journal.ok
      ? journal.value.limitations
      : [
          `The observation journal could not be read: ${errorReason(journal.error)}`,
        ],
    limitations: [
      ...(stdout.ok
        ? stdout.value.limitations
        : [
            `The target stdout capture could not be read: ${errorReason(stdout.error)}`,
          ]),
      ...(stderr.ok
        ? stderr.value.limitations
        : [
            `The target stderr capture could not be read: ${errorReason(stderr.error)}`,
          ]),
    ],
    reason: options.reason,
  });
  const readFailures = [journal, stdout, stderr].flatMap((read) =>
    !read.ok
      ? [read.error]
      : read.value.status === "read-failure"
        ? [read.value.readFailure]
        : [],
  );
  return { observation, readFailures };
};

const partialObservationFromTrace = (
  request: Parameters<NativeCallTracer["trace"]>[0],
  trace: NativeCallTrace,
  reason: NativeCallPartialObservation["coverage"]["reason"] = "cleanup-failure",
): NativeCallPartialObservation => {
  return projectPartialNativeCalls(
    {
      path: request.executable,
      sha256: request.expectedSha256,
      architecture: request.architecture,
    },
    request.input,
    trace,
    reason,
  );
};

const lldbRuntimePaths = (directory: string) => ({
  config: join(directory, "config.json"),
  result: join(directory, "result.json"),
  pid: join(directory, "pid"),
  identityAck: join(directory, "identity.ack"),
  stdout: join(directory, "stdout"),
  stderr: join(directory, "stderr"),
  stdoutCapture: join(directory, "stdout.capture"),
  stderrCapture: join(directory, "stderr.capture"),
  observations: join(directory, "observations.jsonl"),
});

const readTracerOutput = async (
  path: string,
  files: LldbReadbackFiles,
): Promise<Result<z.infer<typeof tracerOutputSchema>, unknown>> => {
  const bytes = await files.read(path, (file) => file.readFile());
  if (!bytes.ok) return bytes;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes.value,
    );
  } catch (cause: unknown) {
    return err(cause);
  }
  const parsed = safeParseJson(text);
  if (!parsed.ok) return err(parsed.cause);
  const output = tracerOutputSchema.safeParse(parsed.value);
  return output.success ? ok(output.data) : err(output.error);
};

/**
 * An explicit bridge observation can prove no process was created (with no
 * published PID) or that the created process exited. A missing PID alone, an
 * unreadable result, or a traced result remains ambiguous.
 */
const bridgeProvesTargetGone = (
  output: z.infer<typeof tracerOutputSchema> | undefined,
  targetPid: number | undefined,
): boolean =>
  output !== undefined &&
  output.status !== "traced" &&
  (output.target_process_exit_observed === true ||
    (output.target_process_created === false && targetPid === undefined));

const capturedOutput = async (
  path: string,
  observedBytes: number,
  truncated: boolean,
  complete: boolean,
  files: LldbReadbackFiles,
): Promise<CapturedOutputRead> => {
  const readback = await files.read(path, async (handle) => {
    const { size } = await handle.stat();
    const read = await readBoundedPrefix(
      Math.min(size, MAX_OUTPUT_BYTES),
      async (target, offset, length, position) =>
        (await handle.read(target, offset, length, position)).bytesRead,
    );
    const { buffer, bytesRead } = read;
    if (read.status === "read-failure" && bytesRead === 0) throw read.cause;
    return {
      status: read.status,
      capture: {
        text: buffer.subarray(0, bytesRead).toString("utf8"),
        bytes: observedBytes,
        truncated:
          truncated ||
          size > MAX_OUTPUT_BYTES ||
          read.status === "read-failure",
        complete:
          read.status !== "read-failure" &&
          complete &&
          bytesRead >= Math.min(observedBytes, MAX_OUTPUT_BYTES),
      },
      ...(read.status === "read-failure" ? { readFailure: read.cause } : {}),
    };
  });
  if (!readback.ok) return readback;
  if (readback.value.status === "read-failure")
    return {
      ok: false,
      error: readback.value.readFailure,
      partial: readback.value.capture,
    };
  return ok(readback.value.capture);
};

interface RetainedLldbResources {
  readonly root: PrivateRuntimeRoot;
  readonly rootLease: AnalysisCleanupLease;
  readonly files: LldbReadbackFiles;
  readonly pidPath: string;
  readonly resultPath: string;
  supervisor: ProviderProcessSupervisor | undefined;
  targetIdentity: string | undefined;
  targetPid: number | undefined;
  processStopped: boolean;
  targetStopped: boolean;
}

const errorReason = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** Preserve compiler facts and a foreign helper marker without inventing an LLDB exit. */
const lldbPreparationFailure = (
  cause: DarwinProcessOwnershipInspectionError,
): AnalysisError => {
  const marker = cause.cleanupFailure;
  const compiler = cause.compilerOutcome;
  const options = {
    cause,
    ...(cause.capturedOutput === undefined
      ? {}
      : { capturedOutput: cause.capturedOutput }),
    ...(marker === undefined
      ? {}
      : {
          cleanup: {
            reason: marker.message,
            resources: [...marker.cleanupResources],
          },
        }),
    diagnostics: {
      phase: "process-preparation" as const,
      tool: "lldb" as const,
      reason: cause.message,
      ...(compiler === undefined
        ? {}
        : {
            compiler_outcome: {
              outcome: compiler.outcome,
              code: compiler.code,
              signal: compiler.signal,
              ...(compiler.timeoutMs === undefined
                ? {}
                : { timeout_ms: compiler.timeoutMs }),
            },
          }),
    },
  };
  const error =
    cause.cancellation === undefined
      ? new ProviderAdapterError(PROVIDER, OPERATION, options)
      : new AnalysisCancelledError(OPERATION, {
          ...options,
          cause: cause.cancellation.reason,
        });
  return marker === undefined ? error : error.bindCleanupDependencies([marker]);
};

/** Root release certifies the hierarchy only after every child confirms completion. */
const releaseLldbRuntime = async (
  owner: RetainedLldbResources,
): Promise<void> => {
  if (!owner.processStopped || !owner.targetStopped || owner.files.hasPending)
    throw new Error("LLDB runtime still owns unresolved child resources");
  await owner.rootLease.release();
};

const bindLldbCleanup = <Failure extends AnalysisError>(
  failure: Failure,
  owner: RetainedLldbResources,
): Failure => {
  if (failure.cleanupIncomplete) {
    owner.rootLease.bindCleanupError(failure);
    failure.bindCleanupResourceOwner({
      get cleanupResources() {
        return lldbCleanupResources(owner);
      },
    });
  }
  return failure;
};

const lldbCleanupFailure = (
  owner: RetainedLldbResources,
  reason: string,
  cause: unknown,
  partialObservation?: NativeCallPartialObservation,
): ProviderCleanupError =>
  bindLldbCleanup(
    new ProviderCleanupError(
      PROVIDER,
      lldbCleanupResources(owner),
      { reason },
      { operation: OPERATION, cause, partialObservation },
    ),
    owner,
  );

type LldbOutcome =
  | {
      readonly kind: "exited";
      readonly exitCode: number | null;
      readonly output: string;
    }
  | { readonly kind: "cancelled" }
  | { readonly kind: "timeout" };

type LldbExit =
  | (LldbOutcome & {
      /** False proves LLDB never started and could not have created a target. */
      readonly targetLaunched: boolean;
      readonly targetIdentity: string | undefined;
      readonly cleanupFailure: string | undefined;
      /** Internal deadline elapsed during cleanup after a physical LLDB exit. */
      readonly lateTimeout?: true;
      readonly cleanupOwner?: ProviderProcessSupervisor;
    })
  | {
      readonly kind: "preparation-failed";
      readonly cause: DarwinProcessOwnershipInspectionError;
      readonly targetLaunched: false;
      readonly targetIdentity: undefined;
      readonly cleanupFailure: undefined;
    };

const lldbCleanupResources = (owner: RetainedLldbResources): string[] => [
  ...(owner.processStopped ? [] : ["lldb-process-group"]),
  ...(owner.targetStopped
    ? []
    : [`native-target:${String(owner.targetPid ?? "unknown")}`]),
  ...owner.files.cleanupResources,
  ...(owner.rootLease.released ? [] : [owner.root.path]),
];

/** Supervise LLDB as an owned process group while observing its target PID identity. */
const runLldb = async (
  executable: string,
  arguments_: readonly string[],
  options: {
    readonly signal?: AbortSignal;
    readonly deadlineMs: number;
    readonly pidPath: string;
    readonly identityAckPath: string;
    readonly environment: Readonly<NodeJS.ProcessEnv>;
    readonly files: LldbReadbackFiles;
  },
): Promise<LldbExit> => {
  if (options.signal?.aborted === true)
    return {
      kind: "cancelled",
      targetLaunched: false,
      targetIdentity: undefined,
      cleanupFailure: undefined,
    };
  const deadline = new ProviderStartupDeadline(
    options.deadlineMs,
    options.signal,
  );
  let targetIdentity: string | undefined;
  let supervisor: ProviderProcessSupervisor | undefined;
  let retained = false;
  let processFailureBeforeInterruption:
    | {
        readonly exitCode: number | null;
        readonly output: string;
      }
    | undefined;
  const finish = async (outcome: LldbOutcome): Promise<LldbExit> => {
    // Select the primary result once at the owner boundary, before cleanup.
    // An exit observed before interruption outranks an interrupted wait, while
    // an already selected exit keeps its fuller snapshot and diagnostics.
    const selectedOutcome =
      outcome.kind !== "exited" &&
      processFailureBeforeInterruption !== undefined
        ? { kind: "exited" as const, ...processFailureBeforeInterruption }
        : outcome;
    const stopped = await supervisor?.stop();
    retained = stopped?.status === "incomplete";
    const lateTimeout =
      selectedOutcome.kind === "exited" && deadline.interruption === "timeout"
        ? true
        : undefined;
    return {
      ...selectedOutcome,
      targetLaunched: supervisor !== undefined,
      targetIdentity,
      cleanupFailure:
        stopped?.status === "incomplete" ? stopped.reason : undefined,
      ...(lateTimeout === undefined ? {} : { lateTimeout }),
      ...(retained && supervisor !== undefined
        ? { cleanupOwner: supervisor }
        : {}),
    };
  };
  try {
    const launched = await spawnOwnedProviderProcess({
      command: executable,
      arguments: arguments_,
      runId: randomUUID(),
      // xcrun-selected toolchains may supply interpreter or exec launchers.
      // Cleanup still requires native generation and run-token ownership.
      expectedCommand: null,
      signal: deadline.signal,
      hostEnvironment: options.environment,
    });
    supervisor = new ProviderProcessSupervisor(
      {
        ...launched,
        ownsProcessLifetime: true,
        cleanup: () => cleanupOwnedProcessGroup(launched.ownership),
      },
      {
        maxDiagnosticBytes: DIAGNOSTIC_BYTES,
        onDiagnostic: (event) => {
          // Latch failure at the process event; a later snapshot cannot order it against abort.
          if (
            event.type === "exit" &&
            deadline.interruption === undefined &&
            (event.signal !== null || (event.code !== null && event.code !== 0))
          )
            processFailureBeforeInterruption ??= {
              exitCode: event.code,
              output:
                `${event.snapshot.stdout.text}${event.snapshot.stderr.text}`.slice(
                  -DIAGNOSTIC_BYTES,
                ),
            };
        },
      },
    );
    let identityAckWritten = false;
    while (!(await supervisor.waitForOutputClose(20))) {
      const pid = await options.files.readTargetPid(options.pidPath);
      if (pid !== undefined && !identityAckWritten) {
        let observation: ProcessIdentityObservation | undefined;
        try {
          observation = await observeProcessStartIdentity(pid);
        } catch {
          observation = undefined;
        }
        if (observation?.state === "readable")
          targetIdentity = observation.identity;
        await writeFile(
          options.identityAckPath,
          observation?.state === "readable" ? "readable" : "unavailable",
          { mode: 0o600 },
        );
        identityAckWritten = true;
      }
      const interruption = deadline.interruption;
      if (interruption !== undefined) {
        return await finish({ kind: interruption });
      }
      await waitForAbortableDelay(20, deadline.signal);
    }
    const snapshot = supervisor.snapshot();
    const interruption = deadline.interruption;
    return await finish(
      // Closed output with an observed exit owns a physical result. Read it
      // before the outer success-only cancellation projection retains facts.
      interruption === undefined || supervisor.observedExit() !== undefined
        ? {
            kind: "exited",
            exitCode: snapshot.exitCode ?? null,
            output: `${snapshot.stdout.text}${snapshot.stderr.text}`.slice(
              -DIAGNOSTIC_BYTES,
            ),
          }
        : { kind: interruption },
    );
  } catch (cause: unknown) {
    if (
      supervisor === undefined &&
      cause instanceof DarwinProcessOwnershipInspectionError
    ) {
      return {
        kind: "preparation-failed",
        cause,
        targetLaunched: false,
        targetIdentity: undefined,
        cleanupFailure: undefined,
      };
    }
    const interruption = deadline.interruption;
    return await finish(
      interruption === undefined
        ? {
            kind: "exited",
            exitCode: null,
            output: cause instanceof Error ? cause.message : String(cause),
          }
        : { kind: interruption },
    );
  } finally {
    if (!retained) supervisor?.dispose();
    deadline.dispose();
  }
};

type TargetTermination =
  | "terminated"
  | "identity-unavailable"
  | "identity-changed"
  | "signal-did-not-stop";

/** Only signal a surviving target when its captured OS start identity still matches. */
const ensureTerminated = async (
  pid: number | undefined,
  identity: string | undefined,
): Promise<TargetTermination> => {
  if (pid === undefined) return "identity-unavailable";
  let signalDisposition: Exclude<TargetTermination, "terminated"> | undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!alive(pid)) return "terminated";
    if (attempt === 10) {
      if (identity === undefined) signalDisposition = "identity-unavailable";
      else {
        const result = await signalProcessWithStartIdentity(
          pid,
          identity,
          "SIGKILL",
        );
        if (result === "gone") return "terminated";
        if (result === "identity-changed")
          signalDisposition = "identity-changed";
        else if (result === "unverified")
          signalDisposition = "identity-unavailable";
        else if (result === "signaled")
          signalDisposition = "signal-did-not-stop";
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !alive(pid)
    ? "terminated"
    : (signalDisposition ?? "identity-unavailable");
};

const targetTerminationReason = (termination: TargetTermination): string => {
  switch (termination) {
    case "terminated":
      return "target process terminated";
    case "identity-unavailable":
      return "target process start identity was unavailable; survivor was left untouched";
    case "identity-changed":
      return "target PID start identity changed; replacement process was left untouched";
    case "signal-did-not-stop":
      return "verified target did not exit after SIGKILL";
  }
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause: unknown) {
    return !(
      cause instanceof Error &&
      "code" in cause &&
      cause.code === "ESRCH"
    );
  }
};

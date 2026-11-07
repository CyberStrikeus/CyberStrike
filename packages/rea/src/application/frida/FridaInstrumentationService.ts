import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  resolvedAnalysisError,
  type AnalysisError,
} from "../../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import {
  AnalysisAccessDeniedError,
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
} from "../../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../../domain/result.js";
import { fridaSessionStatusInputSchema } from "../../domain/fridaSessionStatus.js";
import { parseAnalysisInput } from "../AnalysisInput.js";
import {
  requireAnalysisViewRetention,
  summarizeRetainedAnalysis,
  type AnalysisViewRetention,
} from "../analysisView/AnalysisViewService.js";
import { fridaCaptureLimitations } from "../../frida/fridaCaptureLimits.js";
import { unknownFridaSession } from "./fridaInputErrors.js";
import { FridaScriptLoadCancelledError } from "./FridaInstrumentationPort.js";
import type {
  FridaDeviceList,
  FridaProcessList,
} from "../../domain/fridaDiscovery.js";
import type {
  FridaDeviceSelector,
  FridaInstrumentationPort,
  FridaRemoteConnection,
  FridaScriptObservation,
  FridaScriptSource,
  FridaSessionObservation,
  FridaSessionStatus,
  StartFridaSessionInput,
} from "./FridaInstrumentationPort.js";

type FridaSessionCloseResult = Awaited<
  ReturnType<FridaInstrumentationPort["closeSession"]>
>;
type FridaSessionCancellation = {
  readonly operation: string;
  readonly input: StartFridaSessionInput;
  readonly cause: unknown;
  readonly diagnostics?: AnalysisError["diagnostics"];
  readonly observation: FridaSessionStatus;
  readonly closed: FridaSessionCloseResult;
  readonly statusAfterCleanup: FridaSessionStatus | undefined;
  readonly script: FridaScriptObservation | undefined;
};

const unreadableScriptFile = async (
  source: FridaScriptSource,
): Promise<AnalysisError | undefined> => {
  if (source.sourceKind !== "file") return undefined;
  let reason: string;
  let cause: unknown;
  try {
    if (!(await stat(source.path)).isFile())
      reason = "it is not a regular file";
    else {
      await access(source.path, constants.R_OK);
      return undefined;
    }
  } catch (failure: unknown) {
    cause = failure;
    const code =
      failure instanceof Error && "code" in failure ? failure.code : undefined;
    if (code === "EACCES" || code === "EPERM")
      return new AnalysisAccessDeniedError(
        "instrument_with_frida",
        source.path,
        code,
        { cause },
      );
    reason =
      code === "ENOENT" ? "no file exists there" : String(code ?? failure);
  }
  return new AnalysisInputError(
    "instrument_with_frida",
    cause === undefined ? undefined : { cause },
    [
      {
        path: ["path"],
        reason: "invalid_value",
        message: `Cannot read Frida script file ${source.path}: ${reason}.`,
      },
    ],
  );
};

/**
 * Reject an unreadable script file before any attach or spawn effect;
 * cancellation before or during the check still wins.
 */
const rejectBeforeStart = async (
  source: FridaScriptSource,
  signal: AbortSignal | undefined,
): Promise<AnalysisError | undefined> => {
  const cancelled = () =>
    new AnalysisCancelledError(
      "instrument_with_frida",
      signal?.reason === undefined ? {} : { cause: signal.reason },
    );
  if (signal?.aborted) return cancelled();
  const unreadable = await unreadableScriptFile(source);
  return signal?.aborted ? cancelled() : unreadable;
};

/** Shared CLI/MCP workflows for Frida's device and instrumentation operations. */
export class FridaInstrumentationService {
  readonly #provider: FridaInstrumentationPort;

  constructor(provider: FridaInstrumentationPort) {
    this.#provider = provider;
  }

  async listDevices(
    remote?: FridaRemoteConnection,
  ): Promise<Result<FridaDeviceList, AnalysisError>> {
    const result = await this.#provider.listDevices(remote);
    return result.ok
      ? ok({
          devices: result.value.devices.map(({ deviceId, name, type }) => ({
            device_id: deviceId,
            name,
            type,
          })),
          cleanup_error: result.value.cleanupError,
        })
      : result;
  }

  async listProcesses(
    selector: FridaDeviceSelector,
  ): Promise<Result<FridaProcessList, AnalysisError>> {
    const result = await this.#provider.listProcesses(selector);
    return result.ok
      ? ok({
          device_id: result.value.deviceId,
          processes: [...result.value.processes],
          cleanup_error: result.value.cleanupError,
        })
      : result;
  }

  async startSession(input: StartFridaSessionInput, signal?: AbortSignal) {
    return this.#startSession(input, signal, "start_frida_session");
  }

  async #startSession(
    input: StartFridaSessionInput,
    signal: AbortSignal | undefined,
    operation: string,
  ) {
    if (signal?.aborted)
      return err(
        new AnalysisCancelledError(
          operation,
          signal.reason === undefined ? {} : { cause: signal.reason },
        ),
      );
    const started = await this.#provider.startSession(input);
    if (!started.ok || !signal?.aborted) return started;
    return this.#cancelSession(operation, started.value, input, signal.reason);
  }

  async #cancelSession(
    operation: string,
    session: FridaSessionObservation,
    input: StartFridaSessionInput,
    cause: unknown,
    load?: {
      readonly script: FridaScriptObservation;
      readonly diagnostics?: AnalysisError["diagnostics"];
    },
  ): Promise<Result<never, AnalysisError>> {
    const loaded = load?.script;
    const status = this.#provider.status(session.sessionId);
    const observation = status ?? {
      ...session,
      targetResumeObserved: false,
      scripts: [],
      messages: loaded?.messages ?? [],
      messagesTruncated: loaded?.messagesTruncated ?? false,
    };
    const closed = await this.#provider.closeSession(session.sessionId);
    const statusAfterCleanup = this.#provider.status(session.sessionId);
    return err(
      cancelledFridaSession({
        operation,
        input,
        cause,
        diagnostics: load?.diagnostics,
        observation,
        closed,
        statusAfterCleanup,
        script: loaded,
      }),
    );
  }

  async loadScript(
    sessionId: string,
    source: FridaScriptSource,
    signal?: AbortSignal,
  ): Promise<Result<Evidence, AnalysisError>> {
    if (signal?.aborted)
      return err(
        new AnalysisCancelledError("load_frida_script", {
          cause: signal.reason,
        }),
      );
    const loaded = await this.#provider.loadScript(sessionId, source, signal);
    if (!loaded.ok && loaded.error instanceof FridaScriptLoadCancelledError)
      return err(cancelledScriptEvidence(sessionId, loaded.error));
    return loaded.ok
      ? ok(
          fridaEvidence(
            "load_frida_script",
            scriptOutput(loaded.value),
            {
              session_id: sessionId,
            },
            loaded.value,
          ),
        )
      : loaded;
  }

  resumeSession(sessionId: string, signal?: AbortSignal) {
    return this.#provider.resumeSession(sessionId, signal);
  }

  unloadScript(sessionId: string, scriptId: string, signal?: AbortSignal) {
    return this.#provider.unloadScript(sessionId, scriptId, signal);
  }

  status(sessionId: string): FridaSessionStatus | undefined {
    return this.#provider.status(sessionId);
  }

  inspectStatus(
    rawInput: unknown,
    retention: AnalysisViewRetention = {
      recordEvidence: undefined,
      evidenceById: undefined,
    },
  ): Result<Evidence, AnalysisError> {
    const input = parseAnalysisInput(
      "frida_session_status",
      rawInput,
      fridaSessionStatusInputSchema,
    );
    if (!input.ok) return input;
    if (input.value.detail === "summary") {
      const ready = requireAnalysisViewRetention(
        "frida_session_status",
        retention,
      );
      if (!ready.ok) return ready;
    }
    const status = this.#provider.status(input.value.session_id);
    if (status === undefined)
      return err(
        unknownFridaSession("frida_session_status", input.value.session_id),
      );
    const evidence = fridaEvidence(
      "frida_session_status",
      sessionStatusOutput(status),
      {
        session_id: input.value.session_id,
      },
    );
    return input.value.detail === "summary"
      ? summarizeRetainedAnalysis(evidence, retention)
      : ok(evidence);
  }

  async instrument(
    input: StartFridaSessionInput & {
      readonly source: FridaScriptSource;
      readonly durationMs: number;
    },
    signal?: AbortSignal,
  ): Promise<
    Result<
      { readonly evidence: Evidence; readonly cleanupError: string | null },
      AnalysisError
    >
  > {
    const rejected = await rejectBeforeStart(input.source, signal);
    if (rejected !== undefined) return err(rejected);
    const started = await this.#startSession(
      input,
      signal,
      "instrument_with_frida",
    );
    if (!started.ok) return started;
    if (signal?.aborted)
      return this.#cancelSession(
        "instrument_with_frida",
        started.value,
        input,
        signal.reason,
      );
    const loaded = await this.#provider.loadScript(
      started.value.sessionId,
      input.source,
      signal,
    );
    if (!loaded.ok && loaded.error instanceof AnalysisCancelledError)
      return this.#cancelSession(
        "instrument_with_frida",
        started.value,
        input,
        loaded.error.cause,
        loaded.error instanceof FridaScriptLoadCancelledError
          ? loaded.error
          : undefined,
      );
    if (!loaded.ok) {
      const closed = await this.#provider.closeSession(started.value.sessionId);
      return closed.ok
        ? err(resolvedAnalysisError(loaded.error))
        : err(
            analysisErrorWithCleanupFailure(
              loaded.error,
              closed.error,
              "instrument_with_frida",
            ).bindCleanupDependencies([loaded.error, closed.error]),
          );
    }
    if (signal?.aborted)
      return this.#cancelSession(
        "instrument_with_frida",
        started.value,
        input,
        signal.reason,
        { script: loaded.value },
      );
    if (started.value.mode === "spawn") {
      const resumed = await this.#provider.resumeSession(
        started.value.sessionId,
        signal,
      );
      if (
        !resumed.ok &&
        !(signal?.aborted && resumed.error instanceof AnalysisCancelledError)
      ) {
        const closed = await this.#provider.closeSession(
          started.value.sessionId,
        );
        return closed.ok
          ? resumed
          : err(
              analysisErrorWithCleanupFailure(
                resumed.error,
                closed.error,
                "instrument_with_frida",
              ).bindCleanupDependencies([resumed.error, closed.error]),
            );
      }
      if (signal?.aborted)
        return this.#cancelSession(
          "instrument_with_frida",
          started.value,
          input,
          signal.reason,
          { script: loaded.value },
        );
    }
    try {
      await delay(input.durationMs, undefined, { signal });
    } catch (cause: unknown) {
      return this.#cancelSession(
        "instrument_with_frida",
        started.value,
        input,
        signal?.aborted ? signal.reason : cause,
        { script: loaded.value },
      );
    }
    if (signal?.aborted)
      return this.#cancelSession(
        "instrument_with_frida",
        started.value,
        input,
        signal.reason,
        { script: loaded.value },
      );
    const status = this.#provider.status(started.value.sessionId);
    const observation = status ?? {
      ...started.value,
      targetResumeObserved: false,
      scripts: [],
      messages: loaded.value.messages,
      messagesTruncated: loaded.value.messagesTruncated,
    };
    const closed = await this.#provider.closeSession(started.value.sessionId);
    const cleanupError = closed.ok ? null : closed.error.message;
    if (signal?.aborted)
      return err(
        cancelledFridaSession({
          operation: "instrument_with_frida",
          input,
          cause: signal.reason,
          observation,
          closed,
          statusAfterCleanup: this.#provider.status(started.value.sessionId),
          script: loaded.value,
        }),
      );
    const evidence = fridaEvidence(
      "instrument_with_frida",
      {
        ...sessionStatusOutput(observation),
        ...sourceOutput(loaded.value),
        cleanup_error: cleanupError,
      },
      fridaParameters(started.value.sessionId, input, started.value.deviceId),
      loaded.value,
    );
    return ok({
      evidence,
      cleanupError,
    });
  }

  closeSession(sessionId: string) {
    return this.#provider.closeSession(sessionId);
  }

  closeAll(): Promise<void> {
    return this.#provider.closeAll();
  }
}

const fridaEvidence = (
  operation: string,
  result: unknown,
  parameters: unknown,
  script?: FridaScriptObservation,
): Evidence =>
  createEvidence(
    undefined,
    { id: "frida", name: "Frida", version: null },
    {
      predicateType: "rea.frida.instrumentation-observation",
      operation,
      parameters,
      result,
      ...(script?.sourceRepresentation === undefined
        ? {}
        : {
            rawResult: {
              source_representation: {
                encoding: script.sourceRepresentation.encoding,
                decoding: script.sourceRepresentation.decoding,
                loaded_source_sha256:
                  script.sourceRepresentation.loadedSourceSha256,
              },
            },
          }),
      confidence: "observed",
      authority: "external-service",
      environment: null,
      limitations: [
        "The target operating system and architecture were not reported by this observation.",
        ...fridaCaptureLimitations(result),
        ...(script?.sourceRepresentation === undefined
          ? []
          : [
              "Invalid UTF-8 in the selected script file was decoded with replacement characters. source_sha256 identifies the original file bytes; raw_result.source_representation.loaded_source_sha256 identifies the UTF-8 encoding of the string passed to Frida.",
            ]),
      ],
    },
  );

const cancelledFridaSession = ({
  operation,
  input,
  cause,
  diagnostics,
  observation,
  closed,
  statusAfterCleanup,
  script,
}: FridaSessionCancellation): AnalysisCancelledError => {
  const cleanupError = closed.ok ? null : closed.error.message;
  const failure = new AnalysisCancelledError(operation, {
    ...(cause === undefined ? {} : { cause }),
    diagnostics,
    partialObservation: fridaEvidence(
      operation,
      {
        ...sessionStatusOutput(observation),
        ...(script === undefined ? {} : sourceOutput(script)),
        cleanup_error: cleanupError,
        target_state_before_cleanup: observation.state,
        target_resume_observed:
          observation.targetResumeObserved ||
          (closed.ok && closed.value.targetResumeObserved) ||
          statusAfterCleanup?.targetResumeObserved === true,
        instrumentation_cleanup: closed.ok
          ? "released"
          : "incomplete_or_unknown",
        target_liveness_after_cleanup: "unknown",
      },
      fridaParameters(observation.sessionId, input, observation.deviceId),
      script,
    ),
    ...(closed.ok
      ? {}
      : {
          cleanup: {
            reason: closed.error.message,
            resources: [observation.sessionId],
          },
        }),
  });
  return closed.ok ? failure : failure.bindCleanupDependencies([closed.error]);
};

const fridaParameters = (
  sessionId: string,
  input: StartFridaSessionInput,
  deviceId: string,
) => ({
  session_id: sessionId,
  device_id: deviceId,
  ...(input.remote === undefined
    ? {}
    : {
        remote: {
          address: input.remote.address,
          ...(input.remote.origin === undefined
            ? {}
            : { origin: input.remote.origin }),
          ...(input.remote.keepaliveInterval === undefined
            ? {}
            : { keepalive_interval: input.remote.keepaliveInterval }),
        },
      }),
  mode: input.mode,
  ...(input.mode === "attach"
    ? { pid: input.pid }
    : {
        program: input.program,
        ...(input.argv === undefined ? {} : { argv: input.argv }),
      }),
});

const sourceOutput = (script: FridaScriptObservation) => ({
  source_kind: script.sourceKind,
  source_path: script.sourcePath,
  source_sha256: script.sourceSha256,
});

const scriptOutput = (script: FridaScriptObservation) => ({
  script_id: script.scriptId,
  ...sourceOutput(script),
  messages: script.messages,
  messages_truncated: script.messagesTruncated,
});

const sessionStatusOutput = (status: FridaSessionStatus) => ({
  session_id: status.sessionId,
  device_id: status.deviceId,
  state: status.state,
  target: status.target,
  pid: status.pid,
  mode: status.mode,
  scripts: status.scripts.map((script) => ({
    script_id: script.scriptId,
    name: script.name,
  })),
  messages: status.messages,
  messages_truncated: status.messagesTruncated,
});

const cancelledScriptEvidence = (
  sessionId: string,
  error: FridaScriptLoadCancelledError,
): AnalysisCancelledError =>
  new AnalysisCancelledError(error.operation, {
    cause: error.cause,
    diagnostics: error.diagnostics,
    cleanup: error.cleanup,
    partialObservation: fridaEvidence(
      error.operation,
      {
        ...scriptOutput(error.script),
        cleanup_error: error.cleanup?.reason ?? null,
        script_cleanup: !error.scriptHandleAcquired
          ? "no_handle"
          : error.cleanupIncomplete
            ? "incomplete_or_unknown"
            : "released",
      },
      { session_id: sessionId },
      error.script,
    ),
  }).bindCleanupDependencies([error]);

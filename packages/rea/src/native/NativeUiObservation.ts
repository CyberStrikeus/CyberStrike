import { waitForAbortableDelay } from "../process/ProviderDeadline.js";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  isMachOFormat,
  type BinaryTarget,
} from "../domain/binaryTargetTypes.js";
import {
  DEFAULT_NATIVE_UI_DEADLINE_MS,
  NATIVE_UI_WAIT_STEP_MAX_MS,
} from "../domain/native/nativeDeadlines.js";
import {
  nativeUiObservationInputSchema,
  nativeUiScenarioInputSchema,
  nativeUiSnapshotSchema,
  nativeUiResultSchema,
} from "../domain/native/nativeUiObservation.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
} from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { ExecFileOutputCancelledError } from "../process/ExecFileOutput.js";
import { NativeUiCleanupError } from "./NativeUiCleanupError.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  createNativeUiHelperRuntime,
  type NativeUiHelperRuntime,
} from "./NativeUiHelperRuntime.js";
import {
  NATIVE_UI_OUTPUT_BUDGET_BYTES,
  NATIVE_UI_OUTPUT_WEIGHT,
} from "./NativeUiOutputBudget.js";
import { NativeUiInterruptionControl } from "./NativeUiInterruptionControl.js";

const helper = fileURLToPath(
  new URL("../../bridge/native/ReaNativeUI.swift", import.meta.url),
);
const passiveInputSchema = nativeUiObservationInputSchema.transform(
  (input) => ({ ...input, steps: [] }),
);
const responseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), result: nativeUiSnapshotSchema }),
  z.strictObject({
    ok: z.literal(false),
    code: z.string(),
    message: z.string(),
  }),
]);
const initialSelectionFields = new Map<string, "pid" | "window_id">([
  ["pid-not-application", "pid"],
  ["target-mismatch", "pid"],
  ["window-mismatch", "window_id"],
  ["ambiguous-window", "window_id"],
]);
/** Narrow process seam preserves the native helper's OS and target failures. */
export type NativeUiHelper = (
  parameters: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
) => Promise<unknown>;

/** Capture a selected existing app window and run explicitly selected scenarios. */
export const observeNativeUi = async (
  target: BinaryTarget,
  operation: "observe_native_ui" | "capture_native_ui_scenario",
  parameters: unknown,
  options: {
    environment: Readonly<NodeJS.ProcessEnv>;
    signal?: AbortSignal | undefined;
    invoke?: NativeUiHelper;
    runtime?: NativeUiHelperRuntime;
    interruption?: NativeUiInterruptionControl;
  },
): Promise<Result<z.infer<typeof nativeUiResultSchema>, AnalysisError>> => {
  const runtime =
    options.runtime ?? createNativeUiHelperRuntime(options.environment);
  const interruption =
    options.interruption ??
    new NativeUiInterruptionControl(
      options.signal,
      runtime.signal,
      runtime.deadlineMs ?? DEFAULT_NATIVE_UI_DEADLINE_MS,
    );
  const ownsInterruption = options.interruption === undefined;
  let result: Result<z.infer<typeof nativeUiResultSchema>, AnalysisError>;
  try {
    try {
      result = await observeWithHelper(target, operation, parameters, {
        interruption,
        invoke: options.invoke ?? runtime.invoke,
      });
    } catch (cause: unknown) {
      result = err(
        cause instanceof AnalysisError
          ? cause
          : new ProviderAdapterError("native-macos", operation, { cause }),
      );
    }
    if (options.runtime === undefined) {
      try {
        await runtime.close();
      } catch (cause: unknown) {
        result = finishNativeUiObservation(result, operation, interruption);
        const cleanup = new NativeUiCleanupError(
          [{ runtime, cause }],
          operation,
          result.ok ? result.value : undefined,
        );
        return result.ok
          ? err(cleanup)
          : err(
              analysisErrorWithCleanupFailure(
                result.error,
                cleanup,
                operation,
              ).bindCleanupDependencies([result.error, cleanup]),
            );
      }
    }
    return finishNativeUiObservation(result, operation, interruption);
  } finally {
    if (ownsInterruption) interruption.dispose();
  }
};

const observeWithHelper = async (
  target: BinaryTarget,
  operation: "observe_native_ui" | "capture_native_ui_scenario",
  parameters: unknown,
  options: {
    interruption: NativeUiInterruptionControl;
    invoke: NativeUiHelper;
  },
): Promise<Result<z.infer<typeof nativeUiResultSchema>, AnalysisError>> => {
  const parsed = (
    operation === "observe_native_ui"
      ? passiveInputSchema
      : nativeUiScenarioInputSchema
  ).safeParse(parameters);
  if (!parsed.success)
    return err(new AnalysisInputError(operation, { cause: parsed.error }));
  if (target.kind !== "executable" || !isMachOFormat(target.format))
    return err(
      new AnalysisCapabilityUnavailableError(
        "native-macos",
        operation,
        "Native UI observation requires an active Mach-O executable or app target",
      ),
    );
  const input = parsed.data;
  if (!input.screenshot && !input.accessibility)
    return err(
      new AnalysisInputError(operation, {
        cause: new Error("Enable screenshot or accessibility capture"),
      }),
    );
  const steps = input.steps;
  const interruption = options.interruption;
  const signal = interruption.signal;
  const invoke = options.invoke;
  let launchTime: number | undefined;
  let outputBytes = 0;
  const take = async (
    action?: unknown,
  ): Promise<Result<z.infer<typeof nativeUiSnapshotSchema>, AnalysisError>> => {
    const interrupted = interruption.error(operation);
    if (interrupted !== undefined) return err(interrupted);
    try {
      const response = responseSchema.parse(
        await invoke(
          {
            pid: input.pid,
            window_id: input.window_id,
            executable: target.path,
            sha256: target.sha256,
            ...(launchTime === undefined ? {} : { launch_time: launchTime }),
            screenshot: input.screenshot,
            accessibility: input.accessibility,
            max_nodes: input.max_nodes,
            ...(action === undefined ? {} : { action }),
          },
          signal,
        ),
      );
      if (!response.ok) {
        const field = initialSelectionFields.get(response.code);
        if (launchTime === undefined && field !== undefined)
          return err(
            new AnalysisInputError(
              operation,
              { userMessage: response.message },
              [
                {
                  path: [field],
                  reason: "invalid_value",
                  message: `${response.code}: ${response.message}`,
                },
              ],
            ),
          );
        return err(
          new AnalysisCapabilityUnavailableError(
            "native-macos",
            operation,
            `${response.code}: ${response.message}`,
            { userMessage: response.message },
          ),
        );
      }
      if (
        response.result.window.pid !== input.pid ||
        response.result.window.window_id !== input.window_id ||
        response.result.window.executable !== target.path ||
        (launchTime !== undefined &&
          response.result.window.launch_time !== launchTime)
      )
        return err(
          new AnalysisCapabilityUnavailableError(
            "native-macos",
            operation,
            "Native helper returned a different target process or window",
          ),
        );
      launchTime = response.result.window.launch_time;
      outputBytes +=
        NATIVE_UI_OUTPUT_WEIGHT *
        Buffer.byteLength(JSON.stringify(response.result));
      if (outputBytes > NATIVE_UI_OUTPUT_BUDGET_BYTES)
        return err(
          new AnalysisCapabilityUnavailableError(
            "native-macos",
            operation,
            `Scenario captures exceeded the fixed 64 MiB output budget (${String(NATIVE_UI_OUTPUT_BUDGET_BYTES)} bytes). This release has no runtime override. native_ui_deadline_ms does not raise it.`,
            {
              userMessage: `Scenario captures exceeded the fixed 64 MiB output budget (${String(NATIVE_UI_OUTPUT_BUDGET_BYTES)} bytes). This release has no runtime override.`,
              remediationAction: `The scenario output allowance is ${String(NATIVE_UI_OUTPUT_BUDGET_BYTES)} bytes. This release has no runtime override. Waiting, additional host memory, and native_ui_deadline_ms do not raise it. Repeating the unchanged request fails the same way.`,
            },
          ),
        );
      return ok(response.result);
    } catch (cause: unknown) {
      if (cause instanceof AnalysisError) return err(cause);
      if (
        cause instanceof Error &&
        "code" in cause &&
        cause.code === "ETIMEDOUT"
      )
        return err(interruption.deadlineFailure(operation));
      return err(
        cause instanceof ExecFileOutputCancelledError
          ? ((signal.aborted && cause.cause === signal.reason
              ? interruption.error(operation)
              : undefined) ??
              new AnalysisCancelledError(operation, { cause: cause.cause }))
          : new ProviderAdapterError("native-macos", operation, {
              cause,
              diagnostics: {
                helper_path: helper,
                reason: cause instanceof Error ? cause.message : String(cause),
                remediation:
                  "Native helper failed, timed out, or returned malformed capture data; install compatible Xcode command-line tools and inspect local OS permissions",
              },
            }),
      );
    }
  };
  const initial = await take();
  if (!initial.ok) return initial;
  const results: z.infer<typeof nativeUiResultSchema>["steps"] = [];
  let before = initial.value;
  let terminalFailure: AnalysisError | undefined;
  for (const [index, step] of steps.entries()) {
    if (step.kind === "wait")
      await waitForAbortableDelay(step.milliseconds, signal);
    const after = await take(step.kind === "wait" ? undefined : step);
    if (!after.ok) {
      terminalFailure = after.error;
      results.push({
        index,
        kind: step.kind,
        before,
        after: null,
        outcome:
          after.error._tag === "AnalysisCancelledError"
            ? "cancelled"
            : "failed",
        reason: after.error.message,
      });
      break;
    }
    results.push({
      index,
      kind: step.kind,
      before,
      after: after.value,
      outcome: "completed",
      reason: null,
    });
    before = after.value;
  }
  const report = nativeUiResultSchema.parse({
    target_sha256: target.sha256,
    initial: initial.value,
    steps: results,
    restore: "leave-as-is",
    limitations: [
      "Only the explicitly selected already-running process/window is admitted. REA starts no target process and does not change permissions, foreground applications, or restore application data.",
      "Click uses AXPress; scroll uses AXIncrement/AXDecrement; key-entry sets the selected element's AXValue. Unsupported elements fail without global event fallback.",
      "Each completed action is followed immediately by capture; delayed UI changes require explicit wait steps. A failed after-capture can follow a completed action, so failure does not prove absence of application effects.",
      "Scenarios can change app data, cause app network activity and persist changes. The caller explicitly chooses leave-as-is; automatic restoration is unsupported.",
      `Window matching uses exact PID and window ID for screenshots and unique accessibility geometry. Accessibility paths can change as the UI changes; stale or ambiguous paths fail. Screenshots are scaled to at most 2048 pixels; scenario output is budgeted at 64 MiB. Execution uses the selected native_ui_deadline_ms of ${String(interruption.deadlineMs)} ms (omitted means ${String(DEFAULT_NATIVE_UI_DEADLINE_MS)}). One wait step stays capped at ${String(NATIVE_UI_WAIT_STEP_MAX_MS)} ms and that cap has no runtime override.`,
    ],
  });
  return terminalFailure === undefined
    ? finishNativeUiObservation(ok(report), operation, interruption)
    : err(terminalFailure.retainPartialObservation(report));
};

/** A validated report survives cancellation observed at its finalization boundary. */
export const finishNativeUiObservation = (
  result: Result<z.infer<typeof nativeUiResultSchema>, AnalysisError>,
  operation: string,
  interruption: NativeUiInterruptionControl,
): Result<z.infer<typeof nativeUiResultSchema>, AnalysisError> => {
  if (!result.ok) return result;
  const error = interruption.error(operation, result.value);
  return error === undefined ? result : err(error);
};

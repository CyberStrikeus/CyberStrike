import { err, ok, type Result } from "../../domain/result.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { ProcessCaptureError } from "./ProcessCaptureError.js";
import type { TerminalRenderer } from "./TerminalRenderer.js";
import type {
  ProcessCaptureObservationBuffer,
  TerminalCaptureRetention,
} from "./ProcessCaptureLifecycle.js";
import type { RenderedTerminalFrame } from "../../domain/process/processCapture.js";

interface ProcessTerminalObservation {
  readonly retention: TerminalCaptureRetention;
  readonly renderedFrames: readonly RenderedTerminalFrame[];
}

const terminalFailure = (cause: unknown): AnalysisError =>
  cause instanceof AnalysisError
    ? cause
    : new ProcessCaptureError(
        `Terminal observation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );

/** Keep a primary capture failure while retaining the finalizer's typed diagnostic. */
export const retainTerminalObservationFailure = (
  primary: unknown,
  failure: AnalysisError,
): AnalysisError => {
  if (primary === undefined) return failure;
  const error =
    primary instanceof AnalysisError
      ? primary
      : new ProcessCaptureError("process capture failed", { cause: primary });
  if (error !== failure)
    error.retainSecondaryFailure(failure, {
      terminal_observation_error: projectAnalysisError(failure),
    });
  return error;
};

/** Finalize retained chunks once after sampling, for both completion and error cleanup. */
export const createProcessTerminalFinalizer = (
  renderer: Pick<TerminalRenderer, "frames" | "dispose">,
  retention: () => TerminalCaptureRetention,
  observations: ProcessCaptureObservationBuffer,
): {
  readonly complete: () => Promise<
    Result<ProcessTerminalObservation, AnalysisError>
  >;
  readonly dispose: () => Promise<void>;
} => {
  let completed:
    | Promise<Result<ProcessTerminalObservation, AnalysisError>>
    | undefined;
  const complete = () =>
    (completed ??= observeTerminal(renderer, retention, observations));
  return {
    complete,
    dispose: async () => {
      await complete();
      await renderer.dispose();
    },
  };
};

const observeTerminal = async (
  renderer: Pick<TerminalRenderer, "frames">,
  readRetention: () => TerminalCaptureRetention,
  observations: ProcessCaptureObservationBuffer,
): Promise<Result<ProcessTerminalObservation, AnalysisError>> => {
  let retention: Result<TerminalCaptureRetention, AnalysisError>;
  try {
    retention = ok(readRetention());
  } catch (cause) {
    retention = err(terminalFailure(cause));
  }
  let rendered: Result<readonly RenderedTerminalFrame[], AnalysisError>;
  try {
    const frames = await renderer.frames();
    rendered = ok(frames);
    observations.rendered_frames = {
      state: "available",
      value: frames,
    };
  } catch (cause) {
    const failure = terminalFailure(cause);
    rendered = err(failure);
    observations.rendered_frames = {
      state: "unavailable",
      reason: `Rendered terminal frame collection failed: ${failure.message}`,
    };
  }
  if (!retention.ok) {
    // A deferred private renderer can propagate this same owning failure.
    // Keep it once rather than adding the primary as its own secondary.
    if (!rendered.ok && rendered.error !== retention.error)
      retention.error.retainSecondaryFailure(rendered.error, {
        rendered_terminal_failure: projectAnalysisError(rendered.error),
      });
    return retention;
  }
  if (!rendered.ok) return rendered;
  return ok({ retention: retention.value, renderedFrames: rendered.value });
};

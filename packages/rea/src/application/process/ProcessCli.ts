import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { err, ok, type Result } from "../../domain/result.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
} from "../../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import type { AnalysisErrorProjection } from "../../domain/analysisErrorProjection.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { describeValidationFailure } from "../../domain/validationFailure.js";
import { PROCESS_PROVIDER } from "../../domain/process/processEvidenceProvider.js";
import {
  analysisInputErrorFromIssues,
  projectInputIssues,
} from "../../domain/inputIssueProjection.js";
import { processTraceSpecificationSchema } from "../../domain/process/processTraceSpecification.js";
import { processScenarioSchema } from "../../domain/process/processScenario.js";
import {
  compareParsedProcessEvidence,
  readProcessComparisonSource,
} from "./ProcessComparisonService.js";
import { createProgressReporter } from "../ProgressReporter.js";
import { captureProcessScenario } from "../../process/capture/ProcessHarness.js";
import { ProcessCaptureResourceScope } from "../../process/capture/ProcessCaptureLifecycle.js";
import { ProcessCaptureError } from "../../process/capture/ProcessCaptureError.js";
import {
  createProcessCaptureEvidence,
  type ProcessCaptureEvidenceFailure,
} from "./ProcessEvidence.js";
import { readJsonFile } from "../JsonFiles.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";

/** Safe process-command failure returned to the CLI adapter. */
export interface ProcessCliErrorOutput extends AnalysisErrorProjection {
  readonly error: "Process command failed";
}

/** Capture one JSON scenario through the shared process harness and Evidence contract. */
export const captureProcessScenarioFile = async (
  path: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  signal?: AbortSignal,
) =>
  withProcessInputResources("capture_process_scenario", async (resources) => {
    const input = await readJson(
      path,
      "capture_process_scenario",
      signal,
      resources,
    );
    const parsed = processScenarioSchema.safeParse(input);
    if (!parsed.success)
      throw analysisInputErrorFromIssues(
        "capture_process_scenario",
        parsed.error.issues,
        input,
        { cause: parsed.error },
      );
    const progress = createProgressReporter(
      async (update) => {
        process.stderr.write(`${JSON.stringify({ rea_progress: update })}\n`);
      },
      { minimumIntervalMs: 100 },
    );
    const resourceScope = new ProcessCaptureResourceScope();
    const captured = await captureProcessScenario(
      parsed.data,
      signal,
      process.platform,
      environment,
      undefined,
      undefined,
      progress,
      resourceScope,
    );
    try {
      await resourceScope.close();
    } catch (cause: unknown) {
      if (!captured.ok && cause instanceof AnalysisError)
        return cliAnalysisError(
          captured.error instanceof ProcessCaptureError
            ? captured.error.withFinalization({ cleanupFailure: cause })
            : analysisErrorWithCleanupFailure(
                captured.error,
                cause,
                "capture_process_scenario",
              ).bindCleanupDependencies([captured.error, cause]),
        );
      throw cause;
    }
    if (!captured.ok) return cliAnalysisError(captured.error);
    return createProcessCaptureEvidence(parsed.data, captured.value);
  });

/** Compare two capture Evidence files and emit derived comparison Evidence. */
export const compareProcessEvidenceFiles = async (
  leftPath: string,
  rightPath: string,
  traceSpecPath?: string,
  signal?: AbortSignal,
) =>
  withProcessInputResources("compare_process_captures", async (resources) => {
    const leftInput = await readJson(
      leftPath,
      "compare_process_captures",
      signal,
      resources,
    );
    const left = readProcessComparisonSource(
      "left",
      leftInput,
      projectCaptureFileFailure,
    );
    if (!left.ok) throw left.error;
    const rightInput = await readJson(
      rightPath,
      "compare_process_captures",
      signal,
      resources,
    );
    const right = readProcessComparisonSource(
      "right",
      rightInput,
      projectCaptureFileFailure,
    );
    if (!right.ok) throw right.error;
    const traceSpecification =
      traceSpecPath === undefined
        ? undefined
        : parseTraceSpecification(
            await readJson(
              traceSpecPath,
              "compare_process_captures",
              signal,
              resources,
            ),
          );
    const result = compareParsedProcessEvidence(
      left.value,
      right.value,
      traceSpecification === undefined ? {} : { traceSpecification },
    );
    if (!result.ok) throw result.error;
    return result.value.evidence;
  });

/** Preserve CLI file diagnostics while sharing all source interpretation. */
const projectCaptureFileFailure = (
  failure: ProcessCaptureEvidenceFailure,
  side: "left" | "right",
  input: unknown,
): AnalysisError => {
  switch (failure.kind) {
    case "invalid-evidence":
      return analysisInputErrorFromIssues(
        "compare_process_captures",
        failure.cause.issues,
        input,
        { cause: failure.cause },
      );
    case "wrong-workflow":
      return processInputFailure(
        "compare_process_captures",
        "Capture evidence is not from the current process-capture workflow. Create new capture evidence, then try again.",
        [side],
        "invalid_value",
      );
    case "unsupported-provider":
      return new AnalysisInputError("compare_process_captures", undefined, [
        {
          path: [side, "provider"],
          reason: "invalid_value",
          message: `The ${side} Evidence provider ${failure.provider.id} v${failure.provider.version} (${failure.provider.name}) is not the current or supported legacy ${PROCESS_PROVIDER.id} v${PROCESS_PROVIDER.version} process capture provider.`,
        },
      ]);
    case "invalid-capture":
      return invalidCaptureEvidence(failure.cause, side);
  }
};

const parseTraceSpecification = (input: unknown) => {
  const parsed = processTraceSpecificationSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  // Match the MCP boundary: the operation name and a trace_spec-rooted path.
  throw new AnalysisInputError(
    "compare_process_captures",
    { cause: parsed.error },
    projectInputIssues(parsed.error.issues, input).map((issue) => ({
      ...issue,
      path: ["trace_spec", ...issue.path],
    })),
  );
};

const invalidCaptureEvidence = (cause: unknown, side: "left" | "right") =>
  processInputFailure(
    "compare_process_captures",
    `Capture evidence is malformed (${describeValidationFailure(cause)}). Create new capture evidence, then try again.`,
    [side],
    "invalid_value",
  );

const readJson = async (
  path: string,
  operation: "capture_process_scenario" | "compare_process_captures",
  signal: AbortSignal | undefined,
  resources: ArtifactResourceScope,
): Promise<unknown> => {
  if (signal?.aborted)
    throw new AnalysisCancelledError(operation, { cause: signal.reason });
  const loaded = await readJsonFile(path, signal, resources, operation);
  if (!loaded.ok && loaded.error instanceof AnalysisCancelledError)
    throw new AnalysisCancelledError(operation, { cause: loaded.error.cause });
  if (loaded.ok) {
    if (signal?.aborted)
      throw new AnalysisCancelledError(operation, { cause: signal.reason });
    return loaded.value;
  }
  if (loaded.error._tag !== "EvidenceFileError") throw loaded.error;
  if (loaded.error.reason === "io") throw loaded.error;
  const detail = describeValidationFailure(loaded.error.cause);
  throw processInputFailure(
    operation,
    loaded.error.reason === "invalid-json"
      ? `Process input file is not valid UTF-8 JSON: ${path} (${detail}). Repair the file, then try again.`
      : loaded.error.reason === "symlink-traversal"
        ? `Process input file could not be read: ${path} (${detail}). Repair the symbolic-link chain or select another file.`
        : `Process input file could not be read: ${path} (${detail}). Check the reported filesystem constraint and retry.`,
    ["input_file"],
    "invalid_value",
  );
};

const processInputFailure = (
  operation: string,
  userMessage: string,
  path: readonly (string | number)[],
  reason: "invalid_value" | "missing_argument",
): AnalysisInputError =>
  new AnalysisInputError(operation, { userMessage }, [
    { path, reason, message: userMessage },
  ]);

const cliAnalysisError = (error: AnalysisError): ProcessCliErrorOutput => ({
  error: "Process command failed",
  ...projectAnalysisError(error),
});

/**
 * This catch includes target execution, and the projection stays non-retryable.
 * Tell the user what happened; do not ask them to run the command again.
 */
export const PROCESS_UNEXPECTED_FAILURE_REMEDIATION =
  "Do not repeat this command. Tell the user the process command could not complete and ask them to check the input files, then run `rea doctor`.";

/** Preserve typed failures and local diagnostics at the process CLI boundary. */
const projectProcessCliError = (
  cause: unknown,
  operation: "capture_process_scenario" | "compare_process_captures",
): ProcessCliErrorOutput => {
  if (cause instanceof AnalysisError) return cliAnalysisError(cause);
  return cliAnalysisError(
    new ProviderAdapterError(PROCESS_PROVIDER.id, operation, {
      cause,
      diagnostics: { phase: "process_cli" },
      userMessage: `Process command could not complete: ${describeValidationFailure(cause)}`,
      remediationAction: PROCESS_UNEXPECTED_FAILURE_REMEDIATION,
    }),
  );
};

/** One invocation owns every input descriptor through final cleanup and retry. */
const withProcessInputResources = async <Value>(
  operation: "capture_process_scenario" | "compare_process_captures",
  run: (resources: ArtifactResourceScope) => Promise<Value>,
): Promise<Value | ProcessCliErrorOutput> => {
  const resources = new ArtifactResourceScope();
  let outcome: Result<Value, unknown>;
  try {
    outcome = ok(await run(resources));
  } catch (cause: unknown) {
    outcome = err(cause);
  }
  try {
    await resources.close();
  } catch (cause: unknown) {
    const cleanup = ArtifactReaderFailure.cleanupObservation(
      cause,
      resources.cleanupResources,
    );
    throw ArtifactReaderFailure.withCleanup(
      outcome.ok ? cause : outcome.error,
      cleanup,
      undefined,
      cause instanceof ArtifactReaderFailure ? cause.cleanupLeases : undefined,
    );
  }
  return outcome.ok
    ? outcome.value
    : projectProcessCliError(outcome.error, operation);
};

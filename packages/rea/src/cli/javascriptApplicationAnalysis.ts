import type { AnalysisViewRequest } from "../domain/analysisView/analysisView.js";
import { publishCliAnalysisEvidence } from "./analysisEvidenceDelivery.js";
import { JAVASCRIPT_APPLICATION_PROVIDER } from "../domain/investigationProviders.js";
import { createProgressReporter } from "../application/ProgressReporter.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { javaScriptSourcePathsSchema } from "../domain/javascript/javascriptSourceSelection.js";
import { parseCliJsonInput } from "../cliJsonInput.js";

const OPERATION = "analyze_javascript_application";

/**
 * Combine repeated `--source-path` values with `--source-paths-json`, an inline
 * JSON array or a JSON file. A file keeps large selections below the host
 * command-line limit; entries remain exact application-relative paths and are
 * not resolved against the working directory.
 */
export const cliJavaScriptSourcePaths = async (
  sourcePath: readonly string[] | undefined,
  sourcePathsJson: string | undefined,
  signal?: AbortSignal,
): Promise<
  | { readonly ok: true; readonly value: readonly string[] | undefined }
  | { readonly ok: false; readonly error: JsonValue }
> => {
  if (sourcePathsJson === undefined) return { ok: true, value: sourcePath };
  const input = await parseCliJsonInput(sourcePathsJson, OPERATION, signal);
  if (!input.ok) return input;
  const parsed = javaScriptSourcePathsSchema.safeParse(input.value);
  if (!parsed.success)
    return {
      ok: false,
      error: cliError(
        analysisInputErrorFromIssues(
          OPERATION,
          parsed.error.issues.map((issue) => ({
            ...issue,
            path: ["source_paths_json", ...issue.path],
          })),
          { source_paths_json: input.value },
        ),
      ),
    };
  return { ok: true, value: [...(sourcePath ?? []), ...parsed.data] };
};

/**
 * One parked JavaScript worker for one CLI host. A healthy worker stays
 * parked between that host's commands. Independent hosts do not share it.
 */
export class CliJavaScriptAnalysisHost {
  #retainedScope: ArtifactResourceScope | undefined;
  /** One shutdown shared by the exit callback and the dispatch `finally`. */
  #closing: Promise<void> | undefined;

  scope(): ArtifactResourceScope {
    this.#retainedScope ??= new ArtifactResourceScope();
    return this.#retainedScope;
  }

  /**
   * Stop this host's worker. Overlapping callers share the attempt in flight.
   * The scope stays owned when shutdown fails, so the next call retries.
   */
  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    const scope = this.#retainedScope;
    if (scope === undefined) return Promise.resolve();
    let published: Promise<void>;
    published = scope
      .close()
      .then(() => {
        if (this.#retainedScope === scope) this.#retainedScope = undefined;
      })
      .finally(() => {
        if (this.#closing === published) this.#closing = undefined;
      });
    this.#closing = published;
    return published;
  }
}

/** Process CLI host used when a caller does not pass its own host. */
const processJavaScriptAnalysis = new CliJavaScriptAnalysisHost();

/** Stop the process-owned JavaScript worker. */
export const closeCliJavaScriptResources = (
  host: CliJavaScriptAnalysisHost = processJavaScriptAnalysis,
): Promise<void> => host.close();

/** Execute the shared CLI boundary for static JavaScript analysis. */
export const runCliJavaScriptApplicationAnalysis = async (
  input: unknown,
  environment: Readonly<Record<string, string | undefined>>,
  signal?: AbortSignal,
  delivery?: {
    readonly detail: "complete" | "summary";
    readonly evidenceOutput: string | undefined;
    readonly view?: AnalysisViewRequest;
  },
  host: CliJavaScriptAnalysisHost = processJavaScriptAnalysis,
): Promise<JsonValue> => {
  const { analyzeJavaScriptApplication } =
    await import("../application/javascript/JavaScriptApplicationService.js");
  const progress = createProgressReporter(
    async (update) => {
      process.stderr.write(`${JSON.stringify({ rea_progress: update })}\n`);
    },
    { minimumIntervalMs: 0 },
  );
  const resources = host.scope();
  const result = await analyzeJavaScriptApplication(input, resources, {
    environment,
    progress,
    ...(signal === undefined ? {} : { signal }),
  });
  try {
    // Retry failed owners without stopping a healthy parked worker.
    await resources.retryCleanup();
  } catch (cause: unknown) {
    const cleanup = ArtifactReaderFailure.cleanupObservation(
      cause,
      "JavaScript application resources",
    );
    const failure = new ProviderCleanupError(
      JAVASCRIPT_APPLICATION_PROVIDER.id,
      cleanup.resources,
      { reason: cleanup.reason },
      { cause, operation: "analyze_javascript_application" },
    );
    return cliError(
      result.ok
        ? failure
        : analysisErrorWithCleanupFailure(
            result.error,
            failure,
            "analyze_javascript_application",
          ),
    );
  }
  const finalized = result.ok
    ? result
    : { ok: false as const, error: cliError(result.error) };
  return delivery === undefined
    ? finalized.ok
      ? finalized.value
      : finalized.error
    : publishCliAnalysisEvidence(finalized, {
        ...delivery,
        providerId: JAVASCRIPT_APPLICATION_PROVIDER.id,
        operation: "analyze_javascript_application",
        signal: signal ?? new AbortController().signal,
      });
};

const cliError = (
  error: Parameters<typeof projectAnalysisError>[0],
): JsonValue => ({
  error: "JavaScript application analysis failed",
  ...projectAnalysisError(error),
});

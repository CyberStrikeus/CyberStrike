import type { AnalysisSettingsReader } from "../../domain/analysisSettings.js";
import {
  ASAR_HEADER_ADMISSION_SETTING,
  parseAsarHeaderAdmission,
} from "../../config/asarHeaderAdmission.js";
import { z } from "zod";

import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { translateArtifactFailure } from "../../artifacts/ArtifactOperationFailure.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import {
  analyzeJavaScriptApplicationInputSchema,
  type JavaScriptApplicationAnalysisResult,
  parseOwnedJavaScriptApplicationAnalysisSteps,
} from "../../domain/javascript/javascriptApplicationAnalysis.js";
import {
  AnalysisAccessDeniedError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { ArtifactOperationError } from "../../domain/artifactOperationError.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Evidence } from "../../domain/evidence.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../../domain/result.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import { createOwnedJavaScriptApplicationEvidenceCooperatively } from "./JavaScriptApplicationEvidence.js";
import {
  assertJavaScriptAnalysisActive,
  checkpointJavaScriptAnalysis,
  completeJavaScriptAnalysisSteps,
} from "./JavaScriptAnalysisControl.js";
import {
  reconstructJavaScriptArtifact,
  type JavaScriptArtifactReconstructionResult,
} from "./JavaScriptArtifactReconstruction.js";
import { JAVASCRIPT_APPLICATION_PROVIDER } from "../../domain/investigationProviders.js";

const OPERATION = "analyze_javascript_application" as const;

/** Execution options plus the composition root's environment for admission settings. */
export interface JavaScriptApplicationOptions extends ExecutionOptions {
  readonly settings?: AnalysisSettingsReader;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

/** Statically analyze one local JavaScript/Electron application. */
export const analyzeJavaScriptApplication = async (
  rawInput: unknown,
  scope: ArtifactResourceScope,
  options: JavaScriptApplicationOptions = {},
): Promise<Result<Evidence, AnalysisError>> => {
  const parsed = analyzeJavaScriptApplicationInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return err(
      analysisInputErrorFromIssues(OPERATION, parsed.error.issues, rawInput),
    );
  return analyzeJavaScriptApplicationValidated(parsed.data, scope, options);
};

/** Analyze input already parsed by a trusted adapter boundary. */
export const analyzeJavaScriptApplicationValidated = async (
  input: z.output<typeof analyzeJavaScriptApplicationInputSchema>,
  scope: ArtifactResourceScope,
  options: JavaScriptApplicationOptions = {},
): Promise<Result<Evidence, AnalysisError>> => {
  // An invalid setting is refused before analysis, never replaced by the default.
  const asarHeaderAdmission = parseAsarHeaderAdmission(
    options.environment?.[ASAR_HEADER_ADMISSION_SETTING],
  );
  if (!asarHeaderAdmission.ok) return asarHeaderAdmission;
  const overrides = options.settings?.().overrides;
  const header = overrides?.["asar.max_header_bytes"];
  const acceptedAdmission =
    header === undefined
      ? asarHeaderAdmission.value
      : { maximumBytes: header, source: "runtime" as const };
  let reconstructed: JavaScriptArtifactReconstructionResult | undefined;
  let result: JavaScriptApplicationAnalysisResult | undefined;
  let evidence: Evidence | undefined;
  try {
    assertJavaScriptAnalysisActive(options.signal);
    await options.progress?.report({
      phase: "analyze_javascript_application",
      completed: 0,
      total: 1,
      message: "Inventorying and parsing application artifacts",
    });
    await checkpointJavaScriptAnalysis(options.signal);
    reconstructed = await reconstructJavaScriptArtifact(
      input,
      scope,
      options.signal,
      options.progress,
      acceptedAdmission,
      overrides,
    );
    const { electron_summary: summary, ...application } = reconstructed;
    await options.progress?.report({
      phase: "validate_javascript_application_result",
      completed: 0,
      total: 1,
      message: "Validating result metadata and cross-graph bindings",
    });
    await checkpointJavaScriptAnalysis(options.signal);
    result = await completeJavaScriptAnalysisSteps(
      parseOwnedJavaScriptApplicationAnalysisSteps({
        ...application,
        summary,
        limitations: reconstructed.graph.limitations,
      }),
      options.signal,
    );
    await options.progress?.report({
      phase: "create_javascript_application_evidence",
      completed: 0,
      total: 1,
      message: "Creating and hashing application analysis Evidence",
    });
    await checkpointJavaScriptAnalysis(options.signal);
    evidence = await createOwnedJavaScriptApplicationEvidenceCooperatively(
      input,
      result,
      options.signal,
      options.progress,
    );
    await checkpointJavaScriptAnalysis(options.signal);
    await options.progress?.report({
      phase: "analyze_javascript_application",
      completed: 1,
      total: 1,
      message: "Application graph and Electron boundaries reconstructed",
      terminal: true,
    });
    assertJavaScriptAnalysisActive(options.signal);
    return ok(evidence);
  } catch (cause: unknown) {
    if (
      cause instanceof ArtifactReaderFailure &&
      cause.reason === "cancelled" &&
      reconstructed !== undefined
    ) {
      try {
        if (result === undefined) {
          const { electron_summary: summary, ...application } = reconstructed;
          result = await completeJavaScriptAnalysisSteps(
            parseOwnedJavaScriptApplicationAnalysisSteps({
              ...application,
              summary,
              limitations: reconstructed.graph.limitations,
            }),
          );
        }
        evidence ??=
          await createOwnedJavaScriptApplicationEvidenceCooperatively(
            input,
            result,
          );
        return err(
          translateArtifactFailure(OPERATION, cause).retainPartialObservation(
            evidence,
          ),
        );
      } catch (completionCause: unknown) {
        // A validation or Evidence failure while finishing the partial result
        // remains the primary failure instead of being hidden by cancellation.
        cause = completionCause;
      }
    }
    // Preserve execution constraints and their completed partial Evidence.
    if (cause instanceof AnalysisError) return err(cause);
    if (cause instanceof ArtifactReaderFailure)
      return err(translateArtifactFailure(OPERATION, cause));
    if (cause instanceof z.ZodError)
      return err(
        new AnalysisOutputError(OPERATION, describeResultSchemaFailure(cause), {
          cause,
        }),
      );
    if (
      cause instanceof Error &&
      "code" in cause &&
      typeof cause.code === "string" &&
      FILESYSTEM_ERROR_CODES.has(cause.code)
    ) {
      const path: unknown = Reflect.get(cause, "path");
      const syscall: unknown = Reflect.get(cause, "syscall");
      const diagnostics = {
        input_path: input.input_path,
        system_code: cause.code,
        ...(typeof path === "string" ? { path } : {}),
        ...(typeof syscall === "string" ? { syscall } : {}),
      };
      return err(
        cause.code === "EACCES" || cause.code === "EPERM"
          ? new AnalysisAccessDeniedError(
              OPERATION,
              input.input_path,
              cause.code,
              { cause, diagnostics },
            )
          : new ArtifactOperationError(
              OPERATION,
              "io",
              undefined,
              cause.message,
              { cause, diagnostics },
            ),
      );
    }
    return err(
      new ProviderAdapterError(JAVASCRIPT_APPLICATION_PROVIDER.id, OPERATION, {
        cause,
        diagnostics: {
          input_path: input.input_path,
          error_name: cause instanceof Error ? cause.name : "UnknownError",
          error_message:
            cause instanceof Error
              ? cause.message
              : typeof cause === "string"
                ? cause
                : "JavaScript analysis failed with a non-Error value",
        },
      }),
    );
  }
};

const describeResultSchemaFailure = (cause: z.ZodError): string => {
  const issue = cause.issues[0];
  if (issue === undefined) return "Result schema rejected an unknown issue";
  const path = issue.path.flatMap((part) =>
    typeof part === "string" || typeof part === "number" ? [part] : [],
  );
  const pointer =
    path.length === 0
      ? "/"
      : `/${path.map((part) => escapePointerPart(String(part))).join("/")}`;
  return `Result schema rejected ${String(cause.issues.length)} ${cause.issues.length === 1 ? "issue" : "issues"} at ${pointer} (${issue.code})`;
};

const escapePointerPart = (part: string): string =>
  part.replaceAll("~", "~0").replaceAll("/", "~1");

const FILESYSTEM_ERROR_CODES = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "ENOTDIR",
  "EISDIR",
  "EIO",
  "ELOOP",
  "ENAMETOOLONG",
  "EMFILE",
  "ENFILE",
  "ENOSPC",
  "EROFS",
]);

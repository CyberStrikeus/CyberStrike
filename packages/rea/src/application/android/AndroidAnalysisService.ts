import { analysisOperationInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import type { EvidenceWriter } from "../investigation/InvestigationRecordPort.js";
import { summarizeRetainedAndroidSearch } from "./AndroidSearchEvidenceSummary.js";
import type { AndroidAnalysisPort } from "./AndroidAnalysisPort.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import { parseBinaryTarget } from "../BinaryTargetResolver.js";
import {
  androidRequestSchema,
  type AndroidOperation,
} from "../../domain/android/androidAnalysis.js";
import { AnalysisCancelledError } from "../../domain/analysisErrorCore.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";

/** Shared CLI/MCP admission, execution and Evidence composition for Android. */
export class AndroidAnalysisService {
  constructor(
    readonly provider: AndroidAnalysisPort,
    readonly recordEvidence?: EvidenceWriter["recordEvidence"],
  ) {}

  /** Inspect a caller-selected APK and retain producing-provider provenance inline. */
  async execute(
    operation: AndroidOperation,
    input: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    if (options?.signal?.aborted === true)
      return err(
        new AnalysisCancelledError(operation, { cause: options.signal.reason }),
      );
    const request = androidRequestSchema.safeParse({ operation, input });
    if (!request.success)
      return err(
        analysisOperationInputErrorFromIssues(
          operation,
          request.error.issues,
          input,
          request.error,
        ),
      );
    const target = await parseBinaryTarget(
      request.data.input.path,
      options?.signal === undefined ? {} : { signal: options.signal },
    );
    if (!target.ok) return target;
    const executed = await this.provider.execute(
      target.value,
      request.data,
      options,
    );
    if (!executed.ok) return executed;
    const execution = executed.value;
    const completed = completeProviderEvidence(
      createEvidence(
        execution.subject === undefined
          ? target.value
          : (execution.subject ?? undefined),
        execution.provider,
        {
          operation,
          parameters: request.data.input,
          result: execution.result,
          rawResult: execution.rawResult,
          limitations: execution.limitations,
          locations: execution.locations,
          confidence:
            operation === "inspect_android_method" ||
            operation === "inspect_android_jni_bindings"
              ? "derived"
              : "observed",
        },
      ),
      options?.signal,
    );
    if (
      !completed.ok ||
      operation !== "search_android_classes" ||
      execution.searchRawSummary === undefined
    )
      return completed;
    return summarizeRetainedAndroidSearch(
      completed.value,
      execution.searchRawSummary,
      this.recordEvidence,
    );
  }
}

import {
  inspectGpuCodeObjectsInputSchema,
  gpuCodeObjectsSchema,
} from "../../domain/gpu/gpuCodeObjects.js";
import type { GpuCodeObjectsPort } from "./GpuCodeObjectsPort.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import type { Evidence } from "../../domain/evidence.js";
import { createGpuCodeObjectsEvidence } from "../../domain/gpu/gpuCodeObjectsEvidence.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  requireAnalysisViewRetention,
  projectRetainedAnalysis,
  type AnalysisViewRetention,
} from "../analysisView/AnalysisViewService.js";

/** Shared input, Evidence and retained delivery boundary for CLI, MCP and SDK callers. */
export class GpuCodeObjectsService {
  constructor(readonly provider: GpuCodeObjectsPort) {}
  close(): Promise<void> {
    return this.provider.close();
  }
  async inspect(
    raw: unknown,
    options?: ExecutionOptions,
    retention: AnalysisViewRetention = {
      evidenceById: undefined,
      recordEvidence: undefined,
    },
  ): Promise<Result<Evidence, AnalysisError>> {
    const input = inspectGpuCodeObjectsInputSchema.safeParse(raw);
    if (!input.success)
      return err(
        analysisInputErrorFromIssues(
          "inspect_gpu_code_objects",
          input.error.issues,
          raw,
          { cause: input.error },
        ),
      );
    if (options?.signal?.aborted)
      return err(
        new AnalysisCancelledError("inspect_gpu_code_objects", {
          cause: options.signal.reason,
        }),
      );
    const { detail, view, ...parameters } = input.data;
    if (detail === "summary") {
      const ready = requireAnalysisViewRetention(
        "inspect_gpu_code_objects",
        retention,
      );
      if (!ready.ok) return ready;
    }
    const inspected = await this.provider.inspect(parameters, options);
    if (!inspected.ok) return inspected;
    const checked = gpuCodeObjectsSchema.safeParse(inspected.value);
    if (
      !checked.success ||
      checked.data.artifact.path !== parameters.path ||
      checked.data.analysis !== parameters.analysis ||
      (parameters.expected_sha256 !== undefined &&
        checked.data.artifact.sha256 !== parameters.expected_sha256)
    )
      return err(
        new AnalysisOutputError(
          "inspect_gpu_code_objects",
          "GPU reader changed the selected input or returned invalid facts",
        ),
      );
    const report = checked.data;
    const evidence = createGpuCodeObjectsEvidence(
      report,
      this.provider.identity,
      parameters,
    );
    if (options?.signal?.aborted)
      return err(
        new AnalysisCancelledError("inspect_gpu_code_objects", {
          cause: options.signal.reason,
          partialObservation: evidence,
        }),
      );
    return detail === "summary"
      ? projectRetainedAnalysis(
          evidence,
          retention,
          view === undefined
            ? { kind: "summary" }
            : { kind: "gpu-code-objects", ...view },
        )
      : ok(evidence);
  }
}

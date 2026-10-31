import { inspectModelArtifactInputSchema } from "../../domain/model/modelArtifactQuery.js";
import type { ModelArtifactPort } from "./ModelArtifactPort.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import { modelArtifactSchema } from "../../domain/model/modelArtifact.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import type { Evidence } from "../../domain/evidence.js";
import { createModelArtifactEvidence } from "../../domain/model/modelArtifactEvidence.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  requireAnalysisViewRetention,
  projectRetainedAnalysis,
  type AnalysisViewRetention,
} from "../analysisView/AnalysisViewService.js";

/** Shared input, Evidence and retained delivery boundary for CLI, MCP and SDK callers. */
export class ModelArtifactService {
  constructor(readonly provider: ModelArtifactPort) {}
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
    const input = inspectModelArtifactInputSchema.safeParse(raw);
    if (!input.success)
      return err(
        analysisInputErrorFromIssues(
          "inspect_model_artifact",
          input.error.issues,
          raw,
          { cause: input.error },
        ),
      );
    if (options?.signal?.aborted)
      return err(
        new AnalysisCancelledError("inspect_model_artifact", {
          cause: options.signal.reason,
        }),
      );
    const { detail, view, ...parameters } = input.data;
    if (detail === "summary") {
      const ready = requireAnalysisViewRetention(
        "inspect_model_artifact",
        retention,
      );
      if (!ready.ok) return ready;
    }
    const inspected = await this.provider.inspect(parameters, options);
    if (!inspected.ok) return inspected;
    const checked = modelArtifactSchema.safeParse(inspected.value);
    if (
      !checked.success ||
      checked.data.artifact.path !== parameters.path ||
      checked.data.artifact.read_scope !==
        (parameters.hash === "full" ? "full-file" : "header") ||
      (parameters.hash === "header"
        ? checked.data.artifact.sha256 !== null
        : checked.data.artifact.sha256 === null)
    )
      return err(
        new AnalysisOutputError(
          "inspect_model_artifact",
          "Model reader changed the selected input or returned invalid facts",
        ),
      );
    const report = checked.data;
    const evidence = createModelArtifactEvidence(
      report,
      this.provider.identity,
      parameters,
    );
    if (options?.signal?.aborted)
      return err(
        new AnalysisCancelledError("inspect_model_artifact", {
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
            : { kind: "model-artifact", ...view },
        )
      : ok(evidence);
  }
}

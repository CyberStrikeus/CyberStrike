import type { AnalysisOperation } from "./AnalysisProvider.js";
import {
  createAnalysisProfile,
  type AnalysisProfileCommitment,
} from "../domain/analysisProfile.js";
import { REA_WORKFLOW_PROVIDER } from "../domain/investigationProviders.js";

/** Commit a workflow result to its upstream profile and applicable semantic revision. */
export const workflowAnalysisProfile = (
  upstream: AnalysisProfileCommitment,
  operation?: AnalysisOperation,
): AnalysisProfileCommitment =>
  createAnalysisProfile(REA_WORKFLOW_PROVIDER, {
    upstream_analysis_profile: upstream,
    source_limitations: "provider-operation-caveats-v1",
    ...(operation === "binary_overview" || operation === "batch_decompile"
      ? { workflow_revision: 4 }
      : operation === "get_call_graph" || operation === "trace_feature"
        ? { workflow_revision: 3 }
        : { workflow_revision: 1 }),
  });

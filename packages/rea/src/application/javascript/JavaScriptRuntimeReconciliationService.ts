import type { ExecutionOptions } from "../AnalysisProvider.js";
import { resolve } from "node:path";
import type { z } from "zod";
import {
  resolveEvidenceRequest,
  type EvidenceLookup,
} from "../EvidenceInputResolver.js";
import type { EvidenceWorkflowExecution } from "../investigation/EvidenceWorkflowExecution.js";
import type { EvidenceRequestFrameInput } from "../../domain/evidenceInputContract.js";
import { reconcileJavaScriptRuntimeRequestSchema } from "../../contracts/javascript/applicationWorkflowInputContracts.js";

import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import {
  readRuntimeReconciliationInput,
  reconcileJavaScriptRuntime,
} from "../../domain/javascript/javascriptRuntimeReconciliation.js";
import { runtimeReconciliationIdentitiesSchema } from "../../domain/javascript/javascriptRuntimeReconciliationSchemas.js";
import { err, ok, type Result } from "../../domain/result.js";
import { createJavaScriptRuntimeReconciliationEvidence } from "./JavaScriptRuntimeReconciliationEvidence.js";

const OPERATION = "reconcile_javascript_runtime" as const;

/** Derive a combined JAG from verified static and passive-runtime Evidence. */
export const reconcileJavaScriptRuntimeEvidence = (
  rawInput: unknown,
  lookup?: EvidenceLookup,
  options: Pick<ExecutionOptions, "signal"> = {},
): Result<EvidenceWorkflowExecution, AnalysisError> => {
  const selected = resolveEvidenceRequest(
    OPERATION,
    rawInput,
    reconcileJavaScriptRuntimeRequestSchema,
    lookup,
    options,
  );
  if (!selected.ok) return selected;
  const parsed = readRuntimeReconciliationInput(
    normalizeRuntimeMappingRoots(selected.value.input),
  );
  if (!parsed.ok) return parsed;
  const identities = runtimeReconciliationIdentitiesSchema.safeParse({
    static_layers: parsed.value.layers.map(({ role, evidence }) => ({
      role,
      analysis: evidence,
    })),
    runtime_observations: parsed.value.captures.map(({ evidence }) => evidence),
  });
  if (!identities.success)
    return err(
      analysisInputErrorFromIssues(
        OPERATION,
        identities.error.issues,
        rawInput,
      ),
    );
  const result = reconcileJavaScriptRuntime(parsed.value);
  return ok({
    evidence: createJavaScriptRuntimeReconciliationEvidence(
      parsed.value.input,
      result,
    ),
    sources: [
      ...parsed.value.layers.map(({ evidence }) => evidence),
      ...parsed.value.captures.map(({ evidence }) => evidence),
    ],
  });
};

type RuntimeReconciliationFrame = EvidenceRequestFrameInput<
  z.output<typeof reconcileJavaScriptRuntimeRequestSchema>
>;

const normalizeRuntimeMappingRoots = (
  input: RuntimeReconciliationFrame,
): RuntimeReconciliationFrame => ({
  ...input,
  static_layers: input.static_layers.map((layer) => ({
    ...layer,
    runtime_mappings: layer.runtime_mappings.map((mapping) =>
      mapping.kind === "file-root"
        ? {
            ...mapping,
            root: isPortableAbsolutePath(mapping.root)
              ? mapping.root
              : resolve(mapping.root),
          }
        : mapping,
    ),
  })),
});

const isPortableAbsolutePath = (path: string): boolean =>
  path.startsWith("/") ||
  /^[a-z]:[\\/]/iu.test(path) ||
  /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u.test(path);

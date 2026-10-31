import { requireAuthenticationHeadroom } from "../JsonAuthenticationHeadroom.js";
import { setImmediate } from "node:timers/promises";
import type { z } from "zod";
import type { compareSourceToBundleCliInputSchema } from "../../contracts/javascript/applicationWorkflowInputContracts.js";
import {
  historicalSourceGraphSchema,
  type HistoricalSourceGraph,
} from "../../domain/referenceSourceGraph.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { AnalysisCancelledError } from "../../domain/analysisErrorCore.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../../domain/result.js";
import { readJsonFileWithSource } from "../JsonFiles.js";

/** Historical facts plus the file-origin metadata supplied by the reader, if any. */
export type ResolvedSourceToBundleReference = {
  readonly reference: HistoricalSourceGraph;
  readonly reference_source?: {
    readonly kind: "file";
    readonly path: string;
    readonly requested_path: string;
  };
};

/** Resolve one caller-selected historical graph using the shared bounded regular-file reader. No file cache. */
export const resolveSourceToBundleReference = async (
  reference: z.output<typeof compareSourceToBundleCliInputSchema>["reference"],
  signal?: AbortSignal,
  resources?: ArtifactResourceScope,
): Promise<Result<ResolvedSourceToBundleReference, AnalysisError>> => {
  const cancelled = () => signal?.aborted === true;
  if (cancelled())
    return err(
      new AnalysisCancelledError("compare_source_to_bundle", {
        cause: signal?.reason,
      }),
    );
  if (!("kind" in reference)) return ok({ reference });
  const read = await readJsonFileWithSource(
    reference.path,
    signal,
    resources,
    "compare_source_to_bundle",
  );
  if (!read.ok) return read;
  await setImmediate();
  if (cancelled())
    return err(
      new AnalysisCancelledError("compare_source_to_bundle", {
        cause: signal?.reason,
      }),
    );
  const headroom = requireAuthenticationHeadroom(read.value.data, {
    operation: "compare_source_to_bundle",
    path: read.value.path,
    description:
      "Insufficient heap headroom to authenticate the historical source graph",
  });
  if (!headroom.ok) return headroom;
  const parsed = historicalSourceGraphSchema.safeParse(read.value.data);
  // Dispatch aborts queued while synchronous validation and commitment hashing ran.
  await setImmediate();
  if (cancelled())
    return err(
      new AnalysisCancelledError("compare_source_to_bundle", {
        cause: signal?.reason,
      }),
    );
  if (!parsed.success)
    return err(
      analysisInputErrorFromIssues(
        "compare_source_to_bundle",
        parsed.error.issues.map((issue) => ({
          ...issue,
          path: ["reference", ...issue.path],
        })),
        { reference: read.value.data },
        { cause: parsed.error },
      ),
    );
  return ok({
    reference: parsed.data,
    reference_source: {
      kind: "file",
      path: read.value.path,
      requested_path: reference.path,
    },
  });
};

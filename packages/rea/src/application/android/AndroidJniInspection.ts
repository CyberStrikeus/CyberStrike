import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { AndroidAnalysisService } from "./AndroidAnalysisService.js";
import {
  requireAnalysisViewRetention,
  projectRetainedAnalysis,
  type AnalysisViewRetention,
} from "../analysisView/AnalysisViewService.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { androidJniInspectionInputSchema } from "../../domain/android/androidAnalysis.js";
import type { Evidence } from "../../domain/evidence.js";
import type { Result } from "../../domain/result.js";
import { parseAnalysisInput } from "../AnalysisInput.js";

/** Keep global attribution facts retained while delivering only the requested view. */
export const inspectAndroidJniBindings = async (
  service: AndroidAnalysisService,
  rawInput: unknown,
  retention: AnalysisViewRetention,
  options?: ExecutionOptions,
): Promise<Result<Evidence, AnalysisError>> => {
  const operation = "inspect_android_jni_bindings";
  const parsed = parseAnalysisInput(
    operation,
    rawInput,
    androidJniInspectionInputSchema,
    options?.signal,
  );
  if (!parsed.ok) return parsed;
  const { detail, view, ...input } = parsed.value;
  if (detail === "summary") {
    const ready = requireAnalysisViewRetention(operation, retention);
    if (!ready.ok) return ready;
  }
  const executed = await service.execute(operation, input, options);
  return !executed.ok || detail !== "summary"
    ? executed
    : projectRetainedAnalysis(
        executed.value,
        retention,
        view ?? { kind: "summary" },
      );
};

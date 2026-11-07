import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { AndroidAnalysisService } from "./AndroidAnalysisService.js";
import {
  requireAnalysisViewRetention,
  projectRetainedAnalysis,
  type AnalysisViewRetention,
} from "../analysisView/AnalysisViewService.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { androidPackageInspectionInputSchema } from "../../domain/android/androidAnalysis.js";
import type { Evidence } from "../../domain/evidence.js";
import type { Result } from "../../domain/result.js";
import { parseAnalysisInput } from "../AnalysisInput.js";

/** Preserve the complete provider request; select retained delivery explicitly. */
export const inspectAndroidPackage = async (
  service: AndroidAnalysisService,
  rawInput: unknown,
  retention: AnalysisViewRetention,
  options?: ExecutionOptions,
): Promise<Result<Evidence, AnalysisError>> => {
  const operation = "inspect_android_package";
  const parsed = parseAnalysisInput(
    operation,
    rawInput,
    androidPackageInspectionInputSchema,
    options?.signal,
  );
  if (!parsed.ok) return parsed;
  if (parsed.value.detail === "summary") {
    const ready = requireAnalysisViewRetention(operation, retention);
    if (!ready.ok) return ready;
  }
  const executed = await service.execute(
    operation,
    { path: parsed.value.path },
    options,
  );
  if (!executed.ok || parsed.value.detail !== "summary") return executed;
  return projectRetainedAnalysis(
    executed.value,
    retention,
    parsed.value.view ?? { kind: "summary" },
  );
};

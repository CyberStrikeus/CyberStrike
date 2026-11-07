import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { FlutterBuildAnalysisService } from "./FlutterBuildAnalysisService.js";
import {
  requireAnalysisViewRetention,
  summarizeRetainedAnalysis,
  type AnalysisViewRetention,
} from "../analysisView/AnalysisViewService.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { dartAotInspectionInputSchema } from "../../domain/flutter/flutterBuildAnalysis.js";
import type { Evidence } from "../../domain/evidence.js";
import type { Result } from "../../domain/result.js";
import { parseAnalysisInput } from "../AnalysisInput.js";

/** Keep the caller's ABI choice and complete analysis; select only its delivery. */
export const inspectDartAot = async (
  service: FlutterBuildAnalysisService,
  rawInput: unknown,
  retention: AnalysisViewRetention,
  options?: ExecutionOptions,
): Promise<Result<Evidence, AnalysisError>> => {
  const operation = "inspect_dart_aot";
  const parsed = parseAnalysisInput(
    operation,
    rawInput,
    dartAotInspectionInputSchema,
    options?.signal,
  );
  if (!parsed.ok) return parsed;
  if (parsed.value.detail === "summary") {
    const ready = requireAnalysisViewRetention(operation, retention);
    if (!ready.ok) return ready;
  }
  const { detail, ...providerInput } = parsed.value;
  const executed = await service.execute(operation, providerInput, options);
  if (!executed.ok || detail !== "summary") return executed;
  return summarizeRetainedAnalysis(executed.value, retention);
};

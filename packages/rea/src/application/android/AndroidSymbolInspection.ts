import type { z } from "zod";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { AndroidAnalysisService } from "./AndroidAnalysisService.js";
import {
  requireAnalysisViewRetention,
  summarizeRetainedAnalysis,
  type AnalysisViewRetention,
} from "../analysisView/AnalysisViewService.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { androidSymbolInspectionInputSchemas } from "../../domain/android/androidAnalysis.js";
import type { Evidence } from "../../domain/evidence.js";
import type { Result } from "../../domain/result.js";
import { parseAnalysisInput } from "../AnalysisInput.js";

type Operation = keyof typeof androidSymbolInspectionInputSchemas;
type Input = z.infer<(typeof androidSymbolInspectionInputSchemas)[Operation]>;

/** Keep raw provider calls accessible without repeating class inventories inline. */
export const inspectAndroidSymbol = async (
  service: AndroidAnalysisService,
  operation: Operation,
  rawInput: unknown,
  retention: AnalysisViewRetention,
  options?: ExecutionOptions,
): Promise<Result<Evidence, AnalysisError>> => {
  const parsed = parseAnalysisInput<Input>(
    operation,
    rawInput,
    androidSymbolInspectionInputSchemas[operation],
    options?.signal,
  );
  if (!parsed.ok) return parsed;
  const { detail, ...input } = parsed.value;
  if (detail === "summary") {
    const ready = requireAnalysisViewRetention(operation, retention);
    if (!ready.ok) return ready;
  }
  const executed = await service.execute(operation, input, options);
  return !executed.ok || detail !== "summary"
    ? executed
    : summarizeRetainedAnalysis(executed.value, retention);
};

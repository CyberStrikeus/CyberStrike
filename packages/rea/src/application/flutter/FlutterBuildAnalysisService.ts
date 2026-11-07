import type { FlutterBuildAnalysisPort } from "./FlutterBuildAnalysisPort.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import {
  flutterRequestSchema,
  type FlutterOperation,
} from "../../domain/flutter/flutterBuildAnalysis.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Evidence } from "../../domain/evidence.js";
import { executeProviderOperation } from "../ProviderOperationExecution.js";
import type { Result } from "../../domain/result.js";

/** Shared CLI/MCP admission, execution, and Evidence composition for Flutter. */
export class FlutterBuildAnalysisService {
  constructor(readonly provider: FlutterBuildAnalysisPort) {}

  /** Run one caller-selected Flutter request and retain target identity inline. */
  execute(
    operation: FlutterOperation,
    input: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    return executeProviderOperation(
      operation,
      input,
      options,
      flutterRequestSchema,
      this.provider,
      "observed",
    );
  }
}

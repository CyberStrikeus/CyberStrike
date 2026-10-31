import type { JebAnalysisPort } from "./JebAnalysisPort.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import {
  jebRequestSchema,
  type JebOperation,
} from "../../domain/jeb/jebAnalysis.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Evidence } from "../../domain/evidence.js";
import type { Result } from "../../domain/result.js";
import { executeProviderOperation } from "../ProviderOperationExecution.js";

/** Shared CLI/MCP admission, execution and Evidence composition for JEB. */
export class JebAnalysisService {
  constructor(readonly provider: JebAnalysisPort) {}

  /** Run one caller-selected JEB request and retain engine provenance inline. */
  async execute(
    operation: JebOperation,
    input: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    return executeProviderOperation(
      operation,
      input,
      options,
      jebRequestSchema,
      this.provider,
      operation === "decompile_jeb_item" ? "derived" : "observed",
    );
  }
}

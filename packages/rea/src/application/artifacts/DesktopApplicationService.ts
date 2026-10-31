import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { DesktopApplicationPort } from "./DesktopApplicationPort.js";
import { ARTIFACT_GRAPH_PROVIDER } from "../../domain/investigationProviders.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import { parseAnalysisInput } from "../AnalysisInput.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import type { Evidence } from "../../domain/evidence.js";
import { createDesktopApplicationEvidence } from "../../domain/desktopApplicationEvidence.js";
import {
  desktopApplicationSchema,
  inspectDesktopApplicationInputSchema,
} from "../../domain/desktopApplication.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { err, type Result } from "../../domain/result.js";

/** One input, interpretation and Evidence boundary shared by CLI, MCP and embedders. */
export class DesktopApplicationService {
  constructor(readonly reader: DesktopApplicationPort) {}
  close(): Promise<void> {
    return this.reader.close();
  }

  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const operation = "inspect_desktop_application";
    const parsed = parseAnalysisInput(
      operation,
      rawInput,
      inspectDesktopApplicationInputSchema,
      options?.signal,
    );
    if (!parsed.ok) return parsed;
    const result = await this.reader.inspect(parsed.value, options);
    if (!result.ok) return result;
    const report = desktopApplicationSchema.safeParse(result.value);
    if (!report.success || report.data.root.path !== parsed.value.path)
      return err(
        new AnalysisOutputError(
          operation,
          "Directory inspection changed the selected root or returned malformed facts.",
        ),
      );
    return completeProviderEvidence(
      createDesktopApplicationEvidence(
        parsed.value,
        report.data,
        ARTIFACT_GRAPH_PROVIDER,
      ),
      options?.signal,
    );
  }
}

import { parseAnalysisInput } from "../AnalysisInput.js";
import { isAbsolute } from "node:path";

import {
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  javascriptRecoveryInputSchema,
  javascriptRecoveryResultSchema,
} from "../../domain/javascript/javascriptRecovery.js";
import { err, type Result } from "../../domain/result.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import type { JavaScriptRecoveryPort } from "./JavaScriptRecoveryPort.js";

const OPERATION = "recover_javascript_sources";

/** Shared CLI/MCP parsing and Evidence for derived JavaScript artifacts. */
export class JavaScriptRecoveryService {
  constructor(readonly provider: JavaScriptRecoveryPort) {}

  close(): Promise<void> {
    return this.provider.close?.() ?? Promise.resolve();
  }

  /** Recover sources and bind the result to its original immutable input. */
  async recover(
    input: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const parsed = parseAnalysisInput(
      OPERATION,
      input,
      javascriptRecoveryInputSchema,
      options?.signal,
    );
    if (!parsed.ok) return parsed;
    const invalidPaths = (["path", "output_directory"] as const).filter(
      (field) => !isAbsolute(parsed.value[field]),
    );
    const invalidAdditional = (parsed.value.additional_paths ?? []).filter(
      (additional) => !isAbsolute(additional),
    );
    if (invalidPaths.length > 0 || invalidAdditional.length > 0)
      return err(
        new AnalysisInputError(OPERATION, undefined, [
          ...invalidPaths.map((field) => ({
            path: [field],
            reason: "invalid_format" as const,
            message: `${field} must be an absolute filesystem path on this host.`,
          })),
          ...invalidAdditional.map((additional) => ({
            path: ["additional_paths"],
            reason: "invalid_format" as const,
            message: `additional_paths entries must be absolute filesystem paths on this host: ${additional}`,
          })),
        ]),
      );
    const execution = await this.provider.recover(parsed.value, options);
    if (!execution.ok) return execution;
    const result = javascriptRecoveryResultSchema.safeParse(
      execution.value.result,
    );
    if (!result.success || execution.value.subject == null)
      return err(
        new AnalysisOutputError(
          OPERATION,
          "Recovery did not return a valid result bound to the original source",
        ),
      );
    if (
      result.data.source.path !== parsed.value.path ||
      (result.data.additional_sources ?? []).length !==
        (parsed.value.additional_paths ?? []).length ||
      (parsed.value.additional_paths ?? []).some(
        (path, index) => result.data.additional_sources?.[index]?.path !== path,
      ) ||
      execution.value.subject.path !== result.data.source.path ||
      execution.value.subject.sha256 !== result.data.source.sha256 ||
      execution.value.provider.id !== result.data.engine.id ||
      execution.value.provider.version !== result.data.engine.version
    )
      return err(
        new AnalysisOutputError(
          OPERATION,
          "Recovery source or engine identity disagrees with its Evidence binding",
        ),
      );
    const evidence = createEvidence(
      execution.value.subject,
      execution.value.provider,
      {
        operation: OPERATION,
        parameters: parsed.value,
        result: result.data,
        rawResult: execution.value.rawResult,
        locations: execution.value.locations,
        limitations: execution.value.limitations,
        confidence: "derived",
        authority: "shipped-artifact",
      },
    );
    return completeProviderEvidence(evidence, options?.signal);
  }
}

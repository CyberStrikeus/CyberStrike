import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { RecordedCrashPort } from "./RecordedCrashPort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  inspectRecordedCrashInputSchema,
  RECORDED_LINUX_CORE_PROFILES,
  recordedCrashSchema,
} from "../../domain/native/recordedCrash.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import { parseAnalysisInput } from "../AnalysisInput.js";

const OPERATION = "inspect_recorded_crash";

/** Shared CLI/MCP validation and Evidence composition for recorded crash inspection. */
export class RecordedCrashService {
  constructor(readonly provider: RecordedCrashPort) {}

  close(): Promise<void> {
    return this.provider.close?.() ?? Promise.resolve();
  }

  /** Bind complete observations to the caller-selected artifact before creating Evidence. */
  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    return this.#inspect(rawInput, options, (input) =>
      this.provider.inspect(input, options),
    );
  }

  /** Complete the owned one-shot lifecycle before validating and publishing Evidence. */
  inspectAndClose(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    return this.#inspect(rawInput, options, (input) =>
      this.provider.inspectAndClose(input, options),
    );
  }

  async #inspect(
    rawInput: unknown,
    options: ExecutionOptions | undefined,
    inspect: (
      input: Parameters<RecordedCrashPort["inspect"]>[0],
    ) => ReturnType<RecordedCrashPort["inspect"]>,
  ): Promise<Result<Evidence, AnalysisError>> {
    const input = parseAnalysisInput(
      OPERATION,
      rawInput,
      inspectRecordedCrashInputSchema,
      options?.signal,
    );
    if (!input.ok) return input;
    const inspected = await inspect(input.value);
    if (!inspected.ok) return inspected;
    const diagnostics = recordedCrashSchema.shape.diagnostics.safeParse(
      inspected.value.diagnostics,
    );
    const outputOptions = diagnostics.success
      ? { capturedOutput: diagnostics.data }
      : undefined;
    const report = recordedCrashSchema.safeParse(inspected.value);
    if (
      !report.success ||
      report.data.artifact.path !== input.value.path ||
      (report.data.debugger.status === "available") !==
        input.value.include_debugger_context
    )
      return err(
        new AnalysisOutputError(
          OPERATION,
          "Recorded crash provider returned malformed evidence or changed the selected artifact identity.",
          outputOptions,
        ),
      );
    const value = report.data;
    return completeProviderEvidence(
      createEvidence(
        {
          path: value.artifact.path,
          format: "elf",
          architecture:
            RECORDED_LINUX_CORE_PROFILES[value.architecture]
              .evidenceArchitecture,
          sha256: value.artifact.sha256,
        },
        this.provider.identity,
        {
          operation: OPERATION,
          parameters: {
            path: input.value.path,
            include_debugger_context: input.value.include_debugger_context,
            ...(input.value.pwntools_timeout_ms === undefined
              ? {}
              : { pwntools_timeout_ms: input.value.pwntools_timeout_ms }),
          },
          result: value,
          // The decoded report is the only representation; do not repeat it.
          rawResult: null,
          confidence:
            value.debugger.status === "available" ? "derived" : "observed",
          limitations: value.limitations,
          locations: [{ kind: "artifact-path", path: value.artifact.path }],
        },
      ),
      options?.signal,
      outputOptions?.capturedOutput,
    );
  }
}

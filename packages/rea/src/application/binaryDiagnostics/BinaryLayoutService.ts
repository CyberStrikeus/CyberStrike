import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { BinaryLayoutPort } from "./BinaryLayoutPort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  inspectBinaryLayoutInputSchema,
  binaryLayoutSchema,
} from "../../domain/native/binaryLayout.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import { parseAnalysisInput } from "../AnalysisInput.js";

const OPERATION = "inspect_binary_layout";
const EVIDENCE_ARCHITECTURES = {
  EM_X86_64: "x86_64",
  EM_386: "x86",
  EM_ARM: "arm",
  EM_MIPS: "mips",
} as const;

/** Shared CLI/MCP validation and Evidence composition for offline layout inspection. */
export class BinaryLayoutService {
  constructor(readonly provider: BinaryLayoutPort) {}

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
      input: Parameters<BinaryLayoutPort["inspect"]>[0],
    ) => ReturnType<BinaryLayoutPort["inspect"]>,
  ): Promise<Result<Evidence, AnalysisError>> {
    const input = parseAnalysisInput(
      OPERATION,
      rawInput,
      inspectBinaryLayoutInputSchema,
      options?.signal,
    );
    if (!input.ok) return input;
    const inspected = await inspect(input.value);
    if (!inspected.ok) return inspected;
    const diagnostics = binaryLayoutSchema.shape.diagnostics.safeParse(
      inspected.value.diagnostics,
    );
    const outputOptions = diagnostics.success
      ? { capturedOutput: diagnostics.data }
      : undefined;
    const report = binaryLayoutSchema.safeParse(inspected.value);
    if (!report.success || report.data.artifact.path !== input.value.path)
      return err(
        new AnalysisOutputError(
          OPERATION,
          "Binary layout provider returned malformed evidence or changed the selected artifact identity.",
          outputOptions,
        ),
      );
    const value = report.data;
    return completeProviderEvidence(
      createEvidence(
        {
          path: value.artifact.path,
          format: "elf",
          architecture: EVIDENCE_ARCHITECTURES[value.architecture.machine],
          sha256: value.artifact.sha256,
        },
        this.provider.identity,
        {
          operation: OPERATION,
          parameters: {
            path: input.value.path,
            ...(input.value.pwntools_timeout_ms === undefined
              ? {}
              : { pwntools_timeout_ms: input.value.pwntools_timeout_ms }),
          },
          result: value,
          // The decoded report is the only representation; do not repeat it.
          rawResult: null,
          confidence: "observed",
          limitations: value.limitations,
          locations: [{ kind: "artifact-path", path: value.artifact.path }],
        },
      ),
      options?.signal,
      outputOptions?.capturedOutput,
    );
  }
}

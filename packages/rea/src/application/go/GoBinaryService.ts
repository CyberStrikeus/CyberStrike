import { binaryMetadataArchitecture } from "../../domain/binaryMetadataArchitecture.js";
import { metadataReportSubjectFormat } from "../../domain/apple/machoTargetSelection.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { GoBinaryPort } from "./GoBinaryPort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  goBinarySchema,
  inspectGoBinaryInputSchema,
} from "../../domain/go/goBinary.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import { parseAnalysisInput } from "../AnalysisInput.js";
import {
  requireAnalysisViewRetention,
  summarizeRetainedAnalysis,
  type AnalysisViewRetention,
} from "../analysisView/AnalysisViewService.js";

const OPERATION = "inspect_go_binary";
const NO_RETENTION: AnalysisViewRetention = {
  recordEvidence: undefined,
  evidenceById: undefined,
};

/** Shared exact input validation and artifact-bound Evidence for CLI and MCP. */
export class GoBinaryService {
  constructor(readonly provider: GoBinaryPort) {}

  close(): Promise<void> {
    return this.provider.close();
  }

  /** Inspect one explicitly selected file without acquiring a binary session. */
  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
    retention: AnalysisViewRetention = NO_RETENTION,
  ): Promise<Result<Evidence, AnalysisError>> {
    const input = parseAnalysisInput(
      OPERATION,
      rawInput,
      inspectGoBinaryInputSchema,
      options?.signal,
    );
    if (!input.ok) return input;
    const { detail, ...providerInput } = input.value;
    if (detail === "summary") {
      const ready = requireAnalysisViewRetention(OPERATION, retention);
      if (!ready.ok) return ready;
    }
    const inspected = await this.provider.inspect(providerInput, options);
    if (!inspected.ok) return inspected;
    const report = goBinarySchema.safeParse(inspected.value);
    if (!report.success || report.data.artifact.path !== input.value.path)
      return err(
        new AnalysisOutputError(
          OPERATION,
          "Go build-information reader returned malformed metadata or changed the selected artifact identity.",
        ),
      );
    const value = report.data;
    const architecture = binaryMetadataArchitecture(value.architecture);
    const completed = completeProviderEvidence(
      createEvidence(
        {
          path: value.artifact.path,
          sha256: value.artifact.sha256,
          format: metadataReportSubjectFormat(value),
          ...(architecture === undefined ? {} : { architecture }),
        },
        this.provider.identity,
        {
          operation: OPERATION,
          parameters: providerInput,
          result: value,
          confidence: "observed",
          limitations: value.limitations,
          locations: [
            { kind: "artifact-path", path: value.artifact.path },
            ...(value.build_info === null
              ? []
              : [
                  {
                    kind: "file-offset-range" as const,
                    start: value.build_info.header_offset,
                    end: value.build_info.header_offset + 32,
                  },
                ]),
          ],
        },
      ),
      options?.signal,
    );
    if (!completed.ok) return completed;
    return detail === "summary"
      ? summarizeRetainedAnalysis(completed.value, retention)
      : completed;
  }
}

import { binaryMetadataArchitecture } from "../../domain/binaryMetadataArchitecture.js";
import { metadataReportSubjectFormat } from "../../domain/apple/machoTargetSelection.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { RustBinaryPort } from "./RustBinaryPort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  rustBinarySchema,
  type InspectRustBinaryInput,
} from "../../domain/rust/rustBinary.js";
import { inspectRustBinaryRequestSchema } from "../../domain/rust/rustBinaryQuery.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import { parseAnalysisInput } from "../AnalysisInput.js";
import {
  requireAnalysisViewRetention,
  projectRetainedAnalysis,
  type AnalysisViewRetention,
} from "../analysisView/AnalysisViewService.js";

const OPERATION = "inspect_rust_binary";

/** Shared exact input validation and artifact-bound Evidence for CLI and MCP. */
export class RustBinaryService {
  constructor(readonly provider: RustBinaryPort) {}

  close(): Promise<void> {
    return this.provider.close();
  }

  /** Inspect one explicitly selected file without acquiring a binary session. */
  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
    retention: AnalysisViewRetention = {
      recordEvidence: undefined,
      evidenceById: undefined,
    },
  ): Promise<Result<Evidence, AnalysisError>> {
    const input = parseAnalysisInput(
      OPERATION,
      rawInput,
      inspectRustBinaryRequestSchema,
      options?.signal,
    );
    if (!input.ok) return input;
    const { detail, view, ...parameters } = input.value;
    const compact = detail === "summary" || view !== undefined;
    if (compact) {
      const ready = requireAnalysisViewRetention(OPERATION, retention);
      if (!ready.ok) return ready;
    }
    const inspected = await this.provider.inspect(parameters, options);
    if (!inspected.ok) return inspected;
    const report = rustBinarySchema.safeParse(inspected.value);
    if (!report.success || report.data.artifact.path !== input.value.path)
      return err(
        new AnalysisOutputError(
          OPERATION,
          "Rust dependency reader returned malformed metadata or changed the selected artifact identity.",
        ),
      );
    const completed = completeProviderEvidence(
      evidenceFor(this.provider.identity, parameters, report.data),
      options?.signal,
    );
    return compact && completed.ok
      ? projectRetainedAnalysis(
          completed.value,
          retention,
          view === undefined ? { kind: "summary" } : { kind: "rust", ...view },
        )
      : completed;
  }
}

const evidenceFor = (
  provider: RustBinaryPort["identity"],
  parameters: InspectRustBinaryInput,
  value: ReturnType<typeof rustBinarySchema.parse>,
): Evidence => {
  const architecture = binaryMetadataArchitecture(value.architecture);
  const section = value.auditable_metadata;
  return createEvidence(
    {
      path: value.artifact.path,
      sha256: value.artifact.sha256,
      format: metadataReportSubjectFormat(value),
      ...(architecture === undefined ? {} : { architecture }),
    },
    provider,
    {
      operation: OPERATION,
      parameters,
      result: value,
      confidence: "observed",
      limitations: value.limitations,
      locations: [
        { kind: "artifact-path", path: value.artifact.path },
        ...(section === null
          ? []
          : [
              {
                kind: "file-offset-range" as const,
                start: section.file_offset,
                end: section.file_offset + section.section_bytes,
              },
            ]),
      ],
    },
  );
};

import {
  inspectPacketFieldsInputSchema,
  packetFieldsCatalogSchema,
  type InspectPacketFieldsInput,
} from "../../domain/captures/packetFields.js";
import type {
  AnalysisExecution,
  ExecutionOptions,
} from "../AnalysisProvider.js";
import { createAnalysisExecutionEvidence } from "../../domain/analysisObservation.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import type { Evidence } from "../../domain/evidence.js";
import {
  inspectPacketCaptureInputSchema,
  packetCaptureSchema,
  type InspectPacketCaptureInput,
} from "../../domain/captures/packetCapture.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import { parseAnalysisInput } from "../AnalysisInput.js";

export interface PacketCapturePort {
  /** Release per-call resources before returning, or retain failed cleanup for close/retry. */
  inspect(
    input: InspectPacketCaptureInput,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>>;
  inspectFields(
    input: InspectPacketFieldsInput,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>>;
  close(): Promise<void>;
}

/** One shared validation and Evidence owner for CLI and MCP. */
export class PacketCaptureService {
  constructor(readonly provider: PacketCapturePort) {}
  close(): Promise<void> {
    return this.provider.close();
  }
  async inspect(
    raw: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const operation = "inspect_packet_capture";
    const input = parseAnalysisInput(
      operation,
      raw,
      inspectPacketCaptureInputSchema,
      options?.signal,
    );
    if (!input.ok) return input;
    const decoded = await this.provider.inspect(input.value, options);
    if (!decoded.ok) return decoded;
    const execution = decoded.value;
    const report = packetCaptureSchema.safeParse(execution.result);
    if (
      !report.success ||
      report.data.artifact.path !== input.value.path ||
      execution.subject?.path !== input.value.path ||
      execution.subject.sha256 !== report.data.artifact.sha256 ||
      JSON.stringify(report.data.selection) !== JSON.stringify(input.value)
    )
      return err(
        new AnalysisOutputError(
          operation,
          "Capture analyzer returned malformed data or changed the selected artifact identity/options.",
        ),
      );
    return completeProviderEvidence(
      createAnalysisExecutionEvidence(
        operation,
        input.value,
        execution,
        "observed",
      ),
      options?.signal,
    );
  }
  async inspectFields(
    raw: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const operation = "inspect_packet_fields";
    const input = parseAnalysisInput(
      operation,
      raw,
      inspectPacketFieldsInputSchema,
      options?.signal,
    );
    if (!input.ok) return input;
    const decoded = await this.provider.inspectFields(input.value, options);
    if (!decoded.ok) return decoded;
    const execution = decoded.value;
    const report = packetFieldsCatalogSchema.safeParse(execution.result);
    if (
      !report.success ||
      JSON.stringify(report.data.selection) !== JSON.stringify(input.value) ||
      execution.subject?.path !== report.data.tool.path ||
      execution.subject.sha256 !== report.data.tool.sha256
    )
      return err(
        new AnalysisOutputError(
          operation,
          "Field discovery returned malformed data or changed the selected installation/options.",
        ),
      );
    return completeProviderEvidence(
      createAnalysisExecutionEvidence(
        operation,
        input.value,
        execution,
        "observed",
      ),
      options?.signal,
    );
  }
}

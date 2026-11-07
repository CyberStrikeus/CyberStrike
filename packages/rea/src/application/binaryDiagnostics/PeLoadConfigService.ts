import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { PeLoadConfigPort } from "./PeLoadConfigPort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  inspectPeLoadConfigInputSchema,
  peLoadConfigSchema,
  type PeLoadConfig,
} from "../../domain/native/peLoadConfig.js";
import { peSubjectArchitecture } from "../../domain/peMachine.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import { parseAnalysisInput } from "../AnalysisInput.js";

const OPERATION = "inspect_pe_load_config";

/** Shared caller validation, output parsing and Evidence provenance for CLI/MCP. */
export class PeLoadConfigService {
  constructor(readonly provider: PeLoadConfigPort) {}

  close(): Promise<void> {
    return this.provider.close?.() ?? Promise.resolve();
  }

  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const input = parseAnalysisInput(
      OPERATION,
      rawInput,
      inspectPeLoadConfigInputSchema,
      options?.signal,
    );
    if (!input.ok) return input;
    const result = await this.provider.inspect(input.value, options);
    if (!result.ok) return result;
    const report = peLoadConfigSchema.safeParse(result.value);
    if (
      !report.success ||
      report.data.artifact.path !== input.value.path ||
      !validReport(report.data, input.value)
    )
      return err(
        new AnalysisOutputError(
          OPERATION,
          "PE TLS/load-config provider returned malformed output or changed artifact identity.",
        ),
      );
    const value = report.data;
    const architecture = peSubjectArchitecture(value.machine, value.format);
    const locations = [
      { kind: "artifact-path" as const, path: value.artifact.path },
      ...fileRange(value.tls?.directory ?? null),
      ...fileRange(value.load_config?.directory ?? null),
      ...structureRange(value.load_config),
      ...(value.tls?.callback_array_locations ?? []).map(
        ({ offset, bytes }) => ({
          kind: "file-offset-range" as const,
          start: offset,
          end: offset + bytes,
        }),
      ),
    ];
    return completeProviderEvidence(
      createEvidence(
        {
          path: value.artifact.path,
          format: "pe",
          sha256: value.artifact.sha256,
          ...(architecture === undefined ? {} : { architecture }),
        },
        this.provider.identity,
        {
          operation: OPERATION,
          parameters: input.value,
          result: value,
          confidence: "observed",
          limitations: value.limitations,
          locations,
        },
      ),
      options?.signal,
    );
  }
}

const fileRange = (
  directory: { file_offset: number; size: number } | null,
): { kind: "file-offset-range"; start: number; end: number }[] =>
  directory === null
    ? []
    : [
        {
          kind: "file-offset-range",
          start: directory.file_offset,
          end: directory.file_offset + directory.size,
        },
      ];

/** The checked `Size` span, when it differs from the declared directory range. */
const structureRange = (
  loadConfig: PeLoadConfig["load_config"],
): { kind: "file-offset-range"; start: number; end: number }[] =>
  loadConfig === null ||
  loadConfig.structure_location.bytes === loadConfig.directory.size
    ? []
    : [
        {
          kind: "file-offset-range",
          start: loadConfig.structure_location.offset,
          end:
            loadConfig.structure_location.offset +
            loadConfig.structure_location.bytes,
        },
      ];

const validReport = (
  report: PeLoadConfig,
  input: { max_callbacks: number; max_file_bytes: number },
): boolean => {
  if (
    report.artifact.bytes > input.max_file_bytes ||
    report.examined_callbacks !== (report.tls?.callbacks.length ?? 0) ||
    report.examined_callbacks > input.max_callbacks ||
    report.bits !== (report.format === "pe32" ? 32 : 64)
  )
    return false;
  const ranges = [
    ...fileRange(report.tls?.directory ?? null),
    ...fileRange(report.load_config?.directory ?? null),
  ];
  const structure = report.load_config?.structure_location;
  return (
    (structure === undefined ||
      (structure.offset === report.load_config?.directory.file_offset &&
        structure.bytes === report.load_config.size &&
        structure.offset <= report.artifact.bytes - structure.bytes)) &&
    ranges.every(
      ({ start, end }) => start <= end && end <= report.artifact.bytes,
    ) &&
    (report.tls?.callback_array_locations ?? []).every(
      ({ offset, bytes }) => offset <= report.artifact.bytes - bytes,
    ) &&
    (report.tls?.callbacks ?? []).every(
      ({ file_offset }) =>
        file_offset === null || file_offset < report.artifact.bytes,
    )
  );
};

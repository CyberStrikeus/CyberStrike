import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { PeImportsPort } from "./PeImportsPort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  inspectPeImportsInputSchema,
  peImportsSchema,
  type PeImports,
} from "../../domain/native/peImports.js";
import { peSubjectArchitecture } from "../../domain/peMachine.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import { parseAnalysisInput } from "../AnalysisInput.js";

const OPERATION = "inspect_pe_imports";

/** Shared caller validation, output parsing and Evidence provenance for CLI/MCP. */
export class PeImportsService {
  constructor(readonly provider: PeImportsPort) {}

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
      inspectPeImportsInputSchema,
      options?.signal,
    );
    if (!input.ok) return input;
    const result = await this.provider.inspect(input.value, options);
    if (!result.ok) return result;
    const report = peImportsSchema.safeParse(result.value);
    if (
      !report.success ||
      report.data.artifact.path !== input.value.path ||
      !validReport(report.data, input.value)
    )
      return err(
        new AnalysisOutputError(
          OPERATION,
          "PE import provider returned malformed output or changed artifact identity.",
        ),
      );
    const value = report.data;
    const architecture = peSubjectArchitecture(value.machine, value.format);
    const locations = [
      { kind: "artifact-path" as const, path: value.artifact.path },
      ...fileRange(value.import_directory),
      ...fileRange(value.delay_import_directory),
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
  directory: PeImports["import_directory"],
): readonly {
  kind: "file-offset-range";
  start: number;
  end: number;
}[] =>
  directory === null
    ? []
    : directory.locations.map(({ offset, bytes }) => ({
        kind: "file-offset-range" as const,
        start: offset,
        end: offset + bytes,
      }));

const validReport = (
  report: PeImports,
  input: {
    readonly max_dlls: number;
    readonly max_functions: number;
    readonly max_file_bytes: number;
  },
): boolean => {
  const inside = ({ offset, bytes }: { offset: number; bytes: number }) =>
    offset <= report.artifact.bytes - bytes;
  const dllCount = report.imports.length + report.delay_imports.length;
  if (
    report.artifact.bytes > input.max_file_bytes ||
    report.coverage.examined_dlls > input.max_dlls ||
    dllCount > report.coverage.examined_dlls ||
    (report.coverage.status === "complete" &&
      (dllCount !== report.coverage.examined_dlls || report.issues.length > 0))
  )
    return false;
  const importCount = report.imports.reduce(
    (count, dll) => count + dll.functions.length,
    0,
  );
  const delayImportCount = report.delay_imports.reduce(
    (count, dll) => count + dll.functions.length,
    0,
  );
  if (
    importCount !== report.coverage.imports ||
    delayImportCount !== report.coverage.delay_imports ||
    importCount + delayImportCount > input.max_functions
  )
    return false;
  for (const directory of [
    report.import_directory,
    report.delay_import_directory,
  ]) {
    if (
      directory !== null &&
      (!directory.locations.every(inside) ||
        (directory.locations.length === 0 &&
          report.coverage.status === "complete"))
    )
      return false;
  }
  const descriptorsFit = (
    rows: readonly { location: { offset: number; bytes: number } }[],
  ) => rows.every((row) => inside(row.location));
  return descriptorsFit(report.imports) && descriptorsFit(report.delay_imports);
};

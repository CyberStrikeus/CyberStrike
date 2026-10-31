import { isAbsolute } from "node:path";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { ElfNotesPort } from "./ElfNotesPort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  inspectElfNotesInputSchema,
  elfNotesSchema,
  type ElfNotes,
} from "../../domain/native/elfNotes.js";
import { BINARY_ARCHITECTURES } from "../../domain/binaryTargetTypes.js";
import { elfArchitecture } from "../../domain/elfFixedHeader.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import { parseAnalysisInput } from "../AnalysisInput.js";

const OPERATION = "inspect_elf_notes";

/** Shared caller validation, output parsing and Evidence provenance for CLI/MCP. */
export class ElfNotesService {
  constructor(readonly provider: ElfNotesPort) {}

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
      inspectElfNotesInputSchema,
      options?.signal,
    );
    if (!input.ok) return input;
    if (!isAbsolute(input.value.path))
      return err(
        new AnalysisInputError(OPERATION, undefined, [
          {
            path: ["path"],
            reason: "invalid_format",
            message: "Expected an absolute filesystem path on this host.",
          },
        ]),
      );
    const result = await this.provider.inspect(input.value, options);
    if (!result.ok) return result;
    const report = elfNotesSchema.safeParse(result.value);
    if (
      !report.success ||
      report.data.artifact.path !== input.value.path ||
      !validReport(
        report.data,
        input.value.max_entries,
        input.value.max_file_bytes,
      )
    )
      return err(
        new AnalysisOutputError(
          OPERATION,
          "ELF note provider returned malformed output or changed artifact identity.",
        ),
      );
    const value = report.data;
    const architecture = BINARY_ARCHITECTURES.find(
      (supported) => supported === elfArchitecture(value.machine),
    );
    const locations = [
      { kind: "artifact-path" as const, path: value.artifact.path },
      ...value.tables.map((table) => ({
        kind: "file-offset-range" as const,
        start: table.location.offset,
        end: table.location.offset + table.location.bytes,
      })),
    ];
    return completeProviderEvidence(
      createEvidence(
        {
          path: value.artifact.path,
          format: "elf",
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

const validReport = (
  report: ElfNotes,
  maxEntries: number,
  maxBytes: number,
): boolean => {
  const inside = ({ offset, bytes }: { offset: number; bytes: number }) =>
    offset <= report.artifact.bytes - bytes;
  if (
    report.artifact.bytes > maxBytes ||
    report.coverage.examined_entries > maxEntries ||
    report.entries.length !== report.coverage.examined_entries ||
    report.tables.length !== report.coverage.examined_tables
  )
    return false;
  return (
    report.tables.every((table) => inside(table.location)) &&
    report.entries.every(
      (entry) => inside(entry.location) && inside(entry.descriptor.location),
    )
  );
};

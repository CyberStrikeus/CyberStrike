import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { BeamPort } from "./BeamPort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  inspectErlangBeamInputSchema,
  erlangBeamSchema,
  type ErlangBeam,
} from "../../domain/erlang/beam.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import { parseAnalysisInput } from "../AnalysisInput.js";

const OPERATION = "inspect_erlang_beam";

/** Shared caller validation, output parsing and Evidence provenance for CLI/MCP. */
export class BeamService {
  constructor(readonly provider: BeamPort) {}

  close(): Promise<void> {
    return this.provider.close();
  }

  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const input = parseAnalysisInput(
      OPERATION,
      rawInput,
      inspectErlangBeamInputSchema,
      options?.signal,
    );
    if (!input.ok) return input;
    const result = await this.provider.inspect(input.value, options);
    if (!result.ok) return result;
    const report = erlangBeamSchema.safeParse(result.value);
    if (
      !report.success ||
      report.data.artifact.path !== input.value.path ||
      !validReport(
        report.data,
        input.value.max_chunks,
        input.value.max_atoms,
        input.value.max_file_bytes,
      )
    )
      return err(
        new AnalysisOutputError(
          OPERATION,
          "BEAM provider returned malformed output or changed artifact identity.",
        ),
      );
    const value = report.data;
    return completeProviderEvidence(
      createEvidence(
        {
          path: value.artifact.path,
          format: "file",
          sha256: value.artifact.sha256,
        },
        this.provider.identity,
        {
          operation: OPERATION,
          parameters: input.value,
          result: value,
          confidence: "observed",
          limitations: value.limitations,
          locations: [
            { kind: "artifact-path" as const, path: value.artifact.path },
            {
              kind: "file-offset-range" as const,
              start: value.form.location.offset,
              end: value.form.location.offset + value.form.location.bytes,
            },
          ],
        },
      ),
      options?.signal,
    );
  }
}

const validReport = (
  report: ErlangBeam,
  maxChunks: number,
  maxAtoms: number,
  maxBytes: number,
): boolean => {
  const inside = ({ offset, bytes }: { offset: number; bytes: number }) =>
    offset <= report.artifact.bytes - bytes;
  if (
    report.artifact.bytes > maxBytes ||
    report.coverage.examined_chunks > maxChunks ||
    report.chunks.length > maxChunks ||
    report.coverage.atoms > maxAtoms ||
    (report.atoms !== null && report.atoms.length > maxAtoms)
  )
    return false;
  if (!inside(report.form.location)) return false;
  if (report.code !== null && !inside(report.code.instructions)) return false;
  return report.chunks.every(
    (chunk) => inside(chunk.location) && inside(chunk.payload.location),
  );
};

import { isAbsolute } from "node:path";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { AppleIpsPort } from "./AppleIpsPort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  appleIpsSchema,
  appleIpsReportIntegerTextBytes,
  inspectAppleIpsInputSchema,
  type AppleIps,
} from "../../domain/native/appleIps.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import { parseAnalysisInput } from "../AnalysisInput.js";

const OPERATION = "inspect_apple_ips";

/** Shared caller validation, output parsing and Evidence provenance for CLI/MCP. */
export class AppleIpsService {
  constructor(readonly provider: AppleIpsPort) {}

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
      inspectAppleIpsInputSchema,
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
    const report = appleIpsSchema.safeParse(result.value);
    if (
      !report.success ||
      report.data.artifact.path !== input.value.path ||
      !validReport(report.data, input.value)
    )
      return err(
        new AnalysisOutputError(
          OPERATION,
          "Apple IPS provider returned malformed output or changed artifact identity.",
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
          locations: [{ kind: "artifact-path", path: value.artifact.path }],
        },
      ),
      options?.signal,
    );
  }
}

const validReport = (
  report: AppleIps,
  input: InspectAppleIpsInputLike,
): boolean => {
  if (
    report.artifact.bytes > input.max_file_bytes ||
    report.coverage.threads > input.max_threads ||
    report.coverage.frames > input.max_frames ||
    report.coverage.images > input.max_images ||
    report.coverage.registers > input.max_registers ||
    report.coverage.threads !== report.threads.length ||
    report.coverage.images !== report.images.length
  )
    return false;
  const faultingThread = report.faulting_thread;
  const mismatches = report.coverage.type_mismatches;
  if (
    faultingThread !== null &&
    (report.threads[faultingThread]?.index !== faultingThread ||
      mismatches.some(
        ({ path }) => path === `body.threads[${String(faultingThread)}]`,
      )) &&
    !mismatches.some(({ path }) => path === "body.faultingThread")
  )
    return false;
  let frames = 0;
  let registers = 0;
  for (const thread of report.threads) {
    frames += thread.frames.length;
    registers += thread.registers.length;
  }
  return (
    frames === report.coverage.frames &&
    registers === report.coverage.registers &&
    appleIpsReportIntegerTextBytes(report) <= input.max_integer_text_bytes &&
    (report.coverage.status === "complete") ===
      (report.coverage.type_mismatches.length === 0)
  );
};

type InspectAppleIpsInputLike = {
  readonly max_file_bytes: number;
  readonly max_threads: number;
  readonly max_frames: number;
  readonly max_images: number;
  readonly max_registers: number;
  readonly max_integer_text_bytes: number;
};

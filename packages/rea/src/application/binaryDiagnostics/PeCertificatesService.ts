import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { PeCertificatesPort } from "./PeCertificatesPort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  inspectPeCertificatesInputSchema,
  peCertificatesSchema,
  type PeCertificates,
} from "../../domain/native/peCertificates.js";
import { peSubjectArchitecture } from "../../domain/peMachine.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import { parseAnalysisInput } from "../AnalysisInput.js";

const OPERATION = "inspect_pe_certificates";

/** Shared caller validation, output parsing and Evidence provenance for CLI/MCP. */
export class PeCertificatesService {
  constructor(readonly provider: PeCertificatesPort) {}

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
      inspectPeCertificatesInputSchema,
      options?.signal,
    );
    if (!input.ok) return input;
    const result = await this.provider.inspect(input.value, options);
    if (!result.ok) return result;
    const report = peCertificatesSchema.safeParse(result.value);
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
          "PE certificate provider returned malformed output or changed artifact identity.",
        ),
      );
    const value = report.data;
    const architecture = peSubjectArchitecture(value.machine, value.format);
    const locations = [
      { kind: "artifact-path" as const, path: value.artifact.path },
      ...(value.table === null
        ? []
        : [
            {
              kind: "file-offset-range" as const,
              start: value.table.location.offset,
              end: value.table.location.offset + value.table.location.bytes,
            },
          ]),
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

const validReport = (
  report: PeCertificates,
  maxEntries: number,
  maxBytes: number,
): boolean => {
  const inside = ({ offset, bytes }: { offset: number; bytes: number }) =>
    offset <= report.artifact.bytes - bytes;
  if (
    report.artifact.bytes > maxBytes ||
    report.coverage.examined_entries > maxEntries ||
    report.coverage.examined_entries !== report.entries.length ||
    report.coverage.certificates !==
      report.entries.reduce(
        (count, entry) => count + (entry.pkcs7?.certificates.length ?? 0),
        0,
      )
  )
    return false;
  if (
    report.coverage.status === "complete" &&
    report.entries.some((entry) =>
      entry.pkcs7?.signers.some((signer) =>
        Array.isArray(signer.unsigned_attribute_oids),
      ),
    )
  )
    return false;
  if (report.table === null) return report.entries.length === 0;
  if (
    !inside(report.table.location) ||
    !inside(report.table.data_directory_location)
  )
    return false;
  const table = report.table;
  const contains = (
    outer: { offset: number; bytes: number },
    inner: { offset: number; bytes: number },
  ) =>
    inner.offset >= outer.offset &&
    inner.offset - outer.offset <= outer.bytes - inner.bytes;
  return report.entries.every(
    (entry) =>
      contains(table.location, entry.location) &&
      contains(entry.location, entry.payload.location) &&
      (entry.pkcs7?.certificates.every((certificate) =>
        contains(entry.payload.location, certificate.location),
      ) ??
        true),
  );
};

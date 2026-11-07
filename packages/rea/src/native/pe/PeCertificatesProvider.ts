import {
  projectStableArtifactFailure,
  projectArtifactCloseFailure,
} from "../../artifacts/StableArtifactFailure.js";
import { isSelectedRegularFileError } from "../../filesystem/RegularFile.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { readStableArtifact } from "../../artifacts/readStableArtifact.js";
import {
  artifactFilePrimaryFacts,
  type ArtifactFilePrimaryFacts,
  artifactFileCancellationCause,
} from "../../artifacts/ArtifactFileOperation.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import type { PeCertificatesPort } from "../../application/binaryDiagnostics/PeCertificatesPort.js";
import type { ExecutionOptions } from "../../application/AnalysisProvider.js";
import { ArtifactOperationError } from "../../domain/artifactOperationError.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../../domain/analysisErrorCore.js";
import {
  MAX_INSPECT_PE_CERTIFICATE_ENTRIES,
  MAX_INSPECT_PE_CERTIFICATE_FILE_BYTES,
  type InspectPeCertificatesInput,
} from "../../domain/native/peCertificates.js";
import { err, ok } from "../../domain/result.js";
import { fixedAllowanceOptions } from "../../domain/fixedAllowanceRemediation.js";
import { PE_CERTIFICATES_PROVIDER } from "../../domain/investigationProviders.js";
import {
  PeCertificateAsn1Failure,
  type PeCertificateDecodeAllowance,
} from "./PeCertificateAsn1.js";
import { parsePeCertificates } from "./PeCertificateParser.js";

const OPERATION = "inspect_pe_certificates";

/** Portable parser over one bounded, identity-checked regular file. */
export class PeCertificatesProvider implements PeCertificatesPort {
  readonly identity = PE_CERTIFICATES_PROVIDER;
  readonly #resources = new ArtifactResourceScope();

  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      throw projectArtifactCloseFailure(
        cause,
        PE_CERTIFICATES_PROVIDER.id,
        OPERATION,
      );
    }
  }

  async inspect(input: InspectPeCertificatesInput, options?: ExecutionOptions) {
    try {
      return await this.#resources.run(async () => {
        const snapshot = await readStableArtifact(
          input.path,
          input.max_file_bytes,
          options?.signal,
          undefined,
          this.#resources,
        );
        return ok(
          parsePeCertificates(
            snapshot.bytes,
            {
              path: input.path,
              sha256: snapshot.sha256,
              bytes: snapshot.bytes.length,
            },
            input,
          ),
        );
      });
    } catch (cause) {
      return err(peCertificatesFailure(cause, input));
    }
  }
}

const inputBudgetRemediation = (
  boundary: "file-size" | "capacity",
  input: InspectPeCertificatesInput,
): string =>
  boundary === "file-size"
    ? input.max_file_bytes >= MAX_INSPECT_PE_CERTIFICATE_FILE_BYTES
      ? `The image exceeds the ${String(MAX_INSPECT_PE_CERTIFICATE_FILE_BYTES)}-byte input ceiling this operation accepts; select a smaller artifact.`
      : `Raise max_file_bytes above ${String(input.max_file_bytes)} bytes or select a smaller artifact; the limit is the caller-selected input read budget.`
    : input.max_entries >= MAX_INSPECT_PE_CERTIFICATE_ENTRIES
      ? `The image exceeds the ${String(MAX_INSPECT_PE_CERTIFICATE_ENTRIES)}-entry certificate-table ceiling this operation accepts; select a smaller artifact.`
      : `Raise max_entries above ${String(input.max_entries)} or select a smaller artifact; the limit is the caller-selected certificate entry budget.`;

/** A fixed PKCS#7 decoder allowance; neither request fields nor retries raise it. */
const decoderAllowanceFailure = (
  cause: PeCertificateAsn1Failure,
  { allowance, limit }: PeCertificateDecodeAllowance,
) =>
  new AnalysisResourceConstraintError(
    OPERATION,
    "memory",
    `PKCS#7 signedData exceeds a fixed decoder allowance: ${cause.message}`,
    allowance === "asn1-nodes"
      ? { max_asn1_values: limit }
      : { max_decoded_text_bytes: limit },
    {
      cause,
      ...fixedAllowanceOptions(
        allowance === "asn1-nodes"
          ? `The PE certificate ASN.1 allowance of ${String(limit)} values per PKCS#7 payload (this release has no runtime override)`
          : `The PE certificate decoded-text allowance of ${String(limit)} bytes per PKCS#7 payload (this release has no runtime override)`,
        "parser",
      ),
    },
  );

const peCertificatesFailurePrimary = (
  facts: ArtifactFilePrimaryFacts,
  input: InspectPeCertificatesInput,
) => {
  const { cause, origin } = facts;
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "integrity"
  )
    return new AnalysisArtifactChangedError(
      OPERATION,
      input.path,
      cause.message,
      {
        cause,
      },
    );
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "cancelled"
  )
    return new AnalysisCancelledError(OPERATION, {
      cause: artifactFileCancellationCause(cause),
    });
  if (
    origin === "owned-or-classified" &&
    cause instanceof PeCertificateAsn1Failure &&
    cause.exhausted !== null
  )
    return decoderAllowanceFailure(cause, cause.exhausted);
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure
  ) {
    if (cause.reason === "limit")
      return new AnalysisResourceConstraintError(
        OPERATION,
        cause.boundary ?? "memory",
        cause.message,
        {
          max_file_bytes: input.max_file_bytes,
          max_entries: input.max_entries,
        },
        {
          cause,
          ...(cause.boundary === undefined || cause.boundary === "memory"
            ? {}
            : {
                retryable: false,
                remediationAction: inputBudgetRemediation(
                  cause.boundary,
                  input,
                ),
              }),
        },
      );
    if (cause.reason === "path" || cause.reason === "format")
      return new AnalysisInputError(OPERATION, { cause }, [
        {
          path: ["path"],
          reason: "invalid_format",
          message: cause.message,
        },
      ]);
  }
  if (cause instanceof Error && "code" in cause) {
    if (cause.code === "EACCES" || cause.code === "EPERM")
      return new AnalysisAccessDeniedError(OPERATION, input.path, cause.code, {
        cause,
      });
    if (isSelectedRegularFileError(cause))
      return new AnalysisInputError(OPERATION, { cause }, [
        {
          path: ["path"],
          reason: "invalid_value",
          message: `Selected PE image could not be read (${String(cause.code)}): ${input.path}.`,
        },
      ]);
  }
  return new ArtifactOperationError(
    OPERATION,
    origin === "owned-or-classified" && cause instanceof ArtifactReaderFailure
      ? cause.reason
      : "io",
    undefined,
    cause instanceof Error
      ? cause.message
      : "PE certificate inspection failed.",
    { cause },
  );
};

const peCertificatesFailure = (
  cause: unknown,
  input: InspectPeCertificatesInput,
) => {
  const primary = peCertificatesFailurePrimary(
    artifactFilePrimaryFacts(cause),
    input,
  );
  return projectStableArtifactFailure(
    cause,
    primary,
    input.path,
    PE_CERTIFICATES_PROVIDER.id,
    OPERATION,
  );
};

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
  assertArtifactReadActive,
  artifactFileCancellationCause,
} from "../../artifacts/ArtifactFileOperation.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import type { AppleIpsPort } from "../../application/binaryDiagnostics/AppleIpsPort.js";
import type { ExecutionOptions } from "../../application/AnalysisProvider.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../../domain/analysisErrorCore.js";
import {
  MAX_INSPECT_APPLE_IPS_FILE_BYTES,
  MAX_INSPECT_APPLE_IPS_FRAMES,
  MAX_INSPECT_APPLE_IPS_IMAGES,
  MAX_INSPECT_APPLE_IPS_REGISTERS,
  MAX_INSPECT_APPLE_IPS_INTEGER_TEXT_BYTES,
  DEFAULT_INSPECT_APPLE_IPS_INTEGER_TEXT_BYTES,
  MAX_INSPECT_APPLE_IPS_THREADS,
  type InspectAppleIpsInput,
} from "../../domain/native/appleIps.js";
import { fixedAllowanceOptions } from "../../domain/fixedAllowanceRemediation.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { err, ok } from "../../domain/result.js";
import { APPLE_IPS_PROVIDER } from "../../domain/investigationProviders.js";
import {
  AppleIpsFormatFailure,
  AppleIpsResourceFailure,
  type AppleIpsSelectedBoundary,
} from "./AppleIps.errors.js";
import { parseAppleIps } from "./AppleIpsParser.js";

const OPERATION = "inspect_apple_ips";

/** Portable .ips reader over one bounded, identity-checked regular file. */
export class AppleIpsProvider implements AppleIpsPort {
  readonly identity = APPLE_IPS_PROVIDER;
  readonly #resources = new ArtifactResourceScope();

  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      throw projectArtifactCloseFailure(
        cause,
        APPLE_IPS_PROVIDER.id,
        OPERATION,
      );
    }
  }

  async inspect(input: InspectAppleIpsInput, options?: ExecutionOptions) {
    try {
      return await this.#resources.run(async () => {
        const snapshot = await readStableArtifact(
          input.path,
          input.max_file_bytes,
          options?.signal,
          undefined,
          this.#resources,
        );
        assertArtifactReadActive(options?.signal);
        const report = parseAppleIps(
          snapshot.bytes,
          {
            path: input.path,
            sha256: snapshot.sha256,
            bytes: snapshot.bytes.length,
          },
          input,
        );
        assertArtifactReadActive(options?.signal);
        return ok(report);
      });
    } catch (cause) {
      return err(appleIpsFailure(cause, input));
    }
  }
}

const fileSizeRemediation = (input: InspectAppleIpsInput): string =>
  input.max_file_bytes >= MAX_INSPECT_APPLE_IPS_FILE_BYTES
    ? `The report exceeds the ${String(MAX_INSPECT_APPLE_IPS_FILE_BYTES)}-byte input ceiling this operation accepts. This release has no runtime override. Select a smaller artifact.`
    : `Raise max_file_bytes above ${String(input.max_file_bytes)} bytes or select a smaller artifact; the limit is the caller-selected input read budget.`;

const SELECTED_BUDGETS = {
  threads: {
    argument: "max_threads",
    maximum: MAX_INSPECT_APPLE_IPS_THREADS,
    unit: "entries",
  },
  frames: {
    argument: "max_frames",
    maximum: MAX_INSPECT_APPLE_IPS_FRAMES,
    unit: "entries",
  },
  images: {
    argument: "max_images",
    maximum: MAX_INSPECT_APPLE_IPS_IMAGES,
    unit: "entries",
  },
  registers: {
    argument: "max_registers",
    maximum: MAX_INSPECT_APPLE_IPS_REGISTERS,
    unit: "entries",
  },
  integer_text: {
    argument: "max_integer_text_bytes",
    maximum: MAX_INSPECT_APPLE_IPS_INTEGER_TEXT_BYTES,
    unit: "UTF-16 bytes",
  },
} as const satisfies Record<
  AppleIpsSelectedBoundary,
  {
    readonly argument: keyof InspectAppleIpsInput;
    readonly maximum: number;
    readonly unit: string;
  }
>;

const isSelectedBoundary = (
  boundary: AppleIpsResourceFailure["boundary"],
): boundary is AppleIpsSelectedBoundary =>
  Object.hasOwn(SELECTED_BUDGETS, boundary);

const budgetRemediation = (
  input: InspectAppleIpsInput,
  boundary: AppleIpsSelectedBoundary,
): string => {
  const { argument, maximum, unit } = SELECTED_BUDGETS[boundary];
  const selected = input[argument];
  const recovery =
    selected >= maximum
      ? `This release has no override above the ${String(maximum)} ${unit} ceiling; select a smaller report.`
      : `Raise ${argument} on the next call, up to ${String(maximum)} ${unit}, or select a smaller report; no restart is required.`;
  const explanation =
    boundary === "integer_text"
      ? ` The default is ${String(DEFAULT_INSPECT_APPLE_IPS_INTEGER_TEXT_BYTES)} UTF-16 bytes. Conservative reservation precedes numeric conversion and address expansion; max_file_bytes and row budgets do not raise it.`
      : "";
  return `Effective ${argument} is ${String(selected)} ${unit}. ${recovery}${explanation}`;
};

const resourceRecovery = (
  input: InspectAppleIpsInput,
  cause: AppleIpsResourceFailure,
) => {
  const { boundary } = cause;
  return isSelectedBoundary(boundary)
    ? {
        retryable: false,
        remediationAction: budgetRemediation(input, boundary),
      }
    : fixedAllowanceOptions(
        `The IPS ${boundary.replaceAll("_", " ")} allowance of ${String(cause.maximum)}`,
        "parser",
      );
};

const appleIpsFailurePrimary = (
  facts: ArtifactFilePrimaryFacts,
  input: InspectAppleIpsInput,
): AnalysisError => {
  const { cause, origin } = facts;
  if (origin === "owned-or-classified" && cause instanceof AnalysisError)
    return cause;
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "integrity"
  )
    return new AnalysisArtifactChangedError(
      OPERATION,
      input.path,
      cause.message,
      { cause },
    );
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "cancelled"
  )
    return new AnalysisCancelledError(OPERATION, {
      cause: artifactFileCancellationCause(cause),
    });
  if (cause instanceof AppleIpsResourceFailure)
    return new AnalysisResourceConstraintError(
      OPERATION,
      "capacity",
      `Selected artifact ${input.path}: ${cause.message}`,
      { boundary: cause.boundary, maximum: cause.maximum },
      { cause, ...resourceRecovery(input, cause) },
    );
  if (cause instanceof AppleIpsFormatFailure)
    return cause.kind === "unsupported"
      ? new AnalysisUnsupportedTargetError(
          OPERATION,
          input.path,
          cause.message,
          { cause },
        )
      : new AnalysisInputError(OPERATION, { cause }, [
          {
            path: ["path"],
            reason: "invalid_format",
            message: `Selected artifact ${input.path}: ${cause.message}`,
          },
        ]);
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure
  ) {
    if (cause.reason === "limit")
      return new AnalysisResourceConstraintError(
        OPERATION,
        "file-size",
        cause.message,
        { max_file_bytes: input.max_file_bytes },
        {
          cause,
          retryable: false,
          remediationAction: fileSizeRemediation(input),
        },
      );
    if (cause.reason === "path" || cause.reason === "format")
      return new AnalysisInputError(OPERATION, { cause }, [
        { path: ["path"], reason: "invalid_format", message: cause.message },
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
          message: `Selected report could not be read (${String(cause.code)}): ${input.path}.`,
        },
      ]);
  }
  return new ProviderAdapterError(APPLE_IPS_PROVIDER.id, OPERATION, {
    cause,
    diagnostics: {
      path: input.path,
      reason: cause instanceof Error ? cause.message : String(cause),
    },
  });
};

const appleIpsFailure = (
  cause: unknown,
  input: InspectAppleIpsInput,
): AnalysisError => {
  const primary = appleIpsFailurePrimary(
    artifactFilePrimaryFacts(cause),
    input,
  );
  return projectStableArtifactFailure(
    cause,
    primary,
    input.path,
    APPLE_IPS_PROVIDER.id,
    OPERATION,
  );
};

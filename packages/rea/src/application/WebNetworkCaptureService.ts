import { redactExplicitFailure } from "../domain/explicitSensitiveFailure.js";
import { excludeCaptureCoordinates } from "../domain/webNetworkCaptureCoordinates.js";
import { redactExplicitText } from "../domain/explicitSensitiveValues.js";
import type { ExecutionOptions } from "./AnalysisProvider.js";
import type { WebNetworkCapturePort } from "./WebNetworkCapturePort.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { createAnalysisProfile } from "../domain/analysisProfile.js";
import { createEvidence, type Evidence } from "../domain/evidence.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { jsonObjectSchema } from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  inspectWebNetworkCaptureInputSchema,
  captureSensitiveValues,
  webNetworkCaptureSchema,
  type InspectWebNetworkCaptureInput,
  type WebNetworkCapture,
} from "../domain/webNetworkCapture.js";
import { completeProviderEvidence } from "./ProviderOperationExecution.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";

const OPERATION = "inspect_web_network_capture";

/** Shared CLI/MCP historical inspection preserves caller selection and producer record identity. */
export class WebNetworkCaptureService {
  constructor(readonly port: WebNetworkCapturePort) {}

  /** Release resources retained by the selected capture adapter. */
  close(): Promise<void> {
    return this.port.close?.() ?? Promise.resolve();
  }

  /** Return selected complete records inline, without inventing live browser attribution. */
  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    if (options?.signal?.aborted)
      return err(
        new AnalysisCancelledError(OPERATION, {
          cause: options.signal.reason,
        }),
      );
    const failure = (error: AnalysisError): Result<never, AnalysisError> =>
      err(redactExplicitFailure(error, captureSensitiveValues(rawInput)));
    const parsed = inspectWebNetworkCaptureInputSchema.safeParse(rawInput);
    if (!parsed.success)
      return failure(
        analysisInputErrorFromIssues(OPERATION, parsed.error.issues, rawInput, {
          cause: parsed.error,
        }),
      );
    const input = parsed.data;
    if (
      input.record_ordinals !== undefined &&
      new Set(input.record_ordinals).size !== input.record_ordinals.length
    )
      return failure(
        new AnalysisInputError(OPERATION, undefined, [
          {
            path: ["record_ordinals"],
            reason: "invalid_format",
            message: "Each requested producer ordinal must occur once.",
          },
        ]),
      );
    if (input.protobuf !== undefined && input.record_ordinals === undefined)
      return failure(
        new AnalysisInputError(OPERATION, undefined, [
          {
            path: ["record_ordinals"],
            reason: "invalid_format",
            message:
              "Protobuf options require explicit producer record ordinals.",
          },
        ]),
      );
    const loaded = await this.port.inspect(input, options);
    if (!loaded.ok) {
      const partial = webNetworkCaptureSchema.safeParse(
        loaded.error.partialObservation,
      );
      let partialFailure: AnalysisError | undefined;
      if (partial.success) {
        const projected = this.#projectCapture(input, partial.data);
        if (projected.ok) loaded.error.partialObservation = projected.value;
        else partialFailure = projected.error;
      } else if (isCapturePartialCandidate(loaded.error.partialObservation)) {
        partialFailure = new AnalysisOutputError(
          OPERATION,
          "Capture adapter retained malformed historical evidence.",
          { cause: partial.error },
        );
      }
      if (partialFailure !== undefined) {
        loaded.error.partialObservation = undefined;
        partialFailure.retainSecondaryFailure(loaded.error);
        return failure(
          loaded.error.cleanupIncomplete
            ? analysisErrorWithCleanupFailure(
                partialFailure,
                loaded.error,
                OPERATION,
              ).bindCleanupDependencies([partialFailure, loaded.error])
            : partialFailure,
        );
      }
      return failure(loaded.error);
    }
    const report = webNetworkCaptureSchema.safeParse(loaded.value);
    if (!report.success)
      return failure(
        new AnalysisOutputError(
          OPERATION,
          "Capture adapter returned malformed historical evidence.",
        ),
      );
    const projected = this.#projectCapture(input, report.data);
    if (!projected.ok) return failure(projected.error);
    return completeProviderEvidence(projected.value, options?.signal);
  }

  #projectCapture(
    input: InspectWebNetworkCaptureInput,
    value: WebNetworkCapture,
  ): Result<Evidence, AnalysisError> {
    const artifactSha256 = value.artifact.sha256;
    if (artifactSha256 === null)
      return err(
        new AnalysisOutputError(
          OPERATION,
          "Capture adapter omitted its observed artifact digest before explicit projection.",
        ),
      );
    if (
      value.artifact.path !== input.capture_path ||
      value.format !== input.format ||
      value.total_records !== value.records.length ||
      value.records.some((record, index) => record.ordinal !== index)
    )
      return err(
        new AnalysisOutputError(
          OPERATION,
          "Capture adapter changed the selected artifact, format or original record sequence.",
        ),
      );
    const safeValue = excludeCaptureCoordinates(value, input.sensitive_values);
    const redactText = (text: string): string =>
      redactExplicitText(text, input.sensitive_values);
    const selected =
      input.record_ordinals ?? value.records.map(({ ordinal }) => ordinal);
    const records = [];
    for (const [index, ordinal] of selected.entries()) {
      const record = safeValue.records[ordinal];
      // A selection past the capture's records is a caller range fault.
      if (record === undefined)
        return err(
          new AnalysisInputError(OPERATION, undefined, [
            value.total_records === 0
              ? {
                  path: ["record_ordinals", index],
                  reason: "invalid_value",
                  message: "The selected capture contains no records.",
                }
              : {
                  path: ["record_ordinals", index],
                  reason: "out_of_range",
                  minimum: 0,
                  maximum: value.total_records - 1,
                  message: `Producer ordinal ${ordinal} is outside the retained capture (${value.total_records} records).`,
                },
          ]),
        );
      records.push({
        ...record,
        limitations: record.limitations.map(redactText),
      });
    }
    const safePath = input.sensitive_values.some((literal) =>
      input.capture_path.includes(literal),
    )
      ? ""
      : input.capture_path;
    const safeSha256 = input.sensitive_values.some((literal) =>
      artifactSha256.includes(literal),
    )
      ? null
      : artifactSha256;
    const subjectUnavailableReason = redactText(
      "The explicitly sensitive artifact digest is excluded; its cryptographic identity is unknown in this Evidence.",
    );
    const limitations = [
      ...safeValue.limitations,
      ...(safePath === ""
        ? [
            "The explicitly sensitive artifact path is excluded; its size remains available.",
          ]
        : []),
    ].map(redactText);
    const parameters = jsonObjectSchema.parse({
      capture_path: safePath,
      ...(input.sensitive_values.some((literal) =>
        input.format.includes(literal),
      )
        ? {}
        : { format: input.format }),
      record_ordinals: selected,
      ...(input.protobuf === undefined
        ? {}
        : {
            protobuf: {
              framing: input.protobuf.framing,
              ...(input.protobuf.body_pointers === undefined
                ? {}
                : {
                    body_pointers: input.protobuf.body_pointers.map(redactText),
                  }),
              ...(input.protobuf.schema === undefined
                ? {}
                : {
                    schema: {
                      descriptor_set_path: redactText(
                        input.protobuf.schema.descriptor_set_path,
                      ),
                      message_type: redactText(
                        input.protobuf.schema.message_type,
                      ),
                    },
                  }),
            },
          }),
      sensitive_value_count: input.sensitive_values.length,
      ...(input.capture_timeout_ms === undefined
        ? {}
        : { capture_timeout_ms: input.capture_timeout_ms }),
    });
    return ok(
      createEvidence(
        safeSha256 === null
          ? undefined
          : {
              path: safePath,
              sha256: safeSha256,
              format: "file",
            },
        value.decoder,
        {
          operation: OPERATION,
          parameters,
          result: {
            ...safeValue,
            artifact: {
              ...value.artifact,
              path: safePath,
              sha256: safeSha256,
            },
            records,
            limitations:
              safeSha256 === null
                ? [...limitations, subjectUnavailableReason]
                : limitations,
          },
          ...(safeValue.format !== "qlog"
            ? {}
            : {
                analysisProfile: createAnalysisProfile(value.decoder, {
                  qlog_profile: safeValue.qlog.profile,
                  clock: safeValue.qlog.clock,
                  scope: safeValue.qlog.scope,
                }),
              }),
          confidence: "observed",
          authority: "historical-reference",
          limitations,
          ...(safeSha256 === null ? { subjectUnavailableReason } : {}),
          locations:
            safePath === "" ? [] : [{ kind: "artifact-path", path: safePath }],
        },
      ),
    );
  }
}

const isCapturePartialCandidate = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    "artifact" in candidate &&
    ["format", "records", "decoder"].some((field) => field in candidate)
  );
};

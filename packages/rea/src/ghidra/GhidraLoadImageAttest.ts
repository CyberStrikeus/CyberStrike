import { jsonValueSchema } from "../domain/jsonValue.js";
import type { AnalysisOperation } from "../application/AnalysisProvider.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  nativeLoadImageSchema,
  type NativeLoadImage,
  type NativeLoadImageObservation,
} from "../domain/native/nativeLoadImage.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  attestGhidraDosComLoadImage,
  attestGhidraRawBinaryLoadImage,
} from "./GhidraLoadImageValues.js";
import { attestGhidraDolLoadImage } from "./GhidraDolLoadImage.js";
import {
  ghidraUnverifiedLoadImageReason,
  isGhidraVerifiedLoadImageFormat,
} from "./GhidraVerifiedLoadImageFormats.js";
import type { GhidraLanguageOverride } from "../config/ghidraLanguageOverride.js";
import type { NativeAotPeResult } from "../domain/native/nativeAotPe.js";
import type { GhidraClient } from "./GhidraClient.js";
import type { GhidraSessionError } from "./GhidraSessionError.js";

type NativeLoadImageAttestationInput = {
  readonly target: BinaryTarget;
  readonly operation: AnalysisOperation;
  readonly measured: NativeLoadImageObservation;
  readonly client: Partial<
    Pick<
      GhidraClient,
      | "hashTargetSnapshot"
      | "hashTargetSnapshotRanges"
      | "readTargetSnapshot"
      | "attestDosTargetSnapshot"
    >
  >;
  readonly mapSessionError: (failure: GhidraSessionError) => AnalysisError;
  readonly nativeAotResult?: NativeAotPeResult | undefined;
  /** Import language committed by the profile; DOL attestation expects it. */
  readonly languageOverride?: GhidraLanguageOverride | undefined;
  readonly signal?: AbortSignal | undefined;
};

/** Consume one typed comparison, retaining completed facts after the last awaited work. */
export const attestGhidraNativeLoadImage = async (
  input: NativeLoadImageAttestationInput,
): Promise<Result<NativeLoadImage, AnalysisError>> => {
  const result = await compareLoadImage(input);
  if (!result.ok) return result;
  return input.signal?.aborted
    ? err(
        new AnalysisCancelledError(input.operation, {
          cause: input.signal.reason,
          partialObservation: {
            kind: "native-load-image",
            stage: "completed",
            result: result.value,
          },
        }),
      )
    : result;
};

const comparisonFailure = (
  input: NativeLoadImageAttestationInput,
  reason: string,
  cause?: unknown,
): AnalysisError =>
  new ProviderAdapterError("ghidra", input.operation, {
    diagnostics: { reason },
    ...(cause === undefined ? {} : { cause }),
    partialObservation: {
      kind: "native-load-image",
      stage: "measured",
      observations: input.measured,
    },
  });

const compareLoadImage = async (
  input: NativeLoadImageAttestationInput,
): Promise<Result<NativeLoadImage, AnalysisError>> => {
  const {
    target,
    operation,
    measured: observations,
    client,
    mapSessionError,
    nativeAotResult,
    signal,
  } = input;
  // These formats have no additional source work; retain already-derived PE facts.
  if (
    target.format === "pe" ||
    !isGhidraVerifiedLoadImageFormat(target.format)
  ) {
    if (target.format === "pe" && nativeAotResult === undefined)
      return err(
        comparisonFailure(
          input,
          "The Ghidra provider did not produce read-only NativeAOT metadata for this admitted PE snapshot.",
        ),
      );
    const represented = nativeLoadImageSchema.safeParse({
      status: "unsupported",
      reason: ghidraUnverifiedLoadImageReason(),
      observations:
        target.format !== "pe" || nativeAotResult === undefined
          ? observations
          : {
              ...observations,
              metadata_recovery: [
                ...(observations.metadata_recovery ?? []),
                nativeAotResult.summary,
              ],
            },
      limitations: [
        target.format === "pe"
          ? "Load-image verification is not performed for PE targets; NativeAOT metadata observations are derived separately from the exact admitted snapshot."
          : "Other formats expose measured mappings and source identities; no format-specific verification was performed.",
      ],
    });
    return represented.success
      ? ok(represented.data)
      : err(
          comparisonFailure(
            input,
            "Load-image observations could not be represented in the result",
            represented.error,
          ),
        );
  }
  if (signal?.aborted)
    return err(
      new AnalysisCancelledError(operation, {
        cause: signal.reason,
        partialObservation: {
          kind: "native-load-image",
          stage: "measured",
          observations,
        },
      }),
    );
  const sourceFailure = (failure: GhidraSessionError): AnalysisError =>
    mapSessionError(
      failure.withDiagnostics({
        ...failure.diagnostics,
        load_image_observations: jsonValueSchema.parse(observations),
      }),
    );
  if (target.format === "gamecube-dol") {
    if (client.hashTargetSnapshotRanges === undefined)
      return err(
        comparisonFailure(
          input,
          "The Ghidra client does not expose its immutable target snapshot ranges for independent DOL load-image verification.",
        ),
      );
    const snapshot = await client.hashTargetSnapshotRanges(
      target.dol.sections.map((section) => ({
        start: section.fileOffset,
        end: section.fileOffset + section.size,
      })),
      signal,
    );
    if (!snapshot.ok) return err(sourceFailure(snapshot.error));
    const attested = attestGhidraDolLoadImage(
      {
        sha256: snapshot.value.sha256,
        bytes: snapshot.value.bytes,
        sectionSha256: snapshot.value.rangeSha256,
      },
      target,
      observations,
      input.languageOverride,
    );
    return attested.ok
      ? attested
      : err(comparisonFailure(input, attested.error));
  }
  if (target.format === "raw-binary") {
    if (client.hashTargetSnapshot === undefined)
      return err(
        comparisonFailure(
          input,
          "The Ghidra client does not expose its immutable target snapshot identity for independent raw-binary load-image verification.",
        ),
      );
    const snapshot = await client.hashTargetSnapshot(signal);
    if (!snapshot.ok) return err(sourceFailure(snapshot.error));
    const attested = attestGhidraRawBinaryLoadImage(
      snapshot.value,
      target,
      observations,
    );
    return attested.ok
      ? attested
      : err(comparisonFailure(input, attested.error));
  }
  if (target.format === "dos-mz") {
    if (client.attestDosTargetSnapshot === undefined)
      return err(
        comparisonFailure(
          input,
          "The Ghidra client does not expose its bounded DOS target snapshot comparison.",
        ),
      );
    const compared = await client.attestDosTargetSnapshot(observations, signal);
    return compared.ok ? compared : err(sourceFailure(compared.error));
  }
  if (client.readTargetSnapshot === undefined)
    return err(
      comparisonFailure(
        input,
        "The Ghidra client does not expose its immutable target snapshot for independent load-image verification.",
      ),
    );
  const snapshot = await client.readTargetSnapshot(undefined, signal);
  if (!snapshot.ok) return err(sourceFailure(snapshot.error));
  if (snapshot.value.kind !== "captured")
    return err(
      comparisonFailure(
        input,
        "The uncapped load-image snapshot was unexpectedly not captured.",
      ),
    );
  const attested = attestGhidraDosComLoadImage(
    snapshot.value.bytes,
    target.sha256,
    observations,
  );
  return attested.ok ? attested : err(comparisonFailure(input, attested.error));
};

import { lstat, type FileHandle } from "node:fs/promises";
import type { ModelArtifactPort } from "../application/model/ModelArtifactPort.js";
import {
  createModelArtifactEvidence,
  createModelArtifactPartialEvidence,
} from "../domain/model/modelArtifactEvidence.js";
import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import type {
  ModelArtifact,
  ModelArtifactPartial,
  ModelArtifactInput,
} from "../domain/model/modelArtifact.js";
import {
  modelArtifactPartialSchema,
  modelArtifactSchema,
} from "../domain/model/modelArtifact.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisArtifactChangedError,
  AnalysisAccessDeniedError,
  AnalysisCancelledError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import { BinaryTargetError } from "../domain/configurationErrors.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { err, ok, type Result } from "../domain/result.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  withArtifactRegularFile,
  bindArtifactFileCleanup,
  artifactFilePrimaryFacts,
  artifactFileCancellationCause,
  artifactFileCompletion,
} from "../artifacts/ArtifactFileOperation.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { ModelHeaderReader } from "./ModelHeaderReader.js";
import { GgufHeader } from "./GgufHeader.js";
import { readSafetensorsHeader } from "./SafetensorsHeader.js";
import {
  ModelFormatFailure,
  MODEL_REPORT_BYTES,
  modelCapacityRemediation,
  modelCapacityReportedLimits,
} from "./ModelFormat.js";
import { jsonValueByteLength } from "../domain/jsonValueByteLength.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import {
  isSelectedRegularFileError,
  sameRegularFileState,
} from "../filesystem/RegularFile.js";

export const MODEL_ARTIFACT_PROVIDER_IDENTITY = {
  id: "model-artifact",
  name: "REA model header reader",
  version: "1",
} as const;
const OPERATION = "inspect_model_artifact";
/** One admitted descriptor and bounded report at a time; retained cleanup blocks new work. */
export class ModelArtifactProvider implements ModelArtifactPort {
  readonly identity = MODEL_ARTIFACT_PROVIDER_IDENTITY;
  readonly #resources = new ArtifactResourceScope();
  #busy = false;

  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause) {
      const error = new ProviderCleanupError(
        this.identity.id,
        this.#resources.cleanupResources,
        {},
        { cause, operation: OPERATION },
      );
      bindArtifactFileCleanup(cause, error);
      throw error;
    }
  }

  async inspect(
    input: ModelArtifactInput,
    options?: ExecutionOptions,
  ): Promise<Result<ModelArtifact, AnalysisError>> {
    if (this.#busy)
      return err(
        new AnalysisResourceConstraintError(
          OPERATION,
          "capacity",
          "One model inspection is already active",
          { concurrent_inspections: 1 },
          { retryable: true },
        ),
      );
    this.#busy = true;
    let partialProgress: ModelArtifactPartial | undefined;
    try {
      return ok(
        await this.#resources.run(() =>
          withArtifactRegularFile(
            input.path,
            this.#resources,
            options?.signal,
            ({ handle: file }) =>
              this.#read(file, input, options?.signal, (progress) => {
                partialProgress = progress;
              }),
          ),
        ),
      );
    } catch (cause) {
      const { cause: primary, origin } = artifactFilePrimaryFacts(cause);
      let error: AnalysisError;
      if (origin === "owned-or-classified" && primary instanceof AnalysisError)
        error = primary;
      else if (primary instanceof ModelFormatFailure) {
        const limit = primary.kind === "capacity" ? primary.limit : undefined;
        error =
          limit !== undefined
            ? new AnalysisResourceConstraintError(
                OPERATION,
                "memory",
                primary.message,
                modelCapacityReportedLimits(limit),
                {
                  cause,
                  retryable: false,
                  remediationAction: modelCapacityRemediation(limit),
                },
              )
            : primary.kind === "unsupported"
              ? new AnalysisUnsupportedTargetError(
                  OPERATION,
                  input.path,
                  primary.message,
                  { cause },
                )
              : new BinaryTargetError(input.path, primary.message, {
                  cause,
                  constraint: "file_format_rejected",
                });
      } else if (
        origin === "owned-or-classified" &&
        primary instanceof ArtifactReaderFailure &&
        primary.reason === "cancelled"
      )
        error = new AnalysisCancelledError(OPERATION, {
          cause: artifactFileCancellationCause(primary),
        });
      else if (
        origin === "owned-or-classified" &&
        primary instanceof ArtifactReaderFailure &&
        primary.reason === "integrity"
      )
        error = new AnalysisArtifactChangedError(
          OPERATION,
          input.path,
          primary.message,
          { cause },
        );
      else if (
        primary instanceof Error &&
        "code" in primary &&
        (primary.code === "EACCES" || primary.code === "EPERM")
      )
        error = new AnalysisAccessDeniedError(
          OPERATION,
          input.path,
          primary.code,
          { cause: primary },
        );
      else if (
        origin === "owned-or-classified" &&
        primary instanceof ArtifactReaderFailure &&
        primary.reason === "limit"
      )
        error = new AnalysisResourceConstraintError(
          OPERATION,
          "memory",
          primary.message,
          {},
          { cause: primary },
        );
      else if (isSelectedRegularFileError(primary))
        error = new BinaryTargetError(input.path, primary.message, { cause });
      else
        error = new ProviderAdapterError(this.identity.id, OPERATION, {
          cause,
          diagnostics: {
            path: input.path,
            reason:
              primary instanceof Error ? primary.message : String(primary),
          },
        });
      if (
        cause instanceof ArtifactReaderFailure &&
        cause.cleanup !== undefined
      ) {
        const cleanup = new ProviderCleanupError(
          this.identity.id,
          cause.cleanup.resources,
          { reason: cause.cleanup.reason },
          { cause, operation: OPERATION },
        );
        error = analysisErrorWithCleanupFailure(error, cleanup, OPERATION);
      }
      const completed = artifactFileCompletion(cause);
      if (completed !== undefined) {
        // The descriptor owner retains observations even when its final close fails.
        const report = modelArtifactSchema.safeParse(completed.value);
        if (report.success)
          error.retainPartialObservation(
            createModelArtifactEvidence(report.data, this.identity, input),
          );
      }
      if (
        error.partialObservation === undefined &&
        partialProgress !== undefined &&
        (partialProgress.coverage.header === "complete" ||
          partialProgress.metadata.length > 0 ||
          partialProgress.tensor_declarations.length > 0 ||
          partialProgress.tensors.length > 0)
      ) {
        const parsed = modelArtifactPartialSchema.safeParse(partialProgress);
        if (parsed.success)
          error.retainPartialObservation(
            createModelArtifactPartialEvidence(
              parsed.data,
              this.identity,
              input,
            ),
          );
      }
      bindArtifactFileCleanup(cause, error);
      return err(error);
    } finally {
      this.#busy = false;
    }
  }

  async #read(
    file: FileHandle,
    input: ModelArtifactInput,
    signal?: AbortSignal,
    retainProgress?: (progress: ModelArtifactPartial) => void,
  ): Promise<ModelArtifact> {
    const initial = await file.stat({ bigint: true });
    if (initial.size > BigInt(Number.MAX_SAFE_INTEGER))
      throw new ModelFormatFailure(
        "capacity",
        "Model file exceeds exact host offset precision",
        "exact-offset",
      );
    const reader = new ModelHeaderReader(file, Number(initial.size), signal);
    const first = await reader.take(4);
    const format = first.equals(Buffer.from("GGUF")) ? "gguf" : "safetensors";
    const partial: ModelArtifactPartial = {
      kind: "model-artifact-partial",
      artifact: {
        path: input.path,
        observed_file_size: Number(initial.size),
        header_sha256: null,
        sha256: null,
        file_identity: "unverified",
      },
      format,
      version: null,
      byte_order: null,
      alignment: null,
      declared_metadata_count: null,
      declared_tensor_count: null,
      metadata: [],
      tensor_declarations: [],
      tensors: [],
      coverage: {
        header: "partial",
        metadata: "not-started",
        tensors: "not-started",
      },
      limitations: [
        "This partial observation contains only rows fully parsed before the interrupted read.",
        "Header and full-file digests and final file identity are unknown because finalization did not complete.",
        "No model behavior or tensor payload values were interpreted.",
      ],
    };
    retainProgress?.(partial);
    const parsed =
      format === "gguf"
        ? await new GgufHeader(reader).read({
            onHeader: (info) => {
              partial.version = info.version;
              partial.byte_order = info.byte_order;
              partial.declared_metadata_count = info.declared_metadata_count;
              partial.declared_tensor_count = info.declared_tensor_count;
              partial.coverage.metadata = "partial";
            },
            onMetadata: (row) => partial.metadata.push(row),
            onAlignment: (alignment) => {
              partial.alignment = alignment;
            },
            onMetadataComplete: () => {
              partial.coverage.metadata = "complete";
            },
            onTensorsStarted: () => {
              partial.coverage.tensors = "partial";
            },
            onTensorDeclaration: (row) => partial.tensor_declarations.push(row),
            onLimitation: (message) => partial.limitations.push(message),
          })
        : await readSafetensorsHeader(reader, first);
    partial.version = parsed.version;
    partial.byte_order = parsed.byte_order;
    partial.alignment = parsed.alignment;
    partial.metadata = parsed.metadata;
    partial.declared_metadata_count = parsed.metadata.length;
    partial.declared_tensor_count = parsed.tensors.length;
    partial.tensor_declarations = [];
    partial.tensors = parsed.tensors;
    partial.limitations = [
      ...new Set([...partial.limitations, ...parsed.limitations]),
    ];
    partial.coverage = {
      header: "complete",
      metadata: "complete",
      tensors: "complete",
    };
    const header_length = reader.position;
    const hashes = await reader.finish(input.hash === "full");
    const after = await file.stat({ bigint: true });
    const named = await lstat(input.path, { bigint: true }).catch(
      (cause: unknown) => {
        if (
          cause instanceof Error &&
          "code" in cause &&
          ["ENOENT", "ENOTDIR", "ELOOP"].includes(String(cause.code))
        )
          throw new ArtifactReaderFailure(
            "integrity",
            "Selected model path changed during inspection",
            { cause },
          );
        throw cause;
      },
    );
    if ([after, named].some((stat) => !sameRegularFileState(initial, stat)))
      throw new ArtifactReaderFailure(
        "integrity",
        "Model file changed during inspection",
      );
    const groups = new Map<
      string,
      {
        type: string;
        tensors: number;
        parameter_count: bigint;
        bytes: number | null;
      }
    >();
    let parameters = 0n;
    let bytes: number | null = 0;
    for (const row of parsed.tensors) {
      const count = BigInt(row.parameter_count);
      parameters += count;
      bytes =
        bytes === null || row.byte_length === null
          ? null
          : bytes + row.byte_length;
      const group = groups.get(row.type) ?? {
        type: row.type,
        tensors: 0,
        parameter_count: 0n,
        bytes: 0,
      };
      group.tensors++;
      group.parameter_count += count;
      group.bytes =
        group.bytes === null || row.byte_length === null
          ? null
          : group.bytes + row.byte_length;
      groups.set(row.type, group);
    }
    const report = {
      artifact: {
        path: input.path,
        file_size: Number(initial.size),
        header_length,
        ...hashes,
        read_scope:
          input.hash === "full" ? ("full-file" as const) : ("header" as const),
      },
      format,
      ...parsed,
      totals: {
        confidence: "derived" as const,
        parameter_count: parameters.toString(),
        tensor_bytes: bytes,
        by_type: [...groups.values()].map((group) => ({
          ...group,
          parameter_count: group.parameter_count.toString(),
        })),
      },
      coverage: {
        header: "complete" as const,
        tensor_data: "not-interpreted" as const,
        array_values: parsed.metadata.every((row) => row.preview_complete)
          ? ("complete" as const)
          : ("preview" as const),
        storage_sizes: parsed.tensors.every(
          (row) => row.storage_validation === "consistent",
        )
          ? ("complete" as const)
          : ("partial" as const),
        tensor_ranges: parsed.tensors.every((row) => row.byte_length !== null)
          ? ("complete" as const)
          : ("partial" as const),
      },
      limitations: [
        "Facts are file declarations; model behavior, weight values and compatibility with an inference runtime were not verified.",
        "Header SHA-256 commits only to the recorded prefix; file size is a separate observation. Different weights may share these declarations.",
        ...(input.hash === "header"
          ? ["Full-file SHA-256 is unknown because tensor data was not read."]
          : [
              "Full-file SHA-256 required streaming the entire file, including tensor data, without interpreting it.",
            ]),
        ...(parsed.metadata.some((row) => !row.preview_complete)
          ? [
              "Metadata arrays retain at most eight elements per array; remaining values are omitted, with exact declared counts and source byte ranges.",
            ]
          : []),
        ...parsed.limitations,
      ],
    };
    if (jsonValueByteLength(report, MODEL_REPORT_BYTES) > MODEL_REPORT_BYTES)
      throw new ModelFormatFailure(
        "capacity",
        "Model report exceeds 32 MiB",
        "report-bytes",
      );
    return modelArtifactSchema.parse(report);
  }
}

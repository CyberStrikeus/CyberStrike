import { lstat, type FileHandle } from "node:fs/promises";
import type { GpuCodeObjectsPort } from "../application/gpu/GpuCodeObjectsPort.js";
import {
  createGpuCodeObjectsEvidence,
  createGpuCodeObjectsPartialEvidence,
} from "../domain/gpu/gpuCodeObjectsEvidence.js";
import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import type {
  GpuCodeObjects,
  GpuCodeObjectsInput,
} from "../domain/gpu/gpuCodeObjects.js";
import {
  gpuCodeObjectsSchema,
  gpuCodeObjectsPartialSchema,
} from "../domain/gpu/gpuCodeObjects.js";
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
import {
  BinaryFormatFailure,
  BinaryResourceFailure,
} from "../native/metadata/BinaryContainer.js";
import {
  GpuFileSource,
  gpuCount,
  GPU_OBJECT_BYTES,
  GPU_REPORT_BYTES,
} from "./GpuSource.js";
import { GpuInventory } from "./GpuInventory.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import {
  isSelectedRegularFileError,
  sameRegularFileState,
} from "../filesystem/RegularFile.js";

export const GPU_CODE_OBJECTS_PROVIDER_IDENTITY = {
  id: "gpu-code-objects",
  name: "REA static GPU code-object reader",
  version: "1",
} as const;
const OPERATION = "inspect_gpu_code_objects";

/** One admitted descriptor and bounded report at a time; retained cleanup blocks new work. */
export class GpuCodeObjectsProvider implements GpuCodeObjectsPort {
  readonly identity = GPU_CODE_OBJECTS_PROVIDER_IDENTITY;
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
    input: GpuCodeObjectsInput,
    options?: ExecutionOptions,
  ): Promise<Result<GpuCodeObjects, AnalysisError>> {
    if (this.#busy)
      return err(
        new AnalysisResourceConstraintError(
          OPERATION,
          "capacity",
          "One GPU inspection is already active",
          { concurrent_inspections: 1 },
          { retryable: true },
        ),
      );
    this.#busy = true;
    let progress: { inventory: GpuInventory; size: number } | undefined;
    try {
      return ok(
        await this.#resources.run(() =>
          withArtifactRegularFile(
            input.path,
            this.#resources,
            options?.signal,
            ({ handle: file }) =>
              this.#read(file, input, options?.signal, (value) => {
                progress = value;
              }),
          ),
        ),
      );
    } catch (cause) {
      const { cause: primary, origin } = artifactFilePrimaryFacts(cause);
      let error: AnalysisError;
      if (origin === "owned-or-classified" && primary instanceof AnalysisError)
        error = primary;
      else if (primary instanceof BinaryResourceFailure)
        error = new AnalysisResourceConstraintError(
          OPERATION,
          "memory",
          primary.message,
          {
            maximum_object_bytes: GPU_OBJECT_BYTES,
            maximum_report_bytes: GPU_REPORT_BYTES,
          },
          {
            cause,
            retryable: false,
            remediationAction: `${primary.message} This release has no runtime override for that GPU byte allowance. The object allowance is ${String(GPU_OBJECT_BYTES)} bytes and the report allowance is ${String(GPU_REPORT_BYTES)} bytes. Additional host memory does not raise them. Repeating the unchanged request fails the same way.`,
          },
        );
      else if (primary instanceof BinaryFormatFailure) {
        error =
          primary.kind === "unsupported"
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
      else if (isSelectedRegularFileError(primary))
        error = new BinaryTargetError(input.path, primary.message, { cause });
      else if (
        origin === "owned-or-classified" &&
        primary instanceof ArtifactReaderFailure &&
        primary.reason === "limit"
      )
        error = new AnalysisResourceConstraintError(
          OPERATION,
          "memory",
          primary.message,
          { maximum_object_bytes: GPU_OBJECT_BYTES },
          {
            cause: primary,
            retryable: false,
            remediationAction: `${primary.message} The GPU object allowance is ${String(GPU_OBJECT_BYTES)} bytes. This release has no runtime override. Additional host memory does not raise it. Repeating the unchanged request fails the same way.`,
          },
        );
      // Other coded I/O failures remain host failures (for example, EMFILE).
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
        const report = gpuCodeObjectsSchema.safeParse(completed.value);
        if (report.success)
          error.retainPartialObservation(
            createGpuCodeObjectsEvidence(report.data, this.identity, input),
          );
      }
      if (
        error.partialObservation === undefined &&
        progress !== undefined &&
        progress.inventory.objects.length > 0
      ) {
        const partial = gpuCodeObjectsPartialSchema.parse({
          kind: "gpu-code-objects-partial",
          artifact: {
            path: input.path,
            observed_file_size: progress.size,
            sha256: null,
            file_identity: "unverified",
          },
          analysis: input.analysis,
          objects: progress.inventory.objects,
          kernels: progress.inventory.kernels,
          ptx_artifacts: progress.inventory.ptx_artifacts,
          coverage: { discovery: "partial", payloads: "partial" },
          limitations: [
            ...progress.inventory.limitations,
            "Only completed declarations observed before interruption are retained. Root file identity and completeness were not verified; positional IDs are scoped to this interrupted observation.",
          ],
        });
        error.retainPartialObservation(
          createGpuCodeObjectsPartialEvidence(partial, this.identity, input),
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
    input: GpuCodeObjectsInput,
    signal?: AbortSignal,
    retainProgress?: (progress: {
      inventory: GpuInventory;
      size: number;
    }) => void,
  ): Promise<GpuCodeObjects> {
    const initial = await file.stat({ bigint: true });
    const size = gpuCount(initial.size);
    const source = new GpuFileSource(file, size, signal);
    const sha256 = await source.digest();
    if (input.expected_sha256 !== undefined && sha256 !== input.expected_sha256)
      throw new AnalysisArtifactChangedError(
        OPERATION,
        input.path,
        "GPU source does not match the inventory's selected SHA-256",
      );
    const inventory = new GpuInventory(input, signal);
    retainProgress?.({ inventory, size });
    const format = await inventory.inspect(source);
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
            "Selected GPU path changed during inspection",
            { cause },
          );
        throw cause;
      },
    );
    if ([after, named].some((state) => !sameRegularFileState(initial, state)))
      throw new ArtifactReaderFailure(
        "integrity",
        "GPU source changed during inspection",
      );
    const leaves = inventory.objects.filter(
      (row) =>
        row.kind !== "cuda-fatbin" &&
        row.kind !== "hip-bundle" &&
        row.kind !== "native-section" &&
        row.kind !== "host",
    );
    return gpuCodeObjectsSchema.parse({
      artifact: {
        path: input.path,
        file_size: size,
        sha256,
        bytes_read: source.bytesRead,
      },
      format,
      analysis: input.analysis,
      objects: inventory.objects,
      kernels: inventory.kernels,
      ptx_artifacts: inventory.ptx_artifacts,
      coverage: {
        discovery_scope: "supported-section-names-and-standalone-formats",
        discovery: inventory.discovery,
        payloads:
          input.analysis === "inventory"
            ? "not-requested"
            : leaves.every((row) => row.inspection === "complete") &&
                inventory.discovery === "complete"
              ? "complete"
              : "partial",
        examined_sections: inventory.examined_sections,
        unknown_section_names: inventory.unknown_section_names,
      },
      limitations: [
        ...inventory.limitations,
        "Full-file SHA-256 streams every file byte; section and selected payload reads add to artifact.bytes_read. Retained Evidence is historical and never reopens the target.",
      ],
    });
  }
}

import {
  createAnalysisExecution,
  type AnalysisClient,
  type AnalysisOperation,
  type AnalysisProvider,
  type CapabilityDescriptor,
  type ExecutionOptions,
  type ProviderIdentity,
} from "../application/AnalysisProvider.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { managedStaticCapabilities } from "./ManagedStaticProviderMetadata.js";
import { MANAGED_STATIC_PROVIDER } from "../domain/investigationProviders.js";
import {
  MANAGED_TOOL_CONTRACTS,
  managedMembersInputSchema,
  managedTargetInputSchema,
  type ManagedToolName,
} from "../contracts/managed/managedToolContracts.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type { EvidenceLocation } from "../domain/evidence.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type {
  ManagedArtifactInspection,
  ManagedMemberInspection,
  ManagedNativeBoundaryInspection,
} from "../domain/managed/managedArtifact.js";
import { err, ok, type Result } from "../domain/result.js";
import { inspectManagedArtifactBytes } from "./ManagedArtifactInspector.js";
import { inspectManagedMembersBytes } from "./ManagedMemberInspector.js";
import { inspectManagedNativeBoundariesBytes } from "./ManagedNativeBoundaryInspector.js";
import { RegularFileCleanupFailure } from "../filesystem/OwnedRegularFile.js";
import { managedInspectionInputFailure } from "./ManagedReaderFailure.js";
import {
  hashManagedSource,
  managedCleanupError,
  readManagedSnapshot,
  verifyManagedSourceIdentity,
} from "./ManagedSnapshot.js";

/** Execution-free managed PE/CLI auxiliary provider. */
export class ManagedStaticProvider implements AnalysisProvider {
  readonly #capabilities: readonly CapabilityDescriptor[] =
    managedStaticCapabilities();

  identity(): ProviderIdentity {
    return MANAGED_STATIC_PROVIDER;
  }

  capabilities(): readonly CapabilityDescriptor[] {
    return this.#capabilities;
  }

  createClient(target: BinaryTarget): AnalysisClient {
    return new ManagedStaticClient(target);
  }
}

class ManagedStaticClient implements AnalysisClient {
  #snapshotBytes: Buffer | undefined;
  readonly #resources = new ArtifactResourceScope();

  constructor(private readonly target: BinaryTarget) {}

  async execute(
    operation: AnalysisOperation,
    parameters: Readonly<Record<string, JsonValue>>,
    options?: ExecutionOptions,
  ) {
    if (operation === "health")
      return ok(createAnalysisExecution(null, MANAGED_STATIC_PROVIDER));
    if (!isManagedOperation(operation))
      return err(
        new AnalysisCapabilityUnavailableError(
          MANAGED_STATIC_PROVIDER.id,
          operation,
          "Operation is not implemented by the managed static provider.",
        ),
      );
    // A non-PE target is outside this operation's formats, not a missing
    // provider capability; the unimplemented-operation refusal above is.
    if (this.target.format !== "pe")
      return err(
        new AnalysisUnsupportedTargetError(
          operation,
          this.target.path,
          `Managed static triage requires a PE target; observed ${this.target.format}.`,
        ),
      );
    try {
      if (options?.signal?.aborted === true)
        return err(
          new AnalysisCancelledError(operation, {
            cause: options.signal.reason,
          }),
        );
      const snapshot = this.#snapshotBytes;
      const observed =
        snapshot === undefined
          ? await readManagedSnapshot(this.target.path, operation, {
              expectedSha256: this.target.sha256,
              signal: options?.signal,
              resources: this.#resources,
            })
          : await hashManagedSource(this.target.path, operation, {
              expectedSha256: this.target.sha256,
              signal: options?.signal,
              resources: this.#resources,
            });
      const admitted = verifyManagedSourceIdentity(
        this.target,
        observed,
        operation,
      );
      if (!admitted.ok) return admitted;
      const bytes = snapshot ?? observed.bytes;
      if (bytes === undefined)
        throw new TypeError("Managed snapshot bytes are unavailable");
      this.#snapshotBytes = bytes;
      const result = inspectManagedOperation(
        operation,
        parameters,
        bytes,
        this.target,
      );
      return ok(
        createAnalysisExecution(result, MANAGED_STATIC_PROVIDER, {
          rawResult: null,
          limitations: result.limitations,
          subject: this.target,
          locations: managedLocations(result),
        }),
      );
    } catch (cause: unknown) {
      if (isCleanupFailure(cause))
        return err(this.#cleanupError(operation, cause));
      if (cause instanceof AnalysisError) return err(cause);
      if (options?.signal?.aborted === true)
        return err(
          new AnalysisCancelledError(operation, {
            cause: options.signal.reason,
          }),
        );
      const inputFailure = managedInspectionInputFailure(
        operation,
        this.target.path,
        cause,
      );
      if (inputFailure !== undefined) return err(inputFailure);
      return err(
        new ProviderAdapterError(MANAGED_STATIC_PROVIDER.id, operation, {
          cause,
        }),
      );
    }
  }

  async close(): Promise<Result<null, AnalysisError>> {
    this.#snapshotBytes = undefined;
    try {
      await this.#resources.close();
      return ok(null);
    } catch (cause: unknown) {
      return err(this.#cleanupError("close", cause));
    }
  }

  #cleanupError(operation: string, cause: unknown): ProviderCleanupError {
    const failure = managedCleanupError(cause, this.target.path, operation);
    if (failure instanceof ProviderCleanupError) return failure;
    const cleanup =
      cause instanceof ArtifactReaderFailure ? cause.cleanup : undefined;
    return new ProviderCleanupError(
      MANAGED_STATIC_PROVIDER.id,
      cleanup?.resources ?? [this.target.path],
      {
        reason:
          cleanup?.reason ??
          (cause instanceof Error ? cause.message : String(cause)),
      },
      { cause, operation },
    );
  }
}

const isCleanupFailure = (cause: unknown): boolean =>
  cause instanceof RegularFileCleanupFailure ||
  (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined);

const isManagedOperation = (
  operation: AnalysisOperation,
): operation is ManagedToolName =>
  MANAGED_TOOL_CONTRACTS.some(({ name }) => name === operation);

const inspectManagedOperation = (
  operation: ManagedToolName,
  parameters: Readonly<Record<string, JsonValue>>,
  bytes: Buffer,
  target: BinaryTarget,
):
  | ManagedArtifactInspection
  | ManagedMemberInspection
  | ManagedNativeBoundaryInspection => {
  if (operation === "inspect_managed_members") {
    const { type_names: typeNames } =
      managedMembersInputSchema.parse(parameters);
    return inspectManagedMembersBytes(
      bytes,
      target,
      typeNames === undefined ? {} : { typeNames },
    );
  }
  managedTargetInputSchema.parse(parameters);
  if (operation === "inspect_managed_artifact") {
    return inspectManagedArtifactBytes(bytes, target);
  }
  return inspectManagedNativeBoundariesBytes(bytes, target);
};

const managedLocations = (
  result:
    | ManagedArtifactInspection
    | ManagedMemberInspection
    | ManagedNativeBoundaryInspection,
): readonly EvidenceLocation[] => {
  if ("pe" in result) {
    if (result.pe.cli === null) return [{ kind: "file-offset", offset: 0 }];
    return [
      {
        kind: "file-offset-range",
        start: result.pe.cli.header_offset,
        end: result.pe.cli.header_offset + result.pe.cli.header_size,
      },
      ...[result.module, result.assembly]
        .filter((value) => value !== null)
        .map((value) => ({
          kind: "file-offset" as const,
          offset: value.row_offset,
        })),
    ];
  }
  if ("methods" in result)
    return [
      ...(result.module === null
        ? [{ kind: "file-offset" as const, offset: 0 }]
        : [{ kind: "file-offset" as const, offset: result.module.row_offset }]),
      ...result.methods
        .filter((method) => method.body.file_offset !== null)
        .map((method) => ({
          kind: "file-offset" as const,
          offset: method.body.file_offset ?? 0,
        })),
    ];
  return [
    ...(result.module === null
      ? [{ kind: "file-offset" as const, offset: 0 }]
      : [{ kind: "file-offset" as const, offset: result.module.row_offset }]),
    ...result.pinvoke_imports.map((mapping) => ({
      kind: "file-offset" as const,
      offset: mapping.row_offset,
    })),
  ];
};

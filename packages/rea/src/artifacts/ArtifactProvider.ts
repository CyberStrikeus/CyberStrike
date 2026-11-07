import type { EspFlashSelection } from "../domain/firmware/espFlashLocation.js";
import type { AnalysisSettingsReader } from "../domain/analysisSettings.js";
import { runtimeAsarHeaderAdmission } from "../config/runtimeAnalysisSettings.js";
import { artifactTargetRefusal } from "../domain/apple/artifactTargetApplicability.js";
import { bindArtifactFileCleanup } from "./ArtifactFileOperation.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { translateArtifactFailure } from "./ArtifactOperationFailure.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import {
  createAnalysisExecution,
  type AnalysisClient,
  type AnalysisOperation,
  type AnalysisProvider,
  type CapabilityDescriptor,
  type ProviderIdentity,
  type ExecutionOptions,
} from "../application/AnalysisProvider.js";
import {
  inspectBundleKeyedArchive,
  inspectStandaloneKeyedArchive,
} from "./apple/KeyedArchiveReader.js";
import { traceDylibResolution } from "./apple/DylibResolutionReader.js";
import { dirname } from "node:path";
import { withArtifactTargetIdentity } from "./withArtifactTargetIdentity.js";
import { inventoryArtifact } from "./inventory/ArtifactInventory.js";
import { extractArtifact } from "./extraction/ArtifactExtraction.js";
import { analyzeInterfaceBuilderBundle } from "./apple/InterfaceBuilderAnalysis.js";
import { analyzeAppleAssetCatalogs } from "./apple/AppleAssetCatalogAnalysis.js";
import {
  ARTIFACT_ANALYSIS_OPERATIONS,
  artifactInventoryInputSchema,
  artifactExtractionExecutionSchema,
  type ArtifactAnalysisOperation,
} from "../contracts/artifactToolContracts.js";
import {
  artifactTargetSelectedPath,
  type BinaryTarget,
} from "../domain/binaryTargetTypes.js";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { interfaceBuilderLimitsSchema } from "../domain/apple/interfaceBuilderGraph.js";
import { err, ok, type Result } from "../domain/result.js";
import { ArtifactReaderFailure } from "./ArtifactReader.js";
import { ArtifactResourceScope } from "./ArtifactResourceScope.js";
import { artifactCapabilities } from "./ArtifactProviderMetadata.js";
import { ARTIFACT_GRAPH_PROVIDER } from "../domain/investigationProviders.js";
import { createEvidence } from "../domain/evidence.js";
import { freezeJsonSnapshot } from "../domain/immutableJson.js";
import {
  artifactInspectionSources,
  createArtifactInspection,
} from "../domain/artifactInspection.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type { ResolvedAppBundleResourceRoot } from "../application/AppBundleExecutable.js";
import type { BundleResourceRoot } from "../domain/apple/bundleResourceRoot.js";
import { BUNDLE_ARTIFACT_RESOURCE_OPERATIONS } from "../application/binary/BundleResourceSession.js";

/** Read-only inventory and exclusively owned extraction provider. */
export class ArtifactProvider implements AnalysisProvider {
  readonly #capabilities: readonly CapabilityDescriptor[];
  readonly #platform: NodeJS.Platform;
  private readonly environment: Readonly<NodeJS.ProcessEnv>;

  constructor(
    environment: Readonly<NodeJS.ProcessEnv>,
    platform: NodeJS.Platform = process.platform,
    private readonly settings?: AnalysisSettingsReader,
  ) {
    this.environment = snapshotEnvironment(environment, platform);
    this.#capabilities = artifactCapabilities(platform);
    this.#platform = platform;
  }

  identity(): ProviderIdentity {
    return ARTIFACT_GRAPH_PROVIDER;
  }

  capabilities(): readonly CapabilityDescriptor[] {
    return this.#capabilities;
  }

  createClient(target: BinaryTarget): AnalysisClient {
    return new ArtifactClient(
      target,
      this.environment,
      this.#platform,
      this.settings,
    );
  }

  createBundleResourceClient(
    root: ResolvedAppBundleResourceRoot,
  ): AnalysisClient {
    return new BundleResourceArtifactClient(
      root,
      this.environment,
      this.#platform,
    );
  }
}

const serializedResourceRoot = (
  root: ResolvedAppBundleResourceRoot,
): BundleResourceRoot => ({
  caller_path: root.callerPath,
  canonical_path: root.canonicalPath,
  info_plist_path: root.infoPlistPath,
  layout: root.layout,
  executable_sha256: root.executableSha256,
});

class BundleResourceArtifactClient implements AnalysisClient {
  readonly #resourceScope = new ArtifactResourceScope();

  constructor(
    private readonly root: ResolvedAppBundleResourceRoot,
    private readonly environment: Readonly<NodeJS.ProcessEnv>,
    private readonly platform: NodeJS.Platform,
  ) {}

  async execute(
    operation: AnalysisOperation,
    parameters: Readonly<Record<string, JsonValue>>,
    options?: ExecutionOptions,
  ) {
    if (operation === "health")
      return ok(createAnalysisExecution(null, ARTIFACT_GRAPH_PROVIDER));
    if (!BUNDLE_ARTIFACT_RESOURCE_OPERATIONS.has(operation))
      return err(
        new AnalysisCapabilityUnavailableError(
          ARTIFACT_GRAPH_PROVIDER.id,
          operation,
          "The app resource reader supports only plist, Interface Builder, asset catalog, and keyed archive inspection.",
        ),
      );
    try {
      const resourceRoot = serializedResourceRoot(this.root);
      const result =
        operation === "decode_interface_builder"
          ? await analyzeInterfaceBuilderBundle({
              bundlePath: this.root.canonicalPath,
              targetSha256: null,
              resourceRoot,
              resources: this.#resourceScope,
              limits: interfaceBuilderLimitsSchema.parse(parameters),
              ...(options?.signal === undefined
                ? {}
                : { signal: options.signal }),
            })
          : operation === "inspect_keyed_archive"
            ? await inspectBundleKeyedArchive({
                bundlePath: this.root.canonicalPath,
                targetSha256: null,
                resourceRoot,
                parameters,
                platform: this.platform,
                resources: this.#resourceScope,
                ...(options?.signal === undefined
                  ? {}
                  : { signal: options.signal }),
              })
            : operation === "inspect_asset_catalog"
              ? await analyzeAppleAssetCatalogs({
                  bundlePath: this.root.canonicalPath,
                  targetSha256: null,
                  resourceRoot,
                  environment: this.environment,
                  resources: this.#resourceScope,
                  page: parameters,
                  ...(options?.signal === undefined
                    ? {}
                    : { signal: options.signal }),
                })
              : (() => {
                  throw new AnalysisCapabilityUnavailableError(
                    ARTIFACT_GRAPH_PROVIDER.id,
                    operation,
                    "Property list inspection requires a platform-native reader.",
                  );
                })();
      return ok(
        createAnalysisExecution(result, ARTIFACT_GRAPH_PROVIDER, {
          limitations: "limitations" in result ? result.limitations : [],
        }),
      );
    } catch (cause: unknown) {
      return err(
        translateArtifactFailure(operation as ArtifactAnalysisOperation, cause),
      );
    }
  }

  close(): Promise<Result<null, AnalysisError>> {
    return this.#resourceScope.close().then(
      () => ok(null),
      (cause: unknown) =>
        err(
          new ProviderCleanupError(
            ARTIFACT_GRAPH_PROVIDER.id,
            ["app bundle resource reader"],
            { reason: cause instanceof Error ? cause.message : String(cause) },
            { cause, operation: "close_binary" },
          ),
        ),
    );
  }
}

class ArtifactClient implements AnalysisClient {
  readonly #resourceScope = new ArtifactResourceScope();

  constructor(
    private readonly target: BinaryTarget,
    private readonly environment: Readonly<NodeJS.ProcessEnv>,
    private readonly platform: NodeJS.Platform,
    private readonly settings?: AnalysisSettingsReader,
  ) {}

  async execute(
    operation: AnalysisOperation,
    parameters: Readonly<Record<string, JsonValue>>,
    options?: ExecutionOptions,
  ) {
    if (operation === "health")
      return ok(createAnalysisExecution(null, ARTIFACT_GRAPH_PROVIDER));
    if (!isArtifactOperation(operation))
      return err(
        new AnalysisCapabilityUnavailableError(
          ARTIFACT_GRAPH_PROVIDER.id,
          operation,
          "Operation is not implemented by artifact graph provider.",
        ),
      );
    try {
      const targetRefusal = artifactTargetRefusal(operation, this.target);
      if (targetRefusal !== undefined)
        throw this.unsupportedTarget(operation, targetRefusal.reason);
      if (operation === "inspect_artifact") {
        const inspected = await this.inspectArtifact(parameters, options);
        return inspected;
      }
      if (operation === "decode_interface_builder") {
        const limits = interfaceBuilderLimitsSchema.parse(parameters);
        const result = await withArtifactTargetIdentity(
          this.target,
          this.#resourceScope,
          () =>
            analyzeInterfaceBuilderBundle({
              bundlePath: this.target.sourcePath ?? this.target.path,
              targetSha256: this.target.sha256,
              limits,
              resources: this.#resourceScope,
              ...(options?.signal === undefined
                ? {}
                : { signal: options.signal }),
            }),
          options?.signal,
        );
        return ok(
          createAnalysisExecution(result, ARTIFACT_GRAPH_PROVIDER, {
            limitations: result.limitations,
            locations: result.documents.map(({ relative_path: path }) => ({
              kind: "artifact-path" as const,
              path,
            })),
          }),
        );
      }
      if (operation === "inspect_keyed_archive") {
        const standalone =
          this.target.kind === "artifact" && this.target.format === "plist";
        const selectedPath = artifactTargetSelectedPath(this.target);
        const result = standalone
          ? await inspectStandaloneKeyedArchive({
              path: this.target.path,
              selectedPath,
              targetSha256: this.target.sha256,
              parameters,
              platform: this.platform,
              resources: this.#resourceScope,
              ...(options?.signal === undefined
                ? {}
                : { signal: options.signal }),
            })
          : await withArtifactTargetIdentity(
              this.target,
              this.#resourceScope,
              () =>
                inspectBundleKeyedArchive({
                  bundlePath: this.target.sourcePath ?? this.target.path,
                  targetSha256: this.target.sha256,
                  parameters,
                  platform: this.platform,
                  resources: this.#resourceScope,
                  ...(options?.signal === undefined
                    ? {}
                    : { signal: options.signal }),
                }),
              options?.signal,
            );
        return ok(
          createAnalysisExecution(result, ARTIFACT_GRAPH_PROVIDER, {
            limitations: result.limitations,
            locations: [{ kind: "artifact-path", path: result.archive_path }],
            ...(standalone
              ? {
                  subject: {
                    path: selectedPath,
                    sha256: result.archive_sha256,
                    format: "plist" as const,
                  },
                }
              : {}),
          }),
        );
      }
      if (operation === "inspect_asset_catalog") {
        return await this.inspectAssetCatalog(parameters, options);
      }
      if (operation === "trace_dylib_resolution")
        return await this.traceDylibResolution(parameters, options);
      if (operation === "extract_artifact") {
        const parsed = artifactExtractionExecutionSchema.parse(parameters);
        const result = await extractArtifact(
          {
            inputPath: this.target.sourcePath ?? this.target.path,
            expectedRootSha256:
              this.target.bundleInfoPlist === undefined
                ? this.target.sha256
                : undefined,
            selectedPath: this.target.artifactSelectedPath,
            inputFormat: this.target.format,
            espFlashSelection: espFlashSelection(this.target),
            outputRoot: parsed.output_root,
            environment: this.environment,
            asarHeaderAdmission: runtimeAsarHeaderAdmission(
              this.environment,
              this.settings,
            ),
            integrityPolicy: parsed.integrity_policy,
            resourceScope: this.#resourceScope,
          },
          options?.signal,
        );
        return ok(
          createAnalysisExecution(result, ARTIFACT_GRAPH_PROVIDER, {
            rawResult: null,
            limitations: result.limitations,
            subject: subjectFor(
              artifactTargetSelectedPath(this.target),
              result.manifest,
            ),
            // Each extracted file's path is already in artifacts.
            locations: [],
          }),
        );
      }
      const parsed = artifactInventoryInputSchema.parse(parameters);
      const result = await this.inventory(parsed, options);
      return ok(
        createAnalysisExecution(result, ARTIFACT_GRAPH_PROVIDER, {
          rawResult: null,
          limitations: result.limitations,
          subject: subjectFor(
            artifactTargetSelectedPath(this.target),
            result.manifest,
          ),
          // Each occurrence's logical path is already in the result.
          locations: [],
        }),
      );
    } catch (cause: unknown) {
      return err(
        translateArtifactFailure(operation as ArtifactAnalysisOperation, cause),
      );
    }
  }

  close(): Promise<Result<null, AnalysisError>> {
    return this.#resourceScope.close().then(
      () => ok(null),
      (cause: unknown) => {
        const failure =
          cause instanceof ArtifactReaderFailure ? cause : undefined;
        const error = new ProviderCleanupError(
          ARTIFACT_GRAPH_PROVIDER.id,
          failure?.cleanup?.resources ?? ["artifact resources"],
          {
            reason:
              failure?.cleanup?.reason ??
              (cause instanceof Error ? cause.message : String(cause)),
          },
          { cause, operation: "close_binary" },
        );
        bindArtifactFileCleanup(cause, error);
        return err(error);
      },
    );
  }

  /** The active target's kind is outside this operation's supported targets. */
  private unsupportedTarget(
    operation: string,
    reason: string,
  ): AnalysisUnsupportedTargetError {
    return new AnalysisUnsupportedTargetError(
      operation,
      this.target.sourcePath ?? this.target.path,
      reason,
    );
  }

  private async inspectAssetCatalog(
    parameters: Readonly<Record<string, JsonValue>>,
    options?: ExecutionOptions,
  ) {
    const bundlePath = this.target.sourcePath ?? this.target.path;
    const result = await withArtifactTargetIdentity(
      this.target,
      this.#resourceScope,
      () =>
        analyzeAppleAssetCatalogs({
          environment: this.environment,
          bundlePath,
          resources: this.#resourceScope,
          targetSha256: this.target.sha256,
          page: parameters,
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
        }),
      options?.signal,
    );
    return ok(
      createAnalysisExecution(result, ARTIFACT_GRAPH_PROVIDER, {
        limitations: result.limitations,
        locations: result.catalogs.map(({ path }) => ({
          kind: "artifact-path" as const,
          path,
        })),
      }),
    );
  }

  private async traceDylibResolution(
    parameters: Readonly<Record<string, JsonValue>>,
    options?: ExecutionOptions,
  ) {
    // Only a target opened from an app bundle directory carries its Info.plist;
    // a regular file whose name ends in .app is a standalone image.
    const bundle =
      this.target.bundleInfoPlist === undefined
        ? undefined
        : this.target.sourcePath;
    const result = await traceDylibResolution({
      rootPath: bundle ?? dirname(this.target.path),
      targetPath: this.target.path,
      targetSha256: this.target.sha256,
      enumerateRoots: bundle !== undefined,
      parameters,
      resourceScope: this.#resourceScope,
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
    return ok(
      createAnalysisExecution(result, ARTIFACT_GRAPH_PROVIDER, {
        limitations: result.limitations,
        locations: result.images.map(({ path }) => ({
          kind: "artifact-path" as const,
          path,
        })),
      }),
    );
  }

  private async inspectArtifact(
    parameters: Readonly<Record<string, JsonValue>>,
    options?: ExecutionOptions,
  ) {
    const parsed = artifactInventoryInputSchema.parse(parameters);
    const inventoryParameters = {
      integrity_policy: parsed.integrity_policy,
    };
    await options?.progress?.report({
      phase: "inspect_artifact.inventory",
      completed: 0,
      total: 1,
      message: "inventory substep started",
    });
    // The freshly parsed inventory is exclusively owned here. Sealing it lets
    // the nested Evidence share it instead of cloning and re-digesting it.
    const inventory = freezeJsonSnapshot(
      await this.inventory(inventoryParameters, options),
    );
    const subject = subjectFor(
      artifactTargetSelectedPath(this.target),
      inventory.manifest,
    );
    const inventoryEvidence = createEvidence(subject, ARTIFACT_GRAPH_PROVIDER, {
      operation: "inventory_artifact",
      parameters: inventoryParameters,
      result: inventory,
      rawResult: null,
      limitations: inventory.limitations,
      // The nested inventory already names every occurrence's logical path.
      locations: [],
    });
    // The returned execution and its Evidence then reuse this owned report.
    const result = freezeJsonSnapshot(
      createArtifactInspection(inventoryEvidence),
    );
    await options?.progress?.report({
      phase: "inspect_artifact.inventory",
      completed: 1,
      total: 1,
      message: "inventory substep completed",
    });
    return ok(
      createAnalysisExecution(result, ARTIFACT_GRAPH_PROVIDER, {
        rawResult: null,
        limitations: result.limitations,
        sourceEvidence: artifactInspectionSources(result),
        subject,
        locations: [],
      }),
    );
  }

  private inventory(
    parsed: {
      readonly integrity_policy: "fail" | "record-and-continue";
    },
    options?: ExecutionOptions,
  ) {
    return inventoryArtifact(this.target.sourcePath ?? this.target.path, {
      expectedRootSha256:
        this.target.bundleInfoPlist === undefined
          ? this.target.sha256
          : undefined,
      selectedPath: this.target.artifactSelectedPath,
      resourceScope: this.#resourceScope,
      environment: this.environment,
      asarHeaderAdmission: runtimeAsarHeaderAdmission(
        this.environment,
        this.settings,
      ),
      espFlashSelection: espFlashSelection(this.target),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      integrity: parsed.integrity_policy,
    });
  }
}

/** Caller inputs of an explicitly selected ESP flash image, for its readers. */
const espFlashSelection = (
  target: BinaryTarget,
): EspFlashSelection | undefined =>
  target.format === "esp-flash-image" && target.espFlash.selected
    ? {
        flashOffset: target.espFlash.flashOffset ?? undefined,
        partitionTableOffset: target.espFlash.partitionTableOffset ?? undefined,
      }
    : undefined;

const isArtifactOperation = (
  operation: AnalysisOperation,
): operation is ArtifactAnalysisOperation =>
  ARTIFACT_ANALYSIS_OPERATIONS.includes(
    operation as (typeof ARTIFACT_ANALYSIS_OPERATIONS)[number],
  );

const subjectFor = (
  path: string,
  manifest: {
    readonly root_sha256: string;
    readonly root_format: import("../domain/artifactGraph.js").ArtifactInventoryResult["manifest"]["root_format"];
  },
) => ({
  path,
  sha256: manifest.root_sha256,
  format: manifest.root_format,
});

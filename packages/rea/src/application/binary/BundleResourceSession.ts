import type {
  AnalysisClient,
  AnalysisOperation,
  CapabilityDescriptor,
} from "../AnalysisProvider.js";
import { AnalysisCapabilityUnavailableError } from "../../domain/analysisErrorCore.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import { err, ok } from "../../domain/result.js";
import type { ResolvedAppBundleResourceRoot } from "../AppBundleExecutable.js";
import { closeAnalysisClient } from "../AnalysisClientCleanup.js";

export const BUNDLE_NATIVE_RESOURCE_OPERATIONS = new Set<AnalysisOperation>([
  "inspect_plist",
]);

export const BUNDLE_ARTIFACT_RESOURCE_OPERATIONS = new Set<AnalysisOperation>([
  "decode_interface_builder",
  "inspect_asset_catalog",
  "inspect_keyed_archive",
]);

export const BUNDLE_RESOURCE_OPERATIONS = new Set<AnalysisOperation>([
  ...BUNDLE_NATIVE_RESOURCE_OPERATIONS,
  ...BUNDLE_ARTIFACT_RESOURCE_OPERATIONS,
]);

/** Share the dispatch owner's resource-session operation policy with discovery. */
export const isBundleResourceOperation = (name: string): boolean => {
  for (const operation of BUNDLE_RESOURCE_OPERATIONS)
    if (operation === name) return true;
  return false;
};

/** Provider-specific owner of the four read-only app-resource operations. */
export interface BundleResourceClientFactory {
  createClient(
    root: ResolvedAppBundleResourceRoot,
  ): BundleResourceClientBinding | Promise<BundleResourceClientBinding>;
}

export interface BundleResourceClientBinding {
  readonly client: AnalysisClient;
  readonly capabilities: readonly CapabilityDescriptor[];
}

export interface ActiveBundleResourceSession {
  readonly root: ResolvedAppBundleResourceRoot;
  readonly client: AnalysisClient;
  readonly capabilities: readonly CapabilityDescriptor[];
  readonly runId: string;
}

/** Route each resource read to the owner that understands its format. */
export const combineBundleResourceClients = (
  artifactClient: AnalysisClient,
  nativeClient: AnalysisClient,
): AnalysisClient => ({
  execute: (operation, parameters, options) => {
    if (operation === "health")
      return artifactClient.execute(operation, parameters, options);
    if (!BUNDLE_RESOURCE_OPERATIONS.has(operation))
      return Promise.resolve(
        err(
          new AnalysisCapabilityUnavailableError(
            "bundle-resources",
            operation,
            "This session provides read-only app resource inspection only.",
          ),
        ),
      );
    return BUNDLE_NATIVE_RESOURCE_OPERATIONS.has(operation)
      ? nativeClient.execute(operation, parameters, options)
      : artifactClient.execute(operation, parameters, options);
  },
  close: async (options) => {
    const [artifact, native] = await Promise.all([
      closeAnalysisClient(artifactClient, "bundle-resources", options),
      closeAnalysisClient(nativeClient, "bundle-resources", options),
    ]);
    if (!artifact.ok && !native.ok) {
      const failure = analysisErrorWithCleanupFailure(
        artifact.error,
        native.error,
        "close_binary",
      );
      if (artifact.error.cleanupIncomplete && native.error.cleanupIncomplete)
        failure.bindCleanupDependencies([artifact.error, native.error]);
      return err(failure);
    }
    if (!artifact.ok) return artifact;
    if (!native.ok) return native;
    return ok(null);
  },
});

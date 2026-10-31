import type { CapabilityDescriptor } from "../application/AnalysisProvider.js";
import { ARTIFACT_GRAPH_PROVIDER } from "../domain/investigationProviders.js";
import { ARTIFACT_ANALYSIS_OPERATIONS } from "../contracts/artifactToolContracts.js";

/** Declare artifact coverage without constructing readers or acquiring resources. */
export const artifactCapabilities = (
  platform: NodeJS.Platform = process.platform,
): readonly CapabilityDescriptor[] =>
  Object.freeze(
    ARTIFACT_ANALYSIS_OPERATIONS.map((operation) => {
      const common = {
        provider: ARTIFACT_GRAPH_PROVIDER,
        operation,
        effects: Object.freeze({
          mutatesArtifact: false,
          launchesProcess:
            operation !== "decode_interface_builder" &&
            operation !== "inspect_keyed_archive" &&
            operation !== "trace_dylib_resolution",
          mayShowUi: false,
          mayAccessNetwork: false,
          mayWriteFilesystem:
            operation === "extract_artifact" ||
            operation === "inspect_artifact" ||
            operation === "inventory_artifact",
          changesPermissions: false,
          requiresRoot: false,
        }),
        limitations: Object.freeze([
          "DMG child inventory automatically uses a read-only native macOS mount; PKG remains root-hash-only.",
          "ASAR files discovered in filesystem-backed inventories are expanded without bulk extraction; other nested containers remain recorded only.",
        ]),
      };
      return Object.freeze(
        operation === "inspect_asset_catalog" && platform !== "darwin"
          ? {
              ...common,
              available: false as const,
              availabilityCode: "unsupported_host" as const,
              reason: "Apple asset catalogs require macOS assetutil.",
            }
          : { ...common, available: true as const, reason: null },
      );
    }),
  );

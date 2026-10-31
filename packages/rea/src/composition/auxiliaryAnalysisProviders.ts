import type { AnalysisSettingsReader } from "../domain/analysisSettings.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import type { LazyAnalysisProvider } from "../application/binary/LazyAnalysisProvider.js";
import { artifactCapabilities } from "../artifacts/ArtifactProviderMetadata.js";
import {
  ARTIFACT_GRAPH_PROVIDER,
  MANAGED_STATIC_PROVIDER,
} from "../domain/investigationProviders.js";
import { managedStaticCapabilities } from "../dotnet/ManagedStaticProviderMetadata.js";
import {
  NATIVE_MACOS_PROVIDER_IDENTITY,
  nativeMacOSCapabilities,
} from "../native/NativeMacOSProviderMetadata.js";

type AuxiliaryProviderDeclaration = ConstructorParameters<
  typeof LazyAnalysisProvider
>[0];

/** Wire the three existing auxiliary AnalysisProvider implementations lazily. */
export const auxiliaryAnalysisProviderDeclarations = (
  selectedEnvironment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform = process.platform,
  settings?: AnalysisSettingsReader,
): readonly AuxiliaryProviderDeclaration[] => {
  const environment = snapshotEnvironment(selectedEnvironment, platform);
  return [
    {
      identity: ARTIFACT_GRAPH_PROVIDER,
      capabilities: artifactCapabilities(platform),
      load: async () => {
        const { ArtifactProvider } =
          await import("../artifacts/ArtifactProvider.js");
        return new ArtifactProvider(environment, platform, settings);
      },
    },
    {
      identity: NATIVE_MACOS_PROVIDER_IDENTITY,
      capabilities: nativeMacOSCapabilities(platform),
      load: async () => {
        const { NativeMacOSProvider } =
          await import("../native/NativeMacOSProvider.js");
        return new NativeMacOSProvider(environment, undefined, platform);
      },
    },
    {
      identity: MANAGED_STATIC_PROVIDER,
      capabilities: managedStaticCapabilities(),
      load: async () => {
        const { ManagedStaticProvider } =
          await import("../dotnet/ManagedStaticProvider.js");
        return new ManagedStaticProvider();
      },
    },
  ];
};

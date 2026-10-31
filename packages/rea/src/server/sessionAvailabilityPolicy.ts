import {
  HOST_RESTRICTED_FEATURES,
  type AvailabilityPolicy,
  type HostRestrictedFeature,
} from "../application/CapabilityInventory.js";
import type { OptionalProviderLoadFailures } from "../application/OptionalObservationProviders.js";
import { platform } from "node:process";

export interface SessionAvailabilityDefaults {
  readonly optionalProviderLoadFailures?:
    | OptionalProviderLoadFailures
    | undefined;
  readonly hostUnsupported?: AvailabilityPolicy["hostUnsupported"];
  readonly optionalFeatures?: Pick<
    AvailabilityPolicy,
    | "packetCaptureEnabled"
    | "signalRecordingEnabled"
    | "wasmArtifactEnabled"
    | "evmInterfaceEnabled"
    | "browserObservationEnabled"
    | "browserScenarioEnabled"
    | "electronObservationEnabled"
    | "electronAutomationEnabled"
    | "v8InspectorObservationEnabled"
    | "javascriptRecoveryEnabled"
    | "webModuleResolutionEnabled"
    | "binaryLayoutEnabled"
    | "recordedCrashEnabled"
    | "firmwareInspectionEnabled"
    | "firmwareExtractionEnabled"
  >;
}

/** Either the caller or the observed host can mark an integration unsupported. */
const combineHostUnsupported = (
  configured: AvailabilityPolicy["hostUnsupported"],
  observed: NonNullable<AvailabilityPolicy["hostUnsupported"]>,
): Partial<Record<HostRestrictedFeature, boolean>> => {
  const combined: Partial<Record<HostRestrictedFeature, boolean>> = {};
  for (const feature of HOST_RESTRICTED_FEATURES)
    if (configured?.[feature] === true || observed[feature] === true)
      combined[feature] = true;
  return combined;
};

/** Select configured availability reporting or the target-free defaults. */
export const sessionAvailabilityPolicy = (
  configured: (() => AvailabilityPolicy) | undefined,
  defaults: SessionAvailabilityDefaults,
): (() => AvailabilityPolicy) => {
  const policy =
    configured ??
    (() => ({
      packetCaptureEnabled:
        defaults.optionalFeatures?.packetCaptureEnabled ?? false,
      signalRecordingEnabled:
        defaults.optionalFeatures?.signalRecordingEnabled ?? false,
      wasmArtifactEnabled:
        defaults.optionalFeatures?.wasmArtifactEnabled ?? false,
      evmInterfaceEnabled:
        defaults.optionalFeatures?.evmInterfaceEnabled ?? false,
      processCaptureEnabled: platform !== "win32",
      recordedCrashEnabled:
        defaults.optionalFeatures?.recordedCrashEnabled ?? false,
      binaryLayoutEnabled:
        defaults.optionalFeatures?.binaryLayoutEnabled ?? false,
      firmwareInspectionEnabled:
        defaults.optionalFeatures?.firmwareInspectionEnabled ?? false,
      firmwareExtractionEnabled:
        defaults.optionalFeatures?.firmwareExtractionEnabled ?? false,
      javascriptRecoveryEnabled:
        defaults.optionalFeatures?.javascriptRecoveryEnabled ?? false,
      webModuleResolutionEnabled:
        defaults.optionalFeatures?.webModuleResolutionEnabled ?? false,
      browserObservationEnabled:
        defaults.optionalFeatures?.browserObservationEnabled ?? false,
      browserScenarioEnabled:
        defaults.optionalFeatures?.browserScenarioEnabled ?? false,
      electronObservationEnabled:
        defaults.optionalFeatures?.electronObservationEnabled ?? false,
      electronAutomationEnabled:
        defaults.optionalFeatures?.electronAutomationEnabled ?? false,
      v8InspectorObservationEnabled:
        defaults.optionalFeatures?.v8InspectorObservationEnabled ?? false,
    }));
  // Observed host support also bounds a configured policy: no policy lets the
  // default providers pass their execution host checks.
  return () => {
    const value: AvailabilityPolicy = policy();
    return {
      ...value,
      ...(defaults.optionalProviderLoadFailures === undefined
        ? {}
        : {
            optionalProviderLoadFailures: defaults.optionalProviderLoadFailures,
          }),
      ...(defaults.hostUnsupported === undefined
        ? {}
        : {
            hostUnsupported: combineHostUnsupported(
              value.hostUnsupported,
              defaults.hostUnsupported,
            ),
          }),
    };
  };
};

import { analysisProfilesEqual } from "../../domain/analysisProfile.js";
import type { AnalysisProfileCommitment } from "../../domain/analysisProfile.js";
import {
  snapshotMatchesBinding,
  type AnalysisSnapshot,
} from "../../domain/analysisSnapshot.js";
import type { BinaryTarget } from "../../domain/binaryTargetTypes.js";
import { workflowAnalysisProfile } from "../WorkflowAnalysisProfile.js";
import type { SessionProviderRoute } from "./SessionProviderRouter.js";

/** Return the exact currently declared native dispatch reader profile, if any. */
export const profilelessNativeDispatchProfile = (
  route: SessionProviderRoute,
): AnalysisProfileCommitment | undefined => {
  const descriptor = route.capabilities.get("inspect_native_dispatch_metadata");
  const profile = descriptor?.analysisProfile;
  if (
    descriptor === undefined ||
    descriptor.operation !== "inspect_native_dispatch_metadata" ||
    !descriptor.available ||
    descriptor.provider.id !== "native-macos" ||
    profile === undefined ||
    profile.provider.id !== descriptor.provider.id ||
    profile.provider.name !== descriptor.provider.name ||
    profile.provider.version.length === 0
  )
    return undefined;
  return structuredClone(profile);
};

/** Require only exact native dispatch workflow observations for this target/profile. */
export const isProfilelessNativeDispatchSnapshot = (
  snapshot: AnalysisSnapshot,
  target: BinaryTarget,
  profile: AnalysisProfileCommitment,
): boolean =>
  snapshotMatchesBinding(snapshot, target, profile) &&
  snapshot.entries.length === 0 &&
  hasOnlyProfilelessNativeDispatchEntries(snapshot.workflow_entries, profile);

/** Reject mixed operations and entries derived from a different source profile. */
export const hasOnlyProfilelessNativeDispatchEntries = (
  entries: readonly {
    readonly operation: string;
    readonly execution: {
      readonly analysis_profile: AnalysisProfileCommitment;
    };
  }[],
  profile: AnalysisProfileCommitment,
): boolean =>
  entries.length > 0 &&
  entries.every(
    (entry) =>
      entry.operation === "inspect_native_dispatch_metadata" &&
      analysisProfilesEqual(
        entry.execution.analysis_profile,
        workflowAnalysisProfile(profile, entry.operation),
      ),
  );

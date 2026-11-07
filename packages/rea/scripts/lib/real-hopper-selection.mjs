import { HOPPER_PROVIDER_IDENTITY } from "../../dist/hopper/HopperProviderCapabilities.js";

/** Verify the selected Hopper candidate and concrete provider binding. */
export const requireHopperSelection = (status, expected) => {
  const candidates = status.analysis_provider_candidates;
  const hopper = Array.isArray(candidates)
    ? candidates.find(
        (candidate) => candidate?.provider?.id === HOPPER_PROVIDER_IDENTITY.id,
      )
    : undefined;
  if (
    hopper === undefined ||
    hopper.availability?.status !== "available" ||
    hopper.target_support?.status !== expected.targetSupport ||
    hopper.selected !== expected.selected
  )
    throw new Error("binary_session omitted truthful Hopper candidate status");
  if (!expected.selected) {
    if (status.analysis_provider_binding !== null)
      throw new Error("Target-free status unexpectedly selected a provider");
    return null;
  }
  const binding = status.analysis_provider_binding;
  if (
    binding?.provider?.id !== HOPPER_PROVIDER_IDENTITY.id ||
    typeof binding.provider.version !== "string" ||
    binding.selection_source !== "auto-single-candidate" ||
    binding.analysis_profile?.provider?.id !== HOPPER_PROVIDER_IDENTITY.id ||
    binding.analysis_profile.provider.version !== binding.provider.version
  )
    throw new Error("binary_session omitted its concrete Hopper binding");
  return binding;
};

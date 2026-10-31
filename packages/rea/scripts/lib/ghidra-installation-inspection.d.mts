import type {
  GhidraInstallationHost,
  GhidraInstallationInspection,
  GhidraInstallationOptions,
} from "../../src/ghidra/GhidraInstallation.js";

/** Inspect prerequisites with a real owner, including cleanup before completion. */
export function inspectVerifierGhidraInstallation(
  options: Omit<GhidraInstallationOptions, "resourceOwner">,
  host?: GhidraInstallationHost,
): Promise<GhidraInstallationInspection>;

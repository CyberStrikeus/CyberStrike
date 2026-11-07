import type { validateJadxConfiguration } from "../../src/android/JadxConfiguration.js";

type ConfigurationArguments = Parameters<typeof validateJadxConfiguration>;

/** Validate prerequisites with a real owner, joining cleanup before completion. */
export function validateVerifierJadxConfiguration(
  configuration: ConfigurationArguments[0],
  environment: ConfigurationArguments[1],
  operation: ConfigurationArguments[2],
  options?: Omit<ConfigurationArguments[3], "resourceOwner" | "operation">,
): ReturnType<typeof validateJadxConfiguration>;

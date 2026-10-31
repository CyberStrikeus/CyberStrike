import { validateJadxConfiguration } from "../../dist/android/JadxConfiguration.js";
import { withVerifierResourceOwner } from "./verifier-file-resources.mjs";

/** Validate Java and the engine archive before beginning real verification. */
export function validateVerifierJadxConfiguration(
  configuration,
  environment,
  operation,
  options = {},
) {
  return withVerifierResourceOwner((resourceOwner) =>
    validateJadxConfiguration(configuration, environment, operation, {
      ...options,
      resourceOwner,
    }),
  );
}

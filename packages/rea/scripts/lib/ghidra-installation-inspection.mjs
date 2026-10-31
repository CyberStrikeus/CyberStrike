import { inspectGhidraInstallation } from "../../dist/ghidra/GhidraInstallation.js";
import { withVerifierResourceOwner } from "./verifier-file-resources.mjs";

/** Complete one prerequisite inspection and release its exact retained owners. */
export function inspectVerifierGhidraInstallation(options, host) {
  return withVerifierResourceOwner((resourceOwner) =>
    inspectGhidraInstallation({ ...options, resourceOwner }, host),
  );
}

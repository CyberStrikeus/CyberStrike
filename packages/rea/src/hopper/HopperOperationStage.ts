import type { ProviderFailureStage } from "../domain/providerOperationHealth.js";

/** Classify Hopper wire operations at their provider boundary. */
export const hopperOperationStage = (
  operation: string,
): ProviderFailureStage => {
  if (operation === "health") return "connection";
  return operation === "procedure_pseudo_code" ? "decompilation" : "analysis";
};

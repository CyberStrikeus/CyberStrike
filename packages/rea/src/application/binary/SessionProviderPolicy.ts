import { ENHANCED_TOOL_CONTRACTS } from "../../contracts/enhancedToolContracts.js";
import { OFFICIAL_TOOL_CONTRACTS } from "../../contracts/officialToolContracts.js";
import type { ProviderIdentity } from "../AnalysisProvider.js";
import type { SessionProviderRoute } from "./SessionProviderRouter.js";

const OFFICIAL_OPERATIONS: ReadonlySet<string> = new Set(
  OFFICIAL_TOOL_CONTRACTS.map(({ name }) => name),
);
const ENHANCED_OPERATIONS: ReadonlySet<string> = new Set(
  ENHANCED_TOOL_CONTRACTS.map(({ name }) => name),
);

/** Attribute preview and active operations to the same selected provider. */
export const routeProviderIdentity = (
  route: SessionProviderRoute,
  operation?: string,
): ProviderIdentity => {
  let selected = route.binding?.identity ?? route.identity;
  if (operation !== undefined) {
    const exact = route.capabilities.get(operation)?.provider;
    if (exact !== undefined) selected = exact;
    else if (ENHANCED_OPERATIONS.has(operation)) {
      const providers = new Map<string, ProviderIdentity>();
      for (const descriptor of route.capabilities.values())
        if (
          descriptor.available &&
          OFFICIAL_OPERATIONS.has(descriptor.operation)
        )
          providers.set(descriptor.provider.id, descriptor.provider);
      if (providers.size === 1) {
        const provider = providers.values().next().value;
        if (provider !== undefined) selected = provider;
      }
    }
  }
  return structuredClone(selected);
};

/** Route live-state admission; workflow and resource lifecycle guards belong to callers. */
export const routeAllowsSnapshotReplay = (
  route: SessionProviderRoute | undefined,
  operation: string,
): boolean => {
  const descriptor = route?.capabilities.get(operation);
  if (descriptor !== undefined) return descriptor.cachePolicy !== "live";
  return ![...(route?.capabilities.values() ?? [])].some(
    ({ cachePolicy }) => cachePolicy === "live",
  );
};

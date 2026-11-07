import { InvestigationRecords } from "../investigation/InvestigationRecords.js";
import type { AnalysisProvider } from "../AnalysisProvider.js";
import { AnalysisProviderRegistry } from "./AnalysisProviderRegistry.js";
import { BinarySession } from "./BinarySession.js";
import { SessionProviderRouter } from "./SessionProviderRouter.js";
import type { BundleResourceClientFactory } from "./BundleResourceSession.js";

/**
 * Compose one provider-neutral session from deep-provider selection and
 * disjoint auxiliary operation families.
 */
export const composeBinarySession = (
  registry: AnalysisProviderRegistry,
  auxiliaryProviders: readonly AnalysisProvider[] = [],
  bundleResourceFactory?: BundleResourceClientFactory,
): BinarySession =>
  new BinarySession(
    SessionProviderRouter.selectable(registry, auxiliaryProviders),
    new InvestigationRecords(),
    bundleResourceFactory,
  );

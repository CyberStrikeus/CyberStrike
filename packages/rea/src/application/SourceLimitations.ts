import type {
  AnalysisOperation,
  ProviderIdentity,
} from "./AnalysisProvider.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";

/** One provider-owned caveat tied to the operation that reported it. */
export interface SourceLimitation {
  readonly provider: ProviderIdentity;
  readonly operation: AnalysisOperation;
  readonly limitation: string;
}

/** Stable exact-provenance key for deduplication before rendering. */
export const sourceLimitationKey = ({
  provider,
  operation,
  limitation,
}: SourceLimitation): string =>
  JSON.stringify([
    provider.id,
    provider.name,
    provider.version,
    operation,
    limitation,
  ]);

/** Provider/text identity shared by rendering and composed-workflow budgets. */
export const sourceLimitationGroupKey = ({
  provider,
  limitation,
}: Pick<SourceLimitation, "provider" | "limitation">): string =>
  JSON.stringify([provider.id, provider.name, provider.version, limitation]);

/** Render unique source caveats without losing their provider or operation. */
export const renderSourceLimitations = (
  limitations: readonly SourceLimitation[],
): string[] => {
  const groups = new Map<
    string,
    {
      readonly provider: ProviderIdentity;
      readonly limitation: string;
      readonly operations: Set<AnalysisOperation>;
    }
  >();
  for (const { provider, operation, limitation } of limitations) {
    const key = sourceLimitationGroupKey({ provider, limitation });
    const group = groups.get(key) ?? {
      provider,
      limitation,
      operations: new Set<AnalysisOperation>(),
    };
    group.operations.add(operation);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ provider, limitation, operations }) => {
      const version = provider.version === null ? "" : ` ${provider.version}`;
      const operationList = [...operations].sort(compareUnicodeCodePoints);
      return `${provider.name} (${provider.id}${version}) ${operationList.join(", ")}: ${limitation}`;
    })
    .sort(compareUnicodeCodePoints);
};

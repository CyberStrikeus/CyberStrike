import { PROMPT_CONTRACTS, type PromptContract } from "./promptContracts.js";
import { toolFamilyId } from "./toolFamilies.js";

/**
 * Workflows whose every suggested tool is in the advertised families.
 * A partial workflow would direct the agent to a disabled call, so a prompt
 * is advertised only when its complete tool set is in scope; an absent
 * selection keeps the complete inventory, matching unscoped servers.
 */
export const promptsForToolFamilies = (
  selection: ReadonlySet<string> | undefined,
  contracts: readonly PromptContract[] = PROMPT_CONTRACTS,
): readonly PromptContract[] =>
  selection === undefined
    ? contracts
    : contracts.filter(({ steps }) =>
        steps.every(({ tools }) =>
          tools.every((tool) => {
            const family = toolFamilyId(tool);
            return family !== undefined && selection.has(family);
          }),
        ),
      );

import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import { accessGuidedWorkflows } from "../application/GuidedWorkflowAccess.js";
import { toolContract } from "../contracts/toolContracts.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";
import { promptsForToolFamilies } from "../contracts/promptToolFamilyScope.js";

/** Register provider-free access to the existing guided prompt contracts. */
export const registerGuidedWorkflowTool = (server: EvidenceMcpServer): void => {
  const contract = toolContract("guided_workflows");
  const prompts = promptsForToolFamilies(server.advertisedToolFamilies);
  server.registerTool(
    contract.name,
    applicationToolRegistrationOptions(contract),
    async (input) =>
      server.delivery.toCallToolResult(
        accessGuidedWorkflows(input, prompts),
        contract,
      ),
  );
};

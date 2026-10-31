import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import { registerCompareManagedMembers } from "./registerManagedWorkflowTools/compareManagedMembers.js";
import { registerVerifyManagedNativeBoundaries } from "./registerManagedWorkflowTools/verifyManagedNativeBoundaries.js";
import { registerImportManagedReconstruction } from "./registerManagedWorkflowTools/importManagedReconstruction.js";
import { registerProjectManagedApplicationGraph } from "./registerManagedWorkflowTools/projectManagedApplicationGraph.js";
import type { ManagedWorkflowToolRegistration } from "./registerManagedWorkflowTools/types.js";

/** Register provider-neutral managed-code workflows. */
export const registerManagedWorkflowTools = (
  server: EvidenceMcpServer,
  options: ManagedWorkflowToolRegistration,
): void => {
  registerCompareManagedMembers(server, options);
  registerVerifyManagedNativeBoundaries(server, options);
  registerImportManagedReconstruction(server, options);
  registerProjectManagedApplicationGraph(server, options);
};

import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import { NATIVE_TOOL_CONTRACTS } from "../contracts/native/nativeToolContracts.js";
import { registerEvidenceTools } from "./registerEvidenceTools.js";
import type { EvidenceToolFamilyOptions } from "./retainedSummaryDelivery.js";

/** Register macOS native contracts; Mach-O inspection can deliver a retained summary. */
export const registerNativeTools = (
  server: EvidenceMcpServer,
  options: EvidenceToolFamilyOptions,
): void => {
  registerEvidenceTools(server, NATIVE_TOOL_CONTRACTS, options);
};

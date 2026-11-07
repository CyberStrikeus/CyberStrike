import type { CallToolResult } from "@modelcontextprotocol/server";

import { toolContract } from "../../src/contracts/toolContracts.js";
import { parseEvidenceBundle } from "../../src/domain/evidenceBundle.js";

/** Parse the full bundle through the advertised result and its owning contract. */
export const parseMcpEvidenceBundle = (response: CallToolResult) =>
  parseEvidenceBundle(
    toolContract("get_evidence_bundle").outputSchema.parse(
      response.structuredContent,
    ).result,
  );

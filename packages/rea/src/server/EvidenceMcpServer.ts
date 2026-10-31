import type {
  Implementation,
  McpServerOptions,
} from "@modelcontextprotocol/server";

import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import {
  catalogIdentityForToolFamilies,
  type createCatalogIdentity,
} from "../catalogIdentity.js";
import { toolFamilyId } from "../contracts/toolFamilies.js";
import type { ToolResultDelivery } from "./ToolResultDelivery.js";
import type { McpOutputSchemaProfile } from "../config/mcpOutputSchemaProfile.js";
import { EvidenceMcpServerCore } from "./EvidenceMcpServerCore.js";
import type { CompactInputSchemaPresentation } from "../contracts/compactInputSchema.js";

/** Canonical composition retains the constructor's existing identity defaults. */
export class EvidenceMcpServer extends EvidenceMcpServerCore {
  constructor(
    info: Implementation,
    options: McpServerOptions,
    recordEvidence: EvidenceWriter["recordEvidence"] | undefined,
    delivery: ToolResultDelivery,
    compactPresentation: CompactInputSchemaPresentation | undefined = undefined,
    outputSchemaProfile: McpOutputSchemaProfile = "full",
    identity?: ReturnType<typeof createCatalogIdentity>,
    advertisedToolFamilies: ReadonlySet<string> | undefined = undefined,
  ) {
    super(
      info,
      options,
      recordEvidence,
      delivery,
      compactPresentation,
      outputSchemaProfile,
      identity ??
        catalogIdentityForToolFamilies(
          compactPresentation,
          outputSchemaProfile,
          advertisedToolFamilies,
        ),
      advertisedToolFamilies,
    );
  }

  /**
   * Out-of-scope tools stay registered but disabled: `tools/list` omits them
   * and calls fail with the SDK's disabled-tool error, so status reports
   * cannot direct agents to calls that always fail.
   */
  override advertisesTool(name: string): boolean {
    const families = this.advertisedToolFamilies;
    if (families === undefined) return true;
    const family = toolFamilyId(name);
    return family !== undefined && families.has(family);
  }
}

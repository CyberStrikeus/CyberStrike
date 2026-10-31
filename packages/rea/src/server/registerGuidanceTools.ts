import {
  readGuidanceSection,
  searchGuidance,
} from "../application/GuidanceAccess.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { toolContract } from "../contracts/toolContracts.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";

/** Register provider-free search and retrieval over the installed guide bundle. */
export const registerGuidanceTools = (
  server: EvidenceMcpServer,
  resources: ArtifactResourceScope,
): void => {
  const search = toolContract("search_guidance");
  server.registerTool(
    search.name,
    applicationToolRegistrationOptions(search),
    async (input) => {
      const result = await searchGuidance(input, resources);
      return server.delivery.toCallToolResult(
        result.ok
          ? { ok: true, value: jsonValueSchema.parse(result.value) }
          : result,
        search,
      );
    },
  );

  const read = toolContract("read_guidance_section");
  server.registerTool(
    read.name,
    applicationToolRegistrationOptions(read),
    async (input) => {
      const result = await readGuidanceSection(input, resources);
      return server.delivery.toCallToolResult(
        result.ok
          ? { ok: true, value: jsonValueSchema.parse(result.value) }
          : result,
        read,
      );
    },
  );
};

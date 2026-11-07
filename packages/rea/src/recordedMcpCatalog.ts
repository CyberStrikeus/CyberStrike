import type {
  Implementation,
  Prompt,
  ServerCapabilities,
  Tool,
} from "@modelcontextprotocol/server";
import type { createCatalogIdentity } from "./catalogIdentity.js";
import type { PromptArgumentContract } from "./contracts/promptContracts.js";
import type { McpInputSchemaProfile } from "./config/mcpInputSchemaProfile.js";

/** Build-owned discovery data; canonical validators remain the runtime authority. */
export interface RecordedMcpCatalog {
  readonly version: 1;
  readonly info: Implementation;
  readonly capabilities: ServerCapabilities;
  readonly instructions: string;
  readonly identity: ReturnType<typeof createCatalogIdentity>;
  readonly tools: readonly Tool[];
  readonly prompts: readonly (Prompt & {
    readonly parameters: Readonly<Record<string, PromptArgumentContract>>;
  })[];
}

/** Replaced after compilation by the recorder; source runs use eager composition. */
export const RECORDED_MCP_CATALOG_SHA256:
  | Readonly<Record<McpInputSchemaProfile, string>>
  | undefined = undefined;

import type { McpServer } from "@agentclientprotocol/sdk"
import type { CyberStrikeClient } from "@cyberstrike-io/sdk/v2"

export interface ACPSessionState {
  id: string
  cwd: string
  mcpServers: McpServer[]
  createdAt: Date
  model?: {
    providerID: string
    modelID: string
  }
  variant?: string
  modeId?: string
}

export interface ACPConfig {
  sdk: CyberStrikeClient
  defaultModel?: {
    providerID: string
    modelID: string
  }
}

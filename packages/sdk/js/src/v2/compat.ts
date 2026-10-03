// Backward-compat type shim for the regenerated v2 SDK.
//
// The generated OpenAPI types (gen/types.gen.ts) dropped the `*V2Info` name suffix
// (AgentV2Info -> Agent, ...) and removed the integration / credential / connection /
// reference / skill-source entity types entirely. The rest of the codebase still imports
// the old names. This module re-adds them in a regeneration-safe location (re-exported by
// client.ts and v2/types.ts) so consumers keep compiling without editing the generated file
// or every call site. Renames are aliases; the removed entities are re-declared verbatim
// from the previous generated output.

import type { Session, FileDiff } from "./gen/types.gen.js"

// --- Renames (suffix dropped in the new spec) ---
export type SessionV2Info = Session
// The old snapshot/vcs diff types were unified into FileDiff. The field `path` is now `file`;
// call sites that read `.path` must be updated — the alias only fixes the type name.
export type SnapshotFileDiff = FileDiff
export type VcsFileDiff = FileDiff

// --- Internal catalog/agent/command draft shapes ---
// The regenerated spec slimmed Agent/Model/Provider/Command down to their HTTP WIRE shapes
// (e.g. Agent.permission, Model.cost-as-object, Command.model-as-string). The *V2Info names
// are the INTERNAL mutable draft shapes that the plugin host and core catalog layer operate
// on — they are the `@cyberstrike-io/schema` entity shapes, which the old generated SDK
// happened to mirror. The wire types no longer match, so the draft shapes are restored here
// (field-for-field with `@cyberstrike-io/schema` {agent,model,provider,command}.Info, ids as
// plain strings as the generator emitted them). These feed @cyberstrike-io/plugin's draft
// interfaces and core's models-dev / variant helpers; do NOT point them at the wire types.

type ApiSettings = { [key: string]: unknown }
type RequestFields = {
  headers: { [key: string]: string }
  body: { [key: string]: unknown }
}

export type ProviderV2Api =
  | { type: "aisdk"; package: string; url?: string; settings?: ApiSettings }
  | { type: "native"; url?: string; settings: ApiSettings }

export type ProviderV2Info = {
  id: string
  integrationID?: string
  name: string
  disabled?: boolean
  api: ProviderV2Api
  request: RequestFields
}

export type ModelV2Api =
  | { id: string; type: "aisdk"; package: string; url?: string; settings?: ApiSettings }
  | { id: string; type: "native"; url?: string; settings: ApiSettings }

export type ModelV2Cost = {
  tier?: { type: "context"; size: number }
  input: number
  output: number
  cache: { read: number; write: number }
}

export type ModelV2Info = {
  id: string
  providerID: string
  family?: string
  name: string
  api: ModelV2Api
  capabilities: {
    tools: boolean
    input: Array<string>
    output: Array<string>
  }
  request: RequestFields & { variant?: string }
  variants: Array<RequestFields & { id: string }>
  time: { released: number }
  cost: Array<ModelV2Cost>
  status: "alpha" | "beta" | "deprecated" | "active"
  enabled: boolean
  limit: { context: number; input?: number; output: number }
}

export type AgentV2Permission = {
  action: string
  resource: string
  effect: "allow" | "deny" | "ask"
}

export type AgentV2Info = {
  id: string
  model?: { id: string; providerID: string; variant?: string }
  request: RequestFields
  system?: string
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden: boolean
  color?: string
  steps?: number
  permissions: Array<AgentV2Permission>
}

export type CommandV2Info = {
  name: string
  template: string
  description?: string
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
  subtask?: boolean
}

// --- Connections ---
export type ConnectionInfo = ConnectionCredentialInfo | ConnectionEnvInfo

export type ConnectionCredentialInfo = {
  type: "credential"
  id: string
  label: string
}

export type ConnectionEnvInfo = {
  type: "env"
  name: string
}

// --- Credentials ---
export type CredentialOAuth = {
  type: "oauth"
  methodID: string
  refresh: string
  access: string
  expires: number
  metadata?: {
    [key: string]: unknown
  }
}

export type CredentialKey = {
  type: "key"
  key: string
  metadata?: {
    [key: string]: unknown
  }
}

export type CredentialValue = CredentialOAuth | CredentialKey

// --- Filesystem ---
export type FileSystemEntry = {
  path: string
  type: "file" | "directory"
}

// --- Integrations ---
export type IntegrationRef = {
  id: string
  name: string
}

export type IntegrationMethod = IntegrationOAuthMethod | IntegrationKeyMethod | IntegrationEnvMethod

export type IntegrationKeyMethod = {
  type: "key"
  label?: string
}

export type IntegrationOAuthMethod = {
  id: string
  type: "oauth"
  label: string
  prompts?: Array<IntegrationTextPrompt | IntegrationSelectPrompt>
}

export type IntegrationEnvMethod = {
  type: "env"
  names: Array<string>
}

export type IntegrationInputs = {
  [key: string]: string
}

export type IntegrationWhen = {
  key: string
  op: "eq" | "neq"
  value: string
}

export type IntegrationTextPrompt = {
  type: "text"
  key: string
  message: string
  placeholder?: string
  when?: IntegrationWhen
}

export type IntegrationSelectPrompt = {
  type: "select"
  key: string
  message: string
  options: Array<{
    label: string
    value: string
    hint?: string
  }>
  when?: IntegrationWhen
}

// --- References ---
export type ReferenceGitSource = {
  type: "git"
  repository: string
  branch?: string
  description?: string
  hidden?: boolean
}

export type ReferenceLocalSource = {
  type: "local"
  path: string
  description?: string
  hidden?: boolean
}

export type ReferenceSource = ReferenceLocalSource | ReferenceGitSource

export type ReferenceInfo = {
  name: string
  path: string
  description?: string
  hidden?: boolean
  source: ReferenceSource
}

// --- Skill sources ---
export type SkillV2Info = {
  name: string
  description?: string
  slash?: boolean
  location: string
  content: string
}

export type SkillV2DirectorySource = {
  type: "directory"
  path: string
}

export type SkillV2UrlSource = {
  type: "url"
  url: string
}

export type SkillV2EmbeddedSource = {
  type: "embedded"
  skill: SkillV2Info
}

export type SkillV2Source = SkillV2DirectorySource | SkillV2UrlSource | SkillV2EmbeddedSource

// Domain provider contract — the shared vocabulary a domain plugin uses to
// contribute its agents to CyberStrike, exactly as ToolDefinition is the shared
// vocabulary for contributing tools. Lives in the SDK (not the host) so a plugin
// package can `import { AgentSpec, DomainProvider } from "@cyberstrike-io/plugin"`
// and the host can reference the same types when collecting the `provider` hook.
//
// These types are intentionally self-contained (primitives + PermissionRule) so
// the SDK gains no host dependency. Richer per-domain capabilities (signal
// detectors, routers) stay in the host and are layered on top there.

export type PermissionAction = "ask" | "allow" | "deny"
export type PermissionRule = PermissionAction | Record<string, PermissionAction>

export interface AgentSpec {
  name: string
  role:
    | "analyst"
    | "batch-verifier"
    | "verifier"
    | "followup"
    | "orchestrator"
    | "specialist"
    | "analyzer"
    | "support"
  group?: string
  description: string
  steps: number
  color: string
  prompt: string
  skills: string[]
  permissions: Record<string, PermissionRule>
  hidden?: boolean
  prependRequestContext?: boolean
  useSmallModel?: boolean
}

/**
 * A security domain's registration surface: a stable key plus the agents it
 * contributes. The host collects these (built-in domains + plugin `provider`
 * hooks) into one agent registry.
 */
export interface DomainProvider {
  key: string
  agentSpecs(): AgentSpec[]
}

/**
 * Yields a provider instance. May be async (e.g. loading skill files) or sync.
 * A plugin's `provider` hook maps a domain key to one of these.
 */
export type DomainProviderFactory = () => DomainProvider | Promise<DomainProvider>

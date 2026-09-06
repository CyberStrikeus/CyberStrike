// Domain provider registry (docs/domain-plugin-architecture.md, Phase 1a).
//
// The single place the agent system collects its domain providers. Built-in
// domains (web, azure) register here at module load; installed plugin packages
// will register through the SDK `provider` hook (Phase 1b). agent.ts resolves the
// registry instead of hardcoding `new AzureProvider()` / `WebProvider.create()`,
// so a new domain is added by REGISTERING, never by editing the agent loader.
import type { DomainProvider, AgentSpec, DomainProviderFactory } from "./provider"
import { AzureProvider } from "./provider-azure"
import { WebProvider } from "./provider-web"

export type { DomainProviderFactory }

const factories = new Map<string, DomainProviderFactory>()

/**
 * Register a domain provider factory under a stable key (its domain, e.g. "web").
 * Idempotent per key: re-registering the same key replaces it, so a plugin
 * reloaded in-session doesn't double-register. Registering is cheap — the factory
 * runs only at resolveProviders() time.
 */
export function registerProvider(key: string, factory: DomainProviderFactory): void {
  factories.set(key, factory)
}

/** Keys of all registered domains (for diagnostics/tests). */
export function registeredDomains(): string[] {
  return [...factories.keys()]
}

/**
 * Resolve a single domain's provider by key, running ONLY that domain's factory
 * (not every registered one). Returns undefined if the domain isn't registered or
 * its factory throws. Used by workflow entry-points (C10) to drive a domain's
 * orchestration from the registry instead of constructing a provider by hand.
 */
export async function resolveProvider(key: string): Promise<DomainProvider | undefined> {
  const factory = factories.get(key)
  if (!factory) return undefined
  try {
    return await factory()
  } catch {
    return undefined
  }
}

export interface ResolvedProviders {
  providers: DomainProvider[]
  errors: Array<{ key: string; error: unknown }>
}

/**
 * Run every registered factory. A domain whose factory throws is SKIPPED with its
 * error collected — a broken/incompatible plugin must never take down the others
 * or the core (invariant 2). Returns the providers that loaded plus the failures.
 */
export async function resolveProviders(): Promise<ResolvedProviders> {
  const providers: DomainProvider[] = []
  const errors: Array<{ key: string; error: unknown }> = []
  for (const [key, factory] of factories) {
    try {
      providers.push(await factory())
    } catch (error) {
      errors.push({ key, error })
    }
  }
  return { providers, errors }
}

/**
 * Flatten every resolved provider's agent specs into one list, failing fast on a
 * cross-domain agent-name collision (invariant 3) — two domains claiming the same
 * agent name would silently shadow each other in the registry. Returns the specs
 * and the provider load errors so the caller can log/surface them.
 */
export async function collectAgentSpecs(): Promise<{ specs: AgentSpec[]; errors: ResolvedProviders["errors"] }> {
  const { providers, errors } = await resolveProviders()
  const specs: AgentSpec[] = []
  const seen = new Map<string, string>() // agent name -> domain key that owns it
  for (const provider of providers) {
    for (const spec of provider.agentSpecs()) {
      const owner = seen.get(spec.name)
      if (owner) {
        throw new Error(
          `ProviderRegistry: agent name "${spec.name}" is declared by both domain "${owner}" and "${provider.key}" — agent names must be unique across domains.`,
        )
      }
      seen.set(spec.name, provider.key)
      specs.push(spec)
    }
  }
  return { specs, errors }
}

// ── Built-in domains ─────────────────────────────────────────────────────────
// Registered once at module load. Web + Azure are no longer special-cased in the
// agent loader — they are simply the first two registry entries (invariant 4).
registerProvider("azure", () => new AzureProvider())
registerProvider("web", () => WebProvider.create())

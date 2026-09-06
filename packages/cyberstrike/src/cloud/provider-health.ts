// Domain health report (docs/domain-plugin-architecture.md, Phase 6 introspection).
//
// After a user installs a domain (`npm install @cyberstrike/aws`) and restarts,
// they need to SEE what registered: which domains loaded, how many agents each
// contributes (by role), which tools those agents may call, how many permission
// rules, and whether anything is broken (load error, agent-name collision across
// domains). This is the diagnostic surface behind a `cyberstrike domains` / health
// view. Pure over the registry — never throws, so it stays useful even when a
// plugin is broken.
import type { AgentSpec, PermissionRule } from "./provider"
import { resolveProviders } from "./provider-registry"

export interface DomainHealth {
  domain: string
  loaded: boolean
  error?: string
  agents: number
  byRole: Record<string, number>
  agentNames: string[]
  tools: number
  toolNames: string[]
  ruleCount: number
}

export interface HealthReport {
  domains: DomainHealth[]
  totalDomains: number
  loadedDomains: number
  totalAgents: number
  collisions: Array<{ agent: string; domains: string[] }>
  loadErrors: Array<{ domain: string; error: string }>
  ok: boolean
}

// Permission keys that are structural, not callable tools — excluded from the
// per-domain tool count so "tools" reflects capabilities the agents actually call.
const NON_TOOL_KEYS = new Set(["*"])

/** Distinct permission keys the agent is granted (value "allow", or an object map
 *  that isn't a blanket deny), minus structural keys — i.e. the tools it may call. */
function grantedTools(permissions: Record<string, PermissionRule>): string[] {
  const out: string[] = []
  for (const [key, rule] of Object.entries(permissions)) {
    if (NON_TOOL_KEYS.has(key)) continue
    if (rule === "allow") out.push(key)
    else if (typeof rule === "object") out.push(key) // scoped rule (e.g. bash with denies) still grants the tool
  }
  return out
}

function summarizeDomain(domain: string, specs: AgentSpec[]): DomainHealth {
  const byRole: Record<string, number> = {}
  const tools = new Set<string>()
  let ruleCount = 0
  for (const s of specs) {
    byRole[s.role] = (byRole[s.role] ?? 0) + 1
    ruleCount += Object.keys(s.permissions).length
    for (const t of grantedTools(s.permissions)) tools.add(t)
  }
  return {
    domain,
    loaded: true,
    agents: specs.length,
    byRole,
    agentNames: specs.map((s) => s.name),
    tools: tools.size,
    toolNames: [...tools].sort(),
    ruleCount,
  }
}

/**
 * Build the health report over every registered domain. Diagnostic, never throws:
 * a failed provider becomes a `loaded: false` entry with its error, and a
 * cross-domain agent-name collision is REPORTED (not thrown) so the view can show
 * exactly what is wrong. `ok` is true only when every domain loaded and there are
 * no collisions.
 */
export async function providerHealth(): Promise<HealthReport> {
  const { providers, errors } = await resolveProviders()

  const domains: DomainHealth[] = []
  const owner = new Map<string, string[]>() // agent name -> domains that declare it

  for (const provider of providers) {
    const specs = provider.agentSpecs()
    domains.push(summarizeDomain(provider.key, specs))
    for (const s of specs) {
      const list = owner.get(s.name) ?? []
      list.push(provider.key)
      owner.set(s.name, list)
    }
  }

  for (const e of errors) {
    domains.push({
      domain: e.key,
      loaded: false,
      error: e.error instanceof Error ? e.error.message : String(e.error),
      agents: 0,
      byRole: {},
      agentNames: [],
      tools: 0,
      toolNames: [],
      ruleCount: 0,
    })
  }

  const collisions = [...owner.entries()]
    .filter(([, ds]) => ds.length > 1)
    .map(([agent, ds]) => ({ agent, domains: ds }))

  const loadErrors = errors.map((e) => ({
    domain: e.key,
    error: e.error instanceof Error ? e.error.message : String(e.error),
  }))

  return {
    domains,
    totalDomains: domains.length,
    loadedDomains: providers.length,
    totalAgents: providers.reduce((n, p) => n + p.agentSpecs().length, 0),
    collisions,
    loadErrors,
    ok: loadErrors.length === 0 && collisions.length === 0,
  }
}

/** One-line-per-domain human-readable summary for a CLI / TUI health view. */
export function formatHealthReport(report: HealthReport): string {
  const lines: string[] = []
  lines.push(
    `Domains: ${report.loadedDomains}/${report.totalDomains} loaded · ${report.totalAgents} agents · ${report.ok ? "OK" : "ISSUES"}`,
  )
  for (const d of report.domains) {
    if (!d.loaded) {
      lines.push(`  ✗ ${d.domain} — FAILED TO LOAD: ${d.error}`)
      continue
    }
    const roles = Object.entries(d.byRole)
      .map(([r, n]) => `${n} ${r}`)
      .join(", ")
    lines.push(`  ✓ ${d.domain} — ${d.agents} agents (${roles}) · ${d.tools} tools · ${d.ruleCount} rules`)
  }
  for (const c of report.collisions) {
    lines.push(`  ! agent "${c.agent}" claimed by: ${c.domains.join(", ")}`)
  }
  return lines.join("\n")
}

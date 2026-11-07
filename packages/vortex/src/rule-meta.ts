// Rule selection metadata — the thing that makes ~20k rules tractable. At that scale you never
// compile-and-run all of them: you SELECT a subset (Nuclei-style) by tags/severity/category and
// prune rules whose `requires` the target can't satisfy, then compile only the survivors. Every rule
// shape (declarative / chain / probe) carries this metadata via `RuleMetaShape`.
import z from "zod"
import type { Severity } from "./transaction"

// zod field bag spread into each rule schema (kept dependency-free so all three schemas + the pack
// loader can share it without a cycle).
export const RuleMetaShape = {
  tags: z.array(z.string()).optional(), // free-form selection labels: "cve", "xss", "apache", "auth"
  requires: z
    .object({ tech: z.array(z.string()).optional() }) // only run when the target shows this tech
    .strict()
    .optional(),
}

export interface RuleMeta {
  severity: Severity
  category: string
  tags?: string[]
  requires?: { tech?: string[] }
}

// A selection filter — what an agent/host asks to run.
export interface Selection {
  tags?: string[] // keep rules carrying at least one of these
  excludeTags?: string[] // drop rules carrying any of these
  categories?: string[] // keep only these categories
  minSeverity?: Severity // keep rules at or above this severity
}

// Context derived from the corpus/target, for pruning rules that can't apply (cheap pre-filter).
export interface Context {
  tech?: string[] // tech markers seen across the corpus
}

const SEV_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }

// Select the subset of rules to compile+run. Pure + metadata-only, so it works over any rule shape
// (declarative/chain/probe all structurally satisfy RuleMeta) BEFORE anything is compiled.
export function selectRules<T extends RuleMeta>(rules: T[], sel: Selection = {}, ctx: Context = {}): T[] {
  const want = sel.tags?.length ? new Set(sel.tags) : undefined
  const not = sel.excludeTags?.length ? new Set(sel.excludeTags) : undefined
  const cats = sel.categories?.length ? new Set(sel.categories) : undefined
  const min = sel.minSeverity ? SEV_RANK[sel.minSeverity] : undefined
  // tech pre-filter prunes ONLY when the corpus actually carries tech info; unknown tech never prunes
  // (avoid false-negative pruning when fingerprinting is incomplete).
  const ctxTech = ctx.tech?.length ? new Set(ctx.tech.map((t) => t.toLowerCase())) : undefined
  return rules.filter((r) => {
    if (cats && !cats.has(r.category)) return false
    if (min !== undefined && SEV_RANK[r.severity] < min) return false
    const tags = r.tags ?? []
    if (want && !tags.some((t) => want.has(t))) return false
    if (not && tags.some((t) => not.has(t))) return false
    if (r.requires?.tech?.length && ctxTech && !r.requires.tech.some((t) => ctxTech.has(t.toLowerCase()))) return false
    return true
  })
}

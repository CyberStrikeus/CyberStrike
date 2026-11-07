// Corpus rules — the "cross-transaction, as DATA" DSL. A passive `when` rule sees one transaction; an
// aggregate rolls many matches into one finding. A corpus rule asks a question OVER a GROUP of
// transactions: group the corpus by a field, optionally pre-filter the group with a per-transaction
// `where`, then test a `having` predicate that uses the group quantifiers (any / all / count /
// countDistinct — see expr.ts). It emits one signal per qualifying group, anchored to the group's
// first (filtered) transaction. This is what lets access-control rules (an endpoint reached under two
// identities; an authed endpoint also reachable anonymously) be LLM-authorable data, not TypeScript.
//
//   {
//     "id": "cross-identity-access", "category": "access-control", "severity": "low",
//     "corpus": { "groupBy": "endpoint", "where": "resp.status >= 200 && resp.status < 300",
//                 "having": "countDistinct(identity) >= 2", "list": "identity" },
//     "message": "Endpoint reachable under multiple identities — access-control review",
//     "evidence": "{group} reached by: {list}"
//   }
//
// `message`/`evidence` support {group} (the groupBy key), {count} (filtered group size), {list} (the
// deduped, capped distinct values of the `list` field) and {field.path} (over the anchor transaction).
import z from "zod"
import type { Transaction } from "./transaction"
import type { CorpusRule, Signal } from "./rule"
import { compile, compileGroup } from "./expr"
import { fieldValue } from "./fields"
import { RuleMetaShape } from "./rule-meta"

const DEFAULT_LIST_CAP = 50

export const CorpusRuleSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    category: z.string(),
    severity: z.enum(["info", "low", "medium", "high", "critical"]),
    corpus: z
      .object({
        groupBy: z.string().default("endpoint"), // field path the corpus is grouped by
        where: z.string().optional(), // per-transaction prefilter applied within each group
        having: z.string(), // group predicate (quantifiers: any/all/count/countDistinct)
        list: z.string().optional(), // field whose distinct values fill {list} (default: groupBy)
        detail: z.string().optional(), // field whose distinct comma-split tokens, unioned over the group, fill {detail}
        max: z.number().int().positive().optional(),
      })
      .strict(),
    message: z.string().optional(),
    evidence: z.string().optional(),
    ...RuleMetaShape,
  })
  .strict()

export type CorpusRuleDef = z.infer<typeof CorpusRuleSchema>

function interpolate(template: string, anchor: Transaction, extra: { group: string; count: number; list: string; detail: string }): string {
  return template.replace(/\{([^}]+)\}/g, (_, raw) => {
    const path = String(raw).trim()
    if (path === "group") return extra.group
    if (path === "count") return String(extra.count)
    if (path === "list") return extra.list
    if (path === "detail") return extra.detail
    return String(fieldValue(anchor, path) ?? "")
  })
}

// Compile ONE corpus rule into a CorpusRule. Throws (ExprError/zod) at load time on a bad expression.
export function compileCorpusRule(def: CorpusRuleDef): CorpusRule {
  const groupBy = def.corpus.groupBy
  const where = def.corpus.where ? compile(def.corpus.where) : undefined
  const having = compileGroup(def.corpus.having)
  const listField = def.corpus.list ?? groupBy
  const detailField = def.corpus.detail
  const cap = def.corpus.max ?? DEFAULT_LIST_CAP
  return {
    id: def.id,
    title: def.title ?? def.id,
    category: def.category,
    severity: def.severity,
    evaluate(txs: Transaction[]): Signal[] {
      const groups = new Map<string, Transaction[]>()
      for (const tx of txs) {
        const gkey = String(fieldValue(tx, groupBy) ?? "")
        let g = groups.get(gkey)
        if (!g) groups.set(gkey, (g = []))
        g.push(tx)
      }
      const out: Signal[] = []
      for (const [gkey, group] of groups) {
        const filtered = where ? group.filter((tx) => where.test(tx)) : group
        if (filtered.length === 0) continue
        if (!having.test(filtered)) continue
        const anchor = filtered[0]!
        const seen: string[] = []
        const all = new Set<string>()
        const details = new Set<string>()
        for (const tx of filtered) {
          const v = String(fieldValue(tx, listField) ?? "")
          if (v && !all.has(v)) {
            all.add(v)
            if (seen.length < cap) seen.push(v)
          }
          if (detailField)
            for (const token of String(fieldValue(tx, detailField) ?? "").split(",").map((s) => s.trim()).filter(Boolean)) details.add(token)
        }
        const overflow = all.size - seen.length
        const list = seen.join(", ") + (overflow > 0 ? `, …(+${overflow} more)` : "")
        // {count} = distinct values of the list field (e.g. affected endpoints), matching rollupByHost's seen.size.
        const extra = { group: gkey, count: all.size, list, detail: [...details].join(", ") }
        out.push({
          ruleId: def.id,
          transactionId: anchor.id,
          severity: def.severity,
          category: def.category,
          title: def.message ? interpolate(def.message, anchor, extra) : def.title ?? def.id,
          evidence: def.evidence ? interpolate(def.evidence, anchor, extra) : list,
          dedupKey: `${def.id}:${gkey}`,
        })
      }
      return out
    },
  }
}

export function compileCorpusRules(defs: CorpusRuleDef[]): CorpusRule[] {
  return defs.map(compileCorpusRule)
}

// Validate + load corpus rules from untrusted input (e.g. an agent's JSON). Throws a zod error on a bad field.
export function parseCorpusRules(input: unknown): CorpusRuleDef[] {
  return z.array(CorpusRuleSchema).parse(input)
}

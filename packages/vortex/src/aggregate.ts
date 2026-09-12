// Aggregate rules — the "one finding, many URLs" DSL. A passive per-transaction rule fires once per
// matching endpoint, so a class that recurs across dozens of URLs (CORS misconfig, a missing security
// header, directory listing) floods the signal set and is un-reportable one-by-one. An aggregate rule
// is still LLM-friendly DATA: the SAME per-transaction `when` expression, plus an `aggregate` block
// that COLLAPSES every matching transaction into ONE signal whose `evidence` enumerates the affected
// endpoints. It compiles to a CorpusRule (cross-transaction), exactly like a chain rule.
//
//   {
//     "id": "cors-origin-reflection-with-credentials", "category": "misconfiguration", "severity": "high",
//     "when": "req.header.origin && resp.header.access-control-allow-origin == req.header.origin && icontains(resp.header.access-control-allow-credentials, \"true\")",
//     "aggregate": { "groupBy": "ruleId", "list": "endpoint" },
//     "message": "CORS reflects Origin + allows credentials on {count} endpoints",
//     "evidence": "Affected: {endpoints}"
//   }
//
// `message`/`evidence` support {field} interpolation over the representative transaction PLUS two
// group-derived tokens: {count} (distinct listed values) and {endpoints} (the deduped, capped list).
import z from "zod"
import type { Transaction } from "./transaction"
import type { CorpusRule, Signal } from "./rule"
import { compile } from "./expr"
import { fieldValue } from "./fields"
import { RuleMetaShape } from "./rule-meta"

const DEFAULT_LIST_CAP = 50 // max endpoints enumerated in one finding; the rest fold into "+N more"

export const AggregateRuleSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    category: z.string(),
    severity: z.enum(["info", "low", "medium", "high", "critical"]),
    when: z.string(), // per-transaction DSL expression — the same vocabulary a passive rule uses
    aggregate: z
      .object({
        // "ruleId" ⇒ ONE finding for the whole rule (all matches collapse together). Otherwise a field
        // path (e.g. "host") ⇒ one finding per distinct value of that field (per-host rollup).
        groupBy: z.string().default("ruleId"),
        // Field path whose distinct values are enumerated in {endpoints} (default the logical endpoint).
        list: z.string().default("endpoint"),
        // Cap on enumerated values per finding; the overflow count still shows via {count}.
        max: z.number().int().positive().optional(),
      })
      .strict(),
    message: z.string().optional(), // signal title; supports {field} + {count} + {endpoints}
    evidence: z.string().optional(), // supports {field} + {count} + {endpoints}
    ...RuleMetaShape, // tags / requires — for selection at scale
  })
  .strict()

export type AggregateRule = z.infer<typeof AggregateRuleSchema>

// Replace {count}/{endpoints} with the group-derived values, then any other {field.path} with the
// representative transaction's value (same vocabulary as the DSL).
function interpolate(template: string, rep: Transaction, extra: { count: number; endpoints: string }): string {
  return template.replace(/\{([^}]+)\}/g, (_, raw) => {
    const path = String(raw).trim()
    if (path === "count") return String(extra.count)
    if (path === "endpoints") return extra.endpoints
    return String(fieldValue(rep, path) ?? "")
  })
}

type Group = { rep: Transaction; items: string[]; seen: Set<string> }

// Compile ONE aggregate rule into a CorpusRule. Throws (ExprError) if `when` is not a valid DSL
// expression — surfaced at load time, not silently ignored. Single pass over the corpus; the only
// unbounded thing (the enumerated list) is capped, so a large corpus can't blow up the signal.
export function compileAggregate(ar: AggregateRule): CorpusRule {
  const q = compile(ar.when)
  const groupBy = ar.aggregate.groupBy
  const listField = ar.aggregate.list
  const cap = ar.aggregate.max ?? DEFAULT_LIST_CAP
  return {
    id: ar.id,
    title: ar.title ?? ar.id,
    category: ar.category,
    severity: ar.severity,
    evaluate(txs: Transaction[]): Signal[] {
      const groups = new Map<string, Group>()
      for (const tx of txs) {
        if (!q.test(tx)) continue
        const gkey = groupBy === "ruleId" ? "" : String(fieldValue(tx, groupBy) ?? "")
        let g = groups.get(gkey)
        if (!g) {
          g = { rep: tx, items: [], seen: new Set() }
          groups.set(gkey, g)
        }
        const item = String(fieldValue(tx, listField) ?? "")
        if (item && !g.seen.has(item)) {
          g.seen.add(item)
          if (g.items.length < cap) g.items.push(item)
        }
      }
      const out: Signal[] = []
      for (const [gkey, g] of groups) {
        const count = g.seen.size
        const overflow = count - g.items.length
        const endpoints = g.items.join(", ") + (overflow > 0 ? `, …(+${overflow} more)` : "")
        const extra = { count, endpoints }
        out.push({
          ruleId: ar.id,
          transactionId: g.rep.id,
          severity: ar.severity,
          category: ar.category,
          title: ar.message ? interpolate(ar.message, g.rep, extra) : `${ar.id} (${count} endpoints)`,
          evidence: ar.evidence ? interpolate(ar.evidence, g.rep, extra) : endpoints,
          // One finding per group: the whole-rule case (groupBy "ruleId") collapses to a single signal.
          dedupKey: `${ar.id}:${gkey}`,
        })
      }
      return out
    },
  }
}

export function compileAggregates(ars: AggregateRule[]): CorpusRule[] {
  return ars.map(compileAggregate)
}

// Validate + load aggregate rules from untrusted input (e.g. an agent's JSON). Returns typed rules or
// throws a zod error naming the bad field.
export function parseAggregates(input: unknown): AggregateRule[] {
  return z.array(AggregateRuleSchema).parse(input)
}

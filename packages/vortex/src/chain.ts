// Chain rules — the correlation DSL for MULTI-STEP (chained) vulnerabilities. A single per-
// transaction `when` can't express "a value that appeared in response A is used in request B": that
// needs correlation across transactions. A chain rule is still LLM-friendly DATA: an ordered list
// of steps, each an HTTPQL `when` over ITS OWN transaction, plus `link`s that JOIN a field of the
// current step to a field of an already-bound earlier step (the shared value that makes it a
// chain). Deterministic — a nested join over the corpus, bounded so it can't blow up.
//
//   {
//     "id": "reset-token-leak-reuse", "category": "auth-session", "severity": "critical",
//     "steps": [
//       { "as": "leak", "when": "resp.body.reset_token:~." },
//       { "as": "use",  "when": "resp.status:200",
//         "link": [{ "field": "req.query.token", "to": "leak.resp.body.reset_token" }] }
//     ],
//     "message": "Reset token leaked by {leak.endpoint} was reused at {use.endpoint}"
//   }
import z from "zod"
import type { Transaction } from "./transaction"
import type { CorpusRule, Signal } from "./rule"
import { compile, fieldValue } from "./httpql"
import { endpointKey } from "./endpoint"
import { sharedValues } from "./taint"

const CANDIDATE_CAP = 500 // per step, guard the join against a pathological corpus
const SIGNAL_CAP = 50

export const ChainRuleSchema = z
  .object({
    id: z.string(),
    category: z.string(),
    severity: z.enum(["info", "low", "medium", "high", "critical"]),
    steps: z
      .array(
        z
          .object({
            as: z.string(), // alias other steps reference (e.g. "leak")
            when: z.string().optional(), // HTTPQL over THIS step's transaction
            link: z
              .array(z.object({ field: z.string(), to: z.string() })) // this.field === <alias.field> (KNOWN field)
              .optional(),
            // VALUE-based join (field-name agnostic): this request reuses a correlatable value that
            // appeared in <alias>'s response — the robust way to find a chain when you don't know
            // (or the app doesn't consistently name) the token/id field across thousands of requests.
            reuses: z.string().optional(),
          })
          .strict(),
      )
      .min(2),
    message: z.string().optional(), // supports {alias.field} interpolation over the bound steps
    evidence: z.string().optional(),
    distinctIdentity: z.boolean().optional(), // require the bound transactions to be different identities (IDOR/privesc chains)
  })
  .strict()

export type ChainRule = z.infer<typeof ChainRuleSchema>

function interpolate(template: string, bindings: Record<string, Transaction>, shared: string): string {
  return template.replace(/\{([^}]+)\}/g, (_, ref) => {
    const path = String(ref).trim()
    if (path === "shared") return shared // the correlated value a `reuses` link matched on
    const dot = path.indexOf(".")
    if (dot === -1) return ""
    const tx = bindings[path.slice(0, dot)]
    return tx ? String(fieldValue(tx, path.slice(dot + 1)) ?? "") : ""
  })
}

// Resolve an "alias.field" reference against the current bindings.
function refValue(ref: string, bindings: Record<string, Transaction>): string | number | undefined {
  const dot = ref.indexOf(".")
  if (dot === -1) return undefined
  const tx = bindings[ref.slice(0, dot)]
  return tx ? fieldValue(tx, ref.slice(dot + 1)) : undefined
}

export function compileChain(rule: ChainRule): CorpusRule {
  const compiled = rule.steps.map((s) => (s.when ? compile(s.when) : undefined))
  return {
    id: rule.id,
    title: rule.id,
    category: rule.category,
    severity: rule.severity,
    evaluate(txs: Transaction[]): Signal[] {
      const out: Signal[] = []

      const solve = (i: number, bindings: Record<string, Transaction>, used: Set<string>, shared: string): void => {
        if (out.length >= SIGNAL_CAP) return
        if (i === rule.steps.length) {
          const last = bindings[rule.steps[rule.steps.length - 1]!.as]!
          const endpoints = rule.steps.map((s) => endpointKey(bindings[s.as]!)).join(" → ")
          out.push({
            ruleId: rule.id,
            transactionId: last.id,
            severity: rule.severity,
            category: rule.category,
            title: rule.message ? interpolate(rule.message, bindings, shared) : `${rule.id}: ${endpoints}`,
            evidence: rule.evidence ? interpolate(rule.evidence, bindings, shared) : shared ? `${endpoints} (shared: ${shared})` : endpoints,
            dedupKey: `${rule.id}:${endpoints}`,
          })
          return
        }
        const step = rule.steps[i]!
        const q = compiled[i]
        let seen = 0
        for (const tx of txs) {
          if (out.length >= SIGNAL_CAP) return
          if (seen >= CANDIDATE_CAP) break
          if (used.has(tx.id)) continue // a transaction fills at most one step
          if (q && !q.test(tx)) continue
          // KNOWN-field links: this step's field must equal a bound earlier step's field.
          if (step.link) {
            let ok = true
            for (const l of step.link) {
              const here = fieldValue(tx, l.field)
              const there = refValue(l.to, bindings)
              if (here === undefined || there === undefined || String(here) !== String(there)) {
                ok = false
                break
              }
            }
            if (!ok) continue
          }
          // VALUE-based link: this request reuses a correlatable value from <reuses>'s response.
          let nextShared = shared
          if (step.reuses) {
            const src = bindings[step.reuses]
            const shared2 = src ? sharedValues(src, tx) : []
            if (shared2.length === 0) continue
            nextShared = shared2[0]!
          }
          seen++
          if (rule.distinctIdentity && Object.values(bindings).some((b) => (b.identity ?? "") === (tx.identity ?? ""))) continue
          solve(i + 1, { ...bindings, [step.as]: tx }, new Set([...used, tx.id]), nextShared)
        }
      }

      solve(0, {}, new Set(), "")
      return out
    },
  }
}

export function parseChains(input: unknown): ChainRule[] {
  return z.array(ChainRuleSchema).parse(input)
}

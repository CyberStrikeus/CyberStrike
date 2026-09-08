// Declarative rules — the LLM-friendly rule DSL. A rule is DATA, not code: an HTTPQL `when` query
// plus a signal template. An agent can author or read one at a glance and emit it as JSON, so
// detection logic can be added without writing TypeScript.
//
//   { "id": "sql-error", "category": "injection", "severity": "high",
//     "when": "resp.body:~\"SQL syntax\" OR resp.body:~\"SQLSTATE\"",
//     "message": "SQL error signature in {endpoint}", "dedupBy": "endpoint" }
//
// `when` is HTTPQL (same field vocabulary as queries); `message`/`evidence` support {field}
// interpolation. compileRule() turns one into a normal per-transaction Rule, so declarative and
// hand-written rules run through the exact same engine.
import z from "zod"
import type { Rule, Signal } from "./rule"
import { compile, fieldValue } from "./httpql"

export const DeclarativeRuleSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    category: z.string(),
    severity: z.enum(["info", "low", "medium", "high", "critical"]),
    when: z.string(), // HTTPQL query — the rule fires on a transaction it matches
    message: z.string().optional(), // signal title; supports {field} interpolation
    evidence: z.string().optional(), // supports {field} interpolation
    dedupBy: z.string().optional(), // a field path to collapse on (e.g. "endpoint"); default per (rule, tx)
  })
  .strict()

export type DeclarativeRule = z.infer<typeof DeclarativeRuleSchema>

// Replace {field.path} with the transaction's value for that field (same vocabulary as HTTPQL).
function interpolate(template: string, tx: Parameters<Rule["evaluate"]>[0]): string {
  return template.replace(/\{([^}]+)\}/g, (_, path) => String(fieldValue(tx, String(path).trim()) ?? ""))
}

// Compile ONE declarative rule into a per-transaction Rule. Throws (QueryError) if `when` is not
// valid HTTPQL — surfaced at load time, not silently ignored.
export function compileRule(dr: DeclarativeRule): Rule {
  const q = compile(dr.when)
  return {
    id: dr.id,
    title: dr.title ?? dr.id,
    category: dr.category,
    severity: dr.severity,
    evaluate(tx) {
      if (!q.test(tx)) return []
      const dedupKey = dr.dedupBy ? `${dr.id}:${fieldValue(tx, dr.dedupBy) ?? ""}` : undefined
      const sig: Signal = {
        ruleId: dr.id,
        transactionId: tx.id,
        severity: dr.severity,
        category: dr.category,
        title: dr.message ? interpolate(dr.message, tx) : (dr.title ?? dr.id),
        evidence: dr.evidence ? interpolate(dr.evidence, tx) : undefined,
        dedupKey,
      }
      return [sig]
    },
  }
}

export function compileRules(drs: DeclarativeRule[]): Rule[] {
  return drs.map(compileRule)
}

// Validate + load declarative rules from untrusted input (e.g. an agent's JSON). Returns typed
// rules or throws a zod error naming the bad field.
export function parseRules(input: unknown): DeclarativeRule[] {
  return z.array(DeclarativeRuleSchema).parse(input)
}

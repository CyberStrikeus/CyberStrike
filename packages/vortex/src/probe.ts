// ProbeRule — the ACTIVE declarative rule (the DSL's third shape). Where DeclarativeRule matches a
// captured response and ChainRule correlates, a ProbeRule SENDS: pick candidate transactions
// (`select` = HTTPQL), inject a payload into a parameter (`inject`), send it, and fire when the
// probe's response matches (`detect` = HTTPQL over the response, or the literal "reflected" = the
// canary bounced back). It compiles to an ActiveRule, so it runs through the same send()/canary
// machinery — this is inject-probe's playbooks expressed as LLM-readable data.
//
//   { "id": "reflected-xss", "category": "injection", "severity": "medium",
//     "select": "resp.bodyKind:html AND req.query.q:*",
//     "inject": { "into": "query", "name": "q", "payloads": ["<vx>{canary}</vx>"], "canary": true },
//     "detect": "reflected", "message": "reflected input at {endpoint} (q)" }
import z from "zod"
import type { ActiveRule, Sender } from "./active"
import type { Signal } from "./rule"
import { compile, fieldValue } from "./httpql"
import { endpointKey } from "./endpoint"
import { brokeOut } from "./canary"
import type { Apply } from "./send"

export const ProbeRuleSchema = z
  .object({
    id: z.string(),
    category: z.string(),
    severity: z.enum(["info", "low", "medium", "high", "critical"]),
    select: z.string(), // HTTPQL — which captured transactions to probe
    inject: z
      .object({
        into: z.enum(["query", "body", "header"]),
        name: z.string(), // the parameter/header to inject into
        payloads: z.array(z.string()).min(1), // may contain {canary}
        canary: z.boolean().optional(), // track a canary + enable detect:"reflected"
      })
      .strict(),
    detect: z.string(), // HTTPQL over the PROBE response, or the literal "reflected"
    message: z.string().optional(),
  })
  .strict()

export type ProbeRule = z.infer<typeof ProbeRuleSchema>

function mutationFor(inject: ProbeRule["inject"], payload: string): Apply.Mutation {
  if (inject.into === "query") return { op: "set-query", name: inject.name, value: payload }
  if (inject.into === "header") return { op: "set-header", name: inject.name, value: payload }
  return { op: "body-set-field", name: inject.name, value: payload } // body (JSON field)
}

function interpolate(template: string, tx: Parameters<Sender>[0]): string {
  return template.replace(/\{([^}]+)\}/g, (_, path) => String(fieldValue(tx as never, String(path).trim()) ?? ""))
}

export function compileProbe(rule: ProbeRule): ActiveRule {
  const selectQ = compile(rule.select)
  const detectReflected = rule.detect === "reflected"
  const detectQ = detectReflected ? undefined : compile(rule.detect)
  return {
    id: rule.id,
    title: rule.id,
    category: rule.category,
    severity: rule.severity,
    async probe(txs, send: Sender): Promise<Signal[]> {
      const out: Signal[] = []
      const seen = new Set<string>() // one probe set per endpoint — no fan-out
      for (const tx of txs) {
        if (!selectQ.test(tx)) continue
        const key = endpointKey(tx)
        if (seen.has(key)) continue
        seen.add(key)
        for (const payload of rule.inject.payloads) {
          const res = await send(tx, {
            mutations: [mutationFor(rule.inject, payload)],
            canary: rule.inject.canary ? { field: rule.inject.name, vulnClass: rule.category } : undefined,
          })
          const hit = detectReflected ? !!res.canaryReflected : !!detectQ?.test(res.transaction)
          if (!hit) continue
          // Reflected leads: if the payload's markup survived UNescaped, it's likely injectable —
          // elevate the severity (a bare reflection stays at the rule's declared level).
          const injectable = detectReflected && res.canary ? brokeOut(res.transaction.response?.body, payload, res.canary.token) : false
          out.push({
            ruleId: rule.id,
            transactionId: res.transaction.id,
            severity: injectable ? "high" : rule.severity,
            category: rule.category,
            title: rule.message ? interpolate(rule.message, res.transaction) : `${rule.id} at ${key}`,
            evidence: injectable
              ? `payload into ${rule.inject.into}.${rule.inject.name} on ${key} — markup reflected UNESCAPED (likely injectable)`
              : `payload into ${rule.inject.into}.${rule.inject.name} on ${key}`,
            dedupKey: `${rule.id}:${key}`,
          })
          break // one confirmation per endpoint is enough
        }
      }
      return out
    },
  }
}

export function compileProbes(rules: ProbeRule[]): ActiveRule[] {
  return rules.map(compileProbe)
}

export function parseProbes(input: unknown): ProbeRule[] {
  return z.array(ProbeRuleSchema).parse(input)
}

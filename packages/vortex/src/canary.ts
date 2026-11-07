// Canary correlation — the reflection/injection tracker, ported to Vortex's model. A canary is a
// unique marker embedded in a request; every later OBSERVED response is scanned for it. A token
// injected at request A that surfaces in a DIFFERENT response B is a STORED (second-order)
// reflection — the hardest injection case, invisible to a single-response check. Same-request
// reflection is ordinary and handled at send time (SendResult.canaryReflected), NOT here.
//
// Edge cases handled: (1) same-request hits excluded from "stored" (they're not); (2) unique
// low-collision tokens so an incidental substring match is implausible; (3) only OBSERVED responses
// are scanned — an agent's own replay echo never counts as the app reflecting it; (4) `template`
// canaries carry the EVALUATED marker (e.g. "49" from {{7*7}}) so a hit proves engine evaluation.
import type { Transaction } from "./transaction"
import type { Signal } from "./rule"
import { endpointKey } from "./endpoint"
import { isObserved } from "./scope"

// reflect/template are scanned HERE (body substring — see scanCanaries). callback (OOB/SSRF),
// file (traversal marker on disk) and log (log injection) need an EXTERNAL signal — an interactsh-
// style collaborator or a log/file reader — which is a separate Vortex module (not yet built); a
// canary of those kinds is minted and recorded but scanCanaries does not resolve it.
export type CanaryKind = "reflect" | "template" | "callback" | "file" | "log"

// Where a reflected token landed in the response. A pragmatic heuristic (not a real HTML parser),
// enough to route a reflection to the right follow-up: html-text/script are directly injectable,
// an attribute needs an attribute breakout, a comment needs `-->` first.
export type ReflectionContext = "html-text" | "attribute" | "attribute-unquoted" | "script" | "comment" | "unknown"

export interface Canary {
  token: string
  kind: CanaryKind
  originRequestId: string // the transaction the payload was injected at (a replay, usually)
  endpoint: string
  field?: string
  vulnClass?: string
  agent?: string
  createdAt: number
}

let counter = 0
// Unique, low-collision token: `cs` + time + counter + random, all base36. Alphanumeric, so it
// survives HTML/URL encoding unchanged — a raw substring match is enough to detect reflection.
export function mintCanary(): string {
  counter = (counter + 1) % 0xffffff
  return `cs${Date.now().toString(36)}${counter.toString(36).padStart(4, "0")}${Math.random().toString(36).slice(2, 6)}`
}

export function reflects(body: string | undefined, token: string): boolean {
  return !!body && body.includes(token)
}

// Classify WHERE the token first reflects, so a bare "reflected" lead can be routed to the right
// XSS follow-up (or scored). Heuristic: locate the nearest enclosing structure by scanning back
// from the hit for an unclosed <script>, <!-- comment -->, or open tag.
export function reflectionContext(body: string, token: string): ReflectionContext {
  const idx = body.indexOf(token)
  if (idx < 0) return "unknown"
  const lower = body.toLowerCase()
  if (lower.lastIndexOf("<script", idx) > lower.lastIndexOf("</script", idx)) return "script"
  if (body.lastIndexOf("<!--", idx) > body.lastIndexOf("-->", idx)) return "comment"
  const openTag = body.lastIndexOf("<", idx)
  if (openTag > body.lastIndexOf(">", idx)) {
    // Inside a tag — is the token in a quoted attribute value, or unquoted? An ODD number of quotes
    // between the tag open and the token means we're inside a still-open quote (robust to '=' in the
    // attribute value, e.g. href="/x?q=…").
    const region = body.slice(openTag, idx)
    if ((region.match(/"/g) || []).length % 2 === 1 || (region.match(/'/g) || []).length % 2 === 1) return "attribute"
    if (region.includes("=")) return "attribute-unquoted"
    return "attribute"
  }
  return "html-text"
}

// Did the payload's STRUCTURAL markup survive unescaped? Reconstruct the exact payload that was
// sent (canary token substituted for {canary}) and look for it verbatim — if `<`, `>`, `"` reflect
// intact, the reflection is likely INJECTABLE, not merely present. Upgrades a lead to a finding.
export function brokeOut(body: string | undefined, payload: string, token: string): boolean {
  if (!body) return false
  const raw = payload.split(CANARY_PLACEHOLDER).join(token)
  if (raw === token) return false // payload was the bare token — no surrounding markup to break out of
  return /[<>"'`]/.test(payload) && body.includes(raw)
}

// A template-injection canary: two 5-digit factors whose PRODUCT is a 9-10 digit number unlikely to
// appear incidentally, so a response containing `marker` proves the template engine EVALUATED the
// expression (unlike the classic {{7*7}}→49, which collides with any "49" already on the page). The
// caller wraps `expr` in the engine's syntax ({{…}} / ${…} / #{…}) and matches `marker` in the body.
export interface TemplateCanary {
  expr: string
  marker: string
}
export function mintTemplateCanary(): TemplateCanary {
  const a = 10000 + Math.floor(Math.random() * 90000)
  const b = 10000 + Math.floor(Math.random() * 90000)
  return { expr: `${a}*${b}`, marker: String(a * b) }
}

// The placeholder a caller puts in a payload where the minted token should go: value "…{canary}…".
export const CANARY_PLACEHOLDER = "{canary}"

// The placeholder for a TEMPLATE canary's expression (SSTI): a payload like "{{ {template} }}" gets
// {template} replaced by mintTemplateCanary().expr, and the response is checked for its `marker`.
export const TEMPLATE_PLACEHOLDER = "{template}"

// Build the Canary record for a token injected at a transaction.
export function canaryFor(token: string, tx: Transaction, opts: { kind?: CanaryKind; field?: string; vulnClass?: string; agent?: string } = {}): Canary {
  return {
    token,
    kind: opts.kind ?? "reflect",
    originRequestId: tx.id,
    endpoint: endpointKey(tx),
    field: opts.field,
    vulnClass: opts.vulnClass,
    agent: opts.agent,
    createdAt: Date.now(),
  }
}

// A stored reflection's exploitability depends on WHERE it lands: html-text/script are directly
// injectable (high), a comment or unknown spot is weaker (low), an attribute sits between (medium).
const CONTEXT_SEVERITY: Record<ReflectionContext, Signal["severity"]> = {
  "html-text": "high",
  script: "high",
  attribute: "medium",
  "attribute-unquoted": "high", // unquoted attr → space breaks out without a quote
  comment: "low",
  unknown: "low",
}

// Scan OBSERVED responses for registered canaries. Emits a stored_reflection signal per canary that
// appears in a DIFFERENT transaction than it was injected at. Cross-request only — same-request
// reflection is not "stored". Observed-only — a replay echo is never the app reflecting the token.
export function scanCanaries(txs: Transaction[], canaries: Canary[]): Signal[] {
  const out: Signal[] = []
  for (const tx of txs) {
    if (!isObserved(tx)) continue
    const body = tx.response?.body
    if (!body) continue
    for (const c of canaries) {
      if (tx.id === c.originRequestId) continue // same request → not stored
      if (!reflects(body, c.token)) continue
      const ctx = reflectionContext(body, c.token)
      out.push({
        ruleId: "stored-reflection",
        transactionId: tx.id,
        severity: CONTEXT_SEVERITY[ctx],
        category: "injection",
        title: `Stored reflection (${ctx}): canary from ${c.endpoint}${c.field ? ` (${c.field})` : ""} renders at ${endpointKey(tx)}`,
        evidence: `token ${c.token} injected at ${c.endpoint} appears in the ${ctx} of ${endpointKey(tx)}'s response`,
        dedupKey: `stored-reflection:${c.token}:${endpointKey(tx)}`,
      })
    }
  }
  return out
}

// Pure JS-bundle secret scanner (P4.2, design §5). Deterministic — no LLM. Finds hardcoded
// secrets/keys/tokens in JS source (bundles or source-map sourcesContent). High-precision, known-
// format rules only (plus ONE conservative assignment rule) — a full entropy scanner is FP-prone
// and deliberately not built here. Every value is REDACTED before it leaves this module (preview =
// first4…last4 + length): the raw secret is never stored, logged, prompted, or committed.
export namespace JsSecrets {
  export interface Secret {
    type: string // e.g. "aws-access-key-id", "google-api-key", "jwt"
    preview: string // redacted: first4…last4 (length) — NEVER the full value
    index: number // char offset in the scanned text (for locating)
  }

  // Detection rules (single source — extend HERE, not at call sites). `group` picks the capture
  // holding the secret value (default: the whole match). High-precision, known formats.
  const RULES: { type: string; re: RegExp; group?: number }[] = [
    { type: "aws-access-key-id", re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/g },
    { type: "aws-secret-access-key", re: /\baws_?secret_?access_?key["']?\s*[:=]\s*["']([A-Za-z0-9/+]{40})["']/gi, group: 1 },
    { type: "google-api-key", re: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
    { type: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b/g },
    { type: "slack-token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,48}\b/g },
    { type: "slack-webhook", re: /\bhttps:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g },
    { type: "stripe-secret-key", re: /\bsk_(?:live|test)_[0-9A-Za-z]{24,}\b/g },
    { type: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
    { type: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\b/g },
    // Conservative catch-all: a sensitive-named field assigned a non-trivial string literal.
    {
      type: "generic-secret-assignment",
      re: /\b(?:api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|private[_-]?token)["']?\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
      group: 1,
    },
  ]

  const CAP = 100 // bound how many secrets one scan reports

  // Redact a value to a locate-able, non-leaking preview. Short values are fully masked.
  export function redact(v: string): string {
    if (v.length <= 8) return "•".repeat(v.length)
    return `${v.slice(0, 4)}…${v.slice(-4)} (${v.length} chars)`
  }

  // Scan text for secrets. Deduped by VALUE (a value is one secret regardless of how many rules
  // match); the first rule in table order labels it. Pure + deterministic.
  export function scan(text: string): Secret[] {
    const out: Secret[] = []
    const seenValue = new Set<string>()
    for (const rule of RULES) {
      rule.re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = rule.re.exec(text))) {
        const value = rule.group ? m[rule.group] : m[0]
        if (!value || seenValue.has(value)) continue
        seenValue.add(value)
        out.push({ type: rule.type, preview: redact(value), index: m.index })
        if (out.length >= CAP) return out
      }
    }
    return out.sort((a, b) => a.index - b.index)
  }
}

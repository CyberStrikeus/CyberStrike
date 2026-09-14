// mineInto — the store-integration side of jsmine (Enterprise). Mines a JS body and writes the
// result into a Vortex store: endpoints / jsUrls / tech go through core `ingestExtract` (generic
// discovery), while mined secrets are emitted as info-disclosure `Signal`s so they converge with
// rule-produced signals (#15) and are queryable the same way (signals()/HTTPQL).
//
// Secret persistence lives HERE, not in core: the AGPL core deliberately leaves `Extract.secrets`
// unpersisted ("a future findings store"); this Enterprise add-on is that store's producer.
import type { TrafficStore, Signal } from "@cyberstrike-io/vortex"
import { ingestExtract } from "@cyberstrike-io/vortex"
import { mine, type MineOptions } from "./jsmine"

// Label a mined secret by its shape (for signal evidence). Ordered most-specific first; must stay in
// sync with the SECRET_PATTERNS / ASSIGN_RE shapes in jsmine.ts (see test/secret-quality.test.ts).
function secretKind(s: string): string {
  if (s.startsWith("-----BEGIN")) return "private-key"
  if (/^(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[0-9A-Z]{16}/.test(s)) return "aws-access-key"
  if (/^aws[_-]?secret[_-]?access[_-]?key/i.test(s)) return "aws-secret-access-key"
  if (s.startsWith("AIza")) return "google-api-key"
  if (s.startsWith("GOCSPX-")) return "google-oauth-secret"
  if (s.endsWith("apps.googleusercontent.com")) return "google-oauth-client"
  if (s.startsWith("https://hooks.slack.com/")) return "slack-webhook"
  if (s.startsWith("xox")) return "slack-token"
  if (/^(?:sk|pk|rk)_(?:live|test)_/.test(s)) return "stripe-key"
  if (s.startsWith("github_pat_")) return "github-fine-grained-pat"
  if (/^gh[pousr]_/.test(s)) return "github-token"
  if (s.startsWith("glpat-")) return "gitlab-token"
  if (s.startsWith("npm_")) return "npm-token"
  if (/^sk-[0-9A-Za-z]{48}/.test(s)) return "openai-key"
  if (/^SG\.[0-9A-Za-z_-]{22}\./.test(s)) return "sendgrid-key"
  if (/^SK[0-9a-f]{32}/.test(s)) return "twilio-api-key"
  if (/^key-[0-9a-f]{32}/.test(s)) return "mailgun-key"
  if (s.startsWith("dop_v1_")) return "digitalocean-token"
  if (s.startsWith("shpat_")) return "shopify-token"
  if (s.startsWith("eyJ")) return "jwt"
  if (/^(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqps?|ftp|https?):\/\/[^\s:@/]+:[^\s:@/]+@/.test(s)) return "connection-string-credentials"
  return "hardcoded-credential"
}

// Redact for display: short prefix + length so the finding is identifiable and locatable without
// duplicating the cleartext secret into the signal layer (the raw value stays in the source body).
function redact(s: string): string {
  return `${s.slice(0, 4)}…(${s.length} chars)`
}

export function mineInto(store: TrafficStore, transactionId: string, text: string, opts: MineOptions = {}): { discovered: number; tech: number; secrets: number } {
  const extract = mine(text, opts)
  const base = ingestExtract(store, transactionId, extract) // endpoints + jsUrls + tech (core)
  let secrets = 0
  if (extract.secrets.length) {
    const sigs: Signal[] = extract.secrets.map((s) => ({
      ruleId: "jsmine-secret",
      transactionId,
      severity: "high",
      category: "info-disclosure",
      title: `Hardcoded ${secretKind(s)} in script body`,
      evidence: redact(s),
      dedupKey: `jsmine-secret:${transactionId}:${s}`,
    }))
    secrets = store.addSignals(sigs)
  }

  // Source maps disclosed by a script's sourceMappingURL — a low-severity info-disclosure lead: the
  // .map (if served) reconstructs the original, un-minified source. Reported separately from the
  // secret findings so a reviewer sees the exposed-source-map surface at a glance.
  const maps = extract.jsUrls.filter((u) => /\.(?:m?js)\.map(?:$|[?#])/i.test(u))
  if (maps.length) {
    store.addSignals(
      maps.map((m) => ({
        ruleId: "jsmine-sourcemap",
        transactionId,
        severity: "low" as const,
        category: "info-disclosure",
        title: "Source map referenced (verify it is served)",
        evidence: m,
        dedupKey: `jsmine-sourcemap:${m}`,
      })),
    )
  }
  return { discovered: base.discovered, tech: base.tech, secrets }
}

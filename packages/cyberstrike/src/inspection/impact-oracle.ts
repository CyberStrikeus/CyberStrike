import { Vulnerability } from "@/session/vulnerability"
import { Request } from "@/session/request"
import { EscalationCatalog } from "./escalation-catalog"

// Code-enforced impact gate (#90). A finding is a CLAIM; this decides, from the captured evidence, what
// the finding actually PROVES — never the reporting agent's narrative. The triager can run PoCs but under
// load it rubber-stamps, so acceptance/severity must live HERE, in code, for every finding.
//
// Core principle: "the PoC reproduced" (a response came back) ≠ "the vuln triggered" (the security
// boundary was crossed). Each class has its own observable for the latter; without it there is no
// high/critical finding. The oracle is a CLASSIFIER, not a boolean — it can PROVE, DOWNGRADE (reassign to
// a lower-impact class + severity), or leave INSUFFICIENT (cap until proof is produced).
//
// Phase 1 (this file) decides deterministically from the already-captured HTTP evidence — enough to kill
// the false positives seen in the wild (open-redirect that stays on-site/IdP, XSS that only reflects,
// auth findings with no differential). Phase 2 adds a headless-browser execution canary for real XSS;
// Phase 3 adds code-defined business-logic end-state predicates. Both PRODUCE a signal; the verdict stays
// here in code.
export namespace ImpactOracle {
  type Severity = Vulnerability.Info["severity"]

  export interface Verdict {
    // proven: the impact observable is present → keep the claimed class/severity.
    // downgraded: a lower-impact reality is proven (e.g. reflected-but-not-executed) → reassign severity.
    // insufficient: the required observable is absent AND not producible here → cap, do not confirm high.
    // unmodeled: no oracle for this class → leave the finding untouched (don't harm what we don't model).
    verdict: "proven" | "downgraded" | "insufficient" | "unmodeled"
    severity?: Severity // present for downgraded/insufficient — the capped severity
    reason: string
  }

  // Legitimate identity-provider / well-known redirect hosts: a post-login 302 to one of these is the
  // app's INTENDED flow, not an attacker-controlled open redirect.
  const IDP_HOSTS =
    /(^|\.)(google|googleapis|gstatic|accounts\.google|microsoftonline|microsoft|live|okta|auth0|onelogin|pingidentity|github|githubusercontent|gitlab|facebook|apple|appleid|amazon|amazoncognito|linkedin|slack|duosecurity)\.[a-z.]+$/i

  function hostOf(value: string | undefined): string | undefined {
    if (!value) return undefined
    try {
      return new URL(value, "https://placeholder.invalid").hostname.toLowerCase() || undefined
    } catch {
      return undefined
    }
  }

  // Registrable-domain-ish comparison (last two labels). Good enough to tell app.x.com from evil.com
  // without pulling an eTLD list; www/app/api subdomains of the same base read as on-site.
  function baseDomain(host: string): string {
    const parts = host.split(".")
    return parts.slice(-2).join(".")
  }
  function sameSite(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b) return false
    return baseDomain(a) === baseDomain(b)
  }

  // The primary class for the oracle — the most specific impact-bearing class present.
  const PRIORITY = ["open-redirect", "xss", "idor", "bfla", "authz", "jwt", "ssrf", "injection"]
  function primaryClass(v: Vulnerability.Info): string | undefined {
    const classes = new Set(EscalationCatalog.classify(v))
    return PRIORITY.find((c) => classes.has(c))
  }

  // Load the captured responses backing a finding (its evidence requests).
  function evidence(sessionID: string, v: Vulnerability.Info): Request.Info[] {
    return v.evidence_request_ids?.length ? Request.getByIds(sessionID, v.evidence_request_ids) : []
  }

  function headerOf(req: Request.Info, name: string): string | undefined {
    const h = req.response_headers
    if (!h) return undefined
    const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase())
    return key ? h[key] : undefined
  }

  // ── open redirect ────────────────────────────────────────────────────────────────────────────────
  // PROVEN only if a captured response REALIZES a redirect to an off-site, non-IdP host. A param that is
  // merely accepted / stored in a cookie, or a 302 that stays on-site or goes to the intended IdP, is NOT
  // an open redirect — it downgrades to a low "unvalidated redirect parameter" note.
  function oracleOpenRedirect(reqs: Request.Info[]): Verdict {
    for (const r of reqs) {
      const status = r.response_status
      if (status === undefined || status < 300 || status >= 400) continue
      const loc = headerOf(r, "location")
      const locHost = hostOf(loc)
      if (!locHost) continue
      const reqHost = hostOf(r.origin) ?? hostOf(r.normalized_path)
      if (sameSite(locHost, reqHost)) continue // on-site redirect — not attacker-controlled
      if (IDP_HOSTS.test(locHost)) continue // intended identity provider — the real login flow
      return { verdict: "proven", reason: `realized ${status} redirect to off-site host ${locHost} (${loc})` }
    }
    return {
      verdict: "downgraded",
      severity: "low",
      reason:
        "the redirect parameter is accepted/stored but no captured response realizes a redirect to an attacker-controlled off-site host (it stays on-site or goes to the intended IdP). Unvalidated-redirect-parameter hygiene issue, not an exploitable open redirect.",
    }
  }

  // ── XSS ──────────────────────────────────────────────────────────────────────────────────────────
  // Reflection/stored-string ≠ XSS. Phase 1 has no browser, so HTTP evidence can prove at most that input
  // is reflected; it cannot prove EXECUTION. Without an execution signal the finding downgrades to a low
  // improper-input-validation issue; Phase 2 (browser execution canary) re-promotes a truly executing XSS.
  function oracleXss(): Verdict {
    return {
      verdict: "downgraded",
      severity: "low",
      reason:
        "input reflection/storage is captured but script EXECUTION is not confirmed (no DOM render/execution evidence). Improper input validation (low) until a headless-browser execution canary proves the payload executes in page context.",
    }
  }

  // ── auth bypass / JWT forgery / IDOR / BFLA / authz ────────────────────────────────────────────────
  // The impact is "a forged/other identity obtained access a baseline was denied". That REQUIRES a
  // differential: at least two captured responses showing the exploit SUCCEEDED (2xx with data) where the
  // baseline did NOT (401/403/empty/different). A single captured response (input accepted, cookie set,
  // one 2xx) proves acceptance, not access — insufficient for high/critical.
  function oracleAccess(reqs: Request.Info[]): Verdict {
    const withResp = reqs.filter((r) => r.response_status !== undefined)
    const success = withResp.filter((r) => r.response_status! >= 200 && r.response_status! < 300)
    const denied = withResp.filter((r) => r.response_status! === 401 || r.response_status! === 403)
    if (success.length > 0 && denied.length > 0) {
      return {
        verdict: "proven",
        reason: `differential present: ${success.length} response(s) granted access (2xx) where ${denied.length} baseline response(s) were denied (401/403)`,
      }
    }
    return {
      verdict: "insufficient",
      severity: "low",
      reason:
        "no access differential in the evidence — the input is accepted (cookie set / 2xx) but there is no captured baseline denial proving the forged/other identity gained access a legitimate request was refused. Enforcement may be downstream. Capped until a forged-vs-baseline differential is supplied.",
    }
  }

  // Pure core: what does this finding's captured evidence actually prove? Deterministic, no I/O — the
  // `reqs` are the finding's evidence responses. Exposed so it is unit-testable without a DB.
  export function evaluate(v: Vulnerability.Info, reqs: Request.Info[]): Verdict {
    const cls = primaryClass(v)
    if (!cls) return { verdict: "unmodeled", reason: "no impact oracle for this finding's class" }
    if (cls === "open-redirect") return oracleOpenRedirect(reqs)
    if (cls === "xss") return oracleXss()
    if (cls === "idor" || cls === "bfla" || cls === "authz" || cls === "jwt") return oracleAccess(reqs)
    return { verdict: "unmodeled", reason: `impact oracle for "${cls}" not yet implemented` }
  }

  // The gate: load the finding's evidence responses, then evaluate. Used by the deterministic triage pass.
  export function proveImpact(sessionID: string, v: Vulnerability.Info): Verdict {
    return evaluate(v, evidence(sessionID, v))
  }
}

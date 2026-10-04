import type { Vulnerability } from "@/session/vulnerability"

// Escalation pattern catalog (P2 seed, docs/correlation-hunter-agent.md). Code matches the session's
// findings against these patterns and SEEDS the frontier with the obvious chains — so even a lazy model
// cannot miss them; the model then works + extends them. Data-shaped so it can later move to a loadable
// pack (enterprise-extensible). Every seed is still a hypothesis the hunter must PROVE by replay.
export namespace EscalationCatalog {
  // Classify a finding into coarse primitive classes from its title/cwe/description. Heuristic on
  // purpose — a false positive just seeds a hypothesis the hunter fails to confirm (cheap); a miss is
  // the real cost, so the keyword nets are generous.
  export function classify(v: Pick<Vulnerability.Info, "title" | "cwe_id" | "description" | "endpoint">): string[] {
    const t = `${v.title} ${v.cwe_id ?? ""} ${v.description ?? ""}`.toLowerCase()
    const has = (...k: string[]) => k.some((x) => t.includes(x))
    const out = new Set<string>()
    if (has("info", "disclosure", "leak", "verbose error", "stack trace", "path disclosure", "banner")) out.add("info-disclosure")
    if (has("ssrf", "server-side request", "server side request")) out.add("ssrf")
    if (has("idor", "bola", "insecure direct object", "object reference")) out.add("idor")
    if (has("bfla", "function level", "forced browsing", "privilege escalation", "privesc")) out.add("bfla")
    if (has("authoriz", "access control", "broken access", "tenant", "cross-identity", "cross identity")) out.add("authz")
    if (has("open redirect", "redirect")) out.add("open-redirect")
    if (has("cors", "cross-origin")) out.add("cors")
    if (has("xss", "cross-site scripting", "cross site scripting")) out.add("xss")
    if (has("sql", "sqli", "injection")) out.add("injection")
    if (has("xxe", "xml external")) out.add("xxe")
    if (has("jwt", "json web token", "alg", "kid")) out.add("jwt")
    if (has("outdated", "vulnerable component", "known cve", "cve-", "end-of-life", "eol")) out.add("vulnerable-component")
    if (has("oauth", "oidc", "openid", "auth-code", "authorization code")) out.add("oauth")
    if (has("predictable", "sequential id", "enumerab")) out.add("predictable-id")
    return [...out]
  }

  interface Pattern {
    id: string
    requires: string[] // ALL must be present somewhere in the finding set
    impact: string
    say: string // the hypothesis text (the required classes are substituted by the matched finding ids)
  }

  // Seed set — "primitive(s) present → escalated attack to attempt". Chains need ≥2 primitives; a few
  // single-primitive entries lift severity in place.
  const CATALOG: Pattern[] = [
    { id: "ssrf-internal", requires: ["info-disclosure", "ssrf"], impact: "internal RCE / cloud-metadata", say: "pivot the internal host leaked by the info-disclosure into the SSRF to reach an internal service / cloud metadata" },
    { id: "idor-mass", requires: ["idor", "predictable-id"], impact: "mass data exfiltration", say: "enumerate the predictable ids against the IDOR object to bulk-exfiltrate other tenants' data" },
    { id: "idor-alone", requires: ["idor"], impact: "cross-tenant / admin object access", say: "escalate the IDOR from a peer object to an ADMIN/cross-tenant object" },
    { id: "redirect-oauth", requires: ["open-redirect", "oauth"], impact: "account takeover", say: "abuse the open redirect in the OAuth/OIDC auth-code flow to steal the code/token → account takeover" },
    { id: "cors-token", requires: ["cors", "xss"], impact: "authenticated token/response exfiltration", say: "use the XSS + permissive credentialed CORS to read authenticated responses / exfiltrate the token" },
    { id: "bfla-privesc", requires: ["bfla", "idor"], impact: "tenant/admin takeover", say: "combine the BFLA admin function with the IDOR to escalate privilege to tenant/admin takeover" },
    { id: "vulncomp-cve", requires: ["vulnerable-component"], impact: "known-CVE exploitation", say: "exploit the known CVE of the detected vulnerable component against a reachable sink" },
    { id: "error-injection", requires: ["info-disclosure", "injection"], impact: "DB / command access", say: "use the verbose error/stack trace to guide the injection toward DB/command access" },
    { id: "jwt-authz", requires: ["jwt", "authz"], impact: "authz-wide bypass", say: "forge identity via the JWT weakness to bypass the authorization checks app-wide" },
  ]

  // Generate seed hypotheses for a finding set: for each pattern whose required classes are ALL present,
  // one hypothesis referencing a representative finding per required class. Bounded (one per pattern).
  export function seeds(findings: Vulnerability.Info[]): { from: string[]; hypothesis: string; targetImpact: string }[] {
    const byClass = new Map<string, Vulnerability.Info[]>()
    for (const v of findings) for (const c of classify(v)) (byClass.get(c) ?? byClass.set(c, []).get(c)!).push(v)
    const out: { from: string[]; hypothesis: string; targetImpact: string }[] = []
    for (const p of CATALOG) {
      if (!p.requires.every((c) => byClass.has(c))) continue
      const reps = p.requires.map((c) => byClass.get(c)![0]!)
      const from = [...new Set(reps.map((r) => r.id).filter((id): id is string => !!id))]
      const refs = reps.map((r) => `${r.title}${r.endpoint ? ` (${r.endpoint})` : ""}`).join(" + ")
      out.push({ from, hypothesis: `${p.say} — from: ${refs}`, targetImpact: p.impact })
    }
    return out
  }
}

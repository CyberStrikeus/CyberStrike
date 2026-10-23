import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import z from "zod"
import { Log } from "@/util/log"
import type { Vulnerability } from "@/session/vulnerability"

const log = Log.create({ service: "escalation-catalog" })

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
    // Cloud primitives — IAM, storage, compute, network, serverless misconfigurations found by cloud assessments.
    if (has("iam", "rbac", "role assignment", "policy", "permission", "principal", "managed identity", "service account")) out.add("iam-misconfig")
    if (has("public bucket", "public endpoint", "public ip", "public access", "anonymous access", "public blob", "public storage", "open to internet", "publicly accessible")) out.add("public-exposure")
    if (has("privilege escalation", "privesc", "passrole", "assume role", "impersonat", "elevat")) out.add("cloud-privesc")
    if (has("credential", "secret", "key vault", "kms", "imds", "metadata", "access key", "api key", "token", "password in")) out.add("credential-exposure")
    if (has("cross-account", "cross account", "cross-subscription", "peering", "vpn", "lateral", "trust", "federation")) out.add("lateral-movement")
    if (has("persistence", "backdoor", "automation", "runbook", "lambda", "function", "cron", "scheduled")) out.add("persistence-mechanism")
    if (has("storage", "bucket", "blob", "s3", "database", "rds", "dynamodb", "cosmos", "bigquery", "sql server", "data lake")) out.add("data-access")
    if (has("security group", "nsg", "firewall", "network acl", "inbound rule", "egress", "ingress", "open port")) out.add("network-misconfig")
    if (has("logging disabled", "cloudtrail", "monitor", "audit", "diagnostic", "flow log", "guard duty", "security center")) out.add("compliance-gap")
    if (has("ec2", "vm ", "virtual machine", "compute instance", "instance profile", "instance metadata")) out.add("compute-misconfig")
    if (has("serverless", "lambda", "azure function", "cloud function", "cloud run", "app engine")) out.add("serverless-misconfig")
    return [...out]
  }

  // A pattern is pure data: "these primitive classes present → this escalated attack to attempt". Zod
  // validates it so an external pack (below) cannot inject a malformed entry that breaks a hunt.
  const Pattern = z.object({
    id: z.string().min(1),
    requires: z.array(z.string().min(1)).min(1), // ALL must be present somewhere in the finding set
    impact: z.string().min(1),
    say: z.string().min(1), // the hypothesis text (the required classes map to the matched finding ids)
  })
  type Pattern = z.infer<typeof Pattern>

  // Built-in seed set — "primitive(s) present → escalated attack to attempt". Chains need ≥2 primitives;
  // a few single-primitive entries lift severity in place. Shipped with the binary; an external pack
  // (CYBERSTRIKE_ESCALATION_CATALOG_DIR) extends it without a rebuild.
  const BUILTIN: Pattern[] = [
    { id: "ssrf-internal", requires: ["info-disclosure", "ssrf"], impact: "internal RCE / cloud-metadata", say: "pivot the internal host leaked by the info-disclosure into the SSRF to reach an internal service / cloud metadata" },
    { id: "idor-mass", requires: ["idor", "predictable-id"], impact: "mass data exfiltration", say: "enumerate the predictable ids against the IDOR object to bulk-exfiltrate other tenants' data" },
    { id: "idor-alone", requires: ["idor"], impact: "cross-tenant / admin object access", say: "escalate the IDOR from a peer object to an ADMIN/cross-tenant object" },
    { id: "redirect-oauth", requires: ["open-redirect", "oauth"], impact: "account takeover", say: "abuse the open redirect in the OAuth/OIDC auth-code flow to steal the code/token → account takeover" },
    { id: "cors-token", requires: ["cors", "xss"], impact: "authenticated token/response exfiltration", say: "use the XSS + permissive credentialed CORS to read authenticated responses / exfiltrate the token" },
    { id: "bfla-privesc", requires: ["bfla", "idor"], impact: "tenant/admin takeover", say: "combine the BFLA admin function with the IDOR to escalate privilege to tenant/admin takeover" },
    { id: "vulncomp-cve", requires: ["vulnerable-component"], impact: "known-CVE exploitation", say: "exploit the known CVE of the detected vulnerable component against a reachable sink" },
    { id: "error-injection", requires: ["info-disclosure", "injection"], impact: "DB / command access", say: "use the verbose error/stack trace to guide the injection toward DB/command access" },
    { id: "jwt-authz", requires: ["jwt", "authz"], impact: "authz-wide bypass", say: "forge identity via the JWT weakness to bypass the authorization checks app-wide" },
    // Cloud escalation patterns — chains across cloud assessment findings.
    { id: "cloud-iam-public", requires: ["iam-misconfig", "public-exposure"], impact: "unauthorized data access from public", say: "combine the overly permissive IAM policy with the publicly exposed resource to access data without authentication" },
    { id: "cloud-privesc-cred", requires: ["cloud-privesc", "credential-exposure"], impact: "full account compromise", say: "use the exposed credentials to perform the privilege escalation path → full account/subscription admin" },
    { id: "cloud-lateral-iam", requires: ["iam-misconfig", "lateral-movement"], impact: "cross-account/cross-subscription compromise", say: "chain the IAM misconfiguration with cross-account trust or peering to pivot into adjacent accounts/subscriptions" },
    { id: "cloud-public-data", requires: ["public-exposure", "data-access"], impact: "mass data exfiltration", say: "the publicly exposed endpoint leads directly to the data store — enumerate and bulk-exfiltrate all accessible data" },
    { id: "cloud-cred-admin", requires: ["credential-exposure", "iam-misconfig"], impact: "admin takeover via stolen credentials", say: "the exposed credential belongs to an overly privileged principal — use it to take over the admin role" },
    { id: "cloud-persist-iam", requires: ["persistence-mechanism", "iam-misconfig"], impact: "stealth persistent access", say: "plant persistence (backdoor user/role/function) using the IAM misconfiguration — the weak audit trail hides it" },
    { id: "cloud-net-cred", requires: ["network-misconfig", "credential-exposure"], impact: "network pivot + credential theft", say: "the open network path exposes the credential/metadata endpoint — pivot through the network to steal credentials" },
    { id: "cloud-compute-privesc", requires: ["compute-misconfig", "cloud-privesc"], impact: "compute-to-control-plane escalation", say: "abuse the misconfigured compute instance (instance profile / metadata / user-data) to escalate to control-plane admin" },
    { id: "cloud-serverless-privesc", requires: ["serverless-misconfig", "cloud-privesc"], impact: "serverless-to-account escalation", say: "modify or invoke the misconfigured serverless function to trigger the privilege escalation path" },
    { id: "cloud-compliance-exposure", requires: ["compliance-gap", "public-exposure"], impact: "unmonitored public access", say: "the disabled logging/monitoring means the public exposure is invisible to defenders — exfiltrate under the radar" },
    { id: "cloud-data-privesc", requires: ["data-access", "cloud-privesc"], impact: "data-plane to control-plane", say: "leverage data-plane access (e.g. KMS decrypt, Secrets Manager read) to obtain credentials that escalate to control-plane" },
  ]

  // The effective catalog: BUILTIN + any external JSON packs, loaded once and cached. A pack is a JSON
  // file (array of patterns, or { patterns: [...] }) in CYBERSTRIKE_ESCALATION_CATALOG_DIR — enterprise
  // teams drop in domain-specific chains without a rebuild. A pack id overrides a BUILTIN of the same id
  // (so a team can tune a default); an invalid pattern or unreadable file is skipped with a warning, so a
  // bad pack never takes the hunt down. DATA ONLY — a pack cannot run code, only propose a hypothesis the
  // hunter still has to PROVE by replay.
  let cache: Pattern[] | undefined
  export function loadPatterns(): Pattern[] {
    if (cache) return cache
    const byId = new Map(BUILTIN.map((p) => [p.id, p]))
    const dir = process.env.CYBERSTRIKE_ESCALATION_CATALOG_DIR
    if (dir)
      for (const file of readPackFiles(dir)) {
        const parsed = readPack(file)
        for (const p of parsed) byId.set(p.id, p)
      }
    cache = [...byId.values()]
    return cache
  }

  // Test/reload hook — drop the cache so a newly-written pack (or a changed env) is picked up next call.
  export function reload(): void {
    cache = undefined
  }

  function readPackFiles(dir: string): string[] {
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => path.join(dir, f))
    } catch (e) {
      log.warn("escalation catalog dir unreadable (using built-in only)", { dir, err: String(e) })
      return []
    }
  }

  function readPack(file: string): Pattern[] {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"))
      const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.patterns) ? raw.patterns : undefined
      if (!arr) {
        log.warn("escalation pack is not an array / {patterns:[]} (skipped)", { file })
        return []
      }
      return arr.flatMap((entry: unknown) => {
        const r = Pattern.safeParse(entry)
        if (r.success) return [r.data]
        log.warn("escalation pattern invalid (skipped)", { file, err: r.error.issues[0]?.message })
        return []
      })
    } catch (e) {
      log.warn("escalation pack unreadable (skipped)", { file, err: String(e) })
      return []
    }
  }

  // Generate seed hypotheses for a finding set: for each pattern whose required classes are ALL present,
  // one hypothesis referencing a representative finding per required class. Bounded (one per pattern).
  export function seeds(findings: Vulnerability.Info[]): { from: string[]; hypothesis: string; targetImpact: string }[] {
    const byClass = new Map<string, Vulnerability.Info[]>()
    for (const v of findings) for (const c of classify(v)) (byClass.get(c) ?? byClass.set(c, []).get(c)!).push(v)
    const out: { from: string[]; hypothesis: string; targetImpact: string }[] = []
    for (const p of loadPatterns()) {
      if (!p.requires.every((c) => byClass.has(c))) continue
      const reps = p.requires.map((c) => byClass.get(c)![0]!)
      const from = [...new Set(reps.map((r) => r.id).filter((id): id is string => !!id))]
      const refs = reps.map((r) => `${r.title}${r.endpoint ? ` (${r.endpoint})` : ""}`).join(" + ")
      out.push({ from, hypothesis: `${p.say} — from: ${refs}`, targetImpact: p.impact })
    }
    return out
  }
}

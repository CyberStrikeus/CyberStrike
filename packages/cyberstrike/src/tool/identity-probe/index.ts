// identity_probe — deterministic identity-management probe (WSTG 4.3), fully READ-ONLY over captured
// traffic (sends nothing, zero risk). Two IDNT-exclusive checks nothing else tools:
//   • predictable/sequential account identifiers (4.3.4 guessable accounts) — grouped by their source so
//     product-ids/page-numbers don't masquerade as a user-id space.
//   • username-policy weaknesses already VISIBLE in captured accounts (4.3.5): reserved names, unicode
//     homoglyph impersonation, weak/oversized usernames.
// The ACTIVE registration test (registering reserved/homoglyph/weak names) is deliberately NOT auto-fired
// here — it CREATES real accounts (irreversible pollution). The tool emits the candidate list + guidance;
// the agent runs it via http_replay when it is acceptable to create accounts.
import z from "zod"
import { Tool } from "../tool"
import { Session } from "../../session"
import { Request } from "../../session/request"
import { classifyIdentifiers, usernamePolicyIssues, type IdFinding } from "./signatures"

const ID_PARAM = /(?:^|[_.])(?:id|uid|user_?id|account_?id|member_?id|customer_?id|profile_?id)$/i
const USER_PATH = /\/(users?|accounts?|profiles?|members?|customers?)\/(\d{1,12})(?=\/|$|\?)/gi
const USER_FIELD = /(?:username|email|login|user)/i

// Pull identifier groups from captured traffic, keyed by source so each group is one logical id-space.
function collectGroups(requests: Request.Info[]): { groups: Map<string, string[]>; usernames: Set<string> } {
  const groups = new Map<string, string[]>()
  const usernames = new Set<string>()
  const add = (key: string, val: string) => {
    if (!val) return
    const arr = groups.get(key) ?? []
    arr.push(val)
    groups.set(key, arr)
  }
  for (const r of requests) {
    const target = r.raw_request?.split(/\r?\n/)[0]?.split(" ")[1] ?? r.normalized_path ?? ""
    // path ids under a user/account-ish collection
    for (const m of target.matchAll(USER_PATH)) add(`path:/${m[1].toLowerCase()}/`, m[2])
    // id-like query params
    const q = target.includes("?") ? target.slice(target.indexOf("?") + 1) : ""
    for (const pair of q.split("&")) {
      const eq = pair.indexOf("=")
      if (eq < 0) continue
      const k = decodeURIComponent(pair.slice(0, eq))
      if (ID_PARAM.test(k)) add(`param:${k}`, decodeURIComponent(pair.slice(eq + 1)))
    }
    // usernames from login/register bodies (form + json)
    const body = r.raw_request?.split(/\r?\n\r?\n/)[1] ?? ""
    if (body) {
      for (const m of body.matchAll(/(?:^|&)([\w.]*(?:username|email|login)[\w.]*)=([^&]+)/gi)) if (USER_FIELD.test(m[1])) usernames.add(decodeURIComponent(m[2]))
      for (const m of body.matchAll(/"([\w.]*(?:username|email|login)[\w.]*)"\s*:\s*"([^"]+)"/gi)) if (USER_FIELD.test(m[1])) usernames.add(m[2])
    }
  }
  return { groups, usernames }
}

export const IdentityProbeTool = Tool.define("identity_probe", {
  description:
    "Deterministic identity-management probe (WSTG 4.3) — fully READ-ONLY over captured traffic (sends nothing). Reports (1) predictable/sequential account identifiers (guessable-account space, 4.3.4), grouped by source so unrelated numeric ids don't false-positive; (2) username-policy weaknesses already visible in captured accounts (4.3.5): reserved names, unicode homoglyph impersonation (e.g. Cyrillic 'а' in 'аdmin'), weak/oversized usernames. It also emits a reserved/homoglyph/weak candidate list for the agent to test against the registration endpoint via http_replay — the tool does NOT register accounts itself (that creates real, irreversible accounts).",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const requests = Request.get(sessionID)

    const { groups, usernames } = collectGroups(requests)

    const idFindings: (IdFinding & { group: string })[] = []
    for (const [group, values] of groups) for (const f of classifyIdentifiers(values)) idFindings.push({ ...f, group })

    const usernameFindings: Record<string, unknown>[] = []
    for (const u of usernames) {
      const issues = usernamePolicyIssues(u)
      if (issues.length) usernameFindings.push({ username: u, issues })
    }

    const high = idFindings.filter((f) => f.severity === "high")
    const evidence = {
      note: "OBSERVATIONS ONLY (read-only, nothing sent). A sequential id space is a strong IDOR/enumeration lead → hand to the authorization/access_probe specialist to walk it. A reserved/homoglyph username already accepted is an impersonation finding.",
      identifiers_analyzed: [...groups.entries()].map(([g, v]) => ({ group: g, count: v.length })),
      identifier_findings: idFindings.length ? idFindings : ["no predictable/sequential account-identifier space detected"],
      username_findings: usernameFindings.length ? usernameFindings : ["no reserved/homoglyph/weak username found in captured accounts"],
      registration_test_candidates: {
        note: "Test these against the registration endpoint via http_replay ONLY when creating accounts is acceptable — the tool will not register them for you.",
        reserved: ["admin", "root", "system"],
        homoglyph: ["аdmin (Cyrillic а)", "аdministrator"],
        weak: ["a", "1", "!@#"],
      },
    }
    const title = high.length
      ? `identity_probe: sequential/guessable account-id space (HIGH) — verify + hand to authz`
      : idFindings.length + usernameFindings.length > 0
        ? `identity_probe: ${idFindings.length + usernameFindings.length} identity-management lead(s) to verify`
        : `identity_probe: no deterministic identity-management weakness found`
    return { title, output: JSON.stringify(evidence, null, 2), metadata: {} }
  },
})

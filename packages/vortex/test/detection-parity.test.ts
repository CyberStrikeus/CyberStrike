// DETECTION-PARITY floor (#40). A representative corpus with several planted vuln classes; the full
// registry (every per-tx + corpus rule) must keep detecting ALL of them. This is the guard that turns
// "did an optimization drop a finding?" into a visible test failure instead of a judgement call — any
// future change (P1b/P1c, and especially a P2 rule pre-filter) that loses one of these breaks here.
import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { defaultRegistry } from "../src/index"

let n = 0
function tx(opts: {
  method?: string
  url: string
  status: number
  identity?: string
  reqHeaders?: { name: string; value: string }[]
  resHeaders?: { name: string; value: string }[]
  body?: string
}): Transaction {
  return {
    id: `t${n++}`,
    source: "browser",
    host: "app.test",
    identity: opts.identity,
    request: { method: opts.method ?? "GET", url: `https://app.test${opts.url}`, headers: opts.reqHeaders ?? [] },
    response: { status: opts.status, headers: opts.resHeaders ?? [{ name: "content-type", value: "application/json" }], body: opts.body ?? "{}" },
  }
}

const TOKEN = "reset0abc123def456ghi789"

// One corpus, many planted findings.
const corpus: Transaction[] = [
  // 1) enumerable numeric object id in a 2xx path → numeric-id-enumerable
  tx({ url: "/api/account/1005", status: 200, identity: "org1" }),
  // 2) same endpoint reached under two distinct identities → cross-identity-access
  tx({ url: "/api/data", status: 200, identity: "org1" }),
  tx({ url: "/api/data", status: 200, identity: "org2" }),
  // 3) authenticated endpoint also reachable anonymously → unauthenticated-reach
  tx({ url: "/api/profile", status: 200, identity: "org1" }),
  tx({ url: "/api/profile", status: 200 }),
  // 4) value-reuse chain across distinct identities → cross-identity-value-reuse
  tx({ url: "/api/token", status: 200, identity: "org1", body: JSON.stringify({ session: TOKEN }) }),
  tx({ url: `/api/use?t=${TOKEN}`, status: 200, identity: "org2" }),
  // 5) a server banner header → server-banner (a passive header rule, per-tx)
  tx({ url: "/", status: 200, resHeaders: [{ name: "content-type", value: "text/html" }, { name: "server", value: "Apache/2.4.49" }], body: "<html></html>" }),
]

describe("detection parity — planted vulns must all still be detected (#40)", () => {
  test("the full registry detects every planted finding", () => {
    const ids = new Set(defaultRegistry().analyze(corpus).map((s) => s.ruleId))
    // If this fails, print what DID fire so the drop is obvious.
    const must = [
      "numeric-id-enumerable",
      "cross-identity-access",
      "unauthenticated-reach",
      "cross-identity-value-reuse",
      "server-banner",
    ]
    const missing = must.filter((r) => !ids.has(r))
    if (missing.length) throw new Error(`DETECTION DROPPED: ${missing.join(", ")} — fired: ${[...ids].sort().join(", ")}`)
    expect(missing).toEqual([])
  })
})

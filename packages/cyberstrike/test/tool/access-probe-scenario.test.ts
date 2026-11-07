// Advanced end-to-end scenario: does access_probe CATCH broken access control across a realistic,
// mixed multi-identity app — and NOT false-positive on the correctly-enforced endpoints? Drives the
// real orchestration (runAccessMatrix → classifyAccess) with a fake server that models each authz case.
import { describe, expect, test } from "bun:test"
import { runAccessMatrix, type AccessResp, type AccessFinding } from "../../src/tool/access-probe"

// ── the "target": a multi-tenant app. alice & bob are peer users (bob is the attacker swap), admin is
//    privileged, null = unauthenticated. Each endpoint models a DIFFERENT, realistic authz behaviour. ──
const PROFILE_ALICE = `{"user":"alice","email":"alice@corp.com","ssn":"111-22-3333","role":"user"}`
const ORDER_1001 = `{"order":1001,"tenant":"A","total":4200,"card":"411111******1234"}`
const METRICS = `{"cpu":42,"mem":71,"build":"1.9.3","internalToken":"srv-abc"}`
const settings = (u: string) => `{"user":"${u}","theme":"dark","notifications":true,"locale":"en"}`

function app(endpoint: string, actor: string | null): AccessResp {
  const loggedIn = actor != null
  switch (endpoint) {
    // IDOR — any logged-in user can read alice's profile (no ownership check); unauth must log in.
    case "GET /api/users/alice/profile":
      return loggedIn ? { status: 200, body: PROFILE_ALICE } : { status: 401, body: "login required" }
    // Correctly SCOPED read — returns the CALLER's own settings (bob gets bob's → different body).
    case "GET /api/me/settings":
      return loggedIn ? { status: 200, body: settings(actor!) } : { status: 401, body: "login required" }
    // BOLA cross-tenant — alice's order (tenant A) is served to any logged-in identity (incl. tenant B).
    case "GET /api/orders/1001":
      return loggedIn ? { status: 200, body: ORDER_1001 } : { status: 401, body: "" }
    // BFLA write — a privileged action any logged-in user is (wrongly) allowed to perform.
    case "POST /api/admin/promote":
      return loggedIn ? { status: 200, body: `{"promoted":true}` } : { status: 401, body: "" }
    // Correctly ENFORCED write — ownership checked; only the owner may delete.
    case "DELETE /api/posts/500":
      return actor === "alice" ? { status: 204, body: "" } : loggedIn ? { status: 403, body: "forbidden" } : { status: 401, body: "" }
    // Missing authorization — internal metrics served to EVERYONE, including unauthenticated.
    case "GET /api/internal/metrics":
      return { status: 200, body: METRICS }
    default:
      return { status: 404, body: "" }
  }
}

type Msg = { endpoint: string; actor: string | null }
async function probe(endpoint: string, owner: string, swaps: (string | null)[], stateChanging = false): Promise<AccessFinding[]> {
  const variants = swaps.map((id) => ({
    identity: id ?? "unauthenticated",
    kind: (id ? "credential" : "unauthenticated") as AccessFinding["kind"],
    msg: { endpoint, actor: id } as Msg,
  }))
  const { findings } = await runAccessMatrix<Msg>(
    { ownerMsg: { endpoint, actor: owner }, stateChanging, variants },
    async (m) => app(m.endpoint, m.actor),
  )
  return findings
}
const verdict = (f: AccessFinding[], id: string) => f.find((x) => x.identity === id)?.verdict

describe("access_probe — advanced multi-identity scenario", () => {
  test("IDOR: bob reads alice's profile → broken; unauthenticated → enforced", async () => {
    const f = await probe("GET /api/users/alice/profile", "alice", ["bob", null])
    expect(verdict(f, "bob")).toBe("broken")
    expect(verdict(f, "unauthenticated")).toBe("enforced")
  })

  test("BOLA cross-tenant: bob reads alice's order → broken", async () => {
    const f = await probe("GET /api/orders/1001", "alice", ["bob", null])
    expect(verdict(f, "bob")).toBe("broken")
    expect(verdict(f, "unauthenticated")).toBe("enforced")
  })

  test("BFLA write: bob performs the admin-promote action → broken; unauth → enforced", async () => {
    const f = await probe("POST /api/admin/promote", "admin", ["bob", null], true)
    expect(verdict(f, "bob")).toBe("broken")
    expect(f.find((x) => x.identity === "bob")!.note).toMatch(/BFLA|write ran/i)
    expect(verdict(f, "unauthenticated")).toBe("enforced")
  })

  test("missing authz: unauthenticated reads internal metrics → broken", async () => {
    const f = await probe("GET /api/internal/metrics", "alice", ["bob", null])
    expect(verdict(f, "unauthenticated")).toBe("broken")
    expect(verdict(f, "bob")).toBe("broken")
  })

  test("NO false positive — correctly-scoped /me/settings: bob gets his OWN data → NOT broken", async () => {
    const f = await probe("GET /api/me/settings", "alice", ["bob", null])
    expect(verdict(f, "bob")).not.toBe("broken") // different body → weak-lead, the agent verifies
    expect(verdict(f, "bob")).toBe("weak-lead")
    expect(verdict(f, "unauthenticated")).toBe("enforced")
  })

  test("NO false positive — correctly-enforced DELETE: bob is denied (403) → enforced", async () => {
    const f = await probe("DELETE /api/posts/500", "alice", ["bob", null], true)
    expect(verdict(f, "bob")).toBe("enforced")
    expect(verdict(f, "unauthenticated")).toBe("enforced")
  })

  test("aggregate: exactly the vulnerable endpoints surface as broken", async () => {
    const scenarios = [
      { ep: "GET /api/users/alice/profile", owner: "alice", write: false, brokenExpected: true },
      { ep: "GET /api/orders/1001", owner: "alice", write: false, brokenExpected: true },
      { ep: "POST /api/admin/promote", owner: "admin", write: true, brokenExpected: true },
      { ep: "GET /api/internal/metrics", owner: "alice", write: false, brokenExpected: true },
      { ep: "GET /api/me/settings", owner: "alice", write: false, brokenExpected: false },
      { ep: "DELETE /api/posts/500", owner: "alice", write: true, brokenExpected: false },
    ]
    for (const s of scenarios) {
      const f = await probe(s.ep, s.owner, ["bob", null], s.write)
      const hasBroken = f.some((x) => x.verdict === "broken")
      expect(hasBroken).toBe(s.brokenExpected)
    }
  })
})

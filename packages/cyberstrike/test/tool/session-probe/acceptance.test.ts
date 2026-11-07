import { describe, test, expect } from "bun:test"
import { classifyJwtAcceptance, runJwtAcceptance, type SessResp } from "../../../src/tool/session-probe/probe"

const OWNER: SessResp = { status: 200, body: "welcome alice, balance 100 <dashboard>" }

describe("session-probe/probe — classifyJwtAcceptance", () => {
  test("BROKEN: control denied, forged token gets the owner's response", () => {
    const control: SessResp = { status: 401, body: "login required" }
    const forged: SessResp = { status: 200, body: "welcome alice, balance 100 <dashboard>" }
    const v = classifyJwtAcceptance(OWNER, control, forged, "alg:none")
    expect(v.verdict).toBe("broken")
    expect(v.similarity).toBeGreaterThanOrEqual(0.9)
  })

  test("ENFORCED: forged token is rejected while control is denied", () => {
    const control: SessResp = { status: 401, body: "login required" }
    const forged: SessResp = { status: 401, body: "login required" }
    expect(classifyJwtAcceptance(OWNER, control, forged, "alg:none").verdict).toBe("enforced")
  })

  test("INCONCLUSIVE: endpoint serves the no-token control too (not session-gated)", () => {
    const control: SessResp = { status: 200, body: "public page" }
    const forged: SessResp = { status: 200, body: "public page" }
    expect(classifyJwtAcceptance(OWNER, control, forged, "alg:none").verdict).toBe("inconclusive")
  })

  test("INCONCLUSIVE: owner's own token did not baseline 2xx", () => {
    const badOwner: SessResp = { status: 500 }
    expect(classifyJwtAcceptance(badOwner, { status: 401 }, { status: 200, body: "x" }, "alg:none").verdict).toBe("inconclusive")
  })

  test("weak-lead: forged 2xx but a different body (reached an authed area)", () => {
    const control: SessResp = { status: 401, body: "login required" }
    const forged: SessResp = { status: 200, body: "welcome bob, balance 5 <dashboard>" }
    expect(classifyJwtAcceptance(OWNER, control, forged, "tampered-claim").verdict).toBe("weak-lead")
  })

  test("ERROR: transport failure on the forged send", () => {
    expect(classifyJwtAcceptance(OWNER, { status: 401 }, { error: "timeout" }, "alg:none").verdict).toBe("error")
  })
})

describe("session-probe/probe — runJwtAcceptance orchestration", () => {
  test("drives owner + control + variants through an injected sender (alg:none-accepting app)", async () => {
    // Fake app: no token → 401; alg:none token → accepted as alice; anything else with a token → alice.
    const send = async (msg: { token: string | null }): Promise<SessResp> => {
      if (msg.token === null) return { status: 401, body: "login required" }
      return { status: 200, body: "welcome alice, balance 100 <dashboard>" }
    }
    const run = await runJwtAcceptance(
      {
        ownerMsg: { token: "real" },
        controlMsg: { token: null },
        variants: [{ name: "alg:none", msg: { token: "forged-none" } }],
      },
      send,
    )
    expect(run.owner.status).toBe(200)
    expect(run.control.status).toBe(401)
    expect(run.results[0].verdict).toBe("broken")
  })
})

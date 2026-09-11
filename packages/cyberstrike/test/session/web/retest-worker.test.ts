import { describe, expect, test } from "bun:test"
import { RetestWorker } from "../../../src/session/web/retest-worker"
import type { WebRetest } from "../../../src/session/web/web-retest"
import { Session } from "../../../src/session"
import { Instance } from "../../../src/project/instance"
import { tmpdir } from "../../fixture/fixture"

async function withInstance(fn: () => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({ directory: dir.path, fn })
}

function scenario(flags: WebRetest.Info["flags"], method = "POST", endpoint = "/api/flags"): WebRetest.Info {
  return {
    id: "r1",
    session_id: "s",
    key_hash: "k1",
    status: "pending",
    priority: "high",
    flags,
    method,
    endpoint,
    time: { created: 0, updated: 0 },
  }
}

describe("RetestWorker.resolveAgents — scenario → specialist routing", () => {
  test("a signal flag routes to its owning specialist (value encodes type:owner)", async () => {
    await withInstance(async () => {
      // sql_error is owned by the injection class → hunt-injection
      const agents = await RetestWorker.resolveAgents(scenario({ signal: ["sql_error:injection"] }))
      expect(agents).toContain("hunt-injection")
    })
  })

  test("a new credential routes to the authorization specialist (WSTG 4.5 owns IDOR/BOLA/BFLA)", async () => {
    await withInstance(async () => {
      const agents = await RetestWorker.resolveAgents(scenario({ credential: ["org1"] }))
      // Under the WSTG taxonomy authorization owns access-control incl. IDOR, so a new identity
      // routes to that one specialist — not a separate hunt-idor (kept only as a fallback when
      // no agent owns the authorization class).
      expect(agents).toContain("hunt-authz")
    })
  })

  test("a new role also routes to access-control", async () => {
    await withInstance(async () => {
      const agents = await RetestWorker.resolveAgents(scenario({ role: ["Admin"] }))
      expect(agents).toContain("hunt-authz")
    })
  })

  test("an object value on a non-injectable GET routes to the authorization specialist only", async () => {
    await withInstance(async () => {
      // A plain GET whose path names no query/search/filter operation is not an injection surface,
      // so an object value (IDOR fuel) routes only to authorization (which owns IDOR under WSTG).
      const agents = await RetestWorker.resolveAgents(scenario({ object_value: ["456" ] }, "GET", "/customers/123"))
      expect(agents).toEqual(["hunt-authz"])
    })
  })

  test("an injection surface (body method) routes to hunt-injection", async () => {
    await withInstance(async () => {
      // A POST carries a body to inject into → injection specialist, even with no injection signal.
      const post = await RetestWorker.resolveAgents(scenario({ object_value: ["1"] }, "POST", "/api/run-query"))
      expect(post).toContain("hunt-injection")
      // A GET whose path names a query/filter operation is parameterized → also injection.
      const getFilter = await RetestWorker.resolveAgents(scenario({}, "GET", "/api/filter-options"))
      expect(getFilter).toContain("hunt-injection")
      // A plain nav GET is not.
      expect(RetestWorker.isInjectionSurface(scenario({}, "GET", "/dashboard"))).toBe(false)
    })
  })

  test("mixed flags union the specialists, deduped", async () => {
    await withInstance(async () => {
      const agents = await RetestWorker.resolveAgents(
        scenario({ credential: ["org1"], object_value: ["1"], signal: ["sql_error:injection"] }),
      )
      // credential + object_value both route to authorization, deduped to one; plus the signal's owner.
      expect(agents.filter((a) => a === "hunt-authz").length).toBe(1)
      expect(agents).toContain("hunt-authz")
      expect(agents).toContain("hunt-injection")
    })
  })
})

describe("RetestWorker.buildPrompt", () => {
  test("names the endpoint and lists the discovered context", () => {
    const p = RetestWorker.buildPrompt(scenario({ credential: ["org1", "org2"], object_value: ["456"] }))
    expect(p).toContain("POST /api/flags")
    expect(p).toContain("org1, org2")
    expect(p).toContain("456")
    expect(p).toContain("http_replay")
  })

  test("a technology signal flag injects that stack's playbook test cases", () => {
    // The flag value is `technology:<owner>:<slug>` (3rd segment = the detected stack).
    const p = RetestWorker.buildPrompt(scenario({ signal: ["technology:misconfiguration:spring-boot"] }))
    expect(p).toContain("stack-specific test cases")
    expect(p).toContain("Spring Boot")
    expect(p).toContain("/actuator/env") // a concrete probe from the playbook
  })

  test("a non-technology signal flag does NOT inject a playbook block", () => {
    const p = RetestWorker.buildPrompt(scenario({ signal: ["sql_error:injection"] }))
    expect(p).not.toContain("stack-specific test cases")
  })
})

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

function scenario(flags: WebRetest.Info["flags"]): WebRetest.Info {
  return {
    id: "r1",
    session_id: "s",
    key_hash: "k1",
    status: "pending",
    priority: "high",
    flags,
    method: "POST",
    endpoint: "/api/flags",
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

  test("a new credential routes to access-control specialists (authz + idor)", async () => {
    await withInstance(async () => {
      const agents = await RetestWorker.resolveAgents(scenario({ credential: ["org1"] }))
      expect(agents).toContain("hunt-authz")
      expect(agents).toContain("hunt-idor")
    })
  })

  test("a new role also routes to access-control", async () => {
    await withInstance(async () => {
      const agents = await RetestWorker.resolveAgents(scenario({ role: ["Admin"] }))
      expect(agents).toContain("hunt-authz")
    })
  })

  test("an object value routes to idor", async () => {
    await withInstance(async () => {
      const agents = await RetestWorker.resolveAgents(scenario({ object_value: ["456"] }))
      expect(agents).toEqual(["hunt-idor"])
    })
  })

  test("mixed flags union the specialists, deduped", async () => {
    await withInstance(async () => {
      const agents = await RetestWorker.resolveAgents(
        scenario({ credential: ["org1"], object_value: ["1"], signal: ["cors_misconfig:misconfiguration"] }),
      )
      // access-control (authz+idor) + misconfig owner; idor appears once
      expect(agents.filter((a) => a === "hunt-idor").length).toBe(1)
      expect(agents).toContain("hunt-authz")
      expect(agents).toContain("hunt-misconfig")
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

import { describe, expect, test, beforeAll } from "bun:test"
import { WebInspectionRouter } from "../../src/inspection/web-router"
import { Instance } from "../../src/project/instance"
import { registerProvider } from "../../src/cloud/provider-registry"
import { WebProvider } from "@cyberstrike-io/web"
import { tmpdir } from "../fixture/fixture"
import type { InspectionTarget, Evidence } from "@cyberstrike-io/plugin"

// Ported from the retired retest-worker routing tests. WebInspectionRouter.resolve/prompt is the
// deterministic replacement for RetestWorker.resolveAgents/buildPrompt — same signal→specialist
// routing, over the InspectionTarget + Evidence model. Register the web provider so the class→agent
// map resolves (the plugin loader does this at runtime).
beforeAll(() => {
  registerProvider("web", () => new WebProvider())
})
async function withInstance(fn: () => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({ directory: dir.path, fn })
}

const router = new WebInspectionRouter()
const target = (method: string, path: string): InspectionTarget => ({ key: "k1", label: path, meta: { method, path } })
const ev = (type: string, value: string): Evidence => ({ type, value, priority: "high" })

describe("WebInspectionRouter.resolve — evidence → specialist routing", () => {
  test("a signal routes to its owning specialist (value encodes type:owner)", async () => {
    await withInstance(async () => {
      const agents = await router.resolve(target("POST", "/api/flags"), [ev("signal", "sql_error:input-validation")])
      expect(agents).toContain("wstg-input-validation")
    })
  })

  test("a new credential routes to the authorization specialist (owns IDOR/BOLA/BFLA)", async () => {
    await withInstance(async () => {
      const agents = await router.resolve(target("GET", "/customers/123"), [ev("credential", "org1")])
      expect(agents).toContain("wstg-authorization")
    })
  })

  test("a new role also routes to authorization", async () => {
    await withInstance(async () => {
      const agents = await router.resolve(target("GET", "/customers/123"), [ev("role", "Admin")])
      expect(agents).toContain("wstg-authorization")
    })
  })

  test("an object value on a non-injectable GET routes to authorization only", async () => {
    await withInstance(async () => {
      const agents = await router.resolve(target("GET", "/customers/123"), [ev("object_value", "456")])
      expect(agents).toEqual(["wstg-authorization"])
    })
  })

  test("an injection surface routes to input-validation (POST body, or a query/filter path)", async () => {
    await withInstance(async () => {
      expect(await router.resolve(target("POST", "/api/run-query"), [ev("object_value", "1")])).toContain("wstg-input-validation")
      expect(await router.resolve(target("GET", "/api/filter-options"), [])).toContain("wstg-input-validation")
      // a plain nav GET is NOT an injection surface → no input-validation from surface alone
      expect(await router.resolve(target("GET", "/dashboard"), [])).not.toContain("wstg-input-validation")
    })
  })

  test("mixed evidence unions the specialists, deduped", async () => {
    await withInstance(async () => {
      const agents = await router.resolve(target("POST", "/api/flags"), [
        ev("credential", "org1"),
        ev("object_value", "1"),
        ev("signal", "sql_error:input-validation"),
      ])
      expect(agents.filter((a) => a === "wstg-authorization").length).toBe(1)
      expect(agents).toContain("wstg-authorization")
      expect(agents).toContain("wstg-input-validation")
    })
  })
})

describe("WebInspectionRouter.prompt", () => {
  test("names the endpoint and lists the discovered context", () => {
    const p = router.prompt(target("POST", "/api/flags"), [ev("credential", "org1"), ev("credential", "org2"), ev("object_value", "456")], "wstg-authorization")
    expect(p).toContain("POST /api/flags")
    expect(p).toContain("org1, org2")
    expect(p).toContain("456")
    expect(p).toContain("http_replay")
  })

  test("a technology signal injects that stack's playbook test cases", () => {
    const p = router.prompt(target("GET", "/"), [ev("signal", "technology:config-deploy:spring-boot")], "wstg-config-deploy")
    expect(p).toContain("stack-specific test cases")
    expect(p).toContain("Spring Boot")
    expect(p).toContain("/actuator/env")
  })

  test("a non-technology signal does NOT inject a playbook block", () => {
    const p = router.prompt(target("POST", "/api/flags"), [ev("signal", "sql_error:input-validation")], "wstg-input-validation")
    expect(p).not.toContain("stack-specific test cases")
  })
})

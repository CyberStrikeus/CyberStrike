import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, containerRules } from "../src/index"

const rules = compileRules(containerRules)
function tx(over: { body?: string; respHeaders?: [string, string][] }): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: "https://app.test/", headers: [] },
    response: { status: 200, headers: (over.respHeaders ?? []).map(([n, v]) => ({ name: n, value: v })), body: over.body ?? "" },
  }
}
const fired = (t: Transaction) => rules.flatMap((r) => r.evaluate(t)).map((s) => s.ruleId)

describe("container fingerprint rules", () => {
  test("Proxmox VE via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "pve-api-daemon/3.0"]] }))).toContain("tech-proxmox-ve")
  })

  test("Proxmox VE via body", () => {
    expect(fired(tx({ body: '<title>Proxmox VE - Virtual Environment</title><script src="/proxmoxlib.js">' }))).toContain("tech-proxmox-ve")
  })

  test("Docker via docker-distribution-api-version header", () => {
    expect(fired(tx({ respHeaders: [["docker-distribution-api-version", "registry/2.0"]] }))).toContain("tech-docker")
  })

  test("Docker via body", () => {
    expect(fired(tx({ body: '<title>Docker Registry</title>' }))).toContain("tech-docker")
  })

  test("Harbor via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Harbor"]] }))).toContain("tech-harbor")
  })

  test("Harbor via body", () => {
    expect(fired(tx({ body: '<app-root class="harbor-portal"></app-root>' }))).toContain("tech-harbor")
  })

  test("PubNub via body", () => {
    expect(fired(tx({ body: '<script src="https://cdn.pubnub.com/sdk/javascript/pubnub.min.js"></script>' }))).toContain("tech-pubnub")
  })

  // --- Structural ---
  test("a plain page triggers no container rules", () => {
    expect(fired(tx({ body: "<html><body>Hello</body></html>" }))).toHaveLength(0)
  })

  test("all rule IDs start with tech-", () => {
    for (const r of containerRules) expect(r.id).toMatch(/^tech-/)
  })

  test("all rules have container tag", () => {
    for (const r of containerRules) expect(r.tags).toContain("container")
  })

  test("rule count is 4", () => {
    expect(containerRules.length).toBe(4)
  })
})

import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, hostingPanelRules } from "../src/index"

const rules = compileRules(hostingPanelRules)
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

describe("hosting panel fingerprint rules", () => {
  test("Plesk via x-powered-by", () => {
    expect(fired(tx({ respHeaders: [["x-powered-by", "PleskLin"]] }))).toContain("tech-hp-plesk")
  })
  test("Plesk via cookie", () => {
    expect(fired(tx({ respHeaders: [["set-cookie", "PLESKSESSID=abc; path=/"]] }))).toContain("tech-hp-plesk")
  })
  test("cPanel via header", () => {
    expect(fired(tx({ respHeaders: [["x-cpanel-server", "cp1"]] }))).toContain("tech-hp-cpanel")
  })
  test("cPanel via body", () => {
    expect(fired(tx({ body: '<footer>Powered by cPanel, Inc.</footer>' }))).toContain("tech-hp-cpanel")
  })
  test("Pterodactyl Panel", () => {
    expect(fired(tx({ body: '<div id="pterodactyl"></div>' }))).toContain("tech-hp-pterodactyl")
  })
  test("BILLmanager", () => {
    expect(fired(tx({ body: '<title>BILLmanager</title>' }))).toContain("tech-hp-billmanager")
  })
  test("i-MSCP", () => {
    expect(fired(tx({ body: '<meta name="generator" content="i-MSCP">' }))).toContain("tech-hp-imscp")
  })
  test("VirtFusion", () => {
    expect(fired(tx({ body: '<title>VirtFusion Control Panel</title>' }))).toContain("tech-hp-virtfusion")
  })
  test("Creoline", () => {
    expect(fired(tx({ body: '<footer>Creoline Panel</footer>' }))).toContain("tech-hp-creoline")
  })
  test("DirectAdmin via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "DirectAdmin Daemon"]] }))).toContain("tech-hp-directadmin")
  })
  test("Novaresa", () => {
    expect(fired(tx({ body: '<title>Novaresa</title>' }))).toContain("tech-hp-novaresa")
  })
  test("TCAdmin", () => {
    expect(fired(tx({ body: '<div class="tcadmin2-login"></div>' }))).toContain("tech-hp-tcadmin")
  })
  test("FeatherPanel", () => {
    expect(fired(tx({ body: '<title>FeatherPanel</title>' }))).toContain("tech-hp-featherpanel")
  })
  test("AlternC", () => {
    expect(fired(tx({ body: '<meta name="generator" content="AlternC">' }))).toContain("tech-hp-alternc")
  })
  test("Open Game Panel", () => {
    expect(fired(tx({ body: '<div class="OGP_login">Open Game Panel</div>' }))).toContain("tech-hp-open-game-panel")
  })

  // --- Structural ---
  test("a plain page triggers no hosting panel rules", () => {
    expect(fired(tx({ body: "<html><body>Hello world</body></html>" }))).toHaveLength(0)
  })
  test("all rule IDs start with tech-hp-", () => {
    for (const r of hostingPanelRules) expect(r.id).toMatch(/^tech-hp-/)
  })
  test("all rules have hosting-panel tag", () => {
    for (const r of hostingPanelRules) expect(r.tags).toContain("hosting-panel")
  })
  test("rule count is 13", () => {
    expect(hostingPanelRules.length).toBe(13)
  })
})

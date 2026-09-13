import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, accessibilityRules } from "../src/index"

const rules = compileRules(accessibilityRules)
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

describe("accessibility widget fingerprint rules", () => {
  test("UserWay", () => {
    expect(fired(tx({ body: '<script src="https://cdn.userway.org/widget.js" data-account="abc"></script>' }))).toContain("tech-a11y-userway")
  })

  test("Pojo.me", () => {
    expect(fired(tx({ body: '<script src="https://pojo.me/accessibility.js"></script>' }))).toContain("tech-a11y-pojo")
  })

  test("AudioEye", () => {
    expect(fired(tx({ body: '<script src="https://ae.audioeye.com/ae.js"></script>' }))).toContain("tech-a11y-audioeye")
  })

  test("Nagich", () => {
    expect(fired(tx({ body: '<script src="https://nagich.co.il/scripts/INDWrapper.js"></script>' }))).toContain("tech-a11y-nagich")
  })

  test("EqualWeb", () => {
    expect(fired(tx({ body: '<script src="https://aacdn.nagich.com/core/1.0/equalweb.js"></script>' }))).toContain("tech-a11y-equalweb")
  })

  test("Monsido", () => {
    expect(fired(tx({ body: '<script>window.monsido_functions = [];</script>' }))).toContain("tech-a11y-monsido")
  })

  test("AccessiBe", () => {
    expect(fired(tx({ body: '<script src="https://acsbapp.com/apps/app/dist/js/app.js"></script>' }))).toContain("tech-a11y-accessibe")
  })

  test("Enable", () => {
    expect(fired(tx({ body: '<script src="https://enable.co.il/licenses/widget.js"></script>' }))).toContain("tech-a11y-enable")
  })

  test("All in One Accessibility", () => {
    expect(fired(tx({ body: '<script src="https://www.skynettechnologies.com/accessibility/js/all-in-one-accessibility-js-widget-minify.js"></script>' }))).toContain("tech-a11y-all-in-one")
  })

  test("Level Access", () => {
    expect(fired(tx({ body: '<script src="https://cdn.levelaccess.net/accessjs/YWpp/access.js"></script>' }))).toContain("tech-a11y-level-access")
  })

  test("Allyant", () => {
    expect(fired(tx({ body: '<script src="https://allyant.com/widget.js"></script>' }))).toContain("tech-a11y-allyant")
  })

  test("digi-access", () => {
    expect(fired(tx({ body: '<script src="https://www.digi-access.com/widget.js"></script>' }))).toContain("tech-a11y-digi-access")
  })

  test("Silktide", () => {
    expect(fired(tx({ body: '<script src="https://silktide.com/accessibility-checker/widget.js"></script>' }))).toContain("tech-a11y-silktide")
  })

  test("UsableNet", () => {
    expect(fired(tx({ body: '<script src="https://ac.usablenet.com/tt/assistive.js"></script>' }))).toContain("tech-a11y-usablenet")
  })

  test("Vee", () => {
    expect(fired(tx({ body: '<script src="https://getvee.io/vee-widget.js"></script>' }))).toContain("tech-a11y-vee")
  })

  test("Accessibility Toolbar Plugin", () => {
    expect(fired(tx({ body: '<link href="/wp-content/plugins/wp-accessibility-toolbar/style.css">' }))).toContain("tech-a11y-toolbar-plugin")
  })

  test("NagishLi", () => {
    expect(fired(tx({ body: '<script src="/js/nagishli.js"></script>' }))).toContain("tech-a11y-nagishli")
  })

  test("User Accessibility", () => {
    expect(fired(tx({ body: '<script src="https://useraccessibility.com/widget.js"></script>' }))).toContain("tech-a11y-user-accessibility")
  })

  test("AccessGo", () => {
    expect(fired(tx({ body: '<script src="https://accessgo.io/loader.js"></script>' }))).toContain("tech-a11y-accessgo")
  })

  test("HikeOrders", () => {
    expect(fired(tx({ body: '<script src="https://hikeorders.com/accessibility/widget.js"></script>' }))).toContain("tech-a11y-hikeorders")
  })

  test("Texthelp (Browsealoud)", () => {
    expect(fired(tx({ body: '<script src="https://www.browsealoud.com/plus/scripts/3.1.0/ba.js"></script>' }))).toContain("tech-a11y-texthelp")
  })

  test("uRemediate", () => {
    expect(fired(tx({ body: '<script src="https://uremediate.com/widget.js"></script>' }))).toContain("tech-a11y-uremediate")
  })

  test("AdaSiteCompliance", () => {
    expect(fired(tx({ body: '<script src="https://adasitecompliance.com/widget.js"></script>' }))).toContain("tech-a11y-adasitecompliance")
  })

  test("Allyable", () => {
    expect(fired(tx({ body: '<script src="https://allyable.com/widget.js"></script>' }))).toContain("tech-a11y-allyable")
  })

  test("Recite Me", () => {
    expect(fired(tx({ body: '<script src="https://cdn.reciteme.com/launch/abc.js"></script>' }))).toContain("tech-a11y-recite-me")
  })

  test("Adally", () => {
    expect(fired(tx({ body: '<script src="https://adally.com/widget.js"></script>' }))).toContain("tech-a11y-adally")
  })

  test("Accessibly", () => {
    expect(fired(tx({ body: '<script src="https://cdn.accessibly.app/accessibly.js"></script>' }))).toContain("tech-a11y-accessibly")
  })

  test("Magixite", () => {
    expect(fired(tx({ body: '<script src="https://magixite.com/widget.js"></script>' }))).toContain("tech-a11y-magixite")
  })

  test("Voice Intuitive", () => {
    expect(fired(tx({ body: '<script src="https://voiceintuitive.com/widget.js"></script>' }))).toContain("tech-a11y-voice-intuitive")
  })

  test("Handtalk", () => {
    expect(fired(tx({ body: '<script src="https://api.handtalk.me/plugin/latest/handtalk.min.js"></script>' }))).toContain("tech-a11y-handtalk")
  })

  test("XCompliant", () => {
    expect(fired(tx({ body: '<script src="https://xcompliant.com/widget.js"></script>' }))).toContain("tech-a11y-xcompliant")
  })

  test("Facil-iti", () => {
    expect(fired(tx({ body: '<script src="https://ws.facil-iti.com/faciliti-widget.js"></script>' }))).toContain("tech-a11y-facil-iti")
  })

  test("Piman", () => {
    expect(fired(tx({ body: '<script src="https://piman.co.il/accessibility/widget.js"></script>' }))).toContain("tech-a11y-piman")
  })

  test("AccessiWay", () => {
    expect(fired(tx({ body: '<script src="https://acs.accessiway.com/widget.js"></script>' }))).toContain("tech-a11y-accessiway")
  })

  test("Equalbrowse", () => {
    expect(fired(tx({ body: '<script src="https://equalbrowse.com/widget.js"></script>' }))).toContain("tech-a11y-equalbrowse")
  })

  test("Droxit", () => {
    expect(fired(tx({ body: '<script src="https://droxit.de/accessibility/widget.js"></script>' }))).toContain("tech-a11y-droxit")
  })

  test("Marshal", () => {
    expect(fired(tx({ body: '<script src="https://marshalsolutions.co/marshal-accessibility.js"></script>' }))).toContain("tech-a11y-marshal")
  })

  test("Poloda AI", () => {
    expect(fired(tx({ body: '<script src="https://poloda.ai/widget.js"></script>' }))).toContain("tech-a11y-poloda")
  })

  // --- Structural ---
  test("a plain page triggers no accessibility rules", () => {
    expect(fired(tx({ body: "<html><body>Hello</body></html>" }))).toHaveLength(0)
  })

  test("all rule IDs start with tech-a11y-", () => {
    for (const r of accessibilityRules) expect(r.id).toMatch(/^tech-a11y-/)
  })

  test("all rules have accessibility tag", () => {
    for (const r of accessibilityRules) expect(r.tags).toContain("accessibility")
  })

  test("rule count is 38", () => {
    expect(accessibilityRules.length).toBe(38)
  })
})

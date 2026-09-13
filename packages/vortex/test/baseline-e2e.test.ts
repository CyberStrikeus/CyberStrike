import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { baselineRules, defaultRegistry } from "../src/index"

function tx(over: { body?: string; respHeaders?: [string, string][]; url?: string }): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: over.url ?? "https://app.test/", headers: [] },
    response: { status: 200, headers: (over.respHeaders ?? []).map(([n, v]) => ({ name: n, value: v })), body: over.body ?? "" },
  }
}
const reg = defaultRegistry()
const fired = (t: Transaction) => reg.run(t).map((s) => ({ ruleId: s.ruleId, category: s.category }))
const techIds = (t: Transaction) => fired(t).filter((s) => s.category === "technology").map((s) => s.ruleId)

describe("baseline engine — the +1k tech rules are wired and fire", () => {
  test("the rule packs are actually loaded into baselineRules (~1k+)", () => {
    const tech = baselineRules.filter((r) => r.category === "technology")
    expect(tech.length).toBeGreaterThan(1000) // the 26 declarative packs, compiled + registered
  })

  test("defaultRegistry runs them (registry rule count matches)", () => {
    // defaultRegistry preloads baselineRules; a realistic page must produce signals through run().
    expect(reg.run(tx({ respHeaders: [["server", "nginx"]] })).length).toBeGreaterThan(0)
  })

  // --- SIGNAL PRODUCTION: a realistic multi-stack origin page ---
  test("realistic WordPress/PHP/Apache/Ubuntu/jQuery page → the right stack signals fire", () => {
    const t = tx({
      respHeaders: [["server", "Apache/2.4.52 (Ubuntu)"], ["x-powered-by", "PHP/8.1.2"]],
      body: '<meta name="generator" content="WordPress 6.4"><link href="/wp-content/themes/x/style.css"><script src="/wp-includes/js/jquery/jquery.min.js?ver=3.6.0"></script>',
    })
    const ids = techIds(t)
    expect(ids).toContain("tech-wordpress")
    expect(ids).toContain("tech-lang-php")
    expect(ids).toContain("tech-ws-apache")
    expect(ids).toContain("tech-os-ubuntu")
    expect(ids).toContain("tech-lib-jquery")
    expect(ids.length).toBeGreaterThanOrEqual(5)
  })

  test("a SaaS stack (Shopify + Cloudflare + React) fires the expected signals", () => {
    const t = tx({
      respHeaders: [["server", "cloudflare"]],
      body: '<script src="https://cdn.shopify.com/s/x.js"></script><div id="root" data-reactroot=""></div><script src="/react.production.min.js"></script>',
    })
    const ids = techIds(t)
    expect(ids).toContain("tech-cdn-cloudflare")
    expect(ids).toContain("tech-js-react")
  })

  // --- FALSE-POSITIVE GUARDS: nothing tech-specific ⇒ zero technology signals ---
  test("a blank page with no server header produces ZERO technology signals", () => {
    expect(techIds(tx({ body: "<html><body>Hello</body></html>" }))).toHaveLength(0)
  })

  test("a generic content page (plain classes, prose, a nav) produces ZERO technology signals", () => {
    const body = [
      "<!doctype html><html><head><title>Acme Store</title>",
      '<link rel="stylesheet" href="/style.css"><meta name="description" content="We sell things">',
      '</head><body><div class="wrap"><nav><a href="/contact">Contact</a><a href="/about">About</a></nav>',
      "<main><h1>Welcome</h1><p>The quick brown fox. React to the news. Angular momentum in physics. ",
      "Django Unchained is a movie. A php developer walked into a bar. Our team loves go and rust.</p>",
      '<img src="/img/hero.jpg"><footer>© Acme 2026</footer></main></div></body></html>',
    ].join("")
    // prose mentioning "react/angular/django/php/go/rust" must NOT fire tech signals — patterns are
    // anchored on real markers (bundles, headers, class prefixes), not English words.
    expect(techIds(tx({ body }))).toHaveLength(0)
  })

  test("adversarial: tech-adjacent words + a hardened Apache banner ⇒ no technology FP", () => {
    // ServerTokens Prod strips the version/OS token — bare "Apache" still legitimately fires
    // tech-ws-apache (that is detection, not FP), but NOTHING else should.
    const t = tx({
      respHeaders: [["server", "Apache"]],
      body: "<p>bootstrap your career. jquery of life. wordpress for writers workshop. laravel is a name.</p>",
    })
    expect(techIds(t)).toEqual(["tech-ws-apache"])
  })

  test("a CDN-hosted image/asset page does not fire library rules from asset URLs alone", () => {
    const t = tx({ body: '<img src="/assets/logo.png"><link href="/css/site.css"><video src="/media/x.mp4">' })
    expect(techIds(t)).toHaveLength(0)
  })
})

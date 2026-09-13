import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, webFrameworkRules } from "../src/index"

const rules = compileRules(webFrameworkRules)
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
const B = (body: string): { body: string } => ({ body })
const H = (respHeaders: [string, string][]): { respHeaders: [string, string][] } => ({ respHeaders })

const samples: [string, { body?: string; respHeaders?: [string, string][] }][] = [
  ["tech-web-codeigniter", H([["set-cookie", "ci_session=abc; path=/"]])],
  ["tech-web-livewire", B('<div wire:id="abc" wire:model="name"></div>')],
  ["tech-web-yii", H([["set-cookie", "YII_CSRF_TOKEN=abc; path=/"]])],
  ["tech-web-symfony", H([["x-debug-token", "a1b2c3"]])],
  ["tech-web-ionic", B('<ion-app><ion-content></ion-content></ion-app>')],
  ["tech-web-helix-ultimate", B('<link href="/templates/shaper_helixultimate/css/template.css">')],
  ["tech-web-nette", B('<script src="/js/netteForms.js"></script>')],
  ["tech-web-blazor", B('<script src="/_framework/blazor.webassembly.js"></script>')],
  ["tech-web-gwt", B('<script src="/app/app.nocache.js"></script>')],
  ["tech-web-macaron", B('<script src="/node_modules/@macaron-css/core/index.js"></script>')],
  ["tech-web-remix", B('<script>window.__remixContext = {};</script>')],
  ["tech-web-thinkphp", H([["x-powered-by", "ThinkPHP"]])],
  ["tech-web-jsp", B('<a href="/index.jsp">Home</a>')],
  ["tech-web-cakephp", H([["set-cookie", "CAKEPHP=abc; path=/"]])],
  ["tech-web-base44", B('<script src="https://base44.app/embed.js"></script>')],
  ["tech-web-java-servlet", B('<!-- javax.servlet.http.HttpServletRequest -->')],
  ["tech-web-mojolicious", H([["server", "Mojolicious (Perl)"]])],
  ["tech-web-jsf", B('<input type="hidden" name="javax.faces.ViewState" value="x">')],
  ["tech-web-vinext", B('<script>window.__vinext = {};</script>')],
  ["tech-web-sails", H([["x-powered-by", "Sails <sailsjs.org>"]])],
  ["tech-web-frappe", B('<script>frappe.ready(function(){});</script>')],
  ["tech-web-vaadin", B('<script src="/VAADIN/vaadinPush.js"></script>')],
  ["tech-web-streamlit", B('<div class="stStreamlit"><script>_stcore</script></div>')],
  ["tech-web-glpi", H([["set-cookie", "glpi_abc=1; path=/"]])],
  ["tech-web-neos-flow", B('<!-- Neos.Flow framework --><div>neosflow</div>')],
  ["tech-web-wicket", B('<div wicket:id="form"></div>')],
  ["tech-web-fatfree", H([["x-powered-by", "Fat-Free Framework"]])],
  ["tech-web-aspnetboilerplate", B('<script src="/js/abp.js"></script>')],
  ["tech-web-fastapi", B('<a href="/openapi.json">API</a><!-- fastapi -->')],
  ["tech-web-qwik", B('<div q:container="paused" q:base="/build/"></div>')],
  ["tech-web-stencil", B('<script type="module" src="/build/app.esm.js" data-stencil></script>')],
  ["tech-web-zk", B('<script src="/zkau/web/zk.wpd"></script>')],
  ["tech-web-adonis", H([["x-powered-by", "AdonisJS"]])],
  ["tech-web-sapper", B('<script>window.__SAPPER__ = {};</script>')],
  ["tech-web-shiny", B('<script src="/shared/shiny.min.js"></script>')],
  ["tech-web-stimulusreflex", B('<script src="/js/stimulus-reflex.js"></script>')],
  ["tech-web-abp", B('<script src="https://abp.io/scripts/abp.js"></script>')],
  ["tech-web-web2py", B('<script src="/web2py/static/js/web2py.js"></script>')],
  ["tech-web-fresh", B('<script>window.__FRSH_STATE = {};</script>')],
  ["tech-web-mono", H([["server", "Mono/6.12"]])],
  ["tech-web-nordcraft", B('<script src="https://nordcraft.com/runtime.js"></script>')],
  ["tech-web-kohana", H([["x-powered-by", "Kohana"]])],
  ["tech-web-leptos", B('<script>window.__leptos = {};</script>')],
  ["tech-web-hono", B('<script>import { Hono } from "@hono/node-server";</script>')],
  ["tech-web-jaspr", B('<script src="https://jaspr.dev/runtime.js"></script>')],
  ["tech-web-akka-http", H([["server", "akka-http/10.5.0"]])],
  ["tech-web-blitz", B('<script>window.__BLITZ__ = {};</script>')],
  ["tech-web-totaljs", B('<!-- powered by total.js --><script>total4</script>')],
  ["tech-web-dancer", H([["server", "Perl Dancer 2"]])],
  ["tech-web-wt", B('<link href="/wt-resources/themes/default.css">')],
  ["tech-web-farcry", B('<!-- farcrycore --><div>FarCry</div>')],
  ["tech-web-kemal", H([["server", "Kemal"]])],
  ["tech-web-solidstart", B('<script src="/node_modules/@solidjs/start/dist/index.js"></script>')],
  ["tech-web-koala", B('<link href="/kwf-webfonts/style.css">')],
  ["tech-web-koa", H([["x-powered-by", "Koa"]])],
  ["tech-web-includable", B('<script src="https://includable.com/widget.js"></script>')],
  ["tech-web-chicago-boss", B('<!-- powered by chicagoboss -->')],
  ["tech-web-dmvc", H([["x-powered-by", "DMVCFramework"]])],
  ["tech-web-revel", B('<script src="/revelframework/js/app.js"></script>')],
  ["tech-web-reflex", B('<script>window.__reflex = {};</script>')],
  ["tech-web-masterking32", B('<!-- masterking32 framework -->')],
  ["tech-web-actionhero", B('<script src="/js/actionhero.js"></script>')],
  ["tech-web-parse", H([["x-parse-request-id", "abc123"]])],
  ["tech-web-blade", B('<script src="/vendor/blade-ui-kit/app.js"></script>')],
  ["tech-web-oatpp", H([["server", "oatpp/1.3.0"]])],
  ["tech-web-banshee", B('<!-- bansheephp framework -->')],
  ["tech-web-streakjs", B('<script>Streak.init();</script><script src="/streak.js"></script>')],
  ["tech-web-pywebio", B('<script src="/js/pywebio.min.js"></script>')],
  ["tech-web-pinoox", B('<!-- powered by Pinoox --><link href="/pinoox/style.css">')],
  ["tech-web-openswoole", H([["server", "openswoole"]])],
  ["tech-web-arwes", B('<script src="/node_modules/@arwes/core/index.js"></script>')],
  ["tech-web-luana", B('<script src="/js/luana.js"></script>')],
]

describe("web framework fingerprint rules", () => {
  test("every rule has a sample and the sample fires it", () => {
    const ids = new Set(webFrameworkRules.map((r) => r.id))
    const sampled = new Set(samples.map(([id]) => id))
    for (const id of ids) expect(sampled.has(id)).toBe(true)
    for (const [id, over] of samples) expect(fired(tx(over))).toContain(id)
  })

  test("a plain page triggers no web framework rules", () => {
    expect(fired(tx(B("<html><body>Hello world</body></html>")))).toHaveLength(0)
  })

  test("all rule IDs start with tech-web-", () => {
    for (const r of webFrameworkRules) expect(r.id).toMatch(/^tech-web-/)
  })

  test("all rules have web-framework tag", () => {
    for (const r of webFrameworkRules) expect(r.tags).toContain("web-framework")
  })

  test("rule count is 72", () => {
    expect(webFrameworkRules.length).toBe(72)
  })
})

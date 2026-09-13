import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, paasRules } from "../src/index"

const rules = compileRules(paasRules)
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

describe("PaaS fingerprint rules", () => {
  // --- Major Cloud ---
  test("AWS via x-amzn-requestid header", () => {
    expect(fired(tx({ respHeaders: [["x-amzn-requestid", "abc123"]] }))).toContain("tech-paas-aws")
  })

  test("Vercel via x-vercel-id header", () => {
    expect(fired(tx({ respHeaders: [["x-vercel-id", "iad1::abc123"]] }))).toContain("tech-paas-vercel")
  })

  test("Vercel via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Vercel"]] }))).toContain("tech-paas-vercel")
  })

  test("Azure via x-ms-request-id header", () => {
    expect(fired(tx({ respHeaders: [["x-ms-request-id", "abc123"]] }))).toContain("tech-paas-azure")
  })

  // --- Hosting Providers ---
  test("SiteGround via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "SiteGround"]] }))).toContain("tech-paas-siteground")
  })

  test("OVHcloud via x-ovh-id header", () => {
    expect(fired(tx({ respHeaders: [["x-ovh-id", "abc123"]] }))).toContain("tech-paas-ovhcloud")
  })

  test("Strato via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Strato"]] }))).toContain("tech-paas-strato")
  })

  test("Aruba.it via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Aruba"]] }))).toContain("tech-paas-aruba-it")
  })

  test("Hetzner via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Hetzner"]] }))).toContain("tech-paas-hetzner")
  })

  test("Liquid Web via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Liquid Web"]] }))).toContain("tech-paas-liquid-web")
  })

  test("Vultr via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Vultr"]] }))).toContain("tech-paas-vultr")
  })

  test("Nexcess via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Nexcess"]] }))).toContain("tech-paas-nexcess")
  })

  // --- WordPress Hosting ---
  test("WP Engine via x-powered-by header", () => {
    expect(fired(tx({ respHeaders: [["x-powered-by", "WP Engine"]] }))).toContain("tech-paas-wp-engine")
  })

  test("WordPress.com via x-hacker header", () => {
    expect(fired(tx({ respHeaders: [["x-hacker", "If you're reading this, you should visit automattic.com/jobs"]] }))).toContain("tech-paas-wordpress-com")
  })

  test("WordPress.com via s0.wp.com body", () => {
    expect(fired(tx({ body: '<link rel="stylesheet" href="https://s0.wp.com/wp-content/themes/starter.css">' }))).toContain("tech-paas-wordpress-com")
  })

  test("Kinsta via x-kinsta-cache header", () => {
    expect(fired(tx({ respHeaders: [["x-kinsta-cache", "HIT"]] }))).toContain("tech-paas-kinsta")
  })

  test("Flywheel via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Flywheel"]] }))).toContain("tech-paas-flywheel")
  })

  test("WordPress VIP via x-powered-by header", () => {
    expect(fired(tx({ respHeaders: [["x-powered-by", "WordPress.com VIP <3"]] }))).toContain("tech-paas-wordpress-vip")
  })

  test("Seravo via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Seravo"]] }))).toContain("tech-paas-seravo")
  })

  test("Pagely via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Pagely"]] }))).toContain("tech-paas-pagely")
  })

  test("WP Stratos via body", () => {
    expect(fired(tx({ body: "Powered by wpstratos.com" }))).toContain("tech-paas-wp-stratos")
  })

  // --- Developer Platforms ---
  test("GitHub Pages via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "GitHub.com"]] }))).toContain("tech-paas-github-pages")
  })

  test("Railway via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "railway"]] }))).toContain("tech-paas-railway")
  })

  test("Render via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Render"]] }))).toContain("tech-paas-render")
  })

  test("Render via x-render-origin-server header", () => {
    expect(fired(tx({ respHeaders: [["x-render-origin-server", "gunicorn"]] }))).toContain("tech-paas-render")
  })

  test("Fly.io via fly-request-id header", () => {
    expect(fired(tx({ respHeaders: [["fly-request-id", "abc123"]] }))).toContain("tech-paas-fly-io")
  })

  test("Heroku via via header (vegur)", () => {
    expect(fired(tx({ respHeaders: [["via", "1.1 vegur"]] }))).toContain("tech-paas-heroku")
  })

  test("Heroku via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "heroku-router"]] }))).toContain("tech-paas-heroku")
  })

  test("Deno Deploy via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "deno/v2.0"]] }))).toContain("tech-paas-deno-deploy")
  })

  test("Glitch via body", () => {
    expect(fired(tx({ body: '<a href="https://glitch.com/edit/#!/my-project">Remix on Glitch</a>' }))).toContain("tech-paas-glitch")
  })

  test("PythonAnywhere via body", () => {
    expect(fired(tx({ body: "Hosted on pythonanywhere.com" }))).toContain("tech-paas-pythonanywhere")
  })

  test("Gigalixir via body", () => {
    expect(fired(tx({ body: '<script>window.GIGALIXIR = "gigalixir.app";</script>' }))).toContain("tech-paas-gigalixir")
  })

  // --- Managed Hosting ---
  test("Cloudways via x-turbo-charged-by header", () => {
    expect(fired(tx({ respHeaders: [["x-turbo-charged-by", "Cloudways"]] }))).toContain("tech-paas-cloudways")
  })

  test("Pantheon via x-pantheon-styx-hostname header", () => {
    expect(fired(tx({ respHeaders: [["x-pantheon-styx-hostname", "styx-abc"]] }))).toContain("tech-paas-pantheon")
  })

  test("Platform.sh via x-platform-server header", () => {
    expect(fired(tx({ respHeaders: [["x-platform-server", "abc123"]] }))).toContain("tech-paas-platform-sh")
  })

  test("Lagoon via x-lagoon header", () => {
    expect(fired(tx({ respHeaders: [["x-lagoon", "production"]] }))).toContain("tech-paas-lagoon")
  })

  test("PlatformOS via body", () => {
    expect(fired(tx({ body: "Powered by platformos.com" }))).toContain("tech-paas-platformos")
  })

  // --- Edge / Serverless ---
  test("Cloudflare Workers via cf-worker header", () => {
    expect(fired(tx({ respHeaders: [["cf-worker", "my-worker"]] }))).toContain("tech-paas-cf-workers")
  })

  test("F5 Distributed Cloud via x-volterra-info header", () => {
    expect(fired(tx({ respHeaders: [["x-volterra-info", "abc"]] }))).toContain("tech-paas-f5-distributed")
  })

  // --- Status / Monitoring ---
  test("Atlassian Statuspage via body", () => {
    expect(fired(tx({ body: '<link rel="stylesheet" href="https://statuspage.io/css/bootstrap.min.css">' }))).toContain("tech-paas-statuspage")
  })

  // --- Real-time ---
  test("Agora via body", () => {
    expect(fired(tx({ body: '<script src="https://cdn.agora.io/sdk/release/AgoraRTC.js"></script>' }))).toContain("tech-paas-agora")
  })

  test("Voximplant via body", () => {
    expect(fired(tx({ body: '<script src="https://cdn.voximplant.com/edge/voximplant.min.js"></script>' }))).toContain("tech-paas-voximplant")
  })

  // --- Enterprise ---
  test("Appian via body", () => {
    expect(fired(tx({ body: "Powered by appiancloud.com" }))).toContain("tech-paas-appian")
  })

  test("Spryker via body", () => {
    expect(fired(tx({ body: '<div class="spryker-shop">Spryker Commerce</div>' }))).toContain("tech-paas-spryker")
  })

  test("Betty Blocks via body", () => {
    expect(fired(tx({ body: '<script src="https://bettyblocks.com/embed.js"></script>' }))).toContain("tech-paas-betty-blocks")
  })

  // --- Smaller / Regional ---
  test("Mirus via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Mirus"]] }))).toContain("tech-paas-mirus")
  })

  test("ANS via body", () => {
    expect(fired(tx({ body: "Hosted by ans.co.uk" }))).toContain("tech-paas-ans")
  })

  test("Zeabur via body", () => {
    expect(fired(tx({ body: '<a href="https://zeabur.app/deploy">Deploy on Zeabur</a>' }))).toContain("tech-paas-zeabur")
  })

  test("Tiiny Host via body", () => {
    expect(fired(tx({ body: "Hosted on tiiny.host" }))).toContain("tech-paas-tiiny-host")
  })

  test("Chabokan via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Chabokan"]] }))).toContain("tech-paas-chabokan")
  })

  test("Akoova via body", () => {
    expect(fired(tx({ body: "Powered by akoova.com" }))).toContain("tech-paas-akoova")
  })

  test("Brimble via body", () => {
    expect(fired(tx({ body: '<script src="https://brimble.io/sdk.js"></script>' }))).toContain("tech-paas-brimble")
  })

  test("Zephyr Cloud via body", () => {
    expect(fired(tx({ body: "Deployed on zephyr-cloud.io" }))).toContain("tech-paas-zephyr-cloud")
  })

  test("Bask Health via body", () => {
    expect(fired(tx({ body: "Powered by bask.health" }))).toContain("tech-paas-bask-health")
  })

  test("Bernet Cloud via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Bernet"]] }))).toContain("tech-paas-bernet-cloud")
  })

  test("Pxxl via body", () => {
    expect(fired(tx({ body: "Built with pxxl.app" }))).toContain("tech-paas-pxxl")
  })

  test("Starhost via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Starhost"]] }))).toContain("tech-paas-starhost")
  })

  test("Helipod via body", () => {
    expect(fired(tx({ body: "Deployed on helipod.io" }))).toContain("tech-paas-helipod")
  })

  test("Fing via body", () => {
    expect(fired(tx({ body: '<script src="https://app.fing.com/js/fing-embedded.js"></script>' }))).toContain("tech-paas-fing")
  })

  // --- Structural ---
  test("a plain page triggers no PaaS rules", () => {
    expect(fired(tx({ body: "<html><body>Hello</body></html>" }))).toHaveLength(0)
  })

  test("all rule IDs start with tech-paas-", () => {
    for (const r of paasRules) expect(r.id).toMatch(/^tech-paas-/)
  })

  test("all rules have paas tag", () => {
    for (const r of paasRules) expect(r.tags).toContain("paas")
  })

  test("rule count is 55", () => {
    expect(paasRules.length).toBe(55)
  })
})

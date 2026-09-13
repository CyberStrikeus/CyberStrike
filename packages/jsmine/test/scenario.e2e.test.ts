// Advanced end-to-end scenario: a realistic target scan driven through the REAL engine
// (defaultRegistry with all baseline rules) + the jsmine plugin + the recursive crawl pass.
// Proves the whole chain "catches" a target: tech fingerprint over the corpus, first-party JS mined
// for endpoints + secrets, further lazy chunks followed, and CDN/vendor bundles skipped from mining.
import { describe, expect, test } from "bun:test"
import type { Transaction, Sender, SendResult } from "@cyberstrike-io/vortex"
import { MemoryStore, defaultRegistry, registerPlugin, extract, scan, discoveredId } from "@cyberstrike-io/vortex"
import { plugin, mineDiscoveredJs } from "../src/index"

// --- the "target": realistic minified bundles served by a fake origin ----------------------------
const AWS = "AKIAIOSFODNN7EXAMPLE"
const STRIPE = "sk_live_" + "4eC39HqLyjWDarjt1zdp7dc"
const ENTROPY = "kThP9xQ2mV7nR4wZ8bL1cY6dF3gJ5aX"
const GOOGLE = "AIza" + "C".repeat(35)

// First-party app bundle (minified, single line) — API calls, a template route, hardcoded secrets,
// a lazy-chunk import, a source map, and an axios reference (a fingerprintable library).
const MAIN_JS =
  `(()=>{var e={};function t(r){return fetch("/api/v2/users?role="+r)}` +
  "var n=`/api/orders/${window.oid}/items`,a=\"/api/checkout\";" +
  `axios.post(a,{});` +
  `var k="${AWS}",s="${STRIPE}",tok="${ENTROPY}";` +
  `import("/static/js/settings.def456.js");})();\n` +
  `//# sourceMappingURL=main.abc123.js.map`

// Lazy chunk discovered from the main bundle — another endpoint + another secret.
const LAZY_JS = `(()=>{fetch("/api/admin/config");var g="${GOOGLE}";})();`

// CDN/vendor bundle — MUST NOT be mined (its "endpoint" must never surface).
const CDN_JS = `/*! vue v3 */ (function(){fetch("/should/NOT/be/mined")})();`

const ORIGIN = "https://app.test"
function serve(url: string): string {
  if (url === `${ORIGIN}/static/js/main.abc123.js`) return MAIN_JS
  if (url === `${ORIGIN}/static/js/settings.def456.js`) return LAZY_JS
  if (url === "https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.js") return CDN_JS
  return ""
}
function fakeSender(): { send: Sender; hits: string[] } {
  const hits: string[] = []
  let n = 0
  const send: Sender = async (input) => {
    const url = typeof input === "object" && "url" in input ? (input.url as string) : ""
    hits.push(url)
    const tx: Transaction = {
      id: `js${++n}`,
      source: "replay",
      host: new URL(url).host,
      request: { method: "GET", url, headers: [] },
      response: { status: 200, headers: [{ name: "content-type", value: "application/javascript" }], body: serve(url) },
    }
    return { transaction: tx } as SendResult
  }
  return { send, hits }
}

describe("advanced scenario — does the engine catch the target end-to-end?", () => {
  test("tech fingerprint + first-party JS mining + lazy-chunk follow + CDN skip", async () => {
    const store = new MemoryStore()
    const registry = defaultRegistry() // ALL baseline rules (1000+ tech packs, secret sigs, etc.)
    registerPlugin(registry, plugin()) // wire the jsmine extractor onto the engine

    // 1) The crawler fetched the landing page and recorded its <script src> into the inventory.
    const page: Transaction = {
      id: "page",
      source: "browser",
      host: "app.test",
      request: { method: "GET", url: `${ORIGIN}/`, headers: [] },
      response: {
        status: 200,
        headers: [["server", "nginx"], ["x-powered-by", "Express"]].map(([name, value]) => ({ name, value })),
        body: `<!doctype html><html><body><div id="app"></div><script src="/static/js/main.abc123.js"></script><script src="https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.js"></script></body></html>`,
      },
    }
    store.add(page)
    store.addDiscovered([
      { id: discoveredId("js", "/static/js/main.abc123.js"), kind: "js", value: "/static/js/main.abc123.js", hit: false },
      { id: discoveredId("js", "https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.js"), kind: "js", value: "https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.js", hit: false },
    ])

    // 2) The recursive JS-mining pass: fetch first-party bundles, mine, follow new first-party JS.
    const { send, hits } = fakeSender()
    const res = await mineDiscoveredJs(store, send, { baseUrl: `${ORIGIN}/` })

    // --- crawl behaviour ---
    expect(res.fetched).toEqual(
      expect.arrayContaining([
        `${ORIGIN}/static/js/main.abc123.js`,
        `${ORIGIN}/static/js/settings.def456.js`, // the lazy chunk was discovered mid-mine and followed
        `${ORIGIN}/static/js/main.abc123.js.map`, // source map is discovered + followed (exposes originals)
      ]),
    )
    expect(res.skipped).toContain("https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.js")
    expect(hits).not.toContain("https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.js") // CDN never fetched

    // --- endpoints caught (resolved to absolute) ---
    const eps = store.discovered("endpoint").map((d) => d.value)
    expect(eps).toEqual(
      expect.arrayContaining([
        `${ORIGIN}/api/v2/users?role=`, // literal captured as-is — also reveals the `role` query param
        `${ORIGIN}/api/orders/*/items`, // template literal → wildcard route
        `${ORIGIN}/api/checkout`,
        `${ORIGIN}/api/admin/config`, // from the followed lazy chunk
      ]),
    )
    // the CDN bundle's endpoint was NEVER mined
    expect(eps.join("|")).not.toContain("NOT/be/mined")

    // --- secrets caught as high / info-disclosure signals ---
    const secretSigs = store.signals({ ruleId: "jsmine-secret" })
    const kinds = secretSigs.map((s) => s.title)
    expect(secretSigs.length).toBe(4) // AWS, Stripe, entropy token, Google (lazy chunk)
    expect(kinds.some((t) => t.includes("aws-access-key"))).toBe(true)
    expect(kinds.some((t) => t.includes("stripe-key"))).toBe(true)
    expect(kinds.some((t) => t.includes("google-api-key"))).toBe(true)
    expect(secretSigs.every((s) => s.severity === "high" && s.category === "info-disclosure")).toBe(true)
    // redacted — no cleartext secret leaked into the signal layer
    expect(secretSigs.every((s) => !s.evidence?.includes(AWS) && !s.evidence?.includes(STRIPE))).toBe(true)

    // --- tech fingerprint over the OBSERVED corpus (the browser-captured page) ---
    // NOTE: scan() runs rules over observed traffic only — the crawler-fetched (replay-source)
    // bundles are excluded, so tech here comes from the page's headers + <script src>.
    const techSigs = scan(store, registry).filter((s) => s.category === "technology").map((s) => s.ruleId)
    expect(techSigs).toContain("tech-cdn-jsdelivr") // the jsDelivr <script src> on the page
    expect(techSigs).toContain("tech-ws-nginx") // Server header
    expect(techSigs).toContain("tech-lang-nodejs") // X-Powered-By: Express
    expect(techSigs).toContain("tech-express") // Express framework banner
  })

  test("ingest-path parity: the plugin hook mines a JS tx via extract()", () => {
    const store = new MemoryStore()
    const registry = defaultRegistry()
    registerPlugin(registry, plugin())
    // a JS response arriving at ingest (no crawl) — the onTransaction hook must mine it too
    store.add({
      id: "b",
      source: "browser",
      host: "app.test",
      request: { method: "GET", url: `${ORIGIN}/static/app.js`, headers: [] },
      response: { status: 200, headers: [{ name: "content-type", value: "text/javascript" }], body: `fetch("/api/v1/me");var k="${AWS}"` },
    })
    extract(store, registry) // core drives the registered hooks over observed traffic
    expect(store.discovered("endpoint").map((d) => d.value)).toContain(`${ORIGIN}/api/v1/me`)
    expect(store.signals({ ruleId: "jsmine-secret" })).toHaveLength(1)
  })
})

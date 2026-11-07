import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, contentCurationRules } from "../src/index"

const rules = compileRules(contentCurationRules)
function tx(body: string): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: "https://app.test/", headers: [] },
    response: { status: 200, headers: [], body },
  }
}
const fired = (body: string) => rules.flatMap((r) => r.evaluate(tx(body))).map((s) => s.ruleId)
const js = (src: string) => `<script src="${src}"></script>`

const samples: [string, string][] = [
  ["tech-cc-juicer", js("https://assets.juicer.io/embed.js")],
  ["tech-cc-tagembed", js("https://widget.tagembed.com/embed.min.js")],
  ["tech-cc-covetpics", js("https://covet.pics/widget.js")],
  ["tech-cc-ceros", '<div class="ceros-experience"><script src="//view.ceros.com/scroll-proxy.min.js"></script></div>'],
  ["tech-cc-upcontent", js("https://app.upcontent.com/widget.js")],
  ["tech-cc-frase", js("https://frase.io/widget.js")],
  ["tech-cc-bazaarvoice", js("https://apps.bazaarvoice.com/curation/x.js")],
  ["tech-cc-scoopit", js("https://www.scoop.it/embed.js")],
  ["tech-cc-foursixty", js("https://foursixty.com/media/scripts/fs.embed.v2.js")],
  ["tech-cc-emplifi", js("https://emplifi.io/ugc/widget.js")],
  ["tech-cc-madcap", '<meta name="generator" content="MadCap Flare"><script src="/madcapsoftware/x.js"></script>'],
  ["tech-cc-nosto", js("https://connect.nosto.com/nostojs.js")],
  ["tech-cc-foleon", js("https://foleoncdn.com/embed.js")],
  ["tech-cc-letro", js("https://letro.com/ugc.js")],
  ["tech-cc-cevoid", js("https://cevoid.com/widget.js")],
  ["tech-cc-snapsea", js("https://snapsea.io/embed.js")],
  ["tech-cc-storystream", js("https://storystream.ai/widget.js")],
  ["tech-cc-contentstudio", js("https://contentstudio.io/widget.js")],
  ["tech-cc-cpex", js("https://cpex.cz/widget.js")],
  ["tech-cc-tagboard", js("https://tagboard.com/embed.js")],
  ["tech-cc-amondo", js("https://amondo.com/embed.js")],
  ["tech-cc-olapic", js("https://photorankstatic.com/static/frontend/olapic.js")],
  ["tech-cc-miappi", js("https://miappi.com/widget.js")],
  ["tech-cc-natural-intelligence", js("https://naturalint.com/widget.js")],
  ["tech-cc-photoslurp", js("https://cdn4.photoslurp.com/widget.js")],
  ["tech-cc-contentbot", js("https://contentbot.ai/widget.js")],
  ["tech-cc-sniply", js("https://snip.ly/widget.js")],
  ["tech-cc-ugc-creative", js("https://cdn.ugc-creative.com/embed.js")],
  ["tech-cc-contently", js("https://contently.com/widget.js")],
  ["tech-cc-epublishing", js("https://epublishing.com/widget.js")],
  ["tech-cc-lineup", js("https://line-up.me/embed.js")],
  ["tech-cc-contribly", js("https://contribly.com/widget.js")],
  ["tech-cc-sverve", js("https://sverve.com/widget.js")],
  ["tech-cc-curated", js("https://curated.co/embed.js")],
  ["tech-cc-contents", js("https://contents.com/widget/embed.js")],
  ["tech-cc-klangoo", js("https://klangoo.com/widget.js")],
  ["tech-cc-rock-content", js("https://rockcontent.com/widget.js")],
  ["tech-cc-feedmagnet", js("https://feedmagnet.com/widget.js")],
  ["tech-cc-octipulse", js("https://octipulse.com/widget.js")],
  ["tech-cc-contentgems", js("https://contentgems.com/widget.js")],
]

describe("content curation fingerprint rules", () => {
  test("every rule has a sample and the sample fires it", () => {
    const ids = new Set(contentCurationRules.map((r) => r.id))
    const sampled = new Set(samples.map(([id]) => id))
    for (const id of ids) expect(sampled.has(id)).toBe(true)
    for (const [id, body] of samples) expect(fired(body)).toContain(id)
  })
  test("a plain page triggers no content curation rules", () => {
    expect(fired("<html><body>Hello world</body></html>")).toHaveLength(0)
  })
  test("all rule IDs start with tech-cc-", () => {
    for (const r of contentCurationRules) expect(r.id).toMatch(/^tech-cc-/)
  })
  test("all rules have content-curation tag", () => {
    for (const r of contentCurationRules) expect(r.tags).toContain("content-curation")
  })
  test("rule count is 40", () => {
    expect(contentCurationRules.length).toBe(40)
  })
})

import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, cmsRules } from "../src/index"

const rules = compileRules(cmsRules)
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

const samples: [string, { body?: string; respHeaders?: [string, string][] }][] = [
  ["tech-cms-wix", B('<link href="https://static.wixstatic.com/media/x.css">')],
  ["tech-cms-squarespace", B('<img src="https://static1.squarespace.com/x.jpg">')],
  ["tech-cms-godaddy-builder", B('<img src="https://img1.wsimg.com/x.png">')],
  ["tech-cms-sharepoint", { respHeaders: [["microsoftsharepointteamservices", "16.0.0.10357"]] }],
  ["tech-cms-jimdo", B('<script src="https://assets.jimstatic.com/x.js"></script>')],
  ["tech-cms-weebly", B('<script src="https://www.weebly.com/weebly/x.js"></script>')],
  ["tech-cms-hubspot", B('<script src="https://js.hs-scripts.com/12345.js"></script>')],
  ["tech-cms-typo3", B('<link href="/typo3conf/ext/theme/style.css">')],
  ["tech-cms-bitrix", { respHeaders: [["x-powered-cms", "Bitrix Site Manager"]] }],
  ["tech-cms-tilda", B('<link href="https://static.tildacdn.com/x.css">')],
  ["tech-cms-backdrop", B('<script src="/core/misc/backdrop.js"></script>')],
  ["tech-cms-aem", B('<link href="/etc/clientlibs/theme/style.css">')],
  ["tech-cms-odoo", B('<script src="/web/static/src/js/odoo.js"></script>')],
  ["tech-cms-payload", B('<div id="payload-admin"><!-- payloadcms --></div>')],
  ["tech-cms-sanity", B('<img src="https://cdn.sanity.io/images/x.jpg">')],
  ["tech-cms-format", B('<!-- powered by 4ormat --><div class="fviewer"></div>')],
  ["tech-cms-contao", B('<div class="mod_article"><!-- contao --></div>')],
  ["tech-cms-craft", { respHeaders: [["x-powered-by", "Craft CMS"]] }],
  ["tech-cms-october", B('<script src="/modules/system/assets/js/october.js"></script>')],
  ["tech-cms-sitecore", { respHeaders: [["x-powered-by", "Sitecore"]] }],
  ["tech-cms-dnn", B('<script src="/DesktopModules/x/js/main.js"></script>')],
  ["tech-cms-strapi", B('<img src="https://cdn.strapi.io/uploads/x.jpg"><!-- strapi.io -->')],
  ["tech-cms-wagtail", B('<div id="wagtailcore"><!-- wagtail --></div>')],
  ["tech-cms-storyblok", B('<img src="https://a.storyblok.com/f/x.jpg">')],
  ["tech-cms-concrete", B('<script>var ccm_ = {}; // concrete5</script>')],
  ["tech-cms-umbraco", B('<a href="/umbraco/">Login</a>')],
  ["tech-cms-modx", { respHeaders: [["x-powered-by", "MODX"]] }],
  ["tech-cms-ghost", B('<link href="https://demo.ghost.io/assets/casper.css">')],
  ["tech-cms-contentstack", B('<script src="https://cdn.contentstack.io/x.js"></script>')],
  ["tech-cms-processwire", B('<link href="/site/templates/style.css"><!-- processwire -->')],
  ["tech-cms-liferay", { respHeaders: [["liferay-portal", "Liferay DXP 7.4"]] }],
  ["tech-cms-statamic", B('<script src="/vendor/statamic/frontend.js"></script>')],
  ["tech-cms-prismic", B('<script src="https://static.cdn.prismic.io/prismic.js"></script>')],
  ["tech-cms-whmcs", B('<!-- powered by WHMCS --><div class="whmcs-header"></div>')],
  ["tech-cms-strikingly", B('<script src="https://strikinglycdn.com/x.js"></script>')],
  ["tech-cms-datalife", B('<meta name="generator" content="DataLife Engine">')],
  ["tech-cms-gnuboard", B('<script>var g5_url = "/bbs/"; // gnuboard</script>')],
  ["tech-cms-finalsite", B('<script src="https://finalsite.com/x.js"></script>')],
  ["tech-cms-kentico", { respHeaders: [["x-powered-by", "Kentico"]] }],
  ["tech-cms-prosites", B('<link href="/prosites/style.css">')],
  ["tech-cms-aem-franklin", B('<script src="/scripts/scripts.js" data-aem="aem.live"></script>')],
  ["tech-cms-expressionengine", B('<link href="/themes/ee/style.css">')],
  ["tech-cms-pimcore", B('<script src="/pimcore/static/js/main.js"></script>')],
  ["tech-cms-silverstripe", B('<meta name="generator" content="SilverStripe">')],
  ["tech-cms-google-sites", B('<link href="https://sites.google.com/x.css">')],
  ["tech-cms-thrillshare", B('<script src="https://cdn.thrillshare.com/x.js"></script>')],
  ["tech-cms-optimizely", { respHeaders: [["x-powered-by", "Episerver"]] }],
  ["tech-cms-spip", { respHeaders: [["composed-by", "SPIP 4.2"]] }],
  ["tech-cms-civicplus", B('<!-- powered by civicplus --><div class="cpImage"></div>')],
  ["tech-cms-brightspot", B('<link href="/cms/brightspot/style.css">')],
  ["tech-cms-datocms", B('<img src="https://www.datocms-assets.com/x.jpg">')],
  ["tech-cms-popmenu", B('<script src="https://popmenu.com/x.js"></script>')],
  ["tech-cms-contentful", B('<img src="https://images.ctfassets.net/x.jpg">')],
  ["tech-cms-orchard", B('<meta name="generator" content="OrchardCore">')],
  ["tech-cms-bentobox", B('<script src="https://www.getbento.com/x.js"></script>')],
  ["tech-cms-scorpion", B('<script src="https://scorpion.co/x.js"></script>')],
  ["tech-cms-skool", B('<link href="https://www.skool.com/x.css">')],
  ["tech-cms-omni", B('<!-- powered by omniupdate oucampus -->')],
  ["tech-cms-builderio", B('<script src="https://cdn.builder.io/x.js"></script>')],
  ["tech-cms-grav", B('<link href="/user/themes/quark/style.css">')],
  ["tech-cms-sitefinity", { respHeaders: [["x-powered-by", "Sitefinity"]] }],
  ["tech-cms-directus", B('<img src="/assets/x?directus"><!-- directus.io -->')],
  ["tech-cms-magnolia", B('<link href="/.magnolia/style.css">')],
  ["tech-cms-hatena", B('<link href="https://blog.hatena.ne.jp/x.css">')],
]

describe("CMS fingerprint rules", () => {
  test("every rule has a sample and the sample fires it", () => {
    const ids = new Set(cmsRules.map((r) => r.id))
    const sampled = new Set(samples.map(([id]) => id))
    for (const id of ids) expect(sampled.has(id)).toBe(true)
    for (const [id, over] of samples) expect(fired(tx(over))).toContain(id)
  })
  test("a plain page triggers no CMS rules", () => {
    expect(fired(tx(B("<html><body>Hello world</body></html>")))).toHaveLength(0)
  })
  test("all rule IDs start with tech-cms-", () => {
    for (const r of cmsRules) expect(r.id).toMatch(/^tech-cms-/)
  })
  test("all rules have cms tag", () => {
    for (const r of cmsRules) expect(r.tags).toContain("cms")
  })
  test("rule count is 64", () => {
    expect(cmsRules.length).toBe(64)
  })
})

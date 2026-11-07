import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, issueTrackerRules } from "../src/index"

const rules = compileRules(issueTrackerRules)
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
  ["tech-it-sentry", '<script>Sentry.init({dsn:"x"});</script><script src="https://browser.sentry-cdn.com/7/bundle.js"></script>'],
  ["tech-it-zendesk", js("https://static.zdassets.com/ekr/snippet.js")],
  ["tech-it-jira", '<a href="https://company.atlassian.net/browse/PROJ-1">JIRA</a>'],
  ["tech-it-bugsnag", js("https://d2wy8f7a9ursvp.cloudfront.net/v7/bugsnag.min.js")],
  ["tech-it-elastic-apm", js("/node_modules/@elastic/apm-rum/dist/bundles/elastic-apm-rum.umd.min.js")],
  ["tech-it-canny", '<script>Canny("identify", {});</script><script src="https://canny.io/sdk.js"></script>'],
  ["tech-it-helpscout", js("https://beacon-v2.helpscout.net/")],
  ["tech-it-getfeedback", js("https://api.getfeedback.com/embed.js")],
  ["tech-it-bugherd", js("https://www.bugherd.com/sidebarv2.js")],
  ["tech-it-marker", js("https://edge.marker.io/latest/shim.js")],
  ["tech-it-raygun", js("https://cdn.raygun.io/raygun4js/raygun.min.js")],
  ["tech-it-medallia", js("https://nebula_cdn.kampyle.com/us/wu123/onsite/embed.js")],
  ["tech-it-redmine", '<meta name="generator" content="Redmine">'],
  ["tech-it-honeybadger", '<script>Honeybadger.configure({});</script>'],
  ["tech-it-usersnap", js("https://widget.usersnap.com/load/abc")],
  ["tech-it-instana", '<script>ineum("reportError", e);</script>'],
  ["tech-it-uptimerobot", js("https://stats.uptimerobot.com/embed.js")],
  ["tech-it-asana", js("https://app.asana.com/embed.js")],
  ["tech-it-userback", '<script>Userback = window.Userback || {};</script><script src="https://static.userback.io/widget/v1.js"></script>'],
  ["tech-it-rollbar", '<script>var _rollbarConfig = {};</script>'],
  ["tech-it-osticket", '<a href="/scp/login.php">Staff Login</a>'],
  ["tech-it-instatus", js("https://instatus.com/widget.js")],
  ["tech-it-mopinion", js("https://srv.mopinion.com/survey.js")],
  ["tech-it-userreport", js("https://sak.userreport.com/x/launcher.js")],
  ["tech-it-uservoice", js("https://widget.uservoice.com/abc.js")],
  ["tech-it-noibu", js("https://cdn.noibu.com/collect.js")],
  ["tech-it-tiki", '<a href="/tiki-index.php">Home</a>'],
  ["tech-it-youtrack", '<link href="/youtrack/static/style.css">'],
  ["tech-it-ybug", '<script>Ybug.init({id:"x"});</script>'],
  ["tech-it-betterstack", js("https://uptime.betterstack.com/widget.js")],
  ["tech-it-glitchtip", js("https://app.glitchtip.com/loader.js")],
  ["tech-it-highlight-io", js("https://app.highlight.io/loader.js")],
  ["tech-it-statuspal", js("https://statuspal.io/widget.js")],
  ["tech-it-uptrends", js("https://uptrends.com/widget.js")],
  ["tech-it-taiga", '<link href="/taiga/style.css">'],
  ["tech-it-otrs", '<a href="/otrs/index.pl">OTRS</a>'],
  ["tech-it-atatus", js("https://dmc1acwvwny3.cloudfront.net/atatus.js")],
  ["tech-it-nolt", js("https://cdn.nolt.io/widgets.js")],
  ["tech-it-sleekplan", '<script>Sleek.init({});</script><script src="https://client.sleekplan.com/sdk/e.js"></script>'],
  ["tech-it-mantisbt", '<meta name="generator" content="MantisBT">'],
  ["tech-it-teamlinkt", js("https://teamlinkt.com/widget.js")],
  ["tech-it-supporthero", js("https://static.supporthero.io/widget.js")],
  ["tech-it-bugzilla", '<a href="/show_bug.cgi?id=1">Bug 1</a>'],
  ["tech-it-nootiz", js("https://nootiz.com/widget.js")],
  ["tech-it-hetrixtools", js("https://hetrixtools.com/embed.js")],
  ["tech-it-cachet", '<meta name="generator" content="Cachet"><!-- cachethq -->'],
  ["tech-it-trac", '<a href="/trac/wiki">Trac 1.5</a>'],
  ["tech-it-statusio", js("https://status.io/pages/embed.js")],
  ["tech-it-hund", js("https://hund.io/embed.js")],
  ["tech-it-planio", js("https://plan.io/widget.js")],
  ["tech-it-pingdom", js("https://rum.pingdom.net/pa.min.js")],
  ["tech-it-muscula", js("https://muscula.com/log.js")],
  ["tech-it-statuscast", js("https://statuscast.com/widget.js")],
  ["tech-it-panelbear", js("https://cdn.panelbear.com/analytics.js")],
  ["tech-it-faveo", '<meta name="generator" content="Faveo Helpdesk"><!-- faveohelpdesk -->'],
  ["tech-it-feedback-fish", js("https://feedback.fish/widget.js")],
  ["tech-it-rapidspike", js("https://rapidspike.com/widget.js")],
  ["tech-it-cstate", '<!-- powered by cState (misteo/cState) -->'],
  ["tech-it-combodo-itop", '<a href="/itop/pages/UI.php">iTop 3.0</a>'],
  ["tech-it-stackify", js("https://stackify.com/retrace.js")],
  ["tech-it-upptime", '<!-- powered by Upptime (upptime.js.org) -->'],
  ["tech-it-ruttl", js("https://ruttl.com/widget.js")],
  ["tech-it-get-satisfaction", js("https://getsatisfaction.com/widget.js")],
  ["tech-it-soplanning", '<meta name="generator" content="SOPlanning">'],
  ["tech-it-trello", js("https://p.trellocdn.com/embed.min.js")],
  ["tech-it-staytus", '<meta name="generator" content="Staytus">'],
  ["tech-it-buglog", js("https://buglog.io/sdk.js")],
  ["tech-it-vigil", '<!-- powered by vigil.io -->'],
  ["tech-it-loopedin", js("https://cdn.loopedin.io/js/widget.js")],
  ["tech-it-flyspray", '<meta name="generator" content="Flyspray">'],
  ["tech-it-statping", '<!-- powered by statping-ng -->'],
  ["tech-it-checkly", js("https://api.checklyhq.com/widget.js")],
  ["tech-it-userrules", js("https://userrules.com/widget.js")],
  ["tech-it-shakebug", js("https://cdn.shakebug.com/shake.js")],
  ["tech-it-mojo-helpdesk", js("https://mojohelpdesk.com/widget.js")],
  ["tech-it-incident-io", js("https://incident.io/widget.js")],
]

describe("issue tracker fingerprint rules", () => {
  test("every rule has a sample and the sample fires it", () => {
    const ids = new Set(issueTrackerRules.map((r) => r.id))
    const sampled = new Set(samples.map(([id]) => id))
    for (const id of ids) expect(sampled.has(id)).toBe(true)
    for (const [id, body] of samples) expect(fired(body)).toContain(id)
  })
  test("a plain page triggers no issue tracker rules", () => {
    expect(fired("<html><body>Hello world</body></html>")).toHaveLength(0)
  })
  test("all rule IDs start with tech-it-", () => {
    for (const r of issueTrackerRules) expect(r.id).toMatch(/^tech-it-/)
  })
  test("all rules have issue-tracker tag", () => {
    for (const r of issueTrackerRules) expect(r.tags).toContain("issue-tracker")
  })
  test("rule count is 76", () => {
    expect(issueTrackerRules.length).toBe(76)
  })
})

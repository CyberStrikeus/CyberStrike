import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, developmentRules } from "../src/index"

const rules = compileRules(developmentRules)
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

describe("development technology fingerprint rules", () => {
  // --- CSS-in-JS / Frontend ---
  test("Emotion", () => {
    expect(fired(tx({ body: '<style data-emotion="css 1a2b3c">.css-1a2b3c{color:red}</style>' }))).toContain("tech-dev-emotion")
  })

  test("styled-components", () => {
    expect(fired(tx({ body: '<style data-styled-version="5.3.6"></style>' }))).toContain("tech-dev-styled-components")
  })

  test("JSS", () => {
    expect(fired(tx({ body: '<style data-jss="" data-meta="Jss(App)">.App-root-1{}</style>' }))).toContain("tech-dev-jss")
  })

  test("Stitches", () => {
    expect(fired(tx({ body: '<style>/* stitches.config */ .sxs{--sxs:1 abc}</style>' }))).toContain("tech-dev-stitches")
  })

  test("Turbopack", () => {
    expect(fired(tx({ body: '<script src="/_next/static/chunks/turbopack_runtime.js"></script>' }))).toContain("tech-dev-turbopack")
  })

  test("CssUserAgent", () => {
    expect(fired(tx({ body: '<script src="/js/cssua.js"></script>' }))).toContain("tech-dev-cssuseragent")
  })

  test("Storybook", () => {
    expect(fired(tx({ body: '<div id="storybook-root"></div>' }))).toContain("tech-dev-storybook")
  })

  test("Opal", () => {
    expect(fired(tx({ body: '<script src="/assets/opal.min.js"></script>' }))).toContain("tech-dev-opal")
  })

  // --- Backend / BaaS ---
  test("Supabase", () => {
    expect(fired(tx({ body: 'createClient("https://xyz.supabase.co", "anon-key")' }))).toContain("tech-dev-supabase")
  })

  test("Appwrite via body", () => {
    expect(fired(tx({ body: '<script>const c = new Appwrite(); c.setEndpoint("https://cloud.appwrite.io/v1")</script>' }))).toContain("tech-dev-appwrite")
  })

  test("Filamentphp", () => {
    expect(fired(tx({ body: '<div class="fi-sidebar"><script src="/js/filament/support/support.js"></script></div>' }))).toContain("tech-dev-filamentphp")
  })

  // --- API docs / tooling ---
  test("Scalar", () => {
    expect(fired(tx({ body: '<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>' }))).toContain("tech-dev-scalar")
  })

  test("Apiary", () => {
    expect(fired(tx({ body: '<script src="https://api.apiary.io/jsapiary.js"></script>' }))).toContain("tech-dev-apiary")
  })

  test("APILayer", () => {
    expect(fired(tx({ body: 'fetch("https://api.apilayer.com/exchangerates_data/latest")' }))).toContain("tech-dev-apilayer")
  })

  test("Fixer", () => {
    expect(fired(tx({ body: 'fetch("https://data.fixer.io/api/latest?access_key=abc")' }))).toContain("tech-dev-fixer")
  })

  test("API Spreadsheets", () => {
    expect(fired(tx({ body: 'fetch("https://api.apispreadsheets.com/data/abc/")' }))).toContain("tech-dev-api-spreadsheets")
  })

  test("Sheety", () => {
    expect(fired(tx({ body: 'fetch("https://api.sheety.co/abc/mySheet/rows")' }))).toContain("tech-dev-sheety")
  })

  test("Feednami", () => {
    expect(fired(tx({ body: '<script src="/js/feednami-client.js"></script>' }))).toContain("tech-dev-feednami")
  })

  test("RunKit", () => {
    expect(fired(tx({ body: '<script src="https://embed.runkit.com"></script>' }))).toContain("tech-dev-runkit")
  })

  // --- Git hosting / SCM ---
  test("GitLab", () => {
    expect(fired(tx({ body: '<meta content="GitLab Community Edition" name="description">' }))).toContain("tech-dev-gitlab")
  })

  test("GitLab CI/CD", () => {
    expect(fired(tx({ body: '<img src="https://gitlab.com/user/repo/badges/main/pipeline.svg" alt="gitlab-ci.yml">' }))).toContain("tech-dev-gitlab-cicd")
  })

  test("Gitea", () => {
    expect(fired(tx({ body: '<meta name="author" content="Gitea - Git with a cup of tea"><footer>Powered by Gitea</footer>' }))).toContain("tech-dev-gitea")
  })

  test("Forgejo", () => {
    expect(fired(tx({ body: '<footer>Powered by Forgejo Version: 1.21</footer>' }))).toContain("tech-dev-forgejo")
  })

  test("Gogs", () => {
    expect(fired(tx({ body: '<footer>Powered by Gogs</footer>' }))).toContain("tech-dev-gogs")
  })

  test("Bitbucket", () => {
    expect(fired(tx({ body: '<link href="https://bitbucket.org/account/repo">' }))).toContain("tech-dev-bitbucket")
  })

  test("Subversion", () => {
    expect(fired(tx({ body: "<html><head><title>repos - Revision 1: /</title></head><body><h2>Collection of /svn/repos</h2>" }))).toContain("tech-dev-subversion")
  })

  test("git (smart HTTP)", () => {
    expect(fired(tx({ body: 'GET /repo.git/info/refs?service=git-upload-pack' }))).toContain("tech-dev-git")
  })

  test("gitweb", () => {
    expect(fired(tx({ body: '<link rel="stylesheet" href="/gitweb.cgi/static/gitweb.css">' }))).toContain("tech-dev-gitweb")
  })

  test("Gerrit", () => {
    expect(fired(tx({ body: '<title>Gerrit Code Review</title>' }))).toContain("tech-dev-gerrit")
  })

  test("Gitiles", () => {
    expect(fired(tx({ body: '<div class="Header-title">Gitiles</div>' }))).toContain("tech-dev-gitiles")
  })

  test("Phabricator", () => {
    expect(fired(tx({ respHeaders: [["x-phabricator-request-id", "abc123"]] }))).toContain("tech-dev-phabricator")
  })

  test("FishEye", () => {
    expect(fired(tx({ body: '<title>FishEye and Crucible</title>' }))).toContain("tech-dev-fisheye")
  })

  test("Artifactory via header", () => {
    expect(fired(tx({ respHeaders: [["x-jfrog-version", "Artifactory/7.55.0"]] }))).toContain("tech-dev-artifactory")
  })

  test("SonarQube", () => {
    expect(fired(tx({ body: '<script>window.sonar = {}; </script><title>SonarQube</title>' }))).toContain("tech-dev-sonarqube")
  })

  // --- Debug / profiling ---
  test("PHPDebugBar", () => {
    expect(fired(tx({ body: '<script src="/js/phpdebugbar.js"></script>' }))).toContain("tech-dev-phpdebugbar")
  })

  test("Clockwork via header", () => {
    expect(fired(tx({ respHeaders: [["x-clockwork-id", "1234567890"]] }))).toContain("tech-dev-clockwork")
  })

  test("Jira Issue Collector", () => {
    expect(fired(tx({ body: '<script src="https://mycompany.atlassian.net/s/d41d8cd/collector-plugin.js"></script>' }))).toContain("tech-dev-jira-collector")
  })

  // --- IDEs / dev environments ---
  test("Microsoft Visual Studio", () => {
    expect(fired(tx({ body: '<!-- Generator: Microsoft Visual Studio.NET 8.0 -->' }))).toContain("tech-dev-visual-studio")
  })

  test("Replit", () => {
    expect(fired(tx({ body: '<a href="https://replit.com/@user/project"><img src="/replit-badge.svg"></a>' }))).toContain("tech-dev-replit")
  })

  test("ClickOnce", () => {
    expect(fired(tx({ body: '<a href="https://app.example.com/MyApp.application?param=1">Install</a>' }))).toContain("tech-dev-clickonce")
  })

  test("Overwolf", () => {
    expect(fired(tx({ body: '<script src="https://console.overwolf.com/sdk.js"></script>' }))).toContain("tech-dev-overwolf")
  })

  // --- Low-code / app builders ---
  test("OutSystems", () => {
    expect(fired(tx({ body: '<script src="/OutSystems/osjs.js"></script>' }))).toContain("tech-dev-outsystems")
  })

  test("Mendix", () => {
    expect(fired(tx({ body: '<script src="/mxclientsystem/mxui/mxui.js"></script>' }))).toContain("tech-dev-mendix")
  })

  test("Retool", () => {
    expect(fired(tx({ body: '<div id="root" class="retool-app"></div>' }))).toContain("tech-dev-retool")
  })

  test("MindStudio", () => {
    expect(fired(tx({ body: '<script src="https://mindstudio.ai/embed.js"></script>' }))).toContain("tech-dev-mindstudio")
  })

  test("Anima", () => {
    expect(fired(tx({ body: '<script src="https://animaapp.com/scripts/anima.js"></script>' }))).toContain("tech-dev-anima")
  })

  test("genezio", () => {
    expect(fired(tx({ body: '<script>const url = "https://abc.genezio.com/api";</script>' }))).toContain("tech-dev-genezio")
  })

  test("SnapApp", () => {
    expect(fired(tx({ body: '<script src="https://snapapp.com/embed.js"></script>' }))).toContain("tech-dev-snapapp")
  })

  test("FormWise", () => {
    expect(fired(tx({ body: '<script src="https://formwise.ai/embed/abc.js"></script>' }))).toContain("tech-dev-formwise")
  })

  // --- CMS / DX ---
  test("Jahia DX", () => {
    expect(fired(tx({ body: '<script src="/modules/assets/jahia.js"></script>' }))).toContain("tech-dev-jahia")
  })

  test("Kuroco", () => {
    expect(fired(tx({ body: '<script>const api = "https://abc.kuroco.app";</script>' }))).toContain("tech-dev-kuroco")
  })

  test("EasyEngine", () => {
    expect(fired(tx({ respHeaders: [["x-powered-by", "EasyEngine"]] }))).toContain("tech-dev-easyengine")
  })

  test("SlickStack", () => {
    expect(fired(tx({ respHeaders: [["x-powered-by", "SlickStack"]] }))).toContain("tech-dev-slickstack")
  })

  test("WordPress Project Manager", () => {
    expect(fired(tx({ body: '<link href="/wp-content/plugins/wp-project-manager/assets/style.css">' }))).toContain("tech-dev-wp-project-manager")
  })

  test("Atarim", () => {
    expect(fired(tx({ body: '<script src="https://app.atarim.io/atarim-widget.js"></script>' }))).toContain("tech-dev-atarim")
  })

  // --- AI dev / chatbot builders ---
  test("YourGPT", () => {
    expect(fired(tx({ body: '<script src="https://widget.yourgpt.ai/chatbot.js"></script>' }))).toContain("tech-dev-yourgpt")
  })

  test("Stammer.ai", () => {
    expect(fired(tx({ body: '<script src="https://app.stammer.ai/widget.js"></script>' }))).toContain("tech-dev-stammer")
  })

  test("AskHandle", () => {
    expect(fired(tx({ body: '<script src="https://askhandle.com/handle-widget.js"></script>' }))).toContain("tech-dev-askhandle")
  })

  test("Intervo", () => {
    expect(fired(tx({ body: '<script src="https://intervo.ai/intervo-widget.js"></script>' }))).toContain("tech-dev-intervo")
  })

  test("Famous.ai", () => {
    expect(fired(tx({ body: '<script src="https://famous.ai/app.js"></script>' }))).toContain("tech-dev-famous-ai")
  })

  test("MarsX", () => {
    expect(fired(tx({ body: '<script>window.MarsX = "marsx.dev";</script>' }))).toContain("tech-dev-marsx")
  })

  // --- Presentation / misc ---
  test("Gamma", () => {
    expect(fired(tx({ body: '<script src="https://cdn.gamma.app/embed.js"></script>' }))).toContain("tech-dev-gamma")
  })

  test("Construct 3", () => {
    expect(fired(tx({ body: '<script src="c3runtime.js"></script>' }))).toContain("tech-dev-construct3")
  })

  test("CheerPJ", () => {
    expect(fired(tx({ body: '<script>cheerpjInit();</script>' }))).toContain("tech-dev-cheerpj")
  })

  test("Canyon", () => {
    expect(fired(tx({ body: '<script>window.__canyon__ = {};</script>' }))).toContain("tech-dev-canyon")
  })

  test("Conduit", () => {
    expect(fired(tx({ body: '<script src="https://getconduit.com/widget.js"></script>' }))).toContain("tech-dev-conduit")
  })

  test("Dimml", () => {
    expect(fired(tx({ body: '<script src="https://cdn.dimml.io/dimml.js"></script>' }))).toContain("tech-dev-dimml")
  })

  test("Tryzens", () => {
    expect(fired(tx({ body: '<script src="https://tryzens.com/assets/app.js"></script>' }))).toContain("tech-dev-tryzens")
  })

  test("Hexia", () => {
    expect(fired(tx({ body: '<script src="https://hexia.io/hexia-app.js"></script>' }))).toContain("tech-dev-hexia")
  })

  test("Thinkstack", () => {
    expect(fired(tx({ body: '<script src="https://thinkstack.ai/thinkstack-chatbot.js"></script>' }))).toContain("tech-dev-thinkstack")
  })

  test("Grain Harvest", () => {
    expect(fired(tx({ body: '<script>window.grainharvest = {};</script>' }))).toContain("tech-dev-grain-harvest")
  })

  test("Infinity", () => {
    expect(fired(tx({ body: '<a href="https://startinfinity.com/app">Open</a>' }))).toContain("tech-dev-startinfinity")
  })

  test("Rual", () => {
    expect(fired(tx({ body: '<script src="https://rual.io/embed.js"></script>' }))).toContain("tech-dev-rual")
  })

  test("LoopWeb", () => {
    expect(fired(tx({ body: '<script src="https://loopweb.io/loopweb-app.js"></script>' }))).toContain("tech-dev-loopweb")
  })

  test("Prisme", () => {
    expect(fired(tx({ body: '<script src="https://prisme.io/prismeanalytics.js"></script>' }))).toContain("tech-dev-prisme")
  })

  test("Developing Azerbaijan", () => {
    expect(fired(tx({ body: '<a href="https://developing.az">Developed by developing-azerbaijan</a>' }))).toContain("tech-dev-developing-azerbaijan")
  })

  test("Appifiny", () => {
    expect(fired(tx({ body: '<script src="https://appifiny.com/app.js"></script>' }))).toContain("tech-dev-appifiny")
  })

  test("DevBlox Hub", () => {
    expect(fired(tx({ body: '<script>window.DevBlox = "devblox.io";</script>' }))).toContain("tech-dev-devblox")
  })

  test("Yaghoot Web", () => {
    expect(fired(tx({ body: '<meta name="generator" content="Yaghoot"><a href="https://yaghoot.com">' }))).toContain("tech-dev-yaghoot")
  })

  // --- Structural ---
  test("a plain page triggers no development rules", () => {
    expect(fired(tx({ body: "<html><body>Hello world</body></html>" }))).toHaveLength(0)
  })

  test("all rule IDs start with tech-dev-", () => {
    for (const r of developmentRules) expect(r.id).toMatch(/^tech-dev-/)
  })

  test("all rules have development tag", () => {
    for (const r of developmentRules) expect(r.tags).toContain("development")
  })

  test("rule count is 79", () => {
    expect(developmentRules.length).toBe(79)
  })
})

import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, webServerRules } from "../src/index"

const rules = compileRules(webServerRules)
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
const S = (v: string): { respHeaders: [string, string][] } => ({ respHeaders: [["server", v]] })

const samples: [string, { body?: string; respHeaders?: [string, string][] }][] = [
  ["tech-ws-apache", S("Apache/2.4.57 (Ubuntu)")],
  ["tech-ws-nginx", S("nginx/1.25.3")],
  ["tech-ws-litespeed", S("LiteSpeed")],
  ["tech-ws-opengse", S("OpenGSE/0.9")],
  ["tech-ws-caddy", S("Caddy")],
  ["tech-ws-kestrel", S("Kestrel")],
  ["tech-ws-ms-httpapi", S("Microsoft-HTTPAPI/2.0")],
  ["tech-ws-weblogic", S("WebLogic Server 14.1.1")],
  ["tech-ws-angie", S("Angie/1.4.0")],
  ["tech-ws-ats", S("ATS/9.1.4")],
  ["tech-ws-apisix", S("APISIX/3.6.0")],
  ["tech-ws-jetty", S("Jetty(11.0.x)")],
  ["tech-ws-gws", S("gws")],
  ["tech-ws-ec2", { body: '<!-- host: ec2-12-34-56-78.compute-1.amazonaws.com -->' }],
  ["tech-ws-lighttpd", S("lighttpd/1.4.71")],
  ["tech-ws-ezproxy", S("EZproxy")],
  ["tech-ws-simplehttp", S("SimpleHTTP/0.6 Python/3.11")],
  ["tech-ws-tornado", S("TornadoServer/6.3.3")],
  ["tech-ws-jboss-as", S("JBoss-AS/7.1")],
  ["tech-ws-zope", S("Zope/2.13")],
  ["tech-ws-domino", S("Lotus-Domino")],
  ["tech-ws-centminmod", S("nginx centminmod")],
  ["tech-ws-miniserv", S("MiniServ/2.021")],
  ["tech-ws-twistedweb", S("TwistedWeb/20.3.0")],
  ["tech-ws-oracle-http", S("Oracle-HTTP-Server")],
  ["tech-ws-glassfish", S("GlassFish Server Open Source Edition 5.1")],
  ["tech-ws-jboss-web", S("JBossWeb/2.1.3")],
  ["tech-ws-resin", S("Resin/4.0.66")],
  ["tech-ws-kangle", S("kangle/3.5.21")],
  ["tech-ws-openbsd-httpd", S("OpenBSD httpd")],
  ["tech-ws-zend", S("Zend Server 9.1.0")],
  ["tech-ws-daphne", S("Daphne")],
  ["tech-ws-oracle-as", S("Oracle-Application-Server-10g")],
  ["tech-ws-cherrypy", S("CherryPy/18.8.0")],
  ["tech-ws-webrick", S("WEBrick/1.7.0")],
  ["tech-ws-couchdb", S("CouchDB/3.3.2")],
  ["tech-ws-hypercorn", S("hypercorn-h11")],
  ["tech-ws-h2o", S("h2o/2.2.6")],
  ["tech-ws-ibm-http", S("IBM_HTTP_Server")],
  ["tech-ws-goahead", S("GoAhead-Webs")],
  ["tech-ws-hhvm", { respHeaders: [["x-powered-by", "HHVM/4.128"]] }],
  ["tech-ws-cherokee", S("Cherokee/1.2.104")],
  ["tech-ws-roadrunner", { respHeaders: [["x-powered-by", "RoadRunner/2023.3"]] }],
  ["tech-ws-starlet", S("Starlet")],
  ["tech-ws-hiawatha", S("Hiawatha v11.5")],
  ["tech-ws-thttpd", S("thttpd/2.29")],
  ["tech-ws-indy", S("Indy/10.6.2")],
  ["tech-ws-hp-compact", S("HP Compact Server")],
  ["tech-ws-ferron", S("Ferron")],
  ["tech-ws-aolserver", S("AOLserver/4.5.1")],
  ["tech-ws-appweb", S("Appweb/7.2.2")],
  ["tech-ws-mongrel", S("Mongrel 1.1.5")],
  ["tech-ws-mini-httpd", S("mini_httpd/1.30")],
  ["tech-ws-monkey", S("Monkey/1.5.6")],
  ["tech-ws-libwww-perl", S("libwww-perl-daemon/6.05")],
  ["tech-ws-winstone", S("Winstone Servlet Engine v0.9")],
  ["tech-ws-nghttpx", S("nghttpx nghttp2/1.55.0")],
  ["tech-ws-xitami", S("Xitami")],
  ["tech-ws-elog", S("ELOG HTTP 3.1.4")],
  ["tech-ws-llamalink", S("LlamaLink Cloud Server")],
]

describe("web server fingerprint rules", () => {
  test("every rule has a sample and the sample fires it", () => {
    const ids = new Set(webServerRules.map((r) => r.id))
    const sampled = new Set(samples.map(([id]) => id))
    for (const id of ids) expect(sampled.has(id)).toBe(true)
    for (const [id, over] of samples) expect(fired(tx(over))).toContain(id)
  })
  test("a plain page with no server header triggers no web server rules", () => {
    expect(fired(tx({ body: "<html><body>Hello</body></html>" }))).toHaveLength(0)
  })
  test("all rule IDs start with tech-ws-", () => {
    for (const r of webServerRules) expect(r.id).toMatch(/^tech-ws-/)
  })
  test("all rules have web-server tag", () => {
    for (const r of webServerRules) expect(r.tags).toContain("web-server")
  })
  test("rule count is 60", () => {
    expect(webServerRules.length).toBe(60)
  })
})

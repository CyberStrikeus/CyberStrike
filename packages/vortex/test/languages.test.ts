import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, languageRules } from "../src/index"

const rules = compileRules(languageRules)
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

describe("programming language fingerprint rules", () => {
  test("PHP via x-powered-by", () => {
    expect(fired(tx({ respHeaders: [["x-powered-by", "PHP/8.2.10"]] }))).toContain("tech-lang-php")
  })
  test("PHP via cookie", () => {
    expect(fired(tx({ respHeaders: [["set-cookie", "PHPSESSID=abc; path=/"]] }))).toContain("tech-lang-php")
  })
  test("Java via JSESSIONID", () => {
    expect(fired(tx({ respHeaders: [["set-cookie", "JSESSIONID=abc; path=/"]] }))).toContain("tech-lang-java")
  })
  test("Node.js via x-powered-by Express", () => {
    expect(fired(tx({ respHeaders: [["x-powered-by", "Express"]] }))).toContain("tech-lang-nodejs")
  })
  test("Python via server gunicorn", () => {
    expect(fired(tx({ respHeaders: [["server", "gunicorn/21.2.0"]] }))).toContain("tech-lang-python")
  })
  test("TypeScript via source map", () => {
    expect(fired(tx({ body: '//# sourceMappingURL=app.ts.map' }))).toContain("tech-lang-typescript")
  })
  test("CFML via CFID cookie", () => {
    expect(fired(tx({ respHeaders: [["set-cookie", "CFID=1234; CFTOKEN=abcd"]] }))).toContain("tech-lang-cfml")
  })
  test("Ruby via Phusion Passenger", () => {
    expect(fired(tx({ respHeaders: [["server", "nginx + Phusion Passenger 6.0"]] }))).toContain("tech-lang-ruby")
  })
  test("Erlang via Cowboy", () => {
    expect(fired(tx({ respHeaders: [["server", "Cowboy"]] }))).toContain("tech-lang-erlang")
  })
  test("Perl via mod_perl", () => {
    expect(fired(tx({ respHeaders: [["server", "Apache/2.4 mod_perl/2.0.12"]] }))).toContain("tech-lang-perl")
  })
  test("Adobe Flash via swf", () => {
    expect(fired(tx({ body: '<embed src="/movie.swf" type="application/x-shockwave-flash">' }))).toContain("tech-lang-flash")
  })
  test("Go via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Go"]] }))).toContain("tech-lang-go")
  })
  test("Dart via main.dart.js", () => {
    expect(fired(tx({ body: '<script src="/main.dart.js"></script>' }))).toContain("tech-lang-dart")
  })
  test("C via x-powered-by", () => {
    expect(fired(tx({ respHeaders: [["x-powered-by", "C/11"]] }))).toContain("tech-lang-c")
  })
  test("Scala via PLAY_SESSION", () => {
    expect(fired(tx({ respHeaders: [["set-cookie", "PLAY_SESSION=abc; path=/"]] }))).toContain("tech-lang-scala")
  })
  test("WebAssembly via wasm", () => {
    expect(fired(tx({ body: '<script>WebAssembly.instantiate(bytes);</script>' }))).toContain("tech-lang-webassembly")
  })
  test("Elixir via Phoenix", () => {
    expect(fired(tx({ body: '<script src="/js/phoenix.js"></script>' }))).toContain("tech-lang-elixir")
  })
  test("Sass via source map", () => {
    expect(fired(tx({ body: '/*# sourceMappingURL=style.scss.map */' }))).toContain("tech-lang-sass")
  })
  test("XSLT via stylesheet", () => {
    expect(fired(tx({ body: '<?xml-stylesheet type="text/xsl" href="/transform.xsl"?>' }))).toContain("tech-lang-xslt")
  })
  test("Rust via actix", () => {
    expect(fired(tx({ respHeaders: [["server", "actix-web/4.0"]] }))).toContain("tech-lang-rust")
  })
  test("Lua via OpenResty", () => {
    expect(fired(tx({ respHeaders: [["server", "openresty/1.21.4.1"]] }))).toContain("tech-lang-lua")
  })
  test("GeneXus via body", () => {
    expect(fired(tx({ body: '<script>var GXState = {};</script>' }))).toContain("tech-lang-genexus")
  })
  test("KPHP via x-powered-by", () => {
    expect(fired(tx({ respHeaders: [["x-powered-by", "KPHP/1.0"]] }))).toContain("tech-lang-kphp")
  })
  test("Haskell via Warp", () => {
    expect(fired(tx({ respHeaders: [["server", "Warp/3.3.25"]] }))).toContain("tech-lang-haskell")
  })
  test("Kotlin via ktor", () => {
    expect(fired(tx({ respHeaders: [["server", "ktor"]] }))).toContain("tech-lang-kotlin")
  })
  test("Imba via body", () => {
    expect(fired(tx({ body: '<script src="/dist/imba.js"></script>' }))).toContain("tech-lang-imba")
  })

  // --- Structural ---
  test("a plain page triggers no language rules", () => {
    expect(fired(tx({ body: "<html><body>Hello world</body></html>" }))).toHaveLength(0)
  })
  test("all rule IDs start with tech-lang-", () => {
    for (const r of languageRules) expect(r.id).toMatch(/^tech-lang-/)
  })
  test("all rules have language tag", () => {
    for (const r of languageRules) expect(r.tags).toContain("language")
  })
  test("rule count is 25", () => {
    expect(languageRules.length).toBe(25)
  })
})

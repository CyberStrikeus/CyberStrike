// #40 P2 — THE detection guarantee for the sound rule pre-filter: over the REAL rule registry, the
// prefiltered run() must return EXACTLY what running every rule (runAll) returns, for every transaction.
// If pruning ever drops a rule that would have fired, run ⊊ runAll and this fails. Covers transactions
// that trigger many rules (secrets, SQL/stack/error signatures, banners, tech markers) and ones that
// trigger none, plus seeded-random noise.
import { describe, expect, test } from "bun:test"
import type { Transaction, Signal } from "../src/index"
import { defaultRegistry } from "../src/index"

let n = 0
function tx(opts: {
  url?: string
  method?: string
  reqHeaders?: [string, string][]
  status?: number
  resHeaders?: [string, string][]
  body?: string
}): Transaction {
  return {
    id: `t${n++}`,
    source: "browser",
    host: "app.test",
    request: {
      method: opts.method ?? "GET",
      url: `https://app.test${opts.url ?? "/"}`,
      headers: (opts.reqHeaders ?? []).map(([name, value]) => ({ name, value })),
    },
    response: {
      status: opts.status ?? 200,
      headers: (opts.resHeaders ?? [["content-type", "text/html"]]).map(([name, value]) => ({ name, value })),
      body: opts.body ?? "",
    },
  }
}

const registry = defaultRegistry()
const norm = (s: Signal[]) => s.map((x) => `${x.ruleId}|${x.transactionId}`).sort()

function assertEquivalent(t: Transaction) {
  expect(norm(registry.run(t))).toEqual(norm(registry.runAll(t)))
}

describe("sound prefilter run() ≡ runAll() over the real registry (#40 P2)", () => {
  test("trigger-rich and trigger-free transactions match exactly", () => {
    const cases: Transaction[] = [
      tx({ body: "You have an error in your SQL syntax near '1'", status: 500 }), // sql-error
      tx({ body: 'var k="AKIAABCDEFGHIJKLMNOP";', resHeaders: [["content-type", "application/javascript"]] }), // secret
      tx({ body: "Traceback (most recent call last):\n  File x.py" }), // stack trace
      tx({ status: 200, resHeaders: [["server", "Apache/2.4.49"], ["x-powered-by", "Express"]], body: "<html>ok</html>" }), // banner/tech
      tx({ resHeaders: [["set-cookie", "sid=abc; Path=/"]], body: "<html></html>" }), // cookie flags
      tx({ body: "-----BEGIN RSA PRIVATE KEY-----\nMII...", resHeaders: [["content-type", "text/plain"]] }), // private key
      tx({ url: "/api/account/1005", status: 200, body: "{}" }), // clean api
      tx({ body: "<html>a perfectly ordinary page with nothing interesting</html>" }), // no triggers
      tx({ body: "", status: 404, resHeaders: [] }), // empty
      tx({ url: "/search?q=hello", body: JSON.stringify({ results: [], ok: true }) }),
    ]
    for (const c of cases) assertEquivalent(c)
  })

  test("seeded-random transactions match exactly", () => {
    const words = ["ok", "error", "SQL", "syntax", "AKIA", "Express", "Apache", "Traceback", "token", "user", "<html>", "json"]
    for (let seed = 1; seed <= 40; seed++) {
      let s = seed * 2246822519
      const rng = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
      const len = Math.floor(rng() * 8)
      let body = ""
      for (let i = 0; i < len; i++) body += words[Math.floor(rng() * words.length)] + " "
      assertEquivalent(
        tx({
          url: `/p/${Math.floor(rng() * 3000)}`,
          status: rng() < 0.8 ? 200 : 500,
          resHeaders: rng() < 0.5 ? [["server", "nginx"]] : [["content-type", "application/json"]],
          body,
        }),
      )
    }
  })
})

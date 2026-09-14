// Verifies the boolean / operator DIFFERENTIAL for nosql, ldap and xpath — not just error signatures.
// (The capability already exists in errsig.ts via boolPairs + the nosql operator block; these lock it
// in end-to-end so a confirmation channel beyond FP-prone error strings is proven for each class.)
import { describe, test, expect } from "bun:test"
import { probeErrorSigPoint } from "../../../src/tool/inject-probe/probe/errsig"
import type { HttpSender } from "../../../src/tool/inject-probe/send"
import type { ResolvedRequest, SendBudget, InjPoint } from "../../../src/tool/inject-probe/types"

const makeR = (): ResolvedRequest => ({
  method: "GET",
  url: new URL("http://example.com/search?q=test"),
  headers: {},
  body: "",
  contentType: "",
  auth: { source: "none" },
  provenance: { fromRaw: false, reconstructed: false, bodyMaybeTruncated: false },
})
const point: InjPoint = { location: "query", name: "q" }
const budget = (max = 500): SendBudget => ({ sent: 0, max })
const sig = () => new AbortController().signal
const BIG = "row ".repeat(200) // TRUE branch — many results
const SMALL = "none" // FALSE branch — no results
const BASE = "normal page content here"

describe("errsig boolean/operator differential (confirmation beyond error signatures)", () => {
  test("XPath: ' or '1'='1 (true) vs ' or '1'='2 (false) → differential", async () => {
    const sender: HttpSender = {
      send: async (req) => {
        const v = new URL(req.url).searchParams.get("q") ?? ""
        if (/'1'='1|"1"="1|[^=]1 or 1=1|or true\(\)|"\) or \("1"="1/.test(v)) return { status: 200, body: BIG, headers: {} }
        if (/'1'='2|"1"="2|1 or 1=2|or false\(\)/.test(v)) return { status: 200, body: SMALL, headers: {} }
        return { status: 200, body: BASE, headers: {} }
      },
    }
    const obs = await probeErrorSigPoint(sender, makeR(), point, "xpath", sig(), 0, budget())
    expect(obs.bool_findings.some((b) => b.differential)).toBe(true)
  })

  test("LDAP: *)(cn=*) (matches all) vs a no-match filter → differential", async () => {
    const sender: HttpSender = {
      send: async (req) => {
        const v = new URL(req.url).searchParams.get("q") ?? ""
        if (v.includes("nomatch")) return { status: 200, body: SMALL, headers: {} }
        if (/\*\)\((cn|objectClass)=\*\)|\*\)\(\|\(cn=\*\)/.test(v)) return { status: 200, body: BIG, headers: {} }
        return { status: 200, body: BASE, headers: {} }
      },
    }
    const obs = await probeErrorSigPoint(sender, makeR(), point, "ldap", sig(), 0, budget())
    expect(obs.bool_findings.some((b) => b.differential)).toBe(true)
  })

  test("NoSQL: q[$ne]=x (matches all) vs q[$eq]=x (no match) → operator differential", async () => {
    const sender: HttpSender = {
      send: async (req) => {
        const s = decodeURIComponent(new URL(req.url).search)
        if (/\[\$ne\]|\[\$regex\]=\.\*|\[\$gt\]/.test(s)) return { status: 200, body: BIG, headers: {} }
        if (/\[\$eq\]|\[\$regex\]=\^|\[\$lt\]/.test(s)) return { status: 200, body: SMALL, headers: {} }
        return { status: 200, body: BASE, headers: {} }
      },
    }
    const obs = await probeErrorSigPoint(sender, makeR(), point, "nosql", sig(), 0, budget())
    expect(obs.bool_findings.some((b) => b.differential)).toBe(true)
  })

  test("uniform response (no differential) → nothing flagged, not a false positive", async () => {
    const sender: HttpSender = { send: async () => ({ status: 200, body: BASE, headers: {} }) }
    const obs = await probeErrorSigPoint(sender, makeR(), point, "xpath", sig(), 0, budget())
    expect(obs.bool_findings.every((b) => !b.differential)).toBe(true)
  })
})

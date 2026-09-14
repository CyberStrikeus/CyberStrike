import { describe, test, expect } from "bun:test"
import { probeCrlfPoint } from "../../../src/tool/inject-probe/probe/crlf"
import type { HttpSender } from "../../../src/tool/inject-probe/send"
import type { ResolvedRequest, SendBudget, InjPoint } from "../../../src/tool/inject-probe/types"

const makeR = (): ResolvedRequest => ({
  method: "GET",
  url: new URL("http://example.com/redirect?next=/home"),
  headers: {},
  body: "",
  contentType: "",
  auth: { source: "none" },
  provenance: { fromRaw: false, reconstructed: false, bodyMaybeTruncated: false },
})
const budget = (max = 20): SendBudget => ({ sent: 0, max })
const sig = () => new AbortController().signal
const qp: InjPoint = { location: "query", name: "next" }

// A vulnerable app that reflects the raw param value into a response header (e.g. Location), so a
// CR-LF in the value splits out our injected header.
const splittingSender: HttpSender = {
  send: async (req) => {
    const next = new URL(req.url).searchParams.get("next") ?? ""
    const headers: Record<string, string> = { location: `/app` }
    // naive: echo the decoded value into the response header block verbatim (the vuln)
    for (const line of next.split(/\r\n/)) {
      const idx = line.indexOf(":")
      if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim()
    }
    return { status: 302, body: "", headers }
  },
}
// A safe app that URL-encodes / strips CR-LF before reflecting — no header appears.
const safeSender: HttpSender = { send: async () => ({ status: 302, body: "", headers: { location: "/app" } }) }

describe("probeCrlfPoint", () => {
  test("param reflected into a response header → injected header detected", async () => {
    const obs = await probeCrlfPoint(splittingSender, makeR(), qp, sig(), 0, budget())
    expect(obs.injected_header).toBe(true)
    expect(obs.header_name).toBe("set-cookie") // we inject an allowlist-surviving Set-Cookie
    expect(obs.evidence).toContain("crlf") // the unique marker prefix
    expect(obs.set_cookie_injected).toBe(true)
  })

  test("Set-Cookie split is flagged as a session-fixation surface", async () => {
    const cookieSplitter: HttpSender = {
      send: async (req) => {
        const next = new URL(req.url).searchParams.get("next") ?? ""
        const headers: Record<string, string> = {}
        for (const line of next.split(/\r\n/)) {
          const idx = line.indexOf(":")
          if (idx > 0) {
            // route the injected header into Set-Cookie to simulate cookie injection
            const name = line.slice(0, idx).trim()
            headers["set-cookie"] = `${name}=${line.slice(idx + 1).trim()}`
          }
        }
        return { status: 200, body: "", headers }
      },
    }
    const obs = await probeCrlfPoint(cookieSplitter, makeR(), qp, sig(), 0, budget())
    expect(obs.injected_header).toBe(true)
    expect(obs.set_cookie_injected).toBe(true)
  })

  test("safe app (CR-LF stripped) → no injection", async () => {
    const obs = await probeCrlfPoint(safeSender, makeR(), qp, sig(), 0, budget())
    expect(obs.injected_header).toBe(false)
  })

  test("header/cookie source points are skipped (self-sanitized) with a note", async () => {
    const obs = await probeCrlfPoint(splittingSender, makeR(), { location: "header", name: "referer" }, sig(), 0, budget())
    expect(obs.injected_header).toBe(false)
    expect(obs.note).toContain("sanitized")
  })

  test("blocked response → flagged, not a false positive", async () => {
    const blocker: HttpSender = { send: async () => ({ status: 403, body: "no", headers: {} }) }
    const obs = await probeCrlfPoint(blocker, makeR(), qp, sig(), 0, budget())
    expect(obs.blocked).toBe(true)
    expect(obs.injected_header).toBe(false)
  })
})

import { describe, test, expect } from "bun:test"
import { OobStore } from "../../src/oob/store"
import { OobDns } from "../../src/oob/dns"

const BASE = "oob.example.com"

describe("OobStore — token correlation (#85)", () => {
  test("tokenOf extracts the label adjacent to the base domain", () => {
    const tok = OobStore.mint()
    expect(OobStore.tokenOf(`${tok}.${BASE}`, BASE)).toBe(tok)
    expect(OobStore.tokenOf(`extra.${tok}.${BASE}`, BASE)).toBe(tok) // target prepended a label → still correlates
    expect(OobStore.tokenOf(`${tok}.${BASE}.`, BASE)).toBe(tok) // trailing dot (FQDN)
    expect(OobStore.tokenOf("www.google.com", BASE)).toBeUndefined() // not ours
    expect(OobStore.tokenOf(BASE, BASE)).toBeUndefined() // the bare base, no token
  })

  test("capture + poll correlates a callback to its token; mint is unique", () => {
    const tok = OobStore.mint()
    OobStore.clear(tok)
    expect(OobStore.poll(tok).length).toBe(0) // no callback yet = not confirmed
    const matched = OobStore.capture(`${tok}.${BASE}`, BASE, { protocol: "dns", remoteAddr: "9.9.9.9", at: Date.now(), detail: "A query" })
    expect(matched).toBe(tok)
    const hits = OobStore.poll(tok)
    expect(hits.length).toBe(1)
    expect(hits[0].protocol).toBe("dns")
    expect(OobStore.mint()).not.toBe(OobStore.mint()) // unique
  })

  test("capture ignores hosts not under the base domain", () => {
    expect(OobStore.capture("evil.com", BASE, { protocol: "http", remoteAddr: "1.1.1.1", at: 0, detail: "GET /" })).toBeUndefined()
  })
})

describe("OobDns — minimal wire format (#85)", () => {
  function query(name: string, qtype = 1): Buffer {
    const header = Buffer.alloc(12)
    header.writeUInt16BE(0x1234, 0) // id
    header.writeUInt16BE(0x0100, 2) // RD
    header.writeUInt16BE(1, 4) // qdcount
    const qname = OobDns.encodeName(name)
    const tail = Buffer.alloc(4)
    tail.writeUInt16BE(qtype, 0) // QTYPE
    tail.writeUInt16BE(1, 2) // QCLASS IN
    return Buffer.concat([header, qname, tail])
  }

  test("parseQuery reads the QNAME + QTYPE", () => {
    const tok = "abc123"
    const q = OobDns.parseQuery(query(`${tok}.${BASE}`, 1))
    expect(q).toBeDefined()
    expect(q!.qname).toBe(`${tok}.${BASE}`)
    expect(q!.qtype).toBe(1)
    expect(q!.id).toBe(0x1234)
  })

  test("buildResponse echoes the question and answers A with the configured IP", () => {
    const buf = query(`x.${BASE}`, 1)
    const q = OobDns.parseQuery(buf)!
    const resp = OobDns.buildResponse(buf, q, "203.0.113.7")
    expect(resp.readUInt16BE(0)).toBe(0x1234) // same id
    expect(resp.readUInt16BE(2) & 0x8000).toBe(0x8000) // QR=1 (response)
    expect(resp.readUInt16BE(6)).toBe(1) // ancount = 1
    // last 4 bytes of the A-record RDATA = the IP octets
    const n = resp.length
    expect([resp[n - 4], resp[n - 3], resp[n - 2], resp[n - 1]]).toEqual([203, 0, 113, 7])
  })

  test("parseQuery drops a malformed packet", () => {
    expect(OobDns.parseQuery(Buffer.from([0, 1, 2]))).toBeUndefined()
  })
})

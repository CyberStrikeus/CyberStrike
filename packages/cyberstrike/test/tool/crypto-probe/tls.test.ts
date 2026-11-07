import { describe, test, expect } from "bun:test"
import { classifyCipher, classifyProtocol, classifyCert } from "../../../src/tool/crypto-probe/tls"

const NOW = Date.parse("Jun 1 00:00:00 2026 GMT")

describe("crypto-probe/tls", () => {
  test("classifyCipher flags weak families, passes modern AEAD", () => {
    expect(classifyCipher("ECDHE-RSA-RC4-SHA")?.kind).toBe("weak-cipher")
    expect(classifyCipher("DES-CBC3-SHA")?.kind).toBe("weak-cipher")
    expect(classifyCipher("TLS_NULL_WITH_NULL_NULL")?.kind).toBe("weak-cipher")
    expect(classifyCipher("TLS_AES_128_GCM_SHA256")).toBeUndefined()
    expect(classifyCipher(undefined)).toBeUndefined()
  })

  test("classifyProtocol flags weak negotiated + accepted legacy", () => {
    expect(classifyProtocol("TLSv1.3", [])).toHaveLength(0)
    expect(classifyProtocol("TLSv1", []).map((f) => f.kind)).toEqual(["weak-protocol-negotiated"])
    const legacy = classifyProtocol("TLSv1.2", ["TLSv1", "TLSv1.1"])
    expect(legacy.map((f) => f.kind)).toEqual(["legacy-protocol-accepted", "legacy-protocol-accepted"])
  })

  test("classifyCert: expired", () => {
    const f = classifyCert({ valid_to: "Jan 1 00:00:00 2020 GMT", subject: { CN: "x.com" }, subjectaltname: "DNS:x.com" }, "x.com", NOW)
    expect(f.map((x) => x.kind)).toContain("cert-expired")
  })

  test("classifyCert: self-signed (issuer == subject)", () => {
    const cert = { subject: { CN: "self.com" }, issuer: { CN: "self.com" }, valid_to: "Jan 1 2030 GMT", subjectaltname: "DNS:self.com" }
    expect(classifyCert(cert, "self.com", NOW).map((x) => x.kind)).toContain("cert-self-signed")
  })

  test("classifyCert: hostname mismatch, with wildcard support", () => {
    const cert = { subject: { CN: "example.com" }, issuer: { CN: "CA" }, valid_to: "Jan 1 2030 GMT", subjectaltname: "DNS:example.com, DNS:*.example.com" }
    expect(classifyCert(cert, "api.example.com", NOW).map((x) => x.kind)).not.toContain("cert-hostname-mismatch") // *.example.com matches
    expect(classifyCert(cert, "evil.org", NOW).map((x) => x.kind)).toContain("cert-hostname-mismatch")
    // wildcard is one label only: a.b.example.com must NOT match *.example.com
    expect(classifyCert(cert, "a.b.example.com", NOW).map((x) => x.kind)).toContain("cert-hostname-mismatch")
  })

  test("classifyCert: a valid, matching, CA-chained cert yields nothing", () => {
    const cert = { subject: { CN: "good.com" }, issuer: { CN: "Real CA" }, valid_from: "Jan 1 2025 GMT", valid_to: "Jan 1 2030 GMT", subjectaltname: "DNS:good.com" }
    expect(classifyCert(cert, "good.com", NOW)).toHaveLength(0)
  })
})

import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, tlsCaRules } from "../src/index"

const rules = compileRules(tlsCaRules)
function tx(over: { body?: string; tls?: { issuer?: string } }): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: "https://app.test/", headers: [] },
    response: { status: 200, headers: [], body: over.body ?? "" },
    tls: over.tls,
  }
}
const fired = (t: Transaction) => rules.flatMap((r) => r.evaluate(t)).map((s) => s.ruleId)

describe("TLS CA fingerprint rules", () => {
  // --- tls.issuer path (proxy/extension with cert access) ---
  test("sectigo via tls.issuer", () => {
    expect(fired(tx({ tls: { issuer: "Sectigo RSA Domain Validation Secure Server CA" } }))).toContain("tech-ca-sectigo")
  })

  test("sectigo via comodo issuer (legacy name)", () => {
    expect(fired(tx({ tls: { issuer: "COMODO RSA Domain Validation Secure Server CA" } }))).toContain("tech-ca-sectigo")
  })

  test("aws acm via tls.issuer", () => {
    expect(fired(tx({ tls: { issuer: "Amazon RSA 2048 M02" } }))).toContain("tech-ca-aws-acm")
  })

  test("digicert via tls.issuer", () => {
    expect(fired(tx({ tls: { issuer: "DigiCert Global G2 TLS RSA SHA256 2020 CA1" } }))).toContain("tech-ca-digicert")
  })

  test("thawte via tls.issuer", () => {
    expect(fired(tx({ tls: { issuer: "Thawte TLS RSA CA G1" } }))).toContain("tech-ca-thawte")
  })

  test("letsencrypt via tls.issuer", () => {
    expect(fired(tx({ tls: { issuer: "Let's Encrypt Authority X3" } }))).toContain("tech-ca-letsencrypt")
    expect(fired(tx({ tls: { issuer: "ISRG Root X1" } }))).toContain("tech-ca-letsencrypt")
  })

  test("identrust via tls.issuer", () => {
    expect(fired(tx({ tls: { issuer: "IdenTrust Commercial Root CA 1" } }))).toContain("tech-ca-identrust")
  })

  test("entrust via tls.issuer", () => {
    expect(fired(tx({ tls: { issuer: "Entrust Certification Authority - L1K" } }))).toContain("tech-ca-entrust")
  })

  // --- body path (site seal detection) ---
  test("sectigo site seal in body", () => {
    expect(fired(tx({ body: '<script src="https://seal.sectigo.com/getseal?host=app.test"></script>' }))).toContain("tech-ca-sectigo")
  })

  test("digicert seal in body", () => {
    expect(fired(tx({ body: '<span id="DigiCertClickID_seal"></span>' }))).toContain("tech-ca-digicert")
    expect(fired(tx({ body: '<script src="https://seal.digicert.com/seals/cascade/seal.min.js">' }))).toContain("tech-ca-digicert")
  })

  test("thawte seal in body", () => {
    expect(fired(tx({ body: '<script src="https://seal.thawte.com/getseal?host=app.test">' }))).toContain("tech-ca-thawte")
  })

  test("entrust seal in body", () => {
    expect(fired(tx({ body: '<script src="https://seal.entrust.net/sealv3.js">' }))).toContain("tech-ca-entrust")
  })

  // --- false positive guard ---
  test("plain HTTPS page triggers no CA rules", () => {
    expect(fired(tx({ body: "<html><body>Secure page</body></html>" }))).toHaveLength(0)
  })

  test("no tls object triggers no CA rules", () => {
    expect(fired(tx({}))).toHaveLength(0)
  })

  // --- structural ---
  test("all rule IDs start with tech-ca-", () => {
    for (const r of tlsCaRules) expect(r.id).toMatch(/^tech-ca-/)
  })

  test("all rules have tls-ca tag", () => {
    for (const r of tlsCaRules) expect(r.tags).toContain("tls-ca")
  })

  test("all rules dedup by host (one signal per CA per host)", () => {
    for (const r of tlsCaRules) expect(r.dedupBy).toBe("host")
  })

  test("rule count is 7", () => {
    expect(tlsCaRules.length).toBe(7)
  })
})

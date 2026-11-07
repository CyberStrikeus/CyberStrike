import { describe, expect, test } from "bun:test"
import { JsSecrets } from "../../../src/session/web/js-secrets"

const types = (text: string) => JsSecrets.scan(text).map((s) => s.type)

// All values below are synthetic/format-only — never real credentials.
describe("JsSecrets.scan — known-format detection", () => {
  test("AWS access key id", () => {
    expect(types(`const k = "AKIA${"A".repeat(16)}"`)).toContain("aws-access-key-id")
  })
  test("Google API key", () => {
    expect(types(`key: "AIza${"x".repeat(35)}"`)).toContain("google-api-key")
  })
  test("GitHub token", () => {
    expect(types(`"ghp_${"a".repeat(36)}"`)).toContain("github-token")
  })
  test("Slack token + webhook", () => {
    expect(types(`"xoxb-${"a".repeat(20)}"`)).toContain("slack-token")
    expect(types(`"https://hooks.slack.com/services/T00/B00/xyz"`)).toContain("slack-webhook")
  })
  test("Stripe secret key", () => {
    expect(types(`"sk_live_${"a".repeat(24)}"`)).toContain("stripe-secret-key")
  })
  test("private key block", () => {
    expect(types(`"-----BEGIN RSA PRIVATE KEY-----\\n..."`)).toContain("private-key")
  })
  test("JWT", () => {
    expect(types(`token="eyJ${"a".repeat(10)}.${"b".repeat(10)}.${"c".repeat(10)}"`)).toContain("jwt")
  })
  test("generic sensitive assignment", () => {
    expect(types(`clientSecret: "abcdef123456"`)).toContain("generic-secret-assignment")
  })
})

describe("JsSecrets.scan — precision + redaction", () => {
  test("no false positives on ordinary code", () => {
    expect(JsSecrets.scan(`const version = "1.2.3"; const msg = "hello world"; let n = 42;`)).toEqual([])
  })
  test("short/placeholder assignments below the length floor are ignored", () => {
    expect(types(`password: "1234"`)).toEqual([]) // < 8 chars → not flagged
  })
  test("the raw value is never in the preview (redacted first4…last4)", () => {
    const raw = "AKIA" + "Z".repeat(16)
    const s = JsSecrets.scan(`k="${raw}"`)[0]
    expect(s.preview).not.toBe(raw)
    expect(s.preview).toContain("…")
    expect(s.preview).toContain("20 chars")
  })
  test("dedupes a value repeated in the source", () => {
    const raw = "AKIA" + "Q".repeat(16)
    expect(JsSecrets.scan(`a="${raw}"; b="${raw}"`).length).toBe(1)
  })
})

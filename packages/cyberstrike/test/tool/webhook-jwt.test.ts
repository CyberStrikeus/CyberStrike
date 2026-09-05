import { describe, expect, test } from "bun:test"
import { Jwt } from "../../src/tool/webhook/authn/jwt"

// Canonical jwt.io HS256 example, signed with the secret "secret".
// header {alg:HS256,typ:JWT} · payload {sub:"1234567890",name:"John Doe",iat:1516239022}
const REF =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"

describe("Jwt.decode", () => {
  test("decodes a real reference token", () => {
    const d = Jwt.decode(REF)
    expect(d.header).toEqual({ alg: "HS256", typ: "JWT" })
    expect(d.payload.sub).toBe("1234567890")
    expect(d.payload.name).toBe("John Doe")
    expect(d.signingInput).toBe(REF.split(".").slice(0, 2).join("."))
  })
  test("rejects a malformed token (wrong part count)", () => {
    expect(() => Jwt.decode("a.b")).toThrow()
    expect("error" in Jwt.tryDecode("a.b")).toBe(true)
  })
  test("rejects a non-JSON segment", () => {
    // 'zzzz' base64url-decodes to bytes that are not a JSON object
    expect("error" in Jwt.tryDecode("zzzz.zzzz.sig")).toBe(true)
  })
})

describe("Jwt HS256 verify + crack", () => {
  test("verifies the reference token with the correct secret only (matches an external signer)", () => {
    // The jwt.io reference token is signed with "your-256-bit-secret" (independently
    // confirmed via raw HMAC-SHA256) — proof our HMAC matches an external signer byte-for-byte.
    expect(Jwt.verifyHS256(REF, "your-256-bit-secret")).toBe(true)
    expect(Jwt.verifyHS256(REF, "secret")).toBe(false)
    expect(Jwt.verifyHS256(REF, "wrong")).toBe(false)
  })
  test("sign→verify round-trips", () => {
    const t = Jwt.signHS256({ typ: "JWT" }, { sub: "u1", role: "user" }, "topsecret")
    expect(Jwt.verifyHS256(t, "topsecret")).toBe(true)
    expect(Jwt.verifyHS256(t, "nope")).toBe(false)
  })
  test("crackHS256 finds a weak secret and returns null for a strong one", () => {
    expect(Jwt.crackHS256(REF, Jwt.WEAK_SECRETS)).toBe("your-256-bit-secret")
    const strong = Jwt.signHS256({}, { sub: "x" }, "a-very-long-unguessable-secret-9f83")
    expect(Jwt.crackHS256(strong, Jwt.WEAK_SECRETS)).toBeNull()
  })
  test("verifyHS256 is false for a non-HS256 (alg:none) token", () => {
    const none = Jwt.encodeNone({ alg: "HS256" }, { sub: "x" })
    expect(Jwt.verifyHS256(none, "secret")).toBe(false)
  })
})

describe("Jwt attack primitives", () => {
  test("encodeNone yields an empty-signature token that decodes back with alg:none", () => {
    const t = Jwt.encodeNone({ alg: "HS256", typ: "JWT" }, { sub: "1", admin: false })
    expect(t.endsWith(".")).toBe(true)
    const d = Jwt.decode(t)
    expect(d.header.alg).toBe("none")
    expect(d.signature).toBe("")
  })
  test("case-variant alg (None/NONE) preserved for verifier-bypass probing", () => {
    expect(Jwt.decode(Jwt.encodeNone({}, {}, "None")).header.alg).toBe("None")
    expect(Jwt.decode(Jwt.encodeNone({}, {}, "NONE")).header.alg).toBe("NONE")
  })
  test("forgeAlgNone applies payload overrides", () => {
    const t = Jwt.forgeAlgNone(REF, { setPayload: { role: "admin" } })
    const d = Jwt.decode(t)
    expect(d.header.alg).toBe("none")
    expect(d.payload.role).toBe("admin")
    expect(d.payload.sub).toBe("1234567890") // original claims preserved
  })
  test("rs256ToHS256 confusion: signs with the public key as HMAC secret (primitive verifiable)", () => {
    const fakePubKey = "-----BEGIN PUBLIC KEY-----\nMFwwDQYJ...FAKE...AQAB\n-----END PUBLIC KEY-----"
    const rs = Jwt.signHS256({ alg: "RS256" }, { sub: "1" }, "irrelevant") // start as an RS256-looking token
    const forged = Jwt.rs256ToHS256(rs, fakePubKey, { role: "admin" })
    expect(Jwt.decode(forged).header.alg).toBe("HS256")
    expect(Jwt.decode(forged).payload.role).toBe("admin")
    // A server that (wrongly) HMAC-verifies with its public key would accept this:
    expect(Jwt.verifyHS256(forged, fakePubKey)).toBe(true)
  })
  test("tamper: with key + HS256 re-signs; without key falls back to alg:none", () => {
    const signed = Jwt.tamper(REF, { setPayload: { role: "admin" }, key: "secret" })
    expect(Jwt.verifyHS256(signed, "secret")).toBe(true)
    expect(Jwt.decode(signed).payload.role).toBe("admin")

    const noneTok = Jwt.encodeNone({ alg: "none" }, { sub: "1" })
    expect(Jwt.decode(Jwt.tamper(noneTok, { setPayload: { admin: true } })).header.alg).toBe("none")
  })
})

describe("Jwt.analyze", () => {
  test("flags symmetric alg + id claim on the reference token", () => {
    const a = Jwt.analyze(REF)
    expect(a.valid).toBe(true)
    expect(a.symmetric).toBe(true)
    expect(a.algNone).toBe(false)
    expect(a.idClaims).toContain("sub")
    expect(a.expNever).toBe(true) // REF has no exp
  })
  test("flags alg:none", () => {
    expect(Jwt.analyze(Jwt.encodeNone({}, { sub: "1" })).algNone).toBe(true)
  })
  test("flags header-injection vectors (kid/jku)", () => {
    const t = Jwt.signHS256({ kid: "../../dev/null", jku: "https://evil/x" }, { sub: "1" }, "k")
    const a = Jwt.analyze(t)
    expect(a.headerInjection).toContain("kid")
    expect(a.headerInjection).toContain("jku")
  })
  test("detects role claims and expiry", () => {
    const expired = Jwt.signHS256({}, { sub: "1", role: "user", exp: 1 }, "k")
    const a = Jwt.analyze(expired)
    expect(a.escalationClaims).toContain("role")
    expect(a.expired).toBe(true)
  })
  test("invalid token → valid:false with an error", () => {
    const a = Jwt.analyze("not-a-jwt")
    expect(a.valid).toBe(false)
    expect(a.error).toBeDefined()
  })
})

describe("Jwt.escalationCandidates", () => {
  test("mints alg:none + role + id-swap forged tokens, each carrying the mutation", () => {
    const src = Jwt.signHS256({}, { sub: "5", role: "user" }, "k")
    const cands = Jwt.escalationCandidates(src)
    const names = cands.map((c) => c.name)
    expect(names).toContain("alg-none")
    expect(names).toContain("role=admin")
    expect(names).toContain("sub=1")
    expect(names).toContain("sub=admin")
    // every candidate is an alg:none forgery carrying its stated mutation
    const role = cands.find((c) => c.name === "role=admin")!
    const d = Jwt.decode(role.token)
    expect(d.header.alg).toBe("none")
    expect(d.payload.role).toBe("admin")
  })
  test("no id/role claims → only the alg:none candidate", () => {
    const src = Jwt.signHS256({}, { foo: "bar" }, "k")
    const cands = Jwt.escalationCandidates(src)
    expect(cands).toHaveLength(1)
    expect(cands[0].name).toBe("alg-none")
  })
  test("invalid token → no candidates", () => {
    expect(Jwt.escalationCandidates("bad")).toHaveLength(0)
  })
})

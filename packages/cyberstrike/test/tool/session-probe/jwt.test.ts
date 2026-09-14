import { describe, test, expect } from "bun:test"
import { createHmac } from "node:crypto"
import {
  parseJwt,
  findJwts,
  verifyHmac,
  findWeakSecret,
  forgeNone,
  forgeTamperedClaim,
  forgeResigned,
  forgeAlgConfusion,
  forgeKidEmptyKey,
  analyzeJwtStatic,
} from "../../../src/tool/session-probe/jwt"

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url")
}
// Mint a real HS256 JWT so the crypto path is exercised, not mocked.
function signHs256(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" }
  const input = `${b64url(header)}.${b64url(payload)}`
  const sig = createHmac("sha256", secret).update(input).digest("base64url")
  return `${input}.${sig}`
}

describe("session-probe/jwt", () => {
  test("parseJwt decodes header + payload; rejects non-JWT", () => {
    const t = signHs256({ sub: "u1", role: "user" }, "secret")
    const j = parseJwt(t)
    expect(j?.header.alg).toBe("HS256")
    expect(j?.payload.sub).toBe("u1")
    expect(parseJwt("not.a.jwt")).toBeUndefined()
    expect(parseJwt("onlyonepart")).toBeUndefined()
  })

  test("findJwts locates tokens in Cookie and Authorization", () => {
    const t = signHs256({ sub: "u1" }, "secret")
    const found = findJwts([
      { name: "Cookie", value: `theme=dark; session=${t}; other=1` },
      { name: "Authorization", value: `Bearer ${t}` },
      { name: "Accept", value: "text/html" },
    ])
    expect(found.map((f) => f.location).sort()).toEqual(["cookie:session", "header:authorization"])
    expect(found.every((f) => f.jwt.payload.sub === "u1")).toBe(true)
  })

  test("weak-secret dictionary attack verifies a token signed with a known secret", () => {
    const t = signHs256({ sub: "u1" }, "secret")
    const j = parseJwt(t)!
    expect(verifyHmac(j, "secret")).toBe(true)
    expect(verifyHmac(j, "not-it")).toBe(false)
    expect(findWeakSecret(j)).toBe("secret")
    // A strong random secret is not in the dictionary → no hit.
    const strong = parseJwt(signHs256({ sub: "u1" }, "9f8a3c1e-very-long-random-key-4471"))!
    expect(findWeakSecret(strong)).toBeUndefined()
  })

  test("forgeNone strips the signature and sets alg:none", () => {
    const j = parseJwt(signHs256({ sub: "u1", role: "user" }, "secret"))!
    const forged = forgeNone(j, { role: "admin" })
    const fj = parseJwt(forged)!
    expect(String(fj.header.alg).toLowerCase()).toBe("none")
    expect(fj.payload.role).toBe("admin")
    expect(forged.endsWith(".")).toBe(true) // empty signature
  })

  test("forgeTamperedClaim keeps the original signature (tests signature-not-validated)", () => {
    const t = signHs256({ sub: "u1" }, "secret")
    const j = parseJwt(t)!
    const forged = forgeTamperedClaim(j, { sub: "admin" })
    const fj = parseJwt(forged)!
    expect(fj.payload.sub).toBe("admin")
    expect(fj.signature).toBe(j.signature) // signature reused, now mismatched
    expect(verifyHmac(fj, "secret")).toBe(false) // proves the sig no longer matches the payload
  })

  test("forgeResigned re-signs with a (weak) secret so it verifies", () => {
    const j = parseJwt(signHs256({ sub: "u1" }, "secret"))!
    const forged = parseJwt(forgeResigned(j, "secret", { role: "admin" }))!
    expect(forged.payload.role).toBe("admin")
    expect(verifyHmac(forged, "secret")).toBe(true)
  })

  test("forgeAlgConfusion re-signs HS256 with the public key as the HMAC secret", () => {
    // Simulate an RS256 token (header alg RS256, opaque sig) and confuse it to HS256 keyed on the pubkey.
    const pub = "-----BEGIN PUBLIC KEY-----\nMFkwEw...fake-pem...AB\n-----END PUBLIC KEY-----"
    const rs = parseJwt(`${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({ sub: "u1" })}.c2ln`)!
    const forged = parseJwt(forgeAlgConfusion(rs, pub, { role: "admin" }))!
    expect(String(forged.header.alg)).toBe("HS256")
    expect(forged.payload.role).toBe("admin")
    // A server confusing RS→HS verifies HS256 with the public key → this token verifies under `pub`.
    expect(verifyHmac(forged, pub)).toBe(true)
  })

  test("forgeKidEmptyKey sets a traversal kid and signs with the empty key", () => {
    const j = parseJwt(signHs256({ sub: "u1" }, "secret"))!
    const forged = parseJwt(forgeKidEmptyKey(j))!
    expect(String(forged.header.kid)).toContain("/dev/null")
    expect(String(forged.header.alg)).toBe("HS256")
    expect(verifyHmac(forged, "")).toBe(true) // verifies under the empty key
  })

  test("analyzeJwtStatic reports rsa + key-resolution header surface", () => {
    const withKid = parseJwt(`${b64url({ alg: "RS256", kid: "keys/1", jku: "https://x/jwks" })}.${b64url({ sub: "u1" })}.c2ln`)!
    const s = analyzeJwtStatic(withKid)
    expect(s.rsa).toBe(true)
    expect(s.header_surface.sort()).toEqual(["jku", "kid"])
  })

  test("analyzeJwtStatic flags alg:none issued, weak secret, and expiry", () => {
    const weak = parseJwt(signHs256({ sub: "u1", exp: 1 }, "secret"))!
    const s = analyzeJwtStatic(weak, 1_700_000_000_000)
    expect(s.weak_secret).toBe("secret")
    expect(s.expired).toBe(true)

    const none = parseJwt(`${b64url({ alg: "none" })}.${b64url({ sub: "u1" })}.`)!
    expect(analyzeJwtStatic(none).alg_none_issued).toBe(true)
  })
})

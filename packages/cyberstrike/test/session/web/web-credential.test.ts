import { describe, expect, test } from "bun:test"
import { WebCredential } from "../../../src/session/web/web-credential"
import { WebRole } from "../../../src/session/web/web-role"
import { Session } from "../../../src/session"
import { Instance } from "../../../src/project/instance"
import { tmpdir } from "../../fixture/fixture"

// web_credential rows FK to a real session, so create one per test.
async function withSession(fn: (sid: string) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => fn((await Session.create({})).id),
  })
}

describe("WebCredential.ensure — idempotent by label", () => {
  test("registering the same label twice reuses the credential (no duplicate)", async () => {
    await withSession(async (sid) => {
      const a = WebCredential.ensure({ sessionID: sid, label: "anonymous" })
      const b = WebCredential.ensure({ sessionID: sid, label: "anonymous" }) // launch, then Start capture
      expect(b.id).toBe(a.id)
      expect(WebCredential.get(sid).filter((c) => c.label === "anonymous").length).toBe(1)
    })
  })

  test("a re-registration merges newly-provided headers into the existing credential", async () => {
    await withSession(async (sid) => {
      const a = WebCredential.ensure({ sessionID: sid, label: "admin" })
      const b = WebCredential.ensure({ sessionID: sid, label: "admin", headers: { Authorization: "Bearer x" } })
      expect(b.id).toBe(a.id)
      expect(b.headers.Authorization).toBe("Bearer x")
      expect(WebCredential.get(sid).length).toBe(1)
    })
  })

  test("different labels are distinct credentials", async () => {
    await withSession(async (sid) => {
      WebCredential.ensure({ sessionID: sid, label: "anonymous" })
      WebCredential.ensure({ sessionID: sid, label: "admin" })
      expect(WebCredential.get(sid).length).toBe(2)
    })
  })

  test("labels differing only by case/whitespace are the SAME role (first casing kept)", async () => {
    await withSession(async (sid) => {
      const a = WebCredential.ensure({ sessionID: sid, label: "Anonymous" })
      const b = WebCredential.ensure({ sessionID: sid, label: "anonymous" }) // different case
      const c = WebCredential.ensure({ sessionID: sid, label: "  ANONYMOUS " }) // case + whitespace
      expect(b.id).toBe(a.id)
      expect(c.id).toBe(a.id)
      expect(WebCredential.get(sid).length).toBe(1)
      expect(WebCredential.get(sid)[0].label).toBe("Anonymous") // canonical = first registration
      expect(WebCredential.getByLabel(sid, "aNoNyMoUs")!.id).toBe(a.id)
    })
  })

  test("getByLabel finds the one credential for a label", async () => {
    await withSession(async (sid) => {
      const a = WebCredential.ensure({ sessionID: sid, label: "anonymous" })
      expect(WebCredential.getByLabel(sid, "anonymous")!.id).toBe(a.id)
      expect(WebCredential.getByLabel(sid, "nope")).toBeUndefined()
    })
  })

  // The "Provide New Credential" box spawn flow: the server pre-creates the credential linked to a
  // declared role tier; when the spawned browser later registers the SAME label (no roleID), the
  // role_id must survive so the authz agent keeps the privilege ordering.
  test("a pre-linked role_id survives the spawned browser's re-registration", async () => {
    await withSession(async (sid) => {
      const role = WebRole.add({ sessionID: sid, name: "Admin", level: 3, discoveredFrom: "user" })
      const pre = WebCredential.ensure({ sessionID: sid, label: "orhan1", roleID: role.id }) // spawn pre-link
      expect(pre.role_id).toBe(role.id)
      const re = WebCredential.ensure({ sessionID: sid, label: "orhan1" }) // spawned browser Start capture
      expect(re.id).toBe(pre.id)
      expect(re.role_id).toBe(role.id)
    })
  })
})

describe("WebCredential.captureAuthFromRaw — fill a placeholder credential from captured traffic", () => {
  const rawWith = (auth: string) =>
    `GET /dashboard HTTP/1.1\r\nHost: app.example.com\r\n${auth}\r\nAccept: */*\r\n\r\n`

  test("lifts auth headers off a raw request onto an empty credential", async () => {
    await withSession(async (sid) => {
      const cred = WebCredential.ensure({ sessionID: sid, label: "org1" }) // label-only placeholder
      expect(Object.keys(cred.headers).length).toBe(0)
      WebCredential.captureAuthFromRaw({
        sessionID: sid,
        credentialID: cred.id,
        rawRequest: rawWith("Cookie: session=abc123\r\nAuthorization: Bearer tok-org1"),
      })
      const after = WebCredential.getById(cred.id)!
      expect(after.headers["Cookie"]).toBe("session=abc123")
      expect(after.headers["Authorization"]).toBe("Bearer tok-org1")
    })
  })

  test("only auth headers are captured (not Accept/Host/etc.)", async () => {
    await withSession(async (sid) => {
      const cred = WebCredential.ensure({ sessionID: sid, label: "org1" })
      WebCredential.captureAuthFromRaw({
        sessionID: sid,
        credentialID: cred.id,
        rawRequest: rawWith("X-Api-Key: k-123"),
      })
      const h = WebCredential.getById(cred.id)!.headers
      expect(h["X-Api-Key"]).toBe("k-123")
      expect(h["Host"]).toBeUndefined()
      expect(h["Accept"]).toBeUndefined()
    })
  })

  test("two identities on the same endpoint keep DISTINCT auth (the cross-cred substrate)", async () => {
    await withSession(async (sid) => {
      const org1 = WebCredential.ensure({ sessionID: sid, label: "org1" })
      const org2 = WebCredential.ensure({ sessionID: sid, label: "org2" })
      WebCredential.captureAuthFromRaw({ sessionID: sid, credentialID: org1.id, rawRequest: rawWith("Authorization: Bearer TOK1") })
      WebCredential.captureAuthFromRaw({ sessionID: sid, credentialID: org2.id, rawRequest: rawWith("Authorization: Bearer TOK2") })
      expect(WebCredential.getById(org1.id)!.headers["Authorization"]).toBe("Bearer TOK1")
      expect(WebCredential.getById(org2.id)!.headers["Authorization"]).toBe("Bearer TOK2")
    })
  })

  test("a request with no auth headers leaves the credential untouched", async () => {
    await withSession(async (sid) => {
      const cred = WebCredential.ensure({ sessionID: sid, label: "anon", headers: { Authorization: "Bearer keep" } })
      WebCredential.captureAuthFromRaw({
        sessionID: sid,
        credentialID: cred.id,
        rawRequest: `GET /public HTTP/1.1\r\nHost: app.example.com\r\nAccept: */*\r\n\r\n`,
      })
      // unchanged — no auth in the request, existing header preserved
      expect(WebCredential.getById(cred.id)!.headers["Authorization"]).toBe("Bearer keep")
    })
  })

  test("refreshes a rotated token (merge, later value wins)", async () => {
    await withSession(async (sid) => {
      const cred = WebCredential.ensure({ sessionID: sid, label: "org1" })
      WebCredential.captureAuthFromRaw({ sessionID: sid, credentialID: cred.id, rawRequest: rawWith("Authorization: Bearer old") })
      WebCredential.captureAuthFromRaw({ sessionID: sid, credentialID: cred.id, rawRequest: rawWith("Authorization: Bearer new") })
      expect(WebCredential.getById(cred.id)!.headers["Authorization"]).toBe("Bearer new")
    })
  })

  test("returns true ONCE — the empty→authenticated transition of a real identity", async () => {
    await withSession(async (sid) => {
      const cred = WebCredential.ensure({ sessionID: sid, label: "org1" })
      // first auth on a previously-empty non-anonymous credential → the retest trigger edge
      const first = WebCredential.captureAuthFromRaw({ sessionID: sid, credentialID: cred.id, rawRequest: rawWith("Authorization: Bearer t1") })
      expect(first).toBe(true)
      // a later token change is NOT a first-population → no re-trigger
      const again = WebCredential.captureAuthFromRaw({ sessionID: sid, credentialID: cred.id, rawRequest: rawWith("Authorization: Bearer t2") })
      expect(again).toBe(false)
    })
  })

  test("returns false for the anonymous baseline (no cross-cred retest for it)", async () => {
    await withSession(async (sid) => {
      const anon = WebCredential.ensure({ sessionID: sid, label: "Anonymous" })
      const r = WebCredential.captureAuthFromRaw({ sessionID: sid, credentialID: anon.id, rawRequest: rawWith("Cookie: s=1") })
      expect(r).toBe(false)
    })
  })

  test("returns false when the request carries no auth (nothing became replayable)", async () => {
    await withSession(async (sid) => {
      const cred = WebCredential.ensure({ sessionID: sid, label: "org1" })
      const r = WebCredential.captureAuthFromRaw({
        sessionID: sid,
        credentialID: cred.id,
        rawRequest: `GET /public HTTP/1.1\r\nHost: app.example.com\r\nAccept: */*\r\n\r\n`,
      })
      expect(r).toBe(false)
    })
  })
})

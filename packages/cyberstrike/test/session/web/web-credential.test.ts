import { describe, expect, test } from "bun:test"
import { WebCredential } from "../../../src/session/web/web-credential"
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

  test("getByLabel finds the one credential for a label", async () => {
    await withSession(async (sid) => {
      const a = WebCredential.ensure({ sessionID: sid, label: "anonymous" })
      expect(WebCredential.getByLabel(sid, "anonymous")!.id).toBe(a.id)
      expect(WebCredential.getByLabel(sid, "nope")).toBeUndefined()
    })
  })
})

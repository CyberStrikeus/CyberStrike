import { describe, expect, test } from "bun:test"
import { WebGetRequestDetailTool } from "../../src/tool/web-get-request-detail"
import { Request } from "../../src/session/request"
import { Session } from "../../src/session"
import { UiObservation } from "../../src/session/web/ui-observation"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctxFor = (sessionID: string) => ({
  sessionID,
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
})

async function withInstance(fn: () => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({ directory: dir.path, fn })
}

describe("web_get_request_detail — Faz B derived access context", () => {
  test("derives element_roles + page_visited_by from UI observations", async () => {
    await withInstance(async () => {
      const session = await Session.create({})
      const sid = session.id
      // admin sees Delete + Edit; user sees only Edit → BFLA signal on Delete.
      UiObservation.observe(sid, { credentialID: "admin", pageUrl: "https://h.tld/users", role: "button", label: "Delete User" })
      UiObservation.observe(sid, { credentialID: "admin", pageUrl: "https://h.tld/users", role: "button", label: "Edit" })
      UiObservation.observe(sid, { credentialID: "user", pageUrl: "https://h.tld/users", role: "button", label: "Edit" })

      // Request page_url differs only by query — must still match the observations.
      const req = Request.add({
        sessionID: sid,
        method: "DELETE",
        normalizedPath: "/users",
        pageUrl: "https://h.tld/users?tab=1",
        triggerElement: "button:Delete User",
      })
      expect(req).toBeDefined()

      const tool = await WebGetRequestDetailTool.init()
      const res = await tool.execute({ request_id: req!.id, include_ui_context: false }, ctxFor(sid))
      const detail = JSON.parse(res.output)
      expect(detail.element_roles).toEqual(["admin"])
      expect(detail.page_visited_by.sort()).toEqual(["admin", "user"])
    })
  })

  test("falls back to the stored column when the store is empty (1.x worker path)", async () => {
    await withInstance(async () => {
      const session = await Session.create({})
      const sid = session.id
      const req = Request.add({
        sessionID: sid,
        method: "DELETE",
        normalizedPath: "/x",
        pageUrl: "https://h.tld/x",
        triggerElement: "button:Del",
        elementRoles: ["legacy-admin"],
        pageVisitedBy: ["legacy-admin"],
      })
      const tool = await WebGetRequestDetailTool.init()
      const res = await tool.execute({ request_id: req!.id, include_ui_context: false }, ctxFor(sid))
      const detail = JSON.parse(res.output)
      expect(detail.element_roles).toEqual(["legacy-admin"])
      expect(detail.page_visited_by).toEqual(["legacy-admin"])
    })
  })
})

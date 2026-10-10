import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"
import { Request } from "../../src/session/request"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { WebRetest } from "../../src/session/web/web-retest"
import { tmpdir } from "../fixture/fixture"

describe("WebRetest.claimNext", () => {
  test("claims pending work by priority and prevents duplicate claims", async () => {
    await using dir = await tmpdir()
    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const sessionID = Identifier.ascending("session")
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(SessionTable)
            .values({
              id: sessionID,
              project_id: Instance.project.id,
              slug: "retest-queue",
              directory: dir.path,
              title: "Retest queue",
              version: "test",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        try {
          const lowRequest = Request.add({
            sessionID,
            method: "GET",
            normalizedPath: "/users",
            rawRequest: "GET /users HTTP/1.1\n\n",
          })
          const highRequest = Request.add({
            sessionID,
            method: "GET",
            normalizedPath: "/admins",
            rawRequest: "GET /admins HTTP/1.1\n\n",
          })
          if (!lowRequest || !highRequest) throw new Error("request was not created")

          const low = WebRetest.enqueue({
            sessionID,
            requestID: lowRequest.id,
            triggerType: "new_role",
            triggerSource: "role-low",
            priority: "low",
          })
          const high = WebRetest.enqueue({
            sessionID,
            requestID: highRequest.id,
            triggerType: "new_object_value",
            triggerSource: "value-high",
            priority: "high",
          })

          const first = WebRetest.claimNext(sessionID)
          expect(first?.id).toBe(high.id)
          expect(first?.status).toBe("processing")
          expect(WebRetest.count(sessionID)).toEqual({ pending: 1, processing: 1, completed: 0 })

          const second = WebRetest.claimNext(sessionID)
          expect(second?.id).toBe(low.id)
          expect(second?.status).toBe("processing")
          expect(WebRetest.claimNext(sessionID)).toBeUndefined()

          WebRetest.updateStatus(first!.id, "completed")
          WebRetest.updateStatus(second!.id, "completed")
          expect(WebRetest.count(sessionID)).toEqual({ pending: 0, processing: 0, completed: 2 })
        } finally {
          Database.use((db) => db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run())
          await Instance.dispose()
        }
      },
    })
  })
})

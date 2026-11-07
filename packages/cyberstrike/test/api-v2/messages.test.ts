import { expect, test } from "bun:test"
import { Effect } from "effect"
import { listen } from "../../src/api-v2/server"
import { inInstance } from "../../src/api-v2/instance"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { MessageTable, PartTable } from "../../src/session/session.sql"
import { tmpdir } from "../fixture/fixture"

test("the message endpoint isolates corrupt messages and corrupt parts", async () => {
  await using tmp = await tmpdir()
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  try {
    const session = await Effect.runPromise(inInstance(tmp.path, () => Session.create({})))
    const time = Date.now()
    Database.use((db) => {
      db.insert(MessageTable)
        .values([
          {
            id: "msg_bad",
            session_id: session.id,
            time_created: time,
            time_updated: time,
            data: { role: "assistant" } as typeof MessageTable.$inferInsert.data,
          },
          {
            id: "msg_good",
            session_id: session.id,
            time_created: time,
            time_updated: time,
            data: {
              role: "user",
              agent: "build",
              model: { providerID: "test", modelID: "test" },
              time: { created: time },
            } as typeof MessageTable.$inferInsert.data,
          },
        ])
        .run()
      db.insert(PartTable)
        .values([
          {
            id: "prt_bad",
            message_id: "msg_good",
            session_id: session.id,
            time_created: time,
            time_updated: time,
            data: { type: "tool" } as typeof PartTable.$inferInsert.data,
          },
          {
            id: "prt_good",
            message_id: "msg_good",
            session_id: session.id,
            time_created: time,
            time_updated: time,
            data: { type: "text", text: "survives" } as typeof PartTable.$inferInsert.data,
          },
        ])
        .run()
    })
    const res = await fetch(new URL(`/api/session/${session.id}/message`, server.url))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject([{ id: "msg_good", text: "survives" }])
    await Effect.runPromise(inInstance(tmp.path, () => Session.remove(session.id)))
  } finally {
    await server.stop()
  }
}, 60_000)

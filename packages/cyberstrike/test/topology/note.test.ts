import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { TargetNote } from "../../src/topology/note"
import { tmpdir } from "../fixture/fixture"

describe("target notes", () => {
  test("stores notes by session and entity", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Dossier test" })
        const note = TargetNote.add(session.id, {
          entityID: "host_example",
          title: "Owner context",
          content: "Approved maintenance window",
          links: ["https://example.test/runbook"],
          tags: ["human-confirmed"],
        })
        expect(TargetNote.list(session.id, "host_example")).toEqual([note])
        expect(TargetNote.list(session.id, "other")).toEqual([])
        const updated = TargetNote.update(session.id, note.id, { content: "Updated context" })
        expect(updated?.content).toBe("Updated context")
        expect(updated?.links).toEqual(note.links)
        expect(updated?.tags).toEqual(note.tags)
        expect(TargetNote.remove(session.id, note.id)).toBe(true)
        expect(TargetNote.list(session.id)).toEqual([])
        await Session.remove(session.id)
        await Instance.dispose()
      },
    })
  })
})

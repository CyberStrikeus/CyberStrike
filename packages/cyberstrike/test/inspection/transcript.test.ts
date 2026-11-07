import { describe, test, expect } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { InspectionTranscript } from "../../src/inspection/transcript"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

function run(fn: (sessionID: string) => Promise<void>) {
  return Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const session = await Session.create({})
      try {
        await fn(session.id)
      } finally {
        await Session.remove(session.id)
      }
    },
  })
}

describe("InspectionTranscript (#78 follow-up — inline navigable dispatch entries)", () => {
  test("recordDispatch writes a running `task` part whose state.metadata.sessionId points at the child", () =>
    run(async (root) => {
      await InspectionTranscript.recordDispatch({
        sessionID: root,
        childSessionID: "ses_child_fake",
        agent: "wstg-input-validation",
        label: "POST /api/v1/batch",
        model: { providerID: "anthropic", modelID: "claude-x" },
      })
      const msgs = await Session.messages({ sessionID: root })
      const toolParts = msgs.flatMap((m) => m.parts).filter((p: any) => p.type === "tool" && p.tool === "task")
      expect(toolParts.length).toBe(1)
      const p: any = toolParts[0]
      expect(p.state.status).toBe("running")
      expect(p.state.metadata.sessionId).toBe("ses_child_fake") // this is what the TUI navigates on
      expect(p.state.title).toContain("wstg-input-validation")
    }))

  test("completeDispatch flips the entry running → completed with an outcome", () =>
    run(async (root) => {
      await InspectionTranscript.recordDispatch({
        sessionID: root,
        childSessionID: "ses_child_2",
        agent: "wstg-authorization",
        label: "GET /orders/{id}",
        model: { providerID: "anthropic", modelID: "claude-x" },
      })
      await InspectionTranscript.completeDispatch("ses_child_2", "done")
      const msgs = await Session.messages({ sessionID: root })
      const p: any = msgs.flatMap((m) => m.parts).find((x: any) => x.type === "tool" && x.tool === "task")
      expect(p.state.status).toBe("completed")
      expect(p.state.output).toBe("done")
      expect(p.state.metadata.sessionId).toBe("ses_child_2") // navigation survives completion
    }))

  test("a failed record never throws (graceful) — bad session id is swallowed", async () => {
    // No Instance context → Session calls will fail; recordDispatch must NOT throw.
    await expect(
      InspectionTranscript.recordDispatch({
        sessionID: "ses_nope",
        childSessionID: "c",
        agent: "a",
        label: "l",
        model: { providerID: "p", modelID: "m" },
      }),
    ).resolves.toBeUndefined()
  })
})

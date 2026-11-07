import { ulid } from "ulid"
import { Identifier } from "@/id/id"
import { Session } from "@/session"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import type { MessageV2 } from "@/session/message-v2"

const log = Log.create({ service: "inspection-transcript" })

// Inline navigable dispatch entries in the ROOT session transcript (#78 follow-up). When the
// deterministic dispatcher spawns a specialist, it writes a `task` tool-call part into the root — the
// SAME shape the Task tool produces (an assistant message + a tool part whose state.metadata.sessionId
// points at the child) — so the TUI renders it inline and lets the user ENTER the specialist session,
// exactly as the orchestrator's Task sub-sessions used to appear. The root agent therefore also sees
// what was dispatched (it is real transcript, not a sidebar), so a post-test conversation is informed.
//
// EVERYTHING here is best-effort and graceful: a failure to write the transcript entry must NEVER break
// a dispatch. The dispatcher's execution path is untouched (#80) — this is purely additive.
export namespace InspectionTranscript {
  type Entry = { partID: string; messageID: string; sessionID: string; callID: string; input: Record<string, unknown>; title: string; metadata: Record<string, unknown>; start: number }
  // childSessionID → the task part, so `complete` can flip it running → completed.
  const entries = new Map<string, Entry>()

  // Record a dispatch as a running `task` entry in the root transcript. `model` is passed in (the
  // dispatcher already resolved it) so this module never imports SessionPrompt.
  export async function recordDispatch(input: {
    sessionID: string
    childSessionID: string
    agent: string
    label: string
    model: { providerID: string; modelID: string }
  }): Promise<void> {
    try {
      const msgs = await Session.messages({ sessionID: input.sessionID })
      const lastUser = [...msgs].reverse().find((m) => m.info.role === "user")?.info
      const assistant = (await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "assistant",
        parentID: lastUser?.id ?? input.sessionID,
        sessionID: input.sessionID,
        mode: input.agent,
        agent: input.agent,
        path: { cwd: Instance.directory, root: Instance.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: input.model.modelID,
        providerID: input.model.providerID,
        time: { created: Date.now() },
      })) as MessageV2.Assistant
      const callID = ulid()
      const title = `Inspect ${input.label} (@${input.agent})`
      const inp = { description: `Inspect ${input.label}`, subagent_type: input.agent }
      const metadata = { sessionId: input.childSessionID }
      const start = Date.now()
      const part = (await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: assistant.id,
        sessionID: assistant.sessionID,
        type: "tool",
        callID,
        tool: "task",
        state: { status: "running", input: inp, title, metadata, time: { start } },
      })) as MessageV2.ToolPart
      entries.set(input.childSessionID, {
        partID: part.id,
        messageID: assistant.id,
        sessionID: assistant.sessionID,
        callID,
        input: inp,
        title,
        metadata,
        start,
      })
    } catch (e) {
      log.debug("inspection transcript record failed (ignored)", { err: String(e) })
    }
  }

  // Flip a recorded entry running → completed with a one-line outcome. No-op if we never recorded it.
  export async function completeDispatch(childSessionID: string, outcome: string): Promise<void> {
    const e = entries.get(childSessionID)
    if (!e) return
    entries.delete(childSessionID)
    try {
      await Session.updatePart({
        id: e.partID,
        messageID: e.messageID,
        sessionID: e.sessionID,
        type: "tool",
        callID: e.callID,
        tool: "task",
        state: {
          status: "completed",
          input: e.input,
          output: outcome,
          title: e.title,
          metadata: e.metadata,
          time: { start: e.start, end: Date.now() },
        },
      })
    } catch (err) {
      log.debug("inspection transcript complete failed (ignored)", { err: String(err) })
    }
  }
}

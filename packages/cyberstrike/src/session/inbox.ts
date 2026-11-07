import { Session } from "./index"
import { MessageV2 } from "./message-v2"
import { SessionLog } from "./log"

// The session inbox: admitted input the agent loop has not started answering yet. An item is a persisted user
// message with no assistant message after it, so its id is the message id. Delivery mode is kept in memory: the
// loop answers pending input at its next step boundary whatever the mode, and steer additionally wakes an idle
// session (see the session.inbox.update handler).
export namespace Inbox {
  export type Delivery = "steer" | "queue"

  const modes = new Map<string, Delivery>()

  const dataURI = /^data:([^;,]+);base64,(.*)$/s

  async function pending(sessionID: string) {
    const rows = await Session.messages({ sessionID })
    const last = rows.findLastIndex((row) => row.info.role === "assistant")
    return rows.slice(last + 1).filter((row) => row.info.role === "user")
  }

  function item(sessionID: string, row: MessageV2.WithParts) {
    const texts = row.parts.flatMap((part) => (part.type === "text" ? [part] : []))
    const text = texts.map((part) => part.text).join("\n")
    const base = {
      id: row.info.id,
      sessionID,
      delivery: modes.get(row.info.id) ?? "queue",
      time: { created: row.info.time.created },
    }
    if (texts.length > 0 && texts.every((part) => part.synthetic === true))
      return { ...base, type: "synthetic" as const, payload: { text } }
    const files = row.parts.flatMap((part) => {
      if (part.type !== "file") return []
      const match = dataURI.exec(part.url)
      if (!match) return []
      return [{ data: match[2], mime: match[1], source: { type: "inline" as const }, name: part.filename }]
    })
    return { ...base, type: "user" as const, payload: { text, files, agents: [], skills: [] } }
  }

  export async function list(sessionID: string) {
    return (await pending(sessionID)).map((row) => item(sessionID, row))
  }

  // Returns false when the item is not pending (already answered, or never existed). Cancelling such an item is a
  // no-op for the caller.
  export async function cancel(input: { sessionID: string; messageID: string }) {
    const found = (await pending(input.sessionID)).some((row) => row.info.id === input.messageID)
    if (!found) return false
    await Session.removeMessage({ sessionID: input.sessionID, messageID: input.messageID })
    modes.delete(input.messageID)
    SessionLog.append({
      sessionID: input.sessionID,
      type: "session.inbox.cancelled",
      data: { sessionID: input.sessionID, inboxID: input.messageID },
    })
    return true
  }

  export async function update(input: { sessionID: string; messageID: string; delivery: Delivery }) {
    const found = (await pending(input.sessionID)).some((row) => row.info.id === input.messageID)
    if (!found) return false
    modes.set(input.messageID, input.delivery)
    SessionLog.append({
      sessionID: input.sessionID,
      type: "session.inbox.delivery.changed",
      data: { sessionID: input.sessionID, inboxID: input.messageID, delivery: input.delivery },
    })
    return true
  }
}

import { projectForm } from "./projection/form"
import { projectPermission } from "./projection/permission"
import type { PermissionInput, QuestionInput } from "./projection/types"

export type WireEvent = { type: string; data: Record<string, unknown> }

type Raw = { type: string; properties: Record<string, any> }

// The v1 bus speaks {type, properties}. Each event with a v2 counterpart maps to one v2 frame; anything else is
// dropped here, so the stream never carries a shape the phone does not read.
export function projectEvent(event: Raw, ordinal = 0): WireEvent | undefined {
  const p = event.properties
  if (event.type === "server.connected") return { type: "server.connected", data: {} }

  if (event.type === "message.part.delta" && p.field === "text") {
    return {
      type: "session.text.delta",
      data: { sessionID: p.sessionID, assistantMessageID: p.messageID, ordinal, delta: p.delta },
    }
  }

  if (event.type === "message.part.updated") {
    const part = p.part
    if (part?.type === "text")
      return {
        type: "session.text.ended",
        data: { sessionID: part.sessionID, assistantMessageID: part.messageID, ordinal, text: part.text },
      }
    if (part?.type === "reasoning")
      return {
        type: "session.reasoning.ended",
        data: { sessionID: part.sessionID, assistantMessageID: part.messageID },
      }
    return undefined
  }

  if (event.type === "message.updated" && p.info?.role === "assistant")
    return { type: "session.message.content.updated", data: { sessionID: p.info.sessionID, messageID: p.info.id } }

  if (event.type === "session.status")
    return { type: "session.status", data: { sessionID: p.sessionID, status: p.status } }
  if (event.type === "session.idle") return { type: "session.idle", data: { sessionID: p.sessionID } }
  if (event.type === "session.created") return { type: "session.created", data: { sessionID: p.info?.id } }
  if (event.type === "session.deleted")
    return { type: "session.deleted", data: { sessionID: p.info?.id ?? p.sessionID } }
  if (event.type === "session.error")
    return { type: "session.execution.failed", data: { sessionID: p.sessionID, error: p.error } }

  if (event.type === "session.updated" && p.info?.title !== undefined)
    return { type: "session.renamed", data: { sessionID: p.info.id, title: p.info.title } }

  if (event.type === "permission.asked")
    return { type: "permission.asked", data: projectPermission(p as PermissionInput) }
  if (event.type === "permission.replied")
    return { type: "permission.replied", data: { id: p.requestID ?? p.id, sessionID: p.sessionID } }

  if (event.type === "question.asked") return { type: "form.created", data: { form: projectForm(p as QuestionInput) } }
  if (event.type === "question.replied")
    return {
      type: "form.replied",
      data: {
        id: String(p.requestID ?? p.id).replace(/^que_/, "frm_"),
        sessionID: p.sessionID,
        answer: Object.fromEntries(
          (p.answers as string[][]).map((answer, index) => [
            `question-${index}`,
            answer.length === 1 ? answer[0] : answer,
          ]),
        ),
      },
    }
  if (event.type === "question.rejected")
    return {
      type: "form.cancelled",
      data: {
        id: String(p.requestID ?? p.id).replace(/^que_/, "frm_"),
        sessionID: p.sessionID,
      },
    }

  return undefined
}

// One SSE frame. The phone reads `data:` lines as JSON with a `type` and a `data` object.
export const frame = (event: WireEvent) => `data: ${JSON.stringify(event)}\n\n`

import type { MessageInput, PartInput } from "./types"
import { compact } from "./compact"

type Tool = { status: string; input?: Record<string, unknown>; metadata?: Record<string, unknown> } & Record<
  string,
  unknown
>

// v1 error names mapped onto upstream's error type vocabulary.
const ERROR_TYPES: Record<string, string> = {
  AuthError: "provider.auth",
  ContentFilterError: "provider.content-filter",
  InvalidRequestError: "provider.invalid-request",
  StructuredOutputError: "provider.invalid-output",
  MessageAbortedError: "aborted",
  APIError: "provider.error",
}

export function projectError(error: { name: string; data?: { message?: string } }) {
  return {
    type: ERROR_TYPES[error.name] ?? "unknown",
    message: error.data?.message ?? error.name,
  }
}

// A v1 tool part carries a state machine. Map each v1 status onto the upstream tool-state union.
export function projectToolState(state: Tool) {
  const input = state.input ?? {}
  if (state.status === "pending") return { status: "streaming", input: JSON.stringify(input) }
  if (state.status === "running") return { status: "running", input, metadata: state.metadata ?? {} }
  if (state.status === "completed") {
    const text = typeof state.output === "string" ? state.output : ""
    return compact({ status: "completed", input, content: [{ type: "text", text }], metadata: state.metadata })
  }
  return compact({
    status: "error",
    input,
    error: projectError({ name: String(state.error ?? "unknown") }),
    metadata: state.metadata,
  })
}

// Parts with no upstream equivalent are dropped one by one, never the whole message.
function assistantContent(parts: PartInput[]): Record<string, unknown>[] {
  return parts.flatMap((part): Record<string, unknown>[] => {
    if (part.type === "text") return [{ type: "text", text: String(part.text ?? "") }]
    if (part.type === "reasoning") return [{ type: "reasoning", text: String(part.text ?? "") }]
    if (part.type === "tool") {
      return [
        {
          type: "tool",
          id: String(part.callID),
          name: String(part.tool),
          executed: true,
          state: projectToolState(part.state as Tool),
          time: { created: Number((part.state as { time?: { start?: number } }).time?.start ?? 0) },
        },
      ]
    }
    return []
  })
}

// One v2 message per v1 message. A v1 message whose parts are all unknown still projects, with empty content.
export function projectMessage(input: { info: MessageInput; parts: PartInput[] }) {
  const { info, parts } = input
  const compaction = parts.find((part) => part.type === "compaction")
  if (compaction) {
    return {
      id: info.id,
      type: "compaction",
      status: "completed",
      reason: compaction.auto ? "auto" : "manual",
      time: { created: info.time.created },
    }
  }
  if (info.role === "user") {
    const text = parts
      .filter((part) => part.type === "text")
      .map((part) => String(part.text ?? ""))
      .join("")
    const files = parts
      .filter((part) => part.type === "file")
      .flatMap((part) => {
        const match = /^data:([^;,]+);base64,(.*)$/s.exec(String(part.url ?? ""))
        if (!match) return []
        return [
          compact({
            data: match[2],
            mime: match[1],
            source: { type: "inline" },
            name: part.filename as string | undefined,
          }),
        ]
      })
    const agents = parts.filter((part) => part.type === "agent").map((part) => ({ name: String(part.name ?? "") }))
    return { id: info.id, type: "user", text, files, agents, skills: [], time: { created: info.time.created } }
  }
  return compact({
    id: info.id,
    type: "assistant",
    agent: info.agent,
    model: { providerID: info.model?.providerID ?? info.providerID, id: info.model?.modelID ?? info.modelID },
    content: assistantContent(parts),
    finish: info.finish,
    cost: info.cost,
    tokens: info.tokens,
    error: info.error ? projectError(info.error) : undefined,
    time: compact({ created: info.time.created, completed: info.time.completed }),
  })
}

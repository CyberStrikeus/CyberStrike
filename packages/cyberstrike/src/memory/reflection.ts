import { Bus } from "../bus"
import { Instance } from "../project/instance"
import { MemoryStore } from "./store"
import { Session } from "../session"

export namespace ToolReflection {
  type Event = {
    type: string
    properties?: unknown
  }

  export type Failure = {
    sessionID: string
    callID: string
    tool: string
    title: string
    reason: string
  }

  const record = (value: unknown): Record<string, unknown> | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return
    return value as Record<string, unknown>
  }

  const text = (value: unknown) => (typeof value === "string" ? value : undefined)

  export function failure(event: Event): Failure | undefined {
    if (event.type !== "message.part.updated") return
    const props = record(event.properties)
    const part = record(props?.part)
    if (part?.type !== "tool") return
    const state = record(part.state)
    const metadata = record(state?.metadata)
    const status = text(state?.status)
    const outcome = text(metadata?.outcome)
    const failed = status === "error" || (outcome !== undefined && outcome !== "clean")
    if (!failed) return

    const sessionID = text(part.sessionID)
    const callID = text(part.callID)
    const tool = text(part.tool)
    if (!sessionID || !callID || !tool) return
    const reason =
      status === "error"
        ? text(state?.error) ?? "tool error"
        : `outcome ${outcome}`
    return {
      sessionID,
      callID,
      tool,
      title: text(state?.title) ?? `${tool} failed`,
      reason,
    }
  }

  const state = Instance.state(
    () => {
      const seen = new Set<string>()
      const unsub = Bus.subscribeAll((event) => {
        const result = failure(event)
        if (!result || seen.has(result.callID)) return
        seen.add(result.callID)
        while (seen.size > 2_000) seen.delete(seen.values().next().value!)
        MemoryStore.add({
          sessionID: Session.root(result.sessionID),
          kind: "episodic",
          title: `Failure: ${result.tool}`,
          content: `${result.title}. Ground-truth result: ${result.reason}. Re-check prerequisites, arguments, target state, and prior evidence before retrying.`,
          source: `tool:${result.tool}`,
          trust: "tool",
          confidence: 1,
          tags: ["failure", result.tool],
          relatedIDs: [result.callID],
        })
      })
      return { unsub }
    },
    async (entry) => entry.unsub(),
  )

  export function init() {
    state()
  }
}

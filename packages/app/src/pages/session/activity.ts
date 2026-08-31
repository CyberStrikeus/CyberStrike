export type ActivitySource = "agent" | "tool" | "mcp" | "bolt" | "browser" | "pty" | "finding" | "system"

export type Activity = {
  id: string
  projectID: string
  sessionID?: string
  type: string
  source: ActivitySource
  correlationID?: string
  parentID?: string
  data: Record<string, unknown>
  time: number
}

export const isActivity = (event: unknown): event is Activity => {
  if (!event || typeof event !== "object") return false
  const value = event as Partial<Activity>
  return (
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.source === "string" &&
    typeof value.time === "number" &&
    !!value.data &&
    typeof value.data === "object"
  )
}

export const mergeActivity = (history: Activity[], live: Activity[], limit = 2_000) => {
  const byID = new Map([...history, ...live].map((event) => [event.id, event]))
  return [...byID.values()].sort((a, b) => a.time - b.time).slice(-limit)
}

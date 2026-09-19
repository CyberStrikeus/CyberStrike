export type ActivitySource = "agent" | "tool" | "mcp" | "bolt" | "browser" | "pty" | "finding" | "system"
export type WorkbenchChannel =
  | "activity"
  | "mission"
  | "topology"
  | "memory"
  | "mcp"
  | "bolt"
  | "terminal"
  | "vulns"
  | "web"

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

const value = (data: Record<string, unknown>, key: string) =>
  typeof data[key] === "string" || typeof data[key] === "number" ? String(data[key]) : ""

export const activitySummary = (event: Activity) => {
  const title = value(event.data, "title")
  const tool = value(event.data, "tool")
  const status = value(event.data, "status")
  const name = value(event.data, "name")
  const count = value(event.data, "count")
  return [tool || name || event.type, status, title, count ? `${count} items` : ""].filter(Boolean).join(" · ")
}

export const activityChannels = (event: Activity): WorkbenchChannel[] => {
  const channels: WorkbenchChannel[] = ["activity"]
  if (event.source === "mcp") channels.push("mcp")
  if (event.source === "bolt") channels.push("bolt")
  if (event.source === "pty") channels.push("terminal")
  if (event.type.startsWith("memory.")) channels.push("memory")
  if (
    event.type.startsWith("methodology.") ||
    event.type.startsWith("intel.") ||
    event.type.startsWith("coverage.")
  )
    channels.push("mission")
  if (event.type.startsWith("intel.")) channels.push("topology")
  if (event.type.startsWith("vulnerability.")) channels.push("vulns", "mission", "topology")
  if (event.type.startsWith("nmap.") || event.type.startsWith("dossier.note.")) channels.push("topology")
  if (
    event.type.startsWith("request.") ||
    event.type.startsWith("web.") ||
    event.type.startsWith("web_") ||
    event.type.startsWith("hackbrowser.") ||
    event.type.startsWith("observation.")
  )
    channels.push("web", "topology")
  return [...new Set(channels)]
}

export const activityRefreshChannels = (event: Activity): WorkbenchChannel[] =>
  event.type === "session.idle" ? ["mission", "topology", "memory", "mcp", "bolt", "vulns", "web"] : []

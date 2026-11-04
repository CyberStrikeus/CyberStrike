import type { SessionGoal } from "@cyberstrike-io/sdk/v2"

function duration(input: string) {
  const match = /^([1-9]\d*)(s|m|h|d)$/.exec(input)
  if (!match) throw new Error("Use a duration such as 1m, 8h or 2d")
  const seconds = Number(match[1]) * (match[2] === "d" ? 86400 : match[2] === "h" ? 3600 : match[2] === "m" ? 60 : 1)
  if (!Number.isSafeInteger(seconds) || seconds > 2_147_483_647) throw new Error("The duration is too large")
  return seconds
}

export function parseGoal(
  input: string,
):
  | { op: "dialog" }
  | { op: "status" }
  | { op: "pause" }
  | { op: "resume" }
  | { op: "drop" }
  | { op: "budget"; tokenBudget: number | null }
  | { op: "duration"; durationSeconds: number | null }
  | { op: "create"; objective: string; durationSeconds?: number } {
  const match = /^\s*\/goal(?:\s([\s\S]*))?$/.exec(input)
  if (!match) throw new Error("Use /goal followed by an objective or command")
  const objective = match[1] ?? ""
  if (!objective.trim()) return { op: "dialog" }
  const [command, ...args] = objective.trim().split(/\s+/)
  if (command === "--duration") {
    const match = /^--duration\s+(\S+)\s+([\s\S]+)$/.exec(objective.trimStart())
    if (!match || !match[2].trim()) throw new Error("Use /goal --duration 8h followed by an objective")
    return { op: "create", objective: match[2], durationSeconds: duration(match[1]) }
  }
  if (command === "duration") {
    if (args.length !== 1) throw new Error("Use /goal duration followed by 1m, 8h, 2d or off")
    return { op: "duration", durationSeconds: args[0] === "off" ? null : duration(args[0]) }
  }
  if (command === "status" || command === "pause" || command === "resume" || command === "drop") {
    if (args.length) throw new Error(`The ${command} command takes no arguments`)
    return { op: command }
  }
  if (command !== "budget") return { op: "create", objective }
  if (args.length !== 1 || (args[0] !== "off" && !/^[1-9]\d*$/.test(args[0])))
    throw new Error("Use /goal budget followed by a positive token count or off")
  const tokenBudget = args[0] === "off" ? null : Number(args[0])
  if (tokenBudget !== null && !Number.isSafeInteger(tokenBudget)) throw new Error("The token budget is too large")
  return { op: "budget", tokenBudget }
}

export function goalLabel(status: SessionGoal["status"]) {
  return {
    active: "Active",
    paused: "Paused",
    "budget-limited": "Budget limited",
    blocked: "Blocked",
    completed: "Completed",
    dropped: "Dropped",
  }[status]
}

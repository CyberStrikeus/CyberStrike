import type { SessionGoal } from "@cyberstrike-io/sdk/v2"

export function parseGoal(
  input: string,
):
  | { op: "dialog" }
  | { op: "status" }
  | { op: "pause" }
  | { op: "resume" }
  | { op: "drop" }
  | { op: "budget"; tokenBudget: number | null }
  | { op: "create"; objective: string } {
  const match = /^\s*\/goal(?:\s([\s\S]*))?$/.exec(input)
  if (!match) throw new Error("Use /goal followed by an objective or command")
  const objective = match[1] ?? ""
  if (!objective.trim()) return { op: "dialog" }
  const [command, ...args] = objective.trim().split(/\s+/)
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

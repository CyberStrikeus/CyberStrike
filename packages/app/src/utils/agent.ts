const defaults: Record<string, string> = {
  ask: "var(--icon-agent-ask-base)",
  build: "var(--icon-agent-build-base)",
  docs: "var(--icon-agent-docs-base)",
  plan: "var(--icon-agent-plan-base)",
}

const cycle = [
  "var(--color-semantic-accent)",
  "var(--color-semantic-success)",
  "var(--color-semantic-warning)",
  "var(--color-semantic-primary)",
  "var(--color-semantic-error)",
  "var(--color-semantic-info)",
]

export function agentColor(name: string, custom?: string, index?: number) {
  if (custom) return custom
  const found = defaults[name] ?? defaults[name.toLowerCase()]
  if (found) return found
  if (typeof index === "number") return cycle[index % cycle.length]
  return "var(--text-dimmed-base)"
}

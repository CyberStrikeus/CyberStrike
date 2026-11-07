export interface ToolOutput {
  title: string
  output: string
  metadata: Record<string, never>
}

export function toolResult(name: string, label: string, data: unknown): ToolOutput {
  return { title: `${name}: ${label}`, output: typeof data === "string" ? data : JSON.stringify(data, null, 2), metadata: {} }
}

export function toolError(name: string, msg: string): ToolOutput {
  return { title: name, output: msg, metadata: {} }
}

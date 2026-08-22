import type { AssistantMessage, Part, UserMessage } from "@cyberstrike-io/sdk/v2"
import { Locale } from "@/util/locale"

export type TranscriptOptions = {
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
  includeChildren: boolean
}

export type SessionInfo = {
  id: string
  title: string
  parentID?: string
  time: {
    created: number
    updated: number
  }
}

export type MessageWithParts = {
  info: UserMessage | AssistantMessage
  parts: Part[]
}

export type ChildSession = {
  session: SessionInfo
  messages: MessageWithParts[]
}

export function formatTranscript(
  session: SessionInfo,
  messages: MessageWithParts[],
  options: TranscriptOptions,
  children?: ChildSession[],
): string {
  let transcript = `# ${session.title}\n\n`
  transcript += `**Session ID:** ${session.id}\n`
  transcript += `**Created:** ${new Date(session.time.created).toLocaleString()}\n`
  transcript += `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n`
  transcript += `---\n\n`

  for (const msg of messages) {
    transcript += formatMessage(msg.info, msg.parts, options)
    transcript += `---\n\n`
  }

  if (options.includeChildren && children?.length) {
    transcript += `\n# Subagent Sessions (${children.length})\n\n`
    for (const child of children) {
      transcript += `## ${child.session.title} (${child.session.id.slice(0, 8)})\n\n`
      for (const msg of child.messages) {
        transcript += formatMessage(msg.info, msg.parts, options)
      }
      transcript += `---\n\n`
    }
  }

  if (options.assistantMetadata) {
    transcript += formatSummary(messages, children)
  }

  return transcript
}

export function formatSummary(messages: MessageWithParts[], children?: ChildSession[]): string {
  let totalInput = 0
  let totalOutput = 0
  let totalReasoning = 0
  let totalCacheRead = 0
  let totalCacheWrite = 0
  let totalCost = 0
  let toolCount = 0
  let patchFiles = new Set<string>()

  const accumulate = (msgs: MessageWithParts[]) => {
    for (const msg of msgs) {
      if (msg.info.role === "assistant") {
        totalInput += msg.info.tokens.input
        totalOutput += msg.info.tokens.output
        totalReasoning += msg.info.tokens.reasoning
        totalCacheRead += msg.info.tokens.cache.read
        totalCacheWrite += msg.info.tokens.cache.write
        totalCost += msg.info.cost
      }
      for (const part of msg.parts) {
        if (part.type === "tool") toolCount++
        if (part.type === "patch") part.files.forEach((f) => patchFiles.add(f))
      }
    }
  }

  accumulate(messages)
  if (children) children.forEach((c) => accumulate(c.messages))

  let summary = `\n# Summary\n\n`
  summary += `| Metric | Value |\n|--------|-------|\n`
  summary += `| Messages | ${messages.length} |\n`
  summary += `| Tool calls | ${toolCount} |\n`
  summary += `| Files changed | ${patchFiles.size} |\n`
  summary += `| Total tokens | ${(totalInput + totalOutput + totalReasoning).toLocaleString()} (${totalInput.toLocaleString()} in / ${totalOutput.toLocaleString()} out${totalReasoning ? ` / ${totalReasoning.toLocaleString()} reasoning` : ""}) |\n`
  summary += `| Cache | ${totalCacheRead.toLocaleString()} read / ${totalCacheWrite.toLocaleString()} write |\n`
  summary += `| Total cost | $${totalCost.toFixed(4)} |\n`
  if (children?.length) summary += `| Subagent sessions | ${children.length} |\n`
  if (patchFiles.size > 0) {
    summary += `\n**Files changed:**\n`
    for (const f of [...patchFiles].sort()) {
      summary += `- \`${f}\`\n`
    }
  }
  summary += `\n`
  return summary
}

export function formatMessage(msg: UserMessage | AssistantMessage, parts: Part[], options: TranscriptOptions): string {
  let result = ""

  if (msg.role === "user") {
    const ts =
      options.assistantMetadata && msg.time.created ? ` _(${new Date(msg.time.created).toLocaleTimeString()})_` : ""
    result += `## User${ts}\n\n`
  } else {
    result += formatAssistantHeader(msg, options.assistantMetadata)
  }

  for (const part of parts) {
    result += formatPart(part, options)
  }

  return result
}

export function formatAssistantHeader(msg: AssistantMessage, includeMetadata: boolean): string {
  if (!includeMetadata) {
    return `## Assistant\n\n`
  }

  const duration =
    msg.time.completed && msg.time.created ? ((msg.time.completed - msg.time.created) / 1000).toFixed(1) + "s" : ""

  return `## Assistant (${Locale.titlecase(msg.agent)} · ${msg.modelID}${duration ? ` · ${duration}` : ""})\n\n`
}

export function formatPart(part: Part, options: TranscriptOptions): string {
  if (part.type === "text" && !part.synthetic) {
    return `${part.text}\n\n`
  }

  if (part.type === "reasoning") {
    if (options.thinking) {
      return `<details><summary>Thinking</summary>\n\n${part.text}\n\n</details>\n\n`
    }
    return ""
  }

  if (part.type === "tool") {
    let result = `**Tool: ${part.tool}**`
    if (part.state.status === "completed" && "time" in part.state && part.state.time) {
      const ms = part.state.time.end - part.state.time.start
      result += ` _(${(ms / 1000).toFixed(1)}s)_`
    }
    result += `\n`
    if (options.toolDetails && part.state.input) {
      result += `\n<details><summary>Input</summary>\n\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\`\n\n</details>\n`
    }
    if (options.toolDetails && part.state.status === "completed" && part.state.output) {
      const output =
        part.state.output.length > 5000 ? part.state.output.slice(0, 5000) + "\n...(truncated)" : part.state.output
      result += `\n<details><summary>Output</summary>\n\n\`\`\`\n${output}\n\`\`\`\n\n</details>\n`
    }
    if (options.toolDetails && part.state.status === "error" && part.state.error) {
      result += `\n**Error:**\n\`\`\`\n${part.state.error}\n\`\`\`\n`
    }
    result += `\n`
    return result
  }

  if (part.type === "step-finish") {
    if (!options.assistantMetadata) return ""
    const t = part.tokens
    const tokens = `${t.input}in/${t.output}out`
    const reasoning = t.reasoning ? `/${t.reasoning}reasoning` : ""
    const cache = t.cache ? ` (cache: ${t.cache.read}r/${t.cache.write}w)` : ""
    const cost = part.cost ? ` · $${part.cost.toFixed(4)}` : ""
    return `> _Step: ${tokens}${reasoning}${cache}${cost}_\n\n`
  }

  if (part.type === "patch") {
    if (!part.files.length) return ""
    return `**Files changed:**\n${part.files.map((f) => `- \`${f}\``).join("\n")}\n\n`
  }

  return ""
}

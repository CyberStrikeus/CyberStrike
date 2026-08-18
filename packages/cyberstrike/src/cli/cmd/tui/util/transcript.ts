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

  return transcript
}

export function formatMessage(msg: UserMessage | AssistantMessage, parts: Part[], options: TranscriptOptions): string {
  let result = ""

  if (msg.role === "user") {
    result += `## User\n\n`
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
      const output = part.state.output.length > 5000
        ? part.state.output.slice(0, 5000) + "\n...(truncated)"
        : part.state.output
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

  return ""
}

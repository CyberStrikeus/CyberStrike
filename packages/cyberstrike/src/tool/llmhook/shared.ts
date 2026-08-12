export type Finding = {
  checkId: string
  provider: string
  severity: string
  status: string
  resource: string
  title: string
  details: string
  remediation: string
  cwe?: string
}

export type HookResult = { output: string; findings: Finding[] }

export type RunResult = { stdout: string; stderr: string; exitCode: number }

export type RequestFormat = "generic" | "openai" | "anthropic"

export type HandlerCtx = {
  target: string
  timeout: number
  format: RequestFormat
  headers: Record<string, string>
}

const MAX_RESPONSE_BYTES = 512 * 1024

export function run(cmd: string[], timeout = 30_000): RunResult {
  const proc = Bun.spawnSync(cmd, { timeout })
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  }
}

function buildChatBody(message: string, format: RequestFormat): Record<string, unknown> {
  if (format === "openai") return { messages: [{ role: "user", content: message }], model: "gpt-4" }
  if (format === "anthropic")
    return { messages: [{ role: "user", content: message }], model: "claude-sonnet-4-20250514", max_tokens: 1024 }
  return { message }
}

function buildConversationBody(
  messages: Array<{ role: string; content: string }>,
  format: RequestFormat,
): Record<string, unknown> {
  if (format === "openai") return { messages, model: "gpt-4" }
  if (format === "anthropic") return { messages, model: "claude-sonnet-4-20250514", max_tokens: 1024 }
  return { messages }
}

export function extractResponseText(body: string, format: RequestFormat): string {
  if (format === "openai") {
    try {
      const json = JSON.parse(body)
      return json.choices?.[0]?.message?.content || body
    } catch {
      return body
    }
  }
  if (format === "anthropic") {
    try {
      const json = JSON.parse(body)
      return json.content?.[0]?.text || body
    } catch {
      return body
    }
  }
  try {
    const json = JSON.parse(body)
    return json.response || json.reply || json.content || json.message || json.text || json.output || body
  } catch {
    return body
  }
}

export async function httpPost(
  url: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
  timeout = 15_000,
): Promise<{ status: number; body: string; headers: Headers }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const buf = await resp.arrayBuffer()
    const text =
      buf.byteLength > MAX_RESPONSE_BYTES
        ? new TextDecoder().decode(buf.slice(0, MAX_RESPONSE_BYTES)) + `\n[truncated at ${MAX_RESPONSE_BYTES} bytes]`
        : new TextDecoder().decode(buf)
    return { status: resp.status, body: text, headers: resp.headers }
  } finally {
    clearTimeout(timer)
  }
}

export async function chatPost(
  url: string,
  message: string,
  format: RequestFormat,
  headers?: Record<string, string>,
  timeout = 15_000,
): Promise<{ status: number; body: string; text: string; headers: Headers }> {
  const resp = await httpPost(url, buildChatBody(message, format), headers, timeout)
  return { ...resp, text: extractResponseText(resp.body, format) }
}

export async function conversationPost(
  url: string,
  messages: Array<{ role: string; content: string }>,
  format: RequestFormat,
  headers?: Record<string, string>,
  timeout = 15_000,
): Promise<{ status: number; body: string; text: string; headers: Headers }> {
  const resp = await httpPost(url, buildConversationBody(messages, format), headers, timeout)
  return { ...resp, text: extractResponseText(resp.body, format) }
}

export async function httpGet(
  url: string,
  headers?: Record<string, string>,
  timeout = 10_000,
): Promise<{ status: number; body: string; headers: Headers }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { ...headers },
      signal: controller.signal,
    })
    const buf = await resp.arrayBuffer()
    const text =
      buf.byteLength > MAX_RESPONSE_BYTES
        ? new TextDecoder().decode(buf.slice(0, MAX_RESPONSE_BYTES)) + `\n[truncated at ${MAX_RESPONSE_BYTES} bytes]`
        : new TextDecoder().decode(buf)
    return { status: resp.status, body: text, headers: resp.headers }
  } finally {
    clearTimeout(timer)
  }
}

export function argVal(args: string, flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx === -1) return undefined
  const rest = args.slice(idx + flag.length).trim()
  const match = rest.match(/^"([^"]*)"/) || rest.match(/^(\S+)/)
  return match ? match[1] : undefined
}

export function hasFlag(args: string, flag: string): boolean {
  return args.includes(flag)
}

export function validateUrl(url: string): string | undefined {
  if (!url) return "No target URL provided"
  try {
    const parsed = new URL(url)
    if (!["http:", "https:"].includes(parsed.protocol))
      return `Invalid protocol: ${parsed.protocol} (expected http/https)`
    return undefined
  } catch {
    return `Invalid URL: ${url}`
  }
}

export function classifyError(e: unknown): string {
  const msg = String(e)
  if (msg.includes("abort") || msg.includes("AbortError")) return "TIMEOUT"
  if (msg.includes("ECONNREFUSED")) return "CONNECTION_REFUSED"
  if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo")) return "DNS_FAILURE"
  if (msg.includes("ECONNRESET")) return "CONNECTION_RESET"
  if (msg.includes("certificate") || msg.includes("SSL")) return "TLS_ERROR"
  return "NETWORK_ERROR"
}

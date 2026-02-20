import { Log } from "@/util/log"
import { isClaudeCliInstalled } from "@/auth/cli-credentials"

const log = Log.create({ service: "claude-cli-backend" })

export interface ClaudeCliResponse {
  result?: string
  response?: string
  content?: string
  session_id?: string
  sessionId?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
  error?: string
}

export interface ClaudeCliOptions {
  model?: string
  systemPrompt?: string
  sessionId?: string
  /** When true, uses --resume instead of --session-id (continues existing session) */
  resume?: boolean
  timeoutMs?: number
  workingDirectory?: string
}

const MODEL_ALIASES: Record<string, string> = {
  // Opus 4.5
  "claude-opus-4-5": "opus",
  "claude-opus-4.5": "opus",
  "claude-opus-4-5-20250514": "opus",
  "opus-4-5": "opus",
  "opus-4.5": "opus",
  opus: "opus",
  // Opus 4.6
  "claude-opus-4-6": "opus",
  "claude-opus-4.6": "opus",
  "claude-opus-4-6-20250514": "opus",
  "opus-4-6": "opus",
  "opus-4.6": "opus",
  // Sonnet 4.5
  "claude-sonnet-4-5": "sonnet",
  "claude-sonnet-4.5": "sonnet",
  "claude-sonnet-4-5-20250514": "sonnet",
  "sonnet-4-5": "sonnet",
  "sonnet-4.5": "sonnet",
  sonnet: "sonnet",
  // Haiku 4.5
  "claude-haiku-4-5": "haiku",
  "claude-haiku-4.5": "haiku",
  "claude-haiku-4-5-20250514": "haiku",
  "haiku-4-5": "haiku",
  "haiku-4.5": "haiku",
  haiku: "haiku",
}

function normalizeModel(modelId: string): string {
  const normalized = modelId.toLowerCase().replace(/[^a-z0-9-]/g, "-")
  return MODEL_ALIASES[normalized] ?? MODEL_ALIASES[modelId] ?? modelId
}

export async function runClaudeCli(
  prompt: string,
  options: ClaudeCliOptions = {},
): Promise<ClaudeCliResponse> {
  if (!isClaudeCliInstalled()) {
    throw new Error("Claude Code CLI is not installed. Please install it first: https://claude.ai/download")
  }

  const model = normalizeModel(options.model ?? "sonnet")
  const timeoutMs = options.timeoutMs ?? 900000 // 15 minutes default (security ops can be long)

  const args: string[] = [
    "-p", // print mode
    "--output-format",
    "json",
    "--dangerously-skip-permissions",
    "--model",
    model,
  ]

  if (options.systemPrompt) {
    args.push("--system-prompt", options.systemPrompt)
  }

  if (options.sessionId) {
    if (options.resume) {
      // Continue an existing session — Claude CLI loads full conversation history
      args.push("--resume", options.sessionId)
    } else {
      args.push("--session-id", options.sessionId)
    }
  }

  // Add the prompt as the last argument
  args.push(prompt)

  log.info("running claude cli", {
    model,
    promptLength: prompt.length,
    hasSystemPrompt: !!options.systemPrompt,
    hasSessionId: !!options.sessionId,
  })

  try {
    const proc = Bun.spawn(["claude", ...args], {
      cwd: options.workingDirectory ?? process.cwd(),
      env: {
        ...process.env,
        // Clear any API keys to ensure CLI uses its own auth
        ANTHROPIC_API_KEY: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    })

    // Set up timeout with cleanup
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        proc.kill()
        reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })

    // Wait for process to complete or timeout
    let exitCode: number
    try {
      exitCode = await Promise.race([proc.exited, timeoutPromise])
    } finally {
      clearTimeout(timeoutId)
    }

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      log.error("claude cli failed", { code: exitCode, stderr })
      throw new Error(stderr || `Claude CLI exited with code ${exitCode}`)
    }

    const stdout = await new Response(proc.stdout).text()

    try {
      const parsed = JSON.parse(stdout.trim())
      log.info("claude cli response", {
        hasResult: !!parsed.result,
        sessionId: parsed.session_id ?? parsed.sessionId,
        usage: parsed.usage,
      })
      return parsed
    } catch (e) {
      // If not JSON, return as plain text
      log.warn("claude cli returned non-json output", { stdout: stdout.substring(0, 100) })
      return { result: stdout.trim() }
    }
  } catch (error) {
    log.error("claude cli spawn error", { error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

/**
 * Extract the text response from Claude CLI output
 */
export function extractResponseText(response: ClaudeCliResponse): string {
  return response.result ?? response.response ?? response.content ?? ""
}

/**
 * Check if Claude CLI backend is available
 */
export function isClaudeCliBackendAvailable(): boolean {
  return isClaudeCliInstalled()
}

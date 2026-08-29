// Shared GitHub Copilot session-token logic, used by BOTH the main chat
// provider (plugin/copilot.ts) and the hackbrowser crawler worker
// (hackbrowser-subprocess/hackbrowser-worker.ts). One implementation so the
// two can't drift — see #107, where the worker carried an unfixed copy and
// crawls with a Copilot model 403'd ("Forbidden").
//
// Dependency-light on purpose (only global fetch): the worker bundles it.

// GitHub Copilot's API validates that requests look like the VS Code Copilot
// client. Values sourced from the reference copilot-api proxy implementation.
export const COPILOT_EDITOR_VERSION = "vscode/1.99.3"
export const COPILOT_PLUGIN_VERSION = "copilot-chat/0.26.7"
export const COPILOT_USER_AGENT = "GitHubCopilotChat/0.26.7"
export const COPILOT_INTEGRATION_ID = "vscode-chat"
export const COPILOT_API_VERSION = "2025-04-01"

// The GitHub OAuth token (ghu_…) is NOT accepted directly by
// api.githubcopilot.com — exchange it for a short-lived Copilot session token
// (~30 min) at copilot_internal/v2/token. Cache per GitHub token, refresh
// before expiry.
const cache = new Map<string, { token: string; expires: number }>()

export async function exchangeCopilotToken(githubToken: string, apiBase = "https://api.github.com"): Promise<string> {
  const cached = cache.get(githubToken)
  if (cached && cached.expires > Date.now() + 60_000) return cached.token

  const response = await fetch(`${apiBase}/copilot_internal/v2/token`, {
    headers: {
      Authorization: `token ${githubToken}`,
      "Editor-Version": COPILOT_EDITOR_VERSION,
      "Editor-Plugin-Version": COPILOT_PLUGIN_VERSION,
      "User-Agent": COPILOT_USER_AGENT,
      "X-GitHub-Api-Version": COPILOT_API_VERSION,
      Accept: "application/json",
    },
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Copilot token exchange failed: ${response.status} ${body.slice(0, 300)}`)
  }

  const data = (await response.json()) as { token: string; expires_at: number; refresh_in?: number }
  cache.set(githubToken, { token: data.token, expires: data.expires_at * 1000 })
  return data.token
}

/** Drop the cached session token so the next call re-exchanges (used on 403 retry). */
export function invalidateCopilotToken(githubToken: string): void {
  cache.delete(githubToken)
}

/** Compute the copilot_internal token-exchange base for a domain ("" / github.com → api.github.com). */
export function copilotApiBase(enterpriseDomain?: string): string {
  const d = enterpriseDomain?.replace(/^https?:\/\//, "").replace(/\/$/, "")
  return d && d !== "github.com" ? `https://api.${d}` : "https://api.github.com"
}

// The integration/editor headers Copilot validates on api.githubcopilot.com
// requests. Without them (esp. copilot-integration-id) the API returns 403.
export function copilotHeaders(sessionToken: string, opts?: { vision?: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${sessionToken}`,
    "Copilot-Integration-Id": COPILOT_INTEGRATION_ID,
    "Editor-Version": COPILOT_EDITOR_VERSION,
    "Editor-Plugin-Version": COPILOT_PLUGIN_VERSION,
    "User-Agent": COPILOT_USER_AGENT,
    "X-GitHub-Api-Version": COPILOT_API_VERSION,
    "Openai-Intent": "conversation-edits",
  }
  if (opts?.vision) headers["Copilot-Vision-Request"] = "true"
  return headers
}

import { execSync } from "node:child_process"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { Log } from "@/util/log"

const log = Log.create({ service: "cli-credentials" })

const CLAUDE_CLI_CREDENTIALS_PATH = ".claude/.credentials.json"
const CLAUDE_CLI_KEYCHAIN_SERVICE = "Claude Code-credentials"

export type ClaudeCliCredential =
  | {
      type: "oauth"
      access: string
      refresh: string
      expires: number
    }
  | {
      type: "token"
      token: string
      expires: number
    }

/**
 * Read Claude Code CLI credentials from macOS Keychain
 */
function readFromKeychain(): ClaudeCliCredential | null {
  if (process.platform !== "darwin") return null

  try {
    const result = execSync(
      `security find-generic-password -s "${CLAUDE_CLI_KEYCHAIN_SERVICE}" -w`,
      { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    )

    const data = JSON.parse(result.trim())
    const claudeOauth = data?.claudeAiOauth
    if (!claudeOauth || typeof claudeOauth !== "object") return null

    const accessToken = claudeOauth.accessToken
    const refreshToken = claudeOauth.refreshToken
    const expiresAt = claudeOauth.expiresAt

    if (typeof accessToken !== "string" || !accessToken) return null
    if (typeof expiresAt !== "number" || expiresAt <= 0) return null

    if (typeof refreshToken === "string" && refreshToken) {
      log.info("read credentials from claude cli keychain", { type: "oauth" })
      return {
        type: "oauth",
        access: accessToken,
        refresh: refreshToken,
        expires: expiresAt,
      }
    }

    log.info("read credentials from claude cli keychain", { type: "token" })
    return {
      type: "token",
      token: accessToken,
      expires: expiresAt,
    }
  } catch {
    return null
  }
}

/**
 * Read Claude Code CLI credentials from file (~/.claude/.credentials.json)
 */
function readFromFile(): ClaudeCliCredential | null {
  const credPath = path.join(os.homedir(), CLAUDE_CLI_CREDENTIALS_PATH)

  try {
    if (!fs.existsSync(credPath)) return null

    const raw = JSON.parse(fs.readFileSync(credPath, "utf8"))
    if (!raw || typeof raw !== "object") return null

    const claudeOauth = raw.claudeAiOauth
    if (!claudeOauth || typeof claudeOauth !== "object") return null

    const accessToken = claudeOauth.accessToken
    const refreshToken = claudeOauth.refreshToken
    const expiresAt = claudeOauth.expiresAt

    if (typeof accessToken !== "string" || !accessToken) return null
    if (typeof expiresAt !== "number" || expiresAt <= 0) return null

    if (typeof refreshToken === "string" && refreshToken) {
      log.info("read credentials from claude cli file", { type: "oauth" })
      return {
        type: "oauth",
        access: accessToken,
        refresh: refreshToken,
        expires: expiresAt,
      }
    }

    log.info("read credentials from claude cli file", { type: "token" })
    return {
      type: "token",
      token: accessToken,
      expires: expiresAt,
    }
  } catch {
    return null
  }
}

/**
 * Check if Claude Code CLI is installed
 */
export function isClaudeCliInstalled(): boolean {
  try {
    execSync("which claude", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
    return true
  } catch {
    return false
  }
}

/**
 * Read Claude Code CLI credentials
 * Tries Keychain first (macOS), then falls back to file
 */
export function readClaudeCliCredentials(): ClaudeCliCredential | null {
  // Try Keychain first on macOS
  const keychainCreds = readFromKeychain()
  if (keychainCreds) return keychainCreds

  // Fall back to file
  return readFromFile()
}

/**
 * Check if Claude Code CLI credentials are valid (not expired)
 */
export function hasValidClaudeCliCredentials(): boolean {
  const creds = readClaudeCliCredentials()
  if (!creds) return false

  // Check if expired (with 5 minute buffer)
  const now = Date.now()
  const buffer = 5 * 60 * 1000
  return creds.expires > now + buffer
}

/**
 * Get the access token from Claude Code CLI credentials
 */
export function getClaudeCliAccessToken(): string | null {
  const creds = readClaudeCliCredentials()
  if (!creds) return null

  if (creds.type === "oauth") {
    return creds.access
  }
  return creds.token
}

/**
 * Get credential status for display
 */
export function getClaudeCliCredentialStatus(): {
  installed: boolean
  hasCredentials: boolean
  isValid: boolean
  expiresAt?: Date
} {
  const installed = isClaudeCliInstalled()
  const creds = readClaudeCliCredentials()
  const hasCredentials = creds !== null
  const isValid = hasValidClaudeCliCredentials()

  return {
    installed,
    hasCredentials,
    isValid,
    expiresAt: creds ? new Date(creds.expires) : undefined,
  }
}

/**
 * Refresh the Claude CLI OAuth token using the refresh token
 * Returns the new access token or null if refresh failed
 */
export async function refreshClaudeCliToken(): Promise<string | null> {
  const creds = readClaudeCliCredentials()
  if (!creds || creds.type !== "oauth") {
    log.warn("no oauth credentials to refresh")
    return null
  }

  try {
    // Use Claude CLI to refresh the token
    const result = execSync("claude auth refresh --json", {
      encoding: "utf8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    })

    const parsed = JSON.parse(result.trim())
    if (parsed.accessToken) {
      log.info("refreshed claude cli token")
      return parsed.accessToken
    }

    // If refresh command doesn't return token directly, read from credentials
    const newCreds = readClaudeCliCredentials()
    if (newCreds) {
      return newCreds.type === "oauth" ? newCreds.access : newCreds.token
    }

    return null
  } catch (error) {
    log.error("failed to refresh claude cli token", {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getValidClaudeCliToken(): Promise<string | null> {
  const creds = readClaudeCliCredentials()
  if (!creds) return null

  const token = creds.type === "oauth" ? creds.access : creds.token

  // Check if token is still valid (with 5 minute buffer)
  const now = Date.now()
  const buffer = 5 * 60 * 1000

  if (creds.expires > now + buffer) {
    return token
  }

  // Token expired or about to expire, try to refresh
  if (creds.type === "oauth") {
    log.info("token expired, attempting refresh")
    return await refreshClaudeCliToken()
  }

  log.warn("token expired and cannot refresh (not oauth)")
  return null
}

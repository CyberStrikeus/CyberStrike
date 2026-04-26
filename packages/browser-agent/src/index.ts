import { Log } from "cyberstrike/util/log"
import { run } from "./agent.ts"
import type { AgentConfig, CredentialConfig } from "./types.ts"

// ============================================================
// CLI entry point
// Usage: bun start <targetUrl> [options]
// ============================================================

const args = process.argv.slice(2)
const getArg = (flag: string) => {
  const idx = args.indexOf(flag)
  return idx !== -1 ? args[idx + 1] : undefined
}
const hasFlag = (flag: string) => args.includes(flag)

// Initialize logger before anything else
await Log.init({
  print: true,
  level: hasFlag("--debug") ? "DEBUG" : "INFO",
}).catch(() => {})

if (args.length === 0 || args[0] === "--help") {
  console.log(`
CyberStrike Browser Agent

Usage: bun start <targetUrl> [options]

Options:
  --session <path>         Load saved session cookies from file
  --save-session <path>    Save session after login (default: ./session.json)
  --user <username>        Auto-login username
  --pass <password>        Auto-login password
  --headless               Run browser in headless mode
  --steps <n>              Max navigation steps (default: 50)
  --cyberstrike <url>      CyberStrike server URL (default: http://127.0.0.1:4096)
  --cyberstrike-username <u> CyberStrike server username (default: "cyberstrike")
  --cyberstrike-password <p> CyberStrike server password (fallback: CYBERSTRIKE_SERVER_PASSWORD env var)
  --session-id <id>        Attach to existing CyberStrike session
  --credential-id <id>     Credential ID to tag requests with
  --authenticated          Manual login mode: user logs in via browser, clicks button to start
  --credential <label>     Multi-credential mode: add a credential (repeat for each role)
  --exclude <label>        Out-of-scope label — planner never plans tasks matching this
                           (semantic match). Repeat for multiple exclusions.
                           Write the button text you see in the UI.
                           Examples: --exclude "Delete Account"
                                     --exclude "Cancel Subscription"
  --scope <pattern>        Network scope — only requests to matching hosts are
                           forwarded to CyberStrike. Repeat for multiple hosts.
                           Accepts bare host ("api.test.com") or wildcard
                           ("*.test.com"). When omitted, scope is auto-derived
                           from targetUrl as "*.{eTLD+1}". Providing --scope
                           replaces auto-derivation entirely.
  --dry-run                Crawl without sending to CyberStrike; print captures to console
  --no-panel               Disable the live telemetry panel injected into the browser
  --debug                  Enable verbose debug logging

Examples:
  bun start https://app.example.com
  bun start https://app.example.com --session ./session.json
  bun start https://app.example.com --user admin@example.com --pass secret
  bun start https://app.example.com --headless --steps 100
  bun start https://app.example.com --authenticated --dry-run
  bun start https://app.example.com --dry-run
  bun start https://app.example.com --dry-run --debug
  bun start https://app.example.com --credential admin --credential user
  bun start https://app.example.com --exclude "Delete Account" --exclude "Unsubscribe"
  bun start https://app.example.com --scope "*.example.com"
  bun start https://app.example.com --scope app.example.com --scope api.example.com
`)
  process.exit(0)
}

// Parse --credential flags (can appear multiple times)
function parseCredentials(): CredentialConfig[] | undefined {
  const creds: CredentialConfig[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--credential" && args[i + 1] && !args[i + 1]!.startsWith("--")) {
      creds.push({ id: args[i + 1]! })
    }
  }
  return creds.length >= 2 ? creds : undefined
}

// Parse --exclude flags (Aşama 13) — out-of-scope labels, repeatable.
// Label strings are passed to the planner verbatim; semantic matching is
// done by the LLM (see planner.txt "Out-of-Scope Filter").
function parseOutOfScope(): string[] | undefined {
  const labels: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--exclude" && args[i + 1] && !args[i + 1]!.startsWith("--")) {
      labels.push(args[i + 1]!)
    }
  }
  return labels.length > 0 ? labels : undefined
}

// Parse --scope flags — network scope hostnames, repeatable.
// Bare host or "*.host" wildcard. Empty result → undefined → agent
// auto-derives from targetUrl. See ARCHITECTURE.md §1.2 Network Scope.
function parseScope(): string[] | undefined {
  const patterns: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--scope" && args[i + 1] && !args[i + 1]!.startsWith("--")) {
      patterns.push(args[i + 1]!)
    }
  }
  return patterns.length > 0 ? patterns : undefined
}

const multiCredentials = parseCredentials()
const outOfScope = parseOutOfScope()
const scope = parseScope()

const config: AgentConfig = {
  targetUrl: args[0]!,
  cyberstrike: {
    serverUrl: getArg("--cyberstrike") ?? "http://127.0.0.1:4096",
    sessionID: getArg("--session-id"),
    credentialId: getArg("--credential-id"),
    username: getArg("--cyberstrike-username"),
    password: getArg("--cyberstrike-password") ?? process.env.CYBERSTRIKE_SERVER_PASSWORD,
  },
  auth: {
    sessionFile: getArg("--session"),
    credentials:
      getArg("--user") && getArg("--pass")
        ? { username: getArg("--user")!, password: getArg("--pass")! }
        : undefined,
    authenticated: hasFlag("--authenticated"),
  },
  multiCredentials,
  outOfScope,
  scope,
  maxSteps: getArg("--steps") ? parseInt(getArg("--steps")!) : 50,
  headless: hasFlag("--headless"),
  dryRun: hasFlag("--dry-run"),
  panel: !hasFlag("--no-panel"),
}

run(config).catch((err) => {
  console.error("[fatal]", err)
  process.exit(1)
})

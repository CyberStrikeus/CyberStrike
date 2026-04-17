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
  --session-id <id>        Attach to existing CyberStrike session
  --credential-id <id>     Credential ID to tag requests with
  --authenticated          Manual login mode: user logs in via browser, clicks button to start
  --credential <label>     Multi-credential mode: add a credential (repeat for each role)
  --dry-run                Crawl without sending to CyberStrike; print captures to console
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

const multiCredentials = parseCredentials()

const config: AgentConfig = {
  targetUrl: args[0]!,
  cyberstrike: {
    serverUrl: getArg("--cyberstrike") ?? "http://127.0.0.1:4096",
    sessionID: getArg("--session-id"),
    credentialId: getArg("--credential-id"),
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
  maxSteps: getArg("--steps") ? parseInt(getArg("--steps")!) : 50,
  headless: hasFlag("--headless"),
  dryRun: hasFlag("--dry-run"),
}

run(config).catch((err) => {
  console.error("[fatal]", err)
  process.exit(1)
})

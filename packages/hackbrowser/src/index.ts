// Standalone CLI shell. The library lives in api.ts; this file is just argv
// parsing + a help message + an exit-code handoff. Cyberstrike-internal
// callers go through api.ts directly (no process.exit).
//
// Keep this file thin. New flags belong in api.ts:parseArgsToOptions.

import { Log } from "./log.ts"
import { runCrawl, parseArgsToOptions } from "./api.ts"

const argv = process.argv.slice(2)

if (argv.length === 0 || argv.includes("--help")) {
  console.log(`
CyberStrike Browser Agent

Usage: bun start <targetUrl> [options]

Options:
  --session <path>           Load saved session cookies from file
  --save-session <path>      Save session after login (default: ./session.json)
  --user <username>          Auto-login username
  --pass <password>          Auto-login password
  --headless                 Run browser in headless mode
  --steps <n>                Max navigation steps (default: 50)
  --cyberstrike <url>        CyberStrike server URL (default: http://127.0.0.1:4096)
  --cyberstrike-username <u> CyberStrike server username (default: "cyberstrike")
  --cyberstrike-password <p> CyberStrike server password (fallback: CYBERSTRIKE_SERVER_PASSWORD env var)
  --session-id <id>          Attach to existing CyberStrike session
  --credential-id <id>       Credential ID to tag requests with
  --authenticated            Manual login mode: user logs in via browser, clicks button to start
  --credential <label>       Multi-credential mode: add a credential (repeat for each role)
  --exclude <label>          Out-of-scope label — planner never plans tasks matching this
                             (semantic match). Repeat for multiple exclusions.
  --scope <pattern>          Network scope — bare host or "*.host" wildcard. Repeatable.
                             When omitted, derived from targetUrl as "*.{eTLD+1}".
  --dry-run                  Crawl without sending to CyberStrike; print captures to console
  --no-panel                 Disable the live telemetry panel injected into the browser
  --debug                    Enable verbose debug logging

Note: hackbrowser inside cyberstrike (Tool/Slash) uses the same engine via
api.ts:runCrawl. See INTEGRATION.md for the integration architecture.

Examples:
  bun start https://app.example.com
  bun start https://app.example.com --session ./session.json
  bun start https://app.example.com --user admin@example.com --pass secret
  bun start https://app.example.com --headless --steps 100
  bun start https://app.example.com --authenticated --dry-run
  bun start https://app.example.com --credential admin --credential user
  bun start https://app.example.com --exclude "Delete Account"
  bun start https://app.example.com --scope app.example.com --scope api.example.com
`)
  process.exit(0)
}

// Initialize logger early so parsing-stage messages aren't lost.
Log.init({ level: argv.includes("--debug") ? "DEBUG" : "INFO" })

const opts = parseArgsToOptions(argv)

try {
  const result = await runCrawl(opts)
  if (result.errors.length > 0) {
    console.error("[fatal]", result.errors.join("\n"))
    process.exit(1)
  }
  process.exit(0)
} catch (err) {
  // Validation/preflight throws (multi-credential mismatch, missing chromium).
  // These are caller-error conditions; surface them clearly and exit non-zero.
  console.error("[fatal]", err instanceof Error ? err.message : String(err))
  process.exit(1)
}

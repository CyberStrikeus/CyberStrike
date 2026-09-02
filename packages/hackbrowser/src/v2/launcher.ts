// CyberStrike HackBrowser 2.0 — multi-profile launcher (managed mode, §3.1/§3.4).
//
// Opens N isolated Chrome profiles, each with our extension loaded and tagged with
// a credential label — the automated version of "N profiles → one extension
// instance per profile" (§3.1). Each profile is a separate --user-data-dir (its
// own cookie jar = its own identity). The credential label rides in as a URL hash
// (#__cs_cred=<label>) which the content script reads, self-registers, and strips.
//
// Usage:
//   bun run src/v2/launcher.ts --url https://target --creds admin,user [--dry-run]
//   bun run src/v2/launcher.ts --url https://target            (single, no cred)
//
// Browser preference mirrors §3.4: installed Chrome → Edge → Brave (macOS paths).
// CfT download fallback is not included here yet.

import { existsSync } from "node:fs"
import { join } from "node:path"
import { buildProfileArgs, findBrowser, defaultExtensionPath } from "./spawn.ts"

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
function flag(name: string): boolean {
  return process.argv.includes(name)
}

function main() {
  const url = arg("--url")
  if (!url) {
    console.error("error: --url is required")
    process.exit(1)
  }
  const dryRun = flag("--dry-run")
  const extPath = arg("--ext") ?? defaultExtensionPath()
  if (!existsSync(join(extPath, "manifest.json"))) {
    console.error(`error: extension not found at ${extPath} (no manifest.json)`)
    process.exit(1)
  }
  const headless = flag("--headless")

  // --creds admin,user → one profile per credential. Absent → a single unnamed profile.
  const credsRaw = arg("--creds")
  const creds = credsRaw ? credsRaw.split(",").map((c) => c.trim()).filter(Boolean) : [""]

  // --session <id> → all profiles attach to the SAME CyberStrike session, so their
  // per-credential captures compare on the same endpoints (IDOR/BFLA). Pick an
  // existing session id (GET /session?roots=true) or a fresh one you create in CS.
  const session = arg("--session")

  const browser = findBrowser()
  if (!browser) {
    console.error(`error: no Chromium browser found (Chrome / Edge / Brave)`)
    process.exit(1)
  }
  console.log(`[hb2] browser: ${browser}`)
  console.log(`[hb2] extension: ${extPath}`)
  console.log(`[hb2] profiles: ${creds.map((c) => c || "(default)").join(", ")}`)

  for (const cred of creds) {
    // Single source for the Chrome invocation — shared with the CyberStrike route.
    const built = buildProfileArgs({ url, cred, session, extPath, browser, headless })
    const profileId = cred || "default"
    if (dryRun) {
      console.log(`\n[dry-run] ${profileId}:`)
      console.log(`  ${built.browser} \\\n    ${built.args.join(" \\\n    ")}`)
      continue
    }
    Bun.spawn([built.browser, ...built.args], { stdout: "ignore", stderr: "ignore" })
    console.log(`[hb2] launched profile "${profileId}" → ${built.profileDir}`)
  }

  if (!dryRun) console.log(`\n[hb2] ${creds.length} profile(s) launched. Each will self-register its credential.`)
}

main()

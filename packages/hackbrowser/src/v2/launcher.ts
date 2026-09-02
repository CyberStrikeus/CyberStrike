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
import { tmpdir } from "node:os"

const BROWSERS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
]

function findBrowser(): string | null {
  for (const p of BROWSERS) if (existsSync(p)) return p
  return null
}

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
  const extPath = arg("--ext") ?? join(import.meta.dir, "..", "..", "extension")
  if (!existsSync(join(extPath, "manifest.json"))) {
    console.error(`error: extension not found at ${extPath} (no manifest.json)`)
    process.exit(1)
  }

  // --creds admin,user → one profile per credential. Absent → a single unnamed profile.
  const credsRaw = arg("--creds")
  const creds = credsRaw ? credsRaw.split(",").map((c) => c.trim()).filter(Boolean) : [""]

  const browser = findBrowser()
  if (!browser) {
    console.error(`error: no Chromium browser found. Looked for:\n  ${BROWSERS.join("\n  ")}`)
    process.exit(1)
  }
  console.log(`[hb2] browser: ${browser}`)
  console.log(`[hb2] extension: ${extPath}`)
  console.log(`[hb2] profiles: ${creds.map((c) => c || "(default)").join(", ")}`)

  for (const cred of creds) {
    const profileId = cred || "default"
    const userDataDir = join(tmpdir(), `hb2-profile-${profileId}`)
    const target = cred ? `${url}#__cs_cred=${encodeURIComponent(cred)}` : url
    const args = [
      `--user-data-dir=${userDataDir}`,
      `--load-extension=${extPath}`,
      // Suppress the "…started debugging this browser" bar that chrome.debugger
      // (our Network capture) would otherwise show. Only works when WE launch
      // Chrome (managed mode); a user's own Chrome (BYOB) still shows it.
      "--silent-debugger-extension-api",
      "--no-first-run",
      "--no-default-browser-check",
      "--new-window",
      target,
    ]
    if (dryRun) {
      console.log(`\n[dry-run] ${profileId}:`)
      console.log(`  ${browser} \\\n    ${args.join(" \\\n    ")}`)
      continue
    }
    Bun.spawn([browser, ...args], { stdout: "ignore", stderr: "ignore" })
    console.log(`[hb2] launched profile "${profileId}" → ${userDataDir}`)
  }

  if (!dryRun) console.log(`\n[hb2] ${creds.length} profile(s) launched. Each will self-register its credential.`)
}

main()

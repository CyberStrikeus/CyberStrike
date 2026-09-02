// Spawn ONE Chrome profile with the hackbrowser extension loaded, tagged with a
// credential/role and attached to a CyberStrike session. The exact Chrome invocation
// lives here ONCE and is shared by two callers:
//   - the CLI launcher (v2/launcher.ts) — N profiles up front
//   - the CyberStrike "add role" route — one profile per panel click
// Each profile is a separate --user-data-dir (its own cookie jar = its own identity,
// §3.1). Session + credential ride in as a URL hash the content script reads/strips.

import { existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// Browser preference mirrors §3.4: Chrome → Edge → Brave (macOS paths). A CfT
// download fallback is not included yet.
const BROWSERS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
]

export function findBrowser(): string | null {
  for (const p of BROWSERS) if (existsSync(p)) return p
  return null
}

// The static extension directory. Resolves relative to THIS file, so it is correct
// whether called from the CLI launcher or imported by CyberStrike (dev/monorepo).
// NOTE: a packaged CLI must ship the extension dir alongside — a build-time concern.
export function defaultExtensionPath(): string {
  return join(import.meta.dir, "..", "..", "extension")
}

export interface ProfileSpec {
  url: string
  // Role/credential label. Empty/undefined = anonymous (no tagging).
  cred?: string
  // CyberStrike session id — shared across profiles so their captures compare.
  session?: string
  extPath?: string
  browser?: string
  headless?: boolean
  // Override the profile dir; default is tmpdir/hb2-profile-<cred|default>.
  profileDir?: string
}

export interface BuiltProfile {
  browser: string
  args: string[]
  profileDir: string
}

export function buildProfileArgs(spec: ProfileSpec): BuiltProfile {
  const browser = spec.browser ?? findBrowser()
  if (!browser) throw new Error(`no Chromium browser found (looked for: ${BROWSERS.join(", ")})`)
  const extPath = spec.extPath ?? defaultExtensionPath()
  if (!existsSync(join(extPath, "manifest.json"))) throw new Error(`extension not found at ${extPath} (no manifest.json)`)

  const profileId = spec.cred || "default"
  const profileDir = spec.profileDir ?? join(tmpdir(), `hb2-profile-${profileId}`)

  const hashParts: string[] = []
  if (spec.cred) hashParts.push(`__cs_cred=${encodeURIComponent(spec.cred)}`)
  if (spec.session) hashParts.push(`__cs_sess=${encodeURIComponent(spec.session)}`)
  const target = hashParts.length ? `${spec.url}#${hashParts.join("&")}` : spec.url

  const args = [
    `--user-data-dir=${profileDir}`,
    `--load-extension=${extPath}`,
    // Suppress the "…started debugging this browser" bar (managed mode only).
    "--silent-debugger-extension-api",
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
  ]
  if (spec.headless) args.push("--headless=new")
  args.push(target)
  return { browser, args, profileDir }
}

export function spawnProfile(spec: ProfileSpec): { profileDir: string; pid: number } {
  const built = buildProfileArgs(spec)
  const proc = Bun.spawn([built.browser, ...built.args], { stdout: "ignore", stderr: "ignore" })
  return { profileDir: built.profileDir, pid: proc.pid }
}

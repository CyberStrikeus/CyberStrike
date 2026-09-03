// Spawn ONE Chrome profile with the hackbrowser extension loaded, tagged with a
// credential/role and attached to a CyberStrike session. The exact Chrome invocation
// lives here ONCE and is shared by two callers:
//   - the CLI launcher (v2/launcher.ts) — N profiles up front
//   - the CyberStrike "add role" route — one profile per panel click
// Each profile is a separate --user-data-dir (its own cookie jar = its own identity,
// §3.1). Session + credential ride in as a URL hash the content script reads/strips.

import { existsSync, readdirSync, statSync, cpSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir, homedir } from "node:os"

// Branded Google Chrome 137+ REMOVED the --load-extension switch (Chrome 142 removed the
// --disable-features workaround too), so it can no longer load our unpacked extension
// from the command line. We therefore spawn an EXTENSION-CAPABLE build instead — the
// removal doesn't affect Chrome for Testing, unbranded Chromium, or Brave.
const APP_BROWSERS = [
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
]

// Chrome-for-Testing / Chromium builds that puppeteer or playwright already downloaded —
// a very common case on dev machines. Newest name wins (version/build is in the dir).
function cachedBrowsers(): string[] {
  const out: string[] = []
  const roots = [join(homedir(), ".cache", "puppeteer", "chrome"), join(homedir(), "Library", "Caches", "ms-playwright")]
  const leaves = ["chrome-mac-arm64", "chrome-mac"]
  const apps = [
    "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "Chromium.app/Contents/MacOS/Chromium",
  ]
  for (const root of roots) {
    let entries: string[]
    try {
      entries = readdirSync(root).sort().reverse()
    } catch {
      continue
    }
    for (const e of entries) {
      for (const leaf of leaves) {
        for (const app of apps) {
          const p = join(root, e, leaf, app)
          if (existsSync(p)) out.push(p)
        }
      }
    }
  }
  return out
}

// Returns an extension-capable browser, or null. Branded Chrome is intentionally NOT
// returned — it opens but silently ignores --load-extension on 137+, which is exactly
// the "browser spawns but no panel" failure.
export function findBrowser(): string | null {
  for (const p of APP_BROWSERS) if (existsSync(p)) return p
  const cached = cachedBrowsers()
  return cached.length ? cached[0] : null
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
  // CyberStrike server base URL the extension must call back to. Passed so the extension
  // talks to THIS server even when it bound a non-default port (4096 was taken → random).
  csUrl?: string
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
  if (!browser)
    throw new Error(
      "no extension-capable browser found (Chrome for Testing / Chromium / Brave). Branded " +
        "Chrome 137+ can't load extensions via the command line. Install one with: " +
        "npx @puppeteer/browsers install chrome@stable",
    )
  const extPath = spec.extPath ?? defaultExtensionPath()
  if (!existsSync(join(extPath, "manifest.json"))) throw new Error(`extension not found at ${extPath} (no manifest.json)`)

  const profileId = spec.cred || "default"
  const profileDir = spec.profileDir ?? join(tmpdir(), `hb2-profile-${profileId}`)

  const hashParts: string[] = []
  if (spec.cred) hashParts.push(`__cs_cred=${encodeURIComponent(spec.cred)}`)
  if (spec.session) hashParts.push(`__cs_sess=${encodeURIComponent(spec.session)}`)
  if (spec.csUrl) hashParts.push(`__cs_url=${encodeURIComponent(spec.csUrl)}`)
  const target = hashParts.length ? `${spec.url}#${hashParts.join("&")}` : spec.url

  const args = [
    `--user-data-dir=${profileDir}`,
    `--load-extension=${extPath}`,
    // Suppress the "…started debugging this browser" bar (managed mode only).
    "--silent-debugger-extension-api",
    "--no-first-run",
    "--no-default-browser-check",
    // Chrome 137+/142+ blocks requests to localhost from public (HTTPS) pages via
    // Private / Local Network Access, which stops the extension from reaching CyberStrike
    // at http://127.0.0.1. Disable those checks for this managed testing browser. Chrome
    // ignores unknown feature names, so listing several covers version drift.
    "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests",
    "--new-window",
  ]
  if (spec.headless) args.push("--headless=new")
  args.push(target)
  return { browser, args, profileDir }
}

// Chrome caches the MV3 service worker (background.js) by manifest `version` in the persistent
// --user-data-dir profile — so a static version leaves a STALE service worker across launches
// even though --load-extension re-reads content scripts. That silently strands every
// background.js change (control WS, driver POST, diagnostics), which is the classic "panel
// shows but AI never drives / no logs".
//
// Fix: stage the extension into a stable temp dir with the version derived from the source
// files' latest mtime — MONOTONIC, so Chrome sees an update and refreshes the SW whenever the
// code changes, and no change means no needless churn. The source manifest is never touched
// (no git noise). Falls back to the source dir if staging fails (still launchable, just with
// the SW-cache caveat).
export function stageExtension(srcDir: string, outDir: string = join(tmpdir(), "hb2-ext")): string {
  try {
    let maxMtime = 0
    for (const f of readdirSync(srcDir)) {
      const m = statSync(join(srcDir, f)).mtimeMs
      if (m > maxMtime) maxMtime = m
    }
    const secs = Math.floor(maxMtime / 1000)
    // manifest version = 4 dotted ints, each 0..65535; encode mtime into the last two parts.
    const hi = Math.floor(secs / 65535) % 65536
    const lo = secs % 65535
    cpSync(srcDir, outDir, { recursive: true }) // small dir; fresh copy so edits always propagate
    const manifestPath = join(outDir, "manifest.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    manifest.version = `0.1.${hi}.${lo}`
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    return outDir
  } catch {
    return srcDir
  }
}

export function spawnProfile(spec: ProfileSpec): { profileDir: string; pid: number; proc: ReturnType<typeof Bun.spawn> } {
  // Stage the extension (fresh SW version) unless the caller pinned an explicit extPath (tests).
  const extPath = spec.extPath ?? stageExtension(defaultExtensionPath())
  const built = buildProfileArgs({ ...spec, extPath })
  const proc = Bun.spawn([built.browser, ...built.args], { stdout: "ignore", stderr: "ignore" })
  // proc is returned so the caller (CyberStrike) can track and later close the browser.
  return { profileDir: built.profileDir, pid: proc.pid, proc }
}

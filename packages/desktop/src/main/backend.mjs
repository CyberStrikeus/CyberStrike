// Backend lifecycle for the desktop shell (MVP). Spawns the local CyberStrike server (`cyberstrike web
// --no-open`) and resolves once it answers, so the window can load its URL. Dev only for now: it runs the
// CLI from source via bun; a packaged build will spawn a bundled server binary instead (TODO).
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import * as http from "node:http"

const here = dirname(fileURLToPath(import.meta.url))
// packages/desktop/src/main → packages/cyberstrike/src/index.ts
const CYBERSTRIKE_ENTRY = join(here, "..", "..", "..", "cyberstrike", "src", "index.ts")

// MUST be 4096: the HackBrowser capture extension ingests to http://127.0.0.1:4096/session/ingest by
// default, so the desktop's server has to own that port or captured traffic never reaches it.
const PORT = 4096

// GET the URL; resolve true on ANY HTTP response (even 401 — the server is up), false on connection error.
function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(true)
    })
    req.on("error", () => resolve(false))
    req.setTimeout(1000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitReady(url, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode}) before becoming ready`)
    if (await ping(url)) return
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`server did not become ready at ${url} within ${timeoutMs}ms`)
}

/** Start (or attach to) the CyberStrike server on :4096 and wait until it answers. Returns { url, child }
 *  (child null when attaching to an already-running server). */
export async function startBackend(logger = console) {
  const url = `http://127.0.0.1:${PORT}/`

  // Attach-or-spawn: if something already serves :4096 (a CLI `cyberstrike web` the user started, or the
  // extension's expected server), reuse it instead of double-spawning. The extension targets this port
  // either way, so ingest lands on whichever instance owns 4096.
  if (await ping(url)) {
    logger.info?.(`[cyberstrike-desktop] attaching to existing server at ${url}`)
    return { url, child: null }
  }

  // Loopback requests skip auth, so the window needs no password — but `web` refuses to start without one,
  // so hand it a random ephemeral secret the user never sees.
  const password = randomBytes(24).toString("base64url")
  logger.info?.(`[cyberstrike-desktop] starting server on ${url}`)
  const child = spawn(
    "bun",
    ["run", "--conditions=browser", CYBERSTRIKE_ENTRY, "web", "--no-open", "--hostname", "127.0.0.1", "--port", String(PORT)],
    {
      env: { ...process.env, CYBERSTRIKE_SERVER_PASSWORD: password },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  child.stdout?.on("data", (d) => logger.info?.(`[server] ${String(d).trimEnd()}`))
  child.stderr?.on("data", (d) => logger.warn?.(`[server] ${String(d).trimEnd()}`))

  await waitReady(url, child)
  logger.info?.(`[cyberstrike-desktop] server ready at ${url}`)
  return { url, child }
}

export function stopBackend(child) {
  if (!child || child.exitCode !== null) return
  try {
    child.kill("SIGTERM")
    setTimeout(() => child.kill("SIGKILL"), 3000).unref?.()
  } catch {
    /* already gone */
  }
}

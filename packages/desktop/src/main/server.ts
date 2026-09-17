import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { app } from "electron"
import { getLogger } from "./logging"
import { getUserShell, loadShellEnv } from "./shell-env"
import { getStore } from "./store"
import { DEFAULT_SERVER_URL_KEY } from "./store-keys"

export type HealthCheck = { wait: Promise<void> }

export type SidecarListener = { stop: () => Promise<void> }

const SIDECAR_START_STALL_TIMEOUT = 60_000
const SIDECAR_STOP_TIMEOUT = 6_000

type SpawnLocalServerOptions = {
  userDataPath: string
  onStdout?: (message: string) => void
  onStderr?: (message: string) => void
  onExit?: (code: number) => void
}

export function getDefaultServerUrl(): string | null {
  const value = getStore().get(DEFAULT_SERVER_URL_KEY)
  return typeof value === "string" ? value : null
}

export function setDefaultServerUrl(url: string | null) {
  if (url) {
    getStore().set(DEFAULT_SERVER_URL_KEY, url)
    return
  }

  getStore().delete(DEFAULT_SERVER_URL_KEY)
}

export function preferAppEnv(userDataPath: string) {
  const shell = process.platform === "win32" ? null : getUserShell()
  const shellEnv = shell ? loadShellEnv(shell, getLogger()) : null
  Object.assign(process.env, {
    ...shellEnv,
    CYBERSTRIKE_EXPERIMENTAL_ICON_DISCOVERY: "true",
    CYBERSTRIKE_EXPERIMENTAL_FILEWATCHER: "true",
    CYBERSTRIKE_CLIENT: "desktop",
    XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? userDataPath,
  })
  return shellEnv
}

// Resolve how to launch the CyberStrike server. Packaged: the bundled compiled binary under
// resources. Dev: run the CLI from source via bun (matches the proven pre-port spawn recipe —
// run from the cyberstrike package dir so bun resolves the CLI's deps relative to cwd).
function resolveServerLaunch(hostname: string, port: number) {
  const baseArgs = ["web", "--no-open", "--hostname", hostname, "--port", String(port)]
  if (app.isPackaged) {
    const binaryName = process.platform === "win32" ? "cyberstrike.exe" : "cyberstrike"
    const binary = join(process.resourcesPath, "cyberstrike", "bin", binaryName)
    return { command: binary, args: baseArgs, cwd: dirname(binary) }
  }
  // out/main/index.js → out → desktop → packages → cyberstrike
  const here = dirname(fileURLToPath(import.meta.url))
  const cyberstrikeDir = join(here, "..", "..", "..", "cyberstrike")
  const entry = join(cyberstrikeDir, "src", "index.ts")
  return { command: "bun", args: ["run", entry, ...baseArgs], cwd: cyberstrikeDir }
}

// Start the local CyberStrike server as a managed child process on 4096. Our server is
// bun-coupled (Bun.serve, $, …), so it runs as its own bun process rather than in-process
// under Electron's Node runtime. Loopback requests skip auth, so the renderer connects with
// no credentials; the password is still passed so the CLI (which requires one) will start.
export async function spawnLocalServer(
  hostname: string,
  port: number,
  password: string,
  options: SpawnLocalServerOptions,
) {
  const launch = resolveServerLaunch(hostname, port)
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: { ...createSidecarEnv(), CYBERSTRIKE_SERVER_PASSWORD: password },
    stdio: ["ignore", "pipe", "pipe"],
  })

  let exited = false
  const exit = defer<number>()

  child.once("exit", (code) => {
    exited = true
    options.onExit?.(code ?? 0)
    exit.resolve(code ?? 0)
  })
  child.on("error", (error) => options.onStderr?.(`server spawn error: ${serializeError(error).message}`))
  child.stdout?.on("data", (chunk: Buffer) => options.onStdout?.(chunk.toString("utf8").trimEnd()))
  child.stderr?.on("data", (chunk: Buffer) => options.onStderr?.(chunk.toString("utf8").trimEnd()))

  const wait = (async () => {
    const url = `http://${hostname}:${port}`
    let healthy = false
    const gone = exit.promise.then((code) => {
      if (healthy) return
      throw new Error(`Server exited before health check passed with code ${code}`)
    })

    const ready = async () => {
      const deadline = Date.now() + SIDECAR_START_STALL_TIMEOUT
      while (Date.now() < deadline) {
        await delay(150)
        if (await checkHealth(url, password)) {
          healthy = true
          return
        }
      }
      throw new Error(`Server did not become ready within ${SIDECAR_START_STALL_TIMEOUT}ms`)
    }

    await Promise.race([ready(), gone])
  })()

  let stopping: Promise<void> | undefined

  return {
    listener: {
      stop: () => {
        if (stopping) return stopping
        if (exited) return Promise.resolve()
        child.kill()
        stopping = Promise.race([
          exit.promise.then(() => undefined),
          delay(SIDECAR_STOP_TIMEOUT).then(() => {
            if (!exited) child.kill("SIGKILL")
          }),
        ])
        return stopping
      },
    },
    health: { wait },
  }
}

export async function checkHealth(url: string, password?: string | null): Promise<boolean> {
  let healthUrls: URL[]
  try {
    // "/" first: our server answers on the root over loopback (auth skipped). The /api and
    // /global health paths are kept as fallbacks for other server variants.
    healthUrls = [new URL("/", url), new URL("/api/health", url), new URL("/global/health", url)]
  } catch {
    return false
  }

  const headers = new Headers()
  if (password) {
    const auth = Buffer.from(`cyberstrike:${password}`).toString("base64")
    headers.set("authorization", `Basic ${auth}`)
  }

  for (const healthUrl of healthUrls) {
    try {
      const res = await fetch(healthUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(3000),
      })
      // Any answer (including 401) means the server process is up and listening.
      if (res.status < 500) return true
    } catch {}
  }
  return false
}

function createSidecarEnv(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])),
  )
  delete env.DEBUG
  if (process.platform === "linux") delete env.LD_PRELOAD
  return env
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}

function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

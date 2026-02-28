import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./browser.txt"
import path from "path"
import fs from "fs/promises"
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "fs"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { generateControlPage, generateContextInjection } from "./browser-ui"
import { BrowserAnalysis, type NetworkEntry, type ConsoleEntry } from "./browser-analysis"

const log = Log.create({ service: "tool.browser" })

// ============================================================================
// Work Directory Override (for MCP server context where Instance is unavailable)
// ============================================================================

let _workDirOverride: string | undefined

/** Set explicit work directory — used by MCP browser server to avoid Instance dependency */
export function setWorkDir(dir: string) {
  _workDirOverride = dir
}

function getWorkDir(): string {
  return _workDirOverride ?? Instance.worktree
}

function getProjectDir(): string {
  return _workDirOverride ?? Instance.directory
}

// ============================================================================
// Cookie Jar — Per-container cookie isolation (like Firefox Multi-Account Containers)
// ============================================================================

interface CookieEntry {
  name: string
  value: string
  domain: string
  path: string
  expires?: number // unix timestamp in seconds
  httpOnly: boolean
  secure: boolean
  sameSite: string
}

class ContainerCookieJar {
  private cookies = new Map<string, CookieEntry>()

  private key(c: { name: string; domain: string; path: string }): string {
    return `${c.domain}|${c.path}|${c.name}`
  }

  set(cookie: CookieEntry): void {
    if (cookie.expires !== undefined && cookie.expires <= Date.now() / 1000) {
      this.cookies.delete(this.key(cookie))
      return
    }
    this.cookies.set(this.key(cookie), cookie)
  }

  getForUrl(url: string): CookieEntry[] {
    try {
      const parsed = new URL(url)
      const now = Date.now() / 1000
      return Array.from(this.cookies.values()).filter((c) => {
        if (c.expires !== undefined && c.expires <= now) return false
        const cookieDomain = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain
        if (parsed.hostname !== cookieDomain && !parsed.hostname.endsWith("." + cookieDomain)) return false
        if (!parsed.pathname.startsWith(c.path)) return false
        if (c.secure && parsed.protocol !== "https:") return false
        return true
      })
    } catch {
      return []
    }
  }

  formatForHeader(url: string): string {
    return this.getForUrl(url)
      .map((c) => `${c.name}=${c.value}`)
      .join("; ")
  }

  getDocumentCookies(url: string): string {
    return this.getForUrl(url)
      .filter((c) => !c.httpOnly)
      .map((c) => `${c.name}=${c.value}`)
      .join("; ")
  }

  getAll(): CookieEntry[] {
    return Array.from(this.cookies.values())
  }

  getAllFormatted(): Array<{
    name: string
    value: string
    domain: string
    path: string
    httpOnly: boolean
    secure: boolean
    sameSite: string
    expires: string
  }> {
    return this.getAll().map((c) => ({
      name: c.name,
      value: c.value.length > 30 ? c.value.slice(0, 30) + "..." : c.value,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
      expires: c.expires ? new Date(c.expires * 1000).toISOString() : "session",
    }))
  }

  clear(): void {
    this.cookies.clear()
  }
}

function parseSetCookie(header: string, requestUrl: string): CookieEntry {
  const parts = header.split(";").map((p) => p.trim())
  const [nameValue, ...attrs] = parts
  const eqIdx = nameValue.indexOf("=")
  const name = eqIdx > -1 ? nameValue.slice(0, eqIdx).trim() : nameValue.trim()
  const value = eqIdx > -1 ? nameValue.slice(eqIdx + 1) : ""

  let domain: string
  try {
    domain = new URL(requestUrl).hostname
  } catch {
    domain = ""
  }

  const cookie: CookieEntry = {
    name,
    value,
    domain,
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }

  for (const attr of attrs) {
    const eqI = attr.indexOf("=")
    const k = (eqI > -1 ? attr.slice(0, eqI) : attr).trim().toLowerCase()
    const v = eqI > -1 ? attr.slice(eqI + 1).trim() : ""

    switch (k) {
      case "domain":
        cookie.domain = v
        break
      case "path":
        cookie.path = v || "/"
        break
      case "expires":
        if (!cookie.expires) {
          const ts = new Date(v).getTime()
          if (!isNaN(ts)) cookie.expires = ts / 1000
        }
        break
      case "max-age": {
        const sec = parseInt(v)
        if (!isNaN(sec)) cookie.expires = Date.now() / 1000 + sec
        break
      }
      case "httponly":
        cookie.httpOnly = true
        break
      case "secure":
        cookie.secure = true
        break
      case "samesite":
        cookie.sameSite = v || "Lax"
        break
    }
  }

  return cookie
}

// ============================================================================
// Types
// ============================================================================

interface BrowserContainer {
  id: string
  label: string
  color: string
  role: string
  page: any // Playwright Page — a tab in the shared single-window context
  cookieJar: ContainerCookieJar
  networkLogs: NetworkEntry[]
  consoleLogs: ConsoleEntry[]
}

interface BrowserSession {
  browser: any // Playwright Browser
  context: any // SINGLE Playwright BrowserContext — all containers are tabs here
  containers: Map<string, BrowserContainer>
  activeContainerId: string
  targetDomain: string | null
  harPath: string
  analysisDir: string
  networkLogFile: string
  consoleLogFile: string
  contextMetaFile: string
}

// Global browser sessions (per CyberStrike session)
const browserSessions = new Map<string, BrowserSession>()

// Stores analysis results from browser disconnect events (manual close, crash, etc.)
const disconnectResults = new Map<string, {
  summary: string
  analysisDir: string
  harPath: string
  timestamp: number
}>()

// Default context colors
const CONTEXT_COLORS: Record<string, string> = {
  red: "#dc2626",
  green: "#22c55e",
  blue: "#3b82f6",
  yellow: "#eab308",
  purple: "#a855f7",
  orange: "#f97316",
  cyan: "#06b6d4",
  pink: "#ec4899",
  gray: "#6b7280",
}

function resolveColor(color: string): string {
  return CONTEXT_COLORS[color] ?? (color.startsWith("#") ? color : "#6b7280")
}

// ============================================================================
// Disk Persistence
// ============================================================================

function flushNetworkEntry(session: BrowserSession, entry: NetworkEntry): void {
  try {
    appendFileSync(session.networkLogFile, JSON.stringify(entry) + "\n")
  } catch (err) {
    log.error("failed to flush network entry to disk", { error: err })
  }
}

function flushConsoleEntry(session: BrowserSession, entry: ConsoleEntry): void {
  try {
    appendFileSync(session.consoleLogFile, JSON.stringify(entry) + "\n")
  } catch (err) {
    log.error("failed to flush console entry to disk", { error: err })
  }
}

function persistContextMeta(session: BrowserSession): void {
  try {
    const meta = Array.from(session.containers.values()).map((c) => ({
      id: c.id,
      label: c.label,
      color: c.color,
      role: c.role,
    }))
    const data = JSON.stringify({
      targetDomain: session.targetDomain,
      harPath: session.harPath,
      contexts: meta,
    }, null, 2)
    Bun.write(session.contextMetaFile, data)
  } catch (err) {
    log.error("failed to persist context metadata", { error: err })
  }
}

function readNetworkLogsFromDisk(filePath: string): NetworkEntry[] {
  try {
    if (!existsSync(filePath)) return []
    const content = readFileSync(filePath, "utf-8")
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as NetworkEntry)
  } catch (err) {
    log.error("failed to read network logs from disk", { error: err })
    return []
  }
}

function readConsoleLogsFromDisk(filePath: string): ConsoleEntry[] {
  try {
    if (!existsSync(filePath)) return []
    const content = readFileSync(filePath, "utf-8")
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as ConsoleEntry)
  } catch (err) {
    log.error("failed to read console logs from disk", { error: err })
    return []
  }
}

function readContextMetaFromDisk(filePath: string): {
  targetDomain: string | null
  harPath: string
  contexts: Array<{ id: string; label: string; color: string; role: string }>
} | null {
  try {
    if (!existsSync(filePath)) return null
    return JSON.parse(readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

// ============================================================================
// Playwright Loader
// ============================================================================

const PLAYWRIGHT_MODULE = ["play", "wright"].join("")

async function isPlaywrightInstalled(): Promise<boolean> {
  try {
    await import(PLAYWRIGHT_MODULE)
    return true
  } catch {
    return false
  }
}

async function getPlaywright(): Promise<any> {
  const normalizeImport = (mod: any) => {
    if (mod.default?.firefox) return mod.default
    if (mod.firefox) return mod
    return mod.default || mod
  }

  if (await isPlaywrightInstalled()) {
    const pw = await import(PLAYWRIGHT_MODULE)
    return normalizeImport(pw)
  }

  throw new Error(
    "HackR Browser requires Playwright. Install it with:\n" +
      "  bun add playwright && bunx playwright install firefox",
  )
}

// ============================================================================
// document.cookie Override Script
// Injected per-container tab so each tab has its own cookie namespace.
// ============================================================================

function generateCookieOverrideScript(): string {
  return `
(function() {
  if (window.__hackr_cookie_override) return;
  window.__hackr_cookie_override = true;

  // Container-local cookie string, kept in sync by route interception
  window.__hackr_cookies = '';

  Object.defineProperty(document, 'cookie', {
    get() {
      return window.__hackr_cookies || '';
    },
    set(val) {
      if (!val || typeof val !== 'string') return;
      const eqIdx = val.indexOf('=');
      if (eqIdx === -1) return;

      const name = val.slice(0, eqIdx).trim();
      const nameValue = val.split(';')[0].trim();

      // Check for deletion
      const lower = val.toLowerCase();
      const isDelete = lower.includes('max-age=0') || lower.includes('max-age=-') ||
                       lower.includes('expires=thu, 01 jan 1970');

      const current = (window.__hackr_cookies || '').split('; ').filter(Boolean);
      const filtered = current.filter(function(p) { return !p.startsWith(name + '='); });

      if (!isDelete) {
        filtered.push(nameValue);
      }

      window.__hackr_cookies = filtered.join('; ');

      // Notify Playwright-side handler
      try {
        if (window.__hackr_onJSCookieSet) window.__hackr_onJSCookieSet(val);
      } catch(e) {}
    },
    configurable: true,
  });
})();
`
}

// ============================================================================
// Session Management
// ============================================================================

async function launchBrowser(
  sessionID: string,
  targetDomain: string | null,
): Promise<BrowserSession> {
  if (browserSessions.has(sessionID)) {
    return browserSessions.get(sessionID)!
  }

  const playwright = await getPlaywright()
  const analysisDir = path.join(getWorkDir(), ".cyberstrike", `analysis-${sessionID}`)
  const harPath = path.join(analysisDir, `hackr-${sessionID}.har`)
  const networkLogFile = path.join(analysisDir, "network.jsonl")
  const consoleLogFile = path.join(analysisDir, "console.jsonl")
  const contextMetaFile = path.join(analysisDir, "contexts.json")

  if (!existsSync(analysisDir)) {
    mkdirSync(analysisDir, { recursive: true })
  }

  log.info("launching HackR browser (Firefox)", { harPath, targetDomain, analysisDir })

  const browser = await playwright.firefox.launch({ headless: false })

  // SINGLE shared BrowserContext — all container tabs live in this one window
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  })

  const session: BrowserSession = {
    browser,
    context,
    containers: new Map(),
    activeContainerId: "unauth",
    targetDomain,
    harPath,
    analysisDir,
    networkLogFile,
    consoleLogFile,
    contextMetaFile,
  }

  // Create default "unauth" container (first tab)
  await createContainer(session, {
    id: "unauth",
    label: "Unauthenticated",
    color: "gray",
    role: "unauth",
  })

  // Show control page in the unauth tab
  const unauthContainer = session.containers.get("unauth")!
  await unauthContainer.page.setContent(
    generateControlPage([{ id: "unauth", label: "Unauthenticated", color: resolveColor("gray") }]),
    { waitUntil: "domcontentloaded" },
  )

  // Handle browser disconnect (manual close, crash, etc.)
  browser.on("disconnected", async () => {
    log.info("Browser disconnected — running analysis from disk", { sessionID })
    browserSessions.delete(sessionID)

    try {
      const networkLogs = readNetworkLogsFromDisk(networkLogFile)
      const consoleLogs = readConsoleLogsFromDisk(consoleLogFile)
      const meta = readContextMetaFromDisk(contextMetaFile)

      if (networkLogs.length > 0 && meta) {
        const summary = await BrowserAnalysis.analyze({
          contexts: meta.contexts,
          networkLogs,
          consoleLogs,
          targetDomain: meta.targetDomain,
          sessionId: sessionID,
        })

        const har = buildHarFromLogs(networkLogs)
        await Bun.write(harPath, JSON.stringify(har, null, 2))

        disconnectResults.set(sessionID, {
          summary,
          analysisDir,
          harPath,
          timestamp: Date.now(),
        })

        log.info("Analysis complete after disconnect — result stored for agent", {
          requests: networkLogs.length,
          harPath,
        })
      } else {
        disconnectResults.set(sessionID, {
          summary: "Browser was closed. No traffic was captured for analysis.",
          analysisDir,
          harPath,
          timestamp: Date.now(),
        })
      }
    } catch (err) {
      log.error("Failed to run analysis after disconnect", { error: err })
      disconnectResults.set(sessionID, {
        summary: `Browser was closed. Analysis failed: ${err instanceof Error ? err.message : String(err)}`,
        analysisDir,
        harPath,
        timestamp: Date.now(),
      })
    }
  })

  browserSessions.set(sessionID, session)
  return session
}

// Page → Container lookup (needed for route interception)
const pageContainerMap = new WeakMap<any, BrowserContainer>()

async function createContainer(
  session: BrowserSession,
  opts: { id: string; label: string; color: string; role: string },
): Promise<BrowserContainer> {
  if (session.containers.has(opts.id)) {
    return session.containers.get(opts.id)!
  }

  const hex = resolveColor(opts.color)

  // Create a new PAGE (tab) in the SHARED context — NOT a new context/window
  const page = await session.context.newPage()

  const container: BrowserContainer = {
    id: opts.id,
    label: opts.label,
    color: hex,
    role: opts.role,
    page,
    cookieJar: new ContainerCookieJar(),
    networkLogs: [],
    consoleLogs: [],
  }

  pageContainerMap.set(page, container)

  // --- Route interception: per-tab cookie isolation ---
  // This is the core mechanism. Each tab's HTTP requests get cookies from
  // its own ContainerCookieJar. Set-Cookie headers are captured and stripped
  // so the shared BrowserContext cookie store stays empty.
  await page.route("**/*", async (route: any) => {
    const request = route.request()
    const url = request.url()

    // Skip non-HTTP URLs
    if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:")) {
      await route.continue()
      return
    }

    try {
      // Inject this container's cookies
      const headers = { ...request.headers() }
      const cookieStr = container.cookieJar.formatForHeader(url)
      if (cookieStr) {
        headers["cookie"] = cookieStr
      } else {
        delete headers["cookie"]
      }

      const startTime = Date.now()
      const response = await route.fetch({ headers })
      const duration = Date.now() - startTime

      // Capture Set-Cookie into this container's jar
      const responseHeaders = response.headersArray()
      for (const { name, value } of responseHeaders) {
        if (name.toLowerCase() === "set-cookie") {
          container.cookieJar.set(parseSetCookie(value, url))
        }
      }

      // Log network entry
      const entry: NetworkEntry = {
        contextId: opts.id,
        timestamp: startTime,
        method: request.method(),
        url,
        requestHeaders: headers,
        requestBody: request.postData() || undefined,
        resourceType: request.resourceType(),
        status: response.status(),
        statusText: response.statusText(),
        responseHeaders: Object.fromEntries(
          responseHeaders
            .filter(({ name }: any) => name.toLowerCase() !== "set-cookie")
            .map(({ name, value }: any) => [name, value]),
        ),
        duration,
      }

      // Capture text response body for analysis
      const bodyBuffer = await response.body()
      const contentType = response.headers()["content-type"] || ""
      if (
        contentType.includes("text") ||
        contentType.includes("json") ||
        contentType.includes("javascript") ||
        contentType.includes("xml")
      ) {
        try {
          entry.responseBody = bodyBuffer.toString("utf-8").slice(0, 100000)
        } catch {}
      }

      container.networkLogs.push(entry)
      flushNetworkEntry(session, entry)

      // Strip Set-Cookie from response → browser's shared cookie store stays empty
      const filteredHeaders: Record<string, string> = {}
      for (const { name, value } of responseHeaders) {
        if (name.toLowerCase() !== "set-cookie") {
          filteredHeaders[name] = value
        }
      }

      await route.fulfill({
        status: response.status(),
        headers: filteredHeaders,
        body: bodyBuffer,
      })

      // Sync document.cookie cache for this tab
      try {
        const docCookies = container.cookieJar.getDocumentCookies(page.url())
        await page.evaluate((c: string) => {
          (window as any).__hackr_cookies = c
        }, docCookies).catch(() => {})
      } catch {}

    } catch {
      // If route.fetch fails, let the request through unmodified
      await route.continue().catch(() => {})
    }
  })

  // --- document.cookie override (per-tab) ---
  await page.addInitScript(generateCookieOverrideScript())

  // Listen for JS-set cookies
  await page.exposeFunction("__hackr_onJSCookieSet", (raw: string) => {
    try {
      const cookie = parseSetCookie(raw, page.url())
      cookie.httpOnly = false
      container.cookieJar.set(cookie)
    } catch {}
  }).catch(() => {})

  // --- Context banner injection (colored border + label) ---
  await page.addInitScript(generateContextInjection(opts.id, opts.label, hex))

  // --- Console capture ---
  page.on("console", (msg: any) => {
    const entry: ConsoleEntry = {
      contextId: opts.id,
      timestamp: Date.now(),
      type: msg.type(),
      text: msg.text(),
      location: msg.location()?.url,
    }
    container.consoleLogs.push(entry)
    flushConsoleEntry(session, entry)
  })

  page.on("pageerror", (error: any) => {
    const entry: ConsoleEntry = {
      contextId: opts.id,
      timestamp: Date.now(),
      type: "error",
      text: error.message,
    }
    container.consoleLogs.push(entry)
    flushConsoleEntry(session, entry)
  })

  // Persist metadata
  persistContextMeta(session)
  session.containers.set(opts.id, container)
  return container
}

// ============================================================================
// Helpers
// ============================================================================

function getSession(sessionID: string): BrowserSession | undefined {
  return browserSessions.get(sessionID)
}

function getActiveContainer(session: BrowserSession): BrowserContainer {
  const c = session.containers.get(session.activeContainerId)
  if (!c) throw new Error(`Active container "${session.activeContainerId}" not found`)
  return c
}

function getAllNetworkLogs(session: BrowserSession): NetworkEntry[] {
  const all: NetworkEntry[] = []
  for (const c of session.containers.values()) {
    all.push(...c.networkLogs)
  }
  return all.sort((a, b) => a.timestamp - b.timestamp)
}

function getAllConsoleLogs(session: BrowserSession): ConsoleEntry[] {
  const all: ConsoleEntry[] = []
  for (const c of session.containers.values()) {
    all.push(...c.consoleLogs)
  }
  return all.sort((a, b) => a.timestamp - b.timestamp)
}

function buildHarFromLogs(logs: NetworkEntry[]): any {
  return {
    log: {
      version: "1.2",
      creator: { name: "hackr-browser", version: "1.0" },
      entries: logs
        .filter((e) => e.status)
        .map((e) => ({
          _contextId: e.contextId,
          startedDateTime: new Date(e.timestamp).toISOString(),
          time: e.duration || 0,
          request: {
            method: e.method,
            url: e.url,
            headers: Object.entries(e.requestHeaders).map(([name, value]) => ({ name, value })),
            postData: e.requestBody
              ? { text: e.requestBody, mimeType: "application/x-www-form-urlencoded" }
              : undefined,
          },
          response: {
            status: e.status,
            statusText: e.statusText,
            headers: e.responseHeaders
              ? Object.entries(e.responseHeaders).map(([name, value]) => ({ name, value }))
              : [],
            content: {
              size: e.responseBody?.length || 0,
              mimeType: e.responseHeaders?.["content-type"] || "text/plain",
              text: e.responseBody,
            },
          },
        })),
    },
  }
}

async function closeBrowser(sessionID: string): Promise<{ harPath: string; summary: string } | undefined> {
  const session = browserSessions.get(sessionID)
  if (!session) return undefined

  const { harPath, networkLogFile, consoleLogFile, contextMetaFile } = session

  // Delete from map first — prevents disconnect handler from running duplicate analysis
  browserSessions.delete(sessionID)
  await session.context.close().catch(() => {})
  await session.browser.close().catch(() => {})

  // Read from disk (source of truth)
  const allLogs = readNetworkLogsFromDisk(networkLogFile)
  const allConsole = readConsoleLogsFromDisk(consoleLogFile)
  const meta = readContextMetaFromDisk(contextMetaFile)
  const contexts = meta?.contexts ?? Array.from(session.containers.values()).map((c) => ({
    id: c.id, label: c.label, color: c.color, role: c.role,
  }))

  let summary = "No traffic captured for analysis."
  if (allLogs.length > 0) {
    summary = await BrowserAnalysis.analyze({
      contexts,
      networkLogs: allLogs,
      consoleLogs: allConsole,
      targetDomain: session.targetDomain,
      sessionId: sessionID,
    })
  }

  const har = buildHarFromLogs(allLogs)
  await Bun.write(harPath, JSON.stringify(har, null, 2))

  return { harPath, summary }
}

// ============================================================================
// Tool Definition
// ============================================================================

const FilterSchema = z.object({
  urlPattern: z.string().optional(),
  method: z.string().optional(),
  statusCode: z.number().optional(),
  resourceType: z.string().optional(),
  contextId: z.string().optional(),
})

const BrowserParams = z.object({
  action: z
    .enum([
      "launch", "close",
      "create_context", "switch_context", "list_contexts",
      "navigate", "click", "fill", "wait",
      "screenshot", "execute", "content", "status",
      "network", "console", "har",
      "analyze", "replay", "cookie_jar", "compare",
      "aggregate",
    ])
    .describe("The browser action to perform"),
  url: z.string().optional().describe("URL for navigate action"),
  selector: z.string().optional().describe("CSS selector for click, fill, screenshot, wait"),
  value: z.string().optional().describe("Value for fill action"),
  script: z.string().optional().describe("JavaScript for execute action"),
  fullPage: z.boolean().optional().default(true).describe("Full page screenshot"),
  timeout: z.number().optional().default(30000).describe("Timeout in ms"),
  context_id: z.string().optional().describe("Context ID for create/switch/cookie_jar"),
  context_label: z.string().optional().describe("Human-readable label for create_context"),
  context_color: z.string().optional().describe("Color for create_context (red, green, blue, etc.)"),
  context_role: z.string().optional().describe("Role for create_context (admin, user, unauth, etc.)"),
  target_domain: z.string().optional().describe("Target domain for scope filtering on launch"),
  filter: FilterSchema.optional().describe("Filter for network logs"),
  context_a: z.string().optional().describe("First context ID for compare"),
  context_b: z.string().optional().describe("Second context ID for compare"),
  endpoint: z.string().optional().describe("Endpoint URL for compare/replay"),
  replay_method: z.string().optional().describe("HTTP method for replay (GET, POST, etc.)"),
})

type BrowserParamsType = z.infer<typeof BrowserParams>

interface BrowserResult {
  title: string
  output: string
  metadata: Record<string, any>
}

export const BrowserTool = Tool.define("browser", {
  description: DESCRIPTION,
  parameters: BrowserParams,
  async execute(params: BrowserParamsType, ctx): Promise<BrowserResult> {
    const sessionID = ctx.sessionID

    await ctx.ask({
      permission: "browser",
      patterns: params.url ? [params.url] : ["*"],
      always: ["*"],
      metadata: {
        action: params.action,
        url: params.url,
      },
    })

    // If browser was manually closed, return the analysis result
    if (params.action !== "launch") {
      const disconnectResult = disconnectResults.get(sessionID)
      if (disconnectResult && !browserSessions.has(sessionID)) {
        disconnectResults.delete(sessionID)
        return {
          title: "Browser was closed — analysis complete",
          output: [
            "The browser was closed (manually or disconnected). Analysis pipeline ran automatically from persisted traffic data.",
            "",
            `Analysis directory: ${disconnectResult.analysisDir}`,
            `HAR file: ${disconnectResult.harPath}`,
            "",
            disconnectResult.summary,
          ].join("\n"),
          metadata: {
            action: "disconnect_recovery",
            analysisDir: disconnectResult.analysisDir,
            harPath: disconnectResult.harPath,
          },
        }
      }
    }

    switch (params.action) {
      // --- Session Management ---

      case "launch": {
        disconnectResults.delete(sessionID)
        const session = await launchBrowser(sessionID, params.target_domain ?? null)
        return {
          title: "HackR Browser launched",
          output: [
            "HackR Browser launched (Firefox) — single window, multi-tab containers.",
            `Target domain: ${params.target_domain ?? "no filter (all traffic)"}`,
            `Default container: "unauth" (gray tab)`,
            `HAR path: ${session.harPath}`,
            "",
            "Each container is a tab with its own isolated cookie jar (like Firefox Multi-Account Containers).",
            "",
            "Next steps:",
            '- create_context to add roles (e.g., id="admin" role="admin" color="red")',
            "- switch_context to change active container tab",
            "- navigate to go to a URL",
          ].join("\n"),
          metadata: { action: "launch" },
        }
      }

      case "close": {
        const result = await closeBrowser(sessionID)
        if (!result) {
          return {
            title: "No browser to close",
            output: "No browser session found.",
            metadata: { action: "close" },
          }
        }
        return {
          title: "Browser closed + analysis complete",
          output: [
            `Browser closed. HAR saved: ${result.harPath}`,
            "",
            result.summary,
          ].join("\n"),
          metadata: { action: "close" },
        }
      }

      // --- Container Management ---

      case "create_context": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")

        const id = params.context_id
        if (!id) throw new Error("context_id is required for create_context")

        const container = await createContainer(session, {
          id,
          label: params.context_label ?? id,
          color: params.context_color ?? "blue",
          role: params.context_role ?? id,
        })

        return {
          title: `Container "${id}" created (new tab)`,
          output: `Created container tab "${id}" (${container.role}) with color ${container.color}.\nIsolated cookie jar active. Switch to it with: switch_context context_id="${id}"`,
          metadata: { action: "create_context", contextId: id },
        }
      }

      case "switch_context": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")

        const id = params.context_id
        if (!id) throw new Error("context_id is required for switch_context")
        if (!session.containers.has(id)) {
          const available = Array.from(session.containers.keys()).join(", ")
          throw new Error(`Container "${id}" not found. Available: ${available}`)
        }

        session.activeContainerId = id
        const container = session.containers.get(id)!
        await container.page.bringToFront()

        return {
          title: `Switched to "${id}"`,
          output: `Active container: "${id}" (${container.role}, ${container.color})\nURL: ${container.page.url()}`,
          metadata: { action: "switch_context", contextId: id },
        }
      }

      case "list_contexts": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")

        const list = Array.from(session.containers.values()).map((c) => {
          const active = c.id === session.activeContainerId ? " [ACTIVE]" : ""
          const cookieCount = c.cookieJar.getAll().length
          return `- ${c.id}${active}: ${c.label} (${c.role}) — ${c.networkLogs.length} requests, ${cookieCount} cookies`
        })

        return {
          title: `${session.containers.size} containers`,
          output: `Container tabs (single window, isolated cookie jars):\n${list.join("\n")}`,
          metadata: { action: "list_contexts" },
        }
      }

      // --- Navigation & Interaction ---

      case "navigate": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")
        if (!params.url) throw new Error("URL is required for navigate action")

        const container = getActiveContainer(session)
        await container.page.goto(params.url, {
          waitUntil: "networkidle",
          timeout: params.timeout,
        })

        const title = await container.page.title()
        const url = container.page.url()

        return {
          title: `Navigated to ${url}`,
          output: `[${container.id}] Page loaded: ${title}\nURL: ${url}\nRequests: ${container.networkLogs.length}`,
          metadata: { action: "navigate", contextId: container.id },
        }
      }

      case "click": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")
        if (!params.selector) throw new Error("Selector is required for click action")

        const container = getActiveContainer(session)
        await container.page.click(params.selector, { timeout: params.timeout })

        return {
          title: `Clicked ${params.selector}`,
          output: `[${container.id}] Clicked: ${params.selector}`,
          metadata: { action: "click", contextId: container.id },
        }
      }

      case "fill": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")
        if (!params.selector || params.value === undefined) {
          throw new Error("Selector and value are required for fill action")
        }

        const container = getActiveContainer(session)
        await container.page.fill(params.selector, params.value, { timeout: params.timeout })

        return {
          title: `Filled ${params.selector}`,
          output: `[${container.id}] Filled: ${params.selector}`,
          metadata: { action: "fill", contextId: container.id },
        }
      }

      case "wait": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")

        const container = getActiveContainer(session)
        if (params.selector) {
          await container.page.waitForSelector(params.selector, { timeout: params.timeout })
          return {
            title: `Waited for ${params.selector}`,
            output: `[${container.id}] Element appeared: ${params.selector}`,
            metadata: { action: "wait", contextId: container.id },
          }
        }
        await container.page.waitForLoadState("networkidle", { timeout: params.timeout })
        return {
          title: "Waited for network idle",
          output: `[${container.id}] Network idle reached`,
          metadata: { action: "wait", contextId: container.id },
        }
      }

      // --- Inspection ---

      case "screenshot": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")

        const container = getActiveContainer(session)
        const filename = `screenshot-${container.id}-${Date.now()}.png`
        const filepath = path.join(getProjectDir(), filename)

        if (params.selector) {
          const element = await container.page.$(params.selector)
          if (!element) throw new Error(`Element not found: ${params.selector}`)
          await element.screenshot({ path: filepath })
        } else {
          await container.page.screenshot({ path: filepath, fullPage: params.fullPage })
        }

        return {
          title: "Screenshot captured",
          output: `[${container.id}] Screenshot saved: ${filepath}`,
          metadata: { action: "screenshot", contextId: container.id },
        }
      }

      case "execute": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")
        if (!params.script) throw new Error("Script is required for execute action")

        const container = getActiveContainer(session)
        const result = await container.page.evaluate(params.script)
        const output = typeof result === "object" ? JSON.stringify(result, null, 2) : String(result)

        return {
          title: "JavaScript executed",
          output: `[${container.id}] ${output || "(no return value)"}`,
          metadata: { action: "execute", contextId: container.id },
        }
      }

      case "content": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")

        const container = getActiveContainer(session)
        const url = container.page.url()
        const title = await container.page.title()

        const textContent = await container.page.evaluate(() => {
          const clone = document.body.cloneNode(true) as HTMLElement
          clone.querySelectorAll("script, style, noscript").forEach((el: Element) => el.remove())
          return clone.innerText.trim().slice(0, 5000)
        })

        const links = await container.page.evaluate(() => {
          return Array.from(document.querySelectorAll("a[href]"))
            .slice(0, 20)
            .map((a: Element) => ({
              text: (a as HTMLAnchorElement).innerText.trim().slice(0, 50),
              href: (a as HTMLAnchorElement).href,
            }))
            .filter((l: { text: string; href: string }) => l.text && l.href)
        })

        const forms = await container.page.evaluate(() => {
          return Array.from(document.querySelectorAll("form")).map((form: HTMLFormElement) => ({
            action: form.action,
            method: form.method || "GET",
            inputs: Array.from(form.querySelectorAll("input, textarea, select")).map((input: Element) => ({
              type: (input as HTMLInputElement).type || "text",
              name: (input as HTMLInputElement).name,
              id: input.id,
            })),
          }))
        })

        return {
          title: `Content: ${title}`,
          output: JSON.stringify({ context: container.id, url, title, textContent, links, forms }, null, 2),
          metadata: { action: "content", contextId: container.id },
        }
      }

      case "status": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")

        const container = getActiveContainer(session)
        const url = container.page.url()
        const title = await container.page.title()

        const recentRequests = container.networkLogs.slice(-10).map((e) => ({
          method: e.method,
          url: e.url.length > 80 ? e.url.slice(0, 80) + "..." : e.url,
          status: e.status || "pending",
        }))

        const recentConsole = container.consoleLogs.slice(-5).map((e) => ({
          type: e.type,
          text: e.text.length > 100 ? e.text.slice(0, 100) + "..." : e.text,
        }))

        return {
          title: `[${container.id}] ${title}`,
          output: JSON.stringify({
            container: container.id,
            role: container.role,
            cookies: container.cookieJar.getAll().length,
            url,
            title,
            totalRequests: container.networkLogs.length,
            recentRequests,
            totalConsoleLogs: container.consoleLogs.length,
            recentConsole,
          }, null, 2),
          metadata: { action: "status", contextId: container.id },
        }
      }

      // --- Traffic Analysis ---

      case "network": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")

        let logs = params.filter?.contextId
          ? session.containers.get(params.filter.contextId)?.networkLogs ?? []
          : getAllNetworkLogs(session)

        if (params.filter) {
          const { urlPattern, method, statusCode, resourceType } = params.filter
          logs = logs.filter((entry) => {
            if (urlPattern && !entry.url.includes(urlPattern)) return false
            if (method && entry.method !== method.toUpperCase()) return false
            if (statusCode && entry.status !== statusCode) return false
            if (resourceType && entry.resourceType !== resourceType) return false
            return true
          })
        }

        const summary = logs.slice(-50).map((e) => ({
          container: e.contextId,
          method: e.method,
          url: e.url,
          status: e.status,
          type: e.resourceType,
          duration: e.duration ? `${e.duration}ms` : "pending",
        }))

        return {
          title: `Network traffic (${logs.length} requests)`,
          output: JSON.stringify(summary, null, 2),
          metadata: { action: "network" },
        }
      }

      case "console": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")

        const logs = getAllConsoleLogs(session).slice(-30).map((e) => ({
          container: e.contextId,
          time: new Date(e.timestamp).toISOString(),
          type: e.type,
          text: e.text,
          location: e.location,
        }))

        return {
          title: `Console logs (${logs.length} entries)`,
          output: JSON.stringify(logs, null, 2),
          metadata: { action: "console" },
        }
      }

      case "har": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")

        const allLogs = params.filter?.contextId
          ? session.containers.get(params.filter.contextId)?.networkLogs ?? []
          : getAllNetworkLogs(session)

        const har = buildHarFromLogs(allLogs)
        const filename = `hackr-traffic-${Date.now()}.har`
        const filepath = path.join(getProjectDir(), filename)
        await Bun.write(filepath, JSON.stringify(har, null, 2))

        return {
          title: "HAR file exported",
          output: `HAR saved: ${filepath}\nEntries: ${har.log.entries.length}`,
          metadata: { action: "har" },
        }
      }

      // --- Security Analysis ---

      case "analyze": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")

        const allLogs = getAllNetworkLogs(session)
        const allConsole = getAllConsoleLogs(session)
        const contexts = Array.from(session.containers.values()).map((c) => ({
          id: c.id, label: c.label, color: c.color, role: c.role,
        }))

        if (allLogs.length === 0) {
          return {
            title: "No traffic to analyze",
            output: "No network traffic captured yet. Navigate to some pages first.",
            metadata: { action: "analyze" },
          }
        }

        const summary = await BrowserAnalysis.analyze({
          contexts,
          networkLogs: allLogs,
          consoleLogs: allConsole,
          targetDomain: session.targetDomain,
          sessionId: sessionID,
        })

        return {
          title: "Analysis complete",
          output: summary,
          metadata: { action: "analyze" },
        }
      }

      case "replay": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")

        if (!params.endpoint) throw new Error("endpoint is required for replay")
        if (!params.context_id) throw new Error("context_id (target container to replay with) is required")

        const targetContainer = session.containers.get(params.context_id)
        if (!targetContainer) throw new Error(`Container "${params.context_id}" not found`)

        const method = (params.replay_method ?? "GET").toUpperCase()

        const allLogs = getAllNetworkLogs(session)
        const original = allLogs.find(
          (e) => e.url.includes(params.endpoint!) && e.method === method && e.contextId !== params.context_id,
        )

        if (!original) {
          return {
            title: "No matching request found",
            output: `No ${method} request to "${params.endpoint}" found in other containers.`,
            metadata: { action: "replay" },
          }
        }

        // Replay via the target container's page — route interception will
        // automatically inject that container's cookies
        const replayResult = await targetContainer.page.evaluate(
          async ([url, method, body, headers]: [string, string, string | null, Record<string, string>]) => {
            const resp = await fetch(url, {
              method,
              headers: { ...headers, "X-HackR-Replay": "true" },
              body: method !== "GET" && method !== "HEAD" ? body : undefined,
              credentials: "include",
            })
            const text = await resp.text().catch(() => "")
            return {
              status: resp.status,
              statusText: resp.statusText,
              headers: Object.fromEntries(resp.headers.entries()),
              body: text.slice(0, 2000),
            }
          },
          [original.url, method, original.requestBody ?? null, {}] as const,
        )

        return {
          title: `Replay: ${method} ${params.endpoint}`,
          output: [
            `Original: ${original.contextId} -> ${original.status}`,
            `Replay (${params.context_id}): ${replayResult.status} ${replayResult.statusText}`,
            "",
            `Response body (first 2000 chars):`,
            replayResult.body,
          ].join("\n"),
          metadata: {
            action: "replay",
            originalContext: original.contextId,
            replayContext: params.context_id,
            originalStatus: original.status,
            replayStatus: replayResult.status,
          },
        }
      }

      case "cookie_jar": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")

        const ctxId = params.context_id ?? session.activeContainerId
        const container = session.containers.get(ctxId)
        if (!container) throw new Error(`Container "${ctxId}" not found`)

        const formatted = container.cookieJar.getAllFormatted()

        return {
          title: `Cookies for "${ctxId}" (${formatted.length})`,
          output: JSON.stringify(formatted, null, 2),
          metadata: { action: "cookie_jar", contextId: ctxId },
        }
      }

      case "compare": {
        const session = getSession(sessionID)
        if (!session) throw new Error("Browser not launched. Use launch action first.")

        if (!params.context_a || !params.context_b) {
          throw new Error("context_a and context_b are required for compare")
        }
        if (!params.endpoint) throw new Error("endpoint is required for compare")

        const cA = session.containers.get(params.context_a)
        const cB = session.containers.get(params.context_b)
        if (!cA) throw new Error(`Container "${params.context_a}" not found`)
        if (!cB) throw new Error(`Container "${params.context_b}" not found`)

        const entryA = cA.networkLogs.find((e) => e.url.includes(params.endpoint!) && e.status)
        const entryB = cB.networkLogs.find((e) => e.url.includes(params.endpoint!) && e.status)

        const comparison: any = {
          endpoint: params.endpoint,
          containerA: {
            id: params.context_a,
            role: cA.role,
            status: entryA?.status ?? "no request",
            responseSize: entryA?.responseBody?.length ?? 0,
          },
          containerB: {
            id: params.context_b,
            role: cB.role,
            status: entryB?.status ?? "no request",
            responseSize: entryB?.responseBody?.length ?? 0,
          },
          statusMatch: entryA?.status === entryB?.status,
          bodyMatch: entryA?.responseBody === entryB?.responseBody,
        }

        if (entryA?.responseBody && entryB?.responseBody && entryA.responseBody !== entryB.responseBody) {
          comparison.bodyDiffSummary = `Container A: ${entryA.responseBody.length} chars, Container B: ${entryB.responseBody.length} chars (different content)`
        }

        return {
          title: `Compare: ${params.context_a} vs ${params.context_b}`,
          output: JSON.stringify(comparison, null, 2),
          metadata: { action: "compare" },
        }
      }

      case "aggregate": {
        const summary = await BrowserAnalysis.aggregate()
        return {
          title: "Cross-session aggregate analysis",
          output: summary,
          metadata: { action: "aggregate" },
        }
      }

      default:
        throw new Error(`Unknown action: ${params.action}`)
    }
  },
})

import { Log } from "../util/log"
import { Instance } from "../project/instance"
import path from "path"
import fs from "fs/promises"
import { existsSync, readFileSync, readdirSync } from "fs"

const log = Log.create({ service: "tool.browser-analysis" })

// Work directory override (for MCP server context)
let _workDirOverride: string | undefined

/** Set explicit work directory — used by MCP browser server to avoid Instance dependency */
export function setAnalysisWorkDir(dir: string) {
  _workDirOverride = dir
}

function getWorkDir(): string {
  return _workDirOverride ?? Instance.worktree
}

// Types shared with browser.ts
export interface NetworkEntry {
  contextId: string
  method: string
  url: string
  status?: number
  statusText?: string
  requestHeaders: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBody?: string
  responseBody?: string
  resourceType: string
  duration?: number
  timestamp: number
}

export interface ConsoleEntry {
  contextId: string
  timestamp: number
  type: string
  text: string
  location?: string
}

export interface BrowserContextInfo {
  id: string
  label: string
  color: string
  role: string
}

export interface AnalysisInput {
  contexts: BrowserContextInfo[]
  networkLogs: NetworkEntry[]
  consoleLogs: ConsoleEntry[]
  targetDomain: string | null
  sessionId: string
}

// Analysis result types
interface EndpointInfo {
  url: string
  methods: Set<string>
  contexts: Set<string>
  statusCodes: Map<string, number> // contextId -> status
  hasBody: boolean
}

interface AccessControlEntry {
  endpoint: string
  method: string
  results: Record<string, number | "N/A"> // contextId -> status code
  potentialIssue: boolean
}

interface IDORCandidate {
  endpoint: string
  method: string
  originalContext: string
  originalStatus: number
  replayContext: string
  replayStatus: string
  severity: "high" | "medium" | "low"
  reason: string
}

interface JSFinding {
  url: string
  type: "endpoint" | "secret" | "sensitive" | "api_route" | "admin_path" | "config" | "internal"
  value: string
  context: string
  depth: number          // 0 = found in network log, 1 = found inside a JS from depth 0, etc.
  discoveryChain: string[] // [main.js → chunk-abc.js → /api/admin/users]
  category?: string      // endpoint classification
}

interface CookieInfo {
  contextId: string
  name: string
  value: string
  domain: string
  path: string
  httpOnly: boolean
  secure: boolean
  sameSite: string
  expires?: string
}

interface SessionDiffResult {
  endpoint: string
  method: string
  contextA: string
  contextB: string
  statusDiff: boolean
  bodyDiff: boolean
  headerDiff: string[]
  significance: "high" | "medium" | "low"
}

export namespace BrowserAnalysis {
  /**
   * Run the full analysis pipeline
   * Returns a summary for LLM context and writes full report to disk
   */
  export async function analyze(input: AnalysisInput): Promise<string> {
    log.info("starting analysis pipeline", {
      contexts: input.contexts.length,
      networkLogs: input.networkLogs.length,
    })

    const analysisDir = path.join(
      getWorkDir(),
      ".cyberstrike",
      `analysis-${input.sessionId}`,
    )
    await fs.mkdir(analysisDir, { recursive: true })

    // Filter to scope
    const scopedLogs = input.targetDomain
      ? input.networkLogs.filter((e) => {
          try {
            const url = new URL(e.url)
            return url.hostname.includes(input.targetDomain!)
          } catch {
            return false
          }
        })
      : input.networkLogs.filter((e) => !isStaticAsset(e.url))

    // Run pipeline steps
    const endpoints = extractEndpoints(scopedLogs)
    const accessMatrix = buildAccessControlMatrix(endpoints, input.contexts)
    const idorCandidates = detectIDOR(scopedLogs, input.contexts)
    const jsFindings = analyzeJSSources(scopedLogs)
    const cookieJars = trackCookieJars(scopedLogs, input.contexts)
    const sessionDiffs = diffSessions(scopedLogs, input.contexts)

    // Build full report
    const report = buildFullReport({
      endpoints,
      accessMatrix,
      idorCandidates,
      jsFindings,
      cookieJars,
      sessionDiffs,
      input,
      scopedLogs,
    })

    // Write full report to disk
    const reportPath = path.join(analysisDir, "analysis-report.md")
    await fs.writeFile(reportPath, report, "utf-8")
    log.info("analysis report written", { path: reportPath })

    // Write raw data
    const dataPath = path.join(analysisDir, "network-logs.json")
    await fs.writeFile(dataPath, JSON.stringify(scopedLogs, null, 2), "utf-8")

    // Build summary for LLM context (~500-1000 tokens)
    const summary = buildSummary({
      endpoints,
      accessMatrix,
      idorCandidates,
      jsFindings,
      cookieJars,
      sessionDiffs,
      reportPath,
      scopedLogs,
    })

    return summary
  }

  // --- Step 1: Endpoint Extraction ---

  function extractEndpoints(logs: NetworkEntry[]): Map<string, EndpointInfo> {
    const endpoints = new Map<string, EndpointInfo>()

    for (const entry of logs) {
      if (isStaticAsset(entry.url)) continue

      const normalized = normalizeUrl(entry.url)
      const existing = endpoints.get(normalized)

      if (existing) {
        existing.methods.add(entry.method)
        existing.contexts.add(entry.contextId)
        if (entry.status) {
          existing.statusCodes.set(entry.contextId, entry.status)
        }
        if (entry.responseBody) existing.hasBody = true
      } else {
        const info: EndpointInfo = {
          url: normalized,
          methods: new Set([entry.method]),
          contexts: new Set([entry.contextId]),
          statusCodes: new Map(),
          hasBody: !!entry.responseBody,
        }
        if (entry.status) {
          info.statusCodes.set(entry.contextId, entry.status)
        }
        endpoints.set(normalized, info)
      }
    }

    return endpoints
  }

  // --- Step 2: Access Control Matrix ---

  function buildAccessControlMatrix(
    endpoints: Map<string, EndpointInfo>,
    contexts: BrowserContextInfo[],
  ): AccessControlEntry[] {
    const matrix: AccessControlEntry[] = []

    for (const [url, info] of endpoints) {
      for (const method of info.methods) {
        const results: Record<string, number | "N/A"> = {}
        let hasVariation = false
        const statusValues: number[] = []

        for (const ctx of contexts) {
          const status = info.statusCodes.get(ctx.id)
          results[ctx.id] = status ?? "N/A"
          if (status) statusValues.push(status)
        }

        // Check if different contexts get different status codes
        const uniqueStatuses = new Set(statusValues)
        if (uniqueStatuses.size > 1) {
          hasVariation = true
        }

        // Flag if auth context gets 200 and unauth gets something else
        const unauthStatus = results["unauth"]
        const authStatuses = Object.entries(results)
          .filter(([id]) => id !== "unauth")
          .map(([, s]) => s)
        if (
          typeof unauthStatus === "number" &&
          unauthStatus >= 200 &&
          unauthStatus < 300 &&
          authStatuses.some((s) => typeof s === "number" && s >= 200 && s < 300)
        ) {
          hasVariation = true
        }

        matrix.push({
          endpoint: url,
          method,
          results,
          potentialIssue: hasVariation,
        })
      }
    }

    return matrix
  }

  // --- Step 3: IDOR Detection ---

  function detectIDOR(
    logs: NetworkEntry[],
    contexts: BrowserContextInfo[],
  ): IDORCandidate[] {
    const candidates: IDORCandidate[] = []

    // Group requests by URL + method
    const grouped = new Map<string, NetworkEntry[]>()
    for (const entry of logs) {
      if (!entry.status) continue
      const key = `${entry.method}:${normalizeUrl(entry.url)}`
      const existing = grouped.get(key) ?? []
      existing.push(entry)
      grouped.set(key, existing)
    }

    // Look for endpoints accessed by multiple contexts
    for (const [key, entries] of grouped) {
      const byContext = new Map<string, NetworkEntry>()
      for (const entry of entries) {
        // Keep the latest entry per context
        byContext.set(entry.contextId, entry)
      }

      if (byContext.size < 2) continue

      const contextEntries = Array.from(byContext.entries())
      for (let i = 0; i < contextEntries.length; i++) {
        for (let j = i + 1; j < contextEntries.length; j++) {
          const [ctxA, entryA] = contextEntries[i]
          const [ctxB, entryB] = contextEntries[j]

          // Both got 2xx - potential IDOR if they shouldn't see same data
          if (
            entryA.status! >= 200 && entryA.status! < 300 &&
            entryB.status! >= 200 && entryB.status! < 300
          ) {
            const contextA = contexts.find((c) => c.id === ctxA)
            const contextB = contexts.find((c) => c.id === ctxB)

            // Skip if same role
            if (contextA?.role === contextB?.role) continue

            // Check if URL contains ID-like patterns
            const hasIdPattern = /\/\d+|\/[a-f0-9-]{8,}|[?&]id=/i.test(entryA.url)

            if (hasIdPattern) {
              candidates.push({
                endpoint: normalizeUrl(entryA.url),
                method: entryA.method,
                originalContext: ctxA,
                originalStatus: entryA.status!,
                replayContext: ctxB,
                replayStatus: `${entryB.status}`,
                severity: contextA?.role === "admin" || contextB?.role === "admin" ? "high" : "medium",
                reason: `Both ${ctxA} (${contextA?.role}) and ${ctxB} (${contextB?.role}) can access resource with ID pattern`,
              })
            }
          }

          // One got 2xx, unauth got 2xx too - broken access control
          if (
            ctxB === "unauth" &&
            entryA.status! >= 200 && entryA.status! < 300 &&
            entryB.status! >= 200 && entryB.status! < 300
          ) {
            candidates.push({
              endpoint: normalizeUrl(entryA.url),
              method: entryA.method,
              originalContext: ctxA,
              originalStatus: entryA.status!,
              replayContext: ctxB,
              replayStatus: `${entryB.status}`,
              severity: "high",
              reason: "Unauthenticated user can access authenticated endpoint",
            })
          }
        }
      }
    }

    return candidates
  }

  // --- Step 4: JS Source Analysis (Recursive Depth) ---
  //
  // How it works:
  // 1. Collect all JS response bodies from captured network traffic
  // 2. Build a URL→body index for instant lookup
  // 3. For each JS file, extract endpoints + secrets (depth 0)
  // 4. For discovered endpoints that match a captured JS file → recurse (depth 1, 2, ...)
  // 5. Track discovery chain: [main.js → vendor.js → /api/admin/users]
  // 6. Classify endpoints: api_route, admin_path, config, internal, etc.
  //
  // Also analyzes non-JS text responses (HTML, JSON) for embedded endpoints/secrets.

  const MAX_JS_DEPTH = 5
  const MAX_FINDINGS = 2000

  // Endpoint classification rules
  function classifyEndpoint(value: string): JSFinding["type"] {
    const lower = value.toLowerCase()
    if (/\/admin|\/dashboard|\/manage|\/internal|\/staff|\/superuser/i.test(lower)) return "admin_path"
    if (/\/api\/|\/v[0-9]+\/|\/graphql|\/rest\/|\/rpc\//i.test(lower)) return "api_route"
    if (/config|\.env|settings|\.json$|\.yaml$|\.yml$|\.xml$/i.test(lower)) return "config"
    if (/\/debug|\/test|\/dev\/|localhost|127\.0\.0\.1|internal/i.test(lower)) return "internal"
    return "endpoint"
  }

  // Extended endpoint patterns (more comprehensive than basic LinkFinder)
  const ENDPOINT_PATTERNS = [
    // Full URLs: http(s)://... or protocol-relative //...
    /(?:"|'|`)\s*(((?:[a-zA-Z]{1,10}:\/\/|\/\/)[^"'`\s]{3,}))\s*(?:"|'|`)/g,
    // Absolute paths: /api/v1/users, /admin/dashboard
    /(?:"|'|`)\s*(\/[a-zA-Z0-9_?&=\/\-#.%]{2,})\s*(?:"|'|`)/g,
    // API-style relative: api/v1/..., v2/users/...
    /(?:"|'|`)\s*((?:api|v[0-9])[a-zA-Z0-9_?&=\/\-.#%]{3,})\s*(?:"|'|`)/g,
    // Template literal paths: `/users/${id}/profile`
    /`(\/[a-zA-Z0-9_\/\-.]+\$\{[^}]+\}[^`]*)`/g,
    // fetch/axios/XMLHttpRequest URL args
    /(?:fetch|axios|\.get|\.post|\.put|\.delete|\.patch|\.request|\.open)\s*\(\s*(?:"|'|`)([^"'`\s)]{3,})/g,
    // URL assignments: url = "...", href = "...", src = "...", action = "..."
    /(?:url|href|src|action|endpoint|baseUrl|apiUrl|host)\s*[:=]\s*(?:"|'|`)([^"'`\s]{3,})/gi,
    // Object property patterns: { path: "/api/...", route: "/admin/..." }
    /(?:path|route|uri|link)\s*:\s*(?:"|'|`)([^"'`\s]{3,})/gi,
    // Webpack/module import paths
    /(?:import|require)\s*\(\s*(?:"|'|`)([^"'`]+\.js[^"'`]*)/g,
    // Source map references
    /\/\/[#@]\s*sourceMappingURL=([^\s]+)/g,
  ]

  // Extended secret patterns
  const SECRET_PATTERNS: Array<{ pattern: RegExp; type: JSFinding["type"] }> = [
    // API keys
    { pattern: /(?:api[_-]?key|apikey|api_token)\s*[:=]\s*["'`]([^"'`]{8,})["'`]/gi, type: "secret" },
    // Generic secrets
    { pattern: /(?:secret|secret_key|client_secret)\s*[:=]\s*["'`]([^"'`]{8,})["'`]/gi, type: "secret" },
    // Tokens
    { pattern: /(?:token|access_token|refresh_token|auth_token)\s*[:=]\s*["'`]([^"'`]{16,})["'`]/gi, type: "secret" },
    // Passwords
    { pattern: /(?:password|passwd|pwd|pass)\s*[:=]\s*["'`]([^"'`]{4,})["'`]/gi, type: "secret" },
    // AWS
    { pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/g, type: "secret" },
    { pattern: /(?:aws_access_key_id|aws_secret_access_key)\s*[:=]\s*["'`]([^"'`]+)["'`]/gi, type: "secret" },
    // JWT tokens
    { pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, type: "sensitive" },
    // Bearer/Authorization
    { pattern: /(?:Bearer|Authorization)\s+([a-zA-Z0-9\-._~+/]{20,}=*)/g, type: "sensitive" },
    // Private keys
    { pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g, type: "secret" },
    // Google API keys
    { pattern: /AIza[0-9A-Za-z_-]{35}/g, type: "secret" },
    // Firebase
    { pattern: /(?:firebase[_-]?(?:api[_-]?key|token|secret|url))\s*[:=]\s*["'`]([^"'`]{8,})["'`]/gi, type: "secret" },
    // Slack
    { pattern: /xox[bpors]-[a-zA-Z0-9-]{10,}/g, type: "secret" },
    // GitHub
    { pattern: /gh[ps]_[a-zA-Z0-9]{36}/g, type: "secret" },
    // Stripe
    { pattern: /(?:sk|pk)_(?:test|live)_[a-zA-Z0-9]{20,}/g, type: "secret" },
    // Database URLs
    { pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s"'`]{10,}/gi, type: "secret" },
    // Internal IPs / hostnames
    { pattern: /(?:["'`])((?:10|172\.(?:1[6-9]|2[0-9]|3[01])|192\.168)\.\d+\.\d+(?::\d+)?(?:\/[^\s"'`]*)?)(?:["'`])/g, type: "internal" },
  ]

  function analyzeJSSources(logs: NetworkEntry[]): JSFinding[] {
    const findings: JSFinding[] = []
    const seenValues = new Set<string>()
    const seenSecretKeys = new Set<string>()

    // Build URL → body index from ALL captured responses
    const bodyIndex = new Map<string, { body: string; sourceUrl: string }>()
    for (const entry of logs) {
      if (!entry.responseBody) continue
      // Index by normalized URL
      try {
        const normalized = new URL(entry.url).pathname
        bodyIndex.set(normalized, { body: entry.responseBody, sourceUrl: entry.url })
      } catch {}
      bodyIndex.set(entry.url, { body: entry.responseBody, sourceUrl: entry.url })
    }

    // Identify JS entries (and also HTML/JSON that may embed scripts)
    const jsEntries = logs.filter(
      (e) =>
        e.responseBody &&
        (e.resourceType === "script" ||
          e.url.endsWith(".js") ||
          e.url.includes(".js?") ||
          e.url.endsWith(".mjs") ||
          e.responseHeaders?.["content-type"]?.includes("javascript")),
    )

    // Also scan HTML responses for inline scripts and embedded endpoints
    const htmlEntries = logs.filter(
      (e) =>
        e.responseBody &&
        (e.resourceType === "document" ||
          e.responseHeaders?.["content-type"]?.includes("html")),
    )

    // Also scan JSON responses (API responses can leak endpoints/config)
    const jsonEntries = logs.filter(
      (e) =>
        e.responseBody &&
        (e.responseHeaders?.["content-type"]?.includes("json")),
    )

    // Queue for recursive processing: [body, sourceUrl, depth, chain]
    const queue: Array<{ body: string; sourceUrl: string; depth: number; chain: string[] }> = []
    const processedUrls = new Set<string>()

    // Seed queue with JS files (depth 0)
    for (const entry of jsEntries) {
      if (!entry.responseBody || processedUrls.has(entry.url)) continue
      processedUrls.add(entry.url)
      queue.push({
        body: entry.responseBody,
        sourceUrl: entry.url,
        depth: 0,
        chain: [path.basename(entry.url).split("?")[0]],
      })
    }

    // Process HTML inline scripts (depth 0)
    for (const entry of htmlEntries) {
      if (!entry.responseBody || processedUrls.has(entry.url + ":html")) continue
      processedUrls.add(entry.url + ":html")
      // Extract inline <script> contents
      const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi
      let scriptMatch: RegExpExecArray | null
      while ((scriptMatch = scriptRegex.exec(entry.responseBody)) !== null) {
        const scriptBody = scriptMatch[1].trim()
        if (scriptBody.length > 50) { // Skip trivial inline scripts
          queue.push({
            body: scriptBody,
            sourceUrl: entry.url,
            depth: 0,
            chain: [path.basename(entry.url).split("?")[0] + ":inline"],
          })
        }
      }
    }

    // Process JSON responses (depth 0)
    for (const entry of jsonEntries) {
      if (!entry.responseBody || processedUrls.has(entry.url + ":json")) continue
      processedUrls.add(entry.url + ":json")
      queue.push({
        body: entry.responseBody,
        sourceUrl: entry.url,
        depth: 0,
        chain: [path.basename(entry.url).split("?")[0]],
      })
    }

    // Recursive BFS processing
    while (queue.length > 0 && findings.length < MAX_FINDINGS) {
      const item = queue.shift()!
      const { body, sourceUrl, depth, chain } = item

      // Extract endpoints
      for (const pattern of ENDPOINT_PATTERNS) {
        // Reset regex state
        pattern.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = pattern.exec(body)) !== null) {
          const value = (match[1] || match[0]).trim()
          if (seenValues.has(value)) continue
          if (value.length < 3 || value.length > 500) continue

          // Skip static assets
          if (/\.(png|jpg|jpeg|gif|svg|css|woff|woff2|ttf|eot|ico|map|webp|avif)(\?|$)/i.test(value)) continue
          // Skip data/blob URLs
          if (/^(data:|blob:|about:|javascript:)/i.test(value)) continue
          // Skip obvious non-paths
          if (/^[0-9.]+$/.test(value)) continue

          seenValues.add(value)

          const type = classifyEndpoint(value)
          findings.push({
            url: sourceUrl,
            type,
            value,
            context: getLineContext(body, match.index),
            depth,
            discoveryChain: [...chain, value],
            category: type,
          })

          // Recursive: if this looks like a JS file path and we have its body → process it
          if (depth < MAX_JS_DEPTH && /\.js(?:\?|$|#)/i.test(value)) {
            // Try to find this JS file in our body index
            let jsBody: string | null = null
            let resolvedUrl = value

            // Try direct lookup
            const direct = bodyIndex.get(value)
            if (direct) {
              jsBody = direct.body
              resolvedUrl = direct.sourceUrl
            }

            // Try pathname lookup
            if (!jsBody) {
              try {
                const pathname = new URL(value, sourceUrl).pathname
                const byPath = bodyIndex.get(pathname)
                if (byPath) {
                  jsBody = byPath.body
                  resolvedUrl = byPath.sourceUrl
                }
              } catch {}
            }

            // Try partial match (filename)
            if (!jsBody) {
              const filename = path.basename(value.split("?")[0])
              for (const [key, val] of bodyIndex) {
                if (key.endsWith("/" + filename) || key.endsWith(filename)) {
                  jsBody = val.body
                  resolvedUrl = val.sourceUrl
                  break
                }
              }
            }

            if (jsBody && !processedUrls.has(resolvedUrl)) {
              processedUrls.add(resolvedUrl)
              queue.push({
                body: jsBody,
                sourceUrl: resolvedUrl,
                depth: depth + 1,
                chain: [...chain, path.basename(resolvedUrl).split("?")[0]],
              })
            }
          }
        }
      }

      // Extract secrets (no recursion needed, just scan)
      for (const { pattern, type } of SECRET_PATTERNS) {
        pattern.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = pattern.exec(body)) !== null) {
          const value = match[1] || match[0]
          const key = `${type}:${value}`
          if (seenSecretKeys.has(key)) continue
          seenSecretKeys.add(key)

          // Skip common false positives
          if (/^(true|false|null|undefined|none|password|secret|token|example|test|placeholder)$/i.test(value)) continue
          if (/^[x*]{4,}$/i.test(value)) continue // Masked values like xxxx

          findings.push({
            url: sourceUrl,
            type,
            value: value.length > 40 ? value.slice(0, 40) + "..." : value,
            context: getLineContext(body, match.index),
            depth,
            discoveryChain: [...chain, `[${type}]`],
          })
        }
      }
    }

    return findings
  }

  // --- Step 5: Cookie Jar Tracking ---

  function trackCookieJars(
    logs: NetworkEntry[],
    contexts: BrowserContextInfo[],
  ): Map<string, CookieInfo[]> {
    const jars = new Map<string, CookieInfo[]>()

    for (const ctx of contexts) {
      jars.set(ctx.id, [])
    }

    for (const entry of logs) {
      const setCookie = entry.responseHeaders?.["set-cookie"]
      if (!setCookie) continue

      const cookies = setCookie.split(/,(?=\s*\w+=)/)
      for (const raw of cookies) {
        const parsed = parseCookie(raw, entry.url, entry.contextId)
        if (parsed) {
          const jar = jars.get(entry.contextId) ?? []
          // Update or add
          const existing = jar.findIndex((c) => c.name === parsed.name && c.domain === parsed.domain)
          if (existing >= 0) {
            jar[existing] = parsed
          } else {
            jar.push(parsed)
          }
          jars.set(entry.contextId, jar)
        }
      }
    }

    return jars
  }

  // --- Step 6: Session Diff ---

  function diffSessions(
    logs: NetworkEntry[],
    contexts: BrowserContextInfo[],
  ): SessionDiffResult[] {
    const diffs: SessionDiffResult[] = []

    // Group by URL + method
    const grouped = new Map<string, Map<string, NetworkEntry>>()
    for (const entry of logs) {
      if (!entry.status || isStaticAsset(entry.url)) continue
      const key = `${entry.method}:${normalizeUrl(entry.url)}`
      const contextMap = grouped.get(key) ?? new Map()
      contextMap.set(entry.contextId, entry)
      grouped.set(key, contextMap)
    }

    // Compare auth vs unauth contexts
    for (const [key, contextMap] of grouped) {
      if (contextMap.size < 2) continue

      const [method, endpoint] = key.split(":", 2)
      const entries = Array.from(contextMap.entries())

      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const [ctxA, entryA] = entries[i]
          const [ctxB, entryB] = entries[j]

          const statusDiff = entryA.status !== entryB.status
          const bodyDiff = entryA.responseBody !== entryB.responseBody
          const headerDiff: string[] = []

          // Compare important response headers
          const importantHeaders = ["x-frame-options", "content-security-policy", "x-xss-protection", "cache-control"]
          for (const header of importantHeaders) {
            const a = entryA.responseHeaders?.[header]
            const b = entryB.responseHeaders?.[header]
            if (a !== b) {
              headerDiff.push(`${header}: "${a ?? "missing"}" vs "${b ?? "missing"}"`)
            }
          }

          if (!statusDiff && !bodyDiff && headerDiff.length === 0) continue

          let significance: "high" | "medium" | "low" = "low"
          if (statusDiff) significance = "medium"
          if (ctxA === "unauth" || ctxB === "unauth") significance = "high"

          diffs.push({
            endpoint: endpoint,
            method,
            contextA: ctxA,
            contextB: ctxB,
            statusDiff,
            bodyDiff,
            headerDiff,
            significance,
          })
        }
      }
    }

    // Sort by significance
    const order = { high: 0, medium: 1, low: 2 }
    diffs.sort((a, b) => order[a.significance] - order[b.significance])

    return diffs.slice(0, 50) // Limit
  }

  // --- Report Generation ---

  function buildFullReport(data: {
    endpoints: Map<string, EndpointInfo>
    accessMatrix: AccessControlEntry[]
    idorCandidates: IDORCandidate[]
    jsFindings: JSFinding[]
    cookieJars: Map<string, CookieInfo[]>
    sessionDiffs: SessionDiffResult[]
    input: AnalysisInput
    scopedLogs: NetworkEntry[]
  }): string {
    const lines: string[] = [
      "# HackR Browser Analysis Report",
      "",
      `**Session:** ${data.input.sessionId}`,
      `**Target:** ${data.input.targetDomain || "No scope filter"}`,
      `**Contexts:** ${data.input.contexts.map((c) => `${c.id} (${c.role})`).join(", ")}`,
      `**Total requests:** ${data.scopedLogs.length}`,
      `**Unique endpoints:** ${data.endpoints.size}`,
      `**Generated:** ${new Date().toISOString()}`,
      "",
      "---",
      "",
    ]

    // Endpoints
    lines.push("## 1. Discovered Endpoints", "")
    for (const [url, info] of data.endpoints) {
      const methods = Array.from(info.methods).join(", ")
      const contexts = Array.from(info.contexts).join(", ")
      lines.push(`- \`${methods}\` ${url} — contexts: [${contexts}]`)
    }
    lines.push("")

    // Access Control Matrix
    lines.push("## 2. Access Control Matrix", "")
    const issues = data.accessMatrix.filter((e) => e.potentialIssue)
    if (issues.length > 0) {
      const contextIds = data.input.contexts.map((c) => c.id)
      lines.push(`| Endpoint | Method | ${contextIds.join(" | ")} | Issue |`)
      lines.push(`|----------|--------|${contextIds.map(() => "------").join("|")}|-------|`)
      for (const entry of issues) {
        const statuses = contextIds.map((id) => String(entry.results[id] ?? "N/A"))
        lines.push(`| ${entry.endpoint} | ${entry.method} | ${statuses.join(" | ")} | Yes |`)
      }
    } else {
      lines.push("No access control discrepancies detected.")
    }
    lines.push("")

    // IDOR
    lines.push("## 3. IDOR Candidates", "")
    if (data.idorCandidates.length > 0) {
      for (const c of data.idorCandidates) {
        lines.push(`### [${c.severity.toUpperCase()}] ${c.method} ${c.endpoint}`)
        lines.push(`- **Original:** ${c.originalContext} -> ${c.originalStatus}`)
        lines.push(`- **Replay:** ${c.replayContext} -> ${c.replayStatus}`)
        lines.push(`- **Reason:** ${c.reason}`)
        lines.push("")
      }
    } else {
      lines.push("No IDOR candidates detected.")
    }
    lines.push("")

    // JS Findings (with depth tracking)
    lines.push("## 4. JavaScript Source Analysis", "")

    const secrets = data.jsFindings.filter((f) => f.type === "secret" || f.type === "sensitive")
    const apiRoutes = data.jsFindings.filter((f) => f.type === "api_route")
    const adminPaths = data.jsFindings.filter((f) => f.type === "admin_path")
    const configPaths = data.jsFindings.filter((f) => f.type === "config")
    const internalPaths = data.jsFindings.filter((f) => f.type === "internal")
    const genericEndpoints = data.jsFindings.filter((f) => f.type === "endpoint")
    const maxDepth = data.jsFindings.reduce((max, f) => Math.max(max, f.depth), 0)

    lines.push(`**JS files analyzed:** ${new Set(data.jsFindings.map((f) => f.url)).size}`)
    lines.push(`**Max recursion depth:** ${maxDepth}`)
    lines.push(`**Total findings:** ${data.jsFindings.length}`)
    lines.push("")

    if (secrets.length > 0) {
      lines.push("### Secrets / Sensitive Data", "")
      for (const f of secrets) {
        const chain = f.discoveryChain.join(" → ")
        lines.push(`- **[${f.type.toUpperCase()}]** \`${f.value}\``)
        lines.push(`  - Discovery: ${chain}`)
        if (f.depth > 0) lines.push(`  - Depth: ${f.depth} (found via recursive analysis)`)
      }
      lines.push("")
    }

    if (adminPaths.length > 0) {
      lines.push(`### Admin / Dashboard Paths (${adminPaths.length} found)`, "")
      for (const f of adminPaths.slice(0, 30)) {
        const depthTag = f.depth > 0 ? ` [depth:${f.depth}]` : ""
        lines.push(`- \`${f.value}\`${depthTag} — in ${path.basename(f.url)}`)
      }
      if (adminPaths.length > 30) lines.push(`- ... and ${adminPaths.length - 30} more`)
      lines.push("")
    }

    if (apiRoutes.length > 0) {
      lines.push(`### API Routes (${apiRoutes.length} found)`, "")
      for (const f of apiRoutes.slice(0, 50)) {
        const depthTag = f.depth > 0 ? ` [depth:${f.depth}]` : ""
        lines.push(`- \`${f.value}\`${depthTag} — in ${path.basename(f.url)}`)
      }
      if (apiRoutes.length > 50) lines.push(`- ... and ${apiRoutes.length - 50} more`)
      lines.push("")
    }

    if (configPaths.length > 0) {
      lines.push(`### Config / Sensitive Files (${configPaths.length} found)`, "")
      for (const f of configPaths.slice(0, 20)) {
        const chain = f.discoveryChain.join(" → ")
        lines.push(`- \`${f.value}\` — ${chain}`)
      }
      lines.push("")
    }

    if (internalPaths.length > 0) {
      lines.push(`### Internal / Debug Paths (${internalPaths.length} found)`, "")
      for (const f of internalPaths.slice(0, 20)) {
        const chain = f.discoveryChain.join(" → ")
        lines.push(`- \`${f.value}\` — ${chain}`)
      }
      lines.push("")
    }

    if (genericEndpoints.length > 0) {
      lines.push(`### Other Endpoints (${genericEndpoints.length} found)`, "")
      // Group by depth
      const byDepth = new Map<number, JSFinding[]>()
      for (const f of genericEndpoints) {
        const list = byDepth.get(f.depth) ?? []
        list.push(f)
        byDepth.set(f.depth, list)
      }
      for (const [depth, findings] of Array.from(byDepth.entries()).sort((a, b) => a[0] - b[0])) {
        lines.push(`#### Depth ${depth} (${findings.length} endpoints)`)
        for (const f of findings.slice(0, 30)) {
          lines.push(`- \`${f.value}\` — in ${path.basename(f.url)}`)
        }
        if (findings.length > 30) lines.push(`- ... and ${findings.length - 30} more`)
        lines.push("")
      }
    }

    if (data.jsFindings.length === 0) {
      lines.push("No significant findings in JavaScript sources.")
    }
    lines.push("")

    // Cookie Jars
    lines.push("## 5. Cookie Jar Analysis", "")
    for (const [ctxId, cookies] of data.cookieJars) {
      if (cookies.length === 0) continue
      lines.push(`### Context: ${ctxId}`, "")
      lines.push("| Name | HttpOnly | Secure | SameSite | Domain |")
      lines.push("|------|----------|--------|----------|--------|")
      for (const c of cookies) {
        lines.push(`| ${c.name} | ${c.httpOnly ? "Yes" : "**No**"} | ${c.secure ? "Yes" : "**No**"} | ${c.sameSite || "None"} | ${c.domain} |`)
      }
      lines.push("")
    }

    // Session Diffs
    lines.push("## 6. Session Diff", "")
    if (data.sessionDiffs.length > 0) {
      for (const d of data.sessionDiffs.slice(0, 20)) {
        lines.push(`### [${d.significance.toUpperCase()}] ${d.method} ${d.endpoint}`)
        lines.push(`- **Contexts:** ${d.contextA} vs ${d.contextB}`)
        if (d.statusDiff) lines.push(`- Status codes differ`)
        if (d.bodyDiff) lines.push(`- Response body differs`)
        if (d.headerDiff.length > 0) {
          lines.push(`- Headers differ: ${d.headerDiff.join("; ")}`)
        }
        lines.push("")
      }
    } else {
      lines.push("No session differences detected.")
    }

    return lines.join("\n")
  }

  function buildSummary(data: {
    endpoints: Map<string, EndpointInfo>
    accessMatrix: AccessControlEntry[]
    idorCandidates: IDORCandidate[]
    jsFindings: JSFinding[]
    cookieJars: Map<string, CookieInfo[]>
    sessionDiffs: SessionDiffResult[]
    reportPath: string
    scopedLogs: NetworkEntry[]
  }): string {
    const issues = data.accessMatrix.filter((e) => e.potentialIssue)
    const secrets = data.jsFindings.filter((f) => f.type === "secret" || f.type === "sensitive")
    const apiRoutes = data.jsFindings.filter((f) => f.type === "api_route")
    const adminPaths = data.jsFindings.filter((f) => f.type === "admin_path")
    const configPaths = data.jsFindings.filter((f) => f.type === "config")
    const internalPaths = data.jsFindings.filter((f) => f.type === "internal")
    const allJsEndpoints = data.jsFindings.filter((f) => f.type === "endpoint" || f.type === "api_route" || f.type === "admin_path" || f.type === "config" || f.type === "internal")
    const deepFindings = data.jsFindings.filter((f) => f.depth > 0)
    const maxDepth = data.jsFindings.reduce((max, f) => Math.max(max, f.depth), 0)
    const highDiffs = data.sessionDiffs.filter((d) => d.significance === "high")

    const insecureCookies: string[] = []
    for (const [ctxId, cookies] of data.cookieJars) {
      for (const c of cookies) {
        if (!c.httpOnly || !c.secure) {
          insecureCookies.push(`${ctxId}:${c.name}`)
        }
      }
    }

    const lines = [
      "## Analysis Summary",
      "",
      `- **${data.scopedLogs.length}** total requests captured`,
      `- **${data.endpoints.size}** unique endpoints (from network traffic)`,
      `- **${allJsEndpoints.length}** endpoints discovered in JS/HTML/JSON sources`,
      `  - ${apiRoutes.length} API routes, ${adminPaths.length} admin paths, ${configPaths.length} config files, ${internalPaths.length} internal paths`,
      `  - ${deepFindings.length} found via recursive analysis (max depth: ${maxDepth})`,
      `- **${issues.length}** access control discrepancies`,
      `- **${data.idorCandidates.length}** potential IDOR issues${data.idorCandidates.filter((c) => c.severity === "high").length > 0 ? ` (${data.idorCandidates.filter((c) => c.severity === "high").length} HIGH)` : ""}`,
      `- **${secrets.length}** secrets/sensitive data in JS`,
      `- **${insecureCookies.length}** insecure cookies`,
      `- **${highDiffs.length}** high-significance session diffs`,
      "",
    ]

    // Critical findings first
    if (secrets.length > 0) {
      lines.push("### Exposed Secrets")
      for (const s of secrets.slice(0, 5)) {
        const depthTag = s.depth > 0 ? ` [depth:${s.depth}]` : ""
        lines.push(`- [${s.type}] \`${s.value}\` in ${path.basename(s.url)}${depthTag}`)
      }
      lines.push("")
    }

    if (adminPaths.length > 0) {
      lines.push("### Admin / Sensitive Paths")
      for (const p of adminPaths.slice(0, 5)) {
        lines.push(`- \`${p.value}\` — ${p.discoveryChain.join(" → ")}`)
      }
      lines.push("")
    }

    if (data.idorCandidates.length > 0) {
      lines.push("### Top IDOR Candidates")
      for (const c of data.idorCandidates.slice(0, 3)) {
        lines.push(`- [${c.severity.toUpperCase()}] ${c.method} ${c.endpoint}: ${c.reason}`)
      }
      lines.push("")
    }

    if (issues.length > 0) {
      lines.push("### Access Control Issues")
      for (const i of issues.slice(0, 3)) {
        const statuses = Object.entries(i.results)
          .map(([ctx, s]) => `${ctx}:${s}`)
          .join(", ")
        lines.push(`- ${i.method} ${i.endpoint}: ${statuses}`)
      }
      lines.push("")
    }

    if (apiRoutes.length > 0) {
      lines.push(`### API Routes (${apiRoutes.length} total, top 5)`)
      for (const r of apiRoutes.slice(0, 5)) {
        lines.push(`- \`${r.value}\``)
      }
      lines.push("")
    }

    lines.push(`Full report: ${data.reportPath}`)

    return lines.join("\n")
  }

  // =========================================================================
  // Cross-Session Aggregation
  // =========================================================================

  interface AggregateEndpoint {
    url: string
    methods: Set<string>
    sessions: Set<string>
    contexts: Set<string>
    statusBySession: Map<string, Map<string, number>> // sessionId -> (contextId -> status)
  }

  interface AggregateIDOR {
    endpoint: string
    method: string
    severity: "high" | "medium" | "low"
    reason: string
    sessions: string[] // which sessions detected this
  }

  interface AggregateSecret {
    type: "secret" | "sensitive"
    value: string
    sourceUrl: string
    sessions: string[]
  }

  interface AggregateCookieIssue {
    name: string
    domain: string
    issue: string // e.g., "missing httpOnly", "missing secure"
    sessions: string[]
  }

  /**
   * Aggregate analysis across all saved sessions.
   * Scans .cyberstrike/analysis-ses_* directories, merges findings,
   * deduplicates, and writes a consolidated report.
   *
   * This is code-level deterministic analysis — no AI context consumed.
   * Triggered explicitly by the agent via `browser aggregate` action.
   */
  export async function aggregate(): Promise<string> {
    const baseDir = path.join(getWorkDir(), ".cyberstrike")
    if (!existsSync(baseDir)) {
      return "No .cyberstrike directory found. No sessions to aggregate."
    }

    // Find all analysis session directories
    const entries = readdirSync(baseDir, { withFileTypes: true })
    const sessionDirs = entries
      .filter((e) => e.isDirectory() && e.name.startsWith("analysis-"))
      .map((e) => ({
        name: e.name,
        sessionId: e.name.replace("analysis-", ""),
        path: path.join(baseDir, e.name),
      }))

    if (sessionDirs.length === 0) {
      return "No analysis sessions found. Run browser sessions first."
    }

    log.info("aggregating sessions", { count: sessionDirs.length })

    // Collect data from all sessions
    const allEndpoints = new Map<string, AggregateEndpoint>()
    const allIDORs = new Map<string, AggregateIDOR>() // key = method:url
    const allSecrets = new Map<string, AggregateSecret>() // key = type:value
    const allCookieIssues = new Map<string, AggregateCookieIssue>() // key = domain:name:issue
    const sessionSummaries: Array<{
      sessionId: string
      targetDomain: string | null
      contexts: string[]
      requestCount: number
      endpointCount: number
      jsEndpointCount: number
      jsMaxDepth: number
      secretCount: number
    }> = []

    for (const dir of sessionDirs) {
      const networkFile = path.join(dir.path, "network.jsonl")
      const contextFile = path.join(dir.path, "contexts.json")

      const networkLogs = readNetworkLogsFromDisk(networkFile)
      const meta = readContextMetaFromDisk(contextFile)
      if (networkLogs.length === 0) continue

      const contexts = meta?.contexts ?? []
      const targetDomain = meta?.targetDomain ?? null

      // Filter to scope
      const scopedLogs = targetDomain
        ? networkLogs.filter((e) => {
            try {
              return new URL(e.url).hostname.includes(targetDomain)
            } catch {
              return false
            }
          })
        : networkLogs.filter((e) => !isStaticAsset(e.url))

      // 1. Aggregate endpoints
      const endpoints = extractEndpoints(scopedLogs)
      for (const [url, info] of endpoints) {
        const existing = allEndpoints.get(url)
        if (existing) {
          for (const m of info.methods) existing.methods.add(m)
          existing.sessions.add(dir.sessionId)
          for (const c of info.contexts) existing.contexts.add(c)
          const sessionStatuses = new Map<string, number>()
          for (const [ctxId, status] of info.statusCodes) {
            sessionStatuses.set(ctxId, status)
          }
          existing.statusBySession.set(dir.sessionId, sessionStatuses)
        } else {
          const sessionStatuses = new Map<string, number>()
          for (const [ctxId, status] of info.statusCodes) {
            sessionStatuses.set(ctxId, status)
          }
          allEndpoints.set(url, {
            url,
            methods: new Set(info.methods),
            sessions: new Set([dir.sessionId]),
            contexts: new Set(info.contexts),
            statusBySession: new Map([[dir.sessionId, sessionStatuses]]),
          })
        }
      }

      // 2. Aggregate IDOR candidates
      const idorCandidates = detectIDOR(scopedLogs, contexts)
      for (const c of idorCandidates) {
        const key = `${c.method}:${c.endpoint}`
        const existing = allIDORs.get(key)
        if (existing) {
          if (!existing.sessions.includes(dir.sessionId)) {
            existing.sessions.push(dir.sessionId)
          }
          // Upgrade severity if higher
          const order = { high: 3, medium: 2, low: 1 }
          if (order[c.severity] > order[existing.severity]) {
            existing.severity = c.severity
            existing.reason = c.reason
          }
        } else {
          allIDORs.set(key, {
            endpoint: c.endpoint,
            method: c.method,
            severity: c.severity,
            reason: c.reason,
            sessions: [dir.sessionId],
          })
        }
      }

      // 3. Aggregate JS findings — secrets + all endpoint types
      const jsFindings = analyzeJSSources(scopedLogs)
      for (const f of jsFindings) {
        if (f.type === "secret" || f.type === "sensitive") {
          const key = `${f.type}:${f.value}`
          const existing = allSecrets.get(key)
          if (existing) {
            if (!existing.sessions.includes(dir.sessionId)) {
              existing.sessions.push(dir.sessionId)
            }
          } else {
            allSecrets.set(key, {
              type: f.type,
              value: f.value,
              sourceUrl: f.url,
              sessions: [dir.sessionId],
            })
          }
        }

        // JS-discovered endpoints also go into the master endpoint map
        if (f.type === "endpoint" || f.type === "api_route" || f.type === "admin_path" || f.type === "config" || f.type === "internal") {
          const normalized = f.value
          const existing = allEndpoints.get(normalized)
          if (existing) {
            existing.sessions.add(dir.sessionId)
          } else {
            allEndpoints.set(normalized, {
              url: normalized,
              methods: new Set(["JS"]), // discovered from JS, not from network traffic
              sessions: new Set([dir.sessionId]),
              contexts: new Set(),
              statusBySession: new Map(),
            })
          }
        }
      }

      // 4. Aggregate cookie issues
      const cookieJars = trackCookieJars(scopedLogs, contexts)
      for (const [, cookies] of cookieJars) {
        for (const c of cookies) {
          const issues: string[] = []
          if (!c.httpOnly) issues.push("missing httpOnly")
          if (!c.secure) issues.push("missing secure")
          if (!c.sameSite || c.sameSite.toLowerCase() === "none") issues.push("sameSite=None")

          for (const issue of issues) {
            const key = `${c.domain}:${c.name}:${issue}`
            const existing = allCookieIssues.get(key)
            if (existing) {
              if (!existing.sessions.includes(dir.sessionId)) {
                existing.sessions.push(dir.sessionId)
              }
            } else {
              allCookieIssues.set(key, {
                name: c.name,
                domain: c.domain,
                issue,
                sessions: [dir.sessionId],
              })
            }
          }
        }
      }

      // Session summary
      const jsEndpointCount = jsFindings.filter((f) =>
        f.type === "endpoint" || f.type === "api_route" || f.type === "admin_path" || f.type === "config" || f.type === "internal"
      ).length
      const jsMaxDepth = jsFindings.reduce((max, f) => Math.max(max, f.depth), 0)

      sessionSummaries.push({
        sessionId: dir.sessionId,
        targetDomain,
        contexts: contexts.map((c) => `${c.id}(${c.role})`),
        requestCount: scopedLogs.length,
        endpointCount: endpoints.size,
        jsEndpointCount,
        jsMaxDepth,
        secretCount: jsFindings.filter((f) => f.type === "secret" || f.type === "sensitive").length,
      })
    }

    // Build aggregate report
    const lines: string[] = [
      "# HackR Aggregate Analysis Report",
      "",
      `**Sessions analyzed:** ${sessionSummaries.length}`,
      `**Total unique endpoints:** ${allEndpoints.size}`,
      `**Total IDOR candidates:** ${allIDORs.size}`,
      `**Total secrets found:** ${allSecrets.size}`,
      `**Total cookie issues:** ${allCookieIssues.size}`,
      `**Generated:** ${new Date().toISOString()}`,
      "",
      "---",
      "",
    ]

    // Session overview
    lines.push("## Session Overview", "")
    lines.push("| Session | Target | Contexts | Requests | Endpoints | JS Endpoints | JS Depth | Secrets |")
    lines.push("|---------|--------|----------|----------|-----------|-------------|----------|---------|")
    for (const s of sessionSummaries) {
      const shortId = s.sessionId.length > 20 ? s.sessionId.slice(0, 20) + "..." : s.sessionId
      lines.push(
        `| ${shortId} | ${s.targetDomain || "all"} | ${s.contexts.join(", ")} | ${s.requestCount} | ${s.endpointCount} | ${s.jsEndpointCount} | ${s.jsMaxDepth} | ${s.secretCount} |`,
      )
    }
    lines.push("")

    // IDOR candidates (sorted by severity, most important section)
    lines.push("## IDOR Candidates (Cross-Session)", "")
    if (allIDORs.size > 0) {
      const sorted = Array.from(allIDORs.values()).sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 }
        return order[a.severity] - order[b.severity]
      })
      for (const idor of sorted) {
        const persistent = idor.sessions.length > 1 ? " **[PERSISTENT]**" : ""
        lines.push(`### [${idor.severity.toUpperCase()}] ${idor.method} ${idor.endpoint}${persistent}`)
        lines.push(`- **Reason:** ${idor.reason}`)
        lines.push(`- **Seen in:** ${idor.sessions.length} session(s)`)
        lines.push("")
      }
    } else {
      lines.push("No IDOR candidates detected across sessions.")
    }
    lines.push("")

    // Secrets
    lines.push("## Exposed Secrets (Cross-Session)", "")
    if (allSecrets.size > 0) {
      for (const [, secret] of allSecrets) {
        const persistent = secret.sessions.length > 1 ? " **[PERSISTENT]**" : ""
        lines.push(`- **[${secret.type}]** \`${secret.value}\` in \`${path.basename(secret.sourceUrl)}\`${persistent}`)
        lines.push(`  - Seen in ${secret.sessions.length} session(s)`)
      }
    } else {
      lines.push("No secrets detected across sessions.")
    }
    lines.push("")

    // Cookie Issues
    lines.push("## Cookie Security Issues (Cross-Session)", "")
    if (allCookieIssues.size > 0) {
      lines.push("| Cookie | Domain | Issue | Sessions |")
      lines.push("|--------|--------|-------|----------|")
      for (const [, issue] of allCookieIssues) {
        lines.push(`| ${issue.name} | ${issue.domain} | ${issue.issue} | ${issue.sessions.length} |`)
      }
    } else {
      lines.push("No cookie security issues detected.")
    }
    lines.push("")

    // Endpoint inventory (all unique endpoints across sessions)
    lines.push("## Endpoint Inventory (All Sessions)", "")
    const endpointsByDomain = new Map<string, AggregateEndpoint[]>()
    for (const [, ep] of allEndpoints) {
      try {
        const domain = new URL(ep.url).hostname
        const list = endpointsByDomain.get(domain) ?? []
        list.push(ep)
        endpointsByDomain.set(domain, list)
      } catch {
        const list = endpointsByDomain.get("unknown") ?? []
        list.push(ep)
        endpointsByDomain.set("unknown", list)
      }
    }

    for (const [domain, endpoints] of endpointsByDomain) {
      lines.push(`### ${domain} (${endpoints.length} endpoints)`, "")
      for (const ep of endpoints.slice(0, 100)) {
        const methods = Array.from(ep.methods).join(",")
        const sessions = ep.sessions.size
        lines.push(`- \`${methods}\` ${ep.url} — ${sessions} session(s)`)
      }
      if (endpoints.length > 100) {
        lines.push(`- ... and ${endpoints.length - 100} more`)
      }
      lines.push("")
    }

    // Write full report to disk
    const reportPath = path.join(baseDir, "aggregate-report.md")
    await fs.writeFile(reportPath, lines.join("\n"), "utf-8")
    log.info("aggregate report written", { path: reportPath })

    // Build concise summary for LLM context (~500 tokens)
    const highIDORs = Array.from(allIDORs.values()).filter((i) => i.severity === "high")
    const persistentIDORs = Array.from(allIDORs.values()).filter((i) => i.sessions.length > 1)
    const persistentSecrets = Array.from(allSecrets.values()).filter((s) => s.sessions.length > 1)

    const summary = [
      "## Aggregate Analysis Summary",
      "",
      `- **${sessionSummaries.length}** sessions analyzed`,
      `- **${allEndpoints.size}** unique endpoints discovered`,
      `- **${allIDORs.size}** IDOR candidates${highIDORs.length > 0 ? ` (${highIDORs.length} HIGH)` : ""}${persistentIDORs.length > 0 ? ` (${persistentIDORs.length} persistent across sessions)` : ""}`,
      `- **${allSecrets.size}** secrets/sensitive data${persistentSecrets.length > 0 ? ` (${persistentSecrets.length} persistent)` : ""}`,
      `- **${allCookieIssues.size}** cookie security issues`,
      "",
    ]

    if (highIDORs.length > 0) {
      summary.push("### Critical IDOR Findings")
      for (const idor of highIDORs.slice(0, 5)) {
        const tag = idor.sessions.length > 1 ? " [PERSISTENT]" : ""
        summary.push(`- [HIGH] ${idor.method} ${idor.endpoint}${tag}: ${idor.reason}`)
      }
      summary.push("")
    }

    if (allSecrets.size > 0) {
      summary.push("### Exposed Secrets")
      for (const [, s] of Array.from(allSecrets.entries()).slice(0, 5)) {
        summary.push(`- [${s.type}] \`${s.value}\` in ${path.basename(s.sourceUrl)}`)
      }
      summary.push("")
    }

    if (allCookieIssues.size > 0) {
      summary.push("### Cookie Issues")
      const uniqueCookies = new Set<string>()
      for (const [, issue] of allCookieIssues) {
        const key = `${issue.name}@${issue.domain}`
        if (!uniqueCookies.has(key)) {
          uniqueCookies.add(key)
          summary.push(`- \`${issue.name}\` (${issue.domain}): ${issue.issue}`)
        }
        if (uniqueCookies.size >= 5) break
      }
      summary.push("")
    }

    summary.push(`Full report: ${reportPath}`)

    return summary.join("\n")
  }

  // =========================================================================
  // Internal Helpers (shared by analyze + aggregate)
  // =========================================================================

  function readNetworkLogsFromDisk(filePath: string): NetworkEntry[] {
    try {
      if (!existsSync(filePath)) return []
      const content = readFileSync(filePath, "utf-8")
      return content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as NetworkEntry)
    } catch {
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

  // --- Utility Functions ---

  function normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url)
      // Remove query params for grouping
      return `${parsed.origin}${parsed.pathname}`
    } catch {
      return url
    }
  }

  function isStaticAsset(url: string): boolean {
    const staticExtensions = /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|css|map|webp|avif)(\?|$)/i
    return staticExtensions.test(url)
  }

  function parseCookie(raw: string, requestUrl: string, contextId: string): CookieInfo | null {
    const parts = raw.split(";").map((p) => p.trim())
    const [nameValue, ...attrs] = parts
    if (!nameValue) return null

    const eqIdx = nameValue.indexOf("=")
    if (eqIdx < 0) return null

    const name = nameValue.slice(0, eqIdx).trim()
    const value = nameValue.slice(eqIdx + 1).trim()

    let domain = ""
    let cookiePath = "/"
    let httpOnly = false
    let secure = false
    let sameSite = ""
    let expires: string | undefined

    try {
      domain = new URL(requestUrl).hostname
    } catch {
      // ignore
    }

    for (const attr of attrs) {
      const lower = attr.toLowerCase()
      if (lower === "httponly") {
        httpOnly = true
      } else if (lower === "secure") {
        secure = true
      } else if (lower.startsWith("samesite=")) {
        sameSite = attr.split("=")[1] ?? ""
      } else if (lower.startsWith("domain=")) {
        domain = attr.split("=")[1] ?? domain
      } else if (lower.startsWith("path=")) {
        cookiePath = attr.split("=")[1] ?? "/"
      } else if (lower.startsWith("expires=")) {
        expires = attr.split("=").slice(1).join("=")
      }
    }

    return {
      contextId,
      name,
      value: value.length > 30 ? value.slice(0, 30) + "..." : value,
      domain,
      path: cookiePath,
      httpOnly,
      secure,
      sameSite,
      expires,
    }
  }

  function getLineContext(source: string, index: number): string {
    const start = Math.max(0, index - 40)
    const end = Math.min(source.length, index + 40)
    return source.slice(start, end).replace(/\n/g, " ").trim()
  }
}

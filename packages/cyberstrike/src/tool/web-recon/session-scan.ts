import { Request } from "../../session/request"
import { Session } from "../../session"
import type { Finding, WebReconResult } from "./shared"
import { sensitiveFiles, corsCheck, methodCheck, openRedirect, headerAudit, techDetect } from "./programs"

const REDIRECT_PARAMS = new Set([
  "url", "next", "redirect", "return", "returnurl", "return_url",
  "continue", "dest", "destination", "redir", "redirect_uri",
  "redirect_url", "target", "to", "out", "forward", "callback",
  "rurl", "go",
])

const MAX_ORIGINS = 10
const MAX_CORS_PER_ORIGIN = 3
const MAX_REDIRECT = 10
const MAX_SCAN_MS = 300_000

interface OriginBucket {
  apis: Set<string>
  pages: Set<string>
}

function instantiateTemplate(path: string): string {
  if (!path.includes("{")) return path
  return path.replace(/\{[^}]+\}/g, "1")
}

function isApiEndpoint(req: Request.Info, path: string): boolean {
  if (req.method !== "GET") return true
  if (/\/api\b|\/v\d+\/|\/graphql\b|\/rest\/|\/ws\//i.test(path)) return true
  const ct = req.response_content_type ?? ""
  if (/json|xml|protobuf/i.test(ct) && !/html/i.test(ct)) return true
  if (/\.json$|\.xml$/.test(path)) return true
  return false
}

function classifyRequests(requests: Request.Info[]): {
  origins: Map<string, OriginBucket>
  redirectPages: string[]
  templateCount: number
} {
  const origins = new Map<string, OriginBucket>()
  const redirectPages = new Set<string>()
  let templateCount = 0

  for (const req of requests) {
    const origin = req.origin ?? (req.scheme && req.host ? `${req.scheme}://${req.host}` : null)
    if (!origin) continue

    const rawPath = req.normalized_path.split("?")[0]
    const path = instantiateTemplate(rawPath)
    if (path !== rawPath) templateCount++

    if (!origins.has(origin)) origins.set(origin, { apis: new Set(), pages: new Set() })
    const bucket = origins.get(origin)!
    const fullUrl = `${origin}${path}`

    if (isApiEndpoint(req, path)) {
      bucket.apis.add(fullUrl)
    } else {
      bucket.pages.add(fullUrl)
    }

    if (req.normalized_path.includes("?")) {
      try {
        const qIdx = req.normalized_path.indexOf("?")
        const params = new URLSearchParams(req.normalized_path.slice(qIdx + 1))
        for (const key of params.keys()) {
          if (REDIRECT_PARAMS.has(key.toLowerCase())) {
            redirectPages.add(`${origin}${path}`)
            break
          }
        }
      } catch {}
    }
  }

  return { origins, redirectPages: [...redirectPages], templateCount }
}

export async function sessionScan(
  sessionID: string,
  timeout: number,
  abort?: AbortSignal,
): Promise<WebReconResult> {
  const rootID = Session.root(sessionID)
  const requests = Request.get(rootID)

  if (requests.length === 0) {
    return {
      output: "[-] No captured requests in session. Run hackbrowser first to collect endpoints.",
      findings: [],
    }
  }

  const deadline = Date.now() + MAX_SCAN_MS
  const { origins, redirectPages, templateCount } = classifyRequests(requests)
  const allFindings: Finding[] = []
  const lines: string[] = [
    `[*] Session scan: ${requests.length} requests, ${origins.size} origins`,
  ]
  if (templateCount > 0) lines.push(`[*] ${templateCount} template path(s) instantiated ({param} → 1)`)

  const originEntries = [...origins.entries()].slice(0, MAX_ORIGINS)
  let apiCheckCount = 0
  let redirCheckCount = 0

  // Phase 1: per-origin tech_detect + header_audit + sensitive_files
  lines.push(`\n=== PHASE 1: ORIGIN CHECKS (${originEntries.length}) ===`)

  for (const [origin, bucket] of originEntries) {
    if (abort?.aborted || Date.now() > deadline) {
      lines.push(`[!] Scan interrupted — skipping remaining origins`)
      break
    }

    lines.push(`\n[*] ${origin} (${bucket.apis.size} API, ${bucket.pages.size} pages)`)

    const results = await Promise.allSettled([
      techDetect(origin, [], timeout),
      headerAudit(origin, [], timeout),
      sensitiveFiles(origin, [], timeout),
    ])

    const labels = ["tech_detect", "header_audit", "sensitive_files"]
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === "fulfilled") {
        allFindings.push(...r.value.findings)
        if (r.value.findings.length > 0)
          lines.push(`    [!] ${labels[i]}: ${r.value.findings.length} finding(s)`)
      } else {
        lines.push(`    [!] ${labels[i]} failed: ${r.reason}`)
      }
    }
  }

  // Phase 2: CORS on API endpoints (+ origin root fallback) + method_check on origin roots only
  if (!abort?.aborted && Date.now() <= deadline) {
    const corsTargets: string[] = []
    for (const [origin, bucket] of originEntries) {
      if (bucket.apis.size > 0) {
        corsTargets.push(...[...bucket.apis].slice(0, MAX_CORS_PER_ORIGIN))
      } else {
        corsTargets.push(origin + "/")
      }
    }

    const methodRoots = [...new Set(originEntries.map(([origin]) => origin + "/"))]
    apiCheckCount = corsTargets.length + methodRoots.length

    if (apiCheckCount > 0) {
      lines.push(`\n=== PHASE 2: API & METHOD CHECKS (${corsTargets.length} CORS, ${methodRoots.length} method) ===`)

      const allTasks = [
        ...corsTargets.map((url) => corsCheck(url, [], timeout)),
        ...methodRoots.map((url) => methodCheck(url, [], timeout)),
      ]
      const allResults = await Promise.allSettled(allTasks)

      for (let i = 0; i < corsTargets.length; i++) {
        const r = allResults[i]
        if (r.status === "fulfilled" && r.value.findings.length > 0) {
          allFindings.push(...r.value.findings)
          lines.push(`    [!] CORS: ${corsTargets[i]}`)
        } else if (r.status === "rejected") {
          lines.push(`    [!] CORS failed for ${corsTargets[i]}: ${r.reason}`)
        }
      }

      for (let i = 0; i < methodRoots.length; i++) {
        const r = allResults[corsTargets.length + i]
        if (r.status === "fulfilled" && r.value.findings.length > 0) {
          allFindings.push(...r.value.findings)
          lines.push(`    [!] Methods: ${methodRoots[i]}`)
        } else if (r.status === "rejected") {
          lines.push(`    [!] Method check failed for ${methodRoots[i]}: ${r.reason}`)
        }
      }
    }
  }

  // Phase 3: open redirect on pages with redirect-like query params
  if (!abort?.aborted && Date.now() <= deadline) {
    const redirSlice = redirectPages.slice(0, MAX_REDIRECT)
    redirCheckCount = redirSlice.length
    if (redirSlice.length > 0) {
      lines.push(`\n=== PHASE 3: REDIRECT CHECKS (${redirSlice.length}) ===`)

      for (const url of redirSlice) {
        if (abort?.aborted || Date.now() > deadline) break
        try {
          const result = await openRedirect(url, [], timeout)
          if (result.findings.length > 0) {
            allFindings.push(...result.findings)
            lines.push(`    [!] Open redirect: ${url}`)
          }
        } catch (err) {
          lines.push(`    [!] Redirect check failed: ${url} — ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  // Summary
  const sevOrder = ["critical", "high", "medium", "low", "info"]
  lines.push(`\n=== SUMMARY ===`)
  lines.push(`[*] Scanned: ${originEntries.length} origins, ${apiCheckCount} API/method checks, ${redirCheckCount} redirect pages`)
  lines.push(`[*] Findings: ${allFindings.length}`)

  if (allFindings.length > 0) {
    const bySev: Record<string, number> = {}
    for (const f of allFindings) bySev[f.severity] = (bySev[f.severity] || 0) + 1
    lines.push(
      `[*] Severity: ${Object.entries(bySev)
        .sort(([a], [b]) => sevOrder.indexOf(a) - sevOrder.indexOf(b))
        .map(([s, c]) => `${s}:${c}`)
        .join(", ")}`,
    )
  }

  if (origins.size > MAX_ORIGINS) lines.push(`[*] Note: ${origins.size - MAX_ORIGINS} additional origin(s) not scanned (limit: ${MAX_ORIGINS})`)

  return { output: lines.join("\n"), findings: allFindings }
}

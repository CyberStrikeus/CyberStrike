import { Request } from "../../session/request"
import { Session } from "../../session"
import type { Finding, WebReconResult } from "./shared"
import { sensitiveFiles, corsCheck, methodCheck, openRedirect, headerAudit } from "./programs"

const REDIRECT_PARAMS = new Set([
  "url", "next", "redirect", "return", "returnurl", "return_url",
  "continue", "dest", "destination", "redir", "redirect_uri",
  "redirect_url", "target", "to", "out", "forward", "callback",
  "rurl", "go",
])

const MAX_ORIGINS = 10
const MAX_CORS_PER_ORIGIN = 3
const MAX_REDIRECT = 10

interface OriginBucket {
  apis: string[]
  pages: string[]
}

function classifyRequests(requests: Request.Info[]): {
  origins: Map<string, OriginBucket>
  redirectPages: string[]
} {
  const origins = new Map<string, OriginBucket>()
  const redirectPages = new Set<string>()

  for (const req of requests) {
    const origin = req.origin ?? (req.scheme && req.host ? `${req.scheme}://${req.host}` : null)
    if (!origin) continue
    if (req.normalized_path.includes("{")) continue

    if (!origins.has(origin)) origins.set(origin, { apis: [], pages: [] })
    const bucket = origins.get(origin)!
    const path = req.normalized_path.split("?")[0]
    const fullUrl = `${origin}${path}`
    const isApi = req.method !== "GET" || /\/api\b/i.test(path)

    if (isApi) {
      if (!bucket.apis.includes(fullUrl)) bucket.apis.push(fullUrl)
    } else {
      if (!bucket.pages.includes(fullUrl)) bucket.pages.push(fullUrl)
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

  return { origins, redirectPages: [...redirectPages] }
}

export async function sessionScan(sessionID: string, timeout: number): Promise<WebReconResult> {
  const rootID = Session.root(sessionID)
  const requests = Request.get(rootID)

  if (requests.length === 0) {
    return {
      output: "[-] No captured requests in session. Run hackbrowser first to collect endpoints.",
      findings: [],
    }
  }

  const { origins, redirectPages } = classifyRequests(requests)
  const allFindings: Finding[] = []
  const lines: string[] = [
    `[*] Session scan: ${requests.length} requests, ${origins.size} origins`,
  ]

  // Phase 1: per-origin header_audit + sensitive_files
  const originEntries = [...origins.entries()].slice(0, MAX_ORIGINS)
  lines.push(`\n=== ORIGIN CHECKS (${originEntries.length}) ===`)

  for (const [origin, bucket] of originEntries) {
    lines.push(`\n[*] ${origin} (${bucket.apis.length} API, ${bucket.pages.length} pages)`)

    const [headerRes, fileRes] = await Promise.allSettled([
      headerAudit(origin, [], timeout),
      sensitiveFiles(origin, [], timeout),
    ])

    if (headerRes.status === "fulfilled") {
      allFindings.push(...headerRes.value.findings)
      if (headerRes.value.findings.length > 0)
        lines.push(`    [!] ${headerRes.value.findings.length} header issues`)
    }
    if (fileRes.status === "fulfilled") {
      allFindings.push(...fileRes.value.findings)
      if (fileRes.value.findings.length > 0)
        lines.push(`    [!] ${fileRes.value.findings.length} sensitive files exposed`)
    }
  }

  // Phase 2: CORS + method checks on representative API endpoints per origin
  const apiTargets: string[] = []
  for (const [, bucket] of originEntries) {
    apiTargets.push(...bucket.apis.slice(0, MAX_CORS_PER_ORIGIN))
  }

  if (apiTargets.length > 0) {
    lines.push(`\n=== API ENDPOINT CHECKS (${apiTargets.length}) ===`)

    for (const url of apiTargets) {
      const [corsRes, methodRes] = await Promise.allSettled([
        corsCheck(url, [], timeout),
        methodCheck(url, [], timeout),
      ])

      if (corsRes.status === "fulfilled" && corsRes.value.findings.length > 0) {
        allFindings.push(...corsRes.value.findings)
        lines.push(`    [!] CORS: ${url}`)
      }
      if (methodRes.status === "fulfilled" && methodRes.value.findings.length > 0) {
        allFindings.push(...methodRes.value.findings)
        lines.push(`    [!] Methods: ${url}`)
      }
    }
  }

  // Phase 3: open redirect on pages with redirect-like query params
  const redirSlice = redirectPages.slice(0, MAX_REDIRECT)
  if (redirSlice.length > 0) {
    lines.push(`\n=== REDIRECT CHECKS (${redirSlice.length}) ===`)

    for (const url of redirSlice) {
      try {
        const result = await openRedirect(url, [], timeout)
        if (result.findings.length > 0) {
          allFindings.push(...result.findings)
          lines.push(`    [!] Open redirect: ${url}`)
        }
      } catch {}
    }
  }

  // Summary
  const sevOrder = ["critical", "high", "medium", "low", "info"]
  lines.push(`\n=== SUMMARY ===`)
  lines.push(`[*] Scanned: ${originEntries.length} origins, ${apiTargets.length} API endpoints, ${redirSlice.length} redirect pages`)
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

  return { output: lines.join("\n"), findings: allFindings }
}

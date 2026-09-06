import type { HttpSender } from "../transport"
import { METAFILE_PATHS, FINGERPRINT_PROBES, LEAKAGE_PATTERNS, type MetafileParser } from "./wordlists"

const BODY_PREVIEW_LEN = 300

export interface MetafileResult {
  path: string
  status: number | null
  found: boolean
  extractedUrls: string[]
  bodyPreview: string
  error?: string
}

export interface MetafileReport {
  origin: string
  results: MetafileResult[]
  allUrls: string[]
}

export interface FingerprintResult {
  path: string
  tech: string
  status: number | null
  detected: boolean
  bodyPreview: string
  error?: string
}

export interface FingerprintReport {
  origin: string
  results: FingerprintResult[]
  detectedTech: string[]
}

export interface LeakageMatch {
  type: string
  value: string
}

export interface LeakageReport {
  url: string
  comments: string[]
  findings: LeakageMatch[]
}

function parseRobots(body: string, origin: string): string[] {
  const urls: string[] = []
  for (const line of body.split("\n")) {
    const trimmed = line.trim()
    const match = trimmed.match(/^(?:Disallow|Allow|Sitemap)\s*:\s*(.+)/i)
    if (!match) continue
    const val = match[1]!.trim()
    if (!val || val === "/") continue
    if (val.startsWith("http")) {
      urls.push(val)
    } else {
      urls.push(`${origin}${val.startsWith("/") ? "" : "/"}${val}`)
    }
  }
  return [...new Set(urls)]
}

function parseSitemap(body: string): string[] {
  const urls: string[] = []
  const locRe = /<loc>\s*(.*?)\s*<\/loc>/gi
  let m: RegExpExecArray | null
  while ((m = locRe.exec(body)) !== null) {
    const url = m[1]!.trim()
    if (url) urls.push(url)
  }
  return [...new Set(urls)]
}

function parseXmlUrls(body: string): string[] {
  const urls: string[] = []
  const re = /https?:\/\/[^\s<>"']+/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) urls.push(m[0]!)
  return [...new Set(urls)]
}

function parseJsonUrls(body: string): string[] {
  const urls: string[] = []
  const re = /https?:\/\/[^\s"'\\}]+/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) urls.push(m[0]!)
  return [...new Set(urls)]
}

function extractUrls(body: string, parser: MetafileParser, origin: string): string[] {
  switch (parser) {
    case "robots": return parseRobots(body, origin)
    case "sitemap": return parseSitemap(body)
    case "xml_urls": return parseXmlUrls(body)
    case "json_urls": return parseJsonUrls(body)
    case "text": return parseXmlUrls(body)
  }
}

export class ReconProbe {
  constructor(private readonly sender: HttpSender) {}

  async metafiles(input: { origin: string; limit?: number }): Promise<MetafileReport> {
    const origin = input.origin.replace(/\/+$/, "")
    let paths = [...METAFILE_PATHS]
    if (input.limit && input.limit > 0) paths = paths.slice(0, input.limit)

    const results: MetafileResult[] = []
    const allUrls: string[] = []

    for (const entry of paths) {
      const url = `${origin}${entry.path}`
      const resp = await this.sender.send({ method: "GET", url, headers: {} })

      if ("error" in resp) {
        results.push({ path: entry.path, status: null, found: false, extractedUrls: [], bodyPreview: "", error: resp.error })
        continue
      }

      const found = resp.status >= 200 && resp.status < 300 && resp.body.length > 0
      const urls = found ? extractUrls(resp.body, entry.parser, origin) : []
      allUrls.push(...urls)

      results.push({
        path: entry.path,
        status: resp.status,
        found,
        extractedUrls: urls,
        bodyPreview: resp.body.slice(0, BODY_PREVIEW_LEN),
      })
    }

    return { origin, results, allUrls: [...new Set(allUrls)] }
  }

  async fingerprint(input: { origin: string; limit?: number }): Promise<FingerprintReport> {
    const origin = input.origin.replace(/\/+$/, "")
    let probes = [...FINGERPRINT_PROBES]
    if (input.limit && input.limit > 0) probes = probes.slice(0, input.limit)

    const results: FingerprintResult[] = []
    const detectedTech = new Set<string>()

    for (const probe of probes) {
      const url = `${origin}${probe.path}`
      const resp = await this.sender.send({ method: probe.method, url, headers: {} })

      if ("error" in resp) {
        results.push({ path: probe.path, tech: probe.tech, status: null, detected: false, bodyPreview: "", error: resp.error })
        continue
      }

      const detected = resp.status >= 200 && resp.status < 400 && probe.evidence.test(resp.body)
      if (detected) detectedTech.add(probe.tech)

      results.push({
        path: probe.path,
        tech: probe.tech,
        status: resp.status,
        detected,
        bodyPreview: resp.body.slice(0, BODY_PREVIEW_LEN),
      })
    }

    return { origin, results, detectedTech: [...detectedTech] }
  }

  leakage(input: { url: string; body: string }): LeakageReport {
    const comments: string[] = []
    const findings: LeakageMatch[] = []

    let m: RegExpExecArray | null
    const commentRe = new RegExp(LEAKAGE_PATTERNS.html_comment.source, "g")
    while ((m = commentRe.exec(input.body)) !== null) {
      const comment = m[0]!
      if (comment.length > 4 && comment.length < 2000 && !/^\s*<!\-\-\s*\-\->\s*$/.test(comment)) {
        comments.push(comment.length > 200 ? comment.slice(0, 200) + "..." : comment)
      }
    }

    for (const [type, pattern] of Object.entries(LEAKAGE_PATTERNS)) {
      if (type === "html_comment") continue
      const re = new RegExp(pattern.source, pattern.flags)
      while ((m = re.exec(input.body)) !== null) {
        findings.push({ type, value: m[0]!.slice(0, 120) })
        if (findings.length > 50) break
      }
      if (findings.length > 50) break
    }

    return { url: input.url, comments: comments.slice(0, 20), findings: findings.slice(0, 50) }
  }
}

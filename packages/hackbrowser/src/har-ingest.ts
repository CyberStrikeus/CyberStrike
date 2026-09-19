// HAR → CyberStrike ingest bridge (quick-test capture path).
//
// The HackBrowser extension captures a PAGE's own fetch/XHR. It cannot see traffic that ANOTHER
// browser extension generates (that runs in the other extension's isolated content-script world or
// its background service worker — a content script can't instrument those, and MV3 webRequest can't
// read response bodies). So to feed a target extension's traffic into the CyberStrike glass pipeline,
// capture it BELOW the extension boundary — a proxy, or the target's own DevTools → "Save all as HAR"
// — then replay that HAR here. The ingest endpoint (POST /session/ingest) is source-agnostic: it
// takes a raw HTTP request + response, exactly what this maps each HAR entry to.
//
// Usage:
//   bun packages/hackbrowser/src/har-ingest.ts <file.har> [options]
//
// Options:
//   --server <url>     CyberStrike base URL (default http://127.0.0.1:4096)
//   --session <id>     Reuse an existing session id (default: the first ingest creates one)
//   --role <label>     Tag every request with this role/credential (cross-role IDOR/BFLA compare)
//   --host <substr>    Only ingest entries whose request host contains this substring
//   --include <substr> Only ingest entries whose URL contains this substring
//   --assets           Also ingest static noise assets (css/img/font/media) — skipped by default (JS is always kept)
//   --no-fetch-empty   Don't re-fetch bodies DevTools/cache dropped (default: recover them, GET only)
//   --limit <n>        Stop after n ingested entries
//   --dry              Print what would be sent, POST nothing
//
// Example (test a target extension seen through a proxy-exported HAR, tagged as the "admin" role):
//   bun packages/hackbrowser/src/har-ingest.ts ~/Desktop/target.har --role admin --host api.target.com

interface HarHeader {
  name: string
  value: string
}
interface HarEntry {
  request: {
    method: string
    url: string
    headers: HarHeader[]
    postData?: { text?: string; mimeType?: string }
  }
  response: {
    status: number
    headers: HarHeader[]
    content?: { text?: string; mimeType?: string; encoding?: string }
  }
  pageref?: string
}

// Noise assets skipped by default — images, fonts, styles, media, source maps. JS/mjs are NOT here:
// script bundles are prime security targets (secrets, endpoints, vulnerable libs, e.g. a DOMPurify
// version), so they are always ingested. `--assets` additionally ingests this noise set.
const ASSET_RE = /\.(?:css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|otf|mp4|webm|mp3|map)(?:\?|$)/i

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

// Rebuild the raw HTTP request string the ingest `text` field expects — the exact shape the
// HackBrowser extension's toRawHttp() produces (request line + Host + headers, CRLF, blank line,
// body). HTTP/2 pseudo-headers (:method/:authority/…) are dropped and Host is reconstructed.
function toRawHttp(entry: HarEntry): string {
  let path = entry.request.url
  let host = ""
  try {
    const u = new URL(entry.request.url)
    path = u.pathname + u.search
    host = u.host
  } catch {
    // leave url as-is
  }
  const headers = entry.request.headers.filter((h) => h.name && !h.name.startsWith(":"))
  const hasHost = headers.some((h) => h.name.toLowerCase() === "host")
  const lines = [`${entry.request.method} ${path} HTTP/1.1`]
  if (host && !hasHost) lines.push(`Host: ${host}`)
  for (const h of headers) lines.push(`${h.name}: ${h.value}`)
  const head = lines.join("\r\n")
  const body = entry.request.postData?.text ?? ""
  return body ? `${head}\r\n\r\n${body}` : `${head}\r\n\r\n`
}

// HAR response content is text, or base64 when the browser/proxy couldn't inline it as UTF-8.
function responseBody(entry: HarEntry): string {
  const content = entry.response.content
  if (!content || content.text == null) return ""
  if (content.encoding === "base64") {
    try {
      return Buffer.from(content.text, "base64").toString("utf8")
    } catch {
      return ""
    }
  }
  return content.text
}

function headerRecord(headers: HarHeader[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const h of headers) if (h.name && !h.name.startsWith(":")) out[h.name.toLowerCase()] = h.value
  return out
}

// When a HAR entry has no response body — DevTools evicted it from its buffer (common for large
// bundles), or the browser served it from cache — the JS/JSON content is lost, so a captured bundle
// (e.g. EclairNG.js) can't be mined. Recover it by re-fetching the URL and REPLAYING the request's
// headers, so an auth-gated asset resolves as the captured identity (parity with the live js-miner's
// authed fetch). GET only — never re-issue a POST (that would re-trigger a state-changing action).
// Best-effort: any failure/oversize keeps the empty body.
const MAX_RECOVER_BYTES = Math.max(0, Number(process.env.HAR_RECOVER_MAX_BYTES) || 8_000_000)
async function recoverBody(entry: HarEntry): Promise<{ body: string; contentType?: string } | null> {
  if (entry.request.method.toUpperCase() !== "GET") return null
  const headers: Record<string, string> = {}
  for (const h of entry.request.headers)
    if (h.name && !h.name.startsWith(":") && !["host", "content-length", "content-encoding"].includes(h.name.toLowerCase()))
      headers[h.name] = h.value
  try {
    const res = await fetch(entry.request.url, { method: "GET", headers, redirect: "follow", signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0 || buf.byteLength > MAX_RECOVER_BYTES) return null
    return { body: new TextDecoder().decode(buf), contentType: res.headers.get("content-type") ?? undefined }
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const file = process.argv[2]
  if (!file || file.startsWith("--")) {
    console.error("usage: bun har-ingest.ts <file.har> [--server url] [--session id] [--role label] [--host substr] [--include substr] [--assets] [--no-fetch-empty] [--limit n] [--dry]")
    process.exit(1)
  }
  const server = (arg("server") ?? "http://127.0.0.1:4096").replace(/\/+$/, "")
  const role = arg("role")
  const hostFilter = arg("host")
  const includeFilter = arg("include")
  const keepAssets = flag("assets")
  const dry = flag("dry")
  const fetchEmpty = !flag("no-fetch-empty") // recover empty response bodies by re-fetching (GET only)
  const limit = arg("limit") ? Number(arg("limit")) : Infinity

  const raw = await Bun.file(file).text()
  let har: { log?: { entries?: HarEntry[] } }
  try {
    har = JSON.parse(raw)
  } catch (e) {
    console.error(`not valid JSON/HAR: ${file}`)
    process.exit(1)
  }
  const entries = har.log?.entries ?? []
  if (entries.length === 0) {
    console.error("no entries in HAR (log.entries empty)")
    process.exit(1)
  }

  let sessionID = arg("session")
  let sent = 0
  let skipped = 0
  let failed = 0
  let recovered = 0

  console.log(`HAR: ${file} — ${entries.length} entries → ${server}/session/ingest${role ? `  (role: ${role})` : ""}${dry ? "  [DRY RUN]" : ""}`)

  for (const entry of entries) {
    if (sent >= limit) break
    const url = entry.request?.url ?? ""
    let scheme: "http" | "https" | undefined
    let host = ""
    try {
      const u = new URL(url)
      scheme = u.protocol === "http:" ? "http" : "https"
      host = u.host
    } catch {
      skipped++
      continue
    }
    if (scheme === undefined) {
      skipped++
      continue
    }
    if (hostFilter && !host.includes(hostFilter)) {
      skipped++
      continue
    }
    if (includeFilter && !url.includes(includeFilter)) {
      skipped++
      continue
    }
    if (!keepAssets && ASSET_RE.test(url)) {
      skipped++
      continue
    }

    const respHeaders = headerRecord(entry.response?.headers ?? [])
    let respBody = responseBody(entry)
    // Recover a body DevTools/cache dropped, so the JS/JSON content reaches the pipeline (see recoverBody).
    if (!respBody && fetchEmpty && !dry) {
      const rec = await recoverBody(entry)
      if (rec) {
        respBody = rec.body
        if (rec.contentType) respHeaders["content-type"] = rec.contentType
        recovered++
      }
    }
    const payload: Record<string, unknown> = {
      text: toRawHttp(entry),
      scheme,
      response: {
        status: entry.response?.status ?? 0,
        headers: respHeaders,
        body: respBody,
      },
    }
    if (sessionID) payload.sessionID = sessionID
    if (entry.pageref) payload.page_url = entry.pageref
    if (role) payload.credential = { label: role }

    if (dry) {
      console.log(`  ${entry.request.method} ${url} → ${entry.response?.status}  (body ${String((payload.response as { body: string }).body).length}b)`)
      sent++
      continue
    }

    try {
      const res = await fetch(`${server}/session/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        failed++
        console.error(`  ✗ ${res.status} ${entry.request.method} ${url}`)
        continue
      }
      const data = (await res.json()) as { sessionID?: string; skipped?: boolean }
      if (!sessionID && data.sessionID) {
        sessionID = data.sessionID
        console.log(`  session: ${sessionID}`)
      }
      sent++
      if (sent % 25 === 0) console.log(`  … ${sent} ingested`)
    } catch (e) {
      failed++
      console.error(`  ✗ POST failed ${entry.request.method} ${url}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  console.log(
    `\ndone — ingested ${sent}, skipped ${skipped}${recovered ? `, recovered ${recovered} empty bodies` : ""}${failed ? `, failed ${failed}` : ""}${sessionID ? `\nsession: ${sessionID}` : ""}`,
  )
  if (sessionID && !dry) console.log(`open the session in CyberStrike to see the captured traffic + findings.`)
}

main()

// HAR import/export — the offline-traffic adapter. HAR (HTTP Archive) is what browsers, Burp and
// Caido export, so `fromHar` lets recorded traffic flow into the same store the live adapters feed;
// `toHar` exports back for sharing. Parsing is defensive (HAR in the wild is inconsistent).
import type { Transaction, Header } from "./transaction"

interface HarHeader {
  name: string
  value: string
}
interface HarEntry {
  startedDateTime?: string
  time?: number
  request?: { method?: string; url?: string; headers?: HarHeader[]; postData?: { mimeType?: string; text?: string } }
  response?: { status?: number; headers?: HarHeader[]; content?: { size?: number; mimeType?: string; text?: string; encoding?: string } }
}
export interface Har {
  log?: { entries?: HarEntry[] }
}

function headers(hs: HarHeader[] | undefined): Header[] {
  if (!Array.isArray(hs)) return []
  return hs.filter((h) => h && typeof h.name === "string").map((h) => ({ name: h.name, value: String(h.value ?? "") }))
}

function decodeContent(text: string | undefined, encoding: string | undefined): string | undefined {
  if (text == null) return undefined
  if (encoding === "base64") {
    try {
      return atob(text)
    } catch {
      return text
    }
  }
  return text
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ""
  }
}

// Parse a HAR object into Transactions (source "import"). `session` tags them if given.
export function fromHar(har: Har, session?: string): Transaction[] {
  const entries = har.log?.entries
  if (!Array.isArray(entries)) return []
  const out: Transaction[] = []
  for (const e of entries) {
    const url = e.request?.url
    if (!url) continue
    const body = e.response?.content
    out.push({
      id: `har_${crypto.randomUUID()}`,
      session,
      source: "import",
      host: hostOf(url),
      request: {
        method: (e.request?.method ?? "GET").toUpperCase(),
        url,
        headers: headers(e.request?.headers),
        body: e.request?.postData?.text,
      },
      response: e.response
        ? {
            status: e.response.status ?? 0,
            headers: headers(e.response.headers),
            body: decodeContent(body?.text, body?.encoding),
            bodyLength: body?.size,
          }
        : undefined,
      timing: typeof e.time === "number" ? { ms: e.time } : undefined,
    })
  }
  return out
}

// Convenience: parse a HAR JSON string then import. Throws on invalid JSON.
export function parseHar(json: string, session?: string): Transaction[] {
  return fromHar(JSON.parse(json) as Har, session)
}

// Export Transactions back to a HAR object (minimal but round-trippable).
export function toHar(txs: Transaction[]): Har {
  return {
    log: {
      entries: txs.map((tx) => ({
        startedDateTime: new Date(tx.timing?.startedAt ?? 0).toISOString(),
        time: tx.timing?.ms ?? 0,
        request: {
          method: tx.request.method,
          url: tx.request.url,
          headers: tx.request.headers.map((h) => ({ name: h.name, value: h.value })),
          ...(tx.request.body != null ? { postData: { mimeType: "", text: tx.request.body } } : {}),
        },
        response: tx.response
          ? {
              status: tx.response.status,
              headers: tx.response.headers.map((h) => ({ name: h.name, value: h.value })),
              content: { size: tx.response.bodyLength ?? tx.response.body?.length ?? 0, mimeType: "", text: tx.response.body ?? "" },
            }
          : { status: 0, headers: [], content: { size: 0, mimeType: "", text: "" } },
      })),
    },
  }
}

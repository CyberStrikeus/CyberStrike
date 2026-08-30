export type Finding = {
  checkId: string
  provider: string
  severity: string
  status: string
  resource: string
  title: string
  details: string
  remediation: string
  cwe?: string
}

export type WebReconResult = { output: string; findings: Finding[] }

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

const MAX_BODY = 2_000_000

export type FetchResult = { status: number; headers: Headers; text: string }

export async function safeFetch(
  url: string,
  opts: { timeout?: number; method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<FetchResult | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), (opts.timeout ?? 10) * 1000)
  try {
    const resp = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { "User-Agent": UA, Accept: "*/*", ...opts.headers },
      body: opts.body,
      signal: controller.signal,
      redirect: "follow",
    })
    const declared = Number(resp.headers.get("content-length") ?? "0")
    if (declared > MAX_BODY) return { status: resp.status, headers: resp.headers, text: "" }
    const text = await resp.text()
    return { status: resp.status, headers: resp.headers, text: text.length > MAX_BODY ? text.slice(0, MAX_BODY) : text }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function extractLocs(xml: string): string[] {
  const locs: string[] = []
  const re = /<loc>\s*(?:<!\[CDATA\[\s*)?([^<\]\s]+)/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) {
    if (match[1]) locs.push(match[1])
  }
  return locs
}

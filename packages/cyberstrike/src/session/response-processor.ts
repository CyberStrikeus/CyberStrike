// Response Processing for HTTP Responses
// Handles truncation, HTML summarization, and binary detection

const MAX_RESPONSE_SIZE = 100 * 1024 // 100 KB

// Headers useful for application analysis
const USEFUL_HEADERS = [
  "content-type",
  "content-length",
  "location",
  "x-powered-by",
  "server",
  "x-request-id",
  "x-correlation-id",
  "www-authenticate",
  "allow",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "retry-after",
]

export interface ResponseInput {
  status: number
  headers: Record<string, string>
  body: string
}

export interface ProcessedResponse {
  status: number
  headers: Record<string, string>
  contentType: string
  originalSize: number
  content: string
}

export function processResponse(input: ResponseInput): ProcessedResponse {
  // 1. Filter headers
  const filteredHeaders = filterHeaders(input.headers)

  // 2. Determine content type
  const contentType = getContentType(input.headers)
  const originalSize = Buffer.byteLength(input.body, "utf-8")

  // 3. Build metadata line
  const metadata = `[Status: ${input.status}, Type: ${contentType}, Size: ${formatSize(originalSize)}]`

  // 4. Process based on content type
  let content: string

  if (isBinary(contentType)) {
    content = `${metadata}\nBinary content: ${contentType}`
  } else if (isHtml(contentType)) {
    content = `${metadata}\nThis is an HTML response`
  } else if (isJson(contentType) || isText(contentType)) {
    if (originalSize > MAX_RESPONSE_SIZE) {
      const truncated = input.body.slice(0, MAX_RESPONSE_SIZE)
      content = `${metadata}\n${truncated}\n[TRUNCATED - showing first 100KB of ${formatSize(originalSize)}]`
    } else {
      content = `${metadata}\n${input.body}`
    }
  } else {
    // Unknown type - treat as text with truncation
    if (originalSize > MAX_RESPONSE_SIZE) {
      const truncated = input.body.slice(0, MAX_RESPONSE_SIZE)
      content = `${metadata}\n${truncated}\n[TRUNCATED - showing first 100KB of ${formatSize(originalSize)}]`
    } else {
      content = `${metadata}\n${input.body}`
    }
  }

  return {
    status: input.status,
    headers: filteredHeaders,
    contentType,
    originalSize,
    content,
  }
}

function filterHeaders(headers: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (USEFUL_HEADERS.includes(key.toLowerCase())) {
      filtered[key.toLowerCase()] = value
    }
  }
  return filtered
}

function getContentType(headers: Record<string, string>): string {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "content-type") {
      // Extract main type, ignore charset etc
      return value.split(";")[0].trim()
    }
  }
  return "unknown"
}

function isBinary(contentType: string): boolean {
  const ct = contentType.toLowerCase()
  return (
    ct.startsWith("image/") ||
    ct.startsWith("video/") ||
    ct.startsWith("audio/") ||
    ct.includes("application/octet-stream") ||
    ct.includes("application/pdf") ||
    ct.includes("application/zip") ||
    ct.includes("application/gzip")
  )
}

function isHtml(contentType: string): boolean {
  return contentType.toLowerCase().includes("text/html")
}

function isJson(contentType: string): boolean {
  const ct = contentType.toLowerCase()
  return ct.includes("application/json") || ct.includes("+json")
}

function isText(contentType: string): boolean {
  const ct = contentType.toLowerCase()
  return ct.startsWith("text/") || ct.includes("xml") || ct.includes("javascript")
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

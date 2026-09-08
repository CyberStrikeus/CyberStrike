// Endpoint normalization: collapse the volatile parts of a path (ids) so that many request
// INSTANCES fold onto one logical ENDPOINT. Without this, rules and the DSL can't group "the same
// endpoint" — and a per-response rule fires once per instance (the 100x server-banner noise we
// saw). `endpointKey(tx)` is the stable identity every corpus-level operation groups by.
import type { Transaction } from "./transaction"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NUMERIC = /^\d+$/
// A long hex/base-ish token (session id, hash, opaque id) — not a UUID but clearly an identifier.
const LONG_TOKEN = /^[0-9a-f]{16,}$/i

// Replace one path segment with a placeholder when it looks like an identifier; keep real names.
function normalizeSegment(seg: string): string {
  if (seg === "") return seg
  if (UUID.test(seg)) return "{uuid}"
  if (NUMERIC.test(seg)) return "{id}"
  if (LONG_TOKEN.test(seg)) return "{hex}"
  return seg
}

export function normalizePath(path: string): string {
  if (!path || path === "/") return "/"
  return path
    .split("/")
    .map(normalizeSegment)
    .join("/")
}

// Pull the pathname out of a request url, tolerating relative or malformed urls.
function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    // relative or malformed — strip query/fragment and use what's left
    const q = url.indexOf("?")
    const h = url.indexOf("#")
    const cut = Math.min(q === -1 ? url.length : q, h === -1 ? url.length : h)
    const p = url.slice(0, cut)
    return p.startsWith("/") ? p : `/${p}`
  }
}

function hostOf(tx: Transaction): string {
  try {
    return new URL(tx.request.url).host.toLowerCase()
  } catch {
    return (tx.host || "").toLowerCase()
  }
}

// The stable logical identity of an endpoint: METHOD + host + normalized path. Host is included so
// two hosts' `/api/users/{id}` don't collide (cross-tenant / multi-service targets).
export function endpointKey(tx: Transaction): string {
  return `${tx.request.method.toUpperCase()} ${hostOf(tx)}${normalizePath(pathOf(tx.request.url))}`
}

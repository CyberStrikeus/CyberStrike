// GraphQL awareness. GraphQL rides over HTTP as a JSON body ({query, operationName, variables}) or
// a ?query= on GET, but it's a distinct surface: authz is per-resolver, injection lives in the
// query/variables. Surfacing it structurally lets rules/HTTPQL target the operation and its
// variables instead of treating the whole thing as an opaque JSON blob.
import type { Transaction } from "./transaction"
import { header } from "./transaction"

export interface GraphQL {
  operationName?: string
  query: string
  variables: Record<string, unknown>
}

// Return the GraphQL operation if this request looks like one, else undefined. Handles a JSON POST
// body and a ?query= GET.
export function graphql(tx: Transaction): GraphQL | undefined {
  const body = tx.request.body
  const ct = (header(tx.request.headers, "content-type") ?? "").toLowerCase()
  if (body && (ct.includes("application/json") || (body.trim().startsWith("{") && body.includes('"query"')))) {
    try {
      const parsed = JSON.parse(body) as { query?: unknown; operationName?: unknown; variables?: unknown }
      if (typeof parsed.query === "string" && /^\s*\{|\b(?:query|mutation|subscription)\b/.test(parsed.query)) {
        return {
          query: parsed.query,
          operationName: typeof parsed.operationName === "string" ? parsed.operationName : undefined,
          variables: parsed.variables && typeof parsed.variables === "object" ? (parsed.variables as Record<string, unknown>) : {},
        }
      }
    } catch {
      return undefined
    }
    return undefined
  }
  // GET ?query=
  try {
    const q = new URL(tx.request.url).searchParams.get("query")
    if (q && /^\s*\{|\b(?:query|mutation|subscription)\b/.test(q)) {
      const varsRaw = new URL(tx.request.url).searchParams.get("variables")
      let variables: Record<string, unknown> = {}
      if (varsRaw) {
        try {
          const v = JSON.parse(varsRaw)
          if (v && typeof v === "object") variables = v as Record<string, unknown>
        } catch {}
      }
      return { query: q, operationName: new URL(tx.request.url).searchParams.get("operationName") ?? undefined, variables }
    }
  } catch {}
  return undefined
}

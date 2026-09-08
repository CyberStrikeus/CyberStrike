// The field model — the shared VOCABULARY that resolves a dotted path (resp.status, req.header.x,
// req.query.q, raw, tech, tls.version, …) against a Transaction to a scalar. One field vocabulary
// for everything above it: the DSL expression engine (expr.ts) reads fields as variables, and the
// declarative rule layer interpolates `{field}` templates through the SAME resolver. Kept in its own
// module so the query/rule engine and the template layer share exactly one definition of "a field".
import type { Transaction, Header } from "./transaction"
import { header } from "./transaction"
import { params, responseFields, requestBodyKind, responseBodyKind } from "./params"
import { endpointKey, normalizePath } from "./endpoint"
import { contentType } from "./scope"
import { requestCookies, responseCookies } from "./cookies"
import { graphql } from "./graphql"

// Resolve a dotted field path against a transaction to a scalar (or undefined when absent).
export function fieldValue(tx: Transaction, field: string): string | number | undefined {
  const parts = field.split(".")
  const head = parts[0]
  const rest = parts.slice(1).join(".")
  if (head === "host") return tx.host
  if (head === "identity") return tx.identity
  if (head === "source") return tx.source
  if (head === "endpoint") return endpointKey(tx)
  if (head === "tech") return (tx.tech ?? []).join(",") // extractor-attached markers; regex(\"spring\", tech)
  if (head === "httpVersion") return tx.httpVersion
  if (head === "timeMs") return tx.timing?.ms
  if (head === "tls") {
    if (parts[1] === "version") return tx.tls?.version
    if (parts[1] === "cipher") return tx.tls?.cipher
    return undefined
  }
  if (head === "raw") return rawRequest(tx) + (tx.response ? "\n\n" + rawResponse(tx) : "") // grep everywhere
  if (head === "req") {
    if (rest === "method") return tx.request.method
    if (rest === "url") return tx.request.url
    if (rest === "path") return normalizePath(safePath(tx.request.url))
    if (rest === "body") return tx.request.body
    if (rest === "raw") return rawRequest(tx) // full request text: line + all headers + body
    if (rest === "header") return allHeaders(tx.request.headers) // ALL headers (grep across header names/values)
    if (rest.startsWith("header.")) return header(tx.request.headers, rest.slice("header.".length))
    if (rest.startsWith("query.")) return params(tx).query[rest.slice("query.".length)]
    if (rest.startsWith("body.")) return params(tx).body[rest.slice("body.".length)]
    if (rest.startsWith("cookie.")) return requestCookies(tx)[rest.slice("cookie.".length)]
    if (rest === "graphql.op") return graphql(tx)?.operationName
    if (rest === "graphql.query") return graphql(tx)?.query
    if (rest === "bodyKind") return requestBodyKind(tx)
    return undefined
  }
  if (head === "resp") {
    if (!tx.response) return undefined
    if (rest === "status") return tx.response.status
    if (rest === "body") return tx.response.body
    if (rest === "contentType") return contentType(tx)
    if (rest === "bodyKind") return responseBodyKind(tx)
    if (rest === "raw") return rawResponse(tx) // full response text: status line + all headers + body
    if (rest === "header") return allHeaders(tx.response.headers) // ALL headers
    if (rest.startsWith("body.")) return responseFields(tx)[rest.slice("body.".length)]
    if (rest.startsWith("header.")) return header(tx.response.headers, rest.slice("header.".length))
    if (rest.startsWith("cookie.")) {
      const want = rest.slice("cookie.".length).toLowerCase()
      return responseCookies(tx).find((c) => c.name.toLowerCase() === want)?.value
    }
    return undefined
  }
  return undefined
}

// Raw-message reconstruction for the grep-everywhere fields (raw / req.raw / resp.raw). Not
// byte-exact wire format — a searchable text join of line + headers + body, which is what a
// contains/regex grep needs. Built lazily (only when an expression touches these fields), so the
// common structured-field lookup pays nothing.
function allHeaders(headers: Header[]): string {
  return headers.map((h) => `${h.name}: ${h.value}`).join("\n")
}
function rawRequest(tx: Transaction): string {
  const head = `${tx.request.method} ${tx.request.url}\n${allHeaders(tx.request.headers)}`
  return tx.request.body ? `${head}\n\n${tx.request.body}` : head
}
function rawResponse(tx: Transaction): string {
  if (!tx.response) return ""
  const head = `${tx.response.status}\n${allHeaders(tx.response.headers)}`
  return tx.response.body ? `${head}\n\n${tx.response.body}` : head
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    const q = url.indexOf("?")
    return q === -1 ? url : url.slice(0, q)
  }
}

// The grep-everywhere fields — a broad, inherently-noisy full-text scan. Powerful for WE-authored
// rules, but a FOOTGUN in an agent's hand: told they exist, an agent defaults to grepping `raw` on
// every query and every result becomes a noisy scan, defeating the structured fields. So the agent
// scope disables them (see expr.ts `grep: false`). WE-authored rules keep them (full scope).
export const GREP_FIELDS = new Set(["raw", "req.raw", "resp.raw", "req.header", "resp.header"])

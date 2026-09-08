// HTTPQL-lite — a small query language over the traffic corpus, so you can pull "the requests that
// match this shape" out of thousands without writing TypeScript. Two consumers: an agent tool
// ("query the captured corpus") and declarative rules. Inspired by Caido's HTTPQL, deliberately a
// pragmatic SUBSET (field/operator/value atoms + AND/OR + parens), not a full grammar.
//
// Grammar:
//   query := or
//   or    := and ("OR" and)*
//   and   := unary ("AND" unary)*
//   unary := "NOT" unary | term
//   term  := "(" or ")" | atom
//   atom  := field op value
//   field := dotted path, e.g. resp.status | req.header.content-type | req.body.params.staff_name
//   op    := ":" (eq) | "!=" (ne) | ":~" or "~" (regex, case-insensitive) | ">" | "<" | ">=" | "<="
//   value := "double quoted" | bareword     (the value "*" with ":" means EXISTS: `field:*`)
//
// Examples:
//   resp.status:500
//   resp.status>=500 AND req.method:POST
//   resp.header.server:~uvicorn OR resp.body:~"SQL syntax"
//   req.body.params.staff_name:~"'"
import type { Transaction } from "./transaction"
import { header } from "./transaction"
import { params, responseFields, requestBodyKind, responseBodyKind } from "./params"
import { endpointKey, normalizePath } from "./endpoint"
import { contentType } from "./scope"
import { requestCookies, responseCookies } from "./cookies"
import { graphql } from "./graphql"

export class QueryError extends Error {}

type Op = ":" | "!=" | ":~" | "~" | ">" | "<" | ">=" | "<="
type Atom = { type: "atom"; field: string; op: Op; value: string }
type Node =
  | Atom
  | { type: "and"; left: Node; right: Node }
  | { type: "or"; left: Node; right: Node }
  | { type: "not"; child: Node }

// --- tokenizer -------------------------------------------------------------
type Token = { t: "(" } | { t: ")" } | { t: "AND" } | { t: "OR" } | { t: "NOT" } | ({ t: "atom" } & Omit<Atom, "type">)

// Longest first so multi-char ops win: ":~"/">=" before ":"/">", etc.
const OPS: Op[] = [":~", ">=", "<=", "!=", ":", "~", ">", "<"]
const FIELD_CHAR = /[A-Za-z0-9_.\-]/

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const len = input.length
  const skipWs = () => {
    while (i < len && /\s/.test(input[i]!)) i++
  }
  while (i < len) {
    skipWs()
    if (i >= len) break
    const c = input[i]!
    if (c === "(" || c === ")") {
      tokens.push({ t: c })
      i++
      continue
    }
    // read a field/keyword word
    const start = i
    while (i < len && FIELD_CHAR.test(input[i]!)) i++
    const word = input.slice(start, i)
    if (word === "") throw new QueryError(`Unexpected character "${c}" at ${i}`)
    skipWs()
    // AND / OR keyword — not followed by an operator
    const upper = word.toUpperCase()
    const opAhead = OPS.find((op) => input.startsWith(op, i))
    if (!opAhead) {
      if (upper === "AND" || upper === "OR" || upper === "NOT") {
        tokens.push({ t: upper })
        continue
      }
      throw new QueryError(`Expected an operator after "${word}"`)
    }
    i += opAhead.length
    skipWs()
    // value: quoted (may contain spaces) or bareword
    let value: string
    if (input[i] === '"') {
      i++
      const vs = i
      while (i < len && input[i] !== '"') i++
      if (i >= len) throw new QueryError("Unterminated quoted value")
      value = input.slice(vs, i)
      i++
    } else {
      const vs = i
      while (i < len && !/\s/.test(input[i]!) && input[i] !== "(" && input[i] !== ")") i++
      value = input.slice(vs, i)
    }
    if (value === "") throw new QueryError(`Missing value for "${word}"`)
    tokens.push({ t: "atom", field: word, op: opAhead, value })
  }
  return tokens
}

// --- parser (recursive descent) --------------------------------------------
function parse(input: string): Node {
  const tokens = tokenize(input)
  let pos = 0
  const peek = () => tokens[pos]
  const eat = () => tokens[pos++]

  function parseOr(): Node {
    let left = parseAnd()
    while (peek()?.t === "OR") {
      eat()
      left = { type: "or", left, right: parseAnd() }
    }
    return left
  }
  function parseAnd(): Node {
    let left = parseUnary()
    while (peek()?.t === "AND") {
      eat()
      left = { type: "and", left, right: parseUnary() }
    }
    return left
  }
  function parseUnary(): Node {
    if (peek()?.t === "NOT") {
      eat()
      return { type: "not", child: parseUnary() }
    }
    return parseTerm()
  }
  function parseTerm(): Node {
    const tok = peek()
    if (!tok) throw new QueryError("Unexpected end of query")
    if (tok.t === "(") {
      eat()
      const inner = parseOr()
      const close = eat()
      if (!close || close.t !== ")") throw new QueryError("Expected )")
      return inner
    }
    if (tok.t === "atom") {
      eat()
      return { type: "atom", field: tok.field, op: tok.op, value: tok.value }
    }
    throw new QueryError(`Unexpected token "${tok.t}"`)
  }

  if (tokens.length === 0) throw new QueryError("Empty query")
  const node = parseOr()
  if (pos !== tokens.length) throw new QueryError("Trailing tokens after a complete query")
  return node
}

// --- field resolution ------------------------------------------------------
// Resolve a dotted field path against a transaction to a scalar (or undefined when absent).
function resolveField(tx: Transaction, field: string): string | number | undefined {
  const parts = field.split(".")
  const head = parts[0]
  const rest = parts.slice(1).join(".")
  if (head === "host") return tx.host
  if (head === "identity") return tx.identity
  if (head === "source") return tx.source
  if (head === "endpoint") return endpointKey(tx)
  if (head === "tech") return (tx.tech ?? []).join(",") // extractor-attached markers; `tech:~spring`
  if (head === "httpVersion") return tx.httpVersion
  if (head === "timeMs") return tx.timing?.ms
  if (head === "tls") {
    if (parts[1] === "version") return tx.tls?.version
    if (parts[1] === "cipher") return tx.tls?.cipher
    return undefined
  }
  if (head === "req") {
    if (rest === "method") return tx.request.method
    if (rest === "url") return tx.request.url
    if (rest === "path") return normalizePath(safePath(tx.request.url))
    if (rest === "body") return tx.request.body
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

function safePath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    const q = url.indexOf("?")
    return q === -1 ? url : url.slice(0, q)
  }
}

// Resolve one field path against a transaction to its scalar value (or undefined). Exposed so the
// declarative-rule layer can interpolate `{field}` templates using the SAME field vocabulary as
// HTTPQL queries — one field model for both.
export function fieldValue(tx: Transaction, field: string): string | number | undefined {
  return resolveField(tx, field)
}

// --- evaluation ------------------------------------------------------------
function applyOp(actual: string | number | undefined, op: Op, value: string): boolean {
  // Presence check: `field:*` matches when the field has a non-empty value. (A literal "*" is
  // essentially never a value to match; use a regex if you truly need one.)
  if (op === ":" && value === "*") return actual !== undefined && String(actual) !== ""
  if (op === "~" || op === ":~") {
    let re: RegExp
    try {
      re = new RegExp(value, "i")
    } catch {
      throw new QueryError(`Invalid regex: ${value}`)
    }
    return re.test(String(actual ?? ""))
  }
  if (op === ":" || op === "!=") {
    const eq =
      typeof actual === "number" ? String(actual) === value || actual === Number(value) : String(actual ?? "").toLowerCase() === value.toLowerCase()
    return op === ":" ? eq : !eq
  }
  // numeric comparisons
  const a = typeof actual === "number" ? actual : Number(actual)
  const b = Number(value)
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  if (op === ">") return a > b
  if (op === "<") return a < b
  if (op === ">=") return a >= b
  return a <= b // "<="
}

function evalNode(node: Node, tx: Transaction): boolean {
  if (node.type === "and") return evalNode(node.left, tx) && evalNode(node.right, tx)
  if (node.type === "or") return evalNode(node.left, tx) || evalNode(node.right, tx)
  if (node.type === "not") return !evalNode(node.child, tx)
  return applyOp(resolveField(tx, node.field), node.op, node.value)
}

// A compiled query: parse once, run over many transactions.
export interface CompiledQuery {
  test(tx: Transaction): boolean
  filter(txs: Transaction[]): Transaction[]
}

export function compile(query: string): CompiledQuery {
  const ast = parse(query)
  return {
    test: (tx) => evalNode(ast, tx),
    filter: (txs) => txs.filter((tx) => evalNode(ast, tx)),
  }
}

// Convenience: run a query string over a set of transactions.
export function query(txs: Transaction[], queryString: string): Transaction[] {
  return compile(queryString).filter(txs)
}

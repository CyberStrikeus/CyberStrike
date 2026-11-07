// HTTPQL — the AGENT's query interface over the traffic DB. Distinct from the DSL engine (expr.ts):
// the DSL is OUR rule/matcher language (functions, active probing, chains → signals); HTTPQL is what
// we hand the AGENT to pull related requests/responses/params out of the corpus. It is a pure SELECT
// language — field/operator/value atoms + AND/OR/NOT + parens, a bounded `:~` regex operator, but NO
// function library — so an agent can't write a ReDoS/probing expression, only filter rows. (The DSL,
// made agent-safe, has to BAN regex() for ReDoS, which cripples the exact searches an agent needs —
// find a leaked JWT, find a SQL error; HTTPQL's `:~` gives that as a safe operator. That's the split.)
// Inspired by Caido's HTTPQL. Aggregate/relational lookups over objects/functions are the inventory
// getters; HTTPQL is the per-request SELECT.
//
// Grammar:
//   query := or
//   or    := and ("OR" and)*
//   and   := unary ("AND" unary)*
//   unary := "NOT" unary | term
//   term  := "(" or ")" | atom
//   atom  := field op value
//   field := dotted path, e.g. resp.status | req.header.content-type | req.body.params.staff_name
//            grep-everywhere: `raw` (whole request+response text), `req.raw`, `resp.raw`, or bare
//            `req.header`/`resp.header` (all headers) — for "find X wherever it is" in one atom
//   op    := ":" (eq) | "!=" (ne) | ":~" or "~" (regex, case-insensitive) | "~=" (literal contains,
//            case-insensitive — no regex metachar escaping) | ">" | "<" | ">=" | "<="
//   value := "double quoted" | bareword     (the value "*" with ":" means EXISTS: `field:*`)
//
// Examples:
//   resp.status:500
//   resp.status>=500 AND req.method:POST
//   resp.header.server:~uvicorn OR resp.body:~"SQL syntax"
//   req.body.params.staff_name:~"'"
import type { Transaction } from "./transaction"
import { fieldValue, GREP_FIELDS } from "./fields"

export class QueryError extends Error {}

type Op = ":" | "!=" | ":~" | "~" | "~=" | ">" | "<" | ">=" | "<="
type Atom = { type: "atom"; field: string; op: Op; value: string; re?: RegExp }
type Node =
  | Atom
  | { type: "and"; left: Node; right: Node }
  | { type: "or"; left: Node; right: Node }
  | { type: "not"; child: Node }

// --- tokenizer -------------------------------------------------------------
type Token = { t: "(" } | { t: ")" } | { t: "AND" } | { t: "OR" } | { t: "NOT" } | ({ t: "atom" } & Omit<Atom, "type">)

// Longest first so multi-char ops win: ":~"/"~="/">=" before ":"/"~"/">", etc.
const OPS: Op[] = [":~", "~=", ">=", "<=", "!=", ":", "~", ">", "<"]
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
      let depth = 0
      while (i < len && (!/\s/.test(input[i]!) || depth > 0)) {
        if (input[i] === "(") depth++
        else if (input[i] === ")") {
          if (depth === 0) break
          depth--
        }
        i++
      }
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
      // Compile the regex ONCE here (parse time), not per-transaction in applyOp.
      let re: RegExp | undefined
      if (tok.op === "~" || tok.op === ":~") {
        // Strip PCRE inline flags (e.g. (?i)) — JS doesn't support them and :~ already applies "i".
        const pattern = tok.value.replace(/^\(\?[imsx]+\)/, "")
        try {
          re = new RegExp(pattern, "i")
        } catch {
          throw new QueryError(`Invalid regex: ${tok.value}`)
        }
      }
      return { type: "atom", field: tok.field, op: tok.op, value: tok.value, re }
    }
    throw new QueryError(`Unexpected token "${tok.t}"`)
  }

  if (tokens.length === 0) throw new QueryError("Empty query")
  const node = parseOr()
  if (pos !== tokens.length) throw new QueryError("Trailing tokens after a complete query")
  return node
}

// --- evaluation ------------------------------------------------------------
function applyOp(actual: string | number | undefined, op: Op, value: string, re?: RegExp): boolean {
  // Presence check: `field:*` matches when the field has a non-empty value. (A literal "*" is
  // essentially never a value to match; use a regex if you truly need one.)
  if (op === ":" && value === "*") return actual !== undefined && String(actual) !== ""
  if (op === "~" || op === ":~") return re!.test(String(actual ?? "")) // re precompiled at parse time
  // Literal substring, case-insensitive — no regex metachar escaping (safe for '../', '$1.00', etc.)
  if (op === "~=") return String(actual ?? "").toLowerCase().includes(value.toLowerCase())
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
  return applyOp(fieldValue(tx, node.field), node.op, node.value, node.re)
}

function firstGrepField(node: Node): string | undefined {
  if (node.type === "atom") return GREP_FIELDS.has(node.field) ? node.field : undefined
  if (node.type === "not") return firstGrepField(node.child)
  return firstGrepField(node.left) ?? firstGrepField(node.right)
}

export interface CompileOptions {
  // `grep: false` = AGENT scope: reject the grep-everywhere fields so an agent can't lazily full-text
  // scan; it must name where it expects the value (or use a dedicated locate tool). Default (rules,
  // WE-authored code) allows them.
  grep?: boolean
}

// A compiled query: parse once, run over many transactions.
export interface CompiledQuery {
  test(tx: Transaction): boolean
  filter(txs: Transaction[]): Transaction[]
}

export function compile(query: string, opts: CompileOptions = {}): CompiledQuery {
  const ast = parse(query)
  if (opts.grep === false) {
    const g = firstGrepField(ast)
    if (g)
      throw new QueryError(
        `Field "${g}" is a broad full-text grep, disabled here. Name where you expect the value: req.query.<name>, req.body.<dotpath>, req.header.<name>, resp.body, resp.header.<name>.`,
      )
  }
  return {
    test: (tx) => evalNode(ast, tx),
    filter: (txs) => txs.filter((tx) => evalNode(ast, tx)),
  }
}

// Convenience: run a query string over a set of transactions. Pass { grep: false } for agent scope.
export function query(txs: Transaction[], queryString: string, opts?: CompileOptions): Transaction[] {
  return compile(queryString, opts).filter(txs)
}

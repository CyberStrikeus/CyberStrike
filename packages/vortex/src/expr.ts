// The DSL engine — Vortex's ONE predicate language, for both agent queries and rule conditions.
// Inspired by projectdiscovery/dsl (Nuclei): a small expression language whose power is a FUNCTION
// LIBRARY over the transaction, so a rule is expressive DATA (decode, hash, version-compare, len,
// regex) — the interesting half of detection that a plain field:op:value query can't express.
//
// It is NOT a second language beside HTTPQL — it SUBSUMES it. The field vocabulary (fields.ts) is
// the variable set; `resp.status == 500` is what `resp.status:500` used to be; and now you can also
// write `compare_versions(resp.header.server, "< 2.4.50")` or
// `contains(base64_decode(jwt_payload(req.header.authorization)), "\"alg\":\"none\"")`.
//
// Grammar (low→high precedence):
//   expr    := or
//   or      := and ("||" and)*
//   and     := not ("&&" not)*
//   not     := "!" not | comparison
//   compare := add (("=="|"!="|">="|"<="|">"|"<") add)?
//   add     := mul (("+"|"-") mul)*
//   mul     := unary (("*"|"/") unary)*
//   unary   := "-" unary | postfix
//   postfix := primary ("[" expr "]")*
//   primary := number | string | bool | null | funccall | field | "(" expr ")"
//   funccall:= ident "(" (expr ("," expr)*)? ")"
//   field   := ident ("." ident)*        // resolved through fieldValue (fields.ts)
//
// Two consumers, one engine:
//   - Agent query  : compile(src, { grep: false }) — the raw grep fields are rejected (footgun).
//   - Rule / matcher: compile(src)                 — full scope, WE-authored.
import type { Transaction } from "./transaction"
import { fieldValue, GREP_FIELDS } from "./fields"
import { headerAll } from "./transaction"
import { createHash } from "node:crypto"

export class ExprError extends Error {}

// The values an expression evaluates to. `undefined` = an absent field. Arrays come from split().
export type Value = string | number | boolean | undefined | Value[]

// --- values / coercion ------------------------------------------------------
function truthy(v: Value): boolean {
  if (v === undefined || v === null || v === false) return false
  if (v === 0 || v === "") return false
  if (Array.isArray(v)) return v.length > 0
  return true
}
function str(v: Value): string {
  return v === undefined ? "" : Array.isArray(v) ? v.map(str).join(",") : String(v)
}
function num(v: Value): number {
  return typeof v === "number" ? v : Number(str(v))
}
function eq(a: Value, b: Value): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b
  if (typeof a === "boolean" || typeof b === "boolean") return a === b
  return str(a) === str(b)
}

// --- function library -------------------------------------------------------
// Each function receives the evaluated argument values (and the transaction, for the few that need
// header lists). Unknown names are rejected at PARSE time, so a rule can't call into anything else.
type Fn = (args: Value[], tx: Transaction) => Value

// ReDoS defense. The real fix for UNTRUSTED expressions is that `regex()` is full-scope-only —
// agent scope (grep:false) rejects it (see FULL_SCOPE_ONLY), so an agent can't supply a
// catastrophic pattern; it uses the linear `contains`/`icontains` instead. For WE-authored rules the
// pattern is trusted, and these two caps are hygiene/defense-in-depth: JS regex is synchronous with
// no timeout, so we bound both the pattern and the subject rather than pretend to detect every ReDoS
// shape (a full guarantee would need RE2 or a worker timeout — out of scope here).
const MAX_PATTERN = 2000 // reject an absurdly long authored pattern
const MAX_SUBJECT = 1_000_000 // only scan the first 1MB of a value (a match past it is missed — safety trade)
const reCache = new Map<string, RegExp>()
function rx(pattern: string): RegExp {
  if (pattern.length > MAX_PATTERN) throw new ExprError(`regex pattern too long (${pattern.length} > ${MAX_PATTERN})`)
  let re = reCache.get(pattern)
  if (!re) {
    try {
      re = new RegExp(pattern, "i")
    } catch {
      throw new ExprError(`Invalid regex: ${pattern}`)
    }
    reCache.set(pattern, re)
  }
  return re
}
function runRegex(pattern: string, subject: string): boolean {
  return rx(pattern).test(subject.length > MAX_SUBJECT ? subject.slice(0, MAX_SUBJECT) : subject)
}

// base64url (JWT) → utf8, tolerant of missing padding and -_ alphabet.
function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")
  try {
    return Buffer.from(b64, "base64").toString("utf8")
  } catch {
    return ""
  }
}
function bearerToken(s: string): string {
  const t = s.startsWith("Bearer ") || s.startsWith("bearer ") ? s.slice(7) : s
  return t.trim()
}
// Parse a "OP version" constraint ("< 2.4.50", ">= 1.2", "== 3.0") and compare it to `actual`,
// from which the first dotted-number run is extracted (so "Apache/2.4.49" works).
function compareVersions(actual: string, constraint: string): boolean {
  const m = constraint.trim().match(/^(<=|>=|==|!=|<|>)\s*(.+)$/)
  if (!m) return false
  const op = m[1]!
  const want = m[2]!.trim()
  const found = actual.match(/\d+(?:\.\d+)+/)
  if (!found) return false
  const cmp = cmpSemver(found[0], want)
  if (op === "==") return cmp === 0
  if (op === "!=") return cmp !== 0
  if (op === "<") return cmp < 0
  if (op === "<=") return cmp <= 0
  if (op === ">") return cmp > 0
  return cmp >= 0 // ">="
}
function cmpSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

const FUNCTIONS: Record<string, Fn> = {
  contains: (a) => str(a[0]).includes(str(a[1])),
  icontains: (a) => str(a[0]).toLowerCase().includes(str(a[1]).toLowerCase()),
  starts_with: (a) => str(a[0]).startsWith(str(a[1])),
  ends_with: (a) => str(a[0]).endsWith(str(a[1])),
  regex: (a) => runRegex(str(a[0]), str(a[1])), // regex(pattern, subject) — case-insensitive, capped subject
  len: (a) => (Array.isArray(a[0]) ? a[0].length : str(a[0]).length),
  lower: (a) => str(a[0]).toLowerCase(),
  upper: (a) => str(a[0]).toUpperCase(),
  trim: (a) => str(a[0]).trim(),
  split: (a) => str(a[0]).split(str(a[1])),
  replace: (a) => str(a[0]).split(str(a[1])).join(str(a[2])),
  base64_decode: (a) => {
    try {
      return Buffer.from(str(a[0]), "base64").toString("utf8")
    } catch {
      return ""
    }
  },
  url_decode: (a) => {
    try {
      return decodeURIComponent(str(a[0]))
    } catch {
      return ""
    }
  },
  hex_decode: (a) => {
    try {
      return Buffer.from(str(a[0]), "hex").toString("utf8")
    } catch {
      return ""
    }
  },
  md5: (a) => createHash("md5").update(str(a[0])).digest("hex"),
  sha256: (a) => createHash("sha256").update(str(a[0])).digest("hex"),
  compare_versions: (a) => compareVersions(str(a[0]), str(a[1])),
  is_json: (a) => {
    try {
      JSON.parse(str(a[0]))
      return true
    } catch {
      return false
    }
  },
  // JWT helpers — accept a raw token or a full "Bearer <jwt>" header value.
  jwt_header: (a) => b64urlDecode(bearerToken(str(a[0])).split(".")[0] ?? ""),
  jwt_payload: (a) => b64urlDecode(bearerToken(str(a[0])).split(".")[1] ?? ""),
  jwt_alg: (a) => {
    try {
      return String(JSON.parse(b64urlDecode(bearerToken(str(a[0])).split(".")[0] ?? "")).alg ?? "")
    } catch {
      return ""
    }
  },
  // Count how many times a header appears — needs the raw list, so it takes ("req"|"resp", name).
  count_header: (a, tx) => {
    const which = str(a[0]).toLowerCase()
    const headers = which === "resp" ? (tx.response?.headers ?? []) : tx.request.headers
    return headerAll(headers, str(a[1])).length
  },
}

// --- AST --------------------------------------------------------------------
type Node =
  | { k: "lit"; v: Value }
  | { k: "field"; path: string }
  | { k: "call"; name: string; args: Node[] }
  | { k: "index"; target: Node; index: Node }
  | { k: "unary"; op: "!" | "-"; e: Node }
  | { k: "bin"; op: string; l: Node; r: Node }

// --- tokenizer --------------------------------------------------------------
type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ident"; v: string }
  | { t: "op"; v: string }
  | { t: "("; }
  | { t: ")"; }
  | { t: "["; }
  | { t: "]"; }
  | { t: ","; }

const MULTI_OPS = ["==", "!=", ">=", "<=", "&&", "||"]
const SINGLE_OPS = ["!", ">", "<", "+", "-", "*", "/"]
const IDENT_START = /[A-Za-z_]/
// Hyphen is allowed INSIDE an identifier so header field paths work (resp.header.content-type,
// x-frame-options). A leading "-" is still unary minus, and subtraction needs surrounding space
// (`len(x) - 1`); `a-b` with no spaces reads as one identifier — an acceptable trade for header names.
const IDENT_CHAR = /[A-Za-z0-9_.\-]/

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]!
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === "(" || c === ")" || c === "[" || c === "]" || c === ",") {
      out.push({ t: c } as Tok)
      i++
      continue
    }
    if (c === '"' || c === "'") {
      const quote = c
      i++
      let s = ""
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < n) {
          const nx = src[i + 1]!
          // Recognized escapes only; ANY other \x is preserved verbatim (backslash kept) so regex
          // metacharacters — \w \d \s \. \( — survive into regex()/patterns.
          if (nx === "n") s += "\n"
          else if (nx === "t") s += "\t"
          else if (nx === "r") s += "\r"
          else if (nx === "\\" || nx === '"' || nx === "'") s += nx
          else s += "\\" + nx
          i += 2
          continue
        }
        s += src[i]
        i++
      }
      if (i >= n) throw new ExprError("Unterminated string")
      i++ // closing quote
      out.push({ t: "str", v: s })
      continue
    }
    if (/[0-9]/.test(c)) {
      const start = i
      while (i < n && /[0-9.]/.test(src[i]!)) i++
      out.push({ t: "num", v: Number(src.slice(start, i)) })
      continue
    }
    if (IDENT_START.test(c)) {
      const start = i
      while (i < n && IDENT_CHAR.test(src[i]!)) i++
      out.push({ t: "ident", v: src.slice(start, i) })
      continue
    }
    const two = src.slice(i, i + 2)
    if (MULTI_OPS.includes(two)) {
      out.push({ t: "op", v: two })
      i += 2
      continue
    }
    if (SINGLE_OPS.includes(c)) {
      out.push({ t: "op", v: c })
      i++
      continue
    }
    throw new ExprError(`Unexpected character "${c}" at ${i}`)
  }
  return out
}

// --- parser (recursive descent) ---------------------------------------------
function parse(src: string): Node {
  const toks = tokenize(src)
  let pos = 0
  const peek = () => toks[pos]
  const next = () => toks[pos++]
  const expect = (t: string) => {
    const tk = next()
    if (!tk || tk.t !== t) throw new ExprError(`Expected "${t}"`)
    return tk
  }
  const isOp = (v: string) => {
    const tk = peek()
    return tk && tk.t === "op" && tk.v === v
  }

  function parseOr(): Node {
    let l = parseAnd()
    while (isOp("||")) {
      next()
      l = { k: "bin", op: "||", l, r: parseAnd() }
    }
    return l
  }
  function parseAnd(): Node {
    let l = parseNot()
    while (isOp("&&")) {
      next()
      l = { k: "bin", op: "&&", l, r: parseNot() }
    }
    return l
  }
  function parseNot(): Node {
    if (isOp("!")) {
      next()
      return { k: "unary", op: "!", e: parseNot() }
    }
    return parseCompare()
  }
  function parseCompare(): Node {
    let l = parseAdd()
    const tk = peek()
    if (tk && tk.t === "op" && ["==", "!=", ">=", "<=", ">", "<"].includes(tk.v)) {
      next()
      l = { k: "bin", op: tk.v, l, r: parseAdd() }
    }
    return l
  }
  function parseAdd(): Node {
    let l = parseMul()
    while (isOp("+") || isOp("-")) {
      const op = (next() as { v: string }).v
      l = { k: "bin", op, l, r: parseMul() }
    }
    return l
  }
  function parseMul(): Node {
    let l = parseUnary()
    while (isOp("*") || isOp("/")) {
      const op = (next() as { v: string }).v
      l = { k: "bin", op, l, r: parseUnary() }
    }
    return l
  }
  function parseUnary(): Node {
    if (isOp("-")) {
      next()
      return { k: "unary", op: "-", e: parseUnary() }
    }
    return parsePostfix()
  }
  function parsePostfix(): Node {
    let e = parsePrimary()
    while (peek()?.t === "[") {
      next()
      const index = parseOr()
      expect("]")
      e = { k: "index", target: e, index }
    }
    return e
  }
  function parsePrimary(): Node {
    const tk = peek()
    if (!tk) throw new ExprError("Unexpected end of expression")
    if (tk.t === "num") {
      next()
      return { k: "lit", v: tk.v }
    }
    if (tk.t === "str") {
      next()
      return { k: "lit", v: tk.v }
    }
    if (tk.t === "(") {
      next()
      const inner = parseOr()
      expect(")")
      return inner
    }
    if (tk.t === "ident") {
      next()
      const name = tk.v
      // function call — single-segment ident immediately followed by "("
      if (peek()?.t === "(" && !name.includes(".")) {
        if (!FUNCTIONS[name]) throw new ExprError(`Unknown function "${name}"`)
        next() // (
        const args: Node[] = []
        if (peek()?.t !== ")") {
          args.push(parseOr())
          while (peek()?.t === ",") {
            next()
            args.push(parseOr())
          }
        }
        expect(")")
        return { k: "call", name, args }
      }
      if (name === "true") return { k: "lit", v: true }
      if (name === "false") return { k: "lit", v: false }
      if (name === "null") return { k: "lit", v: undefined }
      return { k: "field", path: name }
    }
    throw new ExprError(`Unexpected token`)
  }

  if (toks.length === 0) throw new ExprError("Empty expression")
  const node = parseOr()
  if (pos !== toks.length) throw new ExprError("Trailing tokens after a complete expression")
  return node
}

// --- evaluation -------------------------------------------------------------
function evalNode(node: Node, tx: Transaction): Value {
  if (node.k === "lit") return node.v
  if (node.k === "field") return fieldValue(tx, node.path)
  if (node.k === "call") return FUNCTIONS[node.name]!(node.args.map((a) => evalNode(a, tx)), tx)
  if (node.k === "index") {
    const target = evalNode(node.target, tx)
    const i = num(evalNode(node.index, tx))
    if (Array.isArray(target)) return target[i]
    return str(target)[i]
  }
  if (node.k === "unary") {
    if (node.op === "!") return !truthy(evalNode(node.e, tx))
    return -num(evalNode(node.e, tx))
  }
  // binary
  if (node.op === "&&") return truthy(evalNode(node.l, tx)) && truthy(evalNode(node.r, tx))
  if (node.op === "||") return truthy(evalNode(node.l, tx)) || truthy(evalNode(node.r, tx))
  const l = evalNode(node.l, tx)
  const r = evalNode(node.r, tx)
  if (node.op === "==") return eq(l, r)
  if (node.op === "!=") return !eq(l, r)
  if (node.op === "+") return typeof l === "number" && typeof r === "number" ? l + r : str(l) + str(r)
  if (node.op === "-") return num(l) - num(r)
  if (node.op === "*") return num(l) * num(r)
  if (node.op === "/") return num(l) / num(r)
  // ordered comparisons — numeric; NaN (non-numeric) never matches
  const a = num(l)
  const b = num(r)
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  if (node.op === ">") return a > b
  if (node.op === "<") return a < b
  if (node.op === ">=") return a >= b
  return a <= b // "<="
}

// --- agent-scope gate -------------------------------------------------------
// Functions an agent (grep:false) may NOT call. `regex` is the untrusted-ReDoS surface — an agent
// uses the linear `contains`/`icontains` instead; WE-authored rules keep regex in full scope.
const FULL_SCOPE_ONLY = new Set(["regex"])

// First thing that makes an expression full-scope-only: a grep-everywhere field, or a restricted
// function call (checked by name, then recursively through args/operands).
function firstRestricted(node: Node): string | undefined {
  if (node.k === "field") return GREP_FIELDS.has(node.path) ? node.path : undefined
  if (node.k === "lit") return undefined
  if (node.k === "call") return FULL_SCOPE_ONLY.has(node.name) ? `${node.name}()` : node.args.map(firstRestricted).find(Boolean)
  if (node.k === "index") return firstRestricted(node.target) ?? firstRestricted(node.index)
  if (node.k === "unary") return firstRestricted(node.e)
  return firstRestricted(node.l) ?? firstRestricted(node.r)
}

// --- public API -------------------------------------------------------------
export interface CompileOptions {
  // `grep: false` = AGENT scope: reject the grep-everywhere fields (raw / req.raw / resp.raw / bare
  // header) so an agent can't lazily full-text scan. WE-authored rules compile in full scope.
  grep?: boolean
}

export interface Compiled {
  eval(tx: Transaction): Value
  test(tx: Transaction): boolean // truthiness of the result — the rule/query predicate
  filter(txs: Transaction[]): Transaction[]
}

export function compile(src: string, opts: CompileOptions = {}): Compiled {
  const ast = parse(src)
  if (opts.grep === false) {
    const g = firstRestricted(ast)
    if (g)
      throw new ExprError(
        `"${g}" is disabled in agent scope. For a field: name where you expect the value (req.query.<name>, req.body.<dotpath>, req.header.<name>, resp.body). Instead of regex() use contains()/icontains() (linear, no ReDoS).`,
      )
  }
  return {
    eval: (tx) => evalNode(ast, tx),
    test: (tx) => truthy(evalNode(ast, tx)),
    filter: (txs) => txs.filter((tx) => truthy(evalNode(ast, tx))),
  }
}

// Convenience: evaluate an expression's truthiness over a set of transactions. `{ grep: false }` for
// agent scope.
export function query(txs: Transaction[], src: string, opts?: CompileOptions): Transaction[] {
  return compile(src, opts).filter(txs)
}

// The registered function names — for docs / an agent-facing capability listing.
export const functionNames: string[] = Object.keys(FUNCTIONS)

// The parsed AST of an expression — exposed so the sound rule pre-filter (precondition.ts) can derive
// which literals a `when` provably requires, without re-implementing the parser. Throws (ExprError) on
// a malformed expression, exactly like compile().
export type ExprNode = Node
export function astOf(src: string): Node {
  return parse(src)
}

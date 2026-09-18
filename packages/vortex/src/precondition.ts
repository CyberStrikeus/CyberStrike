// Sound rule pre-filtering (#40 P2). To run tens of thousands of rules over a transaction without
// evaluating every one, we derive from each rule's `when` a PRECONDITION: a boolean formula over
// "literal L is present in the transaction's raw text". A rule may be skipped for a tx ONLY when its
// precondition is provably unsatisfiable (a required literal is absent). Anything we cannot reason
// about soundly → `unconditional` (fail-open): the rule always runs, so a real match is never missed.
//
// Soundness rests on two invariants:
//   1. Literals are extracted ONLY from `contains`/`icontains`/`regex` over a RAW field (resp.body,
//      headers, req.url/body …) — never a computed value (base64_decode, jwt_payload …), whose literal
//      might not appear in the raw text. Computed subjects → unconditional.
//   2. Any uncertainty (a regex we can't factor, an unknown function, a comparison) → unconditional.
// The runtime haystack scanned for present literals is a SUPERSET of every raw field, so "present in
// haystack" is weaker than "present in the actual subject" — it can only cause a rule to RUN when it
// might not need to (harmless), never to be skipped when it could match.
import type { ExprNode } from "./expr"
import { astOf } from "./expr"

export type Precondition =
  | { kind: "unconditional" }
  | { kind: "any"; literals: string[] } // present ≥1 → may match; none present → provably no match
  | { kind: "all"; parts: Precondition[] } // every part must be satisfiable

export const UNCOND: Precondition = { kind: "unconditional" }
// Shorter literals are too common to prune on (and inflate the scan) — treat as no constraint.
export const MIN_LITERAL = 3

// Derive a sound precondition from a `when` DSL string. Never throws.
export function preconditionOf(when: string): Precondition {
  try {
    return simplify(fromNode(astOf(when)))
  } catch {
    return UNCOND
  }
}

function fromNode(node: ExprNode): Precondition {
  if (node.k === "bin" && node.op === "&&") return simplify({ kind: "all", parts: [fromNode(node.l), fromNode(node.r)] })
  if (node.k === "bin" && node.op === "||") return orCombine(fromNode(node.l), fromNode(node.r))
  if (node.k === "call") {
    const name = node.name.toLowerCase()
    if ((name === "contains" || name === "icontains") && node.args.length === 2) {
      // contains(subject, needle): the needle must appear in the subject.
      const subject = node.args[0]!
      const needle = node.args[1]!
      if (isRawField(subject) && needle.k === "lit" && typeof needle.v === "string" && needle.v.length >= MIN_LITERAL) {
        return { kind: "any", literals: [needle.v.toLowerCase()] }
      }
      return UNCOND
    }
    if (name === "regex" && node.args.length === 2) {
      // regex(pattern, subject): a match requires one of the pattern's per-alternative literal factors.
      const pattern = node.args[0]!
      const subject = node.args[1]!
      if (isRawField(subject) && pattern.k === "lit" && typeof pattern.v === "string") {
        const factors = regexFactors(pattern.v)
        if (factors) return { kind: "any", literals: factors }
      }
      return UNCOND
    }
  }
  // Anything else (comparisons, negation, field/lit alone, other functions) is not a sound literal
  // constraint on its own — fail open.
  return UNCOND
}

// A raw transaction field whose text is present verbatim in the runtime haystack. Computed values
// (function calls, indexing) are NOT raw and must not be indexed.
function isRawField(node: ExprNode): boolean {
  return node.k === "field"
}

function orCombine(a: Precondition, b: Precondition): Precondition {
  // The rule matches if EITHER side can — so skip only if BOTH are unsatisfiable. If either side is
  // unconditional (could match with no literal), the disjunction is unconditional. Two `any` sets union
  // (present of any literal on either side keeps the rule). An `all` inside an OR we don't reduce → fail open.
  if (a.kind === "unconditional" || b.kind === "unconditional") return UNCOND
  if (a.kind === "any" && b.kind === "any") return { kind: "any", literals: [...a.literals, ...b.literals] }
  return UNCOND
}

function simplify(p: Precondition): Precondition {
  if (p.kind !== "all") return p
  const parts: Precondition[] = []
  for (const raw of p.parts) {
    const s = simplify(raw)
    if (s.kind === "unconditional") continue // an unconditional AND-part adds no constraint
    if (s.kind === "all") parts.push(...s.parts)
    else parts.push(s)
  }
  if (parts.length === 0) return UNCOND
  if (parts.length === 1) return parts[0]!
  return { kind: "all", parts }
}

// ── Regex literal factors ────────────────────────────────────────────────────
// For a top-level alternation `A|B|C`, return one REQUIRED literal per alternative (a substring that
// must appear in any string the alternative matches). If ANY alternative has no such guaranteed literal
// (≥ MIN_LITERAL), return undefined — we cannot prune on this regex, so the caller falls open.
export function regexFactors(pattern: string): string[] | undefined {
  const alts = splitTopLevelAlternation(pattern)
  const out: string[] = []
  for (const alt of alts) {
    const set = alternativeFactors(alt)
    if (!set) return undefined // an alternative with no guaranteed literal → cannot prune → fall open
    for (const f of set) out.push(f)
  }
  return out.length > 0 ? out : undefined
}

// The literals such that ANY match of one top-level alternative contains at least one of them.
// Step 1: a fixed literal that appears OUTSIDE any group (guaranteed in every match). Step 2 (only if
// there is none): a single top-level group that is a pure alternation of literal-bearing branches —
// e.g. `(AKIA|ASIA)[0-9A-Z]{16}` ⇒ {akia, asia}. Anything else ⇒ undefined (fall open).
function alternativeFactors(alt: string): string[] | undefined {
  const fixed = literalOutsideGroups(alt)
  if (fixed && fixed.length >= MIN_LITERAL) return [fixed.toLowerCase()]
  const group = firstTopLevelGroup(alt)
  if (!group) return undefined
  const branches = splitTopLevelAlternation(group)
  if (branches.length < 2) return undefined
  const set: string[] = []
  for (const b of branches) {
    const lit = literalOutsideGroups(b)
    if (!lit || lit.length < MIN_LITERAL) return undefined // one branch has no guaranteed literal → fall open
    set.push(lit.toLowerCase())
  }
  return set
}

// The content of the first top-level `(...)` group (without the parens), or undefined.
function firstTopLevelGroup(p: string): string | undefined {
  let cls = false
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!
    if (c === "\\") {
      i++
      continue
    }
    if (cls) {
      if (c === "]") cls = false
      continue
    }
    if (c === "[") {
      cls = true
      continue
    }
    if (c === "(") {
      let depth = 1
      let j = i + 1
      // skip a non-capturing/anchor prefix like (?: (?= — those aren't literal alternations we reduce
      if (p[j] === "?") return undefined
      let body = ""
      for (; j < p.length && depth > 0; j++) {
        const d = p[j]!
        if (d === "\\") {
          body += d + (p[j + 1] ?? "")
          j++
          continue
        }
        if (d === "(") depth++
        if (d === ")") {
          depth--
          if (depth === 0) break
        }
        body += d
      }
      return body
    }
  }
  return undefined
}

function splitTopLevelAlternation(p: string): string[] {
  const out: string[] = []
  let depth = 0
  let cls = false // inside [ ]
  let cur = ""
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!
    if (c === "\\") {
      cur += c + (p[i + 1] ?? "")
      i++
      continue
    }
    if (cls) {
      cur += c
      if (c === "]") cls = false
      continue
    }
    if (c === "[") {
      cls = true
      cur += c
      continue
    }
    if (c === "(") depth++
    if (c === ")") depth = Math.max(0, depth - 1)
    if (c === "|" && depth === 0) {
      out.push(cur)
      cur = ""
      continue
    }
    cur += c
  }
  out.push(cur)
  return out
}

// The longest run of literal characters guaranteed to appear, scanning OUTSIDE groups and classes: a
// run ends at any regex metacharacter or a quantifier that could make the preceding char optional
// (?, *, {0…}); `(...)` groups and `[...]` classes are skipped entirely (their contents are not
// guaranteed literals here — grouped alternations are handled by alternativeFactors). Conservative by
// construction: never treats an optional/variable char as required, so any returned literal is a
// guaranteed substring.
function literalOutsideGroups(alt: string): string | undefined {
  let best = ""
  let run = ""
  const flush = () => {
    if (run.length > best.length) best = run
    run = ""
  }
  for (let i = 0; i < alt.length; i++) {
    const c = alt[i]!
    if (c === "\\") {
      const e = alt[i + 1] ?? ""
      i++
      if (/[dDwWsSbBnrtfv0-9]/.test(e)) {
        flush() // class shorthand / anchor / backref — not a fixed literal
        continue
      }
      if (nextIsOptional(alt, i)) {
        flush() // the escaped literal is quantified optional
        continue
      }
      run += e
      continue
    }
    if (c === "(") {
      // skip the whole group (its literals are not guaranteed outside a disjunction analysis)
      flush()
      let depth = 1
      i++
      for (; i < alt.length && depth > 0; i++) {
        if (alt[i] === "\\") {
          i++
          continue
        }
        if (alt[i] === "(") depth++
        else if (alt[i] === ")") depth--
        if (depth === 0) break
      }
      continue
    }
    if (c === "[") {
      flush()
      i++
      while (i < alt.length && alt[i] !== "]") {
        if (alt[i] === "\\") i++
        i++
      }
      continue
    }
    if ("^$.*+?){}|".includes(c)) {
      if (c === "?" || c === "*") {
        if (run.length > 0) run = run.slice(0, -1) // the preceding char is optional
      }
      flush()
      if (c === "{") while (i < alt.length && alt[i] !== "}") i++
      continue
    }
    if (nextIsOptional(alt, i)) {
      flush() // this literal char is quantified optional
      continue
    }
    run += c
  }
  flush()
  return best.length > 0 ? best : undefined
}

function nextIsOptional(alt: string, i: number): boolean {
  const n = alt[i + 1]
  if (n === "?" || n === "*") return true
  if (n === "{" && (alt[i + 2] === "0" || alt[i + 2] === ",")) return true
  return false
}

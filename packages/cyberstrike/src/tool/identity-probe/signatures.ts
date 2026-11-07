// Identity-management deterministic cores (WSTG 4.3). Pure — no I/O. Two concerns the identity-mgmt
// specialist owns exclusively and nothing else tools: (1) predictable/sequential account identifiers
// (4.3.4 guessable accounts / 4.3.5 naming), from captured traffic — read-only; (2) username-policy
// weaknesses used by the active registration probe (reserved names, unicode homoglyphs, weak/oversized).

// ── Account-identifier predictability (read-only) ──────────────────────────────────────────────────

export interface IdFinding {
  kind: "sequential-numeric-ids" | "predictable-username-pattern" | "low-entropy-identifier"
  severity: "high" | "medium" | "low"
  note: string
  samples: string[]
}

// Given account identifiers observed across captured traffic (user ids in paths/bodies, usernames, JWT
// sub claims), flag guessable spaces: near-consecutive numeric ids, a userN pattern, or short/low-variety
// values. Purely structural — no network.
export function classifyIdentifiers(ids: string[]): IdFinding[] {
  const out: IdFinding[] = []
  const uniq = [...new Set(ids.map((s) => s.trim()).filter(Boolean))]

  // Sequential numeric ids: several pure integers whose span is tight relative to their count (dense →
  // enumerable). e.g. 1001,1002,1004 across captures ⇒ the id space is walkable.
  const nums = uniq.filter((v) => /^\d{1,12}$/.test(v)).map(Number).sort((a, b) => a - b)
  if (nums.length >= 3) {
    const span = nums[nums.length - 1] - nums[0]
    const dense = span > 0 && span <= (nums.length - 1) * 50 // avg gap ≤ 50 between observed ids
    if (dense || span === 0)
      out.push({
        kind: "sequential-numeric-ids",
        severity: "high",
        note: `account identifiers are sequential/dense integers (${nums.length} values in a span of ${span}) — the account space is enumerable/guessable; feed the IDOR/authz specialist to walk it`,
        samples: nums.slice(0, 6).map(String),
      })
  }

  // userN / accountN style usernames.
  const patterned = uniq.filter((v) => /^(user|account|member|guest|test|u)[-_]?\d{1,6}$/i.test(v))
  if (patterned.length >= 2)
    out.push({ kind: "predictable-username-pattern", severity: "medium", note: `usernames follow a predictable pattern (${patterned.slice(0, 4).join(", ")}…) — the next/other accounts are guessable`, samples: patterned.slice(0, 6) })

  return out
}

// ── Username policy (used by the active registration probe) ────────────────────────────────────────

export const RESERVED_USERNAMES = ["admin", "administrator", "root", "system", "superuser", "sysadmin", "support", "security", "operator", "moderator", "webmaster", "postmaster", "null", "undefined"] as const

// A username that impersonates a reserved name using non-ASCII confusables (e.g. "аdmin" with a Cyrillic
// а). Detect: the value contains a non-ASCII letter AND, once confusables are folded to ASCII, matches a
// reserved name. Homoglyph registration lets an attacker masquerade as a privileged account.
const CONFUSABLES: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "і": "i", "ѕ": "s", "ԁ": "d", // Cyrillic
  "ａ": "a", "ｅ": "e", "ｏ": "o", // fullwidth
  "ⅼ": "l", "ο": "o", "ɑ": "a", "ᥱ": "e",
}

export function foldConfusables(s: string): string {
  let out = ""
  for (const ch of s) out += CONFUSABLES[ch] ?? ch
  return out
}

export function isHomoglyphOf(username: string, reserved: readonly string[] = RESERVED_USERNAMES): string | undefined {
  if (/^[\x00-\x7f]*$/.test(username)) return undefined // pure ASCII — not a homoglyph attack
  const folded = foldConfusables(username).toLowerCase()
  return reserved.find((r) => r === folded)
}

export interface UsernameIssue {
  kind: "reserved-name" | "homoglyph-impersonation" | "too-short" | "all-numeric" | "too-long" | "special-chars"
  note: string
}

// Static weaknesses of a single username value (the candidates the active probe registers).
export function usernamePolicyIssues(username: string): UsernameIssue[] {
  const out: UsernameIssue[] = []
  const homoglyphOf = isHomoglyphOf(username)
  if (homoglyphOf) out.push({ kind: "homoglyph-impersonation", note: `"${username}" folds to the reserved name "${homoglyphOf}" via unicode confusables — impersonation risk` })
  else if ((RESERVED_USERNAMES as readonly string[]).includes(username.toLowerCase())) out.push({ kind: "reserved-name", note: `"${username}" is a reserved/privileged name` })
  if (username.length <= 1) out.push({ kind: "too-short", note: `"${username}" is ${username.length} char(s) — no minimum-length policy` })
  if (/^\d+$/.test(username)) out.push({ kind: "all-numeric", note: `"${username}" is all-numeric — collides with numeric ids, weak policy` })
  if (username.length >= 256) out.push({ kind: "too-long", note: `${username.length}-char username — no maximum, possible overflow/DoS` })
  if (/[<>'"();]/.test(username)) out.push({ kind: "special-chars", note: `"${username}" carries markup/quote characters — weak validation (also an injection surface for input-validation)` })
  return out
}

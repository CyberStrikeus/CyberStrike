// Response observation & diff (design §3.10). Turns raw responses into FACTS the
// agent reasons about — never verdicts. Mirrors inject_probe's contract: report
// what the bytes show (a marker reflected un-encoded; a DB error signature is
// present; the mutated response differs from baseline in status/length/time),
// and let the agent decide whether that constitutes a vulnerability. There is
// deliberately no `vulnerable: true` field anywhere.
//
// No network, no dependencies — pure analysis over already-captured bytes.

import { ReplayResponse } from "./response"

export namespace Observe {
  function asText(body: Uint8Array | string): string {
    return typeof body === "string" ? body : new TextDecoder("latin1").decode(body)
  }

  const NAMED: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }
  const SPECIAL = new Set(["<", ">", "&", '"', "'"])

  /** HTML-encode ONLY the special chars, leaving other chars literal — how real
   * output encoders behave (`<x>` -> `&lt;x&gt;` / `&#60;x&#62;`). */
  function htmlSpecial(marker: string, form: "named" | "numeric"): string {
    let out = ""
    for (const ch of marker) {
      if (!SPECIAL.has(ch)) out += ch
      else out += form === "named" ? NAMED[ch] : `&#${ch.codePointAt(0)};`
    }
    return out
  }

  // ── Reflection ──────────────────────────────────────────────────────────────

  export interface Reflection {
    /** The marker appears verbatim (un-encoded) — a raw reflection sink. */
    raw: boolean
    /** The marker appears HTML-entity-encoded — reflected but neutralized. */
    htmlEncoded: boolean
    /** Number of verbatim occurrences. */
    count: number
  }

  /**
   * Whether/how a unique marker is reflected in a response body. A raw reflection
   * is a lead for XSS/SSTI; an html-encoded-only reflection suggests output
   * encoding is applied. This reports both — it does not conclude either way.
   */
  export function reflection(body: Uint8Array | string, marker: string): Reflection {
    const text = asText(body)
    if (marker === "") return { raw: false, htmlEncoded: false, count: 0 }
    let count = 0
    let idx = text.indexOf(marker)
    while (idx !== -1) {
      count++
      idx = text.indexOf(marker, idx + marker.length)
    }
    // Encoded reflection: the marker's special chars appear entity-encoded
    // (named or numeric) while the rest stays literal — reflected but neutralized.
    const hasSpecial = [...marker].some((c) => SPECIAL.has(c))
    const htmlEncoded =
      hasSpecial &&
      (text.includes(htmlSpecial(marker, "numeric")) || text.includes(htmlSpecial(marker, "named")))
    return { raw: count > 0, htmlEncoded, count }
  }

  // ── Error signatures ─────────────────────────────────────────────────────

  interface Signature {
    cls: string
    re: RegExp
  }

  // Compact battery of server-side error fingerprints. Presence is a LEAD that
  // input reached a parser/engine — not proof of exploitability.
  const SIGNATURES: Signature[] = [
    { cls: "sqli", re: /SQL syntax|mysql_fetch|valid MySQL result|ORA-\d{5}|PostgreSQL.*ERROR|SQLite3?::|SQLSTATE\[/i },
    { cls: "sqli", re: /Unclosed quotation mark|quoted string not properly terminated|Incorrect syntax near/i },
    { cls: "nosql", re: /MongoError|BSONError|E11000 duplicate key|CastError/i },
    { cls: "ldap", re: /javax\.naming|LDAPException|Invalid DN syntax/i },
    { cls: "xpath", re: /XPathException|MS\.Internal\.Xml|org\.apache\.xpath/i },
    { cls: "stacktrace", re: /Traceback \(most recent call last\)|Exception in thread|at [\w.$]+\([\w.]+:\d+\)/ },
  ]

  /** All distinct error classes whose signature matches the body. */
  export function errorSignatures(body: Uint8Array | string): string[] {
    const text = asText(body)
    const hits = new Set<string>()
    for (const sig of SIGNATURES) if (sig.re.test(text)) hits.add(sig.cls)
    return [...hits]
  }

  // ── Baseline vs mutated diff ────────────────────────────────────────────────

  export interface Diff {
    statusChanged: boolean
    baselineStatus?: number
    mutatedStatus?: number
    /** mutated body length minus baseline body length (bytes). */
    lengthDelta: number
    /** mutated total time minus baseline total time (ms) — the time-based signal. */
    timeDeltaMs: number
    /** True when both bodies are byte-identical. */
    bodyIdentical: boolean
  }

  function bodyLen(r: ReplayResponse.Result): number {
    return r.response?.body.length ?? 0
  }

  function bytesEqual(a?: Uint8Array, b?: Uint8Array): boolean {
    if (!a || !b || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }

  /**
   * Compare a mutated send against a baseline send. Reports raw differences
   * (status/length/time/identity) — the substrate for boolean-based
   * (length/status change) and time-based (timeDeltaMs) reasoning. The caller
   * decides what the deltas mean.
   */
  export function diff(baseline: ReplayResponse.Result, mutated: ReplayResponse.Result): Diff {
    return {
      statusChanged: baseline.response?.status !== mutated.response?.status,
      baselineStatus: baseline.response?.status,
      mutatedStatus: mutated.response?.status,
      lengthDelta: bodyLen(mutated) - bodyLen(baseline),
      timeDeltaMs: mutated.timing.totalMs - baseline.timing.totalMs,
      bodyIdentical: bytesEqual(baseline.response?.body, mutated.response?.body),
    }
  }
}

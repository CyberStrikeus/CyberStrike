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
import type { Signal } from "./rule"
import { dedupe } from "./rule"
import type { Sender } from "./active"
import type { Apply } from "./send"
import type { InjectPoint, Coverage } from "./injectpoint"
import type { TrafficStore } from "./store"
import { replaySafety } from "./replay-safety"
import { reflects, brokeOut, mintTemplateCanary, TEMPLATE_PLACEHOLDER } from "./canary"
import { endpointKey } from "./endpoint"

export type DetectMode = "reflected" | "evaluated" | "error"

export interface PayloadClass {
  id: string
  category: string
  severity: Severity
  detect: DetectMode
  payloads: string[] // "{canary}" for reflected, "{template}" for evaluated
  signatures?: RegExp[] // detect "error": a hit is a signature present in the probe body but NOT the baseline
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
  for (const re of sigs) {
    if (re.test(body) && !(baseline && re.test(baseline))) return re
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
  const out: Signal[] = []
  const baselineByTx = new Map<string, string | undefined>()

  for (const pt of points) {
    const tx = resolveTx(pt.transactionId)
    if (!tx) continue
    if (!replaySafety(tx).safe) continue // never burn a session-minting / one-time-token request

    // Baseline body for the tx (one send, cached) — the differential reference for error detection.
    if (!baselineByTx.has(tx.id)) {
      const base = await send(tx)
      baselineByTx.set(tx.id, base.transaction.response?.body)
    }
    const baseline = baselineByTx.get(tx.id)
    const endpoint = endpointKey(tx)

    for (const cls of classes) {
      let confirmed = false
      for (const payload of cls.payloads) {
        if (confirmed) break
        const tc = cls.detect === "evaluated" ? mintTemplateCanary() : undefined
        const value = tc ? payload.split(TEMPLATE_PLACEHOLDER).join(tc.expr) : payload
        const res = await send(tx, {
          mutations: [mutationForPoint(pt, value)],
          canary: cls.detect === "reflected" ? { field: pt.dotpath, vulnClass: cls.category } : undefined,
        })
        const body = res.transaction.response?.body

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
        } else {
          const sig = errorSignature(cls.signatures, body, baseline)
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
          evidence: `payload into ${pt.location}.${pt.dotpath} on ${endpoint} — ${evidence}`,
          param: { location: pt.location, dotpath: pt.dotpath, name: pt.name },
          dedupKey: `${cls.id}:${pt.id}`,
        })
        confirmed = true
      }
      opts.onResult?.({
        paramId: pt.id,
        transactionId: pt.transactionId,
        payloadClass: cls.id,
        result: confirmed ? "hit" : "clean",
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
  const signals = await probeInjectPoints(points, (id) => store.get(id), send, {
    ...opts,
    onResult: (c) => {
      coverage.push({ ...c, at: Date.now() })
      opts.onResult?.(c)
    },
  })
  store.addSignals(signals)
  store.recordCoverage(coverage)
  // Mark only the points we actually attempted (those that produced coverage — replay-unsafe /
  // unresolvable points were skipped and must stay unprobed so a later pass can retry them).
  const attempted = new Set(coverage.map((c) => c.paramId))
  const marked = points.filter((p) => attempted.has(p.id)).map((p) => ({ ...p, probed: true }))
  store.addInjectPoints(marked)
  return { signals, coverage, probed: marked.length }
}

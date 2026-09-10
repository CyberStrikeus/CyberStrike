// The AGENT surface — a narrow, curated facade over Vortex, plus framework-neutral tool descriptors.
// This module is the PUBLIC "@cyberstrike-io/vortex/agent" export (see package.json). It exposes ONLY
// the facade + agentCapabilities — never the store, rule engine, or send internals — so agent-facing
// consumers physically cannot import past it. The platform assembler imports the package ROOT instead.
// The platform (a consumer) ASSEMBLES Vortex with the broad API (store, rule engine, adapters);
// the AGENT only ever sees this facade: read-mostly, with exactly two open-ended inputs (an HTTPQL
// `search` and a full `send`/http_replay incl. craft-your-own requests), everything else typed. It
// does NOT expose the RuleRegistry, the expr compiler, the send-engine internals, or store mutation
// — so an agent can't be confused by a huge surface or corrupt the corpus. Guards are baked in
// (search is grep-gated; send keeps the replay-safety guard).
//
// Vortex stays framework-agnostic: it ships the facade + `agentCapabilities` (name + description +
// zod input + handler); a consumer writes a ~10-line adapter to its tool framework (opencode
// Tool.define / MCP / Anthropic tools). SDK-produced FIXED tools — the agent calls them, it does not
// write code against the SDK.
import z from "zod"
import type { TrafficStore } from "./store"
import type { Transaction } from "./transaction"
import type { Signal } from "./rule"
import type { Lead } from "./lead"
import type { RawView } from "./fields"
import type { ObjectRecord, FunctionRecord } from "./inventory"
import type { Occurrence } from "./pivot"
import type { Discovered } from "./discovery"
import type { RequestSpec, SendOptions, SendResult } from "./replay"
import type { InjectPoint, InjectLocation, Coverage } from "./injectpoint"
import { leads } from "./lead"
import { rawView } from "./fields"
import { query as httpqlQuery } from "./httpql"
import { inventory, crossRoleObjects, crossRoleFunctions } from "./inventory"
import { valueOccurrences, untestedEndpoints } from "./pivot"
import { send as coreSend } from "./replay"
import { probeInjectPoints } from "./injectprobe"
import type { Sender } from "./active"

export interface LeadFilter {
  category?: string
  severity?: Signal["severity"]
  limit?: number
}

// An inject point enriched with its probe coverage — one auditable row of "which parameter, tested
// with what, and the outcome". `probed` is the engine's auto-probe flag; `coverage` is the per-class
// ledger (empty = this point has never been probed by the engine). This is what lets the agent hold
// itself to the coverage contract instead of trusting the engine's determinism.
export interface InjectPointView extends InjectPoint {
  coverage: { payloadClass: string; result: Coverage["result"]; strategy?: Coverage["strategy"]; signalId?: string }[]
}

export interface InjectPointFilter {
  location?: InjectLocation
  probed?: boolean
}

export interface ProbeArgs {
  // Restrict to these Vortex payload-class ids (default: all).
  classes?: string[]
  // false = probe EVERY point; default/omitted = only the points Vortex's auto-probe hasn't touched.
  onlyUnprobed?: boolean
}

// The narrow facade a consumer hands its agents.
export interface Vortex {
  // the fed findings (agent doesn't hunt — these are pre-computed)
  leads(f?: LeadFilter): Lead[]
  // inspect ONE transaction verbatim (exact bytes for evidence + crafting the next step)
  inspect(id: string): RawView | undefined
  // OPEN-ENDED read: HTTPQL SELECT over the corpus (grep-gated, ReDoS-safe, no functions)
  search(httpql: string): Transaction[]
  // the object/function graph (correlation), pre-aggregated
  objects(f?: { resource?: string; role?: string }): ObjectRecord[]
  functions(): FunctionRecord[]
  crossRole(): { objects: ObjectRecord[]; functions: FunctionRecord[] } // deterministic IDOR / BFLA leads
  whereValue(v: string): Occurrence[] // where a value (spotted in a rawView) flows
  untested(): Discovered[] // discovered-but-unrequested attack surface
  // the FULL parameter inventory (every query/body/path/header input), each with its coverage — the
  // coverage-contract denominator: the agent tests EVERY point, it does not trust auto-probe to be complete
  injectPoints(f?: InjectPointFilter): InjectPointView[]
  // ACTIVELY probe inject points with Vortex's own prober (payload battery + canary per class) and
  // RETURN the signals it produced. Deliberately does NOT persist to the store — an agent's own probe
  // attempts must never mark Vortex's coverage/signals; only Vortex's autonomous auto-probe writes the
  // store. The agent tracks its own coverage against the (read-only) inject-point inventory.
  probe(opts?: ProbeArgs): Promise<{ attempted: number; signals: Signal[] }>
  // OPEN-ENDED act: replay a captured request OR craft a fresh one; replay-safety guard stays on
  send(input: string | RequestSpec, opts?: SendOptions): Promise<SendResult>
}

// Build the agent facade over a store. Read-only over the store's current signals/traffic; the
// platform runs the rules (analyze → addSignals) — the agent just consumes.
export function forAgent(store: TrafficStore, sender?: Sender): Vortex {
  return {
    leads: (f) => {
      const sigs = store.signals({ category: f?.category, severity: f?.severity })
      const out = leads(store, sigs)
      return f?.limit ? out.slice(0, f.limit) : out
    },
    inspect: (id) => {
      const tx = store.get(id)
      return tx ? rawView(tx) : undefined
    },
    search: (httpql) => httpqlQuery(store.all(), httpql, { grep: false }), // agent scope: no raw grep
    objects: (f) => {
      let objs = inventory(store).objects
      if (f?.resource) objs = objs.filter((o) => o.resource === f.resource)
      if (f?.role) objs = objs.filter((o) => o.roles.includes(f.role!))
      return objs
    },
    functions: () => inventory(store).functions,
    crossRole: () => {
      const inv = inventory(store)
      return { objects: crossRoleObjects(inv), functions: crossRoleFunctions(inv) }
    },
    whereValue: (v) => valueOccurrences(store, v),
    untested: () => untestedEndpoints(store),
    injectPoints: (f) =>
      store.injectPoints(f).map((pt) => ({
        ...pt,
        coverage: store
          .coverage({ paramId: pt.id })
          .map((c) => ({ payloadClass: c.payloadClass, result: c.result, strategy: c.strategy, signalId: c.signalId })),
      })),
    probe: async (opts) => {
      if (!sender) throw new Error("active probing is not wired in this context (no sender)")
      const points = opts?.onlyUnprobed === false ? store.injectPoints() : store.injectPoints({ probed: false })
      // probeInjectPoints RETURNS signals and does NOT persist — coverage persistence is the caller's
      // job, and here the caller (an agent) must not write to Vortex. So the agent gets its findings
      // back to confirm/report, and the Vortex store (coverage, probed flag, signals) is untouched.
      const signals = await probeInjectPoints(points, (id) => store.get(id), sender, { classes: opts?.classes })
      return { attempted: points.length, signals }
    },
    send: (input, opts) => {
      const resolved = typeof input === "string" ? store.get(input) : input
      if (!resolved) throw new Error(`unknown request_id: ${input}`)
      return coreSend(resolved, opts) // replay-safety guard on by default; caller opts-in to unsafe
    },
  }
}

// ── framework-neutral tool descriptors ──────────────────────────────────────
export interface Capability {
  name: string
  description: string
  input: z.ZodType
  run(api: Vortex, args: unknown): unknown
}

const MUTATION = z.object({ op: z.string(), name: z.string().optional(), value: z.string().optional() }).strict()

// Trim a SendResult to an agent-friendly fact set (not the internal engine object).
function replayFacts(r: SendResult) {
  const resp = r.result.response
  return {
    transaction_id: r.transaction.id,
    status: resp?.status,
    time_ms: r.transaction.timing?.ms,
    headers: r.transaction.response?.headers,
    body: r.transaction.response?.body?.slice(0, 4000),
    canary_reflected: r.canaryReflected,
  }
}

export const agentCapabilities: Capability[] = [
  {
    name: "vortex_leads",
    description: "List pending findings as actionable leads (signal + endpoint/objects/role + raw inline). The agent's starting point — these are pre-computed by the engine, not hunted.",
    input: z.object({ category: z.string().optional(), severity: z.enum(["info", "low", "medium", "high", "critical"]).optional(), limit: z.number().int().positive().optional() }).strict(),
    run: (api, a) => api.leads(a as LeadFilter),
  },
  {
    name: "vortex_inspect",
    description: "Get the full, verbatim raw request+response of ONE transaction by id — the exact bytes, for evidence and for crafting the next probe.",
    input: z.object({ id: z.string() }).strict(),
    run: (api, a) => api.inspect((a as { id: string }).id),
  },
  {
    name: "vortex_query",
    description: "Search the traffic corpus with HTTPQL (field:op:value + AND/OR/NOT, :~ regex, field:* exists). Use to find requests matching a shape — same param elsewhere, an error signature, a value across endpoints. Structured SELECT only, no functions.",
    input: z.object({ httpql: z.string() }).strict(),
    run: (api, a) => api.search((a as { httpql: string }).httpql).map((t) => ({ id: t.id, method: t.request.method, url: t.request.url, status: t.response?.status })),
  },
  {
    name: "vortex_objects",
    description: "List resource objects seen across the corpus (canonicalized by value), optionally filtered by resource type or role. For BOLA/IDOR reasoning.",
    input: z.object({ resource: z.string().optional(), role: z.string().optional() }).strict(),
    run: (api, a) => api.objects(a as { resource?: string; role?: string }),
  },
  {
    name: "vortex_functions",
    description: "List the functions (method + endpoint + CRUD) seen across the corpus, with which roles called each. For BFLA reasoning.",
    input: z.object({}).strict(),
    run: (api) => api.functions(),
  },
  {
    name: "vortex_cross_role",
    description: "Deterministic access-control leads: objects reached under more than one role (IDOR/BOLA candidates) and functions called under more than one role (BFLA surface).",
    input: z.object({}).strict(),
    run: (api) => api.crossRole(),
  },
  {
    name: "vortex_where_value",
    description: "Find every transaction carrying a value (and the field it's in) — the pivot from a value spotted in a raw response (a leaked token, an internal host, an object id) to where else it flows.",
    input: z.object({ value: z.string() }).strict(),
    run: (api, a) => api.whereValue((a as { value: string }).value),
  },
  {
    name: "vortex_untested",
    description: "Endpoints the crawl discovered but no request ever hit — untested attack surface to expand a finding to.",
    input: z.object({}).strict(),
    run: (api) => api.untested(),
  },
  {
    name: "vortex_inject_points",
    description:
      "The FULL parameter inventory — every attacker-controllable input enumerated deterministically (query key, body dotpath incl. nested objects & array elements, id-shaped path segment, injectable header), each with its value type, the engine's `probed` flag, and its per-class probe coverage (payloadClass + hit/clean). This is your COVERAGE CONTRACT's denominator: you must ensure EVERY point is tested — do NOT trust the engine's rule-based auto-probe to be complete. Filter {probed:false} for the untested backlog to work first; {} for the full set to verify nothing was skipped; {location:\"body\"} to focus a surface.",
    input: z.object({ location: z.enum(["query", "body", "path", "header"]).optional(), probed: z.boolean().optional() }).strict(),
    run: (api, a) => api.injectPoints(a as InjectPointFilter),
  },
  {
    name: "vortex_probe",
    description:
      "ACTIVELY probe inject points with Vortex's own prober: for each point it sends the payload battery + canary per class and RETURNS the signals it produced (reflection / evaluated-template / error-signature). It does NOT write to Vortex — your probe attempts never mark Vortex's coverage or add to its signals; only Vortex's own auto-probe does. So treat the returned signals as YOUR leads: confirm each with http_replay, and track your own coverage against vortex_inject_points (which stays read-only). Default probes the points Vortex hasn't auto-probed; {onlyUnprobed:false} probes every point; {classes:[...]} restricts. Classes: sqli-error, xss-reflected, ssti, path-traversal. Replay-unsafe requests are skipped automatically.",
    input: z.object({ classes: z.array(z.enum(["sqli-error", "xss-reflected", "ssti", "path-traversal"])).optional(), onlyUnprobed: z.boolean().optional() }).strict(),
    run: (api, a) => api.probe(a as ProbeArgs),
  },
  {
    name: "http_replay",
    description: "Send a request to CONFIRM or WEAPONIZE — replay a captured request by request_id, or craft a fresh one (target). Apply field mutations. Returns facts (status/timing/headers/body). A replay that would burn the live session (auth-exchange / single-use token) is refused unless allow_unsafe_replay.",
    input: z
      .object({
        request_id: z.string().optional(),
        target: z.object({ method: z.string(), url: z.string(), headers: z.record(z.string(), z.string()).optional(), body: z.string().optional() }).optional(),
        mutations: z.array(MUTATION).optional(),
        allow_unsafe_replay: z.boolean().optional(),
      })
      .strict(),
    run: async (api, a) => {
      const args = a as { request_id?: string; target?: RequestSpec; mutations?: never[]; allow_unsafe_replay?: boolean }
      const input = args.request_id ?? args.target
      if (!input) throw new Error("http_replay needs request_id or target")
      return replayFacts(await api.send(input, { mutations: args.mutations, allowUnsafeReplay: args.allow_unsafe_replay }))
    },
  },
]

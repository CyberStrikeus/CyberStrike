// LlmNavigator — the brain (design §3.2, the "AI-driven navigation" pivot).
//
// This is where the balance flips back to 1.x "System Observes, LLM Interprets", elevated: the
// deterministic layer only OBSERVES (rich page-state + tech fingerprint), BOUNDS (scope, guard,
// visited/acted) and COLLECTS; the MAIN model PLANS over the full rich observation — every safe,
// unvisited interactive element and every safe form on the page — and returns an ordered plan of
// the best next moves toward the most valuable UNVISITED functionality. Vulnerability analysis is
// decoupled (separate checkers work off the DB), so the navigator only has to explore well.
//
// The model call is isolated behind the `ask` seam: mapping, validation and fallback are all
// exercised in tests without a live model. ANY failure — no provider, model error, malformed or
// unusable output — falls back to DeterministicNavigator so a broken model never stalls the crawl.
import { streamText, tool } from "ai"
import z from "zod"
import type { Navigator, Plan, Action, PageSnapshot } from "./types"
import { DeterministicNavigator } from "./deterministic-navigator"
import { Crawl } from "../crawl"
import { WebScope } from "../scope"
import { WebStrategy } from "../strategy"
import { WebFormFill } from "../formfill"
import { FrameworkFingerprinter } from "../tech"
import { DataCollector } from "../data-collector"
import { JsMiner } from "../js-miner"
import { HBLog } from "../hblog"
import { Provider } from "../../../provider/provider"
import { ProviderTransform } from "../../../provider/transform"
import { Log } from "../../../util/log"

const log = Log.create({ service: "llm-navigator" })

export namespace LlmNavigator {
  // Raw model output — one action the model wants next. Validated against the LIVE snapshot
  // (element_id must exist and be safe, form_index in range, navigate url in-scope + known)
  // before it is trusted; the model can never invent a target or reach a guarded control.
  export interface RawAction {
    kind: "click" | "navigate" | "form" | "done"
    element_id?: string
    url?: string
    form_index?: number
    reason?: string
  }
  export interface RawPlan {
    rationale?: string
    actions: RawAction[]
  }
  // The single model touch, behind a DI seam. Returns null when the model produced nothing.
  export type Ask = (ctx: { system: string; user: string }) => Promise<RawPlan | null>

  // A safe, actionable click target the model may choose from. Built from the snapshot with the
  // SAME bounds the executor enforces — only allow-policy, enabled, un-acted, in-scope elements —
  // so anything the model picks is executable and on-target. Includes script-driven widgets
  // (kind "other", no href) that deterministic ranking skips: the model reasons over ALL of them.
  export interface Pick {
    id: string
    label: string
    kind: string
    section?: string
    why?: string
    aria?: Record<string, string>
    target?: string
    visited: boolean
  }
}

const MAX_ACTIONS = 6
const CLICK_CAP = 60
const FORM_CAP = 20
const MODEL_TIMEOUT_MS = 30000 // a hung plan call must not freeze the loop → fall back to deterministic

// Reject if the promise doesn't settle within ms (so a stalled model call can't stall the crawl).
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("model-timeout")), ms))])
}

const SYSTEM =
  "You are the navigator for a web-application MAPPING crawler. Your goal is BREADTH: visit as many " +
  "distinct UI areas as possible to map the whole app — user/account pages, settings, transactions, " +
  "admin, search, forms — by choosing which interactive elements to click and which safe forms to " +
  "fill, one page at a time. Do NOT fixate on a single area or tunnel toward one 'valuable' target; " +
  "spread out and reach UNVISITED pages. You do NOT test for vulnerabilities (a separate system does " +
  "that from the collected data). IMPORTANT: API and documentation endpoints (Swagger, REST API, " +
  "*.json, GraphQL) and everything already seen in traffic are ALREADY captured automatically — do " +
  "NOT navigate to them just to view them; that wastes moves. Spend every move on UNVISITED " +
  "human-facing UI. You are given the current page (what it is, where in the app, its structure and " +
  "framework), the focus areas, coverage so far, and every safe actionable element and form. Return " +
  "an ORDERED short plan (1-5 moves) toward NEW areas. Reference an element ONLY by an element_id " +
  "from the list, a form ONLY by a form_index, and navigate ONLY to a url shown on the page. Keep " +
  "`rationale` to ONE short sentence. FORMS ARE COVERAGE: before leaving a page (or emitting `done`), " +
  "if it lists an un-submitted form — a search box, a filter, a settings form, or a message/chat/ask " +
  "input — FILL and submit it. These exercise the app and surface endpoints even when they do not " +
  "lead to a new URL, so filling them is progress, not a detour. In particular, if the app has a " +
  "chat/assistant/message composer, send a message through it. Emit a single `done` action only when " +
  "the whole app appears fully explored AND no un-submitted forms remain. Never choose logout/sign-out " +
  "or delete/remove controls."

// Safe, actionable click targets for the model — the same universe the executor can run: allow
// policy (deny=logout / confirm=destructive are excluded — they cannot run autonomously anyway),
// enabled, not already acted on this page, and (for links) in-scope. Unvisited targets first so
// the model's attention lands on the frontier when the list is capped. This is the ONE place that
// widens beyond Rank's nav/query set to the full interactive surface (the pivot's core).
export function clickPool(sessionID: string, snapshot: PageSnapshot, cap = CLICK_CAP): LlmNavigator.Pick[] {
  const out: LlmNavigator.Pick[] = []
  for (const c of snapshot.clickables) {
    if (c.policy !== "allow") continue
    if (c.disabled) continue
    const key = Crawl.actionKey(snapshot.url, c)
    if (Crawl.isActed(sessionID, key)) continue
    const target = c.href ? WebScope.resolve(c.href, snapshot.url) : undefined
    if (target && !WebScope.allowed(sessionID, target)) continue // stay on the target domain
    out.push({
      id: c.id,
      label: c.label,
      kind: c.kind ?? "other",
      section: c.section,
      why: c.why,
      aria: c.aria,
      target,
      visited: target ? Crawl.isPageVisited(sessionID, target) : false,
    })
    if (out.length >= cap * 2) break // hard-bound the scan on pathological pages
  }
  // Unvisited first (stable within each group), then cap — keeps the frontier in view.
  return out
    .map((p, i) => ({ p, i }))
    .sort((a, b) => Number(a.p.visited) - Number(b.p.visited) || a.i - b.i)
    .map((x) => x.p)
    .slice(0, cap)
}

// Compact a mined route URL to path(+query) for the prompt; falls back to the raw string.
function pathOf(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

// Server-side fingerprint from the collected response headers/cookies, or undefined when nothing
// server-identifying was seen yet. Merged with the extension's client-side fingerprint so the AI
// sees the FULL stack (client framework + backend) — resolves the P2 server-signal seam.
function serverTech(collected: DataCollector.CollectedData) {
  const { headers, cookies } = collected.server
  if (Object.keys(headers).length === 0 && cookies.length === 0) return undefined
  return FrameworkFingerprinter.detect({ headers, cookies })
}

// Rich per-page context so the MAIN model reasons about the app, not a flat list: what the page
// is, where in the app, its structure, its framework (how navigation behaves), the focus areas,
// coverage so far, routes already seen in traffic, the safe forms (by index) and every safe
// interactive element (by id).
export function buildContext(
  sessionID: string,
  snapshot: PageSnapshot,
  picks: LlmNavigator.Pick[],
  forms: WebFormFill.FormCandidate[],
  collected: DataCollector.CollectedData,
): string {
  const priorities = WebStrategy.get(sessionID)?.priorities ?? []
  const cov = Crawl.summary(sessionID)
  const tech = FrameworkFingerprinter.merge(snapshot.tech, serverTech(collected))
  // Routes the app served but the crawl has NOT loaded yet — strong "go here next" hints. API
  // endpoints seen give the model the app's surface (e.g. an /api/admin hints at an admin UI).
  const unvisited = collected.endpoints
    .filter((e) => e.kind === "html" && !Crawl.isPageVisited(sessionID, e.origin + e.path))
    .map((e) => e.origin + e.path)
    .slice(0, 15)
  const apis = collected.endpoints
    .filter((e) => e.kind === "api")
    .map((e) => `${e.method} ${e.path}`)
    .slice(0, 10)
  // Routes mined from JS bundles (P4.1) — discovered in code, not necessarily seen in traffic.
  const mined = collected.minedRoutes.map((r) => `${r.method} ${pathOf(r.url)}`).slice(0, 12)
  const formLines = forms.map((f, i) => {
    const fields = f.fills.map((x) => x.id).filter(Boolean).slice(0, 8)
    return `  [${i}] "${f.label}"${fields.length ? ` fills: ${fields.join(", ")}` : ""}`
  })
  const elLines = picks.map((p) => {
    const bits: string[] = []
    if (p.section) bits.push(`in: ${p.section}`)
    if (p.why) bits.push(p.why)
    if (p.aria && Object.keys(p.aria).length) bits.push(`aria=${JSON.stringify(p.aria)}`)
    const tail = p.target ? ` -> ${p.target}${p.visited ? " [visited]" : ""}` : ""
    return `  - ${p.id} [${p.kind}] "${p.label}"${bits.length ? ` (${bits.join("; ")})` : ""}${tail}`
  })
  return [
    `URL: ${snapshot.url}`,
    snapshot.description ? `Page: ${snapshot.description}` : "",
    tech ? `Tech: ${FrameworkFingerprinter.describe(tech)}` : "",
    snapshot.location && snapshot.location.length ? `Location: ${snapshot.location.join(" > ")}` : "",
    snapshot.landmarks && snapshot.landmarks.length
      ? `Structure: ${snapshot.landmarks.map((l) => `${l.role}${l.label ? `(${l.label})` : ""}`).join(", ")}`
      : "",
    priorities.length ? `Focus areas (app priorities): ${priorities.join(", ")}` : "",
    `Coverage so far: ${cov.pages_visited} pages explored, ${cov.actions} actions used.`,
    // Already-captured context — NOT click targets. The collector + vuln pipeline already have
    // these; listing them helps the model understand the app, but it must NOT tunnel toward them.
    unvisited.length ? `(context, already captured — do NOT navigate here just to view) UI routes seen: ${unvisited.join(", ")}` : "",
    apis.length ? `(context, already captured — the app's API surface, do NOT navigate here) ${apis.join(", ")}` : "",
    mined.length ? `(context, already captured — routes mined from JS) ${mined.join(", ")}` : "",
    forms.length ? `Forms (choose by form_index):\n${formLines.join("\n")}` : "",
    picks.length ? `Interactive elements (choose by element_id):\n${elLines.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n")
}

// Validate the model's raw actions against the live snapshot and turn them into typed, executable
// Actions. Anything unresolvable (unknown id, out-of-range form, out-of-scope/unknown nav url) is
// dropped, duplicates are collapsed, `done` terminates the plan, and the plan is bounded. A model
// can therefore only ever produce safe, on-page, executable moves.
export function mapActions(
  sessionID: string,
  snapshot: PageSnapshot,
  raw: LlmNavigator.RawAction[],
  picks: LlmNavigator.Pick[],
  forms: WebFormFill.FormCandidate[],
): Action[] {
  const byId = new Map(picks.map((p) => [p.id, p]))
  const out: Action[] = []
  const usedClick = new Set<string>()
  const usedForm = new Set<number>()
  const usedNav = new Set<string>()
  for (const a of raw) {
    if (out.length >= MAX_ACTIONS) break
    if (a.kind === "done") {
      out.push({ kind: "done", reason: a.reason?.trim() || "explored" })
      break // done ends the plan — nothing after it matters
    }
    if (a.kind === "form") {
      if (a.form_index == null || usedForm.has(a.form_index)) continue
      const f = forms[a.form_index]
      if (!f) continue
      usedForm.add(a.form_index)
      out.push({ kind: "form", form: f })
      continue
    }
    if (a.kind === "navigate") {
      if (!a.url) continue
      const abs = WebScope.resolve(a.url, snapshot.url)
      if (!abs || usedNav.has(abs)) continue
      if (!WebScope.allowed(sessionID, abs)) continue // never let the model steer off-scope
      if (!snapshot.links.includes(abs) && !snapshot.links.includes(a.url)) continue // known links only
      usedNav.add(abs)
      out.push({ kind: "navigate", url: abs })
      continue
    }
    // click
    if (!a.element_id || usedClick.has(a.element_id)) continue
    const p = byId.get(a.element_id)
    if (!p) continue
    usedClick.add(a.element_id)
    out.push({ kind: "click", elementId: p.id, label: p.label })
  }
  return out
}

// Default `ask`: the MAIN model (deliberately NOT the small one — per-page planning is the kind of
// business-logic reasoning small models do poorly), bounded I/O, structured forced-tool output.
const defaultAsk: LlmNavigator.Ask = async ({ system, user }) => {
  const dm = await Provider.defaultModel()
  const model = await Provider.getModel(dm.providerID, dm.modelID)
  const language = await Provider.getLanguage(model)
  const schema = z.object({
    rationale: z.string().describe("ONE short sentence (max ~12 words): why this next move").optional(),
    actions: z
      .array(
        z.object({
          kind: z.enum(["click", "navigate", "form", "done"]),
          element_id: z.string().describe("id of an element from the list (for kind=click)").optional(),
          url: z.string().describe("a url shown on the page (for kind=navigate)").optional(),
          form_index: z.number().int().describe("index of a form from the list (for kind=form)").optional(),
          reason: z.string().optional(),
        }),
      )
      .min(1)
      .max(6)
      .describe("ordered next moves, best first"),
  })
  const result = streamText({
    model: language,
    temperature: 0,
    maxOutputTokens: ProviderTransform.maxOutputTokens(model),
    tools: { plan_moves: tool({ description: "Report the ordered next navigation moves.", inputSchema: schema }) },
    toolChoice: "required",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    onError: () => {},
  })
  for await (const part of result.fullStream) if (part.type === "error") throw part.error
  const call = (await result.toolCalls).find((c) => c.toolName === "plan_moves")
  const parsed = call ? schema.safeParse(call.input) : undefined
  if (parsed && parsed.success) return { rationale: parsed.data.rationale, actions: parsed.data.actions }
  return null
}

export class LlmNavigator implements Navigator {
  private readonly fallback = new DeterministicNavigator()
  constructor(
    private readonly ask: LlmNavigator.Ask = defaultAsk,
    private readonly cap = CLICK_CAP,
    private readonly timeoutMs = MODEL_TIMEOUT_MS,
  ) {}

  async plan(sessionID: string, snapshot: PageSnapshot): Promise<Plan> {
    // Keep the main-model business-strategy priorities warming in the background (cached,
    // non-blocking) — they sharpen the context's Focus areas and the deterministic fallback.
    void WebStrategy.ensure(sessionID, snapshot).catch(() => {})
    // Mine any newly-collected JS bundles for routes in the background (P4.1) — fetch-once, so most
    // plans this is a no-op; discovered routes accrue into DataCollector for the NEXT context build.
    void JsMiner.mineNew(sessionID).catch(() => {})

    const priorities = WebStrategy.get(sessionID)?.priorities ?? []
    const picks = clickPool(sessionID, snapshot, this.cap)
    const forms = WebFormFill.candidates(sessionID, snapshot, priorities).slice(0, FORM_CAP)
    // Nothing safe/actionable here → empty plan so the orchestrator backtracks via the frontier.
    if (picks.length === 0 && forms.length === 0) return { rationale: "nothing actionable on this page", actions: [] }

    let raw: LlmNavigator.RawPlan | null = null
    try {
      raw = await withTimeout(this.ask({ system: SYSTEM, user: buildContext(sessionID, snapshot, picks, forms, DataCollector.latest(sessionID)) }), this.timeoutMs)
    } catch (e) {
      log.debug("LlmNavigator ask failed/timed out → deterministic", { err: String(e) })
      return this.fallback.plan(sessionID, snapshot)
    }
    const actions = raw ? mapActions(sessionID, snapshot, raw.actions, picks, forms) : []
    if (actions.length === 0) {
      // Model unreachable / declined / produced nothing usable → deterministic top pick.
      return this.fallback.plan(sessionID, snapshot)
    }
    HBLog.record(sessionID, "codrive", "plan", { by: "llm", rationale: raw?.rationale ?? "", actions: actions.length })
    return { rationale: raw?.rationale?.trim() || "llm plan", actions }
  }
}

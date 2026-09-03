// Co-driving loop — what makes "AI-driver mode" actually navigate (§ Phase E, advanced on 1.x).
//
// 1.x = "System Observes, LLM Interprets": deterministic snapshot → LLM plan → execute.
// We keep that shape but flip the balance to deterministic-heavy / LLM-light:
//   observe (rich page-state) → RANK deterministically → AUTO-ADVANCE the clear pick with NO
//   LLM call → only ask the (small, fast) planner when candidates are close → EXECUTE via the
//   shared gated path (WebAct) → settle → repeat. Started when the panel driver flips to AI,
//   stopped when it flips to Human / budget / no browser / coverage.
//
// The planner is injectable: DeterministicPlanner (default in tests, fully verified) and
// LlmPlanner (small model, structured forced-tool pick, deterministic fallback on any error).
import { streamText, tool } from "ai"
import z from "zod"
import { PageState } from "./page-state"
import { WebControl } from "./control"
import { WebDriver } from "./driver"
import { Crawl } from "./crawl"
import { Rank } from "./rank"
import { WebAct } from "./act"
import { WebFormFill } from "./formfill"
import { Unexplored } from "./unexplored"
import { Effect } from "./effect"
import { WebScope } from "./scope"
import { WebStrategy } from "./strategy"
import { HBLog } from "./hblog"
import { Provider } from "../../provider/provider"
import { ProviderTransform } from "../../provider/transform"
import { Log } from "../../util/log"

const log = Log.create({ service: "web-codrive" })

export namespace WebCoDrive {
  export interface PlanInput {
    sessionID: string
    state: PageState.StatePayload
    candidates: Rank.Candidate[]
  }
  export interface Planner {
    choose(input: PlanInput): Promise<Rank.Candidate | null>
  }

  // Deterministic: take the top-ranked candidate. No LLM, no latency.
  export const DeterministicPlanner: Planner = {
    async choose({ candidates }) {
      return candidates[0] ?? null
    },
  }

  const PLAN_TOPN = 25
  const SYSTEM =
    "You are mapping a web application's IMPORTANT functionality — authentication, user/account " +
    "management, settings, transactions, admin, search, anything business-critical. You do NOT " +
    "test for vulnerabilities. Read the page (what it is, where in the app you are, its structure) " +
    "and the candidate links/forms, then pick the SINGLE best next element to reach the most " +
    "valuable UNVISITED area. Honor the Focus areas when given. Prefer new areas over places already " +
    "well covered. Return one element_id from the list and a short reason."

  // Rich per-step context so the model reasons about the app, not just picks off a flat list:
  // what page this is, where in the app, its structure, the main-model Focus areas, how much is
  // still unexplored, and per-candidate where-it-sits / why-it's-interactive.
  export function buildContext(sessionID: string, state: PageState.StatePayload, shortlist: Rank.Candidate[]): string {
    const byId = new Map(state.clickables.map((c) => [c.id, c]))
    const lines = shortlist.map((c) => {
      const el = byId.get(c.id)
      const section = el && el.section ? ` (in: ${el.section})` : ""
      return `- ${c.id} [${c.kind}] "${c.label}"${section}${c.targetUrl ? ` -> ${c.targetUrl}` : ""}`
    })
    const priorities = WebStrategy.get(sessionID)?.priorities ?? []
    const cov = Crawl.summary(sessionID)
    const forms = (state.forms ?? []).map((f) => (f.fields.map((x) => x.name).filter(Boolean).slice(0, 6).join(", ") || f.action)).filter(Boolean)
    return [
      `URL: ${state.url}`,
      state.description ? `Page: ${state.description}` : "",
      state.location && state.location.length ? `Location: ${state.location.join(" > ")}` : "",
      state.landmarks && state.landmarks.length ? `Structure: ${state.landmarks.map((l) => `${l.role}${l.label ? `(${l.label})` : ""}`).join(", ")}` : "",
      forms.length ? `Forms on page: ${forms.slice(0, 5).map((f) => `[${f}]`).join(" ")}` : "",
      priorities.length ? `Focus areas (app priorities): ${priorities.join(", ")}` : "",
      `Coverage so far: ${cov.pages_visited} pages explored, ${cov.actions} actions used.`,
      `Candidates (choose one element_id):`,
      ...lines,
    ]
      .filter(Boolean)
      .join("\n")
  }

  // Small-model, bounded I/O, structured forced-tool pick. ANY failure (no model, provider
  // error, malformed output) falls back to the deterministic top pick — a broken model must
  // never stall the crawl.
  export const LlmPlanner: Planner = {
    async choose({ sessionID, state, candidates }) {
      if (candidates.length === 0) return null
      const top = candidates[0]
      try {
        const dm = await Provider.defaultModel()
        const model = (await Provider.getSmallModel(dm.providerID).catch(() => undefined)) ?? (await Provider.getModel(dm.providerID, dm.modelID))
        const language = await Provider.getLanguage(model)
        const shortlist = candidates.slice(0, PLAN_TOPN)
        const schema = z.object({
          element_id: z.string().describe("id of the next element to act on, chosen from the candidate list"),
          reason: z.string().describe("one short sentence: why this is the most valuable next step").optional(),
        })
        const result = streamText({
          model: language,
          temperature: 0,
          maxOutputTokens: ProviderTransform.maxOutputTokens(model),
          tools: { choose_next: tool({ description: "Pick the single best next element to explore.", inputSchema: schema }) },
          toolChoice: "required",
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: buildContext(sessionID, state, shortlist) },
          ],
          onError: () => {},
        })
        for await (const part of result.fullStream) if (part.type === "error") throw part.error
        const call = (await result.toolCalls).find((c) => c.toolName === "choose_next")
        const parsed = call ? schema.safeParse(call.input) : undefined
        if (parsed && parsed.success) {
          const match = shortlist.find((c) => c.id === parsed.data.element_id)
          if (match) {
            HBLog.record(sessionID, "codrive", "plan", { picked: match.label, reason: parsed.data.reason ?? "" })
            return match
          }
        }
        return top // nothing usable → deterministic
      } catch (e) {
        log.debug("LlmPlanner fell back to deterministic", { err: String(e) })
        return top
      }
    },
  }

  // Strategist: the MAIN-model reasoning tier → business-logic priorities that bias ranking.
  // Injectable so tests don't call a live model.
  export type Strategist = (sessionID: string, state: PageState.StatePayload) => Promise<string[]>
  // Non-blocking: kick the main-model reasoning off in the BACKGROUND (it caches) and return
  // whatever priorities are cached now. The deterministic loop must never stall waiting on the
  // big model — priorities just sharpen ranking once they arrive.
  const defaultStrategist: Strategist = async (sessionID, state) => {
    void WebStrategy.ensure(sessionID, state).catch(() => {})
    return WebStrategy.get(sessionID)?.priorities ?? []
  }

  // U3 — LLM second-look over the leftovers the deterministic ranker + expander pass (U1) skipped
  // (typically signalless custom widgets). Returns the element to click, or null (nothing worth
  // trying). Injectable; the default calls the small model and NEVER throws (a failure → null →
  // the loop just moves on to the frontier).
  export type SecondLook = (sessionID: string, state: PageState.StatePayload, leftovers: Unexplored.Candidate[]) => Promise<Unexplored.Candidate | null>

  const U3_SYSTEM =
    "These page elements were NOT recognized as normal links or forms — they may be custom menus, " +
    "tabs, accordions or widgets made interactive by scripts, or they may be decorative. Judge which " +
    "ONE, if any, would most likely reveal NEW functionality or navigation when clicked. If none look " +
    "useful, do not pick one. Never pick logout/sign-out or delete/remove controls."

  function buildU3Context(state: PageState.StatePayload, leftovers: Unexplored.Candidate[]): string {
    const byId = new Map(state.clickables.map((c) => [c.id, c]))
    const lines = leftovers.map((c) => {
      const el = byId.get(c.id)
      const bits: string[] = []
      if (el?.role) bits.push(`role=${el.role}`)
      if (el?.why) bits.push(el.why)
      if (el?.aria && Object.keys(el.aria).length) bits.push(`aria=${JSON.stringify(el.aria)}`)
      if (el?.section) bits.push(`in ${el.section}`)
      return `- ${c.id} "${c.label}"${bits.length ? ` (${bits.join("; ")})` : ""}`
    })
    return [`URL: ${state.url}`, state.description ? `Page: ${state.description}` : "", `Un-recognized interactive elements:`, ...lines]
      .filter(Boolean)
      .join("\n")
  }

  const U3_TOPN = 40
  export const defaultSecondLook: SecondLook = async (sessionID, state, leftovers) => {
    if (leftovers.length === 0) return null
    try {
      const dm = await Provider.defaultModel()
      const model = (await Provider.getSmallModel(dm.providerID).catch(() => undefined)) ?? (await Provider.getModel(dm.providerID, dm.modelID))
      const language = await Provider.getLanguage(model)
      const list = leftovers.slice(0, U3_TOPN)
      const schema = z.object({
        element_id: z.string().describe("id of the element to click; OMIT entirely if none is worth clicking").optional(),
        reason: z.string().optional(),
      })
      const result = streamText({
        model: language,
        temperature: 0,
        maxOutputTokens: ProviderTransform.maxOutputTokens(model),
        tools: { second_look: tool({ description: "Pick one element that would reveal new functionality, or none.", inputSchema: schema }) },
        toolChoice: "required",
        messages: [
          { role: "system", content: U3_SYSTEM },
          { role: "user", content: buildU3Context(state, list) },
        ],
        onError: () => {},
      })
      for await (const part of result.fullStream) if (part.type === "error") throw part.error
      const call = (await result.toolCalls).find((c) => c.toolName === "second_look")
      const parsed = call ? schema.safeParse(call.input) : undefined
      if (parsed && parsed.success && parsed.data.element_id) {
        const match = list.find((c) => c.id === parsed.data.element_id)
        if (match) {
          HBLog.record(sessionID, "codrive", "u3-pick", { label: match.label, reason: parsed.data.reason ?? "" })
          return match
        }
      }
      return null // model declined → nothing worth trying here
    } catch (e) {
      log.debug("U3 secondLook failed", { err: String(e) })
      return null
    }
  }

  export interface Options {
    planner?: Planner
    strategist?: Strategist
    secondLook?: SecondLook
    pollMs?: number
    settleMs?: number
    maxIdle?: number
    // Human-like driving: don't click everything mechanically. Jitter the pick among near-top
    // candidates and pause a human-ish "think" time between actions. rng is injectable for tests.
    humanize?: boolean
    thinkMinMs?: number
    thinkMaxMs?: number
    jitterBand?: number
    rng?: () => number
    strategyTimeoutMs?: number // hard cap so a slow/hanging strategist can't stall driving
  }
  const DEFAULTS = { pollMs: 400, settleMs: 1500, maxIdle: 8, humanize: true, thinkMinMs: 350, thinkMaxMs: 1400, jitterBand: 2, strategyTimeoutMs: 5000 }

  // sid → running generation. Presence = running; the loop runs only while its captured
  // generation is still the current one, so a fast Human→AI re-toggle can never double-run.
  const active = new Map<string, number>()
  let seq = 0
  // Urls where the U3 second-look has already run (one LLM pass per page — don't re-ask).
  const u3Done = new Map<string, Set<string>>()
  function u3Seen(sessionID: string, url: string): boolean {
    let s = u3Done.get(sessionID)
    if (!s) {
      s = new Set()
      u3Done.set(sessionID, s)
    }
    if (s.has(url)) return true
    s.add(url)
    return false
  }

  export function isRunning(sessionID: string): boolean {
    return active.has(sessionID)
  }
  export function stop(sessionID: string): void {
    active.delete(sessionID)
  }
  interface Cfg {
    planner: Planner
    strategist: Strategist
    secondLook: SecondLook
    pollMs: number
    settleMs: number
    maxIdle: number
    humanize: boolean
    thinkMinMs: number
    thinkMaxMs: number
    jitterBand: number
    rng: () => number
    strategyTimeoutMs: number
  }

  export function start(sessionID: string, opts: Options = {}): void {
    if (active.has(sessionID)) return
    const gen = ++seq
    active.set(sessionID, gen)
    HBLog.record(sessionID, "codrive", "start")
    const cfg: Cfg = {
      planner: opts.planner ?? LlmPlanner,
      strategist: opts.strategist ?? defaultStrategist,
      secondLook: opts.secondLook ?? defaultSecondLook,
      pollMs: opts.pollMs ?? DEFAULTS.pollMs,
      settleMs: opts.settleMs ?? DEFAULTS.settleMs,
      maxIdle: opts.maxIdle ?? DEFAULTS.maxIdle,
      humanize: opts.humanize ?? DEFAULTS.humanize,
      thinkMinMs: opts.thinkMinMs ?? DEFAULTS.thinkMinMs,
      thinkMaxMs: opts.thinkMaxMs ?? DEFAULTS.thinkMaxMs,
      jitterBand: opts.jitterBand ?? DEFAULTS.jitterBand,
      rng: opts.rng ?? Math.random,
      strategyTimeoutMs: opts.strategyTimeoutMs ?? DEFAULTS.strategyTimeoutMs,
    }
    void loop(sessionID, gen, cfg)
      .catch((e) => log.error("codrive loop crashed", { err: String(e) }))
      .finally(() => {
        if (active.get(sessionID) === gen) active.delete(sessionID)
      })
  }

  // Human-like pick: choose randomly among the items within jitterBand of the top score, so
  // exploration order isn't rigidly mechanical. Order changes, coverage does not (visited-
  // tracking + frontier still reach everything). Generic over links AND forms.
  function pickBand<T extends { score: number }>(items: T[], rng: () => number, band: number): T {
    const top = items[0].score
    const pool = items.filter((x) => x.score >= top - band)
    return pool[Math.floor(rng() * pool.length)] ?? items[0]
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  // One thing the loop can do next: follow a link, or fill+submit a form.
  type Action = { kind: "click"; cand: Rank.Candidate } | { kind: "form"; form: WebFormFill.FormCandidate }
  // Statuses that mean "the whole loop should stop", not just "this action failed".
  function stopStatus(s: WebAct.Status): boolean {
    return s === "human-driving" || s === "no-extension" || s === "budget"
  }
  function thinkTime(cfg: Cfg): number {
    if (!cfg.humanize) return 0
    const lo = Math.min(cfg.thinkMinMs, cfg.thinkMaxMs)
    const hi = Math.max(cfg.thinkMinMs, cfg.thinkMaxMs)
    return lo + Math.floor(cfg.rng() * (hi - lo + 1))
  }

  // Strategy priorities, but never let a slow/hanging main model stall the drive loop.
  async function strategyPriorities(sessionID: string, state: PageState.StatePayload, cfg: Cfg): Promise<string[]> {
    return Promise.race([
      cfg.strategist(sessionID, state).catch(() => [] as string[]),
      sleep(cfg.strategyTimeoutMs).then(() => [] as string[]),
    ])
  }

  async function loop(sessionID: string, gen: number, cfg: Cfg) {
    let idle = 0
    let reason = "ended"
    const alive = () => active.get(sessionID) === gen
    while (alive()) {
      if (WebDriver.isHuman(sessionID)) { reason = "human-took-over"; break }
      if (!WebControl.connected(sessionID)) { reason = "no-extension-connected"; break }
      if (Crawl.overBudget(sessionID)) { reason = "budget-exhausted"; break }
      const state = PageState.current(sessionID)
      if (!state) {
        if (++idle > cfg.maxIdle) { reason = "no-page-observed"; break } // extension not posting /web/observe
        await sleep(cfg.pollMs)
        continue
      }
      idle = 0
      Crawl.markPage(sessionID, state.url)
      WebScope.ensure(sessionID, state.url) // bound the crawl to the target's domain (first page wins)
      const priorities = await strategyPriorities(sessionID, state, cfg)
      if (!alive()) { reason = "stopped"; break }
      const clickCands = Rank.candidates(sessionID, state, priorities)
      // Remember every discovered target so a dead-end can backtrack to an unvisited page.
      Crawl.discover(sessionID, clickCands.map((c) => c.targetUrl))
      const formCands = WebFormFill.candidates(sessionID, state, priorities)

      if (clickCands.length === 0 && formCands.length === 0) {
        // U1: before leaving a page, try an opener the deterministic ranker deliberately
        // skipped (custom menu/tab/accordion) — it may reveal links/forms behind it.
        const exp = Unexplored.expanders(sessionID, state)
        if (exp.length > 0) {
          const pick = cfg.humanize ? pickBand(exp, cfg.rng, cfg.jitterBand) : exp[0]
          const pause = thinkTime(cfg)
          if (pause > 0) await sleep(pause)
          if (!alive()) { reason = "stopped"; break }
          HBLog.record(sessionID, "codrive", "act", { kind: "opener", label: pick.label, url: state.url })
          if ((await clickAndLearn(sessionID, state, pick.actionKey, pick.id, cfg)) === "stop") { reason = "act-stop"; break }
          continue
        }
        // U3: one LLM second-look per page over the leftovers the deterministic passes skipped
        // (signalless custom widgets). The model judges which, if any, reveals functionality.
        if (!u3Seen(sessionID, state.url)) {
          const left = Unexplored.leftovers(sessionID, state)
          if (left.length > 0) {
            const pick = await cfg.secondLook(sessionID, state, left)
            if (!alive()) { reason = "stopped"; break }
            if (pick) {
              const pause = thinkTime(cfg)
              if (pause > 0) await sleep(pause)
              if (!alive()) { reason = "stopped"; break }
              HBLog.record(sessionID, "codrive", "act", { kind: "u3", label: pick.label, url: state.url })
              if ((await clickAndLearn(sessionID, state, pick.actionKey, pick.id, cfg)) === "stop") { reason = "act-stop"; break }
              continue
            }
          }
        }
        // Dead end — jump to a discovered-but-unvisited page, else done.
        const next = Crawl.takeFrontier(sessionID)
        if (!next) { reason = "coverage-complete"; break } // nothing left to explore anywhere reachable
        HBLog.record(sessionID, "codrive", "act", { kind: "navigate", url: next })
        const nav = await WebAct.perform(sessionID, { op: "navigate", url: next })
        if (!nav.ok && stopStatus(nav.status)) { reason = "act-stop:" + nav.status; break }
        await settle(sessionID, state.url, cfg)
        continue
      }

      const action = await decide(sessionID, state, clickCands, formCands, cfg)
      if (!action) { reason = "no-action"; break }
      if (!alive()) { reason = "stopped"; break } // driver may have flipped while the planner was thinking
      const pause = thinkTime(cfg) // human-ish think time before acting
      if (pause > 0) await sleep(pause)
      if (!alive()) { reason = "stopped"; break }

      if (action.kind === "form") {
        HBLog.record(sessionID, "codrive", "act", { kind: "form", label: action.form.label, url: state.url })
        if ((await executeForm(sessionID, state, action.form)) === "stop") { reason = "act-stop"; break }
        await settle(sessionID, state.url, cfg)
        continue
      }

      HBLog.record(sessionID, "codrive", "act", { kind: "click", label: action.cand.label, url: state.url })
      if ((await clickAndLearn(sessionID, state, action.cand.actionKey, action.cand.id, cfg)) === "stop") { reason = "act-stop"; break }
    }
    HBLog.record(sessionID, "codrive", "stop", { reason, actions: Crawl.summary(sessionID).actions, pages: Crawl.summary(sessionID).pages_visited })
  }

  // Click an element, wait for the page to settle, and record what it DID (U2 effect-tracking):
  // productive = it revealed new content IN PLACE (same url, more clickables), the Load-more /
  // expander signal that earns a re-admission; a navigation or a no-op does not. A failed click
  // is recorded so the loop can't spin on it. Shared by the link and opener branches (DRY).
  async function clickAndLearn(sessionID: string, state: PageState.StatePayload, key: string, elementId: string, cfg: Cfg): Promise<"stop" | "done"> {
    const beforeUrl = state.url
    const beforeCount = state.clickables.length
    const r = await WebAct.perform(sessionID, { op: "click", url: beforeUrl, elementId })
    if (!r.ok) {
      if (stopStatus(r.status)) return "stop"
      Crawl.record(sessionID, key) // stale/unknown → exclude so the loop makes progress
      Effect.onClick(sessionID, key, false)
      return "done"
    }
    await settle(sessionID, beforeUrl, cfg)
    const after = PageState.current(sessionID)
    const productive = !!after && after.url === beforeUrl && after.clickables.length > beforeCount
    Effect.onClick(sessionID, key, productive) // WebAct already marked it acted; this re-admits if productive
    return "done"
  }

  // Pick the next action across links AND forms. Whenever there is a real choice among links
  // (2+), the context-rich planner reasons about the most valuable next move — this is what
  // makes the crawl deliberate instead of mechanically walking the score order. A top-scoring
  // form wins deterministically (forms are high-value and deterministic to run); a single
  // candidate or a planner that declines falls back to the deterministic (humanized) top.
  async function decide(
    sessionID: string,
    state: PageState.StatePayload,
    clickCands: Rank.Candidate[],
    formCands: WebFormFill.FormCandidate[],
    cfg: Cfg,
  ): Promise<Action | null> {
    const merged: { score: number; action: Action }[] = [
      ...clickCands.map((c) => ({ score: c.score, action: { kind: "click", cand: c } as Action })),
      ...formCands.map((f) => ({ score: f.score, action: { kind: "form", form: f } as Action })),
    ].sort((a, b) => b.score - a.score)
    if (merged.length === 0) return null

    if (merged[0].action.kind === "form") return merged[0].action
    if (clickCands.length >= 2) {
      const c = await cfg.planner.choose({ sessionID, state, candidates: clickCands })
      if (c) return { kind: "click", cand: c }
    }
    return (cfg.humanize ? pickBand(merged, cfg.rng, cfg.jitterBand) : merged[0]).action
  }

  // Fill a form's typeable fields (human-like keystrokes via WebAct) then click submit — which
  // is guarded like any action (destructive→confirm, logout→deny already excluded by formfill).
  // Returns "stop" only when the whole loop should end. The form is recorded either way so it
  // is not refilled.
  async function executeForm(sessionID: string, state: PageState.StatePayload, form: WebFormFill.FormCandidate): Promise<"ok" | "stop"> {
    for (const fill of form.fills) {
      if (WebDriver.isHuman(sessionID)) return "stop"
      const r = await WebAct.perform(sessionID, { op: "type", url: state.url, elementId: fill.id, text: fill.value })
      if (!r.ok && stopStatus(r.status)) return "stop"
      // a single field failing (stale id) is non-fatal — keep filling the rest.
    }
    const submit = await WebAct.perform(sessionID, { op: "click", url: state.url, elementId: form.submitId })
    Crawl.record(sessionID, form.actionKey) // don't refill this form, even if submit was blocked
    if (!submit.ok && stopStatus(submit.status)) return "stop"
    return "ok"
  }

  // Wait (briefly) for the extension to push a fresh observation after an action, so the next
  // iteration ranks the NEW page. Returns as soon as url or observed_at changes, or on timeout.
  async function settle(sessionID: string, prevUrl: string, cfg: { settleMs: number; pollMs: number }) {
    const started = Date.now()
    const before = PageState.current(sessionID)?.observed_at ?? 0
    while (Date.now() - started < cfg.settleMs) {
      const now = PageState.current(sessionID)
      if (now && (now.url !== prevUrl || (now.observed_at ?? 0) > before)) return
      await sleep(cfg.pollMs)
    }
  }

  export function _reset(): void {
    active.clear()
    u3Done.clear()
  }
}

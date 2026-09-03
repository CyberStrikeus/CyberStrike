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
import { WebStrategy } from "./strategy"
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
    "You navigate a web application to discover its pages and endpoints. You do NOT test for " +
    "vulnerabilities — that is a separate job. Given the current page and a shortlist of unvisited " +
    "links/queries, pick the SINGLE best next element to explore for the broadest coverage, " +
    "preferring navigation that reaches new areas. Return exactly one element_id from the list."

  function buildContext(state: PageState.StatePayload, shortlist: Rank.Candidate[]): string {
    const lines = shortlist.map((c) => `- ${c.id} [${c.kind}] "${c.label}"${c.targetUrl ? ` -> ${c.targetUrl}` : ""}`)
    return [
      `URL: ${state.url}`,
      state.description ? `Page: ${state.description}` : "",
      state.location && state.location.length ? `Location: ${state.location.join(" > ")}` : "",
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
    async choose({ state, candidates }) {
      if (candidates.length === 0) return null
      const top = candidates[0]
      try {
        const dm = await Provider.defaultModel()
        const model = (await Provider.getSmallModel(dm.providerID).catch(() => undefined)) ?? (await Provider.getModel(dm.providerID, dm.modelID))
        const language = await Provider.getLanguage(model)
        const shortlist = candidates.slice(0, PLAN_TOPN)
        const schema = z.object({ element_id: z.string().describe("id of the next element to act on, chosen from the candidate list") })
        const result = streamText({
          model: language,
          temperature: 0,
          maxOutputTokens: ProviderTransform.maxOutputTokens(model),
          tools: { choose_next: tool({ description: "Pick the single best next element to explore.", inputSchema: schema }) },
          toolChoice: "required",
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: buildContext(state, shortlist) },
          ],
          onError: () => {},
        })
        for await (const part of result.fullStream) if (part.type === "error") throw part.error
        const call = (await result.toolCalls).find((c) => c.toolName === "choose_next")
        const parsed = call ? schema.safeParse(call.input) : undefined
        if (parsed && parsed.success) {
          const match = shortlist.find((c) => c.id === parsed.data.element_id)
          if (match) return match
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
  const defaultStrategist: Strategist = async (sessionID, state) => (await WebStrategy.ensure(sessionID, state)).priorities

  export interface Options {
    planner?: Planner
    strategist?: Strategist
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
  }
  const DEFAULTS = { pollMs: 400, settleMs: 1500, maxIdle: 8, humanize: true, thinkMinMs: 350, thinkMaxMs: 1400, jitterBand: 2 }
  // Skip the planner (auto-advance) when the top candidate clearly dominates.
  const AUTO_MARGIN = 2

  // sid → running generation. Presence = running; the loop runs only while its captured
  // generation is still the current one, so a fast Human→AI re-toggle can never double-run.
  const active = new Map<string, number>()
  let seq = 0

  export function isRunning(sessionID: string): boolean {
    return active.has(sessionID)
  }
  export function stop(sessionID: string): void {
    active.delete(sessionID)
  }
  interface Cfg {
    planner: Planner
    strategist: Strategist
    pollMs: number
    settleMs: number
    maxIdle: number
    humanize: boolean
    thinkMinMs: number
    thinkMaxMs: number
    jitterBand: number
    rng: () => number
  }

  export function start(sessionID: string, opts: Options = {}): void {
    if (active.has(sessionID)) return
    const gen = ++seq
    active.set(sessionID, gen)
    const cfg: Cfg = {
      planner: opts.planner ?? LlmPlanner,
      strategist: opts.strategist ?? defaultStrategist,
      pollMs: opts.pollMs ?? DEFAULTS.pollMs,
      settleMs: opts.settleMs ?? DEFAULTS.settleMs,
      maxIdle: opts.maxIdle ?? DEFAULTS.maxIdle,
      humanize: opts.humanize ?? DEFAULTS.humanize,
      thinkMinMs: opts.thinkMinMs ?? DEFAULTS.thinkMinMs,
      thinkMaxMs: opts.thinkMaxMs ?? DEFAULTS.thinkMaxMs,
      jitterBand: opts.jitterBand ?? DEFAULTS.jitterBand,
      rng: opts.rng ?? Math.random,
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

  async function loop(sessionID: string, gen: number, cfg: Cfg) {
    let idle = 0
    const alive = () => active.get(sessionID) === gen
    while (alive()) {
      if (WebDriver.isHuman(sessionID)) break // human took over
      if (!WebControl.connected(sessionID)) break // no browser attached
      if (Crawl.overBudget(sessionID)) break // budget cap
      const state = PageState.current(sessionID)
      if (!state) {
        if (++idle > cfg.maxIdle) break // no page ever observed
        await sleep(cfg.pollMs)
        continue
      }
      idle = 0
      Crawl.markPage(sessionID, state.url)
      // MAIN-model strategy (sparingly cached) → business-logic priorities that bias ranking.
      const priorities = await cfg.strategist(sessionID, state).catch(() => [])
      if (!alive()) break
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
          if (!alive()) break
          if ((await clickAndLearn(sessionID, state, pick.actionKey, pick.id, cfg)) === "stop") break
          continue
        }
        // Dead end — jump to a discovered-but-unvisited page, else done.
        const next = Crawl.takeFrontier(sessionID)
        if (!next) break // true coverage: no reachable page has unvisited link/form/opener left
        const nav = await WebAct.perform(sessionID, { op: "navigate", url: next })
        if (!nav.ok && stopStatus(nav.status)) break
        await settle(sessionID, state.url, cfg)
        continue
      }

      const action = await decide(sessionID, state, clickCands, formCands, cfg)
      if (!action) break
      if (!alive()) break // driver may have flipped while the planner was thinking
      const pause = thinkTime(cfg) // human-ish think time before acting
      if (pause > 0) await sleep(pause)
      if (!alive()) break

      if (action.kind === "form") {
        if ((await executeForm(sessionID, state, action.form)) === "stop") break
        await settle(sessionID, state.url, cfg)
        continue
      }

      if ((await clickAndLearn(sessionID, state, action.cand.actionKey, action.cand.id, cfg)) === "stop") break
    }
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

  // Pick the next action across links AND forms. Genuine link-only ambiguity → the (small-model)
  // planner; otherwise deterministic, humanized order over the merged, score-sorted set.
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

    const clickAmbiguous = clickCands.length >= 2 && clickCands[0].score - clickCands[1].score < AUTO_MARGIN
    if (merged[0].action.kind === "click" && clickAmbiguous && formCands.length === 0) {
      const c = await cfg.planner.choose({ sessionID, state, candidates: clickCands })
      return c ? { kind: "click", cand: c } : null
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
  }
}

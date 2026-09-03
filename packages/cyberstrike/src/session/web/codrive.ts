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

  function autoAdvance(cands: Rank.Candidate[]): boolean {
    if (cands.length === 1) return true
    return cands[0].score - cands[1].score >= AUTO_MARGIN
  }
  // Human-like pick: choose randomly among the candidates within jitterBand of the top score,
  // so exploration order isn't rigidly mechanical. Order changes, coverage does not (visited-
  // tracking + frontier still reach every candidate).
  function pickHumanized(cands: Rank.Candidate[], rng: () => number, band: number): Rank.Candidate {
    const top = cands[0].score
    const pool = cands.filter((c) => c.score >= top - band)
    return pool[Math.floor(rng() * pool.length)] ?? cands[0]
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
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
      const cands = Rank.candidates(sessionID, state, priorities)
      // Remember every discovered target so a dead-end can backtrack to an unvisited page.
      Crawl.discover(sessionID, cands.map((c) => c.targetUrl))

      if (cands.length === 0) {
        // Nothing left on THIS page — jump to a discovered-but-unvisited page, else done.
        const next = Crawl.takeFrontier(sessionID)
        if (!next) break // true coverage: no reachable page has unvisited nav/query left
        const nav = await WebAct.perform(sessionID, { op: "navigate", url: next })
        if (!nav.ok && (nav.status === "human-driving" || nav.status === "no-extension" || nav.status === "budget")) break
        await settle(sessionID, state.url, cfg)
        continue
      }

      // Clear pick → deterministic (humanized order); genuine ambiguity → planner (small model).
      const chosen = autoAdvance(cands)
        ? cfg.humanize
          ? pickHumanized(cands, cfg.rng, cfg.jitterBand)
          : cands[0]
        : await cfg.planner.choose({ sessionID, state, candidates: cands })
      if (!chosen) break
      if (!alive()) break // driver may have flipped while the planner was thinking
      const pause = thinkTime(cfg) // human-ish think time before acting
      if (pause > 0) await sleep(pause)
      if (!alive()) break
      const result = await WebAct.perform(sessionID, { op: "click", url: state.url, elementId: chosen.id })
      if (!result.ok) {
        if (result.status === "human-driving" || result.status === "no-extension" || result.status === "budget") break
        // denied/confirm won't appear (rank excludes them); unknown/relay-failed = stale DOM.
        // Record the key so this candidate can't be re-picked → the candidate set strictly
        // shrinks → the loop always makes progress and terminates.
        Crawl.record(sessionID, chosen.actionKey)
        continue
      }
      await settle(sessionID, state.url, cfg)
    }
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

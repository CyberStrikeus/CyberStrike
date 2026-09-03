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

  export interface Options {
    planner?: Planner
    pollMs?: number
    settleMs?: number
    maxIdle?: number
  }
  const DEFAULTS = { pollMs: 400, settleMs: 1500, maxIdle: 8 }
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
  export function start(sessionID: string, opts: Options = {}): void {
    if (active.has(sessionID)) return
    const gen = ++seq
    active.set(sessionID, gen)
    const planner = opts.planner ?? LlmPlanner
    const cfg = { pollMs: opts.pollMs ?? DEFAULTS.pollMs, settleMs: opts.settleMs ?? DEFAULTS.settleMs, maxIdle: opts.maxIdle ?? DEFAULTS.maxIdle }
    void loop(sessionID, gen, planner, cfg)
      .catch((e) => log.error("codrive loop crashed", { err: String(e) }))
      .finally(() => {
        if (active.get(sessionID) === gen) active.delete(sessionID)
      })
  }

  function autoAdvance(cands: Rank.Candidate[]): boolean {
    if (cands.length === 1) return true
    return cands[0].score - cands[1].score >= AUTO_MARGIN
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  async function loop(sessionID: string, gen: number, planner: Planner, cfg: { pollMs: number; settleMs: number; maxIdle: number }) {
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
      const cands = Rank.candidates(sessionID, state)
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

      const chosen = autoAdvance(cands) ? cands[0] : await planner.choose({ sessionID, state, candidates: cands })
      if (!chosen) break
      if (!alive()) break // driver may have flipped while the planner was thinking
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

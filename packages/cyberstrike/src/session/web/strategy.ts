// Strategic reasoning tier for the co-driving crawl — the MAIN (big) model's job.
//
// The per-step planner is deterministic/small-model and fast, but it can't reason about the
// app as a whole. This tier asks the MAIN model, sparingly, the high-level questions a human
// pentester asks first: what is this app for, which functions matter, which areas should be
// explored FIRST given the business logic. The answer ("priorities") biases the deterministic
// ranking so the crawl spends its budget where it counts instead of clicking everything blindly.
//
// Cost control: the big model runs only when there is something new to reason about — on the
// first page, when the host/area changes, or every REFRESH_PAGES pages. The result is cached
// per session. Any failure caches an empty plan (no bias) so a missing/erroring model never
// stalls or hammers.
import { streamText, tool } from "ai"
import z from "zod"
import { PageState } from "./page-state"
import { Crawl } from "./crawl"
import { Provider } from "../../provider/provider"
import { ProviderTransform } from "../../provider/transform"
import { Log } from "../../util/log"

const log = Log.create({ service: "web-strategy" })

export namespace WebStrategy {
  export interface Plan {
    purpose: string // one-line app purpose
    priorities: string[] // labels / sections / keywords to explore first (business-logic driven)
    host: string // host this plan was computed for
    atPage: number // pages_visited when computed (for the refresh cadence)
  }
  // Injectable so tests can drive cadence/caching without a live model.
  export type Reasoner = (state: PageState.StatePayload) => Promise<{ purpose: string; priorities: string[] }>

  const REFRESH_PAGES = 15
  const bySession = new Map<string, Plan>()

  function host(url: string): string {
    try {
      return new URL(url).host
    } catch {
      return ""
    }
  }
  function shouldRecompute(prev: Plan | undefined, url: string, pages: number): boolean {
    if (!prev) return true
    if (prev.host !== host(url)) return true // new area
    if (pages - prev.atPage >= REFRESH_PAGES) return true // periodic refresh
    return false
  }

  export function get(sessionID: string): Plan | undefined {
    return bySession.get(sessionID)
  }

  // Return the current strategy, recomputing (via the main model) only when the cadence says
  // there is something new to reason about. Never throws.
  export async function ensure(sessionID: string, state: PageState.StatePayload, reasoner: Reasoner = mainModelReasoner): Promise<Plan> {
    const prev = bySession.get(sessionID)
    const pages = Crawl.summary(sessionID).pages_visited
    if (!shouldRecompute(prev, state.url, pages)) return prev as Plan
    let out: { purpose: string; priorities: string[] } = { purpose: "", priorities: [] }
    try {
      out = await reasoner(state)
    } catch (e) {
      log.debug("strategy reasoner failed; caching empty plan", { err: String(e) })
    }
    const plan: Plan = { purpose: out.purpose ?? "", priorities: Array.isArray(out.priorities) ? out.priorities.slice(0, 20) : [], host: host(state.url), atPage: pages }
    bySession.set(sessionID, plan)
    return plan
  }

  const SYSTEM =
    "You are a senior penetration tester planning how to explore a web application for MAXIMUM " +
    "coverage of its important functionality. You are NOT testing for vulnerabilities here — you " +
    "are deciding WHERE to look first. Given a page, infer the app's overall purpose and, from its " +
    "business logic, list the areas/functions worth exploring FIRST (labels, sections or url keywords). " +
    "Return a one-line purpose and an ordered priorities list (most important first)."

  function context(state: PageState.StatePayload): string {
    const kinds = new Map<string, string[]>()
    for (const c of state.clickables.slice(0, 120)) {
      const k = c.kind ?? "other"
      if (!kinds.has(k)) kinds.set(k, [])
      const arr = kinds.get(k)!
      if (arr.length < 20 && c.label) arr.push(c.label)
    }
    const lines: string[] = [`URL: ${state.url}`, `Title: ${state.title}`]
    if (state.description) lines.push(`Description: ${state.description}`)
    if (state.location && state.location.length) lines.push(`Location: ${state.location.join(" > ")}`)
    if (state.landmarks && state.landmarks.length) lines.push(`Landmarks: ${state.landmarks.map((l) => `${l.role}${l.label ? `(${l.label})` : ""}`).join(", ")}`)
    for (const [k, labels] of kinds) lines.push(`${k}: ${labels.join(", ")}`)
    return lines.join("\n")
  }

  // The MAIN model — deliberately NOT getSmallModel: this high-level business-logic reasoning
  // is what a small model tends to do poorly.
  export const mainModelReasoner: Reasoner = async (state) => {
    const dm = await Provider.defaultModel()
    const model = await Provider.getModel(dm.providerID, dm.modelID)
    const language = await Provider.getLanguage(model)
    const schema = z.object({
      purpose: z.string().describe("one-line description of what this application is for"),
      priorities: z.array(z.string()).describe("areas/functions to explore first, most important first (labels, sections or url keywords)"),
    })
    const result = streamText({
      model: language,
      temperature: 0,
      maxOutputTokens: ProviderTransform.maxOutputTokens(model),
      tools: { plan_strategy: tool({ description: "Report the app purpose and the prioritized areas to explore.", inputSchema: schema }) },
      toolChoice: "required",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: context(state) },
      ],
      onError: () => {},
    })
    for await (const part of result.fullStream) if (part.type === "error") throw part.error
    const call = (await result.toolCalls).find((c) => c.toolName === "plan_strategy")
    const parsed = call ? schema.safeParse(call.input) : undefined
    if (parsed && parsed.success) return { purpose: parsed.data.purpose, priorities: parsed.data.priorities }
    return { purpose: "", priorities: [] }
  }

  export function _reset(): void {
    bySession.clear()
  }
}

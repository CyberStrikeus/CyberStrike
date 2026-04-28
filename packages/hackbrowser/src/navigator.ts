import { generateText, type LanguageModel } from "ai"
import { Log } from "./log.ts"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import type { PagePlan, PageTask, PageStateKind, RevisitTrigger } from "./types.ts"
import type { PlannerSnapshot } from "./state.ts"

// Bundle the planner prompt as text at import time. Previously this used
// readFileSync(import.meta.url + "prompt/planner.txt"), which works fine
// under `bun src/index.ts` (interpreted) but **fails** inside a Bun
// `--compile` single binary: the file is not in BunFS and runtime
// resolution returns ENOENT. Text import lets Bun embed the file content
// into the bundle, identical behavior across both modes.
import plannerPromptText from "./prompt/planner.txt" with { type: "text" }

const log = Log.create({ service: "hackbrowser:navigator" })

// ============================================================
// Prompt loading
// ============================================================

function loadPlannerPrompt(): string {
  return plannerPromptText
}

// ============================================================
// Model resolution
// ============================================================

let cachedModel: LanguageModel | null = null

/**
 * Resolve a LanguageModel.
 *
 * Hackbrowser is intentionally decoupled from cyberstrike's Provider system
 * (Karar 2 — Dependency Inversion, INTEGRATION.md §5). Resolution order:
 *   1. `override` parameter — used by cyberstrike launcher which resolves
 *      via Provider and passes the result through `runCrawl({ model })`.
 *   2. ANTHROPIC_API_KEY env var
 *   3. OPENAI_API_KEY env var
 *
 * Standalone (`bun src/index.ts`) only sees env vars — `cyberstrike auth
 * login` providers are not available here (Karar 3, INTEGRATION.md §10.2).
 */
export async function resolveModel(override?: LanguageModel): Promise<LanguageModel> {
  if (override) {
    cachedModel = override
    log.info("model resolved via opts.model (cyberstrike injection)")
    return cachedModel
  }
  if (cachedModel) return cachedModel

  if (process.env.ANTHROPIC_API_KEY) {
    const model = process.env.BROWSER_AGENT_MODEL ?? "claude-sonnet-4-6"
    log.info("model resolved via ANTHROPIC_API_KEY", { model })
    cachedModel = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(model)
    return cachedModel
  }

  if (process.env.OPENAI_API_KEY) {
    const model = process.env.BROWSER_AGENT_MODEL ?? "gpt-4o"
    log.info("model resolved via OPENAI_API_KEY", { model })
    cachedModel = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(model)
    return cachedModel
  }

  throw new Error(
    "No AI provider available. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, " +
      "or invoke runCrawl({ model }) with a pre-resolved model.",
  )
}

// ============================================================
// LLM planner — one call per page
// ============================================================

/**
 * Analyze a page snapshot and return a plan of what to explore.
 * Called once per page (not per action step).
 * Falls back to empty plan on failure so exploration can continue.
 */
export async function planPage(
  snapshot: PlannerSnapshot,
  model: LanguageModel,
): Promise<PagePlan> {
  const systemPrompt = loadPlannerPrompt()
  const userMessage = JSON.stringify(snapshot)

  const attempt = async (): Promise<PagePlan> => {
    const result = await generateText({
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      maxOutputTokens: 2048,
      temperature: 0,
    })

    const raw = result.text.trim()
    log.debug("planner response", { length: raw.length, raw: raw.slice(0, 500) })

    // Extract JSON object from response
    const start = raw.indexOf("{")
    const end = raw.lastIndexOf("}")
    if (start === -1 || end === -1) return { tasks: [] }  // LLM said "nothing to do"

    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
    return validatePlan(parsed)
  }

  try {
    const plan = await attempt()
    log.debug("page plan", { tasks: plan.tasks.length })
    return plan
  } catch (err) {
    log.warn("planPage failed, retrying once", { err: String(err) })
    try {
      return await attempt()
    } catch (err2) {
      log.error("planPage failed after retry, returning empty plan", { err: String(err2) })
      return { tasks: [] }
    }
  }
}

// ============================================================
// LLM planner — unexplored elements follow-up
// ============================================================

/**
 * Ask LLM to plan actions for elements that were NOT explored in the first pass.
 * Only unexplored elements are sent — LLM cannot re-plan already-done actions.
 * Architecture: "System Observes, LLM Interprets"
 */
export async function planUnexploredElements(
  snapshot: PlannerSnapshot,
  unexploredLabels: string[],
  model: LanguageModel,
): Promise<PagePlan> {
  const systemPrompt = loadPlannerPrompt()

  // Send only unexplored elements to LLM — prevents re-planning already-done actions
  const unexploredSet = new Set(unexploredLabels.map(l => {
    // Extract label from "[role] label" format
    const match = l.match(/^\[.*?\]\s*(.+)$/)
    return match ? match[1] : l
  }))
  const filteredElements = snapshot.elements.filter(e => unexploredSet.has(e.label))

  const userMessage = JSON.stringify({
    url: snapshot.url,
    viewportCenterBlocked: snapshot.viewportCenterBlocked,
    totalPagesVisited: snapshot.totalPagesVisited,
    elements: filteredElements,
    instruction: "These elements were NOT explored yet. Plan actions for the ones that could trigger new HTTP endpoints or reveal hidden functionality.",
  })

  const attempt = async (): Promise<PagePlan> => {
    const result = await generateText({
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      maxOutputTokens: 2048,
      temperature: 0,
    })

    const raw = result.text.trim()
    log.debug("unexplored planner response", { length: raw.length, raw: raw.slice(0, 500) })

    const start = raw.indexOf("{")
    const end = raw.lastIndexOf("}")
    if (start === -1 || end === -1) return { tasks: [] }

    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
    return validatePlan(parsed)
  }

  try {
    const plan = await attempt()
    log.debug("unexplored plan", { tasks: plan.tasks.length })
    return plan
  } catch (err) {
    log.warn("planUnexploredElements failed", { err: String(err) })
    return { tasks: [] }
  }
}

// ============================================================
// Validation
// ============================================================

function validatePlan(raw: Record<string, unknown>): PagePlan {
  if (!Array.isArray(raw["tasks"])) return { tasks: [] }

  const tasks: PageTask[] = []
  for (const t of raw["tasks"] as unknown[]) {
    const task = t as Record<string, unknown>
    const triggersMutation = typeof task["triggersMutation"] === "string" && task["triggersMutation"].length > 0
      ? (task["triggersMutation"] as string)
      : undefined
    if (task["type"] === "form") {
      const fields = Array.isArray(task["fields"])
        ? (task["fields"] as Record<string, unknown>[]).map(f => ({
            role: String(f["role"] ?? ""),
            label: String(f["label"] ?? ""),
            value: String(f["value"] ?? ""),
          }))
        : []
      const sub = task["submit"] as Record<string, unknown> | undefined
      if (fields.length > 0 && sub) {
        tasks.push({
          type: "form",
          fields,
          submit: { role: String(sub["role"] ?? "button"), label: String(sub["label"] ?? "") },
          triggersMutation,
        })
      }
    } else if (task["type"] === "click") {
      const role = String(task["role"] ?? "")
      const label = String(task["label"] ?? "")
      if (role && label) {
        tasks.push({ type: "click", role, label, reason: task["reason"] as string | undefined, triggersMutation })
      }
    }
  }

  return { tasks, ...validateIntelligence(raw) }
}

/**
 * Validate PagePlan v2 Intelligence fields (Aşama 13 §3.3.1):
 * pageState, revisitAfter, revisitReason.
 * All optional — missing/invalid fields fall to safe defaults.
 * revisitReason is REQUIRED when pageState === "empty" (Zod-style refinement).
 * Exported for unit testing — primary callers use validatePlan.
 */
export function validateIntelligence(raw: Record<string, unknown>): {
  pageState?: PageStateKind
  revisitAfter?: RevisitTrigger | null
  revisitReason?: string
  revisitOn?: string
} {
  const out: {
    pageState?: PageStateKind
    revisitAfter?: RevisitTrigger | null
    revisitReason?: string
    revisitOn?: string
  } = {}

  const ps = raw["pageState"]
  if (ps === "populated" || ps === "empty" || ps === "unknown") {
    out.pageState = ps
  }

  const ra = raw["revisitAfter"]
  if (ra === "any-mutation") {
    out.revisitAfter = "any-mutation"
  } else if (ra === null) {
    out.revisitAfter = null
  }

  const reason = raw["revisitReason"]
  if (typeof reason === "string" && reason.length > 0) {
    out.revisitReason = reason
  }

  const on = raw["revisitOn"]
  if (typeof on === "string" && on.length > 0) {
    out.revisitOn = on
  }

  // Refinement: if pageState="empty" but revisitReason missing, log and
  // downgrade to "unknown" (safe default). This enforces §3.3.1 contract
  // without crashing on LLM drift.
  if (out.pageState === "empty" && !out.revisitReason) {
    log.warn("pageState='empty' without revisitReason — downgrading to 'unknown'")
    out.pageState = "unknown"
    out.revisitAfter = null
    out.revisitOn = undefined
  }

  return out
}

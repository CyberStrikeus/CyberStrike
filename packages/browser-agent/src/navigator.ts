import { generateText, type LanguageModel } from "ai"
import { Provider } from "cyberstrike/provider/provider"
import { Log } from "cyberstrike/util/log"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import type { PagePlan, PageTask } from "./types.ts"
import type { PlannerSnapshot } from "./state.ts"

const log = Log.create({ service: "browser-agent:navigator" })

// ============================================================
// Prompt loading
// ============================================================

const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), "prompt")

let cachedPlannerPrompt: string | null = null

function loadPlannerPrompt(): string {
  if (cachedPlannerPrompt) return cachedPlannerPrompt
  cachedPlannerPrompt = readFileSync(join(PROMPT_DIR, "planner.txt"), "utf-8")
  return cachedPlannerPrompt
}

// ============================================================
// Model resolution
// ============================================================

let cachedModel: LanguageModel | null = null

export async function resolveModel(): Promise<LanguageModel> {
  if (cachedModel) return cachedModel

  try {
    const modelInfo = await Provider.defaultModel()
    const modelDetails = await Provider.getModel(modelInfo.providerID, modelInfo.modelID)
    cachedModel = await Provider.getLanguage(modelDetails)
    log.info("model resolved via CyberStrike provider", { model: modelInfo.modelID })
    return cachedModel
  } catch {
    // Fallback to env vars for standalone / dry-run mode
  }

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
    "No AI provider available. Run inside CyberStrike, or set ANTHROPIC_API_KEY / OPENAI_API_KEY.",
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
        })
      }
    } else if (task["type"] === "click") {
      const role = String(task["role"] ?? "")
      const label = String(task["label"] ?? "")
      if (role && label) {
        tasks.push({ type: "click", role, label, reason: task["reason"] as string | undefined })
      }
    }
  }

  return { tasks }
}

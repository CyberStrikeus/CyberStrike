import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Agent } from "../agent/agent"
import { Identifier } from "../id/id"
import { Intel } from "../methodology/intel"
import { getAssessResult } from "../tool/azurehook/assess-cache"
import { identityGroup, parallelGroups, CLOUD_GROUPS } from "./groups"
import type { CloudAnalysis } from "./types"

const LAYER2_DEADLINE_MS = 20 * 60 * 1000
const FOLLOWUP_RESERVE_MS = 5 * 60 * 1000

interface SpawnResult {
  agent: string
  group: string
  text: string
  error: string | undefined
  durationMs: number
}

async function spawnAnalyst(
  parentID: string,
  groupDef: CloudAnalysis.GroupDef,
  identityContext: string,
  model: { providerID: string; modelID: string },
): Promise<SpawnResult> {
  const start = Date.now()
  const agent = await Agent.get(groupDef.analyst)
  if (!agent) return { agent: groupDef.analyst, group: groupDef.key, text: "", error: `unknown agent: ${groupDef.analyst}`, durationMs: 0 }

  const session = await Session.create({
    parentID,
    title: `Analyze ${groupDef.label} (@${agent.name})`,
    permission: [
      { permission: "todowrite", pattern: "*", action: "deny" },
      { permission: "todoread", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
    ],
  })

  const prompt = [
    `Analyze the ${groupDef.key} group findings.`,
    `Call get_assess_findings(group: '${groupDef.key}') to retrieve your Layer 1 findings.`,
    `Verify each finding. Run additional azurehook programs if needed.`,
    `Use add_intel to record significant discoveries. Tag entries with group:${groupDef.key}.`,
    "",
    identityContext ? `## Identity Context\n${identityContext}` : "",
  ].filter(Boolean).join("\n")

  try {
    const result = await SessionPrompt.prompt({
      messageID: Identifier.ascending("message"),
      sessionID: session.id,
      model,
      agent: agent.name,
      tools: { todowrite: false, todoread: false, task: false },
      parts: [{ type: "text" as const, text: prompt }],
    })

    const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
    const info = result.info
    const error = info.role === "assistant" ? info.error : undefined

    return { agent: groupDef.analyst, group: groupDef.key, text, error: error ? String(error) : undefined, durationMs: Date.now() - start }
  } catch (e) {
    return { agent: groupDef.analyst, group: groupDef.key, text: "", error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start }
  }
}

async function spawnFollowup(
  parentID: string,
  followUp: CloudAnalysis.FollowUp,
  model: { providerID: string; modelID: string },
): Promise<SpawnResult> {
  const start = Date.now()
  const agent = await Agent.get("cloud-followup")
  if (!agent) return { agent: "cloud-followup", group: "followup", text: "", error: "unknown agent", durationMs: 0 }

  const session = await Session.create({
    parentID,
    title: `Follow-up: ${followUp.reason} (@cloud-followup)`,
    permission: [
      { permission: "todowrite", pattern: "*", action: "deny" },
      { permission: "todoread", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
    ],
  })

  try {
    const result = await SessionPrompt.prompt({
      messageID: Identifier.ascending("message"),
      sessionID: session.id,
      model,
      agent: agent.name,
      tools: { todowrite: false, todoread: false, task: false },
      parts: [{ type: "text" as const, text: followUp.prompt }],
    })
    const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
    return { agent: "cloud-followup", group: "followup", text, error: undefined, durationMs: Date.now() - start }
  } catch (e) {
    return { agent: "cloud-followup", group: "followup", text: "", error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start }
  }
}

async function spawnVerify(
  parentID: string,
  model: { providerID: string; modelID: string },
): Promise<SpawnResult> {
  const start = Date.now()
  const agent = await Agent.get("cloud-verify")
  if (!agent) return { agent: "cloud-verify", group: "verify", text: "", error: "unknown agent", durationMs: 0 }

  const session = await Session.create({
    parentID,
    title: "Final verification (@cloud-verify)",
    permission: [
      { permission: "todowrite", pattern: "*", action: "deny" },
      { permission: "todoread", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
    ],
  })

  try {
    const result = await SessionPrompt.prompt({
      messageID: Identifier.ascending("message"),
      sessionID: session.id,
      model,
      agent: agent.name,
      tools: { todowrite: false, todoread: false, task: false },
      parts: [{ type: "text" as const, text: "Review all cloud intel and reported vulnerabilities. Check for false positives, verify severity ratings, confirm attack chains are documented. Use get_cloud_intel to review the full intelligence picture." }],
    })
    const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
    return { agent: "cloud-verify", group: "verify", text, error: undefined, durationMs: Date.now() - start }
  } catch (e) {
    return { agent: "cloud-verify", group: "verify", text: "", error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start }
  }
}

function extractIdentityContext(rootSession: string): string {
  const entries = Intel.get(rootSession)
  const identity = entries.filter((e) => e.tags.includes("group:identity"))
  if (identity.length === 0) return ""

  const lines = ["Identity analysis found:"]
  for (const e of identity.slice(0, 20)) {
    lines.push(`- [${e.severity ?? "info"}] ${e.title}`)
    if (e.chainPotential) lines.push(`  Chain: ${e.chainPotential}`)
  }
  return lines.join("\n")
}

function buildAnalystResult(group: string, spawn: SpawnResult, rootSession: string): CloudAnalysis.AnalystResult {
  const entries = Intel.get(rootSession)
  const completion = entries.find((e) => e.title === `analyst_completion:${group}`)
  const groupIntel = entries.filter((e) => e.tags.includes(`group:${group}`))

  let verified = 0, rejected = 0, elevated = 0
  if (completion?.detail) {
    const m = completion.detail.match(/Verified:\s*(\d+).*Rejected:\s*(\d+).*Elevated:\s*(\d+)/)
    if (m) { verified = Number(m[1]); rejected = Number(m[2]); elevated = Number(m[3]) }
  }

  return {
    analyst: spawn.agent,
    group,
    verified,
    rejected,
    elevated,
    intelAdded: groupIntel.length,
    chains: groupIntel.filter((e) => e.chainPotential).map((e) => e.chainPotential!),
    summary: spawn.error ? `Error: ${spawn.error}` : spawn.text.slice(0, 500),
  }
}

async function detectFollowUps(
  parentID: string,
  rootSession: string,
  model: { providerID: string; modelID: string },
): Promise<CloudAnalysis.FollowUp[]> {
  const entries = Intel.get(rootSession)
  const chains = entries.filter((e) => e.chainPotential)
  if (chains.length === 0) return []

  const agent = await Agent.get("cloud-orchestrator")
  if (!agent) return []

  const session = await Session.create({
    parentID,
    title: "Chain detection (@cloud-orchestrator)",
    permission: [
      { permission: "todowrite", pattern: "*", action: "deny" },
      { permission: "todoread", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
    ],
  })

  const chainSummary = chains.slice(0, 30).map((e) => `- [${e.source ?? "?"}] ${e.title}: ${e.chainPotential}`).join("\n")
  const prompt = [
    "Analysts found these potential cross-group chains:\n",
    chainSummary,
    "\nUse get_cloud_intel to see the full picture.",
    "\nFor each chain worth investigating, respond with a JSON block:",
    '```json\n[{"reason":"...","chain":["group1","group2"],"groups":["group1","group2"],"prompt":"Detailed verification prompt for the follow-up agent"}]\n```',
    "\nIf no chains need follow-up, respond with `[]`.",
    "\nBe selective — only chains that cross group boundaries and have real attack potential.",
  ].join("\n")

  try {
    const result = await SessionPrompt.prompt({
      messageID: Identifier.ascending("message"),
      sessionID: session.id,
      model,
      agent: agent.name,
      tools: { todowrite: false, todoread: false, task: false },
      parts: [{ type: "text" as const, text: prompt }],
    })

    const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
    const jsonMatch = text.match(/```json\s*\n?([\s\S]*?)\n?```/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[1])
    if (!Array.isArray(parsed)) return []
    return parsed.filter((f: any) => f.reason && f.prompt)
  } catch {
    return []
  }
}

export async function orchestrateLayer2(sessionID: string): Promise<CloudAnalysis.OrchestrationState> {
  const rootSession = Session.root(sessionID)
  const assessResult = getAssessResult(rootSession)

  const state: CloudAnalysis.OrchestrationState = {
    phase: "idle",
    sessionID: rootSession,
    layer1Findings: assessResult?.findings.length ?? 0,
    identityIntel: 0,
    analystResults: [],
    followUps: [],
    verifyResult: null,
    startedAt: Date.now(),
    completedAt: null,
  }

  if (!assessResult || !assessResult.authOk || assessResult.findings.length === 0) {
    state.phase = "complete"
    state.completedAt = Date.now()
    return state
  }

  const model = await SessionPrompt.lastModel(sessionID)

  // ── Phase: identity ──────────────────────────────────────
  state.phase = "identity"
  const idGroup = identityGroup()
  const idResult = await spawnAnalyst(sessionID, idGroup, "", model)
  state.analystResults.push(buildAnalystResult(idGroup.key, idResult, rootSession))

  const identityContext = extractIdentityContext(rootSession)
  state.identityIntel = Intel.get(rootSession).filter((e) => e.tags.includes("group:identity")).length

  // ── Phase: parallel ──────────────────────────────────────
  state.phase = "parallel"
  const remaining = parallelGroups()
  const parallelResults = await Promise.all(
    remaining.map((g) => spawnAnalyst(sessionID, g, identityContext, model)),
  )

  for (let i = 0; i < remaining.length; i++) {
    state.analystResults.push(buildAnalystResult(remaining[i].key, parallelResults[i], rootSession))
  }

  // ── Phase: sync ──────────────────────────────────────────
  state.phase = "sync"
  const elapsed = Date.now() - state.startedAt
  const timeLeft = LAYER2_DEADLINE_MS - elapsed

  const completedAnalysts = state.analystResults.filter((a) => !a.summary.startsWith("Error:"))
  const failedAnalysts = state.analystResults.filter((a) => a.summary.startsWith("Error:"))

  if (failedAnalysts.length > 0) {
    console.warn(`[orchestrate] ${failedAnalysts.length} analyst(s) failed: ${failedAnalysts.map((a) => a.group).join(", ")}`)
  }

  // ── Phase: followup (LLM judgment) ───────────────────────
  if (timeLeft > FOLLOWUP_RESERVE_MS) {
    state.phase = "followup"
    const followUps = await detectFollowUps(sessionID, rootSession, model)
    state.followUps = followUps

    if (followUps.length > 0) {
      const followUpResults = await Promise.all(
        followUps.slice(0, 5).map((f) => spawnFollowup(sessionID, f, model)),
      )
      for (const r of followUpResults) {
        if (r.error) console.warn(`[orchestrate] follow-up failed: ${r.error}`)
      }
    }
  } else {
    console.warn(`[orchestrate] skipping follow-ups — ${Math.round(timeLeft / 1000)}s left (need ${FOLLOWUP_RESERVE_MS / 1000}s)`)
  }

  // ── Phase: verify ────────────────────────────────────────
  state.phase = "verify"
  const verifyResult = await spawnVerify(sessionID, model)

  state.verifyResult = {
    approved: 0,
    rejected: 0,
    downgraded: 0,
    missing: failedAnalysts.map((a) => a.group),
    summary: verifyResult.error ? `Error: ${verifyResult.error}` : verifyResult.text.slice(0, 500),
  }

  // ── Phase: complete ──────────────────────────────────────
  state.phase = "complete"
  state.completedAt = Date.now()

  const total = state.analystResults.reduce((sum, a) => sum + a.verified + a.rejected + a.elevated, 0)
  console.log(`[orchestrate] Layer 2 complete in ${Math.round((state.completedAt - state.startedAt) / 1000)}s — ${completedAnalysts.length}/${CLOUD_GROUPS.length} analysts, ${total} findings processed, ${state.followUps.length} follow-ups`)

  return state
}

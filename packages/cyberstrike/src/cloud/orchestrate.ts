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
const AGENT_TIMEOUT_MS = 10 * 60 * 1000
const FOLLOWUP_TIMEOUT_MS = 5 * 60 * 1000
const VERIFY_TIMEOUT_MS = 5 * 60 * 1000

interface SpawnResult {
  agent: string
  group: string
  text: string
  error: string | undefined
  durationMs: number
  timedOut?: boolean
}

function withTimeout<T>(promise: Promise<T>, ms: number, sessionID: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      SessionPrompt.cancel(sessionID)
      reject(new Error(`agent timed out after ${Math.round(ms / 1000)}s`))
    }, ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

async function spawnAnalyst(
  parentID: string,
  groupDef: CloudAnalysis.GroupDef,
  identityContext: string,
  model: { providerID: string; modelID: string },
  timeoutMs: number = AGENT_TIMEOUT_MS,
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
    `You have relevant skills loaded — use the \`skill\` tool to search and load cloud-specific skills (azure-postexploit, cloud-assessment, etc.) for detailed methodology when verifying findings.`,
    "",
    identityContext ? `## Identity Context\n${identityContext}` : "",
  ].filter(Boolean).join("\n")

  try {
    const result = await withTimeout(
      SessionPrompt.prompt({
        messageID: Identifier.ascending("message"),
        sessionID: session.id,
        model,
        agent: agent.name,
        tools: { todowrite: false, todoread: false, task: false },
        parts: [{ type: "text" as const, text: prompt }],
      }),
      timeoutMs,
      session.id,
    )

    const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
    const info = result.info
    const error = info.role === "assistant" ? info.error : undefined

    return { agent: groupDef.analyst, group: groupDef.key, text, error: error ? String(error) : undefined, durationMs: Date.now() - start }
  } catch (e) {
    const timedOut = e instanceof Error && e.message.includes("timed out")
    return { agent: groupDef.analyst, group: groupDef.key, text: "", error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start, timedOut }
  }
}

async function spawnFollowup(
  parentID: string,
  followUp: CloudAnalysis.FollowUp,
  model: { providerID: string; modelID: string },
  timeoutMs: number = FOLLOWUP_TIMEOUT_MS,
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
    const result = await withTimeout(
      SessionPrompt.prompt({
        messageID: Identifier.ascending("message"),
        sessionID: session.id,
        model,
        agent: agent.name,
        tools: { todowrite: false, todoread: false, task: false },
        parts: [{ type: "text" as const, text: followUp.prompt }],
      }),
      timeoutMs,
      session.id,
    )
    const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
    return { agent: "cloud-followup", group: "followup", text, error: undefined, durationMs: Date.now() - start }
  } catch (e) {
    const timedOut = e instanceof Error && e.message.includes("timed out")
    return { agent: "cloud-followup", group: "followup", text: "", error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start, timedOut }
  }
}

async function spawnVerify(
  parentID: string,
  model: { providerID: string; modelID: string },
  timeoutMs: number = VERIFY_TIMEOUT_MS,
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
    const result = await withTimeout(
      SessionPrompt.prompt({
        messageID: Identifier.ascending("message"),
        sessionID: session.id,
        model,
        agent: agent.name,
        tools: { todowrite: false, todoread: false, task: false },
        parts: [{ type: "text" as const, text: "Review all cloud intel and reported vulnerabilities. Check for false positives, verify severity ratings, confirm attack chains are documented. Use get_cloud_intel to review the full intelligence picture. Use the `skill` tool to load relevant skills (cloud-assessment, azure-postexploit) for CIS compliance checks." }],
      }),
      timeoutMs,
      session.id,
    )
    const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
    return { agent: "cloud-verify", group: "verify", text, error: undefined, durationMs: Date.now() - start }
  } catch (e) {
    const timedOut = e instanceof Error && e.message.includes("timed out")
    return { agent: "cloud-verify", group: "verify", text: "", error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start, timedOut }
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
  const parallelTimeout = Math.min(AGENT_TIMEOUT_MS, LAYER2_DEADLINE_MS - (Date.now() - state.startedAt) - FOLLOWUP_RESERVE_MS)
  const settled = await Promise.allSettled(
    remaining.map((g) => spawnAnalyst(sessionID, g, identityContext, model, Math.max(parallelTimeout, 60_000))),
  )

  for (let i = 0; i < remaining.length; i++) {
    const s = settled[i]
    if (s.status === "fulfilled") {
      state.analystResults.push(buildAnalystResult(remaining[i].key, s.value, rootSession))
    } else {
      state.analystResults.push(buildAnalystResult(remaining[i].key, {
        agent: remaining[i].analyst, group: remaining[i].key, text: "", error: s.reason?.message ?? "unknown error", durationMs: 0, timedOut: true,
      }, rootSession))
    }
  }

  // ── Phase: sync ──────────────────────────────────────────
  state.phase = "sync"
  const elapsed = Date.now() - state.startedAt
  const timeLeft = LAYER2_DEADLINE_MS - elapsed

  const completedAnalysts = state.analystResults.filter((a) => !a.summary.startsWith("Error:"))
  const failedAnalysts = state.analystResults.filter((a) => a.summary.startsWith("Error:"))
  const timedOutCount = settled.filter((s) => s.status === "fulfilled" && s.value.timedOut).length

  if (failedAnalysts.length > 0) {
    console.warn(`[orchestrate] ${failedAnalysts.length} analyst(s) failed: ${failedAnalysts.map((a) => a.group).join(", ")}`)
  }
  if (timedOutCount > 0) {
    console.warn(`[orchestrate] ${timedOutCount} analyst(s) timed out`)
  }

  // ── Phase: followup (LLM judgment) ───────────────────────
  if (timeLeft > FOLLOWUP_RESERVE_MS) {
    state.phase = "followup"
    const followUps = await detectFollowUps(sessionID, rootSession, model)
    state.followUps = followUps

    if (followUps.length > 0) {
      const fuTimeout = Math.min(FOLLOWUP_TIMEOUT_MS, timeLeft - FOLLOWUP_RESERVE_MS)
      const fuSettled = await Promise.allSettled(
        followUps.slice(0, 5).map((f) => spawnFollowup(sessionID, f, model, Math.max(fuTimeout, 60_000))),
      )
      for (const r of fuSettled) {
        if (r.status === "rejected") console.warn(`[orchestrate] follow-up failed: ${r.reason?.message}`)
        else if (r.value.error) console.warn(`[orchestrate] follow-up failed: ${r.value.error}`)
      }
    }
  } else {
    console.warn(`[orchestrate] skipping follow-ups — ${Math.round(timeLeft / 1000)}s left (need ${FOLLOWUP_RESERVE_MS / 1000}s)`)
  }

  // ── Phase: verify ────────────────────────────────────────
  state.phase = "verify"
  const verifyTimeout = Math.min(VERIFY_TIMEOUT_MS, Math.max(LAYER2_DEADLINE_MS - (Date.now() - state.startedAt), 60_000))
  const verifyResult = await spawnVerify(sessionID, model, verifyTimeout)

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

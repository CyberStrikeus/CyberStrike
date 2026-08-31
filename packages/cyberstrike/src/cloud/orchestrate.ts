import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Agent } from "../agent/agent"
import { Identifier } from "../id/id"
import { Intel } from "../methodology/intel"
import { Vulnerability } from "../session/vulnerability"
import { getAssessResult } from "../tool/azurehook/assess-cache"
import { identityGroup, parallelGroups, CLOUD_GROUPS } from "./groups"
import { classifyGroupFindings } from "./classify"
import { extractTrajectory, aggregateTrajectories, formatTrajectoryLog } from "./trajectory"
import type { CloudAnalysis } from "./types"
import type { AgentTrajectory } from "./trajectory"

const LAYER2_DEADLINE_MS = 20 * 60 * 1000
const FOLLOWUP_RESERVE_MS = 5 * 60 * 1000
const AGENT_TIMEOUT_MS = 10 * 60 * 1000
const IDENTITY_TIMEOUT_MS = 6 * 60 * 1000
const BATCH_VERIFY_TIMEOUT_MS = 5 * 60 * 1000
const FOLLOWUP_TIMEOUT_MS = 5 * 60 * 1000
const VERIFY_TIMEOUT_MS = 5 * 60 * 1000

interface SpawnResult {
  agent: string
  group: string
  sessionID: string
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
  if (!agent) return { agent: groupDef.analyst, group: groupDef.key, sessionID: "", text: "", error: `unknown agent: ${groupDef.analyst}`, durationMs: 0 }

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

    return { agent: groupDef.analyst, group: groupDef.key, sessionID: session.id, text, error: error ? String(error) : undefined, durationMs: Date.now() - start }
  } catch (e) {
    const timedOut = e instanceof Error && e.message.includes("timed out")
    return { agent: groupDef.analyst, group: groupDef.key, sessionID: session.id, text: "", error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start, timedOut }
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
  if (!agent) return { agent: "cloud-followup", group: "followup", sessionID: "", text: "", error: "unknown agent", durationMs: 0 }

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
    return { agent: "cloud-followup", group: "followup", sessionID: session.id, text, error: undefined, durationMs: Date.now() - start }
  } catch (e) {
    const timedOut = e instanceof Error && e.message.includes("timed out")
    return { agent: "cloud-followup", group: "followup", sessionID: session.id, text: "", error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start, timedOut }
  }
}

async function spawnVerify(
  parentID: string,
  model: { providerID: string; modelID: string },
  timeoutMs: number = VERIFY_TIMEOUT_MS,
): Promise<SpawnResult> {
  const start = Date.now()
  const agent = await Agent.get("cloud-verify")
  if (!agent) return { agent: "cloud-verify", group: "verify", sessionID: "", text: "", error: "unknown agent", durationMs: 0 }

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
    return { agent: "cloud-verify", group: "verify", sessionID: session.id, text, error: undefined, durationMs: Date.now() - start }
  } catch (e) {
    const timedOut = e instanceof Error && e.message.includes("timed out")
    return { agent: "cloud-verify", group: "verify", sessionID: session.id, text: "", error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start, timedOut }
  }
}

async function spawnBatchVerifier(
  parentID: string,
  groups: string[],
  identityContext: string,
  model: { providerID: string; modelID: string },
  timeoutMs: number = BATCH_VERIFY_TIMEOUT_MS,
): Promise<SpawnResult> {
  const start = Date.now()
  const agent = await Agent.get("cloud-batch-verifier")
  if (!agent) return { agent: "cloud-batch-verifier", group: "batch-verify", sessionID: "", text: "", error: "unknown agent", durationMs: 0 }

  const session = await Session.create({
    parentID,
    title: "Batch verification (@cloud-batch-verifier)",
    permission: [
      { permission: "todowrite", pattern: "*", action: "deny" },
      { permission: "todoread", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
    ],
  })

  const prompt = [
    `Rapidly triage formulaic findings across these groups: ${groups.join(", ")}`,
    "",
    "For each group, call `get_assess_findings(group: '<key>')` to see findings with their triage status and vulnerability IDs.",
    "Triage each finding as approved or duplicate (false positive). Do not investigate deeply.",
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
    return { agent: "cloud-batch-verifier", group: "batch-verify", sessionID: session.id, text, error: undefined, durationMs: Date.now() - start }
  } catch (e) {
    const timedOut = e instanceof Error && e.message.includes("timed out")
    return { agent: "cloud-batch-verifier", group: "batch-verify", sessionID: session.id, text: "", error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start, timedOut }
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
  const groupIntel = entries.filter((e) => e.tags.includes(`group:${group}`))

  const vulns = Vulnerability.get(rootSession)
  let verified = 0, rejected = 0, elevated = 0
  for (const v of vulns) {
    const isGroupFinding = v.endpoint?.toLowerCase().includes(group) || v.title.toLowerCase().includes(group)
    if (!isGroupFinding) continue
    if (v.status === "approved") verified++
    else if (v.status === "duplicate" || v.status === "ignored") rejected++
  }
  elevated = groupIntel.filter((e) => e.chainPotential).length

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
    const result = await withTimeout(
      SessionPrompt.prompt({
        messageID: Identifier.ascending("message"),
        sessionID: session.id,
        model,
        agent: agent.name,
        tools: { todowrite: false, todoread: false, task: false },
        parts: [{ type: "text" as const, text: prompt }],
      }),
      FOLLOWUP_TIMEOUT_MS,
      session.id,
    )

    const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
    const jsonMatch = text.match(/```json\s*\n?([\s\S]*?)\n?```/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[1])
    if (!Array.isArray(parsed)) return []
    return parsed.filter((f: any) => f.reason && f.prompt)
  } catch (e) {
    if (e instanceof Error) console.warn(`[orchestrate] detectFollowUps failed: ${e.message}`)
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
    triageStats: null,
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

  const deadlineTimer = setTimeout(() => {
    console.warn(`[orchestrate] Layer 2 hard deadline reached (${LAYER2_DEADLINE_MS / 1000}s)`)
  }, LAYER2_DEADLINE_MS)

  try {
    return await runOrchestration(sessionID, rootSession, assessResult, state)
  } finally {
    clearTimeout(deadlineTimer)
  }
}

async function runOrchestration(
  sessionID: string,
  rootSession: string,
  assessResult: NonNullable<ReturnType<typeof getAssessResult>>,
  state: CloudAnalysis.OrchestrationState,
): Promise<CloudAnalysis.OrchestrationState> {
  const model = await SessionPrompt.lastModel(sessionID)

  // ── Phase: identity ──────────────────────────────────────
  state.phase = "identity"
  const idGroup = identityGroup()
  const idResult = await spawnAnalyst(sessionID, idGroup, "", model, IDENTITY_TIMEOUT_MS)
  state.analystResults.push(buildAnalystResult(idGroup.key, idResult, rootSession))
  const spawnResults: SpawnResult[] = [idResult]

  const identityContext = extractIdentityContext(rootSession)
  state.identityIntel = Intel.get(rootSession).filter((e) => e.tags.includes("group:identity")).length

  // ── Phase: triage (classify findings) ───────────────────
  state.phase = "triage"
  const remaining = parallelGroups()
  const groupFindings = remaining.map((g) => {
    const gResults = assessResult.phases.flatMap((p) => p.groups).filter((r) => r.key === g.key)
    return { key: g.key, findings: gResults.flatMap((r) => r.findings) }
  })
  const classified = classifyGroupFindings(groupFindings)

  const formulaicGroups = classified.filter((c) => c.formulaic.length > 0).map((c) => c.key)
  const investigateGroups = classified.filter((c) => c.investigate.length > 0)
  const totalFormulaic = classified.reduce((sum, c) => sum + c.formulaic.length, 0)
  const totalInvestigate = classified.reduce((sum, c) => sum + c.investigate.length, 0)

  state.triageStats = {
    formulaic: totalFormulaic,
    investigate: totalInvestigate,
    groupsWithInvestigation: investigateGroups.map((g) => g.key),
  }

  console.log(`[orchestrate] triage: ${totalFormulaic} formulaic (${formulaicGroups.length} groups), ${totalInvestigate} investigate (${investigateGroups.length} groups)`)

  // ── Phase: parallel (batch verify + investigation analysts) ──
  state.phase = "parallel"
  const parallelTimeout = Math.min(AGENT_TIMEOUT_MS, LAYER2_DEADLINE_MS - (Date.now() - state.startedAt) - FOLLOWUP_RESERVE_MS)
  const effectiveTimeout = Math.max(parallelTimeout, 60_000)

  const tasks: Promise<PromiseSettledResult<SpawnResult>>[] = []
  const taskMeta: { type: "batch" | "analyst"; groupKey?: string; groupDef?: CloudAnalysis.GroupDef }[] = []

  if (formulaicGroups.length > 0) {
    tasks.push(
      spawnBatchVerifier(sessionID, formulaicGroups, identityContext, model, Math.min(BATCH_VERIFY_TIMEOUT_MS, effectiveTimeout))
        .then((v) => ({ status: "fulfilled" as const, value: v }))
        .catch((e) => ({ status: "rejected" as const, reason: e })),
    )
    taskMeta.push({ type: "batch" })
  }

  for (const c of investigateGroups) {
    const groupDef = remaining.find((g) => g.key === c.key)
    if (!groupDef) continue
    tasks.push(
      spawnAnalyst(sessionID, groupDef, identityContext, model, effectiveTimeout)
        .then((v) => ({ status: "fulfilled" as const, value: v }))
        .catch((e) => ({ status: "rejected" as const, reason: e })),
    )
    taskMeta.push({ type: "analyst", groupKey: c.key, groupDef })
  }

  const settled = await Promise.all(tasks)

  for (let i = 0; i < settled.length; i++) {
    const meta = taskMeta[i]!
    const s = settled[i]!
    if (meta.type === "batch") {
      const spawn = s.status === "fulfilled"
        ? s.value
        : { agent: "cloud-batch-verifier", group: "batch-verify", sessionID: "", text: "", error: (s as PromiseRejectedResult).reason?.message ?? "unknown error", durationMs: 0, timedOut: true } as SpawnResult
      if (s.status === "rejected") console.warn(`[orchestrate] batch verifier failed: ${spawn.error}`)
      state.analystResults.push(buildAnalystResult("batch-verify", spawn, rootSession))
      spawnResults.push(spawn)
    } else if (meta.groupDef) {
      const spawn = s.status === "fulfilled"
        ? s.value
        : { agent: meta.groupDef.analyst, group: meta.groupKey!, sessionID: "", text: "", error: (s as PromiseRejectedResult).reason?.message ?? "unknown error", durationMs: 0, timedOut: true } as SpawnResult
      state.analystResults.push(buildAnalystResult(meta.groupKey!, spawn, rootSession))
      spawnResults.push(spawn)
    }
  }

  // ── Phase: sync ──────────────────────────────────────────
  state.phase = "sync"
  const timeLeft = LAYER2_DEADLINE_MS - (Date.now() - state.startedAt)

  const completedAnalysts = state.analystResults.filter((a) => !a.summary.startsWith("Error:"))
  const failedAnalysts = state.analystResults.filter((a) => a.summary.startsWith("Error:"))

  if (failedAnalysts.length > 0) {
    console.warn(`[orchestrate] ${failedAnalysts.length} agent(s) failed: ${failedAnalysts.map((a) => a.group).join(", ")}`)
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
        else {
          if (r.value.error) console.warn(`[orchestrate] follow-up failed: ${r.value.error}`)
          spawnResults.push(r.value)
        }
      }
    }
  } else {
    console.warn(`[orchestrate] skipping follow-ups — ${Math.round(timeLeft / 1000)}s left (need ${FOLLOWUP_RESERVE_MS / 1000}s)`)
  }

  // ── Phase: verify ────────────────────────────────────────
  state.phase = "verify"
  const verifyTimeout = Math.min(VERIFY_TIMEOUT_MS, Math.max(LAYER2_DEADLINE_MS - (Date.now() - state.startedAt), 60_000))
  const verifyResult = await spawnVerify(sessionID, model, verifyTimeout)
  spawnResults.push(verifyResult)

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

  // ── Trajectory logging ──────────────────────────────────
  const trajectories = await Promise.all(
    spawnResults
      .filter((s) => s.sessionID)
      .map((s) => extractTrajectory(s.sessionID, s.agent, s.group, s.durationMs, !!s.timedOut, s.error)),
  )
  const aggregate = aggregateTrajectories(trajectories, state.completedAt - state.startedAt)
  console.log(formatTrajectoryLog(aggregate))

  return state
}

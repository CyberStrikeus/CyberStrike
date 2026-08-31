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
const MAX_CONCURRENT_AGENTS = 5

class Semaphore {
  private queue: (() => void)[] = []
  private active = 0
  constructor(private max: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) { this.active++; return }
    return new Promise((resolve) => this.queue.push(() => { this.active++; resolve() }))
  }
  release(): void {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }
}

function deduplicateFindings(rootSession: string): void {
  const vulns = Vulnerability.get(rootSession)
  const seen = new Map<string, string>()
  let deduped = 0
  for (const v of vulns) {
    if (!v.id || v.status === "duplicate") continue
    const key = [
      v.cwe_id?.toLowerCase() ?? "",
      v.endpoint?.toLowerCase().replace(/\s+/g, " ").trim() ?? "",
      v.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80),
    ].join("|")
    const existing = seen.get(key)
    if (existing) {
      Vulnerability.update({ sessionID: rootSession, id: v.id, status: "duplicate", duplicate_of: existing })
      deduped++
    } else {
      seen.set(key, v.id)
    }
  }
  if (deduped > 0) console.log(`[orchestrate] dedup fence: marked ${deduped} duplicate finding(s)`)
}

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
    "",
    `## Workflow`,
    `1. ENRICH FIRST: For each Layer 1 finding, verify it and use enrich_vulnerability(id, steps_to_reproduce, poc, ...) to add details to the EXISTING record. This updates the skeleton in place — no duplicate is created.`,
    `2. NEW FINDINGS: Only use report_vulnerability for genuinely NEW issues not already in the Layer 1 findings.`,
    `3. Run additional azurehook programs if needed to verify or discover more issues.`,
    "",
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
  orchestrationSummary: string,
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

  const prompt = [
    "Review all cloud intel and reported vulnerabilities. Check for false positives, verify severity ratings, confirm attack chains are documented.",
    "",
    "Use get_cloud_intel to review the full intelligence picture. Use the `skill` tool to load relevant skills (cloud-assessment, azure-postexploit) for CIS compliance checks.",
    "",
    "## Orchestration Context",
    orchestrationSummary,
    "",
    "Pay special attention to failed/timed-out analysts — their groups may have incomplete coverage. Check if any findings from those groups were missed.",
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
    "Triage each finding as approved, duplicate (false positive), or ignored (not exploitable in context).",
    "",
    "**Escalation:** If a finding turns out to be MORE complex than expected (e.g. involves privilege escalation, lateral movement, or cross-group chain potential), do NOT attempt deep investigation. Instead, call `add_intel` with title starting with `ESCALATE:` and describe why it needs deeper analysis. The orchestrator will route it to a follow-up agent.",
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
    if (v.source_agent !== spawn.agent) continue
    if (v.status === "triaged" || v.status === "pending_fix" || v.status === "approved") verified++
    else if (v.status === "duplicate" || v.status === "rejected" || v.status === "ignored") rejected++
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
  const targetHints = entries.filter((e) => e.tags.some((t) => t.startsWith("target:")))
  const escalations = entries.filter((e) => e.title.startsWith("ESCALATE:"))
  if (chains.length === 0 && targetHints.length === 0 && escalations.length === 0) return []

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

  const sections: string[] = []

  if (chains.length > 0) {
    const chainSummary = chains.slice(0, 30).map((e) => `- [${e.source ?? "?"}] ${e.title}: ${e.chainPotential}`).join("\n")
    sections.push(`## Cross-Group Chains\n${chainSummary}`)
  }

  if (targetHints.length > 0) {
    const hintSummary = targetHints.slice(0, 20).map((e) => {
      const target = e.tags.find((t) => t.startsWith("target:"))?.replace("target:", "") ?? "?"
      return `- [${e.source ?? "?"}→${target}] ${e.title}`
    }).join("\n")
    sections.push(`## Cross-Group Hints (unprocessed)\nAnalysts flagged these for another group's attention:\n${hintSummary}`)
  }

  if (escalations.length > 0) {
    const escSummary = escalations.slice(0, 10).map((e) => `- [${e.source ?? "?"}] ${e.title}`).join("\n")
    sections.push(`## Escalations from Batch Verifier\nFormulaic findings that need deeper investigation:\n${escSummary}`)
  }

  const prompt = [
    sections.join("\n\n"),
    "\nUse get_cloud_intel to see the full picture.",
    "\nFor each item worth investigating, respond with a JSON block:",
    '```json\n[{"reason":"...","chain":["group1","group2"],"groups":["group1","group2"],"prompt":"Detailed verification prompt for the follow-up agent"}]\n```',
    "\nIf nothing needs follow-up, respond with `[]`.",
    "\nBe selective — prioritize chains with real attack potential and escalated findings over routine hints.",
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

  if (!assessResult) {
    throw new Error("No assessment results cached. Run azurehook azure_assess first — results are lost on process restart.")
  }
  if (!assessResult.authOk || assessResult.findings.length === 0) {
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

  const sem = new Semaphore(MAX_CONCURRENT_AGENTS)
  const tasks: Promise<PromiseSettledResult<SpawnResult>>[] = []
  const taskMeta: { type: "batch" | "analyst"; groupKey?: string; groupDef?: CloudAnalysis.GroupDef }[] = []

  const withSemaphore = async (fn: () => Promise<SpawnResult>): Promise<PromiseSettledResult<SpawnResult>> => {
    await sem.acquire()
    try {
      const v = await fn()
      return { status: "fulfilled" as const, value: v }
    } catch (e) {
      return { status: "rejected" as const, reason: e }
    } finally {
      sem.release()
    }
  }

  if (formulaicGroups.length > 0) {
    tasks.push(
      withSemaphore(() => spawnBatchVerifier(sessionID, formulaicGroups, identityContext, model, Math.min(BATCH_VERIFY_TIMEOUT_MS, effectiveTimeout))),
    )
    taskMeta.push({ type: "batch" })
  }

  for (const c of investigateGroups) {
    const groupDef = remaining.find((g) => g.key === c.key)
    if (!groupDef) continue
    tasks.push(
      withSemaphore(() => spawnAnalyst(sessionID, groupDef, identityContext, model, effectiveTimeout)),
    )
    taskMeta.push({ type: "analyst", groupKey: c.key, groupDef })
  }

  console.log(`[orchestrate] parallel: ${tasks.length} agents (max ${MAX_CONCURRENT_AGENTS} concurrent)`)
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
      const fuSem = new Semaphore(MAX_CONCURRENT_AGENTS)
      const fuSettled = await Promise.allSettled(
        followUps.slice(0, 5).map(async (f) => {
          await fuSem.acquire()
          try { return await spawnFollowup(sessionID, f, model, Math.max(fuTimeout, 60_000)) }
          finally { fuSem.release() }
        }),
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

  deduplicateFindings(rootSession)

  // ── Phase: verify ────────────────────────────────────────
  state.phase = "verify"
  const verifyTimeout = Math.min(VERIFY_TIMEOUT_MS, Math.max(LAYER2_DEADLINE_MS - (Date.now() - state.startedAt), 60_000))

  const vulnSummary = Vulnerability.get(rootSession)
  const vulnDraft = vulnSummary.filter((v) => v.status === "draft" || v.status === "new").length
  const vulnTriaged = vulnSummary.filter((v) => v.status === "triaged").length
  const vulnPendingFix = vulnSummary.filter((v) => v.status === "pending_fix" || v.status === "approved").length
  const vulnRejected = vulnSummary.filter((v) => v.status === "rejected" || v.status === "ignored").length
  const vulnDuplicate = vulnSummary.filter((v) => v.status === "duplicate").length

  const orchestrationSummary = [
    `- Dispatched: ${state.analystResults.length} analyst(s), ${state.followUps.length} follow-up(s)`,
    `- Completed: ${completedAnalysts.length} analyst(s)`,
    failedAnalysts.length > 0 ? `- FAILED/TIMED OUT: ${failedAnalysts.map((a) => a.group).join(", ")} — these groups may have INCOMPLETE coverage` : null,
    state.triageStats ? `- Classification: ${state.triageStats.formulaic} formulaic, ${state.triageStats.investigate} investigate` : null,
    `- Findings: ${vulnDraft} draft, ${vulnTriaged} triaged, ${vulnPendingFix} pending_fix, ${vulnRejected} rejected, ${vulnDuplicate} duplicate`,
    `- Total intel entries: ${Intel.get(rootSession).length}`,
    `- Elapsed: ${Math.round((Date.now() - state.startedAt) / 1000)}s`,
  ].filter(Boolean).join("\n")

  const verifyResult = await spawnVerify(sessionID, model, orchestrationSummary, verifyTimeout)
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

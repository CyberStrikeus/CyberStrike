import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { Identifier } from "../id/id"
import { Intel } from "../methodology/intel"
import { Vulnerability } from "../session/vulnerability"
import { VulnStatus, isExcluded, isActionable, normalizeStatus } from "../session/vulnerability-status"
import { extractTrajectory, aggregateTrajectories, formatTrajectoryLog } from "./trajectory"
import type { CloudAnalysis } from "./types"
import type { AgentTrajectory } from "./trajectory"
import type { AssessmentProvider } from "./provider"
import { detectCloudChains, formatCloudChainsForPrompt } from "./cloud-chain"
import { Semaphore } from "../util/semaphore"
import { withTimeout } from "../util/timeout"

const LAYER2_DEADLINE_MS = 25 * 60 * 1000
const FOLLOWUP_RESERVE_MS = 5 * 60 * 1000
const AGENT_TIMEOUT_MS = 10 * 60 * 1000
const FINDINGS_PER_AGENT = 5
const MAX_AGENTS_PER_GROUP = 4
const BATCH_VERIFY_TIMEOUT_MS = 5 * 60 * 1000
const FOLLOWUP_TIMEOUT_MS = 10 * 60 * 1000
const VERIFY_TIMEOUT_MS = 5 * 60 * 1000
const MAX_CONCURRENT_AGENTS = 5
const WATCHDOG_INTERVAL_MS = 30_000
const WATCHDOG_SPAWN_AFTER_MS = 4 * 60_000

function deduplicateFindings(rootSession: string): void {
  const vulns = Vulnerability.get(rootSession)
  const seen = new Map<string, string>()
  let deduped = 0
  for (const v of vulns) {
    if (!v.id || v.status === VulnStatus.DUPLICATE) continue
    const key = [
      v.cwe_id?.toLowerCase() ?? "",
      v.endpoint?.toLowerCase().replace(/\s+/g, " ").trim() ?? "",
      v.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80),
    ].join("|")
    const existing = seen.get(key)
    if (existing) {
      Vulnerability.update({ sessionID: rootSession, id: v.id, status: VulnStatus.DUPLICATE, duplicate_of: existing })
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

const CLOUD_DENY_RULES = [
  { permission: "todowrite" as const, pattern: "*", action: "deny" as const },
  { permission: "todoread" as const, pattern: "*", action: "deny" as const },
  { permission: "task" as const, pattern: "*", action: "deny" as const },
]

const CLOUD_TOOL_OVERRIDES = { todowrite: false, todoread: false, task: false }

interface CloudSpawnOpts {
  parentID: string
  agentName: string
  group: string
  title: string
  prompt: string
  model: { providerID: string; modelID: string }
  timeoutMs: number
  messageID?: string
}

async function emitTaskPart(
  opts: CloudSpawnOpts,
  partID: string,
  childSessionID: string,
  state: "running" | "completed" | "error",
  extra?: { output?: string; error?: string; start: number; end?: number },
  partInput?: { description: string; subagent_type: string; prompt: string },
) {
  if (!opts.messageID) return
  const time = extra ?? { start: Date.now() }
  const input = partInput ?? { description: opts.title, subagent_type: opts.agentName, prompt: opts.prompt.slice(0, 300) }
  const part: MessageV2.ToolPart = {
    id: partID,
    sessionID: opts.parentID,
    messageID: opts.messageID,
    type: "tool",
    callID: partID,
    tool: "task",
    metadata: { synthetic: true },
    state: state === "running"
      ? {
          status: "running",
          input,
          title: opts.title,
          metadata: { sessionId: childSessionID, model: opts.model },
          time: { start: time.start },
        }
      : state === "completed"
        ? {
            status: "completed",
            input,
            output: extra?.output ?? "",
            title: opts.title,
            metadata: { sessionId: childSessionID, model: opts.model },
            time: { start: time.start, end: time.end ?? Date.now() },
          }
        : {
            status: "error",
            input,
            error: extra?.error ?? "unknown error",
            metadata: { sessionId: childSessionID, model: opts.model },
            time: { start: time.start, end: time.end ?? Date.now() },
          },
  }
  await Session.updatePart(part)
}

async function spawnCloudAgent(opts: CloudSpawnOpts): Promise<SpawnResult> {
  const start = Date.now()
  const agent = await Agent.get(opts.agentName)
  if (!agent) return { agent: opts.agentName, group: opts.group, sessionID: "", text: "", error: `unknown agent: ${opts.agentName}`, durationMs: 0 }

  const session = await Session.create({
    parentID: opts.parentID,
    title: opts.title,
    permission: CLOUD_DENY_RULES,
  })

  const partID = opts.messageID ? Identifier.ascending("part") : ""
  const promptSnippet = opts.prompt.slice(0, 300)
  const partInput = { description: opts.title, subagent_type: opts.agentName, prompt: promptSnippet }

  if (opts.messageID) {
    try { await emitTaskPart(opts, partID, session.id, "running", { start }, partInput) }
    catch (err) { console.warn(`[orchestrate] emitTaskPart(running) failed: ${err}`) }
  }

  try {
    const result = await withTimeout(
      SessionPrompt.prompt({
        messageID: Identifier.ascending("message"),
        sessionID: session.id,
        model: opts.model,
        agent: agent.name,
        tools: CLOUD_TOOL_OVERRIDES,
        parts: [{ type: "text" as const, text: opts.prompt }],
      }),
      opts.timeoutMs,
      () => SessionPrompt.cancel(session.id),
    )

    const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
    const info = result.info
    const error = info.role === "assistant" ? info.error : undefined

    if (opts.messageID) {
      const output = error ? `Error: ${error}` : text.slice(0, 200)
      try { await emitTaskPart(opts, partID, session.id, error ? "error" : "completed", { output, error: error ? String(error) : undefined, start, end: Date.now() }, partInput) }
      catch (err) { console.warn(`[orchestrate] emitTaskPart(completed) failed: ${err}`) }
    }

    return { agent: opts.agentName, group: opts.group, sessionID: session.id, text, error: error ? String(error) : undefined, durationMs: Date.now() - start }
  } catch (e) {
    const timedOut = e instanceof Error && e.message.includes("timed out")
    if (opts.messageID) {
      try { await emitTaskPart(opts, partID, session.id, "error", { error: e instanceof Error ? e.message : String(e), start, end: Date.now() }, partInput) }
      catch (err) { console.warn(`[orchestrate] emitTaskPart(error) failed: ${err}`) }
    }
    return { agent: opts.agentName, group: opts.group, sessionID: session.id, text: "", error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start, timedOut }
  }
}

async function spawnAnalyst(
  parentID: string,
  groupDef: CloudAnalysis.GroupDef,
  prompt: string,
  model: { providerID: string; modelID: string },
  timeoutMs: number = AGENT_TIMEOUT_MS,
  messageID?: string,
  slice?: string,
): Promise<SpawnResult> {
  return spawnCloudAgent({
    parentID, agentName: groupDef.analyst, group: groupDef.key,
    title: `Analyze ${groupDef.label}${slice ? ` [${slice}]` : ""} (@${groupDef.analyst})`,
    prompt, model, timeoutMs, messageID,
  })
}

async function spawnFollowup(
  parentID: string,
  followUp: CloudAnalysis.FollowUp,
  model: { providerID: string; modelID: string },
  timeoutMs: number = FOLLOWUP_TIMEOUT_MS,
  messageID?: string,
): Promise<SpawnResult> {
  return spawnCloudAgent({
    parentID, agentName: "cloud-followup", group: "followup",
    title: `Follow-up: ${followUp.reason} (@cloud-followup)`,
    prompt: followUp.prompt, model, timeoutMs, messageID,
  })
}

async function spawnVerify(
  parentID: string,
  prompt: string,
  model: { providerID: string; modelID: string },
  timeoutMs: number = VERIFY_TIMEOUT_MS,
  messageID?: string,
): Promise<SpawnResult> {
  return spawnCloudAgent({
    parentID, agentName: "cloud-verify", group: "verify",
    title: "Final verification (@cloud-verify)",
    prompt, model, timeoutMs, messageID,
  })
}

async function spawnBatchVerifier(
  parentID: string,
  prompt: string,
  model: { providerID: string; modelID: string },
  timeoutMs: number = BATCH_VERIFY_TIMEOUT_MS,
  messageID?: string,
): Promise<SpawnResult> {
  return spawnCloudAgent({
    parentID, agentName: "cloud-batch-verifier", group: "batch-verify",
    title: "Batch verification (@cloud-batch-verifier)",
    prompt, model, timeoutMs, messageID,
  })
}

function buildAnalystResult(group: string, spawn: SpawnResult, rootSession: string): CloudAnalysis.AnalystResult {
  const entries = Intel.get(rootSession)
  const groupIntel = entries.filter((e) => e.tags.includes(`group:${group}`))

  const vulns = Vulnerability.get(rootSession)
  let verified = 0, rejected = 0, elevated = 0
  for (const v of vulns) {
    if (!v.source_agent?.includes(spawn.agent)) continue
    const ns = normalizeStatus(v.status ?? VulnStatus.DRAFT)
    if (isActionable(ns)) verified++
    else if (isExcluded(ns)) rejected++
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

interface WatchdogContext {
  rootSession: string
  sessionID: string
  model: { providerID: string; modelID: string }
  provider: AssessmentProvider
  identityContext: string
  messageID?: string
  sem: InstanceType<typeof Semaphore>
}

interface TrackedAgent {
  groupKey: string
  groupDef: CloudAnalysis.GroupDef
  analystName: string
  startTime: number
  promise: Promise<SpawnResult>
}

interface GroupProgress {
  intelCount: number
  draftCount: number
  triagedCount: number
  staleTicks: number
}

interface WatchdogState {
  ticks: number
  helpersSpawned: number
  groupProgress: Map<string, GroupProgress>
  lastTickAt: number
}

function readGroupProgress(rootSession: string, groupKey: string, analystName?: string): GroupProgress {
  const entries = Intel.get(rootSession)
  const groupIntel = entries.filter((e) => e.tags.includes(`group:${groupKey}`))
  const vulns = Vulnerability.get(rootSession)
  const groupVulns = analystName
    ? vulns.filter((v) => v.source_agent?.includes(analystName))
    : vulns.filter((v) => v.source_agent?.includes(groupKey))
  const draftCount = groupVulns.filter((v) => normalizeStatus(v.status ?? VulnStatus.DRAFT) === VulnStatus.DRAFT).length
  const triagedCount = groupVulns.filter((v) => {
    const s = normalizeStatus(v.status ?? VulnStatus.DRAFT)
    return s !== VulnStatus.DRAFT
  }).length
  return { intelCount: groupIntel.length, draftCount, triagedCount, staleTicks: 0 }
}

function spawnHelper(
  ctx: WatchdogContext,
  groupDef: CloudAnalysis.GroupDef,
  reason: string,
  progress: GroupProgress,
  bypassSem?: boolean,
): Promise<SpawnResult> {
  const helperContext = [
    `\n\n## Helper Mode — ${reason}`,
    `Original agent state: ${progress.triagedCount} triaged, ${progress.draftCount} still draft, ${progress.intelCount} intel entries.`,
    "Focus ONLY on findings still in draft status — skip any finding that has already been triaged or enriched.",
  ].join("\n")
  const prompt = ctx.provider.analystPrompt(groupDef, ctx.identityContext) + helperContext
  if (bypassSem) {
    return spawnAnalyst(ctx.sessionID, groupDef, prompt, ctx.model, AGENT_TIMEOUT_MS, ctx.messageID)
  }
  return (async () => {
    await ctx.sem.acquire()
    try { return await spawnAnalyst(ctx.sessionID, groupDef, prompt, ctx.model, AGENT_TIMEOUT_MS, ctx.messageID) }
    finally { ctx.sem.release() }
  })()
}

function startWatchdog(
  ctx: WatchdogContext,
  tracked: TrackedAgent[],
  helperResults: SpawnResult[],
): { stop: () => Promise<PromiseSettledResult<SpawnResult>[]>; state: WatchdogState } {
  const helpedGroups = new Set<string>()
  const helperPromises: Promise<SpawnResult>[] = []
  const runStartedAt = Date.now()
  let tickInProgress = false
  const wdState: WatchdogState = {
    ticks: 0,
    helpersSpawned: 0,
    groupProgress: new Map(),
    lastTickAt: Date.now(),
  }

  for (const t of tracked) {
    if (!wdState.groupProgress.has(t.groupKey)) {
      wdState.groupProgress.set(t.groupKey, { intelCount: 0, draftCount: 0, triagedCount: 0, staleTicks: 0 })
    }
  }

  const timer = setInterval(async () => {
    if (tickInProgress) return
    tickInProgress = true
    try {
      wdState.ticks++
      wdState.lastTickAt = Date.now()

      // Read current progress for each tracked group
      for (const t of tracked) {
        const prev = wdState.groupProgress.get(t.groupKey)!
        const current = readGroupProgress(ctx.rootSession, t.groupKey, t.analystName)
        const progressed = current.triagedCount > prev.triagedCount || current.intelCount > prev.intelCount
        current.staleTicks = progressed ? 0 : prev.staleTicks + 1
        wdState.groupProgress.set(t.groupKey, current)
      }

      // Layer 1: Self-spawn — agent signaled SCALE:<group> via add_intel
      const entries = Intel.get(ctx.rootSession)
      for (const e of entries) {
        if (!e.title.startsWith("SCALE:")) continue
        if (e.timeCreated && e.timeCreated < runStartedAt) continue
        const gk = e.title.slice(6).trim()
        if (helpedGroups.has(gk)) continue
        const groupDef = ctx.provider.groups().find((g) => g.key === gk)
        if (!groupDef) continue
        helpedGroups.add(gk)
        const progress = wdState.groupProgress.get(gk) ?? readGroupProgress(ctx.rootSession, gk, groupDef.analyst)
        console.log(`[watchdog] self-spawn: ${gk} requested help (${progress.triagedCount} triaged, ${progress.draftCount} draft)`)
        const p = spawnHelper(ctx, groupDef, "agent requested help", progress)
        helperPromises.push(p)
        p.then((r) => helperResults.push(r)).catch(() => {})
        wdState.helpersSpawned++
      }

      // Layer 2: Watchdog — stale or long-running agents
      for (const t of tracked) {
        if (helpedGroups.has(t.groupKey)) continue
        const elapsed = Date.now() - t.startTime
        const progress = wdState.groupProgress.get(t.groupKey)!

        // Stuck: no progress for 3 consecutive ticks (90s) and agent running > 2min
        const isStuck = progress.staleTicks >= 3 && elapsed > 2 * 60_000
        // Long-running: agent exceeds WATCHDOG_SPAWN_AFTER_MS and still has draft findings
        const isLongRunning = elapsed >= WATCHDOG_SPAWN_AFTER_MS && progress.draftCount > 0

        if (!isStuck && !isLongRunning) continue

        helpedGroups.add(t.groupKey)
        const reason = isStuck
          ? `stuck — no progress for ${progress.staleTicks * 30}s`
          : `long-running — ${Math.round(elapsed / 1000)}s elapsed, ${progress.draftCount} draft remaining`
        console.log(`[watchdog] ${t.groupKey}: ${reason} → spawning helper (${progress.triagedCount} triaged, ${progress.draftCount} draft, ${progress.intelCount} intel)`)
        const p = spawnHelper(ctx, t.groupDef, reason, progress, isStuck)
        helperPromises.push(p)
        p.then((r) => helperResults.push(r)).catch(() => {})
        wdState.helpersSpawned++
      }

      // Heartbeat
      if (wdState.ticks % 4 === 0) {
        const groupSummaries = [...wdState.groupProgress.entries()]
          .map(([k, p]) => `${k}:${p.triagedCount}t/${p.draftCount}d`)
          .join(" ")
        console.log(`[watchdog] heartbeat tick=${wdState.ticks} helpers=${wdState.helpersSpawned} ${groupSummaries}`)
      }
    } catch (err) {
      console.error(`[watchdog] tick ${wdState.ticks} error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      tickInProgress = false
    }
  }, WATCHDOG_INTERVAL_MS)

  return {
    state: wdState,
    stop: async () => {
      clearInterval(timer)
      const results = await Promise.allSettled(helperPromises)
      if (wdState.ticks === 0) {
        console.warn(`[watchdog] WARNING: watchdog never ticked — timer may have been blocked`)
      } else {
        console.log(`[watchdog] stopped after ${wdState.ticks} ticks, ${wdState.helpersSpawned} helpers spawned`)
      }
      return results
    },
  }
}

function chainToFollowUp(chain: ReturnType<typeof detectCloudChains>[number]): CloudAnalysis.FollowUp {
  const assetList = chain.assetNames.map((n) => `"${n}"`).join(" → ")
  return {
    reason: `[graph:${chain.pattern}] ${assetList} (${chain.confidence}% confidence)`,
    chain: chain.assetNames,
    groups: [],
    prompt: [
      `## Auto-Detected Chain: ${chain.pattern.toUpperCase()}`,
      `Assets: ${assetList}`,
      `Expected impact: ${chain.expectedImpact}`,
      `Severity: ${chain.severity}`,
      "",
      `### Testing Plan`,
      chain.testingPlan,
      "",
      "Use `cloud_get_context(include_chains: true)` to see the full graph. Verify each link in the chain is exploitable, then report findings.",
    ].join("\n"),
  }
}

async function detectFollowUps(
  parentID: string,
  rootSession: string,
  model: { providerID: string; modelID: string },
  messageID?: string,
): Promise<CloudAnalysis.FollowUp[]> {
  const graphChains = detectCloudChains(rootSession)
  const highConfidence = graphChains.filter((c) => c.confidence >= 80)
  const lowerConfidence = graphChains.filter((c) => c.confidence < 80)

  const directFollowUps = highConfidence.slice(0, 3).map(chainToFollowUp)

  const entries = Intel.get(rootSession)
  const textChains = entries.filter((e) => e.chainPotential)
  const targetHints = entries.filter((e) => e.tags.some((t) => t.startsWith("target:")))
  const escalations = entries.filter((e) => e.title.startsWith("ESCALATE:"))

  const hasTextSignals = textChains.length > 0 || targetHints.length > 0 || escalations.length > 0
  if (!hasTextSignals && lowerConfidence.length === 0) return directFollowUps

  const sections: string[] = []

  if (lowerConfidence.length > 0) {
    sections.push(formatCloudChainsForPrompt(lowerConfidence))
  }

  if (textChains.length > 0) {
    const chainSummary = textChains.slice(0, 30).map((e) => `- [${e.source ?? "?"}] ${e.title}: ${e.chainPotential}`).join("\n")
    sections.push(`## Text-Based Cross-Group Chains\n${chainSummary}`)
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
    "\nUse cloud_get_context and get_cloud_intel to see the full picture.",
    "\nFor each item worth investigating, respond with a JSON block:",
    '```json\n[{"reason":"...","chain":["group1","group2"],"groups":["group1","group2"],"prompt":"Detailed verification prompt for the follow-up agent"}]\n```',
    "\nIf nothing needs follow-up, respond with `[]`.",
    "\nBe selective — prioritize chains with real attack potential and escalated findings over routine hints.",
    "\nNote: high-confidence graph chains are already queued. Focus on the lower-confidence and text-based signals.",
  ].join("\n")

  const result = await spawnCloudAgent({
    parentID, agentName: "cloud-orchestrator", group: "followup-detect",
    title: "Chain detection (@cloud-orchestrator)",
    prompt, model, timeoutMs: FOLLOWUP_TIMEOUT_MS, messageID,
  })

  if (result.error) {
    console.warn(`[orchestrate] detectFollowUps failed: ${result.error}`)
    return directFollowUps
  }

  const jsonMatch = result.text.match(/```json\s*\n?([\s\S]*?)\n?```/)
  if (!jsonMatch) return directFollowUps

  try {
    const parsed = JSON.parse(jsonMatch[1])
    if (!Array.isArray(parsed)) return directFollowUps
    const llmFollowUps: CloudAnalysis.FollowUp[] = parsed.filter((f: any) => f.reason && f.prompt)
    return [...directFollowUps, ...llmFollowUps]
  } catch {
    return directFollowUps
  }
}

export async function orchestrateLayer2(provider: AssessmentProvider, sessionID: string, messageID?: string): Promise<CloudAnalysis.OrchestrationState> {
  const rootSession = Session.root(sessionID)
  const validation = provider.validate(rootSession)

  const state: CloudAnalysis.OrchestrationState = {
    phase: "idle",
    sessionID: rootSession,
    layer1Findings: validation.ok ? validation.totalFindings : 0,
    identityIntel: 0,
    triageStats: null,
    analystResults: [],
    followUps: [],
    verifyResult: null,
    startedAt: Date.now(),
    completedAt: null,
  }

  if (!validation.ok) {
    throw new Error(validation.reason)
  }
  if (validation.totalFindings === 0) {
    state.phase = "complete"
    state.completedAt = Date.now()
    return state
  }

  const deadlineTimer = setTimeout(() => {
    console.warn(`[orchestrate] Layer 2 hard deadline reached (${LAYER2_DEADLINE_MS / 1000}s)`)
  }, LAYER2_DEADLINE_MS)

  try {
    return await runOrchestration(provider, sessionID, rootSession, state, messageID)
  } finally {
    clearTimeout(deadlineTimer)
  }
}

async function runOrchestration(
  provider: AssessmentProvider,
  sessionID: string,
  rootSession: string,
  state: CloudAnalysis.OrchestrationState,
  messageID?: string,
): Promise<CloudAnalysis.OrchestrationState> {
  const model = await SessionPrompt.lastModel(sessionID)

  // ── Phase: identity ──────────────────────────────────────
  state.phase = "identity"
  const idGroup = provider.identityGroup()
  const spawnResults: SpawnResult[] = []

  if (idGroup) {
    const idFindingCount = provider.findingCount(rootSession, idGroup.key)
    const idAgentCount = Math.min(MAX_AGENTS_PER_GROUP, Math.max(1, Math.ceil(idFindingCount / FINDINGS_PER_AGENT)))
    console.log(`[orchestrate] identity: ${idFindingCount} findings → ${idAgentCount} agents (threshold: ${FINDINGS_PER_AGENT})`)

    const idSem = new Semaphore(MAX_CONCURRENT_AGENTS)
    const idStartTime = Date.now()
    const idTracked: TrackedAgent[] = []
    const idHelperResults: SpawnResult[] = []

    const idPromises = Array.from({ length: idAgentCount }, (_, i) => {
      const slice = idAgentCount > 1 ? `${i + 1}/${idAgentCount}` : undefined
      const prompt = provider.analystPrompt(idGroup, "", slice)
      const p = (async () => {
        await idSem.acquire()
        try {
          return await spawnAnalyst(sessionID, idGroup, prompt, model, AGENT_TIMEOUT_MS, messageID, slice)
        } finally {
          idSem.release()
        }
      })()
      idTracked.push({ groupKey: idGroup.key, groupDef: idGroup, analystName: idGroup.analyst, startTime: idStartTime, promise: p })
      return p
    })

    const idWatchdog = startWatchdog(
      { rootSession, sessionID, model, provider, identityContext: "", messageID, sem: idSem },
      idTracked,
      idHelperResults,
    )
    const idResults = await Promise.all(idPromises)
    await idWatchdog.stop()

    const allIdResults = [...idResults, ...idHelperResults]
    for (const r of allIdResults) spawnResults.push(r)
    const idBest = allIdResults.find((r) => !r.error) ?? allIdResults[0]
    if (!allIdResults.some((r) => !r.error)) {
      console.warn(`[orchestrate] all identity agents failed — parallel agents will run without identity context`)
    }
    if (idBest) {
      const result = buildAnalystResult(idGroup.key, idBest, rootSession)
      const idErrors = allIdResults.filter((r) => r.error)
      if (idErrors.length > 0) result.summary = `[${allIdResults.length - idErrors.length}/${allIdResults.length} agents ok] ${result.summary}`
      state.analystResults.push(result)
    }
  }

  const identityContext = provider.identityContext(rootSession)
  state.identityIntel = Intel.get(rootSession).filter((e) => e.tags.includes("group:identity")).length

  // ── Phase: triage (classify findings) ───────────────────
  state.phase = "triage"
  const remaining = provider.parallelGroups()
  const classified = provider.classify(rootSession, remaining)

  const investigateGroups = classified.filter((c) => c.investigate.length > 0)
  const investigateKeys = new Set(investigateGroups.map((g) => g.key))
  const formulaicGroups = classified.filter((c) => c.formulaic.length > 0 && !investigateKeys.has(c.key)).map((c) => c.key)
  const totalFormulaic = classified.reduce((sum, c) => sum + c.formulaic.length, 0)
  const totalInvestigate = classified.reduce((sum, c) => sum + c.investigate.length, 0)

  state.triageStats = {
    formulaic: totalFormulaic,
    investigate: totalInvestigate,
    groupsWithInvestigation: investigateGroups.map((g) => g.key),
  }

  const skippedGroups = remaining.filter((g) => !investigateKeys.has(g.key) && !formulaicGroups.includes(g.key))
  if (skippedGroups.length > 0) console.log(`[orchestrate] skipped groups (0 findings): ${skippedGroups.map((g) => g.key).join(", ")}`)
  console.log(`[orchestrate] triage: ${totalFormulaic} formulaic (${formulaicGroups.length} groups), ${totalInvestigate} investigate (${investigateGroups.length} groups)`)

  // ── Phase: parallel (batch verify + investigation analysts) ──
  state.phase = "parallel"
  const parallelTimeout = Math.min(AGENT_TIMEOUT_MS, LAYER2_DEADLINE_MS - (Date.now() - state.startedAt) - FOLLOWUP_RESERVE_MS)
  const effectiveTimeout = Math.max(parallelTimeout, 60_000)

  const sem = new Semaphore(MAX_CONCURRENT_AGENTS)
  const tasks: Promise<PromiseSettledResult<SpawnResult>>[] = []
  const taskMeta: { type: "batch" | "analyst"; groupKey?: string; groupDef?: CloudAnalysis.GroupDef }[] = []
  const parallelTracked: TrackedAgent[] = []
  const parallelHelperResults: SpawnResult[] = []

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
    const batchPrompt = provider.batchPrompt(formulaicGroups, identityContext)
    tasks.push(
      withSemaphore(() => spawnBatchVerifier(sessionID, batchPrompt, model, Math.min(BATCH_VERIFY_TIMEOUT_MS, effectiveTimeout), messageID)),
    )
    taskMeta.push({ type: "batch" })
  }

  for (const c of investigateGroups) {
    const groupDef = remaining.find((g) => g.key === c.key)
    if (!groupDef) continue
    const fc = provider.findingCount(rootSession, c.key)
    const agentCount = Math.min(MAX_AGENTS_PER_GROUP, Math.max(1, Math.ceil(fc / FINDINGS_PER_AGENT)))
    console.log(`[orchestrate] ${c.key}: ${fc} findings → ${agentCount} agents (threshold: ${FINDINGS_PER_AGENT})`)
    const spawnTime = Date.now()
    for (let i = 0; i < agentCount; i++) {
      const slice = agentCount > 1 ? `${i + 1}/${agentCount}` : undefined
      const prompt = provider.analystPrompt(groupDef, identityContext, slice)
      const p = withSemaphore(() => spawnAnalyst(sessionID, groupDef, prompt, model, effectiveTimeout, messageID, slice))
      tasks.push(p)
      taskMeta.push({ type: "analyst", groupKey: c.key, groupDef })
      parallelTracked.push({ groupKey: c.key, groupDef, analystName: groupDef.analyst, startTime: spawnTime, promise: p.then((r) => r.status === "fulfilled" ? r.value : { agent: groupDef.analyst, group: c.key, sessionID: "", text: "", error: "rejected", durationMs: 0 } as SpawnResult) })
    }
  }

  console.log(`[orchestrate] parallel: ${tasks.length} agents (max ${MAX_CONCURRENT_AGENTS} concurrent)`)

  const parallelWatchdog = startWatchdog(
    { rootSession, sessionID, model, provider, identityContext, messageID, sem },
    parallelTracked,
    parallelHelperResults,
  )
  const settled = await Promise.all(tasks)
  await parallelWatchdog.stop()

  const parallelGroupSpawns = new Map<string, SpawnResult[]>()
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
    } else if (meta.groupDef && meta.groupKey) {
      const spawn = s.status === "fulfilled"
        ? s.value
        : { agent: meta.groupDef.analyst, group: meta.groupKey, sessionID: "", text: "", error: (s as PromiseRejectedResult).reason?.message ?? "unknown error", durationMs: 0, timedOut: true } as SpawnResult
      spawnResults.push(spawn)
      if (!parallelGroupSpawns.has(meta.groupKey)) parallelGroupSpawns.set(meta.groupKey, [])
      parallelGroupSpawns.get(meta.groupKey)!.push(spawn)
    }
  }
  for (const r of parallelHelperResults) {
    spawnResults.push(r)
    if (!parallelGroupSpawns.has(r.group)) parallelGroupSpawns.set(r.group, [])
    parallelGroupSpawns.get(r.group)!.push(r)
  }
  if (parallelHelperResults.length > 0) console.log(`[watchdog] ${parallelHelperResults.length} helper agent(s) completed`)
  for (const [groupKey, spawns] of parallelGroupSpawns) {
    const best = spawns.find((s) => !s.error) ?? spawns[0]!
    const result = buildAnalystResult(groupKey, best, rootSession)
    const errors = spawns.filter((s) => s.error)
    if (errors.length > 0) result.summary = `[${spawns.length - errors.length}/${spawns.length} agents ok] ${result.summary}`
    state.analystResults.push(result)
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
    const followUps = await detectFollowUps(sessionID, rootSession, model, messageID)
    state.followUps = followUps

    if (followUps.length > 0) {
      const fuTimeout = Math.min(FOLLOWUP_TIMEOUT_MS, timeLeft - FOLLOWUP_RESERVE_MS)
      const fuSem = new Semaphore(MAX_CONCURRENT_AGENTS)
      const fuSettled = await Promise.allSettled(
        followUps.slice(0, 5).map(async (f) => {
          await fuSem.acquire()
          try { return await spawnFollowup(sessionID, f, model, Math.max(fuTimeout, 60_000), messageID) }
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
  const vulnDraft = vulnSummary.filter((v) => normalizeStatus(v.status ?? VulnStatus.DRAFT) === VulnStatus.DRAFT).length
  const vulnTriaged = vulnSummary.filter((v) => normalizeStatus(v.status ?? VulnStatus.DRAFT) === VulnStatus.TRIAGED).length
  const vulnPendingFix = vulnSummary.filter((v) => normalizeStatus(v.status ?? VulnStatus.DRAFT) === VulnStatus.PENDING_FIX).length
  const vulnRejected = vulnSummary.filter((v) => normalizeStatus(v.status ?? VulnStatus.DRAFT) === VulnStatus.REJECTED).length
  const vulnDuplicate = vulnSummary.filter((v) => v.status === VulnStatus.DUPLICATE).length

  const orchestrationSummary = [
    `- Dispatched: ${state.analystResults.length} analyst(s), ${state.followUps.length} follow-up(s)`,
    `- Completed: ${completedAnalysts.length} analyst(s)`,
    failedAnalysts.length > 0 ? `- FAILED/TIMED OUT: ${failedAnalysts.map((a) => a.group).join(", ")} — these groups may have INCOMPLETE coverage` : null,
    state.triageStats ? `- Classification: ${state.triageStats.formulaic} formulaic, ${state.triageStats.investigate} investigate` : null,
    `- Findings: ${vulnDraft} draft, ${vulnTriaged} triaged, ${vulnPendingFix} pending_fix, ${vulnRejected} rejected, ${vulnDuplicate} duplicate`,
    `- Total intel entries: ${Intel.get(rootSession).length}`,
    `- Elapsed: ${Math.round((Date.now() - state.startedAt) / 1000)}s`,
  ].filter(Boolean).join("\n")

  const verifyPrompt = provider.verifyPrompt(orchestrationSummary)
  const verifyResult = await spawnVerify(sessionID, verifyPrompt, model, verifyTimeout, messageID)
  spawnResults.push(verifyResult)

  state.verifyResult = {
    verified: 0,
    rejected: 0,
    downgraded: 0,
    missing: failedAnalysts.map((a) => a.group),
    summary: verifyResult.error ? `Error: ${verifyResult.error}` : verifyResult.text.slice(0, 500),
  }

  deduplicateFindings(rootSession)

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

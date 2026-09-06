import { argVal, hasFlag, run, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"
import type { AssessContext, AssessMetadata, AssessResult } from "./assess/types"
import { runPhase } from "./assess/runner"
import { analyzeTriage } from "./assess/triage"
import { formatAssessResult, formatAssessResultJSON } from "./assess/format"
import { AZURE_PHASES } from "./assess/phases"
import { storeAssessResult } from "./assess-cache"

// Severity ordering for sorting azure findings (self-contained in the package).
const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

const MAX_ASSESS_MS = 1_800_000
const DEFAULT_CONCURRENCY = 5

export async function azureAssess(args: string[], timeout: number, sessionID?: string): Promise<HookResult> {
  const start = Date.now()

  // parse args
  const sub = argVal(args, "--subscription-id")
  const resourceGroup = argVal(args, "--resource-group")
  const rawPerProgram = Number(argVal(args, "--timeout-per-program") ?? timeout)
  const perProgram = Number.isFinite(rawPerProgram) && rawPerProgram > 0 ? rawPerProgram : timeout
  const rawConcurrency = Number(argVal(args, "--max-concurrency") ?? DEFAULT_CONCURRENCY)
  const maxConcurrency = Number.isFinite(rawConcurrency) && rawConcurrency > 0 ? rawConcurrency : DEFAULT_CONCURRENCY
  const outputFormat = argVal(args, "--output") ?? "text"

  // build scoped args
  const subArgs: string[] = []
  if (sub) subArgs.push("--subscription-id", sub)
  if (resourceGroup) subArgs.push("--resource-group", resourceGroup)

  const ctx: AssessContext = {
    sub,
    subArgs,
    perProgram,
    deadline: Date.now() + MAX_ASSESS_MS,
    skipCompliance: hasFlag(args, "--skip-compliance"),
    subscriptions: [],
    maxConcurrency,
  }

  // pre-flight auth
  const authCheck = await run("az", ["account", "show", "-o", "json"], 15)
  const account = authCheck.exitCode === 0 ? tryJson(authCheck.stdout) : null
  const metadata: AssessMetadata = {
    timestamp: new Date().toISOString(),
    tenantId: account?.tenantId,
    subscriptionName: account?.name,
    accountUpn: account?.user?.name,
  }

  if (authCheck.exitCode !== 0) {
    const result: AssessResult = {
      authOk: false,
      authError: authCheck.stderr,
      metadata,
      subscriptions: [],
      phases: [],
      findings: [],
      duplicatesRemoved: 0,
      triage: { critical: [], high: [], flags: [] },
      skippedPhases: [],
      durationMs: Date.now() - start,
    }
    return { output: formatAssessResult(result), findings: [] }
  }

  // run phases — abort only after 2+ consecutive circuit breakers
  const phases = []
  let consecutiveBreaks = 0
  let aborted = false

  for (const phaseDef of AZURE_PHASES) {
    if (aborted) {
      phases.push({
        name: phaseDef.name,
        groups: [],
        findings: [],
        skipped: true,
        skipReason: "aborted (2+ consecutive phase circuit breakers)",
        durationMs: 0,
        circuitBroken: false,
      })
      continue
    }

    const phaseResult = await runPhase(phaseDef, ctx)
    phases.push(phaseResult)

    if (phaseResult.circuitBroken) {
      consecutiveBreaks++
      if (consecutiveBreaks >= 2) aborted = true
    } else {
      consecutiveBreaks = 0
    }

    if (phaseDef.name === "Identity & Permissions" && !phaseResult.skipped) {
      for (const g of phaseResult.groups) {
        for (const f of g.findings) {
          if (f.checkId !== "AZ-SUB-002" || !f.details) continue
          const line = f.details.split("\n").find((l) => l.startsWith("subscription_ids:"))
          if (!line) continue
          try {
            const ids = JSON.parse(line.slice("subscription_ids:".length))
            if (Array.isArray(ids)) ctx.subscriptions.push(...ids)
          } catch {
            console.warn("[assess] failed to parse subscription_ids from AZ-SUB-002 — multi-sub coverage may be incomplete")
          }
        }
      }
    }
  }

  // dedup findings
  const raw = phases.flatMap((p) => p.findings)
  const { unique, removed } = dedup(raw)

  const triage = analyzeTriage(unique)
  const skippedPhases = phases.filter((p) => p.skipped).map((p) => `${p.name} (${p.skipReason})`)

  const result: AssessResult = {
    authOk: true,
    authError: undefined,
    metadata,
    subscriptions: ctx.subscriptions,
    phases,
    findings: unique,
    duplicatesRemoved: removed,
    triage,
    skippedPhases,
    durationMs: Date.now() - start,
  }

  if (sessionID) storeAssessResult(sessionID, result)

  const output = outputFormat === "json" ? formatAssessResultJSON(result) : formatAssessResult(result)
  return { output, findings: unique }
}

function sevRank(sev: string): number {
  return SEV_RANK[sev.toLowerCase()] ?? 5
}

function dedup(findings: Finding[]): { unique: Finding[]; removed: number } {
  const best = new Map<string, Finding>()
  for (const f of findings) {
    const key = `${f.checkId}|${f.resource}`
    const prev = best.get(key)
    if (!prev || sevRank(f.severity) < sevRank(prev.severity)) {
      best.set(key, f)
    }
  }
  return { unique: [...best.values()], removed: findings.length - best.size }
}

export type { AssessResult, AssessContext, PhaseResult, GroupResult, TriageResult } from "./assess/types"

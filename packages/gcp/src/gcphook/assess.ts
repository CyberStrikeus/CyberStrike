import { gcloud, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"
import type { AssessContext, AssessMetadata, AssessResult } from "./assess/types"
import { runPhase } from "./assess/runner"
import { analyzeTriage } from "./assess/triage"
import { formatAssessResult, formatAssessResultJSON } from "./assess/format"
import { GCP_PHASES } from "./assess/phases"
import { storeAssessResult } from "./assess-cache"

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

const MAX_ASSESS_MS = 1_800_000
const DEFAULT_CONCURRENCY = 5

export async function gcpAssess(args: string[], timeout: number, sessionID?: string): Promise<HookResult> {
  const start = Date.now()

  const project = argVal(args, "--project")
  const rawPerProgram = Number(argVal(args, "--timeout-per-program") ?? timeout)
  const perProgram = Number.isFinite(rawPerProgram) && rawPerProgram > 0 ? rawPerProgram : timeout
  const rawConcurrency = Number(argVal(args, "--max-concurrency") ?? DEFAULT_CONCURRENCY)
  const maxConcurrency = Number.isFinite(rawConcurrency) && rawConcurrency > 0 ? rawConcurrency : DEFAULT_CONCURRENCY
  const outputFormat = argVal(args, "--output") ?? "text"

  const profileArgs: string[] = []
  if (project) profileArgs.push("--project", project)

  const ctx: AssessContext = {
    project,
    profileArgs,
    perProgram,
    deadline: Date.now() + MAX_ASSESS_MS,
    skipCompliance: hasFlag(args, "--skip-compliance"),
    maxConcurrency,
  }

  const authCheck = await gcloud(["auth", "print-identity-token"], 15)
  const configProject = await gcloud(["config", "get-value", "project", "--quiet"], 10)
  const configAccount = await gcloud(["config", "get-value", "account", "--quiet"], 10)

  const resolvedProject = project ?? configProject.stdout.trim()
  const metadata: AssessMetadata = {
    timestamp: new Date().toISOString(),
    projectId: resolvedProject || undefined,
    userEmail: configAccount.exitCode === 0 ? configAccount.stdout.trim() || undefined : undefined,
  }

  if (authCheck.exitCode !== 0 && !resolvedProject) {
    const result: AssessResult = {
      authOk: false,
      authError: authCheck.stderr || "No GCP project configured. Run: gcloud config set project PROJECT_ID",
      metadata,
      phases: [],
      findings: [],
      duplicatesRemoved: 0,
      triage: { critical: [], high: [], flags: [] },
      skippedPhases: [],
      durationMs: Date.now() - start,
    }
    return { output: formatAssessResult(result), findings: [] }
  }

  const phases = []
  let consecutiveBreaks = 0
  let aborted = false

  for (const phaseDef of GCP_PHASES) {
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
  }

  const raw = phases.flatMap((p) => p.findings)
  const { unique, removed } = dedup(raw)

  const triage = analyzeTriage(unique)
  const skippedPhases = phases.filter((p) => p.skipped).map((p) => `${p.name} (${p.skipReason})`)

  const result: AssessResult = {
    authOk: true,
    authError: undefined,
    metadata,
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

function dedup(findings: Finding[]): { unique: Finding[]; removed: number } {
  const best = new Map<string, Finding>()
  for (const f of findings) {
    const key = `${f.checkId}|${f.resource}`
    const prev = best.get(key)
    if (!prev || (SEV_RANK[f.severity.toLowerCase()] ?? 5) < (SEV_RANK[prev.severity.toLowerCase()] ?? 5)) {
      best.set(key, f)
    }
  }
  return { unique: [...best.values()], removed: findings.length - best.size }
}

export type { AssessResult, AssessContext, PhaseResult, GroupResult, TriageResult } from "./assess/types"

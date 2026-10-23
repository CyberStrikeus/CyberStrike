import { argVal, hasFlag, aws, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"
import type { AssessContext, AssessMetadata, AssessResult } from "./assess/types"
import { runPhase } from "./assess/runner"
import { analyzeTriage } from "./assess/triage"
import { formatAssessResult, formatAssessResultJSON } from "./assess/format"
import { AWS_PHASES } from "./assess/phases"
import { storeAssessResult } from "./assess-cache"

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

const MAX_ASSESS_MS = 1_800_000
const DEFAULT_CONCURRENCY = 5

export async function awsAssess(args: string[], timeout: number, sessionID?: string): Promise<HookResult> {
  const start = Date.now()

  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const rawPerProgram = Number(argVal(args, "--timeout-per-program") ?? timeout)
  const perProgram = Number.isFinite(rawPerProgram) && rawPerProgram > 0 ? rawPerProgram : timeout
  const rawConcurrency = Number(argVal(args, "--max-concurrency") ?? DEFAULT_CONCURRENCY)
  const maxConcurrency = Number.isFinite(rawConcurrency) && rawConcurrency > 0 ? rawConcurrency : DEFAULT_CONCURRENCY
  const outputFormat = argVal(args, "--output") ?? "text"

  const profileArgs: string[] = []
  if (profile) profileArgs.push("--profile", profile)
  if (region) profileArgs.push("--region", region)

  const ctx: AssessContext = {
    profile,
    region,
    profileArgs,
    perProgram,
    deadline: Date.now() + MAX_ASSESS_MS,
    skipCompliance: hasFlag(args, "--skip-compliance"),
    accounts: [],
    maxConcurrency,
  }

  const authCheck = await aws(["sts", "get-caller-identity"], profile, region, 15)
  const identity = authCheck.exitCode === 0 ? tryJson(authCheck.stdout) : null
  const metadata: AssessMetadata = {
    timestamp: new Date().toISOString(),
    accountId: identity?.Account,
    accountAlias: undefined,
    userArn: identity?.Arn,
  }

  if (authCheck.exitCode !== 0) {
    const result: AssessResult = {
      authOk: false,
      authError: authCheck.stderr,
      metadata,
      accounts: [],
      phases: [],
      findings: [],
      duplicatesRemoved: 0,
      triage: { critical: [], high: [], flags: [] },
      skippedPhases: [],
      durationMs: Date.now() - start,
    }
    return { output: formatAssessResult(result), findings: [] }
  }

  const aliasCheck = await aws(["iam", "list-account-aliases"], profile, region, 10)
  if (aliasCheck.exitCode === 0) {
    const parsed = tryJson(aliasCheck.stdout)
    if (parsed?.AccountAliases?.length > 0) metadata.accountAlias = parsed.AccountAliases[0]
  }

  const orgAccounts = await aws(["organizations", "list-accounts", "--query", "Accounts[].Id", "--output", "json"], profile, region, 15)
  if (orgAccounts.exitCode === 0) {
    const ids = tryJson(orgAccounts.stdout)
    if (Array.isArray(ids)) ctx.accounts = ids.filter((id: string) => id !== metadata.accountId)
  }

  const phases = []
  let consecutiveBreaks = 0
  let aborted = false

  for (const phaseDef of AWS_PHASES) {
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
    accounts: ctx.accounts,
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

import type { Finding } from "../shared"
import type {
  GroupDef,
  GroupResult,
  PhaseDef,
  PhaseResult,
  AssessContext,
  ProgramResult,
  ProgramEntry,
} from "./types"
import { Semaphore } from "@/util/semaphore"

// ── Retry classification ──────────────────────────────────────

const TRANSIENT = [/429/i, /timeout/i, /ECONNRESET/i, /ETIMEDOUT/i, /EPIPE/i, /throttl/i, /too many/i]
const NON_TRANSIENT = [/unauthorized/i, /login required/i, /ENOENT/i, /forbidden/i]
const PERMISSION_DENIED = [/AuthorizationFailed/i, /does not have authorization/i, /InsufficientPermissions/i, /AuthorizationPermissionMismatch/i]

function isTransient(err: string): boolean {
  if (NON_TRANSIENT.some((p) => p.test(err))) return false
  return TRANSIENT.some((p) => p.test(err))
}

function isPermissionDenied(err: string): boolean {
  return PERMISSION_DENIED.some((p) => p.test(err))
}

// ── Program runner with retry ─────────────────────────────────

const MAX_RETRIES = 2
const BACKOFF_BASE_MS = 2000

async function runProgram(entry: ProgramEntry, args: string[], timeout: number): Promise<ProgramResult> {
  const start = Date.now()
  let retries = 0

  for (;;) {
    try {
      const result = await entry.fn(args, timeout)
      return {
        name: entry.name,
        findings: result.findings,
        status: retries > 0 ? "retried" : "ok",
        error: undefined,
        durationMs: Date.now() - start,
        retryCount: retries,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (retries < MAX_RETRIES && isTransient(msg)) {
        retries++
        await new Promise((r) => setTimeout(r, BACKOFF_BASE_MS * Math.pow(2, retries - 1)))
        continue
      }
      return {
        name: entry.name,
        findings: [],
        status: isPermissionDenied(msg) ? "permission_denied" : "failed",
        error: msg,
        durationMs: Date.now() - start,
        retryCount: retries,
      }
    }
  }
}

// ── Group runner ──────────────────────────────────────────────

export async function runGroup(
  group: GroupDef,
  args: string[],
  timeout: number,
  deadline: number,
  maxConcurrency: number,
): Promise<GroupResult> {
  const start = Date.now()

  if (Date.now() > deadline) {
    return {
      key: group.key,
      label: group.label,
      programCount: group.programs.length,
      programs: [],
      findings: [],
      failures: [{ program: "*", reason: "deadline exceeded" }],
      permissionFailures: [],
      durationMs: 0,
    }
  }

  const remaining = deadline - Date.now()
  const effective = Math.min(timeout, Math.ceil(remaining / 1000))

  const sem = new Semaphore(maxConcurrency)
  const programResults = await Promise.all(
    group.programs.map(async (p) => {
      await sem.acquire()
      try {
        return await runProgram(p, args, effective)
      } finally {
        sem.release()
      }
    }),
  )

  const findings: Finding[] = []
  const failures: { program: string; reason: string }[] = []
  const permissionFailures: { program: string; reason: string }[] = []

  for (const pr of programResults) {
    findings.push(...pr.findings)
    if (pr.status === "permission_denied" && pr.error) {
      permissionFailures.push({ program: pr.name, reason: pr.error })
    } else if (pr.status === "failed" && pr.error) {
      failures.push({ program: pr.name, reason: pr.error })
    }
  }

  return {
    key: group.key,
    label: group.label,
    programCount: group.programs.length,
    programs: programResults,
    findings,
    failures,
    permissionFailures,
    durationMs: Date.now() - start,
  }
}

// ── Phase runner with circuit breaker ─────────────────────────

const CIRCUIT_BREAKER_THRESHOLD = 0.8
const CIRCUIT_BREAKER_MIN_PROGRAMS = 3

export async function runPhase(phase: PhaseDef, ctx: AssessContext): Promise<PhaseResult> {
  const start = Date.now()

  const skipReason = phase.skip?.(ctx)
  if (skipReason) {
    return {
      name: phase.name,
      groups: [],
      findings: [],
      skipped: true,
      skipReason,
      durationMs: 0,
      circuitBroken: false,
    }
  }

  if (Date.now() > ctx.deadline) {
    return {
      name: phase.name,
      groups: [],
      findings: [],
      skipped: true,
      skipReason: "deadline exceeded",
      durationMs: 0,
      circuitBroken: false,
    }
  }

  const groups: GroupResult[] = []
  const findings: Finding[] = []
  let circuitBroken = false

  for (const g of phase.groups) {
    if (circuitBroken) {
      groups.push({
        key: g.key,
        label: g.label,
        programCount: g.programs.length,
        programs: [],
        findings: [],
        failures: [{ program: "*", reason: "circuit breaker tripped" }],
        permissionFailures: [],
        durationMs: 0,
      })
      continue
    }

    const result = await runGroup(g, ctx.subArgs, ctx.perProgram, ctx.deadline, ctx.maxConcurrency)
    groups.push(result)
    findings.push(...result.findings)

    const realFailures = result.failures.length
    const totalPrograms = result.programCount - result.permissionFailures.length
    if (
      totalPrograms >= CIRCUIT_BREAKER_MIN_PROGRAMS &&
      realFailures / totalPrograms >= CIRCUIT_BREAKER_THRESHOLD
    ) {
      circuitBroken = true
    }
  }

  return {
    name: phase.name,
    groups,
    findings,
    skipped: false,
    skipReason: undefined,
    durationMs: Date.now() - start,
    circuitBroken,
  }
}

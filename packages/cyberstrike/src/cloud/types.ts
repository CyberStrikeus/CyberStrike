import z from "zod"

export namespace CloudAnalysis {
  // ── Group definition ──────────────────────────────────────────

  export interface GroupDef {
    key: string
    label: string
    analyst: string
    programs: string[]
    description: string
  }

  // ── Phase tracking ────────────────────────────────────────────

  export const Phase = z.enum([
    "idle",
    "layer1",
    "identity",
    "triage",
    "parallel",
    "sync",
    "followup",
    "verify",
    "complete",
  ])
  export type Phase = z.infer<typeof Phase>

  // ── Analyst result ────────────────────────────────────────────

  export interface AnalystResult {
    analyst: string
    group: string
    verified: number
    rejected: number
    elevated: number
    intelAdded: number
    chains: string[]
    summary: string
  }

  // ── Follow-up definition ──────────────────────────────────────

  export interface FollowUp {
    reason: string
    chain: string[]
    groups: string[]
    prompt: string
  }

  // ── Orchestration state ───────────────────────────────────────

  export interface TriageStats {
    formulaic: number
    investigate: number
    groupsWithInvestigation: string[]
  }

  export interface OrchestrationState {
    phase: Phase
    sessionID: string
    layer1Findings: number
    identityIntel: number
    triageStats: TriageStats | null
    analystResults: AnalystResult[]
    followUps: FollowUp[]
    verifyResult: VerifyResult | null
    startedAt: number
    completedAt: number | null
  }

  // ── Verify result ─────────────────────────────────────────────

  export interface VerifyResult {
    approved: number
    rejected: number
    downgraded: number
    missing: string[]
    summary: string
  }
}

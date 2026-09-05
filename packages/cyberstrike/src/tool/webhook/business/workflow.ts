// Workflow-skip candidate generator (plan §05 business_test). Given an ordered
// sequence of endpoints that form a business process (checkout steps, approval
// chain, password-reset flow), generates "skip" variants: try later steps
// directly, skip intermediate steps, replay earlier steps after completion.
//
// Pure data generation — no I/O. The probe orchestrator sends each candidate
// via the shared HttpSender and compares the outcome to the expected "blocked"
// response (the agent judges what "blocked" means for each app).
import type { ProbeRequest } from "../transport"

export interface WorkflowStep {
  name: string
  request: ProbeRequest
  order: number
}

export interface SkipCandidate {
  name: string
  description: string
  request: ProbeRequest
  skippedSteps: string[]
  strategy: SkipStrategy
}

export type SkipStrategy = "skip_to_end" | "skip_middle" | "reverse_order" | "repeat_step" | "skip_one"

export namespace WorkflowSkip {
  export function generate(steps: readonly WorkflowStep[]): SkipCandidate[] {
    if (steps.length < 2) return []
    const sorted = [...steps].sort((a, b) => a.order - b.order)
    const candidates: SkipCandidate[] = []

    // Strategy 1: skip directly to the last step (most common exploit)
    if (sorted.length >= 2) {
      const last = sorted[sorted.length - 1]
      const skipped = sorted.slice(0, -1).map((s) => s.name)
      candidates.push({
        name: `skip-to-${last.name}`,
        description: `Skip all prior steps, go directly to "${last.name}"`,
        request: last.request,
        skippedSteps: skipped,
        strategy: "skip_to_end",
      })
    }

    // Strategy 2: skip each intermediate step individually
    if (sorted.length >= 3) {
      for (let i = 1; i < sorted.length - 1; i++) {
        const target = sorted[i + 1]
        candidates.push({
          name: `skip-${sorted[i].name}-to-${target.name}`,
          description: `Skip "${sorted[i].name}", go from "${sorted[i - 1].name}" to "${target.name}"`,
          request: target.request,
          skippedSteps: [sorted[i].name],
          strategy: "skip_one",
        })
      }
    }

    // Strategy 3: skip middle steps (first → last, bypassing everything between)
    if (sorted.length >= 4) {
      const last = sorted[sorted.length - 1]
      const middle = sorted.slice(1, -1).map((s) => s.name)
      candidates.push({
        name: `skip-middle-to-${last.name}`,
        description: `Complete "${sorted[0].name}" then skip to "${last.name}"`,
        request: last.request,
        skippedSteps: middle,
        strategy: "skip_middle",
      })
    }

    // Strategy 4: reverse order — try step 1 after step N (repeat/replay)
    if (sorted.length >= 2) {
      const first = sorted[0]
      candidates.push({
        name: `repeat-${first.name}-after-end`,
        description: `Replay "${first.name}" after completing the workflow (double-spend, re-apply)`,
        request: first.request,
        skippedSteps: [],
        strategy: "repeat_step",
      })
    }

    // Strategy 5: reverse the entire order
    if (sorted.length >= 3) {
      const reversed = [...sorted].reverse()
      for (const step of reversed.slice(0, -1)) {
        candidates.push({
          name: `reverse-${step.name}`,
          description: `Try "${step.name}" in reverse order (step ${step.order} before its predecessors)`,
          request: step.request,
          skippedSteps: sorted
            .filter((s) => s.order > step.order)
            .map((s) => s.name),
          strategy: "reverse_order",
        })
      }
    }

    return candidates
  }
}

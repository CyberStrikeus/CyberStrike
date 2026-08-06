// Cross-turn "agent monologue" / no-progress detector (loop-termination Layer 2).
// Pure state machine — no framework/DB/IO — so it is deterministic and unit-testable
// with no mocks. It complements, and does NOT duplicate, two existing mechanisms:
//   - the WITHIN-turn identical-call repeat is handled by the doom_loop check
//     (processor.ts) + the resolveTools duplicate-suppressor (prompt.ts);
//   - the ABSOLUTE cap is the step-cap (Layer 1).
// This catches the OTHER failure: a weak model that keeps taking turns emitting only
// read/status tool calls (or narration) and never finishes with a tool-free message.
//
// One instance per subagent run (see session/prompt.ts). Not shared across concurrent
// sibling subagents (that would race and cross-contaminate the streak).
import { isProgressTool } from "./signals"

export type StuckReason = "monologue"

export type Verdict =
  | { kind: "ok" }
  | { kind: "nudge"; reason: StuckReason; detail: string } // 1st strike — force wrap-up next turn
  | { kind: "abort"; reason: StuckReason; detail: string } // 2nd strike — terminate the run

export interface StepObservation {
  /** The tool calls the model made in this step (empty = a text-only step). */
  toolCalls: { tool: string }[]
}

export interface StuckConfig {
  enabled: boolean
  /** Consecutive no-progress steps before the detector reacts. */
  maxMonologue: number
}

// Monologue rule DISABLED — it is too coarse. A retest (XBEN-025, qwen3-coder) showed
// that even with a MONOLOGUE_MIN_STEP grace window it over-fires: it nudged ~70% of
// subagents INCLUDING the orchestrator, because normal operation has short no-progress
// stretches (the orchestrator polling web_get_session_context while an ingest is in
// flight; a tester in its read/record phase after real testing). "N consecutive
// no-progress steps" cannot distinguish a genuine stall from legitimate coordination.
// The RepeatDetector (byte-identical cross-turn repeats) is the correct, targeted fix
// for the reported loop and does NOT over-fire. Re-enable only with a properly scoped
// design (orchestrator-exempt, much higher threshold, args-aware).
export const DEFAULT_STUCK_CONFIG: StuckConfig = { enabled: false, maxMonologue: 3 }

export class StuckDetector {
  private streak = 0
  private nudged = false

  constructor(private readonly cfg: StuckConfig) {}

  /**
   * Feed one completed step. A step is "progress" iff it made at least one non-read-only
   * tool call (see signals.isProgressTool). No-progress steps accumulate a streak; once
   * it reaches `maxMonologue` the detector nudges once, then aborts if it stays stuck.
   */
  observe(step: StepObservation): Verdict {
    if (!this.cfg.enabled) return { kind: "ok" }

    const madeProgress = step.toolCalls.some((c) => isProgressTool(c.tool))
    if (madeProgress) {
      this.streak = 0
      return { kind: "ok" }
    }

    this.streak++
    if (this.streak < this.cfg.maxMonologue) return { kind: "ok" }

    const detail = `${this.streak} consecutive no-progress steps (only read/status tools, no real testing)`
    if (this.nudged) return { kind: "abort", reason: "monologue", detail }
    this.nudged = true
    return { kind: "nudge", reason: "monologue", detail }
  }

  /** Clear all state — call at the start of each subagent run. */
  reset(): void {
    this.streak = 0
    this.nudged = false
  }
}

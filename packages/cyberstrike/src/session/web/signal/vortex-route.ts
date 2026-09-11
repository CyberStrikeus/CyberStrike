// Vortex signal → retest routing policy (issue #14). Pure + testable: given a Vortex
// signal's category + severity, decide the owning WSTG SpecialistClass and whether it
// auto-routes into the deterministic retest pipeline. Vortex's engine and the CS signal
// fabric use different category taxonomies, so this is the ONE place the Vortex
// vocabulary maps onto the WSTG owner classes the retest-worker dispatches by.
import type { SpecialistClass } from "./types"

export type VortexSeverity = "info" | "low" | "medium" | "high" | "critical"

// Vortex rule `category` → the WSTG SpecialistClass that owns it. An unmapped category
// returns undefined: the signal is still SURFACED in the sidebar, just not auto-routed
// (so a new Vortex category never silently spawns the wrong agent).
const CATEGORY_OWNER: Record<string, SpecialistClass> = {
  injection: "input-validation",
  misconfiguration: "config-deployment",
  "access-control": "authorization",
  "info-disclosure": "information-gathering",
  auth: "authentication",
  "auth-session": "session-management",
  redirect: "client-side",
  "vulnerable-component": "config-deployment",
  technology: "information-gathering",
}

export function categoryToClass(category: string): SpecialistClass | undefined {
  return CATEGORY_OWNER[category]
}

// Retest queue priority is a coarser 3-level scale than Vortex severity.
export function signalPriority(severity: VortexSeverity): "high" | "medium" | "low" {
  if (severity === "critical" || severity === "high") return "high"
  if (severity === "medium") return "medium"
  return "low"
}

// Only medium+ signals auto-spawn a specialist (the volume gate — low/info Vortex leads,
// e.g. an informational header note, stay visible in the sidebar but don't burn an LLM
// spawn). A signal is routable only if it ALSO has an owning class.
// Exception: `technology` always routes despite being info-severity — it does not spawn an
// agent of its own (information-gathering owns it, and a tech-only flag resolves to no agent),
// it exists to TAG the endpoint with its stack slug so any later retest injects the matching
// TechPlaybook. Dropping it would lose that enrichment (full CS-parity requirement, #15).
export function shouldRoute(category: string, severity: VortexSeverity): boolean {
  if (!categoryToClass(category)) return false
  if (category === "technology") return true
  return severity === "critical" || severity === "high" || severity === "medium"
}

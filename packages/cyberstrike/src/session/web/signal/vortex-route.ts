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

// Per-RULE owner overrides, where a rule's correct WSTG owner is finer than its broad Vortex
// category. Vortex categorizes coarsely (e.g. weak cookies, stack traces and CORS are all
// "misconfiguration"), but the CS signal fabric routed each to a specific specialist — these keep
// that parity so a signal still reaches the right owner after the fabric is retired (#15 slice 1).
const RULE_OWNER: Record<string, SpecialistClass> = {
  "weak-cookie-flags": "session-management", // a session-cookie hardening issue (WSTG 4.6)
  "stack-trace-signature": "error-handling", // verbose error (WSTG 4.8)
  "full-path-disclosure": "error-handling",
  "cors-origin-reflection-with-credentials": "client-side", // CORS is client-side-exploitable (WSTG 4.11)
  "cors-wildcard-origin": "client-side",
  "graphql-introspection-enabled": "api", // GraphQL schema disclosure → the API specialist (WSTG-APIT-99)
}

// The owning specialist for a signal: a per-rule override when the rule's WSTG owner is finer than
// its category, else the category default. Used by both the retest bridge and the sidebar view so
// they agree on ownership.
export function ownerForSignal(ruleId: string, category: string): SpecialistClass | undefined {
  return RULE_OWNER[ruleId] ?? categoryToClass(category)
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

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
  // hypothesis-* behavioral rules whose coarse Vortex category routes them to an adjacent specialist,
  // but whose actual WSTG owner (per the rule's own tag) is finer. Without these, wstg-business-logic
  // and (part of) wstg-api would never be dispatched by the deterministic router.
  "hypothesis-payment-flow": "business-logic", // price/qty tampering, race on payment confirm (WSTG 4.10)
  "hypothesis-approval-flow": "business-logic", // approval/workflow state-machine bypass (WSTG 4.10)
  "hypothesis-api-docs": "api", // API schema/doc exposure, hidden/deprecated endpoints (WSTG-APIT)
  "hypothesis-bulk-batch": "api", // bulk/batch operation abuse — mass access, mixed-authz items (WSTG-APIT)
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

// Every signal that has an owning specialist is routed to it, at EVERY severity — informational and
// low leads (server banners, tech stack, missing security headers, deprecated APIs, directory listing,
// …) are real WSTG coverage the owning specialist must examine, not noise to drop. The previous
// medium+ "volume gate" silently starved config-deploy / info-gathering / session-mgmt / error-handling
// of their low/info findings. Fan-out stays bounded by dedup (per-host dedupKey) and the per-endpoint
// group cap, and ordering is set by signalPriority() (severity still drives queue priority, so
// critical/high are examined first) — NOT by a severity floor. An unmapped category still returns false
// so a new Vortex category never silently spawns the wrong agent.
export function shouldRoute(category: string, _severity: VortexSeverity): boolean {
  return !!categoryToClass(category)
}

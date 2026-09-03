// CyberStrike HackBrowser 2.0 — action policy (deterministic guard).
//
// Maps a classified element kind (classify.ts) to a policy the AI must obey:
//   - deny    : the AI must NOT perform this action.
//   - confirm : irreversible — requires explicit human confirmation first.
//   - allow   : proceed.
//
// This is the prevention half of risk #1 (destructive-action guard) and issue #1
// (a click on a logout element revokes the session's OAuth token). Single source
// of truth: this is the ONLY place kind→policy is decided, so the state annotation
// (today) and the click brick's enforcement (once the WS control channel exists)
// share the exact same rule — no divergence.

import type { ElementKind } from "./classify"

export type ActionPolicy = "allow" | "confirm" | "deny"

export function actionPolicy(kind: ElementKind | undefined): ActionPolicy {
  // logout ends the session server-side → revokes the OAuth token family (issue #1).
  // The AI must never click it; only a human, via handover, re-authenticates.
  if (kind === "logout") return "deny"
  // destructive is irreversible (delete/deactivate/cancel-subscription) → gate on
  // explicit human confirmation rather than block outright.
  if (kind === "destructive") return "confirm"
  // mutating (save/create/pay) proceeds today; payment-grade verbs will get their
  // own tag + confirm later (see design §6 / risk #1 follow-up).
  return "allow"
}

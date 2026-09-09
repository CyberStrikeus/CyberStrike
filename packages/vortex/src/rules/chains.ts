// Chain rules (the correlation DSL → CorpusRule). Multi-step, cross-transaction findings a single
// per-response rule can't see: a value that appears in response A and is reused in request B. Both
// use VALUE correlation (`reuses`, field-agnostic via taint) so they don't depend on knowing the
// token/id field name. Constrained to stay low-false-positive (a bare value-reuse fires on every
// normal session-cookie flow — so #1 requires DISTINCT identities, #2 a sensitive-token field).
import type { ChainRule } from "../chain"

export const chainRules: ChainRule[] = [
  {
    // Broken object-level access control: a value from identity A's response is used in identity B's
    // request, and B succeeds — B reached A's resource. distinctIdentity is what makes it a finding
    // (not a normal same-user flow); the ordered A→B lineage is what a per-response rule can't express.
    id: "cross-identity-value-reuse",
    category: "access-control",
    severity: "high",
    steps: [
      { as: "owner", when: "resp.status == 200" },
      { as: "attacker", when: "resp.status == 200", reuses: "owner" },
    ],
    distinctIdentity: true,
    message: "A value from {owner.identity}'s response ({owner.endpoint}) was reused in {attacker.identity}'s request ({attacker.endpoint}) — cross-account access (shared: {shared})",
    tags: ["access-control", "idor"],
  },
  {
    // A sensitive one-time token exposed in a response body and then reused downstream. Constrained
    // to token-ish response fields so it doesn't fire on ordinary value flow.
    id: "reset-token-leak-reuse",
    category: "auth-session",
    severity: "critical",
    steps: [
      { as: "leak", when: "resp.body.reset_token || resp.body.reset_password_token || resp.body.password_reset_token || resp.body.otp || resp.body.activation_token || resp.body.verification_token" },
      { as: "use", when: "resp.status == 200", reuses: "leak" },
    ],
    message: "A sensitive token exposed by {leak.endpoint} was reused at {use.endpoint} (shared: {shared})",
    tags: ["auth-session", "token-leak"],
  },
]

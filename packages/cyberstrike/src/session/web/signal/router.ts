// Signal router (plan §07, closes B5). Deterministic signal_type → specialist
// map. Cross-lane handoff no longer depends on an agent choosing to emit an
// add_intel hint and the orchestrator choosing to route it — a fired signal is
// mechanically owned by exactly ONE specialist.
//
// The map is TOTAL over SignalType: a `satisfies` check makes a missing entry a
// compile error, and route() throws on an unknown type so a gap can never be
// silently dropped.

import type { Signal, SignalType, SpecialistClass } from "./types"

// One owner per signal. Where the plan lists a secondary specialist, the primary
// is chosen here for deterministic routing; the primary hands off in-band if the
// confirmation shows the finding belongs to the secondary.
const OWNER: Record<SignalType, SpecialistClass> = {
  full_path_disclosure: "misconfiguration",
  stack_trace: "misconfiguration",
  sql_error: "injection",
  server_banner: "misconfiguration",
  directory_listing: "misconfiguration",
  missing_security_headers: "misconfiguration",
  cors_misconfig: "misconfiguration",
  weak_cookie_flags: "auth-session",
  sensitive_data_exposure: "misconfiguration",
  open_redirect: "access-control",
  graphql_introspection: "access-control",
  exposed_artifact: "misconfiguration",
  jwt_leak: "auth-session",
  reflected_input: "injection",
  stored_reflection: "injection",
  rate_limit_absent: "business-logic",
} satisfies Record<SignalType, SpecialistClass>

// Retest priority per signal type — how urgently the owning specialist should
// confirm it. Mirrors WebRetest's "high | medium | low". High = a strong lead of a
// real, often high-severity finding (server-side execution/leak); low = pure
// fingerprint noise. Total over SignalType (satisfies) so a new type must be triaged.
export type RetestPriority = "high" | "medium" | "low"

const PRIORITY: Record<SignalType, RetestPriority> = {
  sql_error: "high",
  stored_reflection: "high",
  full_path_disclosure: "high",
  exposed_artifact: "high",
  sensitive_data_exposure: "high",
  open_redirect: "high",
  graphql_introspection: "high",
  stack_trace: "medium",
  cors_misconfig: "medium",
  weak_cookie_flags: "medium",
  jwt_leak: "medium",
  missing_security_headers: "medium",
  directory_listing: "medium",
  reflected_input: "medium",
  rate_limit_absent: "medium",
  server_banner: "low",
} satisfies Record<SignalType, RetestPriority>

export interface RoutedSignal {
  specialist: SpecialistClass
  signal: Signal
}

export class SignalRouter {
  /** The specialist that owns a signal type. Throws on an unknown type. */
  ownerOf(type: SignalType): SpecialistClass {
    const owner = OWNER[type]
    if (!owner) throw new Error(`SignalRouter: no owner mapped for signal type "${type}"`)
    return owner
  }

  /**
   * Resolve the owning specialist for a signal. The signal's own `owner` (set by
   * the detector) must agree with the routing table — a mismatch is a bug, not a
   * silent override — so we trust the table as the single source of truth.
   */
  route(signal: Signal): RoutedSignal {
    return { specialist: this.ownerOf(signal.type), signal }
  }

  /** Retest urgency for a signal type. Throws on an unknown type (no silent default). */
  priorityOf(type: SignalType): RetestPriority {
    const p = PRIORITY[type]
    if (!p) throw new Error(`SignalRouter: no priority mapped for signal type "${type}"`)
    return p
  }

  /** Every signal type the router can route — for coverage assertions/tests. */
  static signalTypes(): SignalType[] {
    return Object.keys(OWNER) as SignalType[]
  }
}

// Cross-transaction access-control rules — the "A vs B" the whole two-identity setup exists for.
// These correlate over the corpus (not one request) to surface access-control REVIEW candidates
// deterministically, so the authz/idor agents get pre-filtered targets instead of discovering them
// by luck. They flag SURFACE (worth testing), not confirmed vulns — confirmation is an agent step.
import type { Transaction } from "../transaction"
import type { CorpusRule, Signal } from "../rule"
import { groupByEndpoint, identities } from "../corpus"
import { isSuccess } from "../scope"

// An endpoint that returned 2xx under two or more DISTINCT identities (including anonymous) is a
// cross-identity access-control surface: either legitimate shared access, or a missing tenant/role
// check (BFLA / IDOR). Deterministic from the corpus — no probing. One signal per endpoint.
export const crossIdentityAccess: CorpusRule = {
  id: "cross-identity-access",
  title: "Endpoint reached under multiple identities",
  category: "access-control",
  severity: "low",
  evaluate(txs: Transaction[]): Signal[] {
    const out: Signal[] = []
    for (const [key, group] of groupByEndpoint(txs)) {
      const reached = group.filter(isSuccess)
      if (reached.length === 0) continue
      const who = identities(reached)
      if (who.size < 2) continue
      // Anchor the signal to one representative transaction from the group.
      const anchor = reached[0]
      out.push({
        ruleId: this.id,
        transactionId: anchor.id,
        severity: "low",
        category: "access-control",
        title: "Endpoint reachable under multiple identities — access-control review",
        evidence: `${key} reached by: ${[...who].join(", ")}`,
        dedupKey: `${this.id}:${key}`,
      })
    }
    return out
  },
}

// An endpoint reached BOTH authenticated and ANONYMOUS with 2xx is a stronger candidate: an authed
// feature that is also served without credentials = likely broken access control.
export const unauthenticatedReach: CorpusRule = {
  id: "unauthenticated-reach",
  title: "Authenticated endpoint also reachable anonymously",
  category: "access-control",
  severity: "medium",
  evaluate(txs: Transaction[]): Signal[] {
    const out: Signal[] = []
    for (const [key, group] of groupByEndpoint(txs)) {
      const reached = group.filter(isSuccess)
      const authed = reached.some((t) => t.identity && t.identity !== "(anonymous)")
      const anon = reached.some((t) => !t.identity)
      if (!authed || !anon) continue
      const anchor = reached.find((t) => !t.identity) ?? reached[0]
      out.push({
        ruleId: this.id,
        transactionId: anchor.id,
        severity: "medium",
        category: "access-control",
        title: "Authenticated endpoint also reachable anonymously",
        evidence: `${key} returned 2xx with no credentials`,
        dedupKey: `${this.id}:${key}`,
      })
    }
    return out
  },
}

export const accessRules: CorpusRule[] = [crossIdentityAccess, unauthenticatedReach]

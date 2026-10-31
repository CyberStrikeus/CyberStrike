// Cross-transaction access-control rules — the "A vs B" the whole two-identity setup exists for.
// These correlate over the corpus (not one request) to surface access-control REVIEW candidates
// deterministically, so the authz/idor agents get pre-filtered targets instead of discovering them by
// luck. They flag SURFACE (worth testing), not confirmed vulns — confirmation is an agent step.
//
// Authored as DECLARATIVE corpus rules (data, not code): group by endpoint, keep only the 2xx-reached
// transactions (`where`), then a `having` quantifier asks the cross-transaction question. See
// corpus-rule.ts for the shape and expr.ts for the any/all/count/countDistinct quantifiers.
import { compileCorpusRule, type CorpusRuleDef } from "../corpus-rule"

export const accessRuleDefs: CorpusRuleDef[] = [
  {
    // An endpoint returned 2xx under two or more DISTINCT identities (anonymous counts as one) = a
    // cross-identity access-control surface: shared access, or a missing tenant/role check (BFLA/IDOR).
    id: "cross-identity-access",
    title: "Endpoint reached under multiple identities",
    category: "access-control",
    severity: "low",
    corpus: {
      groupBy: "endpoint",
      where: "resp.status >= 200 && resp.status < 300",
      having: "countDistinct(identity) >= 2",
      list: "identity",
    },
    message: "Endpoint reachable under multiple identities — access-control review",
    evidence: "{group} reached by: {list}",
    tags: ["access-control", "idor", "bfla"],
  },
  {
    // An endpoint reached BOTH authenticated AND anonymously with 2xx is a stronger candidate: an authed
    // feature also served without credentials = likely broken access control. Anonymous = empty identity.
    id: "unauthenticated-reach",
    title: "Authenticated endpoint also reachable anonymously",
    category: "access-control",
    severity: "medium",
    corpus: {
      groupBy: "endpoint",
      where: "resp.status >= 200 && resp.status < 300",
      having: 'any(identity != "" && identity != "(anonymous)") && any(identity == "")',
    },
    message: "Authenticated endpoint also reachable anonymously",
    evidence: "{group} returned 2xx with no credentials",
    tags: ["access-control", "broken-access-control"],
  },
]

export const crossIdentityAccess = compileCorpusRule(accessRuleDefs[0]!)
export const unauthenticatedReach = compileCorpusRule(accessRuleDefs[1]!)
export const accessRules = [crossIdentityAccess, unauthenticatedReach]

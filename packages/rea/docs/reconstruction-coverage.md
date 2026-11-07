# Reconstruction coverage

`rea evaluate-reconstruction-coverage coverage.json --json` evaluates an inline
coverage workspace and its selected `boundary_id`. MCP exposes the same input
through `evaluate_reconstruction_coverage`. Results contain a status, reasons,
recommended probes and Evidence references; the supplied bundle retains the
complete records.

Evidence IDs and bundle manifests must authenticate before evaluation. A valid
record can still be insufficient proof: a passing verifier summary cannot
promote inferred Evidence into a replay observation. That case returns
`unknown`, while a missing or tampered record remains an input error.

## Effective completion scope

The selected boundary requires the union of its explicit surface IDs, the
surfaces of every required claim, and every declared dependency reachable from
those surfaces. Cycles are visited once. Missing reachable dependencies remain
visible as `dependency-surface-missing`; they keep closure partial. The
`required_surfaces` summary counts this complete set, including absent IDs,
and `required_claims` counts unique required claims.

Every reachable surface receives the same ownership, path, distribution,
disposition and authority-independence checks. Active contradictions on any of
these surfaces affect the boundary even when the caller did not repeat the
surface ID in `required_surface_ids`. Package proof must cover the artifacts of
this effective scope. A claim verifier must commit to its own surfaces and
their reachable dependencies, including their artifact and implemented-owner
digests. Callers do not need to duplicate the transitive closure in the request.

## Comparable verifier Evidence

At least one record explicitly cited by the latest verifier observation must
support the declared contract authority:

| Contract authority  | Evidence source                           | Confidence              |
| ------------------- | ----------------------------------------- | ----------------------- |
| `shipped-artifact`  | `shipped-artifact`                        | `observed` or `derived` |
| `controlled-replay` | `controlled-replay`                       | `observed`              |
| `live-observation`  | `controlled-replay` or `external-service` | `observed`              |
| `external`          | `external-service`                        | `observed`              |

Contextual references can accompany qualifying proof. An unrelated observed
record elsewhere in the bundle cannot repair a result that cites only
inference. Older observed results cannot replace the newest weak result.
Equivalent observations at the same instant can share qualifying proof from
one of those observations; conflicting tied assessments remain unknown.

## Package and integration proof

Build, clean-install and runtime-routing claims require observed runtime
Evidence (`controlled-replay` or `external-service`). Package-content and
authority-independence audits can also use observed or derived
`shipped-artifact` Evidence. Each proof must cite its qualifying records and
cover the selected boundary's artifact digests. An inference alone establishes
neither a passing nor a failed package workflow.

The evaluator preserves Evidence provenance and returns an actionable unknown
when qualification is unavailable. It does not change the cited records to
make their authority match a caller's declaration.

All applicable package-proof outcomes participate. A failed applicable proof
fails closure even when another proof passes; unknown, unsupported or skipped
applicable outcomes keep it unknown. The result cites all applicable outcomes.
Proof array order does not establish freshness or supersession. A proof for
unrelated artifact digests does not contradict the selected boundary.

## Function reconstruction claims

`verify_reconstruction` evaluates declared claims over retained comparison
Evidence. An `overall` function claim includes active residual unknowns scoped
to any of that comparison's dimensions. For example, an open pseudocode
question keeps the overall claim `unknown` and retains its unknown ID and
recommended probe; an independent assembly claim can still pass. An unknown
scoped only to `overall` does not block every individual dimension.

Selection uses each unknown's latest revision, its comparison identity and
Evidence references. Explicit unknown dependencies remain relevant across
dimensions. Unknowns for another comparison and resolved heads do not become
blockers merely because their source Evidence overlaps.

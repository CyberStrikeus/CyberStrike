# Reconstruction readiness verification

Run the public static-analysis journeys and synthetic report-evaluator checks
from a clean checkout:

```sh
npm ci
npm run verify:readiness
```

The command builds the redistributable native conformance fixtures, inspects
the native executable through the public CLI, and analyzes the JavaScript CLI
and Electron fixture sources through both CLI and MCP. It checks matching
CLI/MCP Evidence identities for those two application analyses. The fixture
applications are not executed, and native MCP parity is not exercised.

Separately, the command evaluates a wholly synthetic nine-stage input and
checks evaluator determinism, Evidence tampering rejection, and stale-source
digest rejection. These checks concern report evaluation; they do not establish
application runtime behavior, authority recovery, cancellation cleanup,
behavioral equivalence, or reconstruction closure for the analyzed fixtures.
The command prints one compact JSON summary.

Set `REA_READINESS_REPORT_PATH` to retain the complete machine-readable report:

```sh
REA_READINESS_REPORT_PATH=readiness-report.json npm run verify:readiness
```

CI runs this command on Linux, publishes the compact summary, and retains the
full report as the `reconstruction-readiness` artifact.

## Report scope and ownership

The verifier runs as `npm run verify:readiness`; it is not exposed as a public
CLI command or MCP tool. Its report separates two kinds of verification:

- `observed_journeys` retains the actual static-analysis Evidence and the
  observed CLI/MCP identity checks, with their coverage limits.
- `evaluator_conformance` retains the synthetic baseline report and the
  evaluator checks. Its nine-stage `pass` describes acceptance of supplied
  synthetic observations.

The verifier's overall success means its listed checks passed. It is not an
end-to-end reconstruction-readiness verdict. Actual analysis Evidence is not
grafted into the synthetic report or used to close its checks.

The retained artifact now uses `schema: "ReconstructionReadinessVerificationReport"`
and `schema_version: 1`. The previous unversioned artifact was the nine-stage
evaluator report itself. Consumers should read the two explicit sections; the
synthetic nine-stage report now lives at `evaluator_conformance.baseline_report`.
Observed CLI and MCP Evidence are retained in separate bundles under
`observed_journeys.evidence_bundles`, preserving each surface's records.

The evaluator, schemas, synthetic input, and semantic tests live under
`tests/conformance/readiness/report/`. They are development verification code,
excluded from the compiled runtime package. The evaluator authenticates Evidence
commitments and checks supplied observations for consistency; it does not
independently observe the events described by those observations.

## Synthetic evaluator stages

| Stage                           | Required supplied observations                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `discover-classify`             | target-free startup, artifact inventory, compatible workflow selection, and exact visible limits                      |
| `diagnose-environment`          | broken runtime separated from analysis failure, version skew detected, and revision changed after recovery            |
| `acquire-authority`             | missing scope reported, narrow grant resumed, expansion reprompted, and denial launched nothing                       |
| `static-analysis`               | native and JavaScript routing plus preserved ambiguity, truncation, unsupported syntax, and residual unknowns         |
| `reactive-scenarios`            | predicate-driven interaction, descendant settlement, Electron correlation, and cancellation cleanup Evidence          |
| `compare-authority-candidate`   | explicit partial-order/finite-trace semantics, primary divergence localization, and unknown for incomplete comparison |
| `preserve-contradictions`       | record-and-continue, affected equivalence blocked, and unaffected comparison retained                                 |
| `verify-reconstruction-closure` | incomplete reconstruction detected, incremental verifier closure, and authority-delegating candidates rejected        |
| `export-replay`                 | CLI/MCP parity, process/structured failure parity, deterministic replay, tamper rejection, and stale-input rejection  |

Within the synthetic input, every stage and required check must occur exactly
once and link to Evidence in its embedded bundle. `fail`, `unknown`,
`unsupported`, `truncated`, and `skipped` never aggregate to `pass`.

## Fail-closed rules

The evaluator rejects or withholds a passing synthetic report when:

- a bounded capability omits its effective numeric limits;
- a fixture lacks exactly one compatible selected workflow;
- an incompatible or unavailable provider was invoked;
- a typed CLI failure exits zero, or an MCP failure reports success;
- concurrent behavior uses total-order comparison;
- truncation, instability, unavailable authority, or contradiction is labeled
  equivalent;
- a deliberate primary divergence is not localized;
- contradiction Evidence or its affected comparison is missing;
- the reconstruction obligation ledger is not `ready`, has no required
  obligation, or retains an unowned/unverified required obligation;
- a denied or cancelled grant reports a process launch, a cancelled cleanup
  observation omits diagnostic Evidence, or owned resources remain;
- replay is nondeterministic, tampering/staleness is not detected, or the
  expected source digest differs.

Each finding names its stage, stable reason code, Evidence IDs, and detail.
Stage `capability_issue` and `next_action` fields map unsupported or failing
work to the responsible capability and remediation without claiming that the
requested analysis ran.

Closure history describes one fixed required-obligation universe from the
supplied final ledger. Its first entry establishes the starting open count and
cannot claim a new transition. Every observation marked `ready` must report
zero required obligations open. Observations marked `open` or `failed` must
report a positive required-open count. `unknown` may have zero open obligations
because limitations can prevent a ready verdict independently of that count.
Every decrease must name that many distinct, verified required obligations;
an obligation cannot count again within an entry or in a later observation.
No historical open count can exceed the ledger's required-obligation count.
The retained history is checked for consistency with that ledger, not
authenticated as a series of complete historical ledgers. Original entries
remain in the report snapshot when these checks fail.

For each operation and call kind, every retained success/error-code variant
must occur on both CLI and MCP. Repeated observations and their Evidence stay
in the report snapshot; drift findings cite the complete group and its sequence
numbers. Equal repeat counts and one-to-one run pairing are not claimed: the
input has no identity linking an individual CLI attempt to an MCP attempt.
Differing transport status is checked on each observation separately.

## Fixtures

The static-analysis journeys use source-owned, redistributable fixtures:

- `build/conformance/c`, built from `tests/conformance/c/fixture.c`, with stable
  symbols and strings;
- `tests/conformance/readiness/javascript-cli`, which exposes prompts,
  alternate-screen behavior, configuration precedence, child process,
  persistence, loopback HTTP, and signal teardown to static reconstruction;
- `tests/conformance/readiness/electron`, which exposes main, preload,
  renderer, utility, IPC, renderer restart, blocked shell effect, and deep-link
  surfaces to static analysis.

The separate `RECONSTRUCTION_READINESS_EXAMPLE` supplies synthetic incomplete
reconstruction, broken-runtime, authority, comparison, cleanup, and closure
observations. Its semantic tests preserve malformed-Evidence rejection,
fail-closed stage results, contradiction handling, repeated CLI/MCP outcomes,
and closure-history consistency. Run those source tests independently:

```sh
npm run test:local -- tests/conformance/readiness/report/reconstructionReadiness.test.ts
```

Passing evaluator tests does not establish real-provider or fixture runtime
behavior. Use the applicable [real-toolchain lanes](testing.md#real-toolchain-verification-lanes)
for those claims.

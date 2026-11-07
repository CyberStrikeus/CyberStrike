# Agent environment implementation index

This index covers all 26 PRs authored by
[earakely-scale](https://github.com/morluto/rea/pulls?q=is%3Apr+author%3Aearakely-scale)
in `morluto/rea`, checked on 2026-10-25 against main
`5d428390996498bc4dcca4da934641557f9109bc`. Twenty-five were merged; #5722
was closed without merging. The table describes the resulting work rather
than treating each original PR proposal as the current contract.

Start with the [quickstart](../../agent-environments-quickstart.md) for a
user workflow or the [reference](../../agent-environments.md) for current
contracts. [Design issue #4933](https://github.com/morluto/rea/issues/4933)
records the original four-part proposal. Its stateless replay description
predates state serving and confirmed writes.

## PR map

All entries are merged unless marked otherwise. Verification links point
to the corresponding slice's recorded checks, with their original versions,
platforms, failures, and limitations.

| PR                                                                   | Contribution                                                                                                                                                                                  | Verification                                                                                                                     |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [#4954](https://github.com/morluto/rea/pull/4954)                    | Project HAR Evidence into an environment manifest with inferred tool templates and explicit unknowns.                                                                                         | [Manifest view](manifest-view/verification.md)                                                                                   |
| [#4955](https://github.com/morluto/rea/pull/4955)                    | Add explicit streamable HTTP serving for REA MCP; stdio remains the default.                                                                                                                  | [HTTP transport](http-transport/verification.md)                                                                                 |
| [#4975](https://github.com/morluto/rea/pull/4975)                    | Serve retained exchanges as MCP tools, with the environment card and replay data-plane stub.                                                                                                  | [Environment serve](environment-serve/verification.md)                                                                           |
| [#4999](https://github.com/morluto/rea/pull/4999)                    | Export authenticated capture/manifest pairs as pinned AgentEnv bundles with a verifier and smoke task.                                                                                        | [Environment export](environment-export/verification.md)                                                                         |
| [#5182](https://github.com/morluto/rea/pull/5182)                    | Accept browser-scenario Evidence as a manifest, serve, and export input.                                                                                                                      | [Scenario capture](scenario-capture/verification.md)                                                                             |
| [#5293](https://github.com/morluto/rea/pull/5293)                    | Accept Evidence-file sources for richer captures and add opt-in sibling-pair path templating.                                                                                                 | [Rich captures](rich-captures/verification.md)                                                                                   |
| [#5319](https://github.com/morluto/rea/pull/5319)                    | Extract initial entities, documents, and checked read plans with the environment-state view.                                                                                                  | [State view](state-view/verification.md)                                                                                         |
| [#5351](https://github.com/morluto/rea/pull/5351)                    | Make state serving the default; add reset/load/get operations, replay fallback, and `--replay-only`.                                                                                          | [State serve](state-serve/verification.md)                                                                                       |
| [#5352](https://github.com/morluto/rea/pull/5352)                    | Back more read shapes with state and describe tool responses and annotations.                                                                                                                 | [State coverage](state-coverage/verification.md)                                                                                 |
| [#5600](https://github.com/morluto/rea/pull/5600)                    | Apply create, update, delete, and document effects only when later reads confirm them without contradiction.                                                                                  | [State writes](state-writes/verification.md)                                                                                     |
| [#5664](https://github.com/morluto/rea/pull/5664)                    | Share inferred path positions across tools with opt-in `prefix-variance`, connecting literal writes to templated reads.                                                                       | [Prefix variance](prefix-variance/verification.md)                                                                               |
| [#5699](https://github.com/morluto/rea/pull/5699)                    | Compare the environment offline against separately recorded probe sequences from the application.                                                                                             | [Fidelity compare](fidelity-compare/verification.md)                                                                             |
| [#5722 (closed, unmerged)](https://github.com/morluto/rea/pull/5722) | Proposed independently reset recording sessions. The author closed it after six applications showed no held-out agreement gain; identified model gaps took priority.                          | [Closure explanation](https://github.com/morluto/rea/pull/5722#issuecomment-6305512072)                                          |
| [#5787](https://github.com/morluto/rea/pull/5787)                    | Decide whole-list membership per request line so mixed filtered/unfiltered tools can show new entities.                                                                                       | [List lines](list-lines/verification.md)                                                                                         |
| [#5800](https://github.com/morluto/rea/pull/5800)                    | Learn supported list filters, substring search, sorting, paging, and counters from recordings.                                                                                                | [List queries](list-queries/verification.md)                                                                                     |
| [#6136](https://github.com/morluto/rea/pull/6136)                    | Explain copied or renamed values and regenerated scalar or nested UUIDs while withholding unsupported links.                                                                                  | [Assigned values](write-assigned-values/verification.md)                                                                         |
| [#6138](https://github.com/morluto/rea/pull/6138)                    | Preserve the clock spelling and precision each read view shows after a write.                                                                                                                 | [View clock spelling](view-clock-spelling/verification.md)                                                                       |
| [#6169](https://github.com/morluto/rea/pull/6169)                    | Handle bodiless write replies, proven omitted fields, projected reads, and digit-group sequences.                                                                                             | [Write coverage](write-coverage/verification.md)                                                                                 |
| [#6385](https://github.com/morluto/rea/pull/6385)                    | Find more state targets, distinguish read-only POSTs, and handle variant views and differing create/read paths.                                                                               | [State targets](state-targets/verification.md)                                                                                   |
| [#6897](https://github.com/morluto/rea/pull/6897)                    | Extend evidence-gated rules for bulk writes, item actions, generated values, query constraints, and ordering.                                                                                 | [Write rules](write-rules/verification.md)                                                                                       |
| [#6929](https://github.com/morluto/rea/pull/6929)                    | Bound create learning and invalidate stale write proofs. The original branch also developed the one-step builder and coverage report, integrated through stacked #6946 before this PR merged. | [Build workflow and verification](environment-build/verification.md), [final PR scope](https://github.com/morluto/rea/pull/6929) |
| [#6946](https://github.com/morluto/rea/pull/6946)                    | Complete the agent workflow with same-origin scenario request actions, `export_environment_bundle`, and recording instructions; integrate `environment-build` and coverage from its stack.    | [Environment from a prompt](environment-prompt/verification.md)                                                                  |
| [#6967](https://github.com/morluto/rea/pull/6967)                    | Retain browser request timing so scenario-derived environments can learn write clocks.                                                                                                        | [Scenario timing](scenario-timing/verification.md)                                                                               |
| [#7025](https://github.com/morluto/rea/pull/7025)                    | Explain composed response strings, trimmed fractional clocks, and generated integer identities.                                                                                               | [Derived values](write-derived-values/verification.md)                                                                           |
| [#7034](https://github.com/morluto/rea/pull/7034)                    | Learn compatible create variations across calls, sorted echoes, referenced entities, and nested view projections.                                                                             | [Create calls](write-create-calls/verification.md)                                                                               |
| [#7080](https://github.com/morluto/rea/pull/7080)                    | Reconcile lighter create responses with read-backs and learn re-derived slugs and clocks in whole-object updates.                                                                             | [Write views](write-views/verification.md)                                                                                       |

Multi-session capture fusion from #5722 is not a shipped capability. Repeated
calls inside one supported capture, as learned by #7034, are a separate feature.

## Evidence to use when describing the feature

The contributor's [example repository](https://github.com/earakely-scale/rea-environments)
contains the original capture/export/evaluation pipeline and links to published
bundles. Its Grafana row records 105 exchanges and 48 manifest tools, matching
the capture count in the demo. The README describes an earlier replay workflow;
its counts and model scores should remain attributed to that snapshot.

The [prompt workflow verification](environment-prompt/verification.md) records
five applications built by an agent from individual prompts: every exported
bundle passed smoke, while three of the five served writes. Later
[timing](scenario-timing/verification.md),
[derived-value](write-derived-values/verification.md), and
[create-call](write-create-calls/verification.md) work addresses specific gaps
found in those recordings. The earlier write counts are not current limits.

The [write-view verification](write-views/verification.md) records a later
held-out round where 10 of 20 targeted write tools were served, up from 8.
Its original census retained 132 served writes across 69 existing captures.
These are source-reported measurements at the recorded revisions. The
[merged PR's review follow-up](https://github.com/morluto/rea/pull/7080)
explicitly says its real-application census and agent tasks were not rerun
after the final fixes; the local CLI/MCP regressions cover those fixes.

Smoke checks demonstrate bundle/framework compatibility for the tested
configuration. Retrieval rewards demonstrate particular task outcomes.
`environment-compare` measures agreement on recorded probes, with explicit
normalizations and omissions. Keep these claims separate, and retain the
version and coverage limits when quoting any result. This index is a source
and PR review; it does not constitute a new real-application or benchmark run.

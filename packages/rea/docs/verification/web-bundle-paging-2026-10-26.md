# Retained web-bundle paging verification

Issue [#6198](https://github.com/morluto/rea/issues/6198). Runtime source
`a92e07f484e444755c2ee33f355351a28d79f430`, based on main
`8423c5c6d08512568c2a75753b6b7c3a9b6bbd4e`. The original implementation is
HarsH's [#7213](https://github.com/morluto/rea/pull/7213), head
`6b1d5d42c6d6b4dba19295b8e9520cbeb55fc39e`. Subsequent commits update the
verifier, tests and this record; they do not change that runtime implementation.

## Executed correctness scope

The public CLI and actual stdio SDK read authentic completed browser Evidence.
Every returned row is compared with the unchanged producer's complete parent,
including original source index, ordering, values, locations, inference kind,
confidence and basis. This validates projection; it does not independently prove
that every producer inference is correct or that an endpoint is reachable.

Inputs were unmodified Miniflux JavaScript assets at commit
[`d5c529b94ce9a172bd4c22a2b89da068c583783b`](https://github.com/miniflux/v2/tree/d5c529b94ce9a172bd4c22a2b89da068c583783b/internal/ui/static/js),
loaded by installed Chromium through an owned loopback static harness. Four
scripts total 60,395 bytes: `app.js`, `keyboard_handler.js`, `touch_handler.js`,
and `webauthn_handler.js`. The complete parent has five low-confidence endpoint
candidates, zero endpoint observations, and all 6,245 visited AST nodes examined.
The harness initially loaded `app.js` before `KeyboardHandler` and recorded a
page error; all four unmodified scripts were still captured and statically
parsed. This verifies shipped asset analysis, not a running Miniflux backend or
complete application behavior. Nonempty endpoint observations are covered by
the SDK boundary fixture, not claimed as real Miniflux findings.

The CLI's initial selected analysis returned one inference and exported the
complete parent. Retained SDK paging reproduced all five full inference rows;
subsequent CLI Evidence-file queries reproduced the same shared projection.
The parent used for the equivalent query measurements is
`ev_2c4b96d1fbf9e0c4ec2baf23815adc2599448b459dffb7cc1cb9cf8a75526339`.

Published `swagger-ui-dist@5.30.2` was also loaded locally from its npm tarball.
Its standalone preset (one captured script, 73,471 visited AST nodes) produced
one inference and an explicit `javascript_ast` widening unknown. SDK pages
preserved the exact unknown's reason and affected script keys, and retained
producer partial status even when the selected page was exhausted. The larger
1.5 MB main bundle exceeded its unchanged 60-second script analysis deadline;
its partial result had no findings. It is a limitation case, not a successful
large-inventory benchmark. No successful large real endpoint inventory or
whole-application backend verification is claimed.

The boundary suites cover duplicate endpoint values at different locations,
field selection, intersecting/empty selectors, retained/inline/file sources,
wrong operations, malformed reports, original indices, continuation, producer
partial status and a record larger than the 1 MiB projection budget. Actual SDK
converted output schemas are validated. Source regressions additionally cover
historical omitted versus explicit-null origins, the full parent/report
limitation union before display bounding, and distinct script-scoped unknowns.
These three corrections fail against the imported upstream production code;
explicit-null and explicit-origin controls continue to pass.

Automated review follow-up added an interleaved, intersecting-filter continuation
case: the second matching offset is `2`, while the joined original indices are
`2, 4, 5`. All 24 projection tests and both SDK boundary tests pass. Test temporary
directories now have the existing fixture as their sole cleanup owner. Both real
CLI launches in the verifier use `createVerifierCommands` and awaited shared
cleanup; real selected capture and both CLI collection readbacks pass after that
change. Command supervision is acquired lazily only for capture or explicit CLI
verification, outside the measured retained-query workflows above.

## Equivalent completed query costs

Both versions import the same already completed parent, discover the same 41
`application,session` tools, and use compact input schemas. No browser or static
analyzer runs during these queries. The existing full-bundle query answers
both questions: (A) all observed endpoint/inference facts and counts, or (B)
the first endpoint candidate, its original provenance, candidate count and source
coverage. The new all-facts workflow uses a summary and both collections; the
selected B workflow needs just one filtered inference page.

| Workflow                  | Cold query ms, including import | Warm query ms | Combined process elapsed s | Combined CPU s | Sampled family peak MiB |
| ------------------------- | ------------------------------: | ------------: | -------------------------: | -------------: | ----------------------: |
| Main, complete bundle     |                           227.1 |          40.5 |                      4.125 |          3.940 |                   451.3 |
| New, all-facts paging     |                         4,978.5 |          58.8 |                      9.562 |          9.274 |                   876.2 |
| New, first candidate only |                         4,559.1 |          14.6 |                      8.498 |         10.179 |                   878.0 |

Cold SDK output-schema compilation is materially more expensive for the existing
large `inspect_analysis_view` result union than for a full-bundle read. These
single runs do not establish a general latency or memory improvement. Warm
selected reads reuse the session's validated immutable parent; no new cache or
live-state freshness claim is introduced. Unfiltered projection builds only the
requested page; filtered projection counts all matches while allocating only
selected rows. CPU and memory above cover discovery, import, cold and warm runs
and cleanup together; per-temperature CPU/peak memory was not separately measured.

| Workflow                  | Input-schema catalog estimate | Model projection estimate | Complete SDK payload estimate |
| ------------------------- | ----------------------------: | ------------------------: | ----------------------------: |
| Main, complete bundle     |                        13,828 |                    20,083 |                       268,729 |
| New, all-facts paging     |                        13,861 |                    21,459 |                       272,691 |
| New, first candidate only |                        13,861 |                    16,248 |                       262,752 |

All token figures are `cl100k_base` BPE estimates, **not actual model usage or
billing**. Model projection counts input tool definitions, every tool argument
and returned text-content block across cold and warm tasks. The complete SDK
payload estimate also counts output schemas and structured results, which may
not be placed in model context by an actual client; it excludes JSON-RPC framing.
Discovery is counted once. No real model investigation was executed. Selection
reduces estimated model input about 19% for question B; paging every row of this
small report increases it about 7%. Complete delivery remains useful for small
reports or questions requiring most fields. Failed harness attempts and separate
CLI/provider verification runs are excluded from this equivalent-task table.

The host guard restricted the whole owned process family to two CPUs and stopped
at 8 GiB summed RSS, 4 GiB host available memory, or a command-specific deadline.
RSS was sampled every 100 ms, can double-count shared pages and can miss brief
peaks. The main Swagger timeout capture took 66.99 s elapsed, 78.39 CPU s and
1,982.8 MiB peak family RSS; the Miniflux capture took 5.87 s, 5.38 CPU s and
1,364.4 MiB. No guard stop or OOM occurred in those executed cases.

## Reproduction

Use the pinned Node/npm toolchain, `npm ci`, `npm run build:cached`, an existing
Chromium executable, and an owned directory containing original asset bytes plus
a local `index.html`. The verifier starts only an owned loopback server and
browser; it does not install dependencies or contact an application backend.
The original source files and their SHA-256 digests should be retained with the
capture. For example:

```bash
node experiments/analysis-efficiency/web-bundle-paging.mjs \
  --repository "$REA_CHECKOUT" --mode capture --application "$ASSET_DIRECTORY" \
  --browser /usr/bin/chromium --output "$NEW_CAPTURE_DIRECTORY"
node experiments/analysis-efficiency/web-bundle-paging.mjs \
  --repository "$MAIN_CHECKOUT" --mode complete --parent "$PARENT_JSON" \
  --output "$NEW_BASELINE_DIRECTORY"
node experiments/analysis-efficiency/web-bundle-paging.mjs \
  --repository "$REA_CHECKOUT" --mode selected --task first-candidate \
  --parent "$PARENT_JSON" --output "$NEW_SELECTED_DIRECTORY"
```

Omit `--task first-candidate` to compare all rows. `--verify-cli` additionally
checks both collections through the real CLI; exclude that extra verification
from performance comparisons. Every output directory must be new. Keep resource
receipts and separate failed attempts; do not overwrite them with reruns.

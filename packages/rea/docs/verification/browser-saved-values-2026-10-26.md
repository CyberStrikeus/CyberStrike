# Browser saved values: integration verification

## Pinned scope

Executed on Linux x64, Node 24.22.1 and Chromium through `/usr/bin/chromium`.
The primary comparison uses **Playwright 1.64.1 and the same integration tree
for both workflows**. Local verification commit `dd343d3b1092d697772f1447d94179d23bcc5cf2`
contains GitHub merge `1a3ef66c8e25f25fdd06053bb33255f10f65c5b6`
(main `030fa886f94e894e34ed2539e9d8dedff19c3327` plus PR head
`ed110935f520d56f6eaf5710ad2f9a58340492b4`), followed by response-scope fix
`2c5f9cc14b3395ef4a99071222e3feaf9501bb62`. The local verification commit is
not a published release. Recreate its tree from the public main/PR inputs,
then apply that fix. Final reconciliation adds `0d89c65409d28fec269cfdbb3ee62e0f153819fa`
(local current-dependency tree `221ba53af`) for query spelling and refused-slug
source constraints; the primary timing pair predates these two corrections.

Historical comparisons against pre-feature main
`6d5532a204b338a6c770fcbae61e0d55bda70793` used Playwright 1.58.2 and remain
below. They do not isolate the dependency upgrade. The implementation integrates
Edgar Arakelyan's #7162; upstream `d39f386d202fe8e98592fb2d9d26e43d8d0fb94f`
and subsequent fixes through `9f5191ab0` were compared. Its query redaction and refused-slug source
pinning were incorporated. Existing heap-derived URL/JSON/envelope admission
remains the owner of expansion bounds, rather than adding the upstream fixed
fill ceiling. Original multi-app/model
results are [attributed historical evidence](../specs/agent-environments/scenario-saved-values/verification.md),
not executions performed here.

## Real application and correctness oracles

PocketBase **0.40.6** runs on an owned loopback instance. Its official Linux amd64
archive is 12,824,710 bytes, SHA-256
`0e1f609158ed945f809f8a02ae012aa0427129c66ebb63c1aee76f2c0309373f`.
The [owned frontend](https://github.com/morluto/rea/blob/938052704/experiments/analysis-efficiency/fixtures/browser-saved-values/index.html)
uses actual superuser authentication and record APIs. It is a small test
frontend rather than PocketBase's entire administrative application.
Collection `rea_items` has required text `title` and numeric `quantity`, public
list/view, and superuser-only create/update/delete rules.

The completed task signs in, creates a record, reuses its generated ID and
numeric quantity, PATCHes it, GETs it with a query, and navigates to its API URL.
Independent PocketBase GETs verify identity, final title and numeric quantity;
retained request bytes verify a JSON number. Every declared action must finish.
The selected login response must actually occur once; no missing response can
pass the redaction oracle.

- Current integration public CLI: all **eight steps** completed, eight retained
  JSON bodies, zero plaintext marked token or declared password. **4.351 s elapsed**,
  **4.832 s CPU**, **1,381,789,696 B** sampled process-family peak.
- Current integration MCP: two equivalent tasks completed in both legacy and
  saved-value modes. Legacy uses a retained event page and another capture;
  saved bindings finish the same analyst task in one capture.
- Both current legacy runs actually observed the login body before the later
  page-value read. That earlier unmarked token remained present, while later
  observations used redaction. The mixed-scope unit cases additionally establish
  that an unrelated page/Basic value remains prospective when response secrets
  are also learned.
- A real negative control on the imported implementation retained the marked
  authentication token despite completing its actions. The integrated source
  response and retained-event checks reject that outcome.

## Privacy, provenance and resource boundaries

The public MCP source probe verifies:

1. Source and later JSON bodies with escaped strings and `1e3` become valid
   redacted JSON while preserving unmarked `1e-400` and whitespace exactly.
2. Metadata-only capture redacts the selected source URL without retaining
   network-content records. Unknown source values withhold the affected source
   fields and expose a limitation.
3. A declared whole JSON string seeded into storage and POSTed to PocketBase is
   withheld if a safe whole-body replacement cannot preserve JSON. HTTP **403**
   and an unchanged integer record count independently confirm the outcome.
4. The frontend consumes the selected response, logs and visibly renders its
   token, and immediately POSTs it in a URL/header/body. Retained console and
   network data are protected. All three requested screenshots are `missing`,
   with screenshot completeness ineligible for equality.
5. A separate nonsecret scenario captures a real PNG and validates its signature.

This expanded probe passed in **8.417 s elapsed**, **9.567 s CPU**,
**1,680,818,176 B** sampled family peak. A focused public CLI run of the shared
CI browser fixture also passed: three withheld sensitive screenshots, all other
selected artifacts captured, and explicit screenshot/network-cutoff gaps.
It took **5.956 s elapsed**, **6.868 s CPU**, **1,495,924,736 B** family peak;
that fixture server is inside the measured family.

The source parser owns strict UTF-8, exact selected numbers, pointer lookup and
source-token redaction. UI whole-body saving requires a positive known
identity-encoded size before reading; compressed/cache-unknown responses are
refused. The original author's fallback is not enabled. Two initial cached UI
probes were correctly refused; the owned fixture uses `cache: "no-store"` for
the known-size case.

Response-marked values can backfill retained source/follow-up event text.
Page-derived cookie/storage values and constructed Basic credentials retain
their existing prospective-only policy. A session-local response projection
borrows admitted compiled patterns/byte owners and is invalidated on admissions
or response classification. Promoting an already held value to an explicit
response secret preserves its first marker. Replacement work and retained output
are admitted before allocation; omissions and cleanup retry are accounted once.

UI matching is observational. Multiple observed matches fail without adopting
an ambiguous binding; a single observed match cannot prove UI causality or
exclude a later poll. Returned Playwright body bytes also do not establish
original-wire provenance. These limitations remain in the contract/Evidence.

Request JSON, saved URLs and the full request envelope are admitted before
expansion/dispatch using Node's string ceiling and a conservative V8-headroom
allowance. Repeated saved/header facts share request-local size/validation work.
Four cases reject 1,000 references to a 3,000,000-character value without dispatch;
those inputs were deliberately not run on unbounded code. The first repeated
header guard took 4.042 s in its source test; the final case no longer appears
in slow-test output (its final individual duration was not separately measured).

Raw pixels are not text-redactable. The secret owner establishes screenshot
withholding before execution for planned sensitive response/page/Basic values,
and whenever sensitive values are already known. The artifact producer then
returns `missing` without requesting pixels. No separate image-cleanup state or
publication hook remains.

## Completed-task measurements

Both columns use the current integration tree, provider and catalog. Each run
creates a fresh MCP server/browser context and completes a first and subsequent
task. The browser has already loaded the fixture; “first” is not a cold browser
or OS cache. One run per condition is an observation, not a general speed claim.

| Measurement                            |          Legacy workflow |             Saved values |
| -------------------------------------- | -----------------------: | -----------------------: |
| Task calls, each task                  |                        3 |                        1 |
| First task elapsed                     |                  6.191 s |                  1.879 s |
| Warm task elapsed                      |                  1.120 s |                  0.872 s |
| Whole verifier elapsed                 |                 13.413 s |                  8.092 s |
| Whole verifier CPU                     |                 15.347 s |                  9.387 s |
| Sampled family peak RSS                |          2,018,435,072 B |          1,689,305,088 B |
| Input catalog + arguments/text replies |  34,885 estimated tokens |  25,881 estimated tokens |
| Full SDK catalog + arguments/results   | 370,936 estimated tokens | 353,768 estimated tokens |

`o200k_base` BPE estimates serialize compact JSON and are not model billing.
The model projection counts all **53** tool names/descriptions/input schemas
(**18,579 tokens** in both columns), followed by the complete array of named
arguments and text-content results. The full SDK estimate counts the complete
catalog plus the array of full results, including output schemas and structured
results. Arrays are tokenized jointly rather than summing independently tokenized
cells. Both estimates include two extra correctness-proof exports: eight total
calls before and four after. No model ran; reasoning, retries, JSON-RPC framing
and initialization traffic are unmeasured.

Whole-verifier cost includes discovery, browser setup, proof/oracle work and
cleanup, distinct from timed task calls. PocketBase runs externally: its CPU
and memory are **unmeasured**. REA/Chromium families use two CPUs, a 3 GiB Node
heap and an 8 GiB family RSS guard. RSS is summed every 100 ms, may double-count
shared pages and miss short peaks. No guard stopped the completed runs.

Historical pre-feature comparisons (Playwright 1.58.2) remain observations:

| Candidate   | First task before→after s | Warm before→after s | Whole elapsed before→after s | CPU before→after s | Peak GB before→after |
| ----------- | ------------------------: | ------------------: | ---------------------------: | -----------------: | -------------------: |
| `355e2dcb8` |               7.703→3.531 |         1.390→1.605 |                14.990→17.198 |      15.735→15.679 |          2.080→1.636 |
| `dd3085bf5` |               5.145→1.621 |         1.020→0.762 |                 11.723→7.653 |       13.444→8.683 |          2.028→1.638 |
| `439a389fe` |              16.121→4.429 |         2.944→1.738 |                34.296→20.053 |      32.166→19.053 |          1.996→1.646 |
| `e7acc5d85` |              10.778→2.627 |         1.467→1.129 |                22.310→12.661 |      26.148→14.759 |          2.103→1.632 |
| `43aaaabbe` |               7.751→3.220 |         1.210→0.996 |                15.527→11.301 |      18.047→12.777 |          2.064→1.628 |
| `854b7a2c0` |               6.965→1.923 |         1.100→0.874 |                 15.657→9.213 |      17.222→10.753 |          2.053→1.650 |
| `938052704` |               5.983→1.720 |         1.040→0.787 |                 13.103→8.146 |       15.194→9.497 |          2.033→1.635 |

The first candidate was slower for warm/whole elapsed. Later differences also
reflect host/cache variance. Historical model estimates include 34,899→25,897
at `355e2dcb8`, 34,831→25,902 at `e7acc5d85`, 34,816→25,866 at `43aaaabbe`,
34,742→25,845 at `854b7a2c0`, and 34,820→25,897 at `938052704`. These are not
summed as independent model usage.

## Executed checks and negative controls

- Final feature branch: **560 tests in 12 source suites**, type/lint and build passed.
- Current integration/Playwright 1.64.1: **561 tests in the same 12 suites**,
  build and `check:fast` passed; the additional test comes from main.
- Twenty explicit schema/profile tests passed earlier; all 41 distinct cases in
  the broader five-suite run passed across its run and isolated rerun. One case
  timed out at 30 s under two-CPU contention, then passed alone in 17.36 s.
  An older-Node attempt failed before tests. Final real SDK calls also validate
  the named tool definitions and advertised results.
- Negative controls fail before their fixes: decoded bounds/accounting/numeric/
  slug cases; seven source-format/UI ambiguity cases; three source-publication
  cases; two whole-JSON cases; two backslash substitutions plus immediate
  follow-up; five final event/path cases; and ten screenshot cases. The
  screenshot nonsecret control passes on the old revision.
- Final reconciliation re-ran the eight-step real CLI task and all four privacy
  probes plus the positive PNG case on `221ba53af` successfully. A further
  two-step public CLI case verifies the parsed query spelling of `ab'cd~ef`
  is redacted. Together these checks used 16.550 s elapsed, 18.581 s CPU and
  1,675,153,408 B sampled family peak; this is qualification, not a new timing pair.
- The final upstream query/slug regressions fail three cases on `34dc2c1c4`.
  The query spelling lower-bound calculation also includes the new encoding
  before allocating it.
- Three prospective-page/Basic regressions fail on `ed110935f`; final tests also
  cover promotion, scope-cache invalidation and preservation of the first marker.
- The prior CI's own event-budget assertion was fixed with JSON admission order
  and the whole-body guard. It was not bypassed. Two invalid newly added header
  fixtures were corrected to canonical shapes before the final source run.
- A focused CI-fixture harness initially closed its server too early. Cleanup
  order was corrected and the real CLI rerun passed. Failed receipts remain.

Initial CI/main controls reproduced a load-sensitive prewarm failure and two
SAZ partial-observation assertions on their exact parents. The prewarm case
passes alone on later main and is not claimed as a stable current failure.
Subsequent CI failures comprise those two SAZ assertions and Java diagnostic
`keeps empty Java bitness unresolved`; all three independently reproduce on
actual CI main parent `c6893d1ac6a9ccb8a11d64b4e9ba1b57e79cbfd8` with its isolated
1.64.1 locked dependencies. The first preparation refused stale shared 1.58.2
dependencies before any tests; the shared installation was preserved.
On head `34dc2c1c4`, all 18 distinct CI failures (artifact/inventory, snapshot,
cleanup, Apple-resource coverage and the two SAZ assertions) reproduce on exact
CI main parent `29ebd6740550bf3989129c39c65f17e5c61e3dd2`. The additional
control run also timed out two retained-ZIP cases and emitted two connection
closures; these were control-only incomplete results, not passing checks.
All fifteen actionable review threads were fixed and resolved. A further
final-head Codex review request was refused by the repository usage limit; no
fresh successful automated review is claimed.
Cancelled lanes remain incomplete, including cancelled shards that emitted
passing summaries. CI counts from overlapping revisions are not added together.

## Reproducing and limitations

Use an isolated worktree with the pinned Node/npm toolchain. For the primary
comparison, recreate the public main/PR integration inputs above, apply the
response-scope fix, install its lockfile, build once, and use **that same checkout**
as `--repository` for both modes below. Historical pre-feature measurements used
separate pinned checkouts.

On an owned loopback PocketBase instance, create the collection/rules described
above and a temporary superuser. Serve the committed `index.html`,
`whole-json.html` and `immediate-followup.html` from
`experiments/analysis-efficiency/fixtures/browser-saved-values/`. Store only
`{"email":"...","password":"..."}` in a private credentials file, mode 0600;
keep it and full retained Evidence out of Git.

Serve `escaped-values.json` with these exact minified bytes (unmarked spelling
is part of the oracle):

```text
{"token":"\u0073ource-token","code":1e3,"unknown":1e-400}
```

Run the committed driver with fresh private output directories:

```bash
node experiments/analysis-efficiency/browser-saved-values.mjs \
  --repository /path/to/integration --mode before --output /private/before \
  --origin http://127.0.0.1:18762 --credentials /private/credentials.json \
  --browser /usr/bin/chromium
node experiments/analysis-efficiency/browser-saved-values.mjs \
  --repository /path/to/integration --mode after --output /private/after \
  --origin http://127.0.0.1:18762 --credentials /private/credentials.json \
  --browser /usr/bin/chromium
node experiments/analysis-efficiency/browser-saved-values.mjs \
  --repository /path/to/integration --mode after --source-only \
  --output /private/privacy --origin http://127.0.0.1:18762 \
  --credentials /private/credentials.json --browser /usr/bin/chromium
```

Run these under a process-family CPU/RSS supervisor for comparable resource
measurements. The driver owns its MCP client and browser/profile cleanup, checks
payload outcomes, records arguments/results/catalog, and exports retained parent
Evidence. Current legacy runs observed pre-read login bodies in both tasks; if
that ordering is not observed, the receipt says so rather than inventing timing.

Real-provider scope is Linux Chromium and the owned PocketBase/frontend plus
shared CI fixture. Compressed/cache-unknown UI saving is unsupported. Other
platforms, real Basic-auth servers, service-worker integrations and historical
multi-app/model evaluations were not rerun here. No model task success or actual
model-token billing is claimed.

# Local constant BrowserWindow options — Joplin verification

This record covers #4366, part of #3536 and #4027. The unchanged official Joplin desktop 3.7.21 ASAR contains `const windowOptions = {...}` at `ElectronAppWrapper.js:238–263`, an unrelated conditional `icon` assignment, and `new BrowserWindow(windowOptions)` at line 268. The scoped public workflow analyzes that source plus `package.json`, then reads the window through `inspect_analysis_view`. It does not execute Joplin.

The baseline returns one dynamic window with zero explicit preferences. The candidate retains four literal booleans (`nodeIntegration: true`, `contextIsolation: false`, `spellcheck: true`, `enableRemoteModule: true`) and the explicit dynamic `session` expression. The original window identity and constructor location are preserved. Constant association is inferred, with the original object's source range; omitted preferences do not acquire Electron defaults. Popup overrides and literal spreads remain separate work under #3536.

The [compact measurements](javascript-window-options-2026-10-16.json) retain both trial orders, exact inputs, runtime/harness/source fingerprints, original result rows, CLI/MCP Evidence parity and observer receipts. ASAR SHA256 is `767df409b18effe60421fbefcca873de237c7e813eac744ecdeebbc5e825a33a`; the 39,972-byte source is `dcd2260e46dd1b4922449090e268773b052d58ba24ff977b08b978bee6cc9da1`. Download/recreation provenance is in the [earlier Joplin record](javascript-retained-facts-2026-10-15.md). Downloadable applications and complete exports are not committed.

## Correctness

Both trial pairs match the independent export-and-filter oracle and exact complete CLI/MCP view Evidence. The pinned [Joplin checker](https://github.com/morluto/rea/blob/42e1a17d6e6c0487f17be0bae248553c4caba7f7/experiments/analysis-efficiency/joplin-window-options-check.py) verifies exact settings, explicit unknowns, source ranges and stable window identity. Manual negative controls reject a wrong boolean, numeric0 substituted for false, a changed identity and observed instead of inferred provenance.

A raw semantic graph digest changes because the semantic graph commits its parent `application_graph_id`. The final record separately checks complete semantic content after excluding exactly that foreign key and its dependent top-level `graph_id`; original raw digests remain recorded and linked to the independent complete CLI observations. These exclusions follow the canonical semantic graph schema and builder, rather than filtering differing nodes or relations.

## Costs and limitations

| Trial order             | Variant   | First answer (s) | CPU (s) | Peak cgroup bytes at answer | Projected task BPE |
| ----------------------- | --------- | ---------------: | ------: | --------------------------: | -----------------: |
| Baseline then candidate | Baseline  |           70.283 |  69.258 |                  1578196992 |              13337 |
| Baseline then candidate | Candidate |           42.701 |  42.437 |                  1523793920 |              13432 |
| Candidate then baseline | Candidate |           44.793 |  44.766 |                  1527357440 |              13432 |
| Candidate then baseline | Baseline  |           42.958 |  42.946 |                  1533308928 |              13337 |

The baseline tool workflow cannot supply these settings; additional manual source-reading costs are unmeasured. This is a correctness gain with +95 projected structured-task tokens (+203 when counting complete tool replies). Both use the same 8,069-token selected catalog. The first apparent latency gain does not repeat: the reversed pair makes the candidate about 1.8 s slower. These samples establish no speedup or general performance result. First view retrievals are 106–121 ms; subsequent within-session reads are 22–35 ms. No persistent analysis cache was added.

All costly jobs run serially with one CPU 10, an 8 GiB hard limit, 6 GiB early stop, no swap and 192 tasks, pinned Node 24.18.0/npm 11.16.0. Cgroup memory includes file cache and is not RSS. At-answer counters precede repeated reads, diagnostic export, full-graph hashing, CLI parity and tokenization. Whole-verifier observer receipts measure that extra work separately. The observer reported no OOM and verified payload cleanup in each scoped run.

Each task starts a fresh MCP process; the input hash warms file cache, and build/OS caches are uncontrolled. Three retrieval samples are not three cold analyses. `cl100k_base`/tiktoken 0.12.0 projections include preparation, first answer and selected input schemas; output schemas, actual billing, reasoning, peak agent context, host rendering and system-cold behavior were not measured. No live-model or Electron runtime claim is made.

## Validation and reproducibility

The integrated focused invocation passed 156/157 cases across 9 files. An unchanged upstream generator CLI/MCP case exceeded its original 30 s deadline in grouped execution; isolated runs at that same deadline passed on both main and candidate (18.590/18.034 s). The grouped failure is preserved; its root cause is not established and its deadline was not changed. Own CLI/MCP/fact-view, source mutation/escape/identity and capacity regressions passed. Static/document checks are recorded in the JSON validation receipts.

An initial real-app verifier attempt failed because its coverage assertion handled only artifact paths. The independent selector and tool already supported source-range paths. The verifier assertion was corrected before both valid pairs; that failed attempt is excluded from performance samples. The source oracle's initially transcribed closing line 264 was corrected to 263 after rereading the unchanged source. Neither correction changes production analysis.

After building the pinned baseline and candidate in separate checkouts, run this same command serially in baseline→candidate and candidate→baseline order, using the matching harness hash recorded for each pair:

```sh
query='{"kind":"javascript-facts","where":{"paths":["ElectronAppWrapper.js"],"kinds":["browser-window"]},"property_keys":["options_status","web_preferences_status","web_preferences","preload_path","resolution_sources"],"offset":0,"limit":64}'
node scripts/verify/javascript/retained-facts.mjs \
  --artifact /absolute/path/to/app.asar --mode view --query "$query" \
  --source-path ElectronAppWrapper.js --source-path package.json \
  --rounds 3 --cli-parity --tokenizer-python /absolute/python-with-tiktoken-0.12.0
python3 experiments/analysis-efficiency/joplin-window-options-check.py \
  docs/verification/javascript-window-options-2026-10-16.json
```

Apply the linked resource observer from the earlier Joplin record to each costly command. Complete CLI observations use the same source selection through `analyze-javascript-application --format json`. The preserved [content comparator](https://github.com/morluto/rea/blob/42e1a17d6e6c0487f17be0bae248553c4caba7f7/experiments/analysis-efficiency/compare-javascript-semantic-content.mjs) takes the baseline CLI JSON, candidate CLI JSON and this measurement record, then emits the semantic proof while retaining both original graph identifiers and raw digests. It reads sequentially and reports a concise failure rather than printing full graphs. The baseline backend is unchanged main `2c7583599b9ac1c847bd77b1940930fd8d4594c7`; only the matching verification harness is applied there. Source and runtime pins distinguish measurement versions from later documentation changes.

## Ordering review follow-up

Codex review identified an introduced producer-ordering regression: inline windows were appended during traversal while deferred constants were appended afterward. The new mixed constant/inline/unresolved regression reproduced `[4, 3, 5, 6]` instead of source order `[3, 4, 5, 6]`. The producing collection now restores order from retained source offsets before module attribution and public graph consumers; no downstream adapter repair was added. A reused options object remains dynamic after it escapes to the first constructor.

After the fix, all 49 targeted cases across five files passed, including the public CLI/MCP/fact-view workflow and capacity/identity cases. One additional real Joplin run at source revision `3fd71cba2` returned exactly the same complete answer and semantic fingerprint as the original candidate, with complete CLI/MCP view Evidence parity. It took 44.028 s at answer / 43.960 CPU s / 1,524,555,776 peak cgroup bytes, with the same 13,432 projected task tokens. This is a follow-up validation, not an additional paired latency comparison. The JSON stores its runtime and current source pins separately; the original trial receipts and historical source pins remain unchanged.

## Shared query performance review follow-up

The stored-alias example raised in review already returns unknown on the reviewed production code: the exact negative source case passes, and the public CLI returns one dynamic window with zero explicit preferences. The shared `reference-store` producer records the assignment escape before construction. No mutation rule was changed; the negative regression is retained.

The repeated-effects cost was reproducible. Candidate discovery needed only lexical identity but collected full mutation reports; each later capture also materialized every effect before checking for a prior escape. The shared index now offers lexical-only lookup and an early-exit predicate. Windows and request analysis use those operations. The same owner still supplies complete effects to the require-source consumer, which needs filtered effect kinds; no second interpretation or persistent cache was added.

The [preserved scaling control](https://github.com/morluto/rea/blob/42e1a17d6e6c0487f17be0bae248553c4caba7f7/experiments/analysis-efficiency/window-option-scaling.mjs) measures real production source analysis on synthetic capacity inputs; it is not a real-application or agent task. All samples and module hashes are retained. CPU medians across three sequential samples were:

| Shared-options constructors | Before (CPU s) | After (CPU s) |
| --------------------------- | -------------: | ------------: |
| 256                         |        0.29703 |       0.17821 |
| 512                         |        0.96105 |       0.08709 |
| 1024                        |        4.41298 |       0.20032 |

The first 256 sample is the first algorithm execution in each process; later rounds and larger sizes can use warmed V8 code. These medians mix that progression and do not establish cold-task scaling across applications. A deterministic regression separately bounds escaped-effect reads for 128 captures to at most 4N while requiring unindexed unknowns, a valid first capture and unknown reused contents. Timing is not a test gate. Reproduce the capacity control, after building each pinned checkout, with `node experiments/analysis-efficiency/window-option-scaling.mjs LABEL 256,512,1024` under the same resource observer.

After this refactor, 107 cases across 10 focused files passed, including request CLI/MCP, require-source, worker-schema, identity, capacity and retained-fact workflows. A new real Joplin run at `9207ece2090208c272d2689c4002438ceda41145` preserves the exact whole answer and semantic fingerprint, including CLI/MCP parity and the same 13,432 projected task tokens. It measured 44.607s / 43.883 CPU s / 1,666,560,000 peak cgroup bytes. Thus the capacity improvement is clear for the tested pattern, while no general real-app speedup is claimed. The new stage stores current source/runtime pins and validation separately; all previous receipts remain unchanged.

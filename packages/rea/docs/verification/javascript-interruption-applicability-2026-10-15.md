# Interrupted application processing: applicability and Evidence

Tracks #3948 under #4027. Measured baseline:
`c7f6b8bad1a34d5efb30ff2a017672dea1fcdabb`.

The question is which processing phases remain unavailable after a source
interruption, while keeping native inventory and already collected facts.
Native identity and provider linkage must stay independent of application-wide
partial coverage. This is static artifact analysis; no target application or
native provider runs.

## Observed failure and correction

The interruption producer previously attached one generic failure to every
remaining relevant file. Graph projection interpreted it as JavaScript AST work.
Real Joplin reproduced an `analyze-javascript-source` / `ast-static-analysis`
unavailable scope on keytar's native binary and on unvisited package, HTML and
source-map files. Public CLI/MCP controls reproduced the same applicability
problem. Deterministic cancellation before native metadata additionally produced
a phantom JavaScript semantic module for the binary.

The producer now records the applicable operation/authority and whether the
phase was entered. `analysis_status: interrupted` includes worker startup and
does not imply parsing completed; `not-started` identifies unvisited phases.
Native add-ons need no post-inventory source-processing phase, so neither interrupted
nor caller-excluded native files acquire AST scopes or semantic modules.
Actual JavaScript failures, structured-file unknowns, caller selection and byte
identity remain available. The graph consumes these produced facts.

The AST-only unavailable Evidence helper is replaced by an explicitly typed
static helper. Normal package/JSON/map gaps also retain their artifact-byte
authority. Per-file progress uses the same applicability owner: JavaScript keeps
its source phase, and metadata uses `process_javascript_artifact_metadata`.
Remaining parsers do not run after interruption. Failure sharing is limited to
five applicable phases during one interruption; no persistent cache is added.

A second review found the alternate full-analysis semantic builder still
created modules for every excluded file kind. An actual filesystem-producer
regression on revision `323fae8cbf3e36677bcb7b22ba31fa1a7e3c5cd4` reproduced
phantom native/JSON/HTML/package/source-map modules, while selected and excluded
JavaScript were positive controls. Semantic applicability now belongs to the
shared `recordUnavailableFile` projection entry point, before retaining limits,
nodes, roots or unknowns. Three duplicate caller checks are removed. Both full
and incremental construction use this boundary; actual excluded JavaScript
continues to carry source-bound unknowns and partial semantic coverage.

## Real input and reproduction

Use the [official Joplin v3.7.21 acquisition and extraction instructions](https://github.com/morluto/rea/blob/c7f6b8bad1a34d5efb30ff2a017672dea1fcdabb/docs/verification/javascript-native-handoff-identity-2026-10-15.md).
The AppImage SHA-256 is
`5d202dcaca31e14206826aa3f04125e7c218dbc3dc3d98479d811efbd6b856c1`;
ASAR SHA-256 is
`767df409b18effe60421fbefcca873de237c7e813eac744ecdeebbc5e825a33a`.
The 6,324-file inventory includes 46 unpacked entries. Both cohorts stage all
three native companions; the other 43 unpacked entries remain unavailable.

Build with pinned Node 24.18.0/npm 11.16.0 and locked dependencies. The extended
existing verifier also runs against the baseline runtime; copy the verifier and
`scripts/lib/javascript-file-scope-oracle.mjs` from the fixed revision into a
built baseline checkout when reproducing the failure.

```bash
artifact_path="/absolute/path/to/cases/available/app.asar"
common=(
  --artifact "$artifact_path"
  --addon-path node_modules/keytar/build/Release/keytar.node
  --native-sha256 0700016bcd761cbe02d275f2046c7cc42f39f730a50d66e3d3307aa9d413373a
  --source-path ElectronAppWrapper.js
  --source-path ElectronAppWrapper.js.map
  --source-path index.html
  --source-path package.json
  --source-path node_modules/keytar/build/Release/keytar.node
  --structured-path ElectronAppWrapper.js.map
  --structured-path index.html
  --structured-path package.json
  --structured-expectations '{"ElectronAppWrapper.js.map":{"operation":"parse-local-source-map","analysis_status":"not-started"},"index.html":{"operation":"parse-html-script-references","analysis_status":"not-started"},"package.json":{"operation":"parse-package-json","analysis_status":"not-started"}}'
  --rounds 3 --cli-parity
  --tokenizer-python /absolute/path/to/python-with-tiktoken-0.12.0
)
node scripts/verify/javascript/native-handoffs.mjs "${common[@]}" \
  --analysis-timeout-ms 1 --expect-timeout --require-safe
node scripts/verify/javascript/native-handoffs.mjs "${common[@]}" \
  --validate-structured-from-export --require-safe
```

Omit `--require-safe` on the baseline timeout run to record its incorrect
applicability. Its diagnostic exit 0 is not a passing analyst task. A supported
1 ms deadline includes worker startup; the verifier requires a typed timeout
and retained partial reference for that cohort. Each structured path supplies an
independent expected operation and phase-entry status; the safety oracle matches
all gaps exactly, including unavailable state and unknown confidence. Missing or
conflicting expectations do not pass.

The native path is explicitly selected. An earlier structured-only run excluded
it and therefore did not reproduce the native interruption. Input selections
and that preliminary result remain recorded. Both final cohorts preserve
partial coverage for unselected/unavailable scopes.

The supplied native Evidence is simulated solely to check exact subject linkage.
The verifier checks physical companion bytes and the exported parent's root
digest, validates public CLI/MCP native-trace parity, and reports only after
owned transport/command/private-file cleanup. Applications and large Evidence
are regenerable and are not archived.

## Two distinct task projections

The **timeout task** includes the expected typed-timeout preparation, one inline
native trace and three inline structured-path traces. It checks that native has
no AST failure and that each unvisited structured phase remains unavailable with
the appropriate artifact-byte authority and `not-started` status.

The **default-deadline control** models the summary plus one inline native trace.
Its named structured paths are additionally validated from the already exported
complete parent, explicitly labelled `exported-parent-validation`. Those checks
are diagnostic overhead outside the modeled native-task tokens and inside total
verifier resources. They are not presented as inline metadata answers.

A control that also requested the complete outgoing `package.json` feature trace
hit stdio admission twice: at least 10,587,373 bytes against a 10,484,736-byte
result budget, with identical retained parent/trace identities. It is not a
completed equivalent task or an efficiency baseline. [#4190](https://github.com/morluto/rea/issues/4190)
records the separate need for exact retained metadata/native fact views. Complete
export remains available. Do not compare costs across these different tasks.

## Measurements

| Cohort                         | Revision |  Wall s |      CPU s | Peak cgroup bytes | Applicability |
| ------------------------------ | -------- | ------: | ---------: | ----------------: | ------------- |
| Timeout, four inline traces    | baseline |  60.738 |  60.289464 |     3,092,045,824 | wrong scope   |
| Timeout, four inline traces    | final    |  57.515 |  57.089883 |     2,763,276,288 | pass          |
| Default control, native inline | baseline |  61.542 |  61.135522 |     2,808,336,384 | pass          |
| Default control, native inline | final    | 186.085 | 142.371100 |     2,959,585,280 | pass          |

| Defined task   | Selected catalog + parsed/structured replies BPE | Selected catalog + complete tool replies BPE |
| -------------- | -----------------------------------------------: | -------------------------------------------: |
| Timeout        |                                  21,136 → 20,161 |                              36,468 → 34,471 |
| Native control |                                  11,776 → 11,720 |                              17,738 → 17,632 |

The full-catalog alternatives and per-query samples are preserved in JSON.
Native content identity, observed byte provenance, source selection and handoff
provider Evidence remain equal. Corrected global provenance changes derived
parent/trace identities; null partial-Evidence subjects remain null. Both final
runs have exact CLI/MCP native-trace parity and match the earlier post-fix
controls in every recorded non-timing field.

The whole verifier includes input hashing, analysis, three native trace rounds,
applicable structured queries, export, CLI parity and tokenization. Every heavy
run uses the preserved [resource observer](https://github.com/morluto/rea/blob/b3bdabab694af1f9801eff7caf75001b92314a58/experiments/analysis-efficiency/resource-run.py):
one CPU, 8 GiB hard cap, 6 GiB early stop and no swap. Cgroup peaks include charged
file cache, not summed RSS. Counters are observed at payload exit while the
observer remains alive, not final whole-scope counters. Completed runs verify
owned cleanup and report no OOM.

Each MCP process is fresh, but input hashing warms its file cache. Build/OS caches
and shared-host scheduling are uncontrolled. First and repeated retained-query
wall samples remain separate; isolated query CPU/memory are unmeasured. An
earlier fixed timeout took 150.173 s wall / 119.468013 s CPU; its exact unchanged
runtime repeat took 58.827 s / 58.482996 s, with identical non-timing facts,
Evidence and BPE. Both receipts are retained. The final default control also took 186.085 s wall / 142.371100 s CPU; its
unchanged-runtime repeat took 62.651 s / 62.240964 s with identical non-timing
results. The slow final row remains reported. Attribution remains unresolved;
these runs establish no speedup or performance-equivalence bound.

The stricter post-review verifier reruns also passed without changing production
code: timeout 162.645 s wall / 125.876114 s CPU / 2,809,643,008 B peak; default
control 61.367 s / 60.970077 s / 2,526,949,376 B. Both preserve the original final
analytical fields, identities, coverage and BPE exactly; only timings and the new
explicit oracle-input field differ. These additional receipts do not replace the
slower rows above.

After centralizing semantic applicability, both real public controls passed again:
timeout 60.443 s wall / 59.970344 s CPU / 3,078,295,552 B peak; default control
63.574 s / 63.177884 s / 3,189,719,040 B. Analytical results, identities, coverage,
BPE and exact CLI/MCP parity remain unchanged. JSON identifies the runtime and
verifier source manifests for each cohort and keeps all earlier receipts.

Static `cl100k_base`/tiktoken 0.12.0 projections include the selected or complete
name/description/inputSchema catalog, requests and structured Evidence or parsed
text errors. Complete-tool-reply alternatives include MCP text/structured
duplication. The selected two-tool catalog is 5,570 BPE; the complete projection
is 195,522. Output schemas, host rendering/replay, notifications, model reasoning,
final answers and billing are unmeasured. Repeated rounds, export, CLI parity,
tokenization and exported-parent diagnostics are validation overhead outside the
defined task tokens but inside resource receipts. Removing unsupported claims
from the incorrect timeout baseline earns no efficiency credit.

## Verification and limitations

The initial production fix had 49 distinct passing cases across eight files. The initial
pre-progress-cleanup seven-file selection passed 44/44. After progress cleanup,
the same selection passed 43 and hit the existing 30-second test deadline in one
native identity case; an unchanged two-file rerun passed both native cases and
five public CLI cancellation cases. The original deadline was not increased.
The runtime verifier collects interruption-bearing scopes; separate regressions
cover native caller exclusion and malformed structured data. Source selection,
malformed structures, actual worker resource constraints,
retained large partial observations, cancellation/publication/cleanup, native
identity and both public adapters remain covered.

The first review found that the real verifier previously accepted any non-JavaScript
operation with artifact-byte authority and ignored phase-entry status. The
scenario now supplies exact operation/status expectations independently of the
production phase map. Six additional oracle cases use the actual retained
Joplin snapshots and reject wrong metadata operations, entered or missing
statuses, and absent or conflicting gaps. They passed, bringing the distinct
coverage to 55 cases across nine files. The production implementation did not
change during this review correction.

After the shared semantic-boundary correction from the second review, 78
distinct cases passed across ten files: the nine-file selection passed 65/65,
and the original root reconstruction file passed 13/13. This includes the
alternate-builder owning test file's 23 cases. The new producer-boundary
regression checks both construction paths, all five excluded metadata/native
kinds, and selected/excluded JavaScript controls. Real Joplin controls exercise
the public incremental workflow; the alternate full-builder path has filesystem
boundary verification rather than a separately measured real-app workflow.

Recorded attempts also include the verifier's initial non-null-subject assumption
and an invalid top-level semantic-module-path absence check. Both were corrected
before their assertions were used as proof. Corrected cancellation reproduction
shows the actual native AST scope and phantom module on the baseline. Final
source and execution-driver versions, source pins, input digests, prior attempts
and resource receipts are in the [compact JSON record](javascript-interruption-applicability-2026-10-15.json).

Before review, `npm run check && npm run docs:check` passed, including five consistency
tests: 165.553 s wall / 150.247257 s CPU /
4,232,491,008 B peak cgroup memory, clean owned exit and no OOM.
The first full check stopped on a 172-line test callback exceeding the 150-line
rule. A named assertion helper now shares scope lookup across all four public
results; the strengthened six-case file passed again before the final gates.
After the review correction, the full static/docs gate passed again, including
the five consistency tests: 111.395 s wall / 110.979710 s CPU /
4,347,125,760 B peak, with clean owned exit and no OOM.
After centralizing semantic applicability, the final full static/docs gate also
passed, including five consistency tests: 117.636 s wall / 117.194118 s CPU /
4,263,153,664 B peak, clean owned exit and no OOM.

At the initial PR revision, 36 CI checks passed; macOS `hdiutil create` failed
while creating its DMG fixture before REA verification, also failing the aggregate
check. No Apple fixture/workflow code changed. That attempt provides no passing
Apple runtime evidence.

Live Electron/application execution, real native-provider behavior, other-platform
runtime coverage and hosted-agent costs are **NOT_ENOUGH_INFO**. The verification
does not claim them.

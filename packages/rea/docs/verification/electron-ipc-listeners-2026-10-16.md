# Electron IPC listener verification, 2026-10-16

[#4390](https://github.com/morluto/rea/issues/4390), existing
[#4389](https://github.com/morluto/rea/pull/4389), umbrella
[#4027](https://github.com/morluto/rea/issues/4027).

All 73 IPC boundary regressions pass, alongside shared projection/actions and
converted MCP schema checks. Real draw.io operation phases succeed.
Every real capture still **fails overall provider cleanup**. These are distinct
results; neither completed-task acceleration nor token savings is established.

## Producing boundary and regressions

The existing PR `efd452948` was integrated with main `180ba03bf` in `5c3b02468`.
It fixes removal through the caller's original function and duplicate recording
of `once` invocations. Independent review found two further producing-boundary
problems: wrapper recognition evaluated caller `.listener` getters, and a copied
`removeAllListeners` snapshot loop differed from native live-array traversal when
removal observers prepended a listener.

Both new differential cases failed on that implementation (14 passed, two
failed). Fix `3c330f259` delegates traversal to Node, translating only owned `on`
wrappers at `removeListener`, and preserves the `off` alias. Descriptor reads
avoid evaluating getters. A further Proxy case exposed that descriptor reflection
can itself run a trap (16 passed, one failed); `2fb7f5523` uses Node's Proxy
identity first and removes the superseded catch. Those initial **17 cases** pass;
the later decorator finding and final 23-case validation are recorded below.
The native EventEmitter controls are semantic regressions, not real-app proof.

The change uses weak wrapper keys, removes the copied traversal and its snapshot
allocation, and adds no tool, cache, schema or normal reply field. Related
compiled provider/service modules and catalog metadata were byte-identical to
baseline main `180ba03bf` at the initial source freeze. This does not prove
arbitrary function introspection equivalence: custom
`.listener` properties and raw wrapper re-registration retain the limitations
documented in [Electron observation](../electron-observation.md).

## Unchanged real application and observed scenario

Official [draw.io Desktop 32.4.1](https://github.com/jgraph/drawio-desktop/releases/tag/v32.4.1)
AppImage SHA-256 is
`c687a9f1ddcaa146b78547452d264c03c2afcf125639cba5deeb65f3e9554c9e`;
both the release asset digest and published checksum file match. Its unchanged
62,941,673-byte ASAR is
`e64b9650c0b8241ca9a7d33b56386a385bceee63270cec701d3a467347b697e6`.
Complete accompanying resources were extracted; no application source was edited.

Public fuse inspection reports the official executable's Inspector fuse disabled.
No vendor Inspector attempt was made. The following trials explicitly select
generic Electron **44.7.0**, Xvfb and fresh profiles; they establish no packaged
runtime compatibility.

The real renderer initially displays an **Invalid file data** dialog. A public
CLI startup smoke and independent DOM/argv probes preserve this failure, tracked
separately in [#4494](https://github.com/morluto/rea/issues/4494). Its exact cause
is not proven. Two attempts to click a palette item without handling the dialog
timed out and were cancelled; they remain failed diagnostics. An initial helper
also incorrectly queried `application.process()` after transport closure; the
corrected helper retains the original ChildProcess handle instead.

The final scenario uses declared REA clicks to dismiss that actual error and
insert a visible palette item, then waits for rendering. Independent DOM reads
confirm SVG elements **0 → 2**, disappearance of the error and the real unsaved
changes indicator. The verifier exercises the real app callbacks and channels;
the production hook wraps their registration as described above.
The source also registers `app-load-finished` through both `once` and `on`;
recording its once callback twice adds a spurious event.

## Initial fixed-source ABBA observations

Verifier/source revision is `d02cc934c`; its hashes were recorded before all four
trials. Baseline is main `180ba03bf`. The same script, runtime, artifact and
declared actions run in the order baseline, candidate, candidate, baseline.

| Variant/run | IPC events | `app-load-finished` | SVG change | Pipeline wall s | Family CPU s | Peak cgroup bytes |
| ----------- | ---------- | ------------------- | ---------- | --------------- | ------------ | ----------------- |
| Baseline 1  | 8          | 3                   | 0 → 2      | 11.084          | 6.270053     | 560,615,424       |
| Candidate 1 | 7          | 2                   | 0 → 2      | 11.135          | 6.395461     | 550,383,616       |
| Candidate 2 | 7          | 2                   | 0 → 2      | 11.898          | 6.907123     | 525,631,488       |
| Baseline 2  | 8          | 3                   | 0 → 2      | 11.469          | 6.526674     | 558,456,832       |

Every declared action completed, every insertion oracle passed, and no verifier
deadline fired. Every provider returned `cleanup_failed`; the captures remain
partial/failed, including possible dirty-editor teardown and the known Linux
ownership gap [#4282](https://github.com/morluto/rea/issues/4282). Baseline 2 also
reports Xvfb temporary-directory cleanup failure (payload exit 5). Its directory
identity was not captured; no broad path-based deletion was attempted.

Runs are serial on CPU 10 with one-CPU quota, 8 GiB hard memory, 6 GiB early
stop, no swap and 192 tasks. Counters cover the cgroup family at payload exit
while the observer remains alive; they are **not final whole-scope counters**.
Memory includes file cache, not RSS. Some scopes still contain Xvfb at that
point; all recorded scopes were later independently confirmed inactive/dead.
External recovery does not establish provider cleanup.

OS/build caches are uncontrolled; these are first/repeat fresh-process runs,
not verified cold/warm system pairs. Two samples per variant and a cleanup-bound
failed workflow cannot establish a speedup. Token billing, peak agent context,
complete schema/call costs and actual MCP-wire parity are unmeasured. Fewer
events alone do not establish lower token cost.

Full static checks passed (two tasks, no cache hits): 89.441 s wall,
88.630288 family CPU s and 4,337,172,480 peak cgroup bytes, with no OOM.
Documentation checks also passed (6 tasks plus five README consistency cases).
The [selected JSON record](electron-ipc-listeners-2026-10-16.json) retains exact
source/input identities, failed attempts, coverage, IPC and resource receipts.
Historical diagnostic helper hashes were not captured and remain explicitly
unknown; the frozen hash is not assigned to them retrospectively.

## Reproduction

Build both pinned checkouts. Under the existing resource observer and a private
Xvfb instance, use the committed helper for each runtime root in ABBA order:

```sh
node experiments/analysis-efficiency/drawio-electron-lifecycle.mjs \
  --runtime-root /absolute/pinned-checkout \
  --executable /absolute/electron-44.7.0/electron \
  --application /absolute/drawio/resources/app.asar \
  --profile-root /absolute/temporary-profiles --dismiss-error \
  --selector '.geSidebar a.geItem:visible >> nth=0'
```

The helper returns failure on incomplete provider cleanup. This shared-service
probe does not establish successful public CLI/MCP workflows. App images,
extractions/profiles and full Result files are regenerable and excluded from Git.

## Review follow-up: normalization before app decorators

Fresh review of `f3bb9b9ed` found that translation inside a patched
`removeListener` happened after an application's outer decorator had already
seen the recording wrapper. Two native controls reproduced this with stable and
replaced decorators (17 passed, two failed).

`c8c494b5c` delegates the original Node traversal through a private forwarding
receiver. It shares the real emitter's live state and translates owned `on`
entries **before** invoking the current application removal method. App methods
and getters receive the real emitter; read-only method properties remain valid.
Native once entries pass unchanged. The public `removeListener`/`off` patches
are removed. Five decorator variants pass: stable, replaced, read-only, getter
and Proxy.

An additional mutation case proved that reading a changed public `.listener`
getter before delegation also changed deletion timing (22 passed, one failed).
Final source `5a094a0df` retains canonical removal targets in the weak owner
registry. Only unchanged data links are translated; changed getters run when
Node performs removal, preserving the exception and state transition. All
**23 cases** pass, including the original retention/fatal-error coverage.

The same frozen draw.io verifier was reused. The follow-up ABBA attempt ran
its first baseline, then the resource launcher refused the other three requests
because 8 GiB plus its 4 GiB host reserve was unavailable. Those are **not
executed**, with no performance measurements. The final source was separately
admitted and completed dialog recovery and insertion with seven IPC events;
overall cleanup still failed, and Xvfb teardown also returned an error. No new
completed-task speedup or cold/warm pair is claimed.

Final static checks passed: two uncached tasks, 135.173 s wall, 133.786166 family
CPU s and 4,274,634,752 peak cgroup bytes, no OOM. The JSON record appends exact
source pins, denial logs, final real-app/public cleanup diagnostics and checks
under `review_followup`; the initial records were not overwritten.

## Callback invocation and remaining raw-metadata limitation

Source `514b73b78` invokes `handle` callbacks through captured `Reflect.apply`,
preserving the receiver and actual arguments without reading an app-defined
`.call` property. The added direct-call control and hook case pass; all **24
IPC regressions** pass (3.661 s wall, 3.404 family CPU s, 318,291,968 peak cgroup
bytes, no OOM). This is a Node boundary check, not a real Electron handle claim.

An initial three-case experiment incorrectly assumed native EventEmitter avoided
callable method-property reads. Its `on` and `once` controls themselves failed;
they do not demonstrate hook regressions. The attempted intrinsic event-call
change was reverted and those invalid cases removed. Both failed runs remain
in `callable_followup`; no successful result is assigned to them.

The same unchanged draw.io verifier at this source completes actual dialog
recovery and shape insertion, with seven IPC events, SVG elements 0 → 2 and an
unsaved-changes indicator. Overall provider cleanup still fails. Pipeline wall
time is 12.610 s, family CPU 7.062834 s and peak cgroup memory 634,187,776 bytes;
there is no paired performance or token claim. All recorded scopes were later
independently inactive/dead, which does not establish provider cleanup.

Fresh review also found a distinct remaining metadata case: changing a raw
recording wrapper's writable `.listener` property can make an app decorator
reject removal. A production-hook/native-Node probe reproduces this (plain:
removed; hook: decorator throws and one listener remains). Exact reproduction
and the ownership conflict are tracked in [#4513](https://github.com/morluto/rea/issues/4513).
No affected real app has been identified. Removing the descriptor guard alone
does not make native removal match the mutated wrapper; temporarily rewriting
public app metadata would add further visible mutations. This limitation is
explicit in the observation guide and is not represented as fixed by this PR.

Current-source static checks also pass: two uncached tasks, 92.912 s wall,
92.031383 family CPU s and 4,340,375,552 peak cgroup bytes, no OOM.

## Native single/array dispatch follow-up

Fresh review of `6fc2d2769` identified that the earlier native controls covered
only one listener. Node 24.18.0 reads `.apply` during single-listener dispatch,
but invokes each callback intrinsically during array dispatch. Native `once`
uses `.call` for zero arguments and `.apply` otherwise. Unconditional `.apply`
in the observation helper changed two of those paths: a multi-listener callback
could throw before later callbacks ran, and zero-argument once read the wrong
property. Four explicit native controls reproduce two failures (26 passed,
two failed), rather than assuming all callable-property reads should disappear.

Source `e8d7e8f20` keeps one observation boundary. An `on` recording wrapper
delegates direct calls intrinsically and forwards native `.apply` calls through
its own nonenumerable method. Node selects the route; the hook does not inspect
or copy listener storage. `once` preserves its native zero/nonzero-argument
invocation. All **28 cases** pass, including the prior callback identity,
retention, reentrant-removal and fatal-error coverage. `handle` remains intrinsic.

The unchanged real draw.io verifier again completes dialog recovery and shape
insertion, with seven IPC events, SVG elements 0 → 2 and the unsaved indicator.
Overall provider cleanup still fails; no deadline fires. Its 12.290 s pipeline
run is a validation observation, not a paired performance comparison. Exact
source hashes, failures, resource measurements and post-scope states are appended
under `native_dispatch_followup`; all previous records remain unchanged.
The separate raw metadata limitation [#4513](https://github.com/morluto/rea/issues/4513)
remains open and is not represented as fixed.

Final-source static checks pass: two uncached tasks, 171.430 s wall,
169.139239 family CPU s and 4,091,392,000 peak cgroup bytes, no OOM.

## Argument-list ownership follow-up

Review of `23700fd2c` found two related representation errors. A raw callback's
`.apply` accepts Arguments objects, other array-like objects, null or omitted
argument lists; the recording helper assumed an Array. Native once also passes
its actual Arguments object to a callback-defined `.apply`, whereas the hook
passed a rest Array. Seven explicit native controls reproduce six failures
(29 passed, six failed of 35).

Source `a82d935ba` binds captured native Function apply to the method-forwarding
function. JavaScript itself converts argument lists, treats null/undefined as
empty and rejects invalid primitives before recording reads values. The
array-like getter control is read exactly once. Once retains its actual
Arguments object for invocation; recording alone takes an array slice. The
captured slice helper is bound once, avoiding an extra helper-argument array
on each invocation. No custom array-like parser or exception repair is added.

All **35 cases** pass. The same frozen real draw.io verifier again completes
dialog recovery and shape insertion with seven IPC events; no deadline fires,
and overall provider cleanup still fails. Exact source identities, both failed
boundaries, intermediate/final tests, resource costs and post-scope states are
appended under `argument_list_followup`; previous records remain unchanged.

Current-source static checks pass: two uncached tasks, 122.454 s wall,
121.287057 family CPU s and 4,185,915,392 peak cgroup bytes, no OOM.
The unchanged ASAR digest was checked again after the real-app trial.

## Owned metadata and successful-Evidence verifier follow-up

Fresh review of `41a513d99` found that `on` wrapper metadata used strict
assignment. Native on does not write such metadata, so inherited Function or
Object prototype setters/read-only fields could prevent registration only under
capture. Four native controls fail before `5dcf79f29` (35 passed, four failed).
The recording wrapper now defines its own data property directly; native once
assignment behavior is retained. All **39 cases** pass.

The verifier also incorrectly treated a successful Evidence envelope as a raw
capture. Real cleanup failures had exercised only the separate partial path.
`4a9a01f7a` reads successful `value.normalized_result` and preserves failed
`error.partialObservation.capture`. The new
`experiments/analysis-efficiency/drawio-electron-lifecycle-oracles.py` exercises
the actual verifier with controlled success, partial cleanup, action failure,
insertion failure and absent capture. The old verifier rejects valid successful
Evidence before producing a summary; all five corrected controls pass.
**These are controlled reply/exit checks, not real-provider evidence.**

The corrected verifier was separately frozen before a real unchanged draw.io
trial. Actual dialog recovery and shape insertion again complete with seven IPC
events, no deadline and failed overall provider cleanup (pipeline 12.777 s).
Success with real provider cleanup remains unverified. Earlier trials retain
their earlier verifier hashes; the corrected hash is not assigned to them.
Exact source pins, failed controls, resource costs and post-scope states are
appended under `owned_metadata_and_verifier_followup` without replacing history.

Final-source static checks pass: two uncached tasks, 99.992 s wall,
98.956939 family CPU s and 4,237,795,328 peak cgroup bytes, no OOM.

## Species-free recording and snapshot ownership

Fresh review of `e2cf2d89b` found that slicing a rest Array invokes application
`Array[Symbol.species]` before dispatch. The first control reproduced failed on
dispatch (40 passed, one failed); once dispatch already used Arguments.
Extending the check to retrieve the retained snapshot while the throwing getter
remains installed exposed the same representation problem in snapshot maps
(39 passed, two failed).

Source `3141ac3f4` records from actual invocation frames while preserving native
callback argument-list types: the method-based on path still passes an Array,
and once passes Arguments. Group validation uses the existing recording loops
without a filtered intermediate Array. Captured `Array.from` produces snapshots
without species lookup, reading dropped-counter Maps directly rather than
spreading them into another Array first. The initial **41 cases** pass, including both
live snapshots under the throwing getter with zero getter reads.

The frozen-source real unchanged draw.io operation again completes recovery and
insertion with seven IPC events, no deadline and failed overall cleanup
(pipeline 12.779 s). This does not establish that draw.io customizes species.
The corrected verifier and its five previously passing controlled oracles are
byte-identical to `4a9a01f7a`, so those unchanged oracle sources were reused.
Exact hashes, failures, resource receipts and scope states are appended under
`array_species_followup`; earlier records remain unchanged. There is no new
completed-task performance or token/context claim.

The native multiple-listener route was then included in the same live-species
control: all **42 cases** pass. Only test coverage expanded; production hook
and verifier bytes remain identical to `3141ac3f4`. Exact validation identities
and the additional result are recorded under `all_native_dispatch_paths`.

A fresh-profile real negative control omits `--selector` while retaining dialog
recovery and the same 500 ms wait. SVG elements remain **0 → 0** and unsaved
changes remain false; insertion gives **0 → 2** and unsaved true. This supports
the operation oracle rather than attributing startup rendering to the click.
The control also returns seven IPC events and failed provider cleanup. These
are different tasks, not a performance pair or a model-cell-count proof.

Final 42-case source validation includes two uncached static tasks passing in
94.234 s wall, 93.308800 family CPU s and 4,406,538,240 peak cgroup bytes,
with no OOM. These are verification costs, not an application speedup.

## Opaque apply inputs and iterator-free snapshots

Fresh review of `84d9cf5db` found two producing-boundary regressions: native
array-like conversion replaced the argument-list object before a custom
listener `.apply` received it, and `Array.from` snapshots consulted application
iterators on retained arrays/Maps. Four exact-input native controls and two
snapshot controls fail before correction (42 passed, six failed of 48).

Source `e442ca27f` forwards custom `.apply` the original receiver and method
arguments without interpreting its opaque list. Custom apply may transform
arguments or skip callback execution, so the hook emits a bounded
`ipc-observation-gap` timeline record with the known registration channel. It
does not fabricate a main-event invocation, argument shapes or callback result.
The shared result projection retains explicit uncertainty and counts dropped
gaps through existing retention. The canonical timeline enum adds that kind;
the captured-IPC subset does not. Native apply still performs its own conversion
before an actual callback frame is observed.

Snapshots now copy arrays through private null-prototype indexed views and
counters through captured native Map traversal. Neither retained buffers nor
counter Maps are exposed to application iterators; returned records and shape
arrays remain independent copies. No cache, tool or normal-dispatch metadata
is added. The raw-wrapper metadata limitation in #4513 remains unfixed.

The focused hook/projection/actions gate passes **68 cases** (48 + 4 + 16).
The separate MCP/schema gate passes **23 cases**: an actual SDK client receives
the gap alongside ordinary IPC Evidence, and Ajv2020 validates the advertised
converted output; all canonical tool schemas also pass their existing checks.
These tests use controlled providers and establish no real-provider success.
The verifier and its five controlled exit/summary oracles are hash-identical to
the earlier passing source and are reused without another redundant run.

## Unrelated CI baseline failure

CI run `38935598884` tested synthetic merge `eedae92d406015895a6d0eced5035da1b9ead07a`
(head `84d9cf5db`, base `9d940c2f2`). Two firmware cleanup tests failed; another
shard was cancelled by fail-fast. A fresh, unmodified detached checkout of that
exact base reproduces the same failures: **33 passed, two failed** in
`tests/boundary/firmware/firmwareIntegration.test.ts`. Evidence is posted on
[the PR](https://github.com/morluto/rea/pull/4389#issuecomment-6221054273) and
[existing #4475](https://github.com/morluto/rea/issues/4475#issuecomment-6221054775).
This establishes that these failures predate the Electron changes; it does not
resolve whether the firmware producer or its expectations need correction. No
firmware code or assertions are changed here, and required CI is not bypassed.

The first final-source real request fails before application launch because the
previous `/tmp` runtime is absent. It is retained as an input-resolution failure,
not a provider measurement. The cached Electron 44.7.0 archive is verified against
the official release SHASUMS256 and extracted into a new owned task directory;
its executable/archive digests are pinned before the next request. No target
source, vendor fuse or scenario success requirement is changed.

The recovered-runtime real operation completes all three declared actions:
SVG elements **0 → 2**, unsaved changes true, seven IPC events, no deadline.
Overall provider cleanup still fails. Current-source static validation passes
two uncached tasks in **94.646 s wall, 93.878644 family CPU s and 4,300,570,624
peak cgroup bytes**, no OOM. The initial static attempt's test-only SDK/Ajv type
error is retained; parsing that boundary fixes it, and 12 affected client and
projection cases pass again. `opaque_apply_and_iterator_followup` preserves all
source pins, failures, resource receipts and independently checked scope states
without replacing earlier measurements. Draw.io does not establish that real
applications exercise the synthetic custom-apply/iterator cases.

The final documentation gate also passes six tasks and five README consistency
cases. Source and unchanged ASAR hashes are checked again after validation.

## Borrowed apply receivers

Fresh review of `7541a900c` supplied the borrowed custom-method case
`raw.apply.call(g, emitter, list)`: the plain emitter runs `g`, while the hook
hard-coded its registered callback as the method receiver. The same hard-coded
receiver also affected borrowed native apply. Both native differential controls
fail before correction (48 passed, two failed of 50).

Source `da04465fe` maps only the hook wrapper itself to the original listener
when forwarding custom apply; other method receivers pass unchanged. Native
apply uses its actual receiver, preserving both ordinary wrapper recording and
borrowed-call dispatch. The hook does not fabricate a registered callback
invocation when another callable is selected. The method-forwarding boundary is
corrected directly; no new helper, state, tool or schema is added. All **70**
hook/projection/actions cases pass (50 + 4 + 16). Shared schema/client, projection
and verifier/oracle sources are byte-identical to the prior passing versions,
so their checks are reused by verified hash.

CI run `38943919946` is confirmed by the successful build checkout log and Git
parents to use merge `98c14dfc01fe4698a50eedc8b1cd1ac9cd03267d`
(head `7541a900c`, main `4838f4449`). Its fifth shard fails the same two firmware
cleanup tests as the unmodified `9d940c2f2` base control. The relevant firmware
source/test and package paths have no changes between these main revisions.
The REST PR `base.sha` remains stale at `2c7583599`; it is not used as the CI
identity. No firmware code/assertion or required-check bypass is included.

The frozen-source unchanged draw.io operation completes recovery/insertion
again with seven IPC events, SVG **0 → 2**, unsaved changes true and failed
overall provider cleanup. Pipeline: **12.038 s wall, 6.662295 family CPU s,
598,835,200 peak cgroup bytes**. This remains a partial workflow, not a speedup
claim. Final static checks pass two uncached tasks in **108.067 s wall,
106.996233 family CPU s and 4,430,647,296 peak cgroup bytes**, no OOM.
All prior measurements remain unchanged under `borrowed_apply_followup`.

The final documentation gate also passes six tasks and five README consistency
cases. Current source digests are checked again after validation.

## Listener-owner intrinsic lifetime

Fresh review of `f5b489c1b` found that late application replacement of
`Object.defineProperty` prevents the hook's new wrapper properties from being
created, while a plain native emitter still registers/invokes its callbacks.
Inspection of this same new registration/removal owner found its other late
property/constructor lookups. Seven independent native controls replace
`Object.defineProperty`, `Object.getOwnPropertyDescriptor`, `Object.create`,
`Reflect.get`, `Reflect.set`, global `Set` or global `Proxy`; each fails before
correction (50 passed, seven failed of 57). The controls include both on/once
execution and complete removal, with globals restored after the scenario.

Source `a9c5611d0` captures the owner's descriptor/property operations and private
constructors before application startup. The private receiver uses a direct
null-prototype object literal instead of looking up Object.create. All **77**
hook/projection/actions cases pass (57 + 4 + 16). Application-owned callback
methods and actual receivers retain their existing semantics. No tool, schema,
state, target authority or general-purpose hardening layer is introduced; this
is not complete JavaScript introspection equivalence. Unchanged schema/client,
projection and verifier/oracle checks are reused by verified source hashes.

The preceding CI run `38946503183` tests confirmed merge
`fcd7a9d92a2e64d6eb96d4fabfed7fc7f44b0d45` (head `f5b489c1b`, main `4838f4449`).
Its 36 jobs finish with 29 successes, the same two firmware failures causing
three failed jobs including summaries, and four fail-fast cancellations. The
fifth-shard log again names the two cases reproduced on untouched main. No
firmware code/assertions or required checks are altered.

Frozen-source real unchanged draw.io actions complete again with seven IPC
events, SVG **0 → 2**, unsaved changes true, no deadline and failed overall
provider cleanup. Pipeline wall is **11.429 s**. Observed payload-exit cgroup
counters are 6.441029 CPU s and 550,363,136 peak bytes, but the observer still
sees one additional scope descendant: **family resource observation is
unverified**, not a complete-family performance measurement. The scope is later
inactive/dead after external recovery; this does not verify provider cleanup.
No identity or cleanup cause is inferred from the remaining PID.

Final static checks pass two uncached tasks in **90.980 s wall, 90.119351 family
CPU s and 4,338,749,440 peak cgroup bytes**, no OOM. Source identities, all seven
failures and resource limitations are appended under `listener_intrinsics_followup`
without replacing any previous measurements.

The final docs gate passes six tasks and five README consistency cases; source
digests are checked again after validation.

## Private collection method lifetime

Fresh review of `e6c373d0` found that replacing `WeakMap.prototype.has` after
hook initialization still intercepts its private wrapper registry. Inspecting
the same owner found analogous get/set and visited-Set has/add lookups. All five
independent native controls fail before correction (57 passed, five failed of
62); plain EventEmitter registration, on/once calls and complete removal succeed.

Source `774ed6aa6` binds these private WeakMap/Set methods before application
startup and reuses captured Set membership for event-family classification.
One initialization-only binding helper replaces duplicated binding construction
for existing Map traversal/argument slicing too. It adds no helper argument
arrays per invocation, cache, schema, tool or target authority. Application-owned
callback methods/receivers remain dynamic. All **82** hook/projection/actions
cases pass (62 + 4 + 16). The previous seven global-binding controls also remain
green, and unchanged schema/client/projection/verifier/oracle checks are reused
by verified source hashes. Arbitrary introspection and #4513 remain unsupported.

Frozen-source unchanged draw.io actions complete again with seven IPC events,
SVG **0 → 2**, unsaved changes true and failed overall provider cleanup. Pipeline
wall **11.238 s**; observed payload-exit cgroup CPU **6.285321 s**, peak
**556,285,952 bytes**. Another scope descendant remains at payload exit, so complete-family resource observation is unverified. Later external scope teardown does not prove provider cleanup.

Final static checks pass two uncached tasks in **92.999 s wall, 92.227652 family
CPU s and 4,371,951,616 peak cgroup bytes**, no OOM. Preceding CI38949129899 checks
confirmed e6c3 + main4838, repeats the same two firmware failures and finishes
31 successful /3 failed jobs including summaries /2 fail-fast cancellations.
Sources, failures and resource limitations are appended under
`private_collection_methods_followup`; prior fields remain unchanged.

The final docs gate passes six tasks and five README consistency cases; source
digests are verified again afterward.

## Unknown listener-chain ownership

Fresh review of `0b4f2e81` found that the bounded Boolean chain test treats a
still-unexamined function as fresh when 17 app decorators hide an owned once
wrapper. Two emits then produce three invocation records for one actual once
callback. The same unknown-as-fresh error affects accessor/Proxy links. Four
native controls fail before correction (63 passed, four failed of 67); the
16-decorator boundary already passes. A deep ordinary on control confirms
missing ownership cannot justify fabricated captured IPC either.

Source `ef46b8f0b` classifies metadata as owned, unowned or unknown. Bounded-walk
exhaustion, accessor links and Proxies preserve native registration without
adding another recording wrapper. Successful unknown registrations retain a
bounded `listener-chain` gap; this is not proof of IPC delivery. An existing
inner wrapper may still report its actual once invocation. Shared native
data-descriptor parsing preserves accessor uncertainty at recognition/removal
and avoids inherited descriptor-value interpretation. The superseded Boolean
classification is removed.

The shared projection explains both gap boundaries and retention/coverage, and
an actual MCP SDK client receives custom-apply and listener-chain gaps alongside
ordinary IPC Evidence, validated by its converted advertised schema. All **96**
hook/projection/actions/MCP cases pass (67 + 5 + 16 + 8). A test-only lint length
failure is corrected by generating repeated fixture rows from one table without
relaxing rules; all **13** affected client/projection cases pass again. The
canonical schema and unchanged verifier/five controlled oracle sources retain
their earlier passing checks by verified hashes; the changed projection/client
are freshly tested rather than claimed unchanged.

Prior CI run `38951509761` uses confirmed merge
`fa090a6bde3a5dadeb71066824477292520fb43b` (0b4f + mainf31b231a). All **36 jobs
succeed**. The earlier unrelated firmware failures do not recur in this
combination; their cause is not inferred or claimed fixed here. Current-source
CI/review remain required. No firmware code/assertions were modified.

Frozen-source unchanged draw.io recovery/insertion again completes with seven
IPC events, SVG **0 → 2**, unsaved true, no deadline and failed overall provider
cleanup. Pipeline wall **11.163 s**; observed payload-exit cgroup CPU **6.203177 s**,
peak **547,418,112 bytes**. An extra scope descendant leaves complete-family
resource observation unverified; later inactive/dead scope after external
recovery does not establish provider cleanup.

Final static checks pass two uncached tasks in **88.383 s wall, 87.726306 family
CPU s and 4,399,632,384 peak cgroup bytes**, no OOM. All source identities, failed
controls, corrected fixture-only lint failure and resource caveats are appended
under `chain_ownership_followup`; historical fields are unchanged.

Final docs validation passes six tasks and five README consistency cases;
current source digests are verified again afterward.

## Inherited listener-link coverage

Fresh review of `ae2cd8d4` found that a missing own descriptor is not absence:
an app decorator can inherit its data link to an owned once wrapper. Native
removal follows that link and removes the decorator; the hook hid it under
another recorder, left a listener installed and produced three invocation
records for one callback. Five native inherited-link cases fail before correction
(68 passed, five failed of 73): data/getter/Proxy prototypes and prototype
depths16/17. A late Object.getPrototypeOf replacement control already passes.

Source `e22ce9aaf` completes bounded native prototype lookup at the descriptor
owner, capturing getPrototypeOf before startup. Data links retain their actual
source value. A setter-only property has a known undefined read that shadows
ancestors; a getter, Proxy or incomplete walk remains unknown. Missing metadata becomes absent only after the prototype chain ends; found
properties retain native read/shadowing semantics. Registration and removal consume
the same parsed descriptor, and redundant outer Proxy interpretation is removed.
Neither existing resource bound is raised. All **102** hook/projection/actions/
MCP cases pass (73 + 5 + 16 + 8). Projection/client are freshly tested unchanged
sources; canonical schema and verifier/oracles retain prior checks by hash.

Prior CI run38955237255 tests confirmed merge9c0ceb152c902c1339806608f8b4a010c3d22fc6
(ae2c + main8116dc06). All36 jobs succeed; current-head CI/review remain required.

Frozen-source unchanged draw.io recovery/insertion again completes with seven
IPC events, SVG **0 → 2**, unsaved true and failed overall provider cleanup.
Pipeline: **11.264 s wall /6.376574 family CPU s /557,068,288 peak cgroup bytes**.
Payload-exit observation is verified at that phase while the observer lives;
these are not final whole-scope counters or provider cleanup proof.

Final static checks pass two uncached tasks in **90.797 s wall, 90.096799 family
CPU s and 4,335,267,840 peak cgroup bytes**, no OOM. All source identities, native
failures and current results are appended under `inherited_listener_links_followup`;
previous fields and earlier resource caveats remain unchanged.

Final docs validation passes six tasks and five README consistency cases;
current source digests are verified again afterward.

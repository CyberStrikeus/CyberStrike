# Electron file-page observation

REA can attach to an Electron/Chromium CDP endpoint and inspect existing `file://` renderer pages without evaluating JavaScript or invoking Electron APIs. The request supplies the endpoint directly; REA accepts only literal-port loopback HTTP endpoints. Selecting an endpoint exposes every Electron target it serves, including local file paths and page metadata.

Disconnecting the inspection's page session can clear caller-owned
`navigator.platform` emulation inside Chromium. REA cannot restore another
client's complete user-agent/client-hint configuration. Use a disposable target
or let the owning client reapply its configuration; see the shared
[CDP state limitation](browser-observation.md#provider-authorities).

This passive runtime surface is distinct from the target-free static
[`analyze_javascript_application`](javascript-artifact-reconstruction.md)
workflow. Static analysis reads a local ASAR or extracted directory without
executing application code. Passive observation inspects an existing Electron
page. The results keep static inferences and runtime observations distinct.
Packaged fuse state is a separate static read:
[`inspect_electron_fuses`](electron-fuses.md) reports whether this binary will
honor Inspector flags, `ELECTRON_RUN_AS_NODE`, embedded ASAR integrity, and
`app.asar`-only loading.
Use the separate
[`reconcile_javascript_runtime`](javascript-runtime-reconciliation.md) workflow
when both Evidence sets already exist.

## Target boundary

The request supplies a literal-port loopback endpoint and, for inspection, a
target ID. REA accepts local hostless `file://` URLs that resolve to regular
files, including pages a packaged application serves from inside `app.asar`.
For those, the first `.asar` path component that is a regular file is the
archive, the remainder must name a regular file in its header, and the reported
path is the canonical archive path joined with that member. Remote hosts,
encoded separators in the pathname, ASAR directories or links, and nonexistent paths are
rejected. The endpoint exposes every eligible target and its local path
metadata. Query strings and fragments do not participate in filesystem path
admission, including their encoded separator text. Listing and inspection
Evidence both retain the observed browser product/revision; host platform and
architecture remain explicitly unknown.

Cancellation stops further file authorization after an already-started filesystem
operation settles. ASAR descriptor-close failures remain typed incomplete cleanup
with an exact retryable owner; they are not treated as a missing or unauthorized
page. A later authorization and provider shutdown retry retained descriptors
before reporting their release. Failed listing retains its already-authorized
target prefix and explicit remaining-target uncertainty through cleanup errors
and exact-owner retries.

## Workflow

`list_electron_targets` returns every eligible target served by the supplied endpoint in one inline array.

For the MCP follow-up call, pass the same literal-loopback endpoint and the selected target ID to `inspect_electron_page`. REA rediscovers targets and validates the ID against the live endpoint before inspection.

```bash
rea list-electron-targets http://127.0.0.1:9223 --json
rea inspect-electron-page http://127.0.0.1:9223 TARGET_ID \
  --observation-ms 100 --json
```

Script content is excluded by default. Setting `include_script_sources` in the
request returns the selected target's script sources:

```bash
rea inspect-electron-page http://127.0.0.1:9223 TARGET_ID \
  --include-script-sources \
  --json
```

The normalized result contains canonical local paths, frame and DOM
structure, resource metadata, stable script/resource identities, explicit
completeness, and content-addressed script artifacts. Resource sizes are unknown
when omitted or invalid; supplied invalid sizes also produce an explicit
completeness diagnostic.

DOM node indices retain their snapshot positions. Invalid rows are omitted with
completeness diagnostics, so `total_nodes` can exceed the retained node count
and a parent index can refer to an omitted source node.

`dom.node_value_length_unit` is `utf8-bytes`: each node's `node_value_length`
counts the bytes needed to encode its value as UTF-8, not characters. Web
observations instead declare `utf16-code-units`. These existing measurements
are preserved; the unit is reported once for the whole DOM, without retaining
text values. Historical captures without the unit leave it unknown; reading
them does not infer a unit or convert their stored lengths.

Script metadata retains its execution-context frame ID when CDP supplies one and
records admission separately in `frame_scope`. An `authorized` scope refers to
the observed document generation; `unknown` retains the known frame ID without
claiming authorization and makes script coverage attach-limited. Historical
captures may omit this field, which leaves that admission fact unknown.
Scripts from document generations whose frames were explicitly excluded by
local-file policy are omitted before script-source reads. Frame identity can
come from the script event's own auxiliary data or its observed execution
context; contradictory identities are not aligned.
`frame_claims.script_event_frame_id` and
`frame_claims.execution_context_frame_id` preserve the actual observed claims
from those two sources. Both remain available when their disagreement leaves
the resolved `frame_id` null and `frame_scope` unknown. An omitted claim is
unobserved, not proof that a frame was absent.
Frames describe the current inventory; script observations can retain earlier
authorized frames that have since detached.

`has_source_url` preserves CDP's sourceURL declaration flag as true, false, or
unknown (`null`, or omitted in historical captures). A script's canonical
`file_path` is the admitted local-file URL or supplied sourceURL label. It does
not verify that the runtime bytes came from that disk file; captured source
bytes have their own digest. `reported_url` retains the original URL or label
before canonical path admission. Labels remain distinct from filesystem provenance.
The capture also
inventories worker, service-worker, and shared-worker targets with
validated opener-target and parent-frame IDs. Worker discovery uses passive
target metadata; REA does not attach to or execute code in those targets.
Script metadata uses the shared 8 MiB JSON-byte allowance for each retained
representation: incoming drafts and normalized capture metadata. Admission
counts escaped strings, frame claims, and provenance fields before retaining
them or serializing metadata for a digest. Exhaustion preserves earlier records
and reports counted `resource_budget_exhausted` script omissions; a later
smaller record may still fit. This allowance adds no script-count cap and is
separate from script-source bytes.
Script-source collection retains at most 32 MiB of UTF-8 text across scripts
and shares a 20-second collection deadline. Omitted sources retain their script
metadata and an explicit reason; later smaller sources may still fit after an
oversized source is omitted. The separate 64 MiB CDP response limit bounds one
wire message before retention admission, rather than total transient memory.
The source budget adds no script-count cap. Like every
target, frame, script, and resource, a worker URL must resolve to a local
file before it is retained. Relationship IDs improve
attribution but do not prove which static module started a worker or that its
work completed.
Missing opener and parent relationships leave worker ownership unknown. Such
targets are withheld with an `unattributed_target` exclusion and unavailable
`workers` coverage, even when their URL names a local file. Explicit foreign
relationships remain `out_of_target_scope`; malformed supplied relationship IDs
are `invalid_protocol_value`.

Inspection does not retain DOM values, execute renderer code, navigate, click,
invoke Electron IPC, close a target, or terminate the application.

## Active Electron scenarios

The scenario request supplies the Electron executable and application entry
point, plus any arguments and actions. The application root defaults to the
entry point's parent directory and can be supplied when the app uses a different
root. REA launches that executable through
the official Playwright Electron API and owns its lifetime. It accepts click/wait actions,
window-targeted renderer reload/crash actions, and synthetic `open-url` or
`second-instance` deep-link delivery. It records capture-scoped window and
WebContents identities, process metrics, and IPC channel and value-shape metadata.
Payload values are not retained.

`window_index` selects from Playwright's current Page list at the start of each action. REA resolves that Page to its corresponding BrowserWindow once; the action's `target` uses the BrowserWindow's capture-scoped `window_id`, matching the window inventory. Reordering either enumeration after selection does not retarget the action. Handle cleanup failures retain the completed action records and remain owned for provider cleanup retry.

Run the real fixture verifier with an operator-provided Electron runtime:

```bash
REA_ELECTRON_EXECUTABLE=/absolute/path/to/electron npm run verify:electron
```

This operation actively launches and interacts with the selected target. It is
not a passive CDP observation. The owned process keeps normal host filesystem
and network privileges, so lifecycle ownership does not make it a sandbox.

The CLI and MCP surfaces accept the same schema. For a JSON request file:

```bash
rea capture-electron-scenario scenario.json --json
```

The result records one status and target per declared action; actions after a
failed or cancelled action are not run and are recorded as `cancelled` with a
not-executed error. It also records correlated app/window/WebContents,
preload, session, navigation, shell, permission, popup, download, protocol,
native-addon, process, and IPC timeline events. IPC channels and argument-shape
metadata retain their observed lengths; payload values are never retained.
Renderer crash/restart and deep-link actions are synthetic
scenario controls; their attempted and observed outcomes remain in the
timeline. The active hook blocks and records the shell methods listed below
and selected navigation, permission, download, popup, updater, and
OS-integration APIs. These method patches do not contain direct filesystem,
network, native-addon, or other unpatched target effects. The timeline
is explicitly partial when attachment starts after application activity. The
startup, including the initial state snapshot, has a 60-second deadline.
Actions wait until completion or request cancellation; a click whose target
never appears, or a `wait` without `window_index` in an app that opens no
window, remains pending until cancelled. After cancellation, the final state
read has 5 seconds before REA keeps the initial snapshot instead; the
cancellation keeps the caller's reason and records that expiry in its
diagnostics.
The shell policy is owned by `blockedShellResults` in
`scripts/electron-active-hook-boundaries.cjs`. Its synchronous blocks are:
`showItemInFolder` returns `undefined` and `writeShortcutLink` returns `false`.
Their `shell-attempt` events record the blocked phase and argument shapes;
neither result means the requested host operation occurred. The existing
`openExternal`, `openPath`, and `trashItem` blocks reject their promises.
The `trashItem` block prevents that call from reaching the OS trash operation;
it does not intercept other ways the application can remove files.
CLI SIGINT/SIGTERM requests cancellation and awaits owned-process cleanup.
Window IDs, URLs, and cached titles come from one main-process Electron snapshot,
so a crashed renderer does not require a successful renderer-side title query.
Window instrumentation uses Electron's window-created event, including runtimes
with a read-only `BrowserWindow` export. Preload configuration comes from the
window's runtime metadata, including Electron's optional internal preload
descriptor when web preferences omit it. This descriptor is verified on
Electron 44.7.0; runtimes that expose neither representation retain an unavailable
path. A configured path or working IPC handler does not prove preload execution.
If cleanup cannot be verified, the error retains collected observations in
`details.partial_observation` and marks their application cleanup `unverified`.
Cleanup uncertainty does not authorize signaling unrelated processes.

On Linux, Chromium-based processes can overwrite the initial environment memory
exposed through `/proc/<pid>/environ`. The environment may be readable while
`REA_PROCESS_RUN_ID` is absent, even if the application still sees it through
`process.env`. REA reports the missing marker and leaves lineage ownership and
cleanup unverified; the PID, executable, or parent relationship cannot replace
that ownership proof. This limitation can affect owned Electron captures on
native Linux as well as WSL. It does not establish that all Electron versions or
Linux environments behave the same way.

Main-process IPC recording keeps original-function removal for `on` and `once`
registrations and records a fired `once` callback once. Native Node.js owns
`once` registration, firing and callable dispatch as well as removal order and
traversal, including listeners registered by removal observers;
the hook translates only its own recording wrappers at the removal boundary.
Wrapper metadata uses weak keys and does not retain removed registrations.
Wrapper metadata operations, private collection methods and traversal constructors are captured
before target startup; later replacement of their global bindings does not
change listener registration or removal.

Native runtimes differ in whether `once` consults callback `.call` or `.apply`.
The hook observes actual callback entry without imposing another runtime's
property reads or argument-list representation. Application methods selected by
native dispatch keep their original receiver and argument-list object; opaque
methods produce a `custom-call` or `custom-apply` observation gap when callback
execution cannot be established.

If native wrapper creation or registration-method lookup could expose private
instrumentation through an application getter, setter or Proxy, registration
stays native and unwrapped. The `once-metadata` observation gap identifies that
unobserved registration attempt; it does not prove registration or delivery. The original callback,
metadata writes and native method receivers are preserved, including when
registration fails. Later registrations resume normal observation. Non-callable
`call`/`apply` properties produce failed observation gaps when native dispatch reads
them; callback entry is not fabricated.

An `on` listener's application-defined `.apply` receives the original argument-list
object unchanged. Borrowing the exposed method preserves its dynamic receiver.
Because that method owns argument interpretation and may not
invoke the callback, the hook records a bounded `ipc-observation-gap` timeline
entry with the registered channel rather than an IPC invocation. Its empty
`argument_shapes` means unobserved arguments, not a zero-argument callback;
callback execution and result remain unknown. Coverage and retention include
these gaps even when their individual records are dropped. Normal native
dispatch continues to record actual invocation frames. Evidence snapshots copy
retained arrays and counters without invoking application iterators or Array
species.

Listener-chain recognition distinguishes owned, unowned and unknown metadata.
Data links may be inherited; absence is established only after completing the
bounded prototype lookup. Exhausting either walk, encountering a getter or seeing a Proxy leaves
ownership unknown. The hook preserves native registration without adding another
recording wrapper and retains a `listener-chain` observation gap after successful
registration. This gap does not prove IPC delivery. An existing inner recording
wrapper can still report its actual invocation; otherwise callback activity
remains unobserved. Setter-only properties have a known undefined read.
Data-descriptor parsing is shared with removal normalization.

This does not establish complete JavaScript function introspection equivalence.
Caller-defined `.listener` properties can change the identity exposed by
`listeners()` and meta-events; accessors and Proxy metadata are not followed for
wrapper recognition. Re-registering a raw recording wrapper on another channel
retains the original registration's channel attribution.
Mutating `.listener` on a raw recording wrapper can also prevent removal through
application decorators that bypass the hook's removal methods. When a removal
request reaches the hook's methods and its registration order is known, private
callback ownership preserves removal by the original function and the newest
matching registration when public metadata is changed or deleted. Native removal
still determines getter execution, exceptions and removal meta-events.

If registration or removal methods differ from the Node methods captured at hook
initialization, the hook leaves listener callbacks unwrapped and records a
`listener-registration` observation gap. The application keeps its original
callback and receiver; callback execution remains unobserved. This comparison
assumes Node's EventEmitter prototype has not itself been globally decorated
before hook initialization. The provider loads the hook before the application
and excludes `NODE_OPTIONS` from the child environment. It preserves selected
`DISPLAY`, `XAUTHORITY` and `WAYLAND_DISPLAY` values, including the caller-selected
X11 authorization-file path.

An opaque later listener or unsupported emitter state can prevent proof of
removal order. The hook then delegates removal
to the native method and records a `listener-removal` gap rather than claiming
which registration was removed. These gaps are distinct from dropped records
and do not establish IPC delivery or successful removal.

### Target fuse prerequisites

Active scenario capture requires that the target Electron executable honors Node CLI inspector flags (`--inspect` or `--remote-debugging-port`) so that Playwright can establish its DevTools protocol session.

When an Electron executable explicitly disables the `EnableNodeCliInspectArguments` fuse (or removes the capability), `capture-electron-scenario` fails immediately before process launch with an `AnalysisUnsupportedTargetError` ("unsupported_target") rather than waiting for the startup deadline. For targets with disabled inspector fuses, use passive CDP inspection via `inspect_electron_page` or run against an unrestricted development binary with the extracted `app.asar`.

The real verifier exercises compiled CLI and stdio MCP discovery, page/script
inspection, static/runtime reconciliation, active observation, and CLI SIGTERM
cleanup before checking the IPC, renderer crash/reload, utility/child-process,
deep-link, and blocked-effect fixture. A cleanup error keeps the full lane failed
even when the retained capture contains useful observations.

Active Electron Evidence can also be supplied to
[`reconcile_javascript_runtime`](javascript-runtime-reconciliation.md). That
projection is intentionally target-only and partial: it binds the selected
application path and capture outcome to the static graph, while frames, scripts,
workers, and execution claims remain unavailable until a separate passive runtime
capture provides them.

ASAR observation reads the header through one open file handle and validates its
declared lengths against the archive size. Header/index admission is the same
budget used by static ASAR reads: 16 MiB / 16777216 bytes by default, seeded by
`REA_ASAR_MAX_HEADER_BYTES` (at most 256 MiB). In MCP,
`update_analysis_settings` can override `asar.max_header_bytes` for new
operations without restarting REA. Cached headers are checked against each
operation's admission, including after a decrease. See the
[settings design](design/limits-and-recovery.md#failure-and-retry).
An oversized header is
not parsed; selecting a member path does not bypass admission, and the page
stays unauthorized. The header cache separately retains at most that many bytes
of already-admitted encoded headers across eight archives. Evicting that cache does not raise admission.

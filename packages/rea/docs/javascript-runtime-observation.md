# Passive Node and Electron runtime observation

REA can attach to an already-running Node.js or Electron V8 Inspector target
and retain script-load and execution-context metadata. The
`list_javascript_runtime_targets` and `observe_javascript_runtime` MCP tools
have equivalent `rea list-javascript-runtime-targets` and
`rea observe-javascript-runtime` commands. Successful calls return
deterministic Evidence.

Each request supplies the loopback Inspector endpoint and, for observation, the
target ID. This surface is separate from browser CDP, Electron file-page
inspection, and Process Capture:

```bash
rea list-javascript-runtime-targets http://127.0.0.1:9229 \
  --json
rea observe-javascript-runtime http://127.0.0.1:9229 TARGET_ID \
  --runtime-kind node --json
```

## Start a caller-owned Node target

Run your selected application with Inspector bound to loopback:

```bash
node --inspect=127.0.0.1:9229 ./app.mjs
```

Keep it running while listing targets and observing the selected ID. Use a free
port and the same literal endpoint in both REA calls. Stop the application
through its normal lifecycle when finished; REA disconnects but does not own or
terminate it. Node.js must already be installed.

Use `--inspect` for this passive workflow. `--inspect-brk` pauses before the
application starts, and REA never resumes it or sends
`Runtime.runIfWaitingForDebugger`. Resume a paused target with a separate
caller-owned debugger before requesting application runtime observations.

For a packaged Electron app, read
[`inspect_electron_fuses`](electron-fuses.md) before starting an `electron-main`
target. When `EnableNodeCliInspectArguments` is disabled or removed, Electron
ignores `--inspect` and `--inspect-brk`. A missing main-process target after
launch does not, by itself, show that fuse.

The caller supplies the literal-loopback HTTP endpoint directly. Selecting an endpoint exposes all targets it serves and their local script locations or renderer origins. A target must match the exact requested target ID and expose a same-port WebSocket reported by that endpoint. Targets explicitly marked attached are rejected rather than displacing another debugger. Node's `/json/list` omits attachment state, so REA preserves it as `null` (unknown), reports that limitation, and permits observation unless the endpoint explicitly reports `attached: true`. Local paths are canonicalized after symlink resolution.

The `attached` field in JavaScript runtime and browser target results is nullable: `true` and `false` are reported only when discovery supplied a boolean; `null` means the endpoint omitted or could not report the state. HTTP `/json/list` discovery parses target rows independently. Malformed optional attachment metadata becomes `null` with a row and field diagnostic in `limitations`; usable siblings remain available. Rows with malformed target identity are excluded with diagnostics, and socket authority is still validated before connection. CDP `TargetInfo` worker records require an `attached` boolean; REA excludes a worker record with a missing or malformed value as an invalid protocol value.

`list_javascript_runtime_targets` returns every available target in one inline
array.

Attachment refusals identify `attached: true` and ask the caller to disconnect
the other debugger or select another target. A declared-role mismatch names
`runtime_kind` and the target protocol type; correct the role or omit it to
retain an unknown role. A role-only disagreement in supplied runtime Evidence
is attributed to `parameters.runtime_kind`, separately from a target-ID
disagreement. Partial-capture warnings count retained distinct script records;
`observed_total` retains the raw script-event count before deduplication.

For the MCP follow-up call, pass the same literal-loopback endpoint and the selected target ID to `observe_javascript_runtime`. REA rediscovers targets and validates the ID against the live endpoint before observation.

### Discovery file locations

Node's `/json/list` reports a best-effort pathname prefixed with `file://`,
without URI encoding. On POSIX, REA interprets unambiguous paths literally,
including `#` and `%` in filenames. Node also replaces backslashes and double
quotes with underscores. That transformation cannot be reversed reliably:
an underscore may already be part of the original filename.

Windows paths, ambiguous underscore paths, and local discovery paths that
cannot be verified remain eligible by their endpoint and exact target ID.
Their target location preserves the reported value:

```json
{
  "kind": "unresolved",
  "reported_url": "file://C:_tools_entry.js",
  "reason": "unverifiable-file-location"
}
```

This location does not claim that a file exists or authorize reading its
contents. Listing remains HTTP-only. Observation resolves loaded script
locations independently from `Debugger.scriptParsed` file URLs, preserving
the existing checks for local files and encoded separators. Unsupported
schemes, remote file hosts, and a bare `file://` remain excluded. These Node
discovery rules do not apply to page targets or other runtime products.

Reconciliation retains an unresolved `target_location` object and reports
`runtime-location-unresolved` with unknown confidence for that target. It
does not derive a static match from the reported pathname; verified loaded
script locations remain available for independent matching.

## Passive protocol boundary

The provider sends exactly two protocol commands:

- `Runtime.enable`
- `Debugger.enable`

It never sends `Runtime.evaluate`, reads script source, installs breakpoints,
sends pause/resume commands, calls `Runtime.runIfWaitingForDebugger`, launches
the target, instruments JavaScript, or invokes Electron APIs. Enabling
`Debugger` can make target-authored `debugger` statements pause execution.
REA does not send `Debugger.setSkipAllPauses` or resume these pauses; passive
observation is not a guarantee of uninterrupted target execution. Closing a
call closes only REA's WebSocket.

Each WebSocket handshake and command response has its own 20-second deadline,
separate from the caller-selected observation window. A stalled handshake or
command reports `provider_timeout` and retains observations already received;
caller cancellation still reports cancellation.

The direct observations are:

- `Debugger.scriptParsed`, establishing that a bounded script location was
  parsed in the observed execution context;
- `Debugger.scriptFailedToParse`, retained only as a bounded invalid-script
  count in `scripts.parse_failed_total`. A well-formed parse-failure
  event is distinct from malformed protocol data and does not make loaded
  script coverage unavailable. Older Evidence may omit this count;
- `Runtime.executionContextCreated`,
  `Runtime.executionContextDestroyed`, and
  `Runtime.executionContextsCleared`, establishing context lifecycle within
  the capture window. A created or destroyed event whose context ID is
  missing or not a safe integer adds no context record; it is retained only
  as a count reported in `unknowns`.

The Inspector protocol does not directly expose require/import caller edges,
EventEmitter emissions or listener invocation, Electron IPC messages or
handlers, or script-unload events. Those facts remain explicit unknowns.
`scriptParsed` proves script presence, not the importing module, feature
execution, initialization order, or causality.

For an authorized file script, `location.file_path` is the verified filesystem
identity and optional script-item `reported_url` preserves the exact Inspector
URL. Script identity includes that reported URL, so query and fragment
variants of one file remain separate observations. Older Evidence may omit
`reported_url` and remains readable.

## Node and Electron roles

The caller declares one role: `node`, `electron-main`, `electron-preload`, or
`electron-renderer`. Node and Electron-main declarations require a protocol
target of type `node`; preload and renderer declarations require `page`.
Inspector does not authenticate the operating-system PID or distinguish an
Electron role, so Evidence records the role authority as
`caller-declared-unverified`.

If final script-location authorization fails, collected script and context facts
remain available in the typed failure with explicitly unverified locations.
Descriptor cleanup status and its retry owner remain independent of that capture.

Electron main, preload, and renderer behavior can therefore be observed only
as separate Inspector targets. The provider does not infer that two
targets belong to the same Electron application.

## Capture and determinism

Capture retains valid script and execution-context metadata within an 8 MiB
aggregate budget, including conservative estimates for UTF-16 strings, record
and collection overhead, and projected URL fields. Each CDP message also has a
16 MiB transport limit. A message over that limit fails with `payload_limit`;
when the aggregate budget is reached, later metadata events are dropped and
the partial result reports `events_dropped`, `truncated: true`, and
`retained_metadata_budget_exceeded`. Repeated context transitions update the
current context record instead of accumulating duplicate objects. Scripts are
validated after capture, deduplicated by stable metadata, and canonically
sorted. Wall-clock timestamps and protocol script IDs are excluded from the
durable result, so identical inputs and captured metadata produce the same
Evidence ID.

Inspector attach is inherently incomplete. Enabling `Debugger` reports known
and uncollected scripts, but scripts collected before attachment may be
missing. Absence from the observation window never proves that a script or
behavior does not occur.

Cancellation stops new target-file authorization after the current filesystem
operation settles. Cancellation diagnostics retain the examined target prefix;
unexamined targets remain unknown. Observation cancellation keeps its original
reason and any completed Evidence. Finalization waits for REA's bounded socket
close (up to two seconds for graceful and forced confirmation). A failed close
retains its exact transport owner and blocks replacement connections until
cleanup succeeds; CLI finalization and MCP shutdown also retry retained cleanup.
Closing REA's connection does not stop the caller-owned runtime.

## Static correlation

Pass the resulting observation Evidence and an
`analyze_javascript_application` Evidence record to
`reconcile_javascript_runtime`. The reconciliation accepts this provider
alongside passive web and Electron page captures. Exact file or URL mappings
supplied with the request can correlate script presence with JavaScript Application Graph
assets. Because this provider never reads source bytes, matches normally use a
unique authorized location and remain weaker than captured-byte identity.
Builtin `node:` scripts remain runtime-only nodes unless a future explicit
static authority models them.

# Process capture

Process Capture runs one caller-selected command and records bounded evidence
about its terminal behavior, scheduled interactions, process lifetime, and
selected filesystem state. Use it to compare two direct runs of the same
scenario, such as an authority build and a reconstruction. It does not replay a
previous execution or emulate dependencies.

The command runs with the current user's permissions and inherits the host
environment before applying the scenario's explicit overrides. This is not a
sandbox. Filesystem observation paths select what REA snapshots; they do not
restrict what the process can read or write. The inherited environment is not
recorded, so its influence may remain unknown.

The installed PTY backend cannot preserve an explicit environment name
`__proto__`. REA rejects that override before launch; use `/usr/bin/env` with
`__proto__=VALUE` as an argument when that literal variable is required. The
reserved `REA_PROCESS_RUN_ID` name also remains unavailable to scenario overrides.

## Host support

Capturing a new scenario currently requires Linux or macOS and a working
native PTY backend. Native Windows capture is unavailable because the PTY
adapter does not yet verify descendant cleanup. The native Job Object controls
used by other REA providers do not establish PTY capture support. Reinstalling
the Windows PTY binary does not enable this workflow.

For Linux commands, use Linux REA inside WSL. Adapt the scenario to that host;
this does not establish capture of a native Windows process tree. Comparing
existing capture Evidence through the CLI or MCP remains available on Windows
and does not launch a PTY or the captured target.

On supported capture hosts, a missing or incompatible native PTY binary has a
different recovery: reinstall REA for the active platform, architecture, and
Node.js version with optional dependencies enabled. Capability diagnostics
distinguish this from the Windows capture-adapter limitation.

macOS also requires Apple's Swift compiler through `xcrun` for process
ownership inspection. REA compiles its packaged, narrow process-inspection
helper into a private temporary directory before a capture or owned provider
process starts; the same prerequisite applies to owned provider-process
supervision on macOS. REA removes that directory when it exits. REA does not
install Xcode, Command Line Tools, or other software. Capability checks prepare
this helper before reporting macOS capture as available.

Stopping process sampling or cancelling an ownership query waits for its issued
inspection command to exit. Closing a macOS ownership reader rejects new queries
and waits for admitted helper commands before removing their executable directory.

## Capture a command

For a small first capture, save this as `scenario.json`:

```json
{
  "executable": "node",
  "arguments": ["-e", "console.log('ready')"],
  "timeout_ms": 5000
}
```

Run the scenario through the CLI:

```sh
rea capture-process ./scenario.json --json > capture.json
```

`--json` is required when saving input for JSON consumers; the default terminal
format is TOON. The file contains the complete capture Evidence record.
Choose an output file distinct from the scenario input: shell redirection opens
and truncates the output before REA reads the scenario.

Read the result's terminal observations, exit/settlement status, and cleanup
outcome. [Scenario and result details](#scenario-and-result-details) describe
limits, normalization, filesystem coverage, and incomplete observations.

## Compare two captures

Compare saved capture Evidence with:

```sh
rea compare-process-captures authority.json reconstruction.json
```

The comparison checks terminal, interaction, exit, filesystem, and
process observations under a shared comparison contract. It reports observed
differences with their locations, while residual unknowns or truncated
observations prevent a complete-equivalence claim. Matching scenario
commitments do not reveal whether redacted sensitive inputs were equal.

For scenarios where independent scheduling can change event order, the CLI
also accepts an optional trace-specification JSON file as the third argument.
That specification must state the exact events and ordering constraints to
accept; it does not discard unmatched observations or make timestamps into
causal evidence. Trace comparison returns `unknown` when a capture lacks the
required complete event journal or contains relevant residual unknowns.

Each capture carries commitments for the selected scenario, executable,
comparison contract, and normalization rules. The comparison contract covers
the working directory, explicit environment, filesystem observation paths,
terminal size, scripted events, timeouts, limits, and normalization; the
executable and its arguments may differ. Comparison rejects captures whose
comparison contracts differ and names the differing fields, so run both
scenarios from the same absolute working directory and observation paths.
Captures are local Evidence files; keep
their source artifacts and invocation context available when interpreting a
difference.

## Hash a report independently of terminal output

Select the producer's report directory and give `file_bytes` enough room for
the complete files you need, including other files in those roots. For example,
save this scenario and run `rea capture-process ./scenario.json --json > capture.json`:

```json
{
  "executable": "node",
  "arguments": [
    "-e",
    "const fs=require('node:fs');fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/final.json',JSON.stringify({status:'complete',data:'X'.repeat(131072)}));console.log('x'.repeat(8192));"
  ],
  "working_directory": ".",
  "filesystem_observation_paths": ["./reports"],
  "limits": { "output_bytes": 1024, "file_bytes": 262144 }
}
```

The report exceeds the terminal budget but fits the independent 256 KiB hash
budget. Its complete SHA-256 appears in `normalized_result.files_after` at
`root_0:final.json`; check `truncation_details.filesystem_after` for omissions
and actual bytes hashed. The verbose terminal output is truncated without
preventing the report digest. The same scenario object is the MCP
`capture_process_scenario` input. REA never returns a prefix hash as a full-file
digest: an insufficient remaining budget produces a null digest and an
explicit omission reason.

A digest binds the complete bytes observed at that checkpoint, not the
producer's notion of a finished report. A stable periodic or running report
can also have a complete digest. Choose the final file and verify the
producer's documented completion marker, exit outcome and settlement
observations before calling it final. `after_settlement` names a filesystem
checkpoint, not a guarantee that an application finished successfully or
that an unobserved writer will never change the file. REA checks opened-file
identity/state around hashing and reports observed changes or unavailable
files; cancellation stops the hash. If an external sealer produces a manifest,
keep its completion claims and digest separate from REA's checkpoint facts.

## Scenario and result details

### Progress

While the capture runs, REA writes live status to stderr as one JSON object per
line. Stdout stays the final Evidence document:

```json
{
  "rea_progress": {
    "phase": "running",
    "completed": 3,
    "total": null,
    "message": "elapsed_ms=1200 frames=1 samples=2 interactions=0",
    "sequence": 4
  }
}
```

`phase` is the observed lifecycle stage: `prepare`, `running`, `settling`, or
`cleanup`. `completed` counts collected terminal frames, process samples, and
interaction events. `total` stays null; REA does not invent a unit total or a
percentage. `message` reports elapsed time and those counts. The final line uses
`phase` `cleanup` and sets `terminal` to true. Its `message` also contains
`disposition=<value>` (`exited`, `timeout`, `idle_timeout`, `cancelled`, or `failed`)
and the `owned_process_group`, `terminal_renderer`, and `temporary_root` cleanup
states as `key=value` text. These values are not separate JSON fields. For
example, a completed capture can end with:

```json
{
  "rea_progress": {
    "phase": "cleanup",
    "completed": 0,
    "total": null,
    "message": "elapsed_ms=2180 frames=0 samples=0 interactions=0 disposition=exited owned_process_group=cleaned terminal_renderer=cleaned temporary_root=cleaned",
    "terminal": true,
    "sequence": 13
  }
}
```

Updates use the shared progress boundary and are limited to one intermediate line
per 100 ms; the terminal line is always emitted. If a receiver is slow,
intermediate observations are merged into the latest status, and stale live
observations are discarded before final cleanup status. Progress never copies
child output. Child output remains in the capture Evidence on stdout.

### Scenario with interactions

```json
{
  "executable": "node",
  "arguments": ["./signup.mjs"],
  "working_directory": ".",
  "environment": { "APP_MODE": "test" },
  "filesystem_observation_paths": ["./state"],
  "terminal": { "columns": 80, "rows": 24, "scrollback": 1000 },
  "events": [
    {
      "type": "input",
      "at_ms": 250,
      "data": "user@example.test\r",
      "sensitive": true
    },
    { "type": "resize", "at_ms": 500, "columns": 100, "rows": 30 },
    { "type": "signal", "at_ms": 1000, "signal": "SIGINT" }
  ],
  "timeout_ms": 30000,
  "idle_timeout_ms": 30000,
  "settle_ms": 100
}
```

`executable` is required. `arguments`, `working_directory`, `environment`,
`filesystem_observation_paths`, terminal settings, timed `events`, timeouts,
resource limits, and normalization settings have defaults; see
`processScenarioSchema` for the exact contract. Event times are milliseconds
from launch, must be ordered, and must fall within `timeout_ms`. Inputs marked
`sensitive` are sent to the process but persisted with empty `data`,
`sensitive: true`, and `input_bytes`. Exact nonempty CR/LF-separated input
literals are removed from retained terminal text, including cross-chunk and
VT-styled echoes. Rendering uses that redacted stream, so intermediate terminal
states and serialized state cannot restore removed bytes. Normalized text is
checked again. Encoded, transformed, or arbitrarily edited values are not a
secret-detection contract; their privacy remains unknown. Unmarked inputs and
caller-selected environment values remain evidence.

The capture-local matcher admits at most 65,536 prefix states and 8,388,608
construction work units. Projection uses at most 32 MiB of reusable position
indexes and 67,108,864 work units across one capture. Capacity failures return a
non-retryable resource error and withhold terminal text in partial observations.
If output admission leaves gaps, the sensitive capture withholds retained
terminal text rather than interpreting separated fragments as a complete stream.
`raw_terminal.redacted_bytes` reports bytes removed from admitted original
chunks; these bytes still consume `output_bytes` alongside retained safe bytes.
Private display effects remain unknown, with frame order and provenance retained.

This changes the sensitive-input Evidence representation: consumers of the old
`<redacted-input:N-bytes>` placeholder must read `input_bytes` instead. Existing
saved captures remain readable and are not rewritten; old files may still
contain previously echoed input. A private-input comparison policy version
separates old and new captures; reacquire both sides for comparable observations.
Environment overrides are recorded in the scenario commitment; inherited
values are not copied into Evidence.

A bare executable name uses the scenario's `PATH` override, then the inherited
`PATH`. When neither supplies `PATH`, lookup uses `/usr/bin:/bin`, matching
[Node's Unix default](https://nodejs.org/api/child_process.html#child-process).
An explicitly empty `PATH` searches only the working directory. Executable,
working-directory, and observation paths preserve native `symlink/..` traversal.

Terminal width must be at least two columns: the pinned xterm renderer cannot
represent a one-column screen. This applies to the initial size and every resize.
Terminal dimensions must also satisfy `columns × (rows + scrollback) ≤ 1,000,000`.
Every scheduled resize uses the same selected scrollback and must fit this
working-buffer budget. REA rejects oversized scenarios before launching the
command; it never clamps the requested dimensions. This limit is independent
of `limits.output_bytes`, which bounds retained terminal observations.

The capture contains raw PTY output chunks and rendered terminal states,
interaction dispatch outcomes, exit reason, sampled process-tree observations,
and settlement status. When filesystem paths are selected, REA records
`files_before` and `files_after`, then classifies observed entries as created,
deleted, modified, or unchanged. These are bounded snapshots, not a syscall
trace; short-lived changes between snapshots may be missed. With no selected
paths, filesystem effects remain unknown.

A missing entry proves creation or deletion only when the corresponding
observation root's path enumeration was exhausted. Otherwise its effect has
`status: "unknown"`, the available before/after state, and a reason; a null
state in this variant means unobserved. Paths below symlinks that REA did not
follow also remain unknown. Each observed symlink records a
`symlink_not_followed` enumeration omission with a null system code, including
a stable selected root. The link's own metadata can remain unchanged while
descendant coverage and filesystem comparison remain unknown. Physical
parent-directory enumeration still proves unrelated sibling absence.
Partial enumeration of one root does not erase
known effects in another, and unavailable content hashes do not by themselves
make path absence unknown.

Filesystem coverage records `unobserved_subtrees` separately from metadata
enumeration. `symlink_not_followed` identifies a link whose own metadata was
observed while its descendants were outside the snapshot. `observer_owned`
identifies the exact directory allocated for this capture's bookkeeping; it
is created before the baseline and excluded from both snapshots and file-entry
capacity. Target activity inside that excluded directory remains unobserved.
Matching filenames elsewhere are included normally. Historical captures that
omit subtree facts do not establish descendant absence under that scope.

When a follow-up read fails after an entry's metadata was observed, the
snapshot keeps unaffected observations and records an `entry_unavailable`
enumeration omission with the root-aliased path and system error code.
Successfully observed identity replacements use `identity_changed` with a null
system code. Unstable symlink targets are omitted; already observed directory
metadata remains available. The affected root stays incomplete, so omitted
entries do not prove deletion. A path missing at its initial lookup remains an
observed absence.

Before launch, a selected root below a non-directory, or one whose lookup is
denied or otherwise unavailable, fails capture. After admission, a root or descendant lookup that
reports a missing path or a non-directory ancestor is an observed absence. A
denied or otherwise unavailable lookup records an `entry_unavailable` omission
for that path instead, and its root stays incomplete. Cancellation and
unexpected I/O failures still stop capture.

An initial selected-root permission denial returns `access_denied` with the
selected path, native `EACCES` or `EPERM`, and filesystem-read recovery. Capture
does not launch the target. Earlier snapshot facts and the denied root's
omission remain in the partial observation; unresolved read cleanup retains its
own classification until its exact resources are released.

Terminal frame `data` is the comparison text after the selected normalization.
New captures also preserve `raw_data` when normalization changes a PTY chunk;
otherwise `data` is already that text. For sensitive captures, both fields
contain only the safe projection; no unredacted backup is retained. Older captures may lack the
original text for changed chunks. Both values participate in Evidence identity,
while comparisons and trace assertions use the normalized text. Retaining the
original adds at most `limits.output_bytes` of text, because it comes from the
same admitted PTY chunks rather than a second unbounded stream.

When PID normalization is enabled, the root and identifiers in retained process
samples use the same identity set in terminal text and sampled commands. Raw
PTY chunks emitted before a child was sampled are projected again from their
retained source after sampling stops; custom patterns still run after PID
replacement. Earlier declared normalization omissions remain explicit; omitted
chunks are not reconstructed. Numbers not in that observed set remain literal.
Captures commit
`pid_normalization_version: "sampled-identifiers-v2"`, so older root-only terminal
normalization is not silently compared as equivalent.

Headless rendering runs once at terminal finalization from the already retained,
byte-bounded PTY chunks, preserving their elapsed times and resize order. Parsing
latency therefore occurs during finalization; rendered journal entries record
that derived observation. A corrected raw-text projection that exceeds
`limits.output_bytes` returns a typed capacity failure with collected facts in
partial observations. No additional raw-screen copy or replay is retained.

Before failure cleanup renders retained observations, REA cancels scheduled
interactions, waits for sampling to stop, and stops the owned process group.
The terminal finalizer then freezes PTY input, retains normalized and rendered
facts, and releases the renderer. Cleanup retry reuses those completed facts.
All new captures commit
`terminal_observation_version: "deferred-rendered-journal-v1"`, including when
PID and port normalization are disabled. Historical Evidence remains readable;
recapture both sides with the same observation version before comparison.

When path normalization is enabled, aliases apply to selected path identities
at clear text delimiters. A selected executable path does not alias a longer
sibling filename such as `tool-helper`; selected parent directories still
normalize within descendant paths, including when the working directory or an
observation path is spelled with a trailing `/` or `/.`. A selected filesystem
root `/` also aliases descendant paths, without rewriting URL separators or
HTML closing tags. The comparison contract
records these rules as `path-component-boundaries-v3`, so captures made with the
earlier rules cannot be compared as if the text had the same meaning.

Rendered frame `lines` hold the visible rows after normalization, with trailing
U+0020 spaces removed. Blank rows and internal spaces remain. `columns` records
terminal cell width; normalization and Unicode can make string lengths differ
from that width. `serialized_state` holds terminal serialization after the
selected normalization. Original admitted PTY chunks are available through
`raw_data ?? data`, as described above. Captures commit this line format in their
comparison contract, so a capture whose lines were padded to full width does not
compare as the same contract.

Custom `normalization.patterns` replace literal text with the caller's literal
replacement, including dollar sequences such as `$&` and `$$`. An empty pattern
also matches the first and last string positions. Captures with custom patterns
commit `pattern_normalization_version: "literal-replacements-v1"`. Legacy captures
remain readable. Cross-version comparison is rejected; capture both sides with
the same replacement semantics. Captures without custom patterns keep their
existing comparison contract.

Port normalization recognizes explicit `port`, `tcp_port`, `udp_port`, and
`listen` fields, URL authorities, IP endpoints, and `localhost` endpoints, with
ports from 0 through 65535. A port may end a sentence, as in `port: 8080.`;
a period followed by a letter or digit continues a decimal, version, or host
name instead. Each PTY chunk is normalized on its own, so a port whose period
ends the chunk is left unchanged because its continuation is not yet known. It preserves ordinary counters, dimensions, file line numbers,
and ambiguous bare host labels. Use explicit literal `patterns`
for a different application-specific spelling. Set `ports: false` to preserve
all endpoint numbers in comparison text. Captures commit the port-normalization
version so older broad numeric normalization cannot silently compare as the
same contract.

Output retention, file count, aggregate file-hashing bytes, process sampling, filesystem depth, total
runtime, idle time, and post-exit settlement are bounded by the scenario's
limits. The result marks truncated observations and residual unknowns rather
than treating missing data as proof of equivalence. Cancellation and timeout
run the same owned-process cleanup path. Settlement reports whether the
sampled process group quiesced or whether cleanup was needed or unverifiable;
sampling cannot prove that every short-lived or detached descendant was seen.

### Finalization interval

By default a deadline sends `SIGKILL` at once. Set `finalization_ms` to give the
target time to finish: when `timeout_ms` or `idle_timeout_ms` fires, REA sends
`SIGTERM`, keeps capturing output and selected files, and sends `SIGKILL` once
if the interval ends first. Cancellation is not delayed: it sends `SIGKILL`
immediately, also during finalization, and ends the run as cancelled.

```json
{
  "executable": "node",
  "arguments": ["./job.mjs"],
  "filesystem_observation_paths": ["./reports"],
  "timeout_ms": 30000,
  "finalization_ms": 1500
}
```

REA binds the captured root's first start identity to its ownership token,
checking the identity before and after reading that token. A missing or
mismatched token, or an identity change during validation, leaves the identity
unverified rather than adopting a replacement process. Both finalization
signals recheck that retained identity immediately before the call; the check
and signal remain separate operating-system operations. REA does not fall back
to a bare PID kill for either finalization signal; failed identity or ownership
validation is recorded as `unverified` with its reason. Cancellation before any
deadline keeps the existing terminal kill. Descendants are not signalled during
finalization; owned-process cleanup handles them afterwards.

For an `exited` capture, `exit.code` is the target's normal exit code. It is
`null` when the target ended on a signal, such as one sent by a scenario
`signal` event, and the observed signal stays in `exit.signal`.

`exit.reason` keeps the initiating deadline (`timeout` or `idle_timeout`).
`exit.code` is `null` for every deadline exit; the code of an exit observed
during finalization is `exit.finalization.exit_code`, and the observed signal
stays in `exit.signal`. `exit.finalization` records what was observed and is
absent when no finalization was attempted:

```json
{
  "code": null,
  "signal": 0,
  "reason": "timeout",
  "finalization": {
    "requested_ms": 1500,
    "elapsed_ms": 12,
    "exit_code": 0,
    "signals": [
      { "signal": "SIGTERM", "sent_at_ms": 0, "delivery": "signaled" }
    ]
  }
}
```

- `signals` lists each attempt in order: `SIGTERM` first, at most one `SIGKILL`.
  `sent_at_ms` is the attempt time on a monotonic clock, relative to the start of
  finalization, also for an attempt that could not be delivered.
- `delivery` is `signaled` (the identity matched and the signal call returned),
  `gone` (no live process matched), `identity-changed` (the PID now belongs to a
  different process, which was not signalled) or `unverified` (the identity could
  not be established or the call failed). None of them proves the process
  exited.
  An `unverified` attempt may carry a `reason` string naming why: an unavailable
  identity and its reason, an inspection or signal error, or delivery that did
  not settle within the bound (1000 ms). An attempt recorded `unverified` after
  that bound can still complete later; it stays identity-checked, and its late
  result is not added to the record.
- `elapsed_ms` is when REA observed the exit, relative to the start of
  finalization, or `null` when no exit was observed. The PTY layer can deliver the
  exit slightly after the operating system ended the process.
- `exit_code` is the code the PTY reported when the exit was observed during
  finalization and was not caused by a signal (`exit.signal` is `0`); a
  finalizer that exits with `3` records `3`, one that exits cleanly records `0`.
  It is `null` when no exit was observed or the target ended on a signal, and it
  is never inferred. A target that exited on its own near the deadline is
  recorded the same way.
- The observed signal stays in `exit.signal`; `exit.code` is `null` for every
  deadline exit. The record does not attribute an exit to a particular signal,
  and a `SIGKILL` from a scenario event next to the escalation cannot be told
  apart from it.
- If the `SIGKILL` cannot be delivered, REA stops waiting for an exit, keeps every
  observation collected so far with the delivery results, and releases the run
  through owned-process cleanup.
- The `SIGKILL` is not sequenced after the `SIGTERM` delivery result: the two
  deliveries are independent, because cancellation must not wait for a slow
  identity check.

`timeout_ms + finalization_ms + settle_ms` must stay at or below
`Number.MAX_SAFE_INTEGER` (9007199254740991), the largest total exactly
representable as a JavaScript number; the scenario is rejected otherwise. This is
a representability limit, not a timer limit. The nominal lifecycle budget is that
sum; polling, snapshotting and cleanup lie outside it. Scenario `events` keep
being dispatched during finalization and are recorded as usual. `finalization_ms`
of `0`, the default, keeps today's behaviour and the committed identity of every
existing scenario. `elapsed_ms` and `sent_at_ms` are timing data and take part in
exit comparison like `settlement.elapsed_ms`.

Every capture requires `truncation_details`, with separate accounting for:

- `raw_terminal`: original UTF-8 PTY chunk bytes and observed/retained chunk
  counts. A chunk that does not fit either its remaining original-text budget
  or normalized-text budget is omitted whole; a later smaller chunk can still
  fit. A normalized-text omission also omits its original chunk, so raw and
  normalized coverage can both be incomplete for that event.
- `normalized_terminal`: normalized comparison-text bytes retained from raw
  chunks. This is optional when reading historical captures. A raw-fitting
  chunk is omitted if an ordered normalization stage would exceed the remaining
  `output_bytes` budget before the final normalized size is known. Its final
  size is unknown, not assumed to equal the budget. The capture records the
  omitted-frame count and a limitation; later smaller chunks remain eligible.
- `rendered_terminal`: cumulative UTF-8 serialized-state and visible-line
  bytes, plus observed/retained frame counts. This is independent of the raw
  chunk budget and does not count JSON encoding. Repeated screen snapshots can
  exhaust it even when all raw output fits. Rendered states use retained PTY
  input, so raw omissions also limit rendered coverage. `unknown_size_frames`
  counts frames whose complete size was not calculated; it does not by itself
  identify normalization as the cause. `normalization_over_budget_frames`
  counts the subset of unknown-size frames stopped by an ordered normalization
  stage; it cannot exceed `unknown_size_frames`.
  `observed_bytes` includes only rendered frame sizes determined exactly.
- `filesystem_before` and `filesystem_after`: file-count/depth limits,
  enumeration failures, whole-file hash budget and bytes successfully hashed.
  Directory names are read incrementally within the remaining entry capacity.
  When a directory exceeds that capacity, the retained subset follows filesystem
  enumeration order and is then sorted; it is explicitly incomplete and cannot
  establish that an omitted path is absent.
  An unreadable directory is recorded in `enumeration_omissions` with its
  root-aliased path and operating-system error code. Entries observed before
  that directory remain available, while descendants beneath it stay unknown.
  A basename that is not valid UTF-8 is never looked up through replacement
  characters. It consumes entry capacity and records an `unrepresentable_name`
  omission at its containing directory, with exact basename bytes in
  `raw_name_hex` and a null `system_code`. That root's enumeration remains
  incomplete, so missing paths beneath it remain unknown.
  Each retained regular file without a digest has an aliased path, size,
  remaining budget and reason: `file_bytes_budget`,
  `file_changed_or_short_read`, or `file_unavailable`. Its `system_code` is
  null unless an OS file operation failed, in which case it preserves the
  reported error code. A file too large for the remaining budget is
  skipped; a later smaller file can still be hashed. Hash omissions do not
  imply incomplete path enumeration.
- `process`: sampling limit and whether sampling ended partially. Coverage
  remains `sampled`, including when that limit was not exhausted.
  `sampling_failures` counts failed read observations plus at most one
  unfinished pass interrupted by sampler shutdown. `first_sampling_failure`
  retains the first attributed read diagnostic, with shutdown context appended
  when applicable; interruption alone has an explicit shutdown diagnostic.
  Denied or failed procfs reads mark
  sampling partial while preserving readable process rows and thread children;
  a process with unreadable identity is not attributed. Expected process-exit
  races are separate from failed observations. A native token reader's confirmed
  process absence during initialization is an expected exit; token-read denial
  and unavailable snapshots still count as failed observations. Shutdown counts only when it
  interrupts a read or leaves traversal unfinished; a completed pass does not
  become partial merely because the sampler stops. Completed rows
  remain available and issued reads settle before final coverage is returned.

The aggregate `truncated` flag summarizes these observations. Comparisons retain
results for unaffected dimensions and mark affected dimensions unknown; an
incomplete capture cannot locate the first divergence across all dimensions.
Trace assertions use coverage for the sources they select, so an assertion
about complete raw terminal output need not fail because rendered snapshots
were omitted. A trace difference applies to the dimensions identified by its
diagnostic; unrelated dimensions retain their own comparison, including unknown
coverage. A finite-variant omission stays nonconforming to that variant, but does
not mark a shared successor changed merely because its journal position shifted.
Observed ordering violations remain changes. When a requested trace differs or
its journal is unavailable and per-source values cannot locate the difference,
`first_divergence` is unknown rather than evidence that no divergence occurred. Captures missing `truncation_details` are rejected on import;
preserve them as historical files and recapture for current comparisons.
`limits.file_bytes` is already the cumulative whole-file hashing budget,
independent of `limits.output_bytes`, which bounds retained terminal content.
Each filesystem checkpoint starts with a fresh `file_bytes` budget across all
selected roots; it is not a per-file allowance. File contents are read in
64 KiB chunks for hashing and are not embedded in capture Evidence.

Ownership inspections bind run-token reads to native start identities and retain
related generations through reparenting, group changes, omitted rows, and cleanup
retries. A host without native identity reads still token-checks process-table
rows that appear only in a launcher-exit refresh before reporting that group
clean or publishing an empty lineage. A matching token authorizes a signal only
for a group whose leader carries the same token. A matching token whose leader
is absent, or an unreadable token for a still-live new row, stays unresolved. A
readable foreign token is not signaled. An unreadable row that has exited by
the confirmation read does not hide a new row in that confirmation table, and a
group proven while revalidating another owned group is signaled in the same
cleanup. A matched row that changes parent or group on the confirmation read
is token-checked again. A PID whose token was already read is read again
on the next confirmation even when its parent and group return to the
pre-exit values. A PID whose first token was foreign is read again
on that table, because the PID alone does not identify the process. A PID
from the pre-exit table is read again when its parent or group changes, and
an unchanged pre-existing row that was never token-read stays unread. Lineage
publishes one row for each PID. Confirmation reads are bounded; a table that keeps producing unreadable
replacements stays unresolved. That refresh does not retain a ledger
for a later attempt that never observes the launcher. Lineage reads a row again
when its parent, group, or launcher-tree membership changes, and it reads a
token again on the next refresh even when those fields are unchanged. The
launcher is read on every lineage refresh; a missing, unowned, or
relation-changed launcher PID is not published as a verified lineage. A
descendant absent from the latest refresh is omitted. An
ancestor move cannot leave a foreign descendant inside a verified result. A
group that reappears after cleanup already processed it is revalidated once;
another appearance stays unresolved. The captured run keeps
one evidence owner through settlement and cleanup.
An absent or changed token leaves a previously related generation unresolved;
current token proof is still required before signaling. Swept cleanup verifies the
remaining family after its group signals. Coverage is bounded by the native
snapshots and generations inspected; sampled group IDs select candidates.

When the host withholds an unrelated process's ownership token, REA leaves that
process untouched and records its PID and reason in `cleanup.unverified_processes`
and process residual unknowns. Successful cleanup verifies the owned group;
it does not attribute those unrelated processes. Related or otherwise unexplained
unreadable processes still prevent successful cleanup.

Failed cleanup retains its exact resources for the owning session to retry.
The CLI retries before projecting its error; MCP retries pending cleanup before
admitting another capture and during session cleanup. Once every attributed
owner confirms release, the live error status clears `cleanup_incomplete`.
The original failure, observations and `cleanup_report` retain the facts from
the earlier attempt, including any cleanup failure recorded then.

Snapshot file handles, directory handles, and the selected executable reader
follow the same ownership rule. A failed close preserves completed observations
and any primary read failure; it cannot turn a completed digest into a successful
capture with unresolved cleanup. Interrupted snapshots retain examined entries
with incomplete coverage in `partial_observation`, alongside the failure.
File-handle retry uses the exact retained owner. After a directory close rejects,
Node does not expose enough handle validity to authorize another native close;
REA retains that unresolved owner and blocks further captures in the session.

On macOS, changing a Node process's `process.title` can make its run token
unreadable. Node documents that [setting the title overwrites argv memory](https://nodejs.org/download/release/v24.18.0/docs/api/process.html#processtitle).
With the pinned toolchain, a live child retained a readable start identity
while its token became unavailable after this change; npm changes its title
as well. A newly started unreadable process can prevent verified cleanup even
after the selected command exits. REA preserves this uncertainty and leaves
that process untouched.

Reading those tokens requires compiling a small Swift helper with `xcrun swiftc`.
By default that compilation reuses Swift's shared module cache, while the
compiler's intermediate objects stay inside the per-run temporary root that REA
removes afterwards. Set `REA_DARWIN_MODULE_CACHE_PATH` to a writable directory
when a shared cache is unavailable, for example under an enforced write
boundary. REA creates the directory, passes it to the compiler as
`-module-cache-path`, and exports it as `CLANG_MODULE_CACHE_PATH` so the
Objective-C header modules the helper builds land there too. REA never removes
that directory: it outlives each run, so the first compilation into a new
directory pays a cold-cache build and later runs reuse it. An absent or empty
value keeps the shared default.

`xcrun` also maintains a separate tool-lookup cache. Its `--no-cache` option
refreshes entries and does not guarantee a write-free lookup. To avoid that
lookup while compiling REA's helper, set `REA_DARWIN_SWIFTC_PATH` to the absolute
path of an installed `swiftc` and `SDKROOT` to the absolute path of a compatible
macOS SDK. REA invokes that compiler directly with `-sdk` and the selected SDK;
an unset or empty compiler setting keeps the normal `xcrun swiftc` path. A
missing or relative SDK/compiler path fails with an actionable prerequisite
error before compilation. An incompatible installation reports the compiler's
bounded diagnostics; REA does not repair or replace the toolchain.

The compile deadline is `REA_SWIFTC_COMPILE_TIMEOUT_MS`. An omitted value is
120,000 ms, and accepted values are integers from 1 to 2,147,483,647. REA reads
the variable from the environment that starts the process and keeps that
deadline for every helper compile in that process. Restart REA to apply a
change; the next ownership-helper compile uses the new value. A timeout names
the effective milliseconds. Invalid values fail configuration validation at
startup. Embedded compiler diagnostics are cut at 512 bytes, and this release
has no runtime override for that excerpt.

For example, select paths from your existing Xcode or Command Line Tools
installation **before** entering an enforced write boundary:

```sh
export REA_DARWIN_SWIFTC_PATH="$(xcrun --find swiftc)"
export SDKROOT="$(xcrun --show-sdk-path)"
export REA_DARWIN_MODULE_CACHE_PATH="$PWD/rea-cache/modules"
export TMPDIR="$PWD/rea-cache/tmp"
mkdir -p "$TMPDIR"
rea analyze-javascript-application ./fixture --artifact-format directory
```

Keep the selected compiler and SDK paired. Permit REA's evidence/output paths
and its temporary directory as well as the caller-owned module cache. REA does
not create a sandbox or claim that these settings contain every write made by
arbitrary toolchains or analysis providers. They bypass REA's `xcrun` lookup
and select the helper's Swift/Clang cache without disabling ownership checks.
The caller-owned cache survives cancellation and cleanup; per-run compiler
intermediates and the compiled helper remain REA-owned temporary files.

The boundary must also permit process-table inspection. On macOS, `/bin/ps`
is setuid and a blanket sandbox may reject its launch with `spawn EPERM`.
REA then preserves ownership uncertainty and can report `cleanup_incomplete`;
it does not disable verification to continue. A sandbox that explicitly allows
this read-only process inspector is a separate prerequisite from the compiler
and cache settings.

Symlink observations preserve their stored target bytes in `symlink_target_hex`
(lowercase hexadecimal). `symlink_target` retains valid UTF-8 text and is `null`
when the target bytes cannot be decoded as UTF-8. Filesystem effects compare
these exact bytes without resolving the link. Older captures without the hex
field still parse; a legacy target containing U+FFFD has ambiguous byte identity,
so matching target text alone produces an `unknown` effect. Symlink descendants
remain outside filesystem observation regardless of target encoding.

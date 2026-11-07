# Reverse-engineering tool integrations

REA can call caller-supplied GNU objdump, GDB, and Rizin installations. REA does not install or update these tools. Static objdump/Rizin workflows use the same services from CLI and MCP. GDB's persistent MCP sessions and ephemeral CLI command are available only on Linux. Persistent debugger sessions exist only for the lifetime of the REA MCP server process.

In a shared MCP server, unrestricted Rizin and Cutter commands, GDB console
commands, Rizin debugger start/close, and GDB debugger close retire any active
binary analysis session after the operation. This prevents a fresh analysis
provider from being rebound automatically while command effects may still be
writing. After the command and any background writers have stopped, call
`open_binary` explicitly before continuing analysis. A successful command
response alone does not prove that background writers have stopped. An active
Ghidra analysis session must be closed explicitly before an external mutation
can run.

## GNU objdump

`inspect_with_objdump` and `rea inspect-with-objdump` capture stdout and stderr as inline Evidence. Artifact inspection Evidence records SHA-256 digests before and after the provider call and whether those observed digests differ; this cannot prove the exact bytes consumed if the artifact changes during execution. Choose one artifact operation: `file_headers`, `section_headers`, `symbols`, `relocations`, `dwarf`, `disassemble`, or `disassemble_all`. `disassemble` maps to `-d`; `disassemble_all` maps to `-D` and has different symbol-boundary semantics. The pathless `inspect_with_objdump {"operation":"architectures"}` MCP call or `rea list-objdump-architectures` CLI command maps to `-i` and produces subjectless provider-capability Evidence describing BFD targets compiled into the installed binary, not a guarantee that a target is supported.

Failure to launch the selected executable reports provider unavailability, the
configured command and the host error under `boundary: "provider-launch"`.
Recovery concerns `REA_OBJDUMP_COMMAND`, PATH and execution permission, including
for target-free architecture listing. Artifact admission keeps separate input
and filesystem-read diagnostics. Invalid operation/selector combinations retain
their rejected fields in input issues before artifact reads or provider launch.

For DWARF, REA does not follow local debug links by default. Set `follow_debug_links` to `true` to pass `-WK`; external debug-file identities are not bound to Evidence when following links is enabled. The CLI flag is `--follow-debug-links`; `--no-follow-debug-links` or `--follow-debug-links=false` keeps the default. A separate `true` or `false` word after the flag is not its value. REA clears `DEBUGINFOD_URLS` in the objdump child environment to disable debuginfod network access on GNU binutils versions that do not support `-WE`. The complete raw output is authoritative; REA does not normalize it into a version-independent disassembly schema.

For a known native symbol, use `operation: "disassemble", symbol: "my_function"` in MCP or `--symbol my_function` in CLI. REA passes `--disassemble=my_function` to objdump before collecting output, rather than producing the whole disassembly and filtering it afterward. Omit `symbol` to keep full code-section disassembly. Other operations reject this selector. Use a nonempty, NUL-free name with well-formed Unicode; unsupported values are rejected before reading the artifact or starting objdump. Symbol names are passed unchanged; matching, versioned symbols, aliases and the end of the disassembly follow the installed GNU objdump's semantics. Evidence records the selector and actual arguments. An empty match does not establish artifact-wide absence, and the selected observation does not contain the omitted disassembly; request the complete operation when needed.

```sh
rea inspect-with-objdump ./program disassemble
rea inspect-with-objdump ./program disassemble --symbol my_function
rea inspect-with-objdump ./program dwarf
rea inspect-with-objdump ./program dwarf --follow-debug-links
```

Captured stdout and stderr are retained up to a 16 MiB combined limit; `output_truncated` marks output beyond that limit. That cap has no runtime override.

`inspect_with_objdump`, `rea list-objdump-architectures`, and one-shot `execute_rizin_command` accept `command_timeout_ms` (CLI: `--command-timeout-ms`). Omitted means 120000. The integer range is 1 to 2147483647. Target preflight shares one budget across stat and digest. The one-shot command receives that budget again. It applies on the next call; no restart is required. It does not raise the 16 MiB cap, a Ghidra or Hopper startup deadline, or a debugger session deadline.

## GDB

Persistent GDB sessions, including the MCP workflow and one-shot `rea debug-with-gdb` CLI, are available only on Linux. REA verifies a live inferior's output descriptors through `/proc` before detaching it; it does not claim equivalent descriptor verification on macOS. Windows is also unsupported because owned Job Object cleanup can terminate debugger inferiors. On supported Linux hosts, `start_gdb_session`, `gdb_console`, `gdb_session_status`, and `close_gdb_session` manage a persistent GDB/MI session in MCP. The one-shot CLI requires a caller-selected durable TTY: `rea debug-with-gdb --inferior-tty /dev/pts/7 'file ./program'`. The TTY must remain available after GDB exits so a detached inferior can continue writing. MCP starts GDB with `--nx --quiet --interpreter=mi3`, retries initialization with MI2 if MI3 initialization returns an error and cleanup succeeds, waits for its prompt, and disables auto-loading. Pass optional `inferior_tty` to select the terminal that future inferior runs use; REA configures it before the session becomes ready and checks the exact value with GDB/MI. `gdb_session_status` reports the selected path, whether REA still considers the configuration verified, and whether invalid UTF-8 has been observed in MI bytes (`mi_invalid_utf8`) or stderr (`stderr_invalid_utf8`). Commands that can change the inferior TTY or redirect a run revoke that verification permanently for the session, so close retains GDB ownership if a live inferior remains. The complete built-in inspections `show inferior-tty` and `help inferior-tty` preserve verification; compound commands still use the conservative mutation checks. Closing a session with one live inferior and a verified TTY automatically detaches the target, which can resume execution; MCP clients receive destructive-operation annotations for this behavior. The console remains unrestricted and can run shell commands, change target state, access files, and use network in the REA process user's security context. Raw MI records and console/target/log streams are returned with Evidence; command output is retained up to 16 MiB and explicitly marked when truncated. GDB startup waits 10000 ms and each MI command waits 120000 ms. This release has no runtime override for those deadlines, the 16 MiB command output budget, session capacity, or the pending-command queue. `command_timeout_ms` does not change them.

With multiple live inferiors, or a live inferior without a verified TTY, manual
close requests an explicit disposition and keeps the session ready. Use
`gdb_console` to select and explicitly detach or terminate each remaining
inferior, then retry `close_gdb_session`. After owned cleanup has started,
console commands remain unavailable while that cleanup can be retried.

`completion_status` describes completion of the selected console command, not
termination of its inferior. After a `^running` result, REA queues a read-only
`-gdb-show mi-async` query and waits for its tokenized reply before releasing the
command's output collector. The ordered `records` include that query reply;
`mi` retains the console command's result. If raw shell stdout joins that
result without a newline, REA preserves the combined bytes as one raw record
and uses a fresh read-only query after GDB's prompt to establish completion.
It does not guess a result token inside caller output: `mi` is empty and the
original result class remains unknown. An inferior `*stopped` event or an
early compatibility prompt does not establish that an outer command file has
finished. See GDB's [MI output syntax](https://sourceware.org/gdb/current/onlinedocs/gdb.html/GDB_002fMI-Output-Syntax.html)
and [command-file semantics](https://sourceware.org/gdb/current/onlinedocs/gdb.html/Command-Files.html).

Before a normal close, REA checks for live GDB thread groups. If one remains and a durable `inferior_tty` is verified, REA asks GDB to detach it and confirms the detach before stopping the debugger. Without that sink, select and apply a disposition to each inferior through `gdb_console` (for example, detach or kill as appropriate), then retry close. REA never infers target ownership from a PID or path. When the MCP server shuts down, REA terminates only its directly owned GDB process after confirming no inferior or a sink-backed detach; otherwise it retains the process and its output streams for retry.

```text
start_gdb_session {"inferior_tty":"/dev/pts/7"}
gdb_console {"session_id":"…","command":"file ./program"}
gdb_console {"session_id":"…","command":"info files"}
gdb_session_status {"session_id":"…"}
close_gdb_session {"session_id":"…"}
```

## Rizin

`start_rizin_debug_session` and `rea debug-with-rizin` require an explicit `inferior_tty` on Linux. Rizin launches the target with stdout and stderr routed to that caller-selected TTY and `dbg.exitkills=false`; the target can therefore continue running and writing to the TTY after REA closes the debugger. This is a visible target output effect, and the caller is responsible for selecting a suitable terminal that remains available. Before closing, REA serializes after the active command, parses the structured `olj` descriptor list, detaches only a unique `ptrace://` descriptor, confirms its absence, reads back `dbg.exitkills=false`, and verifies `/proc/<pid>/fd/1` and `/proc/<pid>/fd/2` still identify the selected TTY by device and inode. If a previously identified inferior exits after Rizin confirms detach, REA verifies that the original process has ended instead of requiring output descriptors from an exited process. Unresolved identity or ambiguous readback keeps the Rizin session owned for retry. After output limits or a failed command interval, cleanup first waits up to 1000 ms for a fresh private NUL-delimited marker, discarding earlier frames before obtaining that new inferior readback. Synchronization never reopens user command admission. A missing marker, unavailable transport, or unknown inferior identity retains the cleanup owner. Caller cancellation keeps its exact reason and typed cancellation outcome even when cleanup remains incomplete; a successful retry resolves that retained cleanup state. Cancellation during final cleanup retains the captured observation and cleanup owner. An already observed startup or protocol failure remains primary and retains a later cancellation as a secondary failure; recovering the transport does not erase that original diagnosis. Persistent Rizin debugger sessions are unavailable outside Linux because this verification depends on `/proc`.

Persistent command Evidence retains the caller-selected and resolved startup paths in `parameters.launch_provenance`. These paths describe launch provenance, not the current target after unrestricted commands. `rizin_debug_session_status.output_invalid_utf8` reports whether lossy frame decoding has been observed during the session. Command Evidence sets `output_invalid_utf8` only when loss was observed in frames collected for that command, including retained partial output; earlier startup or command frames do not mark later valid output as lossy.

Session status retains up to 64 recent protocol frames. Each history entry keeps a complete-character UTF-8 prefix of at most 16 KiB, plus a truncation marker when needed; `recent_output_truncated` reports omitted history. This history budget also accounts for replacement characters from invalid UTF-8. It does not shorten command Evidence, which has its own 16 MiB output budget. Rizin debug startup waits 30000 ms and each command frame waits 120000 ms. This release has no runtime override for those deadlines, the 16777216 byte frame cap, the 16777216 byte command-output cap, the 4096 frame command cap, session capacity, or the pending-command queue. Evidence names the cap that stopped the command. The one-shot `command_timeout_ms` setting does not change a debug session.

```sh
rea debug-with-rizin --inferior-tty /dev/pts/7 ./program dr
```

`execute_rizin_command` and `rea execute-rizin-command` run one selected command against a local artifact. The one-shot profile uses `-N -q -e scr.color=0 -c`, suppressing user settings and scripts while leaving plugins available. Native terminal presentation defaults to plain text; the caller can explicitly enable colour with `e scr.color=1` in the selected command. REA preserves raw output, including literal ANSI bytes, and does not claim that command-specific JSON has one universal schema. Commands and plugins run with the REA process user's security context and may access files, the network, or perform other actions.

```sh
rea execute-rizin-command ./program iI
```

Captured stdout and stderr are retained up to a 16 MiB combined limit; `output_truncated` marks output beyond that limit. One-shot commands use the `command_timeout_ms` budget described above. That 16 MiB cap has no runtime override.

## Cutter bridge

Cutter commands use the local REA Python bridge and authenticated loopback messages.
Discovery reads the session descriptors that the plugin publishes in the bridge
directory. Set `REA_CUTTER_BRIDGE_DIR` in both REA's environment and the environment
that starts Cutter to select a custom directory. Both expand `~` and `~/` paths
against the current user's home, including `~\` paths on Windows. By default,
they use `%LOCALAPPDATA%\REA\CutterBridge` on Windows when `LOCALAPPDATA` is set,
and `~/.cache/rea/cutter-bridge` otherwise. The two processes must resolve the
same directory for discovery to find the published sessions.

The client and plugin must support the current v2 handshake; older peers are
rejected before dispatch because they cannot preserve cross-caller recovery proof.
The client checks the final encoded request against
`REA_BRIDGE_MAX_REQUEST_BYTES` before dispatch. The budget applies to request
payload bytes and excludes the terminating LF. Unset, the ceiling is 16777216
bytes (16 MiB). A decimal integer from 7464 to 536870887 is accepted. The floor
fits the largest bounded symbol-name command inside an authenticated Cutter
frame. A Cutter status keeps its session id, connection proof, and up to 64
completion receipts when the frame is tight. The observed `current_file` is
included when it fits. When it does not, the status reports that path as
unknown, and the client does not reuse the descriptor path with the new
generation. The maximum is one byte under Node's 536870888-character string ceiling
so the framing LF still fits. The ceiling counts the encoded payload. A JSON
escape is measured before serialization and is not divided into the maximum
again. A structured Cutter reply is admitted when that encoded payload fits,
including a dense array of numbers. Cutter hashes the HMAC prefix and the payload as separate updates, so
an exact-limit frame does not build one preimage string. The plugin measures and signs the response
from bounded JSON pieces, then writes the authenticated frame in 64 KiB chunks. The bridge searches only the newly read bytes for the framing LF. The client unescapes each socket chunk into one response string, checks the proof, and then parses that string. A fitting reply keeps
the original output and does not retain the paged wire frame plus another concatenated copy. Zero, negative, non-decimal, and out-of-range
values are `configuration_invalid` and do not fall back to the default. The
bridge accepts that full payload size and rejects a larger payload while
bounding the read. An incomplete frame is still `Incomplete bridge request
frame`. An oversized command does not retain a cleanup owner. Hopper uses the
same request payload budget. A Hopper request is serialized when it reaches
the bridge, so one waiting behind Hopper's serial bridge does not retain
another copy of the encoded frame. REA injects a caller-selected value into the
Hopper bootstrap and the bridge also reads the process environment; an injected
value wins. Cutter reads the environment that starts Cutter and publishes
`max_request_bytes` on its session descriptor. A Hopper or Cutter process
started out of band without the setting uses 16777216 bytes. The client
compares that advertisement with its own ceiling before a discovery status probe and before sending a command. A different ceiling is a mismatch only after the hello proves that descriptor is a live authenticated bridge; a stale descriptor is ignored. That hello does not send a status request. Discovery fails if any such live ceiling differs, even when another live session matches. A hello that
never sends its authenticated frame does not hold the bridge accept loop.
At most 8 connection threads run. A further accept is closed, and a failure to start a thread closes that socket without stopping the listener. A status `completed_connection` is the longest prefix of accepted connections that have terminated. It does not treat an earlier connection as finished because a later status reached the command lock first. Scalar values in one Cutter reply are encoded in bounded batches.
A command reply that does not fit keeps its completion state and document
generation, and reports an oversized path as unknown. Cutter response frames use this same ceiling and
also exclude the terminating LF. A command response the client discards because it exceeds that ceiling stays an unknown execution and sets `output_truncated`, so Evidence records the omitted output. Hopper response reads are unchanged.
Each bridge request waits 25000 ms. The Cutter hello frame still must arrive
within 1 second. The authenticated command frame is read with one second per
mebibyte of `REA_BRIDGE_MAX_REQUEST_BYTES`, and that read never waits longer
than the same 25000 ms. Discovery admits at most 256 descriptor
candidates and reads and probes at most eight concurrently. A larger directory
reports `bridge_directory_capacity_exceeded`. This release has no runtime
override for the 25000 ms request deadline or the 256-candidate discovery
budget. Those limits do not follow `REA_BRIDGE_MAX_REQUEST_BYTES`.

Terminal receipts are recovered before another command, including from a new CLI
invocation. A signed status response also confirms completion of older bridge
connections after its UI dispatch, preserving recovery proof for a caller whose
receipt another caller has acknowledged. Neither receipt recovery nor a status
probe retries the original command. Failed acknowledgements remain pending and
block new commands until they can be retried successfully. Status proof failures
identify `cutter_command` and retain `status` in
`details.diagnostics.auxiliary_operation`; malformed proof still blocks dispatch.
Descriptor failures likewise retain the requesting operation through cleanup.
If a completion-proof read fails while an earlier command is unresolved, retry
admission preserves both errors and their independently owned resources. Releasing
one owner does not settle the other, and the command is not replayed to recover proof.
Command admission reports typed cancellation and treats the caller's abort reason
as opaque metadata, without inferring cleanup ownership from it. A generation
mismatch is an input correction only when the authenticated reply confirms
`not_started`. Missing or ambiguous execution state retains the command's
completion uncertainty until terminal proof arrives, even if the reply names a
generation error.

## Configuration and coverage

The optional `REA_OBJDUMP_COMMAND`, `REA_GDB_COMMAND`, and `REA_RIZIN_COMMAND` values select executable names or paths; otherwise REA searches `PATH`. Values are passed directly to process spawning, not expanded as shell command lines. A host executable launch refusal preserves the selected command and host error code, with recovery through the corresponding command setting, PATH, or execute/search permissions. GDB does not retry that refusal with MI2; its MI2 fallback applies to protocol initialization failures. Provider versions and capabilities remain unknown until observed from the installed tool and verified in the corresponding real-provider lane.

Provider capture limits are separate from the MCP response budget. A result that fits the provider limit may still exceed the default 10 MiB MCP response budget and return a transport `resource_constraint`. Configure `REA_MCP_MAX_RESPONSE_BYTES` to match a larger client receive buffer when that client supports one; otherwise use retained Evidence/export or complete CLI JSON output. See [MCP response limits](./mcp-contracts.md#tool-results).

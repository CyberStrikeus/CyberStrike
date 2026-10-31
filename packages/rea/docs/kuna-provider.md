# Kuna provider

[Kuna](https://github.com/Noelo-Lab/kuna) is an Apache-2.0 decompiler distributed as one `kuna` executable. For a new installation, use Kuna 1.986, REA's recommended verified release. REA uses a `kuna` you supply; it does not download, install, update or bundle Kuna. REA accepts other releases, which it reports as unverified in `rea doctor` and in each analysis profile. The 1.986 real-provider checks ran on macOS arm64; Linux and other hosts have not been verified with that release.

Kuna is static: it reads the selected image and never executes it.

## Configure

```bash
export REA_KUNA_COMMAND=/absolute/path/to/kuna
rea doctor --provider kuna
```

Select it explicitly with `--provider kuna`, MCP's `open_binary.provider_id: "kuna"`, or `REA_ANALYSIS_PROVIDER=kuna`. With Kuna and another provider configured for the same target, `auto` reports `ambiguous` instead of choosing one.

Ordinary readiness cancellation returns `cancelled` (CLI SIGINT/SIGTERM exits
130/143); an earlier recorded timeout or physical failure keeps its diagnostic.
Completed version, hash and script observations remain in `kuna_installation`
with `status: "partial"` and `completed_hash` when available. Typed errors carry
this in `details.diagnostics`; doctor cleanup checks carry it in their `details`.
Omitted fields remain unobserved; availability remains unknown until readiness
completes. Cleanup retries keep both the observations and the exact file owner.

| Setting                       | Default                                                                                                                                 | Meaning                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REA_KUNA_COMMAND`            | none (required)                                                                                                                         | Absolute path of the `kuna` executable.                                                                                                                                                  |
| `REA_KUNA_CACHE_DIR`          | `~/Library/Caches/rea/kuna` (macOS), `$XDG_CACHE_HOME/rea/kuna` (Linux; `~/.cache/rea/kuna` when `XDG_CACHE_HOME` is unset or relative) | Absolute directory REA owns for project exports. Kuna's own spec cache also lives here, not in your Kuna cache.                                                                          |
| `REA_KUNA_CACHE_MAX_BYTES`    | 4 GiB                                                                                                                                   | Size cap; least recently used exports are evicted above it.                                                                                                                              |
| `REA_KUNA_PROJECT_TIMEOUT_MS` | 30 minutes                                                                                                                              | Deadline for whole-program inventory/export, reference and string scans.                                                                                                                 |
| `REA_KUNA_TIMEOUT_MS`         | 120 s                                                                                                                                   | Deadline for one single-function decompile, and for the inventory run REA makes when the export ends without one.                                                                        |
| `REA_KUNA_JOBS`               | 1                                                                                                                                       | `decompile-project --jobs`. 1 is Kuna's reference answer; more jobs finish sooner but lose callee-first prototypes, and change about 40–60% of function bodies on the measured binaries. |

A single-function decompile, inventory, string, graph or xref run that exceeds its deadline fails as `provider_timeout`, naming the setting that owns the deadline and that raising it takes a restart. A project export that exceeds `REA_KUNA_PROJECT_TIMEOUT_MS` is an export failure instead: requests that need the export report `capability_unavailable` with the export's own retry guidance.

Windows is not supported yet. Supported targets are ELF and thin Mach-O executables for x86-64, AArch64 and ARM; PE and universal Mach-O are rejected with a typed reason.

## What Kuna answers

| Tool                                                        | Source                                                                                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `list_procedures`, `search_procedures`, `procedure_address` | Kuna's callable inventory (`kuna functions --json`), including import slots it does not decompile                                |
| `address_name`                                              | Function entries, then the data labels Kuna's export assigns                                                                     |
| `procedure_pseudo_code`, `batch_decompile`                  | The project export, or a single-function run while the export builds                                                             |
| `procedure_assembly`                                        | The project export's labeled listing                                                                                             |
| `procedure_callers`, `procedure_callees`                    | Call-kind edges from a lazy, body-free Kuna graph; synthetic import nodes are accepted by address                                |
| `list_strings`, `search_strings`                            | Typed string candidates from one cached, reference-free scan; exact-address, literal and ECMAScript regex selection              |
| `xrefs`                                                     | Exact-address incoming reference sites, with forwarding aliases filtered explicitly                                              |
| `analyze_function`                                          | Pseudocode and assembly from the export, plus call relationships; typed references, comments, strings and CFG remain unavailable |

Typed procedure references, basic blocks, raw-memory tools, annotations and type recovery are not available from this provider. Use another provider for those operations.

## How answers are produced

The first text or assembly request in a session looks for this target's export in the cache. `list_documents` reads the selected path without initializing analysis. Inventory, function lookup, string queries, call relationships and xrefs do not start a C export. A data-name lookup starts it only when the address is absent from the function inventory. The export is keyed by the target's SHA-256, the Kuna executable's SHA-256, its version and `--jobs`.

- **Warm cache:** analysis reads reuse the verified export. A fresh server verifies its file digests once, even for concurrent first requests; that cost scales with export size.
- **Cold cache:**
  - REA starts `kuna decompile-project` in the background on a private copy of the target.
  - Meanwhile, pseudocode comes from one `kuna decompile --addr` run. Name and address lookups, and listings, use the inventory the export takes with `kuna functions --json` before it decompiles. The session runs `kuna functions` itself, under `REA_KUNA_TIMEOUT_MS`, only when no export is building (an inventory-only request does not start one) or the export ends without an inventory.
  - Requests for the same function share one run; it stops when its last waiting request is cancelled. Each run analyzes the whole image again in its own process, so one REA process runs at most as many at once as the host has cores beyond `REA_KUNA_JOBS` (at least one). Further requests wait in order, and a waiting request is answered from the export if it finishes first. A run whose stop REA cannot prove keeps its slot until `close_binary` proves it stopped.
  - The session keeps each completed single-function text, up to 16 MiB in all with the least recently used dropped first, and answers repeats from it until the export can. After a failed export that lasts for the session.
  - Assembly and data names wait for the export; progress notifications report the wait every ten seconds. A session does not rebuild a failed export: requests that need it fail with `retryable: false`, the export's failure, its captured Kuna output and what to change before reopening the target. A setting such as `REA_KUNA_PROJECT_TIMEOUT_MS` or `REA_KUNA_JOBS` is read when REA starts, so changing it also needs a restart. Pseudocode keeps using single-function runs.
  - A single-function answer says so in its limitations. It lacks the export's whole-program prototypes, so a later request can return different text for the same function.

Pseudocode, assembly, `analyze_function` and data-name answers record where their text came from in `raw_result.source`: `single-function`, or `project-export` with the cache directory. `procedure_pseudo_code` and `procedure_assembly` answers from the export also name the file, byte span and the file's SHA-256. Combined `analyze_function` answers retain both facet records in `raw_result.source.files`, each with its file, digest and byte span. Both texts come from one export; losing that project retries the complete report. Listings and procedure lookups carry no `raw_result`. Agents can open or search the export's `.c` and `.asm` there directly when that is cheaper than calling a tool per function. Text read that way is target-derived, like any decompiler output, but it bypasses the untrusted-content marker that REA's tool results carry.

The background export belongs to the session. `close_binary`, or the end of a CLI command, cancels it unless another session still waits for it. A one-shot CLI decompile therefore answers from a single-function run; any request that needs the export, such as `procedure_assembly` or `analyze_function`, keeps it.

The assembly label index is scanned once per export reader. Cancelling a request stops its wait without interrupting other readers; closing the session aborts and drains the shared scan before releasing its files.

Regex procedure and string search uses ECMAScript Unicode matching in a cancellable worker with a matching deadline and a worker old-generation heap. Literal matching remains the default. Cancellation or a matching deadline leaves the session available. The deadline is `REA_REGEX_MATCHING_DEADLINE_MS`, a positive decimal integer from 1 to 2147483647 ms. Unset uses 5000 ms. A larger value is refused because Node schedules a delay past that signed 32-bit bound as 1 ms. Invalid values are configuration errors and do not fall back to the default. The setting is read from the environment that starts REA, so a change needs a restart. A deadline failure names the effective milliseconds, whether they came from the default or the setting, the default, and the maximum. The worker old-generation heap does not raise it. The worker heap request is `REA_REGEX_WORKER_HEAP_REQUEST_MIB`, a decimal integer from 7 to 16384 MiB. Unset uses 128 MiB. A request below 7 MiB aborts the worker during startup, and a larger value is refused. Invalid values are configuration errors and do not fall back to 128. The setting is read from the environment that starts REA, so a change needs a restart. A heap failure names the effective request, whether it came from the default or the setting, the default, the floor, and the maximum. A positive Node.js `--max-old-space-size` on the process that starts REA, including `NODE_OPTIONS`, overrides that request and sets the effective heap. `--max-old-space-size-percentage` takes precedence over that flag in either order. REA does not turn the percentage into a MiB, so the effective heap stays unestablished instead of the worker heap request or the absolute flag. The reported `NODE_OPTIONS` value is the process initial environment when that block can be read. A later edit to the environment is not the value Node applied, and an unreadable initial value leaves the effective heap unestablished. The launch Node options are the initial command line on Linux when that buffer still has a program entry, not a later edit to `process.execArgv`. A preload can clear that array after V8 has applied the flags. Setting `process.title` or `--title` overwrites the command line, so a buffer without a program entry leaves the effective heap unestablished. `--env-file` or `--env-file-if-exists` can supply `NODE_OPTIONS` when the initial environment has none. That file is not part of the initial environment block, so the effective heap stays unestablished instead of the worker heap request. An initial `NODE_OPTIONS` is still used, because Node does not let the file replace it. A positive `--max-heap-size`, including the underscore form and launch `NODE_OPTIONS` on Node versions that allow it, sets the total heap rather than the old generation and can be lower than the worker heap request. The effective old generation stays unestablished while that value is in effect. A zero or empty value clears it. `--experimental-config-file` or `--experimental-default-config-file` can set `nodeOptions`, including a heap percentage, from a file that is not read back. The effective heap stays unestablished when either flag is present, including when an absolute `--max-old-space-size` is also on the command line or in the recovered `NODE_OPTIONS`. Node accepts the config path as `=` or the next argument.

Single-function subprocess output and each cached source facet share a 16 MiB buffered-text capacity. Cached spans are checked before allocation; larger text remains in the local export and the error identifies the file and range. `analyze_function` with `detail: "complete"` (the CLI default) returns the complete dossier inline, which can still be large; later retained views do not remove that first transfer. The MCP default retains the dossier and returns its summary, so page the facets you need through `inspect_analysis_view`, or prefer the individual text tools for a focused question.

## Strings

`list_strings` and `search_strings` share one lazy `kuna strings --json --encoding all --min-length 5 --termination any --no-xrefs` scan of the digest-checked private input. Skipping references avoids program lifting, a call graph and a C export. REA validates the input, scan policy, every row and the total before caching any facts. Encoding, character count, byte length and terminator facts must agree; supplementary UTF-8 characters count as Unicode scalars. Malformed output is an error, not an empty search. REA parses the JSON as Kuna writes it instead of buffering it, so the scan has no fixed size: Kuna writes about 290 bytes per row, 31 MB for a 20 MB Ghostty binary and 179 MB (611k rows) for an arm64 Firefox `XUL`. Rows are validated one at a time, and the first contradiction stops Kuna. Text REA does not keep is dropped unassembled; kept text and retained rows are admitted against the REA process's live heap headroom as they arrive; a refusal is a `memory` resource constraint with `retryable: false`, and closing other targets or starting REA with a larger Node.js heap makes room. String scans use the whole-program `REA_KUNA_PROJECT_TIMEOUT_MS` deadline; `REA_KUNA_TIMEOUT_MS` applies to single-function decompilation. The parsed inventory belongs to one selected target/executable profile and expires on session close; Kuna diagnostics beyond their 8 MiB buffer are retained as a failure until close, while other failures are not cached.

Results keep exact u64 virtual addresses, decoded text, native encoding, terminator status and byte length including any terminator. Kuna scans mapped sections or segments for runs of at least five characters; unterminated fragments can include instruction bytes. `all` includes ASCII, UTF-8 and the engine's Latin-range UTF-16LE reading. Other text, including short strings, non-Latin wide text and UTF-16BE, can remain undiscovered. An empty result does not prove absence.

Use `search_strings` for the matching rows or `list_strings` with an exact address for that location. The validated inventory is sorted by numeric address and encoding. Once cached, exact-address reads use binary search and return every encoding at that address without scanning the full inventory or retaining another lookup index. Literal and regex matching run in REA, preserving the existing case and ECMAScript Unicode semantics instead of substituting Kuna's different regex dialect. Procedure and string regex queries share one worker slot per session. Input projections are materialized only after admission, so queued queries retain no per-query inventory arrays. Close cancels and drains matching. Native metadata queries also share one admission slot, including references; a failed stop retains admission until cleanup is proven.

`raw_result.strings` reports the source JSON digest/size, scanned scope, extraction policy, complete inventory count and selected count without copying unrequested text into the answer. Omit the address from `list_strings` to retrieve the complete inventory as Evidence; normal session retention and bundle export apply, including transport-capacity errors for oversized inline replies. These operations preserve their complete-result contracts and do not add paging. Function-referenced string facets in `analyze_function` remain unavailable; call `xrefs` explicitly when references to one returned string are needed.

## Calls and references

The first call query runs `kuna decompile-graph --functions ''`, admitting no C or assembly bodies. One validated graph and forward/reverse indexes serve later call queries and existing `get_call_graph` / `trace_call_path` workflows. Numeric u64 addresses are parsed from their original JSON tokens. Only `call` edges become callers/callees; jumps and data references retain their distinct meaning. Graph counts, edge endpoints and ordering are validated before any relationship is returned. A forwarding address may be an instruction inside a function, so it is retained separately and never promoted to a function node or call edge. Reported indirect calls make affected relationship coverage partial; no target is invented for them.

`xrefs` runs native `xrefs --to ADDRESS --json` on demand. Kuna unifies forwarding aliases and suppresses edges internal to their class; REA filters to the requested address and records the excluded-row count. Duplicate source sites appear once. An empty result cannot establish the absence of references. Addresses are explicit u64 values or exact, unambiguous procedure names; Kuna has no cursor.

REA parses the graph as Kuna writes it, like the string scan, so the graph has no fixed size: a 53 MB Raycast binary produces 157 MB (180k functions, 773k edges), which REA retains in about 93 MB after a whole-program walk of about a minute. Unrequested bodies are refused before any of their text is assembled, and edges are indexed as they arrive, so retained rows and their indexes are admitted against live heap headroom. Xref JSON admits at most 16 MiB before parsing. Output or Kuna diagnostics beyond a buffer are reported as a `memory` resource constraint with `retryable: false`, because the same target and executable produce the same output. The session remembers such a graph failure, so later call queries fail at once instead of repeating the whole-program walk. The graph is cached for the selected target and executable profile within one session. Xref reuse is an LRU charged by source bytes plus metadata, limited to 16 MiB and 128 entries; at most eight distinct native xref queries may be pending. Reference commands run one at a time per session and share the provider's foreground budget with single-function decompiles. An unproven process stop retains its admission slots until cleanup succeeds. Concurrent callers share work, individual cancellation releases only that waiter, and the last departing waiter cancels its producer and receives any unproven cleanup. Session close aborts and drains producers, releases parsed caches and retries any retained process/file cleanup.

Evidence includes only selected addresses or dossier neighbors, the producing JSON's SHA-256/byte count, coverage and relevant function facts; unrequested program-wide JSON and instruction text are omitted. Reference caches are in memory and expire on close: a fresh CLI process or MCP server rebuilds them. A first call query therefore costs a whole-program reference walk even when a C export is warm. These operations do not establish full Ghidra/IDA feature parity.

Failures from shared installation or inventory work identify the operation the
caller requested. `diagnostics.producer_operation` retains the internal producer
name when it differs. Caller-specific failures keep the producer's typed outcome,
captured output, partial facts and live cleanup dependencies; cleanup retry
updates every projection rather than preserving an independent stale marker.
Installation acquisition is shared, with independently cancellable caller waits.
The final departing caller stops the probe and joins its cleanup; session close
also stops and joins acquisition. A cleanly cancelled acquisition can be retried,
while a retained cleanup failure blocks replacement until its owner is closed.
Shared string and reference queries preserve caller cancellation reasons and
join the final departing caller's command cleanup. A command cleanup error keeps
its typed primary failure and captured output. Its live resource list follows
both process and workspace ownership: proving process exit does not prove that
the private workspace was removed, and retry updates earlier caller errors.
If workspace setup fails, an unsuccessful rollback retains the original target
or read failure together with its cleanup owner. Replacement stays blocked until
that rollback is resolved; a clean rollback permits another setup attempt.

## Provenance and limitations

- Addresses and bytes are Kuna's observations of the image. Procedure entries and extents are its derivations: extents are upper bounds clipped at the next entry, and Kuna can split one function at an entry its own analysis infers. Pseudocode is its reconstruction, never original source.
- Pseudocode and assembly are exact Kuna text; text from Kuna and from another provider is not comparable as equal or different.
- Results are re-read rather than replayed from REA's analysis snapshots, because a cold answer can differ from the export's.

## Cache ownership

REA writes Kuna's exports only inside `REA_KUNA_CACHE_DIR`:

- `projects/<key>/` holds published, immutable exports with a manifest of file digests.
- `staging/` holds builds whose processes may still be live.
- `trash/` holds retired builds and evicted exports awaiting removal.
- `home/` is Kuna's HOME.

The cache key includes the selected launcher and resolved executable paths, plus
the target's native basename: that name determines the export filenames and
appears in generated source. REA accepts one current manifest layout. Older
exports are rebuilt on demand and retired through normal owned-cache cleanup;
no manual deletion or migration is needed. Manifests must name the producer's
exact flat file layout, with matching basenames and producing inputs. Replaced
entry, project or manifest symlinks are refused before their targets are read;
an unverified `projects/` parent grants no removal authority. Warm reuse checks
the manifest's file identity as well as the export files. These refusal and
migration cases are verified with controlled Kuna-format exports; they do not
establish behavior of an independently installed Kuna release.

Builds publish by one rename, so a reader sees a complete export or none. If later staging retirement fails, the typed cleanup error retains the completed export's key, directory and manifest in `published_export`. The session adopts that verified project; later queries reuse its immutable files while `project_export.cleanup_incomplete` reports the retained owner's live state. `close_binary` retries only the remaining cleanup, and a successful retry resolves prior cleanup errors. A failed export followed by failed staging cleanup retains both failures; it does not invent a publication receipt. A session keeps the export it uses from eviction only within its own REA process. If another REA process sharing the cache evicts it, the session rebuilds it; meanwhile pseudocode falls back to single-function runs. A damaged or edited export is removed and rebuilt. REA retains the file state verified with each digest, checks it before warm-cache reuse, and checks open descriptors before and after reading text. Assembly indexes are checked against the same state; a changed file makes the whole report retry rather than mixing facets from different exports. Staging moves to `trash/` for removal only after REA proves its Kuna process stopped. Staging of a process it cannot prove stopped is never swept; REA keeps it owned, retries the stop on `close_binary`, and reports it until the stop is proven. Failed file removal also stays bound to its export and is retried by `close_binary`; closing does not report success while that cleanup remains. `rea doctor --provider kuna` reports the cache directory without creating it.

## Verify with a real Kuna

```bash
REA_KUNA_COMMAND=/absolute/path/to/kuna npm run verify:kuna
# Compare with Ghidra on caller-built binaries
REA_KUNA_COMMAND=/absolute/path/to/kuna GHIDRA_INSTALL_DIR=/absolute/path/to/ghidra \
  npm run verify:kuna -- --targets DIR --functions inflate,crc32 --compare-ghidra
```

The lane compiles a small source-owned fixture with the host C compiler and verifies the MCP workflow end to end. `--targets DIR --functions a,b` adds caller-built binaries. `--compare-ghidra` (with `GHIDRA_INSTALL_DIR`) runs those same functions through Ghidra; it requires `--targets` and `--functions` and refuses empty matrices or requested function names missing from every target. See [testing](testing.md#kuna-lane) for coverage.

Failed runs also report process-lineage evidence and exit unsuccessfully. If provider or transport cleanup is unconfirmed, the report says `cleanup: "incomplete"` and records `retained_workspace`; that directory is preserved for investigation and cleanup retries.

Doctor reports an invalid Kuna cache, job count, or timeout setting with that
setting's correction. Correct or unset the named setting and restart REA; these
configuration rejections do not require replacing the selected Kuna executable.

# Website runtime source attribution

REA integrates native Chrome DevTools Protocol inspection and precise V8 coverage through two composable tools. Supply an existing loopback CDP endpoint and a page target from `list_browser_targets`. With omitted origins, REA selects the page's current HTTP(S) origin. The browser and page remain externally owned.

## Observe execution

```bash
rea observe-web-execution http://127.0.0.1:9222 TARGET_ID \
  --observation-ms 10000 --json
```

MCP: `observe_web_execution` with `cdp_endpoint`, `target_id`, optional `allowed_origins` and optional `observation_ms` (default 10000). The operation itself selects instrumentation; no extra approval flag is needed.

Starting precise coverage resets counters and prevents optimized execution until REA stops it. This changes timing/JIT behavior. REA requests accurate call counts and detailed ranges, takes one resetting sample, stops coverage, disables enabled domains and detaches its own connection. It does not navigate, click, evaluate selected application code or close the page.

Wait for the actual armed progress event before performing an action. MCP emits negotiated progress notifications; CLI emits `rea_progress` JSON on stderr while the Evidence result stays on stdout. Use ordinary commands, scripts or user actions to trigger behavior. CLI SIGINT/SIGTERM and MCP cancellation await instrumentation cleanup; unconfirmed cleanup is an error with the target, failed commands and previous failure.

Results retain:

- The selected target, frame and document loader identity; local armed/end timestamps and separate backend monotonic coverage timestamps.
- Every admitted producer function/block range, exclusive end offset and execution count in UTF-16 code units, with verified bounds when exact text is available. Nested/overlapping counts are preserved and must not be summed.
- Main-document script inventory, exact session script IDs, resource start coordinates, sourceURL/source-map declarations, producer hash and independently computed UTF-8 text digest.
- Armed-window requests from the selected main frame and selected origins, complete reported initiator objects (including stack hierarchy/descriptions), derived callsites, exact script-ID associations and unresolved async parent IDs. Source association does not establish UI causality. Callsite and listener `line_number`/`column_number` values are CDP's zero-based lines and UTF-16 columns in the resource named by `url`. With a `script_id`, that is the script's enclosing resource: the script file for an external script, or the HTML document for an inline script. `resource_start` is where the script text starts in that resource. A callsite with an empty `script_id` comes from the request's reported initiator rather than a script call frame, such as markup that the parser read in a document or a module import in a script file. It still locates a position in `url`, but has no session-script association, so it cannot be joined to captured source or `resource_start`. `trace_web_source_location` takes one-based, script-relative lines and zero-based UTF-16 columns.

For an external script, where `url` is the script file, use `line = line_number + 1` and keep `column = column_number`; this also applies to an empty-`script_id` initiator position in a script file. For an inline script, which requires a `script_id` and its `resource_start`, use `line = line_number - resource_start.line_number + 1`. Subtract `resource_start.column_number` from `column_number` only when `line_number === resource_start.line_number`; keep the reported column on later lines. Columns remain zero-based. This conversion requires known source-start and column coordinates; preserve unavailable coordinates as unknown.

The coverage counter interval starts at backend acceptance before the armed receipt and ends at the resetting sample after the local timer. Counts may include execution during these command intervals; request events are restricted to the locally armed window. The result retains both backend timestamps and the distinct local clock.

Source metadata remains collected through receipt of the resetting sample, including scripts parsed during the final command. REA then freezes this inventory for source joins. Fatal protocol parsing failures terminate the observer even when no command is outstanding; listener inspection checks producer failures after its final document assertion.

A document replacement ends the window; final coverage then remains unavailable. Missing coverage is unknown: an already loaded script may be absent from a sample. A detailed request also does not guarantee block granularity for already compiled functions. If `is_block_coverage` is false, the function-only ranges are observed and branch execution remains unknown. Native Chrome verification reproduced block coverage in the first window and function-only coverage in a subsequent window, including without REA.

Same-document navigation such as `history.pushState()` remains valid when the frame and known loader identity stay stable and the current origin is allowed. Unknown loader identity retains a conservative URL check; newly reported or replaced loaders are rejected. Malformed producer events end an armed window immediately and trigger cleanup, independently of the selected duration.

Target detachment ends the window with `session_detached`, even when the browser's root connection stays open. An `Inspector.targetCrashed` event ends it with `target_terminated`. A lost transport records `transport_disconnected` in browser observation; execution capture returns the typed transport failure. These outcomes retain the selected target and the observed lifecycle fact.

When an ended session cannot acknowledge cleanup, the operation returns a failure with the failed commands and original typed producer reason. Completed capture facts retained with that failure report cleanup as `unconfirmed`; only the session cleanup owner can mark a successful result `confirmed`. Such retained Evidence preserves coverage, sources, target and listener facts without becoming a successful operation. A caller cancellation remains primary when an incomplete retained snapshot cannot be promoted to completed Evidence. A coverage-stop failure also retains the observed window's end reason in its diagnostics; cleanup remains unconfirmed until the owning session can resolve it.

Child frames, workers, service workers, WebAssembly, chronological execution order and framework-specific causal interpretation are outside this operation. Script ownership comes from frame/context metadata, never URL equality. Repeated URLs and synthetic names therefore retain separate identities.

Observed script metadata remains available when ownership is unknown; source text and source association remain excluded or unknown. Request/initiator resource URLs omit transport userinfo. Stack and script URLs can also be inert `sourceURL` names: REA preserves declared names and unknown representations, and only removes script URL userinfo when stable producer metadata explicitly reports `hasSourceURL: false`. This policy also applies when metadata arrives after a request. Unknown producer extension fields and source-map declarations are preserved.

## Inspect a node's listeners

```bash
rea inspect-web-event-listeners http://127.0.0.1:9222 TARGET_ID '#submit' --json
```

MCP: `inspect_web_event_listeners` with the same scope and an explicit CSS `selector`. Native DOM selection inspects the first matching node in the main document. A missing match is an explicit empty result.

The result contains directly registered listener types/flags, callback coordinates, source identity/text/digest and execution unknowns. REA uses native DOM/DOMDebugger operations and releases its own remote object group. It never invokes a listener or dispatches an event. Delegated ancestor listeners, descendants, closed shadow roots and framework registries are not enumerated.

## Bounds and verification

Each protocol message has a 64 MiB budget; script/context metadata and request metadata each have an 8 MiB retained budget. Request retention charges the projected request and initiator facts, including final source binding; discarded request bodies and headers do not consume that retained allowance. Complete retained source text has a 32 MiB budget. Retention overruns return a typed resource constraint naming the allowance, observed bytes and fixed limit; malformed evidence remains an output failure. Neither returns partial success. Each command and the complete inspection/source-join phase use `command_timeout_ms` (default 20000). Cleanup uses a separate 5000 ms grace; `command_timeout_ms` does not raise or shorten it, and this release has no runtime override for that grace. Transport closure follows the grace. Both CLI and MCP use the same positive 32-bit millisecond observation-duration contract. REA does not control the externally owned browser's CPU or memory.

`npm run verify:browser:runtime` uses caller-supplied `REA_BROWSER_EXECUTABLE` and the native `ps` command on Linux/macOS against an owned synthetic fixture, through real public CLI and stdio MCP. It checks exact Unicode/CRLF text/digests, same-URL identities, same-document navigation, inert declared names, executed and zero-count branches, function-only unknowns on repeated observation, listener selection, initiator association, actual arming and preservation of the external page. A separate fixture page closes during an armed MCP window to verify prompt termination and inline cleanup diagnostics. The optional positional entrypoint to `scripts/verify-browser-runtime.mjs` permits the same checks against an isolated installed tarball.

Real workflow coverage is Linux x64 / Chrome 153 / Node 24. Other browser engines and host workflows remain unverified. The conditional `real-web-runtime` CI lane acquires Chrome only for relevant changes; ordinary unit/static checks need no browser.

Primary protocol references: [Profiler and Debugger](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/js_protocol.pdl), [DOMDebugger](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/DOMDebugger.pdl).

Source ownership requires both the selected main frame and producer evidence for its default execution world. Extension/automation isolated worlds, worker worlds and unknown worlds cannot establish website source joins. Contradictory world metadata stays unowned. Referenced source records retain the reported execution context and script auxiliary context metadata; source text is read only for proven main-document default worlds.

Known script/context identities are monitored through asynchronous source completion after the sample cutoff. A changed identity excludes its retained text, frame attribution, coverage and request/source joins. Chromium's specific native CSS syntax rejection returns an input error for `selector`, including the selected target; unrelated node, command and transport failures retain their original category.

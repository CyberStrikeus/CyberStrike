# Runtime analysis settings verification

Verified on macOS with Node 24.22.1, Java 21.0.12.1 and Ghidra 12.1.4.
This change adds two MCP tools and 11 runtime defaults without a new dependency.

## Behavioral checks

- Built stdio MCP: a valid ASAR with an index above 16 MiB is refused. Updating
  `asar.max_header_bytes` to 32 MiB allows the unchanged full-archive inventory
  and JavaScript analysis on the same connection. Both source files are parsed.
  Reset refuses the same archive again; target close preserves the revision.
- An Electron header cached under a higher admission remains denied after a
  decrease. No bulk extraction or source selection bypasses admission.
- Store and deferred MCP handler tests retain the accepted snapshot across an
  overlapping update. Atomic rejection, duplicate keys, revision conflicts,
  idempotence, reset, isolation and explicit WABT argument precedence are covered.
- The real Ghidra verifier reaches a natural one-second decompile timeout, raises
  the runtime deadline to 60 seconds, and obtains pseudocode for the same slow
  function without replacing the Program. Initial and final session run IDs
  match; subsequent analysis succeeds and cleanup completes. Its generated
  6,000-branch fixture is compiled but never executed.
- The focused suite passed 459 tests across 22 files, with 10 platform-specific
  skips. Typecheck/lint, bridge source compilation, runtime build and generated
  documentation checks passed.

## Review follow-up

Invalid provider-local launch settings remain typed configuration failures rather
than preventing MCP startup. Inspection reports `source: "invalid"`, omits
`value` and `launch_value`, and includes `configuration_error`; a runtime
replacement supplies a usable value, while reset restores the invalid launch
state. JADX availability and execution resolve the same admitted timeout, so
repair and reset also update capability guidance. The availability regression
uses a fixture JAR and simulated JDK; it does not establish real JADX behavior.
Update history omits an unknown old or new value instead of using null
(the explicit unbounded Ghidra value).

Regex controls apply to IDA, Hopper and Kuna's supervised ECMAScript matcher.
Ghidra uses its own Java matcher and is excluded from these controls. IDA's bound
client and capability descriptions consume the same accepted configuration.
WASM passes its effective deadline separately from caller parameters, preserving
omitted arguments in both successful and partial Evidence. Shared error copying
retains structured limit recovery through attribution and explicit redaction.

## Representative task costs

Measurements below precede the review follow-up; task costs were not remeasured.
One measurement per scenario, using the built stdio server and a valid ASAR with
an index just above 16 MiB and one small JavaScript module. Each scenario ends
with successful full application analysis delivered as a summary. Discovery,
failed calls and recovery are included. Fixture creation, build and tokenizer
work are excluded. Filesystem caches were uncontrolled.

| Recovery workflow                                                      | Elapsed | Sampled server-family CPU | Sampled peak server-family RSS |
| ---------------------------------------------------------------------- | ------: | ------------------------: | -----------------------------: |
| Fresh server: fail, runtime update, retry                              |  3.68 s |                    1.81 s |                        680 MiB |
| Warm server: fail, runtime update, retry                               |  0.25 s |                    0.49 s |                        625 MiB |
| Launch-environment recovery: fail, close, restart with override, retry |  6.02 s |                    2.85 s |                        674 MiB |

The restart comparison uses the same current build to model the previous
recovery workflow; it is not a benchmark of the previous commit. CPU and RSS
are 100 ms `ps` samples of the server and descendants. Short-lived processes and
unsampled peaks can be missed; CPU estimates exclude the client and sampler.
These observations do not establish a general speedup or performance guarantee.

Tokenized with `cl100k_base` / tiktoken 0.12.0, not billed model usage. Catalog
projections include tool name, description and input schema. The two new tools
add 1,181 tokens; the full 229-tool projection is 59,734 tokens. The runtime
recovery task uses 5,880 tokens for all requests and complete tool replies, plus
1,710 for its selected tools (7,590 total), or 65,614 including full discovery.
Warm recovery reuses discovery. The restart workflow uses 5,492 request/reply
tokens plus two full discoveries (124,960 total). A host that caches discovery
or loads only selected tools has a different context cost. System instructions,
reasoning and client-specific presentation overhead are unmeasured.

## Coverage limits

The archive fixture isolates header admission; it is not the original Loom
archive. Real engine coverage here is Ghidra on macOS. Hopper, JADX, capture
and regex setting integration have source/boundary coverage, not a new real
provider run for every setting. Linux/Windows engines and Bun are unverified
for this change. Client deadlines and receive buffers remain externally owned;
active worker values are explicitly unobserved in the settings inspection.

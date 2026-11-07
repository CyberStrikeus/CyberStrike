# Client and agent verification

FreeBuff MCP loading and personal skill discovery are currently unverified with
an installed native client/version. Its temporary-filesystem coverage verifies
REA's configuration and applicability boundaries only; it does not establish
that FreeBuff consumes the written registration or skill.

Use these optional lanes to verify an installed client or evaluate an agent's
REA workflow. [Testing REA](testing.md) provides the normal development commands
and provider lanes. Each record below states its host, client version, model
fixture, and remaining coverage; a native-client run with a loopback model does
not establish live model-service acceptance.

## Launch environment verification

`rea mcp doctor --json` starts the production MCP adapter with the current runtime
executable and environment. A healthy result establishes that adapter's
initialization, discovery and target-free request flow; it does not verify a
client's configured launcher or its inherited environment. Test the generated
registration through the actual client, including a reduced `PATH` when checking
desktop or service startup. Record the client version and launch environment
separately from terminal doctor results. See [launcher troubleshooting](client-configuration.md#launchers-and-path).

## Published Pi code-mode renderer limit

A separate probe of the published `@earendil-works/pi-codemode` 1.1.0 and 1.2.0
declaration renderers rendered the full `compare_web_captures` input as
`args: unknown`: its generated TypeScript type exceeds Pi's 16,000-character
default. REA keeps the full advertisement's fields by inlining references when
the shared form would exceed Pi's 32-reference expansion limit; retaining that
shared form would leave later fields unknown instead. The existing
`REA_MCP_INPUT_SCHEMA_PROFILE=compact` profile lets callers stay below
its character limit by advertising reduced nested validation structure, while
REA continues to validate calls against the complete canonical input schema.
Compact is the default for the server's advertised inputs; an explicit `full`
choice is preserved. See the [compact input schema profile](mcp-contracts.md#compact-input-schema-profile)
for details of its reduced forms.

Custom renderer hosts can raise `inputMaxChars` through `renderToolSignature` or
`renderToolSample`; `renderDeclarations` does not expose that override. The
probe exercised the published renderer code, not a native Pi host or model, and
does not establish broader Pi compatibility. See the pinned upstream
[`declarations.ts`](https://github.com/earendil-works/pi/blob/b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb/packages/codemode/src/declarations.ts)
and [renderer usage notes](https://github.com/earendil-works/pi/blob/b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb/packages/codemode/README.md#declarations-for-the-model).

## End-to-end, integration and golden evidence

The optional `verify:qwen-client`, `verify:pi-client`, and `verify:hermes-client`
lanes require an installed native client. Select its executable with
`REA_VERIFY_QWEN_COMMAND`, `REA_VERIFY_PI_COMMAND`, or `REA_VERIFY_HERMES_COMMAND`.
They configure disposable profiles through the public REA CLI, preserve caller
settings and backups, and exercise real stdio MCP calls and skill loading. The
`call` mode checks complete catalog discovery and actual JavaScript Evidence;
pass `-- chat` to check plain chat with REA enabled. Qwen also reads the full
result that its client offloads, and Pi exercises default codemode execution.
Use `REA_VERIFY_RUNTIME_ROOT` to select a production-only installed REA package.
Receipts retain client versions, result digests, host coverage and owned-process
cleanup. These lanes use a deterministic loopback model and do not prove live
model-provider compatibility. Pi and Hermes remain POSIX-only. Qwen, Pi and Hermes
bind both `HOME` and `USERPROFILE` to the disposable account. Qwen and Pi discover
the shared personal skill through their default search paths without an explicit
skill setting; Hermes discovers it through the selected `HERMES_HOME`.
Set `REA_VERIFY_HERMES_STICKY_PROFILE=1` to exercise native Hermes selection of
a named sticky profile with `HERMES_HOME` still pointing to its root.

For Qwen on POSIX, set `REA_VERIFY_QWEN_REDUCED_PATH=1` and select its JavaScript
entry point with `REA_VERIFY_QWEN_COMMAND` to test a restricted client environment.
Setup retains the caller's `PATH`; the native Qwen `chat` or `call` run then uses
an isolated `PATH` containing only Bash for the shell-tool fixture. The lane
checks that `node`, `npm` and `npx` cannot be found and uses the generated REA
registration unchanged. Its receipt records `reducedPath`, `clientPath` and
`registrationCommand`; the option alone does not establish a passing native run.

The Qwen lane also supports native Windows (verified with Qwen Code 0.25.1 and
Node 24.19.0 for both `chat` and `call`). With Node 24.18.0, the same `call`
journey reached full Evidence readback but the client aborted during exit with
`UV_HANDLE_CLOSING`; that run remains a failure, not a compatibility claim.
Select the npm install's
`node_modules/@qwen-code/qwen-code/cli-entry.js` with `REA_VERIFY_QWEN_COMMAND`,
because `execFile` cannot launch the `qwen.cmd` shim directly. A selected `.js`,
`.mjs` or `.cjs` entry point runs under the verifier's Node. Windows path checks
use native separators; persisted output is read through Qwen's real shell tool
with a shell-independent encoded Node payload. Windows receipts report process
lineage as unavailable when the verifier has no retained native Job Object lease.

`verify:gemini-client` requires an installed Gemini CLI (verified with
`@google/gemini-cli@0.63.0` on POSIX and native Windows); select it with
`REA_VERIFY_GEMINI_COMMAND`. A selected `.js`, `.mjs` or `.cjs` entry point runs
under the verifier's Node. On Windows, select the npm install's
`node_modules/@google/gemini-cli/bundle/gemini.js`, because only a `gemini.cmd`
shim reaches `PATH`.
The optional lane uses native `GEMINI_CLI_HOME` discovery in an isolated
Git project, checks setup plans, backups and idempotence, activates the installed
personal skill, validates all forwarded input JSON Schemas against their declared
dialect, forwards the complete REA catalog and checks full JavaScript
Evidence for a Unicode path. Use `-- chat` for ordinary chat with REA enabled,
or `REA_VERIFY_RUNTIME_ROOT` for a production-only installed REA package.
The local fixture exercises the real Gemini API adapter, including its
`untrusted_context` tool-result envelope. Token counts are synthetic; live
Google API compatibility remains unverified. The lane disables
the client's memory-based relaunch to preserve the caller's Node heap budget.

`verify:opencode-client` requires an installed OpenCode (verified with
`opencode-ai@1.18.35`); select it with `REA_VERIFY_OPENCODE_COMMAND`.
The optional POSIX lane configures isolated XDG roots and `OPENCODE_CONFIG_DIR`,
checks setup plans, backups, preserved JSONC comments and idempotence, activates
the installed skill, validates all forwarded input schemas and verifies complete
JavaScript Evidence for a Unicode path. JSONC is the default fixture; set
`REA_VERIFY_OPENCODE_CONFIG_FORMAT=json` for JSON. Use `-- chat` for ordinary
chat or `REA_VERIFY_RUNTIME_ROOT` for a production-only installed package.
The native core runs with external plugins disabled through `OPENCODE_PURE`;
the local OpenAI-compatible fixture has a caller-declared one-million-token
context and synthetic usage. Skills use an explicit isolated `skills.paths`
directory, so default OS-home discovery remains unverified. Live model APIs and
native Windows are also unverified.

`verify:claude-client` requires installed Claude Code (verified with
`@anthropic-ai/claude-code@2.1.296` on POSIX and native Windows); select it
with `REA_VERIFY_CLAUDE_COMMAND`. On Windows, select
`claude.exe`: npm installs put only a `claude.cmd` shim on `PATH`, and the real
executable is under `node_modules/@anthropic-ai/claude-code/bin`.
The optional lane uses native `CLAUDE_CONFIG_DIR` discovery, an independent
Git workspace, user settings and default built-in tools. It preserves caller
preferences and backups, checks idempotent setup, waits through the native
`WaitForMcpServers` tool when discovery is pending, and validates the complete
catalog and forwarded input schemas. Call mode loads the personal skill through
native `Skill`, checks its full body and verifies named-schema JavaScript Evidence
for a Unicode path. Use `-- chat` for ordinary chat with REA enabled, or
`REA_VERIFY_RUNTIME_ROOT` for a production-only installed package. The local
Anthropic Messages/SSE fixture preserves native resource-hint envelopes in its
request artifacts. Usage is synthetic; live Anthropic API and bare-mode
personal-skill activation remain unverified by this lane.

`verify:copilot-client` requires installed GitHub Copilot CLI (verified with
`@github/copilot@1.0.95`); select it with `REA_VERIFY_COPILOT_COMMAND`.
The optional POSIX lane uses native `COPILOT_HOME` discovery, an independent
Git workspace, guarded setup plans, preserved registrations, backups and
idempotence. Native `skill add` registers the isolated installed skill; call
mode loads its full body, validates all forwarded input schemas and checks
named-schema JavaScript Evidence for a Unicode path. When Copilot spills a
large MCP result, the model requests native `view` with `forceReadLargeFiles`
and validates the complete returned Evidence rather than its preview.
Use `-- chat` for ordinary
chat or `REA_VERIFY_RUNTIME_ROOT` for a production-only installed package.
The native offline BYOK adapter uses a loopback OpenAI completions/SSE fixture
and `gpt-5.4` model metadata; model inference and token usage are synthetic.
Set `REA_VERIFY_COPILOT_MODEL` to examine another client model ID and
`REA_VERIFY_COPILOT_WIRE_MODEL` for its backend model name (defaults to the client
ID). Every actual HTTP request's model is checked and recorded separately.
Both `HOME` and `USERPROFILE` point to the disposable account; native `skill add`
still selects the installed skill directory explicitly.

The same native client passed full-profile chat and analysis with the actual
wire model `gpt-4.1` under a distinct BYOK model ID:

```bash
REA_VERIFY_COPILOT_MODEL=rea-gpt-4.1 REA_VERIFY_COPILOT_WIRE_MODEL=gpt-4.1 npm run verify:copilot-client -- chat
REA_VERIFY_COPILOT_MODEL=rea-gpt-4.1 REA_VERIFY_COPILOT_WIRE_MODEL=gpt-4.1 npm run verify:copilot-client -- call
```

These runs retain full canonical input/output schemas, all tools, installed-skill
loading and complete Evidence readback. They use the fixture's requested
one-million-token BYOK prompt setting; effective capacity and live API acceptance
remain unknown. With the built-in `gpt-4.1` model ID, the verified client still
blocks the full input-schema profile before HTTP with
`compaction_static_context_blocked`, even when requesting a larger BYOK prompt
capacity. The effective capacity is unknown. The default verifier preserves
the complete catalog and full schemas. To verify the existing compact profile:

```bash
REA_VERIFY_COPILOT_MODEL=gpt-4.1 REA_VERIFY_COPILOT_SCHEMA_PROFILE=compact npm run verify:copilot-client -- chat
REA_VERIFY_COPILOT_MODEL=gpt-4.1 REA_VERIFY_COPILOT_SCHEMA_PROFILE=compact npm run verify:copilot-client -- call
```

The verifier explicitly writes either selected profile into its disposable
registration and compares the input schemas forwarded by Copilot with that
profile's advertised schemas. A run must not infer `full` from an unset setting:
REA's runtime default is now `compact`. The recorded client results above remain
scoped to their executed revisions; this verifier correction is not a new client run.

Both native workflows passed with the complete tool inventory. The verifier selects the
profile only in its disposable Copilot registration and records it in the
receipt. Compact advertisements can reduce nested validation structure; the
server still validates complete canonical inputs. This is a tested alternate
workflow, not a fix for the full-profile client/model limit tracked in #1554.
Live model APIs, native Windows and default OS-home skill discovery remain
unverified.

`verify:grok-client` requires installed Grok Build (verified with the official
Linux x64 1.0.50 binary); select it with `REA_VERIFY_GROK_COMMAND`. This optional
POSIX lane isolates `GROK_HOME`, an independent Git workspace and additional
skill roots, disables foreign configuration discovery, guards setup writes,
preserves unrelated registrations/backups and checks idempotence. Call mode
loads the full skill through native `read_file`, queries all REA names and input
schemas through native `search_tool`, and calls analysis through `use_tool`.
If discovery reports `partial`, the native agent diagnoses REA registration and
retries discovery. No startup-timeout override or fixed readiness delay is used.
A larger Unicode-path fixture exercises native result offloading: the full
retained Evidence is validated against its named schema, then native terminal
queries recover the selected export facts, subject and full artifact digest in
the next model request. This verifies useful artifact recovery without claiming
that every offloaded graph fact enters model context. Native line-number and
truncation envelopes remain in the request artifacts. Use `-- chat` for ordinary
chat, or `REA_VERIFY_RUNTIME_ROOT` for a production-only installed package.
The loopback OpenAI completions/SSE custom model declares a one-million-token
context and synthetic usage. Live xAI APIs, native Windows and default OS-home
skill discovery remain unverified.

`verify:commandcode-client` requires installed Command Code (verified with npm
1.79.2); select it with `REA_VERIFY_COMMANDCODE_COMMAND`. Auth, MCP tokens and
sessions use the actual OS home, so provision a disposable POSIX account rather
than overriding `HOME`. Set `REA_VERIFY_COMMANDCODE_ACCOUNT_HOME` to that account's
actual home and create `.rea-client-verification` there with exactly
`Disposable REA client verification account` followed by a newline. The lane
owns that account's `.commandcode` configuration and shared REA skill. Build the
runtime as the checkout owner, then run `node scripts/verify-commandcode-client.mjs`
as the disposable account; the npm shortcut also needs a writable checkout.
The verifier does not create accounts or install clients. It guards setup
targets, preserves an unrelated registration and backups, checks idempotence,
and verifies native default shared-skill discovery and complete activation.
Default deferred-schema delivery stays enabled: the native prompt advertises
every REA tool, exact-name `search_tools` returns every input schema, and a native
shell query recovers the saved catalog's count and digest when the client spills
it. Actual analysis of a Unicode-path fixture delivers full named-schema Evidence
to the next model request. Use `-- chat` for ordinary chat or
`REA_VERIFY_RUNTIME_ROOT` for a production-only installed package. The loopback
OpenAI completions/SSE model is a keyless BYOK endpoint declaring a million-token
context with synthetic usage. A synthetic account-key value satisfies the
client's print-mode gate; native local-only mode refuses hosted API calls.
Updates, telemetry and cron are disabled. Hosted authentication, live models
and Windows remain unverified.

`verify:omp-client` requires installed OMP (verified with the official Linux x64
18.8.7 binary); select it with `REA_VERIFY_OMP_COMMAND`. This optional POSIX lane
isolates the default agent, global config and XDG roots, guards setup targets,
preserves unrelated registrations and backups, and checks idempotence. It
compares native rejection of an invalid profile with REA's refusal to plan
fallback writes. OMP's default `xd://` interface mounts the complete REA catalog
as devices: call mode reads the complete installed skill and tool documentation,
then dispatches analysis through native `write`. It checks full named-schema
JavaScript Evidence with a Unicode path in the next model request. Device
metadata and documentation are distinct from forwarding all JSON schemas as
model functions. Native print-mode MCP readiness uses its defaults.
Use `-- chat` for ordinary chat or `REA_VERIFY_RUNTIME_ROOT` for a production-only
installed package. The loopback OpenAI completions/SSE model fixture declares a
one-million-token context and synthetic usage. Live model APIs, native Windows,
named-profile native execution and default OS-home skill discovery are
unverified; skill discovery uses an explicit isolated custom directory.

`verify:deepseek-client` requires an installed DeepSeek Harness (`dsh`;
verified with `@deepseek-ai/dsh@0.2.0-rc.2`) and Git. Set
`REA_VERIFY_DEEPSEEK_COMMAND` to select its executable. This optional POSIX lane
seeds caller model settings and a stale Cordis registration in an isolated
`DSH_HOME`, then runs public `setup --client dsh` dry-run, setup, repeated setup,
and scoped doctor. It checks the backup and unrelated patches before booting
Harness with the generated registration. After native execution it uninstalls
through the public CLI and checks that only caller patches remain. `HOME` and
`USERPROFILE` point to the disposable account. The native default
`~/.agents/skills` search path discovers
the installed skill without a `DSH_AGENTS_HOME` override. A separate Git root prevents inherited project skills from
masking a missing installation. The default `call` mode checks skill loading,
complete catalog discovery, the actual forwarded input schemas and regexes,
and full JavaScript Evidence for a Unicode path. Use `-- chat` for ordinary
chat with REA enabled, or `REA_VERIFY_RUNTIME_ROOT` for an installed package.
The fixture uses Harness's custom OpenAI adapter and the one-million-token
context capacity declared by its default DeepSeek Flash model; it does not
establish live DeepSeek API or native Windows coverage. Receipts include
request artifacts, result digests and owned-process lineage.

The DSH acceptance journey also exercises public setup, approval, doctor,
generated-launcher MCP startup and uninstall without an installed Harness.
That journey proves REA workflow behavior, not native Cordis expression
evaluation. Filesystem regressions retain tagged values and unrelated rows
across alias dependencies and check refusal of unsafe YAML without mutation.

Full E2E tests invoke the production command dispatcher and real providers,
without fake launchers, runners or responses. `verify:keyed-archive` writes
Foundation binary, XML, and integer archives using one run-owned Swift module
cache. It checks CLI and separate stdio MCP parity, pagination, escaping-path
rejection, an XML graph golden, and numeric meaning for safe controls, unsafe
integers, boxed numbers, and integral-valued reals. `verify:asset-catalog`
compiles source-owned colors with
`actool`, invokes real `assetutil`, then checks CLI/MCP results, exact catalog
digest, every raw metadata field, pagination and malformed input rejection.
Neither artifact workflow requires Hopper or launches it. Both run in macOS CI.
`verify:macos-bundle` needs only macOS with Command Line Tools. It compiles a
source-owned app with `clang`: a versioned framework, XPC services, an app
extension, a login item, a privileged helper, launchd plists, and a helper tool,
signed ad hoc. It packs the app as a directory, a `ditto` ZIP, and an APFS DMG,
then checks that `inspect-artifact` plus `project-apple-application-graph`
report the same bundle anatomy for all three through the CLI, with stdio MCP
parity. It also checks that the DMG is detached afterwards. The same app
covers `trace-dylib-resolution`:

- each resolution status and finding, with CLI/MCP parity;
- for every traced image, dependencies, rpaths, and install names equal to
  `otool -l`;
- for the main executable and an XPC service, a predicted load order equal to
  the images dyld actually loads under `DYLD_PRINT_LIBRARIES`.

The lane also compiles executable/library pairs with empty embedded directory,
versioned-path, and suffix settings. It checks present and removed dependencies
through CLI and MCP, and compares actual `DYLD_PRINT_SEARCHING` diagnostics for
root-level candidates. These cases distinguish an empty search directory from
an empty versioned scan or a suffix that only repeats the original path.

It runs in macOS CI.

Prepare the native inspector before cases that measure producer output or exit
behavior; keep startup deadlines and cancellation in distinct cases. Run real
process-capture verification separately from package or build checks. On macOS,
new npm processes can become token-unreadable after changing their display
title and prevent verified cleanup during a capture's ownership sweep.

MCP SDK transport tests with recording providers remain integration tests.
They are useful for schema drift and failure projection but do not prove that
Hopper, Ghidra or another substituted engine works. `verify:package` proves
packaging/install behavior and fake-provider integration; use the corresponding
real-provider lanes for engine claims. Packed-bridge checks verify shipped files and Python syntax.
Real Apple dispatch and Interface
Builder verifiers currently prove format integration through production readers.

`verify:hopper` exercises an installed Hopper through the production stdio MCP
server and CLI. It checks source-owned call chains, CFG edges, references and
complete large inventories, then probes unnamed bookmarks, annotation clearing,
batch validation before mutation, malformed addresses and regexes, segment-end
partial reads, and synthetic file-offset rejection. Advertised schemas are
validated in their JSON Schema dialect and successful replies are checked against
their advertised output schemas. Navigation checks cover interior-object cursor
readback and mapped-memory boundaries. Annotation probes verify invalid native
text and duplicate destinations/names before mutation, preserve unselected label
owners, and exercise explicit batch label swaps. Function locals retain observed
names and stack displacements. Graph probes check symbol/interior-address parity
and a source-owned recursive cycle; literal tracing preserves complete queries
and whitespace. Disposable binary copies prove that switching and closing
actually removes the native document, and that CLI byte, function-dossier,
literal-trace results and invalid-address diagnostics agree with MCP.
No provider is mocked in this lane.
Real search probes cover Unicode names, literal metacharacters, case and regex
modes, annotation cache invalidation, complete native fragments of long literals
checked against byte reads, escaped UTF-8/control text, byte-preserving Latin-1
decoding, and Hopper's UTF-16 symbol-name truncation boundary. It verifies native
CallReference classifications across reference and dossier results, retains long
string fragment metadata in dossiers, and exercises pathological regex deadline
and cancellation followed by successful requests in the same native session. When the macOS
Objective-C fixture is present, the lane also verifies native UTF-16 string objects
and their inferred encodings against their actual bytes. Native terminal calls
are checked across reference, instruction, assembly, block-range and procedure-length
projections; block endpoints are normalized using actual native membership.
Exact Objective-C names also exercise named CLI selectors for function, instruction,
decompilation, reference and search operations. A literal `--help` trace query proves
that selector data is preserved independently of global CLI flags.
Unmapped annotation destinations and
oversized later batch names fail before any earlier edit is applied.

`verify:hopper:deadlines` checks the native client's optional request deadlines
on macOS with an owned source-built fixture. Zero and elapsed deadlines must
leave native comments unchanged, including when a synchronous progress observer
delays timer dispatch. It also observes a short analysis deadline and verifies
subsequent wire recovery and clean shutdown. Caller timeout does not interrupt
Hopper's synchronous native operation. Socket boundary tests deterministically
cover active and queued expiry, late replies and timer cleanup.

The Linux demo lane remains a separate `verify:hopper:linux` command. Hopper
6.4.2's ELF loader did not recognize the original 4,119-byte literal or three
non-ASCII byte strings in the measured fixtures. The lane retains complete raw
byte checks for those literals through source-owned symbols. Recognition of the
original full-length literal is bound to its exact source address; its decoded
object coverage remains explicitly unverified on Linux even when recognized.
Absent non-ASCII recognition also reports decoded-object coverage as unverified.
Recognized non-ASCII and control-text objects must still match their source
bytes, encoding, filters and searches.
A separate 548-byte ASCII literal requires native fragmentation, shortened
provider display, complete decoded fragments and dossier provenance on Linux;
the macOS lane retains the original full-length recognition requirement. These
are observed fixture/build capabilities, not universal Hopper length limits.
Its lifecycle checks attempt competing CLI launches for the active target and a
different target, requiring rejection before either can change the owning
MCP session's documents or procedures. Lease boundary tests also preserve
unresponsive or malformed live endpoints while allowing confirmed stale
sockets to recover.

`verify:setup:linux` exercises installation on a clean supported Linux runner as
root. Use a disposable VM: this lane installs Hopper and its Linux runtime
dependencies through the system package manager. Set `REA_VERIFY_SERVER_COMMAND`
to the CLI entrypoint being verified. The command builds and checks source-owned
ELF fixtures before testing the read-only Hopper setup plan, approved
installation, scoped doctor, real CLI/MCP analysis, rejection of a modified
launcher, idempotent setup without requesting a reinstall, and owned child
cleanup. Before installation and after teardown, a clean-runner process scan
also rejects surviving Hopper demo helpers or Xvfb groups, including orphans
whose launcher exited. This scan observes processes without signaling them.
Hopper detection compares executable file identity through `/proc`, covering
alternate or configured launcher paths even after an invoked symlink is removed.
The dedicated runner must have no unrelated Hopper/Xvfb sessions. It requires
the repository's pinned development toolchain and an
existing host C compiler, `file`, `nm`, and `strings`. Use `verify:hopper:linux`
instead when Hopper is already installed.

`verify:hopper:fat` is a separate macOS lane requiring installed Hopper and the
existing Xcode clang/lipo toolchain. It compiles arm64/x86-64 thin executables and
one- and two-slice FAT32 containers, verifies exact/interior address mappings
against bytes in the original files, checks CLI/MCP parity, and checks owned
runtime cleanup. Source byte changes, removal, permission denial (for non-root
callers), and nonregular replacement must retain native partial mapping facts,
reject unverified original-file coordinates,
and recover after restoration. Single-slice FAT cases also relocate the slice
without changing its loaded bytes. `verify:hopper:fat64` additionally checks
FAT64 preparation through Hopper's native Mach-O loader, source-container
mappings, profile identity,
malformed and ambiguous slice rejection, and temporary-image lifetime. Both
lanes have been verified on Hopper 6.1.0-demo; this establishes REA's prepared
FAT64 workflow, not native FAT64-loader support.
Cross-architecture fixture compilation is not required by `verify:hopper`.

Golden tests use immutable captured text inputs with producer/source provenance
under `tests/fixtures/golden/`. Expected results are reviewed for the semantic
claim; capture commands do not automatically approve new expected outputs.
Do not call handcrafted utility output or synthetic binary builders real-data
goldens. Keep unsupported binary layouts and malformed boundaries as targeted
regressions until a real fixture establishes equivalent coverage.

`verify:browser` exercises source-map failure isolation and expanded-output limits through the compiled CLI and stdio MCP with real Chrome. It also submits five 2 MiB source-map annotations, checks retained script identities and explicit map omissions, and closes its owned fixture target. Replacement and document-reset behavior has separate producer-boundary coverage.

The raw Chrome fixture launchers use `--password-store=basic` so Linux startup
does not wait for an unlock prompt from a reachable but locked desktop keyring.
Such a stall leaves the initial page unloaded with empty or placeholder CDP URLs;
it does not establish permission to capture that page. See
[the keyring diagnosis](https://github.com/morluto/rea/issues/1384#issuecomment-6093781686).

On Windows, browser verifier lanes that launch an owned fixture require a
standard, non-elevated caller token. They inspect the verifier caller before
allocating fixture resources and refuse elevated or unobservable tokens; they do
not change caller authority or claim to inspect the browser process token.

`verify:browser` also captures a source-owned noise canvas as a real PNG above
8 MiB through the CLI and stdio MCP, with complete byte/digest parity and real PNG
decoding. Its SDK client explicitly permits the larger inline JSON response;
this lane does not establish large image-comparison request transport coverage.

The scenario checks read locale, timezone, device scale and viewport dimensions
from actual page JavaScript through CLI and stdio MCP DOM captures. They also
verify that attached-page emulation is released after success, initialization
failure, action failure and cancellation while the external target stays open.

`verify:browser:network` is a focused real-browser lane for transaction identity,
selected request/response bytes, binary and compressed responses, duplicate
headers, credential and declared-secret redaction, redirects, streaming cutoff,
CLI/MCP parity, and owned-profile cleanup. Set `REA_BROWSER_EXECUTABLE` to an
installed Chrome-family browser. An optional script argument selects an already
installed package's `scripts/rea.mjs` entry point for packaged-artifact checks.
The complete `verify:browser` lane includes these same checks.

After building, `verify:browser:dom` checks empty and HTML-whitespace form
destinations against a native Chrome DOM-property oracle through CLI and stdio
MCP. It requires `REA_BROWSER_EXECUTABLE` and accepts an optional installed REA
entrypoint. The full browser lane includes the same public-adapter assertions
before other fixtures navigate the selected page.

`verify:browser:scripts` checks active script capture → exact-byte export →
existing static JavaScript analysis through CLI and stdio MCP, including
manifest readback, competing query variants, and resolved relative imports.
It uses an installed browser and accepts an optional installed REA entrypoint.
The complete `verify:browser` lane also exercises passive script export through
both public adapters. See [website script export](website-script-export.md).

`verify:browser:modules` compares CLI and stdio MCP traces against an independent
real Chromium module-loading fixture: import-map scopes, package prefixes,
null/backtracking rejection, query/fragment identities, repeated module instances,
lazy and computed unknowns, exact source/map identities and no implicit refetch.
Set `REA_BROWSER_EXECUTABLE`; the optional script argument selects an installed
package entrypoint. The complete `verify:browser` lane and existing conditional
Chrome CI include this verifier. See [module relationships](website-module-trace.md).

## Agent evaluation and conformance records

Evaluate native, JavaScript, managed and browser investigation tasks through a
real local Codex CLI with:

```bash
npm run verify:agent
```

The verifier's scenarios, transcript scoring, fixture rubrics, and report gates
are development verification code under `tests/evaluation/model-evals/`. The
source-owned evaluator runs alongside the compiled REA tools; it is excluded
from the shipped runtime package.

The lane runs scenarios sequentially in standalone Codex (`--no-daemon`) with a
disposable HOME and CODEX_HOME under `~/.cache/rea-agent-evaluations/`. Set
`REA_AGENT_EVAL_ROOT` to choose another parent directory outside the OS temporary
directory: current Codex refuses helper aliases under `/tmp`, preventing shell
commands and skill reads even if MCP works. Each owned run directory is removed
after verification unless fixture retention is requested. Commands share the
owned-process supervisor: native ownership preparation has its own bounded
deadline before each short command budget, and timeouts join bounded process-tree
and output cleanup before returning. If cleanup remains incomplete, the lane retries its retained
owner and preserves the run directory (including disposable auth) rather than
removing files still in use; the error retains ownership and recovery details.
Command stderr is limited to 32 KiB and combined version output to 8 KiB;
exceeding these diagnostic budgets fails explicitly. Scenario JSON events stream
to the evaluator without retaining a second raw stdout copy. Cleanup attempts the
remaining run tree even if auth removal fails, and reports unresolved cleanup
together with the original verification failure. The lane
installs the packaged skill and MCP registration through public `rea setup`,
rather than copying a skill into a project that also inherits the caller's
skills and configuration. Only authentication is copied, when present, and it
is removed after confirmed process cleanup even with
`REA_AGENT_EVAL_KEEP_FIXTURES=true`. No user configuration,
rules, plugins or history is copied; shell snapshots and additional agents are
disabled. Existing API-key environment authentication remains available.
The native provider scenario preapproves only `open_binary` and
`close_binary` in the disposable client so it reaches REA's actual provider
boundary instead of stopping at Codex approval. Its scenario contract accepts
one `provider_unavailable` open refusal without a close, or one successful open
followed by a successful close. Other errors, an unclosed session, and a close
without acquisition fail. These outcomes and the prompt are owned together in
`tests/evaluation/model-evals/AgentEvaluationScenarios.ts`; generic successful-tool sequences
still apply to scenarios that require them. The provider scenario checks routing,
reported limitations, and cleanup; free-form answer correctness remains
unassessed. It does not validate a real native engine or authorize runtime execution.

Select a smaller run with `REA_AGENT_EVAL_SCENARIOS`, a comma-separated list of
scenario IDs. `asar-zh` exercises the packaged desktop rubric from a Chinese
request. `javascript-module-view` exercises summary analysis, module paging and
item inspection in a tree with unrelated modules; its routing and text checks
remain heuristic, so review the retained transcript for selector choice and
coverage claims. Set `REA_CODEX_CLI` to an installed Codex executable and
`REA_AGENT_EVAL_MODEL` to an account-supported model. Use an external resource
limit for the whole process tree when testing on a constrained host; a Node
heap limit alone does not bound client and child-process memory.

`missing-target` leaves desktop fixtures visible without selecting one in the
request. It requires zero REA calls and a JSON-only request for an app name or
artifact path, with no preceding prose or Markdown fences. Its prompt and
whole-answer validator are defined together in `AgentEvaluationScenarios.ts`.
Its `expectedFirstTool` is `null`, and
`targetClarificationPassed` grades that limited routing outcome independently
of analysis prose heuristics. Analyzing a nearby example cannot pass this case.

The packaged desktop, parser-comparison, and managed scenarios assess a closed set of
known fixture claims. Each final answer must be a strict JSON manifest containing
exactly the requested claim IDs, values, Evidence IDs, and Evidence authority and
confidence. Golden values are not included in the prompt. The evaluator checks
exact values against both the fixture oracle and authenticated successful REA
results; an Evidence ID by itself is insufficient. Missing, duplicate, extra,
contradictory, incorrectly sourced, or unsupported claims fail the scenario.

The desktop rubric covers the exposed bridge API and members, renderer and main
IPC operations, and the resolved preload. It binds its Evidence to the exact
packaged artifact path and SHA-256. The parser rubric checks the precise heading
depth addition, discriminant, complete comparison counts, and the explicit limit
on runtime semantics. Its comparison must link to the two delivered source
analyses and use the requested module and export selectors. Boundary tests package
the same source-owned desktop fixture and compare the same source-owned parser
files through actual MCP tool results, then verify that fabricated answers fail.

The managed rubric checks the exact public top-level type set and the CLI entry
point's declaring type and method name. The exact type-set claim requires an
unfiltered member inventory: `selection` must be null and the Evidence parameters
must omit `type_names`. A selected inventory can still ground the entry-point
claim. Both inspections must describe the freshly built DLL's SHA-256. Entry-point
resolution additionally requires complete artifact and member metadata, matching
non-null module MVIDs, and a unique method at the header's metadata token. These are
static metadata claims, not runtime behavior;
compiler-generated member counts, token values, and MVIDs are not golden answers.

Per-scenario `factualCorrectness` is `passed`, `failed`, or `not_assessed` within
the `configured_fixture_claims` scope. A pass establishes only the configured
claims, not unrestricted factual correctness. Native, browser,
navigation-context, and address-context scenarios have no factual rubric and
remain `not_assessed`.

The closed factual scenarios request complete producer Evidence on the initial
inspection or analysis so their source selectors can authenticate all configured facts.
Summary/page/item workflows are exercised separately by `javascript-module-view`;
its heuristic gate does not establish full-producer factual correctness.

All scenarios retain routing, workflow, validation, repetition, process-exit,
and token-use gates. Configured factual scenarios additionally require a factual
pass. Their answer-text heuristics are diagnostic and do not affect the gate.
Validation counts include complete text-only REA `invalid_request` envelopes
and failed SDK calls whose arguments violate the named current REA contract.
Client approval rejections and provider unavailability remain distinct failures;
truncated JSON previews are not parsed into invented error codes.
Repeated `binary_session` observations separated by a successful `open_binary`
or `close_binary` are treated as lifecycle verification. An unchanged retry,
including one after a failed lifecycle call, still counts as repetition.
Scenarios without a rubric retain the legacy text-heuristic gate.
`answerTermCoverageMet` checks case-insensitive substrings,
`epistemicCuePresent` checks keywords, and `finalCitesEvidence` checks only an ID's
presence. These metrics can still accept fabricated prose and must not be read
as factual assessments. Set `REA_AGENT_EVAL_TRANSCRIPT_DIR` to retain complete
tool results and final answers for review.

Report schema version 4 adds negative routing scenarios with nullable
`expectedFirstTool` and a `targetClarificationPassed` outcome. Consumers must
allow an expected absence of REA calls; this does not make an analysis scenario
pass without its required tools. Native provider records additionally report
`scenarioOutcome` (`provider-unavailable`, `opened-and-closed`, or `failed`) and
`scenarioOutcomePassed`; a failed outcome fails the gate independently of prose
heuristics. Version 3 changed the top-level
`factualCorrectness` from a constant
string to an assessment summary with status, scope, and assessed/passed/failed/
not-assessed scenario counts. Scenario records include the factual assessment and
configured claim IDs. The evaluation scope is
`routing_workflow_and_configured_fixture_claims`. Update report consumers for
these changes. The narrower heuristic field names introduced in version 2 remain:
`answerHeuristicsMet`, `epistemicCuePresent`, `answerTermCoverageMet`, and
`requiredAnswerTermGroups`.

Regenerate the managed conformance manifest and Evidence completion ledger from
live verification results, or check them for drift:

```bash
npm run evidence:generate
npm run evidence:check
```

The records preserve unsupported and unverified coverage as explicit unknowns.
Run the matching real-tool prerequisites described in this guide.

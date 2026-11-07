# Client configuration and troubleshooting

Use this reference when a client's configuration paths, profiles, trust settings,
or schema limits affect REA. Start with [installation and setup](installation.md)
for the reviewed setup transaction and [client IDs](installation.md#supported-agents).
The versioned verification notes below describe their stated runs; live service
acceptance is verified only where explicitly recorded.

## Launchers and PATH

A client launched from a desktop app, IDE or service can inherit a different
`PATH` from your terminal. An absolute path to `rea-agents` does not resolve its
interpreter: the npm launcher's `#!/usr/bin/env node` still searches `PATH` for
Node. Running that command successfully in a terminal does not establish that
the client can launch it.

For JavaScript installations, setup registers the selected runtime
executable and REA script by absolute path. On POSIX, it prefers executable
`node` or `bun` and REA aliases on setup's `PATH` only when they resolve to the
same selected files. This preserves manager-owned aliases across version updates;
otherwise setup uses the selected paths directly. This also applies when setup
runs through a package runner: retain the selected cache entry and runtime while
the registration uses them. Clearing either makes startup fail without resolving
another package from the client's project. Restore the same installation before
repairing it; an unidentified registration remains untouched. See
[installation and recovery](installation.md#package-runners-and-global-installation).
Setup does not copy your ambient environment into client
settings. To refresh an older registration, preview
`rea setup --client <client-id> --skill=false --dry-run`, then run the same command
without `--dry-run` and approve the displayed changes. Setup preserves unrelated
settings, backs up changed configuration and leaves an aligned registration
unchanged. Restart the client after applying the update.

If a runtime manager removes the registered executable and no surviving alias
was available, doctor reports its identity as unknown and setup retains the
registration. REA does not infer that an arbitrary missing executable was Node
from its script argument. Back up the client's configuration, verify the absolute
path and supported version of the runtime you intend to use, then update only
the runtime command, preserving the REA script arguments and other settings.
Rerun setup to review the registration and restart the client.

`rea mcp doctor --json` tests the production MCP adapter using the runtime
executable and environment of the terminal running doctor. It does not launch
the client's configured command or reproduce the client's environment. If doctor
passes but the client disconnects, inspect the client's startup error and registered
launcher; see [verification scope](client-verification.md#launch-environment-verification).

## Runtime settings and client deadlines

`update_analysis_settings` changes curated defaults inside the running REA
server. It does not edit the client registration, extend the client's tool-call
deadline, or recompute timeout values previously derived by `rea setup`. When
raising a REA startup or operation deadline, separately ensure the client allows
enough time for the full request. Use `inspect_analysis_settings` for the running
server's defaults; `rea doctor` checks launch configuration and cannot observe
another process's runtime overrides. See the
[settings design](design/limits-and-recovery.md) for ownership and lifetime.

## Client tool names and discovery

REA advertises canonical names such as `binary_session`. The MCP host decides
how to expose them to its model: a name such as `mcp__rea__binary_session` is a
client convention, not a prefix REA can enforce. Use the active client's tool
listing and server association to find the operation. A valid registration or
installed skill does not prove that those tools reached the model. Doctor reports
live-server identity as unknown; query `binary_session` through the active client
to observe the running server's identity.

If a client or fork exposes several servers under the same prefix, a wildcard
for that prefix does not isolate REA permissions. Inspect that client's actual
tool names and approval rules before selecting a permission scope. REA setup
does not repair a client's naming behavior or infer permission drift from an
unfamiliar prefix. The unavailable fork reported in
[#5512](https://github.com/morluto/rea/issues/5512) has not been reverified.

## Fiddler Everywhere alongside REA

Connect Fiddler Everywhere's MCP server separately for HTTP traffic debugging,
preserving your REA client entry. See the
[setup instructions and public skills](web-network-captures.md#fiddler-everywhere-mcp-and-public-skills).

## VS Code

`rea setup --client vscode` configures the default VS Code user profile's
`mcp.json`. Setup honors `VSCODE_PORTABLE` and `VSCODE_APPDATA` when they are
present in its environment. It cannot infer a running window's named profile
or `--user-data-dir`; configure that profile separately when needed.

`rea setup --client copilot_cli` instead configures Copilot's user
`mcp-config.json`. VS Code can forward eligible profile servers to Copilot
sessions; see the [VS Code MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

## GitHub Copilot CLI

Setup preserves an existing `tools` selection in the REA registration, including
an empty list. New registrations default to `["*"]`. A restricted selection is
aligned configuration; doctor does not widen it to expose every REA tool. See
[Copilot's MCP configuration](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
for tool-selection settings.

For GitHub Copilot CLI 1.0.95, `gpt-4.1` model metadata can block ordinary
chat with REA's full input-schema profile before sending a model request
(`compaction_static_context_blocked`; [#1554](https://github.com/morluto/rea/issues/1554)).
For the native offline OpenAI-compatible BYOK adapter, full-profile chat and
analysis also passed with a distinct `COPILOT_PROVIDER_MODEL_ID` such as
`rea-gpt-4.1`, `COPILOT_PROVIDER_WIRE_MODEL=gpt-4.1`, and that distinct ID selected
through `copilot --model rea-gpt-4.1`. The local fixture requested
`COPILOT_PROVIDER_MAX_PROMPT_TOKENS=1000000`; configure the limit supported by
your backend. This keeps every full schema and the actual wire model intact.
It does not establish the effective client budget or fix the built-in-ID path.
The existing compact profile passed native chat and analysis with the complete
tool inventory on Linux using a loopback model fixture. After setup, add
`"REA_MCP_INPUT_SCHEMA_PROFILE": "compact"` to the `env` object of the
`mcpServers.rea` entry in Copilot's `mcp-config.json`, preserving its other
settings, then restart the client. Compact advertisements can reduce nested
schema constraints; REA still validates complete canonical inputs. Full-profile
`gpt-5.4` metadata is also verified locally. Live model API acceptance and
Windows remain unverified; see [native client verification](testing.md).

## Claude Desktop

Setup registers `mcpServers.rea` in `claude_desktop_config.json`: under
`~/Library/Application Support/Claude` on macOS, under
`$XDG_CONFIG_HOME/Claude` (default `~/.config/Claude`) on Linux, and on Windows
in the file the installed app reads:

- Without Claude Desktop's MSIX package storage, setup uses
  `%APPDATA%\Claude\claude_desktop_config.json`.
- The MSIX build (package family `Claude_pzs8sxrjxfjjc`, installed under
  `C:\Program Files\WindowsApps\Claude_<version>_x64__pzs8sxrjxfjjc`)
  virtualizes AppData writes. Once it has saved its configuration, it reads
  the package-private copy
  `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`
  and ignores the `%APPDATA%` file. Setup, doctor and uninstall use that
  private copy when it exists. Before the package has saved one, they use the
  `%APPDATA%` file it still reads; with neither file, setup creates the
  private copy.
- If `%LOCALAPPDATA%\Packages` holds a `Claude_<publisher ID>` package from
  another publisher, an `AnthropicPBC.Claude_<publisher ID>` package, or cannot
  be read, REA cannot establish which file Claude
  Desktop reads. Setup, doctor and uninstall report that instead of falling
  back to `%APPDATA%`. Doctor then reports `claude_desktop` as invalid, and
  uninstall stops before removing anything for any client.
  The reported `AnthropicPBC.Claude_fnn82j28hfe8t` build can use the `Claude-3p`
  deployment directory. REA recognizes that package as an unresolved location;
  it does not assume that it reads the legacy AppData file or automatically
  register in `Claude-3p`. See [#4432](https://github.com/morluto/rea/issues/4432)
  for the reported build and manual registration evidence.

Quit Claude Desktop fully before approving setup; closing its window is not
enough. A running Claude Desktop can rewrite its configuration from memory and
drop the registration. This was observed with the Windows MSIX build. Start
Claude Desktop again after setup. If the package saves its private copy after
setup planned to write the `%APPDATA%` file, setup makes no change and asks you
to rerun it.

A process that the MSIX app started, such as a terminal in Claude Desktop's
Code tab, sees the package's private files at their `%APPDATA%` paths even
though it reports no package identity. Setup compares one of those files at
both paths: first one from the package's private `Claude` folder, and when
that folder has none (some installations keep writing the real
`%APPDATA%\Claude`), one from the package's other private roaming folders,
which the package redirects in the same way. When it finds that redirected
view, the app is running, so setup and uninstall refuse to change Claude
Desktop's configuration; rerun them from a terminal that Claude Desktop did not
start. If the package keeps no private roaming file at all, setup and
uninstall cannot rule that out and also refuse. With Claude Desktop fully
quit, add REA's entry by hand to the file setup names, which is the one the
app reads, or remove it from both the private copy and the `%APPDATA%` file.
Doctor reads the same file from either kind of process.

The same process also writes everything under `%APPDATA%` and
`%LOCALAPPDATA%` into the package's private storage, where other apps never
read it. From that redirected view, setup and uninstall refuse to change other
clients' files there (VS Code, Trae, Devin and Hermes) and skill directories
there. `npm install -g` run from such a process installs into the package's
`LocalCache\Roaming\npm`, which other processes cannot see at the `%APPDATA%`
path. Setup refuses to register a launcher stored in any MSIX package's
private storage. Install REA from an ordinary terminal and rerun setup there.

Uninstall removes REA's entry from both the private copy and the `%APPDATA%`
file, including registrations that earlier releases wrote to `%APPDATA%`.

REA recognizes only the MSIX package. A non-MSIX Claude Desktop installed
beside it, which would read the `%APPDATA%` file, is not detected.

The package identity, both file locations, the redirected view, and these
setup and doctor results were observed on Windows 11 with the MSIX build
2.31226.1.0, using read-only `doctor` and `setup --dry-run` runs both inside
and outside the app. On that host, setup run from an ordinary terminal with
the app quit wrote the package-private copy; after the app restarted, the
entry was still present, doctor reported it aligned, and Claude Desktop's MCP
log showed REA starting and answering `tools/list`. Uninstall against the real
app is unverified.

## Claude Code

Claude Code normally defers MCP tool definitions through tool search. It
[turns tool search off](https://code.claude.com/docs/en/mcp#configure-tool-search)
when `ANTHROPIC_BASE_URL` points to a non-first-party host, such as DeepSeek's
Anthropic-compatible endpoint. It then sends every REA tool's name, description
and input schema with every request
([#2019](https://github.com/morluto/rea/issues/2019)). On main at 04089d5be,
with 172 tools, that payload measured about 496 KB with the default profile and
about 290 KB with `compact`. By the o200k and cl100k tokenizers, that is roughly
120k and 68k tokens. Compaction cannot remove tool definitions. If they nearly
fill the window Claude Code assumes, the context refills after every compaction
and Claude Code reports that autocompact is thrashing. To avoid this:

- Make Claude Code assume the model's actual context window. DeepSeek's Claude
  Code guide selects `deepseek-flash[1m]`; the `[1m]` suffix makes Claude Code
  assume a one-million-token window. For other unrecognized model IDs, set
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` to the window the provider documents.
- If the endpoint forwards `tool_reference` blocks, set `ENABLE_TOOL_SEARCH=true`
  to restore deferred loading. DeepSeek's Anthropic API guide does not list
  `tool_reference` among its supported content blocks, so this setting may cause
  its requests to fail.
- To shrink the upfront catalog, add
  `"REA_MCP_INPUT_SCHEMA_PROFILE": "compact"` to the `env` object of the
  `mcpServers.rea` entry in `~/.claude.json` (`$CLAUDE_CONFIG_DIR/.claude.json`
  when that variable is set), then restart Claude Code. Setup keeps this
  override.
- To remove entire tool families from the upfront catalog, run
  `rea setup --client claude_code --tool-families <ids>` with the families the
  workflow needs (see [the advertising scope contract](mcp-contracts.md#tool-family-advertising-scope)).
  Out-of-scope tools are not advertised and their calls fail with the SDK's
  disabled-tool error, so widen the selection when a task needs another
  family. Setup writes the scope into the entry's `env` as
  `REA_MCP_TOOL_FAMILIES`; rerun setup with a different selection to refresh
  it, then restart Claude Code.

The sizes above come from REA's own `tools/list`. A live Claude Code session
against DeepSeek's API is unverified.

For a client whose stdio reader rejects the complete catalog frame, set
`"REA_MCP_OUTPUT_SCHEMA_PROFILE": "compact"` to bound every advertised output
schema, or `"off"` to omit them, in REA's `env` object, then restart the client.
Both keep canonical result validation and complete structured results; `compact`
keeps a widened root shape and `off` advertises nothing. On catalogs large
enough that full input schemas alone approach the frame limit, also keep the
input profile at its `compact` default. See [MCP output schema
profiles](mcp-contracts.md#output-schemas).

## Kimi Code

Setup registers `rea` in `~/.kimi-code/mcp.json`, or
`$KIMI_CODE_HOME/mcp.json` when set, while preserving unrelated settings and
creating a `.rea.backup` before updating an existing file. Kimi Code infers
stdio from the `command` entry, so setup does not add a `type` field. New
registrations include `startupTimeoutMs = 30000` and a `toolTimeoutMs` derived
from REA's known provider allowance plus 120 seconds of operation
headroom. The default is 450000 ms, covering the default 330-second Ghidra
startup; an explicit Ghidra startup timeout of 2700000 ms produces a 2820000 ms
tool timeout. The startup allowance follows an explicitly selected Ghidra or
Hopper provider, and otherwise uses the larger known Ghidra/Hopper deadline.
An explicit `REA_JEB_MCP_TIMEOUT_MS` deadline, shared by catalog discovery and
each tools/call, also contributes to that maximum. An explicit `REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS` is added to the Ghidra startup allowance, because a single-decompile call can import the target and then decompile up to that limit; setup forwards it into the registration. For `ida` or `auto` selection, a valid IDA registration's parsed
`timeoutMs` also contributes to that maximum; its default is 300000 ms.
The derived value is a single-decompile estimate, not a deadline for an
unbounded batch. For example, startup 330 seconds plus two 600-second
decompiles and 120 seconds of headroom needs an estimated 1650 seconds,
before any additional listing or output work. Select the client tool deadline
for the intended workload, split `batch_decompile`, use `decompile_all`
limit/resume, or reduce `trace_native_values` `max_functions`. The trace can
decompile several functions serially; its depth and graph budgets do not
make the single-decompile allowance a whole-traversal deadline. Existing positive caller deadlines are preserved.
Setup forwards these explicitly selected REA deadlines and the input schema
profile into the registration; unrelated process values are omitted. An
explicit `REA_JADX_OPERATION_TIMEOUT_MS` is forwarded with the JADX
registration but does not contribute to the derived tool timeout; raise
`toolTimeoutMs` to cover a longer selected JADX deadline.
This headroom is a practical default, not a guarantee for every analysis
duration. Setup preserves positive timeout values already in the `rea` entry.

Setup also forwards explicitly selected input/output schema profiles,
`REA_MCP_MAX_RESPONSE_BYTES`, `REA_MCP_MAX_INPUT_ELEMENTS`, provider paths and supported Ghidra, JADX and Kuna
settings. It also forwards explicit executable and resource selections for ADB,
apktool, packet capture, GDB/Rizin/objdump, Cutter, WABT, Wakaru, firmware and
signal tools, browser inspection, and pwntools/pwndbg. This includes their
supported prlimit overrides, Darwin Swift compiler/SDK/module-cache selections,
and compile timeout, logging level and explicitly configured reference-secret
patterns. A provider being unavailable does not discard its selected paths;
doctor reports its readiness separately. Explicit selections override discovered
defaults, including when setup runs again with a changed selection. Unrelated
environment variables, process ownership tokens and one-shot target paths are not
copied. For an explicitly configured startup target, see the
[initial-target settings](mcp-contracts.md#initial-target-at-startup). Existing
client environment overrides remain intact unless setup supplies the same key.
You can edit `startupTimeoutMs` and `toolTimeoutMs` there; doctor keeps positive
caller-selected values aligned and reports a non-blocking advisory when a tool
timeout is shorter than the known provider allowance.
Setup selects the compact input-schema advertisement for new or refreshed Kimi
registrations unless their stored configuration or setup environment explicitly
selects `REA_MCP_INPUT_SCHEMA_PROFILE=full` or `compact`. This keeps REA's
canonical tool validation unchanged while avoiding a Moonshot Kimi Code 2.2.0
failure observed with the full catalog: its request was rejected because a
single tool schema exceeded the provider's size limit. The limit is
provider-specific and not an MCP protocol limit. `rea doctor --client kimi`
reports an older registration with no explicit profile as stale. To restore the
compact profile, run `rea setup --client kimi` or add
`REA_MCP_INPUT_SCHEMA_PROFILE=compact` to the registration's `env`, then restart
Kimi Code. An explicit `full` profile remains respected and can still exceed
Moonshot's limit.
Kimi Code also discovers personal skills in `~/.agents/skills` and project-local
`.agents/skills`, so no separate skill root is required; setup still installs
and verifies the matching skill files through the normal shared-skill flow.
Start a new Kimi Code session to pick up MCP and skill changes.

## Pi

For [Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md),
setup writes a `type: "stdio"` entry under `mcpServers.rea` in the user-level
`~/.pi/agent/mcp.json` and installs the bundled skill under `~/.agents/skills`.
Use `rea setup --client pi --dry-run --json` to inspect the plan, then
`rea setup --client pi --yes --json` to approve it. Check the registration with
`rea doctor --client pi --json`. Pi reads `mcp.json` as strict JSON, like its
own loader: comments, trailing commas, a byte-order mark, or an empty existing
file are invalid, and setup reports them instead of rewriting the file. Repair
such a file to plain JSON first, then rerun setup.

Setup follows Pi's `PI_CODING_AGENT_DIR`: unset or empty selects the default;
`~` and `~/` expand to the home directory; absolute paths and file URLs select
that directory; relative paths stay relative to the command's working directory.
On Windows, native paths, `~\`, and Git Bash/MSYS, Cygwin, and WSL drive paths
are normalized as Pi does. Run REA and Pi from the same working directory when
using a relative override. Pi has no profiles: `OMP_PROFILE`, `PI_PROFILE`,
`PI_CONFIG_DIR`, and OMP's `enabledServers`/`disabledServers` lists do not affect
Pi registration. Doctor accepts an omitted `type` for stdio but reports a
non-stdio type as invalid; `enabled: false` stays disabled.

REA configures only the user scope. Pi also reads `.pi/mcp.json` in trusted
projects; a same-name project entry can replace the user entry or override its
enabled state and exposure. Check that file if the user registration is aligned
but unavailable in a project. An extension that registers `/mcp` can replace
Pi's built-in MCP support and use its own configuration instead. Run `/reload`
in an existing Pi session after changing servers outside the session.

## Qwen Code

For Qwen Code, setup registers `rea` in the `mcpServers` table of the
user-level `~/.qwen/settings.json`, or `$QWEN_HOME/settings.json` when configured.
Setup and doctor follow Qwen Code's tilde and working-directory-relative home
overrides. Qwen Code also discovers personal skills in `~/.agents/skills`,
where setup installs the bundled workflow.

If an existing direct-script registration fails with `env: node: No such file or
directory`, refresh it through setup as described under [Launchers and PATH](#launchers-and-path).
For an immediate Qwen-specific workaround, when Node is installed in
`/opt/homebrew/bin`, add `"PATH": "/opt/homebrew/bin:${PATH}"` to that server's
existing `env` object and restart Qwen. Qwen expands `${PATH}` from its parent
environment; other clients can use different substitution syntax. Qwen's stdio
launcher inherits the parent `PATH` and applies server overrides; a reduced
parent environment does not establish that Qwen removed Homebrew from it.

## Antigravity

Antigravity 2.0 discovers personal skills in `~/.gemini/config/skills`.
Setup installs its selected skill copy there.

## Gemini CLI

Gemini CLI uses `$GEMINI_CLI_HOME/.gemini/settings.json` when that home override
is nonempty, including its shared personal skills at
`$GEMINI_CLI_HOME/.agents/skills`. Setup and doctor check MCP allow/exclude
policies from system defaults, user settings, trusted workspace settings, and
system overrides. Workspace trust follows `GEMINI_CLI_TRUST_WORKSPACE`,
`GEMINI_RESTRICTED_MODE`, the effective `security.folderTrust.enabled` setting,
and the selected `trustedFolders.json` (including
`GEMINI_CLI_TRUSTED_FOLDERS_PATH`). Settings in an untrusted workspace do not
participate. A workspace or system `mcpServers.rea` replaces the entire user
entry; setup stops if the winning definition conflicts with its planned entry.
Setup checks user policy against the file snapshot it is inspecting or about to
update, including confirmed absence; an earlier discovery snapshot does not veto
a repaired user policy. Independent system and workspace sources are still checked.
Review those files manually: setup never edits administrator/workspace settings
or grants workspace trust. Trust supplied only by a running IDE is outside this
standalone CLI check.

A model API's `400 INVALID_ARGUMENT` alone does not identify a rejected schema,
tool-count limit or skill defect. Preserve the response's parameter path and
diagnostic, the actual running REA version, Gemini CLI version and selected
model. For schema rejection, review the [input presentation profiles](mcp-contracts.md#compact-input-schema-profile)
and reconnect after changing REA's registration environment. Compact is the
current default; an explicitly stored `full` choice is preserved. The generic
error in [#4620](https://github.com/morluto/rea/issues/4620) does not establish
which constraint failed, and local schema checks do not prove live API acceptance.

## Codex and Devin

REA manages its launcher and selected provider settings in the client
registration. Codex's server and per-tool approval policies are user choices.
Setup patches REA's connection fields in the selected file and retains other
server settings, including `default_tools_approval_mode`, nested
`[mcp_servers.rea.tools.<name>]` tables, tool allow/deny lists, and unrecognized
client settings. Doctor accepts Codex's per-tool policy tables. Known malformed
policy values block setup before it writes the configuration or a backup, and
the diagnostic identifies the setting to repair. See the
[Codex configuration reference](https://developers.openai.com/codex/config-reference/)
for the supported policy values.

When direct launcher paths prove the same executable or Node entrypoint,
setup retains the existing caller-selected spelling. An otherwise aligned
registration therefore needs no rewrite or recovery backup merely because
REA was invoked through another symlink. Setup also retains that spelling when
another field, such as an invalid timeout, needs repair. Unresolved identity
does not prove equivalence.

| Settings                                    | Setup ownership                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Launcher, transport and activation          | Refreshes the REA stdio connection and enables it.                                      |
| Explicit server environment                 | Preserves configured overrides and merges selected provider settings.                   |
| Codex timeouts                              | Retains positive values; repairs missing or invalid values to recommended REA defaults. |
| Codex approval policies and tool selections | Retains caller choices; refuses known malformed values.                                 |
| Unrelated or future server settings         | Retains their parsed values.                                                            |

Dry-run applies the same policy validation and writes no files. A successful
refresh keeps an exact recovery snapshot of the original configuration;
repeating setup with the same settings performs no write. Uninstall removes
the owned REA entry, including its policy, while retaining other servers and
the recovery snapshot. A green registration check establishes known
configuration alignment; it does not prove that a particular client or fork
successfully exposes every REA tool.

Codex treats an unset or empty `CODEX_HOME` as `~/.codex`. Its MCP server
registration supports `startup_timeout_sec` for connection initialization and
`tool_timeout_sec` for each tool call. New REA registrations use a 30-second
startup timeout and a tool timeout derived from the known provider
allowance plus 120 seconds of operation headroom. This yields 450 seconds for
the default Ghidra allowance; an explicit Ghidra startup timeout of 2700
seconds yields 2820 seconds. That 30-second Codex figure is client guidance.
REA's own phase budgets are `REA_MCP_INITIALIZE_BUDGET_MS` (default 15000),
`REA_MCP_TOOLS_LIST_BUDGET_MS` (default 5000),
`REA_MCP_FIRST_CATALOG_BUDGET_MS` (default 20000), and
`REA_MCP_DOCTOR_DEADLINE_MS` (default 30000). Each is a positive decimal
integer of milliseconds from 1 to 2147483647. Unset keeps the default.
Invalid values fail configuration and name the setting. Setup copies a
caller-selected value into the registration, and a change is read from the
environment that starts REA, so it needs a restart. Doctor and packaged
startup probes name the effective milliseconds, whether they came from the
default or the setting, the default, the floor, and the maximum. REA does
not enforce Codex's 30 seconds as the doctor deadline. The 120000 ms
tool-operation headroom and the 64 KiB doctor stderr cap stay fixed. Setup preserves positive caller-selected timeout
values in the REA entry, and doctor reports a non-blocking advisory when a tool
timeout is shorter than the known provider allowance. An explicitly selected
JEB request budget also contributes to the allowance, and an explicit
`REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS` is added to the Ghidra startup
allowance. A configured IDA
registration's parsed `timeoutMs` contributes for `ida` or `auto` selection.
An explicit `REA_JADX_OPERATION_TIMEOUT_MS` is forwarded with the JADX
registration but does not contribute; raise `tool_timeout_sec` to cover a
longer selected JADX deadline.
These values are client-side deadlines, so increase them in `~/.codex/config.toml` if a
workload needs more time. Devin honors `XDG_CONFIG_HOME` for its
`devin/mcp_config.json` on non-Windows systems.

### Codex with Moonshot or Kimi models

An older REA input containing acyclic local references was rejected by a
Responses-compatible Kimi gateway as “infinite recursion”; expanding those
references succeeded. A separate full-profile input failed the provider's
schema-size limit. These are distinct reported failures, not proof that the
canonical schema is recursive. Current REA inputs are already self-contained;
see [schema advertisement](mcp-contracts.md#schema-advertisement).

For this failure, inspect the active MCP launch command and refresh the REA
installation that command actually runs. A configured package selector or the
installed skill version alone does not identify a cached or still-running
server. Follow [installation and update guidance](installation.md#diagnose-update-and-remove).
Then merge this setting into the REA entry in `$CODEX_HOME/config.toml`
(`~/.codex/config.toml` by default), preserving its launcher and other settings:

```toml
[mcp_servers.rea.env]
REA_MCP_INPUT_SCHEMA_PROFILE = "compact"
```

If that table already exists, add or update the key there. Restart/reconnect
Codex so REA reads the new environment. Compact is now REA's default, but an
explicit `full` override remains effective until changed. It preserves the
tool inventory and canonical server validation while reducing advertised input
detail. The probes in [#5160](https://github.com/morluto/rea/issues/5160) covered
individual tools through one gateway, not the entire current catalog or a
model-driven analysis workflow.

## OMP

For OMP, setup writes a `type: "stdio"` entry to the user-level
`~/.omp/agent/mcp.json`. A relative `PI_CONFIG_DIR` selects a configuration root
under the home directory. For the default profile, `PI_CODING_AGENT_DIR`
overrides the agent directory; a relative value uses the setup working
directory. A named profile selected by `OMP_PROFILE` or `PI_PROFILE` instead
uses `<configuration-root>/profiles/<name>/agent/mcp.json` and ignores
`PI_CODING_AGENT_DIR`. Setup also removes
`rea` from that file's `disabledServers` list, which would otherwise hide the
registration. Doctor treats an `enabled: false` entry as active when
`enabledServers` lists `rea`, as OMP does, unless `disabledServers` also lists
it. Run setup under each profile that should load REA.

## Hermes

For Hermes, setup writes a `mcp_servers.rea` entry to `config.yaml`, preserving
comments and unrelated settings. It resolves that file from `HERMES_HOME`, else
from the platform default Hermes itself uses — `%LOCALAPPDATA%\hermes` on
Windows, `~/.hermes` elsewhere — including any `HERMES_DATA_DIR_SUFFIX`. Hermes
connects an entry unless `enabled` is false, so setup states `enabled: true`.
Aliases whose anchor is defined in the `rea` entry retain their original resolved
values when setup refreshes or uninstall removes that entry. Setup does not
redirect another server's alias to REA's new launcher or policy.
This also covers an anchor on the removed registration key. References to
definitions outside the entry keep sharing the original value, including when
another definition later reuses the same anchor name.

Hermes personal skills install under the active Hermes home's `skills` directory.
Setup, doctor and uninstall share REA's sticky-profile resolver.
A custom `HERMES_HOME` outside the platform default home
reads its own `active_profile`. An override physically inside the default home
uses that default home's sticky selection and profile root together, including
when the final override directory does not yet exist.

For example, with `HERMES_HOME=~/.hermes/sub` and `~/.hermes/active_profile` set
to `coder`, setup selects `~/.hermes/profiles/coder/config.yaml` and that
profile's skills directory. It does not read `~/.hermes/sub/active_profile`.
Without an outer named selection, this override uses `~/.hermes/sub/config.yaml`.
Use a home outside the platform default tree for an independent sticky selection.

This describes REA's current routing, not full Hermes CLI equivalence.
At Hermes commit `748c79a1`, the
[sticky lookup](https://github.com/NousResearch/hermes-agent/blob/748c79a1c6873124d84071cdabb4062a75913e1f/hermes_cli/main.py#L612-L632)
also reads the outer selection, but
[`resolve_profile_env`](https://github.com/NousResearch/hermes-agent/blob/748c79a1c6873124d84071cdabb4062a75913e1f/hermes_cli/profiles.py#L2431-L2461)
resolves it beneath the configured `HERMES_HOME`. For nested overrides, confirm
the profile Hermes actually uses and point `HERMES_HOME` directly at that
`profiles/<name>` directory before setup. Compatibility is tracked in
[#3939](https://github.com/morluto/rea/issues/3939).

REA resolves existing ancestor directories before checking physical containment,
including symlinks and junctions, even when the override directory does not exist.
An override beneath a symlinked default home therefore uses the default home's
sticky selection. If `~/.hermes/link` points outside the default home,
`HERMES_HOME=~/.hermes/link/new` instead uses that override root, whether or not
`new` exists. Previewed destinations retain the configured path spelling.
An unreadable path or dangling alias leaves the home unresolved; repair that path
before configuring Hermes. Inspect setup's previewed destinations before applying
changes.

An explicit `HERMES_HOME` pointing to `profiles/<name>` selects that named
profile directly, bypassing sticky selection. An invalid, missing or deleted
sticky profile is reported instead of writing into the default home; repair the
profile or run `hermes profile use default` before retrying. It also remains an
unresolved skill selection, so setup cannot report a successful empty installation.
REA follows `HERMES_HOME` whitespace trimming, environment-variable expansion,
and home expansion before resolving that profile. Setup previews the resolved
configuration and skill destinations; doctor and uninstall use those same paths.

## Qoder CLI

For [Qoder](https://docs.qoder.com/cli/mcp-reference), setup writes
`mcpServers.rea` into the user-level `~/.qoder/settings.json` (the
`QODER_CONFIG_DIR` override is honored). Entries carry `command`, `args`, and
`env`; stdio is the default transport. Qoder CLI discovers personal skills
from `~/.qoder/skills` (following `QODER_CONFIG_DIR` when set), so setup
installs its skill copy there.

## Factory Droid

For [Factory Droid](https://docs.factory.com/harness/mcp), setup writes
`mcpServers.rea` into the user-level `~/.factory/mcp.json` (the
`FACTORY_HOME_OVERRIDE` override replaces the home that contains `.factory`).
Entries carry `command`, `args`, and `env`. Droid discovers personal skills
from `~/.factory/skills` ([skills](https://docs.factory.com/harness/skills),
following `FACTORY_HOME_OVERRIDE` when set), so setup installs its skill copy
there.

## Trae

For [Trae](https://docs.trae.ai/ide/add-mcp-servers), setup writes
`mcpServers.rea` into the user-scope `mcp.json` under Trae's VS Code-style
user directory (`%APPDATA%\Trae\User` on Windows,
`~/Library/Application Support/Trae/User` on macOS, and
`~/.config/Trae/User` elsewhere). Entries carry `command`, `args`, and
`env`; stdio is the default transport. Trae discovers personal skills from
`~/.trae/skills` (`%userprofile%\.trae\skills` on Windows), so setup
installs its skill copy there.

The user-level MCP paths follow the editor's VS Code layout. Trae's official
documentation describes the raw JSON editor without specifying those paths;
loading this registration in Trae remains unverified.

## WorkBuddy

For [WorkBuddy](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide), setup writes `mcpServers.rea` into the
global `~/.workbuddy/mcp.json` (a standard `mcpServers` JSON file at the user
home root on every platform). Entries carry `command`, `args`, and `env`;
stdio is the default transport. WorkBuddy discovers personal skills from
`~/.workbuddy/skills` (`%userprofile%\.workbuddy\skills` on Windows), so
setup installs its skill copy there.

The global MCP path is a plain JSON file; setup preserves every other server
and top-level key when it upserts `rea`. WorkBuddy also reads a project-level
`<project>/.workbuddy/mcp.json`, which setup does not touch: it registers the
user-level file only. Loading this registration and real REA tool calls
through WorkBuddy are verified.

## ZCode

For [ZCode](https://zcode.z.ai/en/docs/mcp-services), setup registers `rea` in the nested `mcp.servers` table of the
user-level `~/.zcode/cli/config.json`. Entries carry `command`, `args`, and
`env` without a transport discriminator. ZCode discovers personal skills from
`~/.zcode/skills` rather than the shared directory, so setup installs its
skill copy there.

ZCode reads the user-scope `~/.agents/mcp.json` fallback only while the native
`.zcode` config defines no servers at all, with no merging. When setup writes
the first native server into an empty table, it copies the fallback's
`mcpServers` entries into the native table so they keep loading, and leaves
the fallback file untouched. Existing REA environment overrides are preserved
when refreshing its command. A malformed or unreadable fallback file fails setup instead of
being silently suppressed; repair or remove it and rerun. Uninstall removes an
REA-owned `rea` entry from both the native table and the fallback, backing up
each changed file. If removing the last native server would activate a retained
fallback server, uninstall refuses before changing either file; review the
fallback configuration before retrying. Other fallback servers, settings and a
foreign `rea` entry are kept. ZCode disables a
server with `enable: false` on its entry; doctor reports such a registration
as stale, and rerunning setup removes the flag to repair it. Native configuration
uses strict JSON; setup refuses comments, trailing commas and a BOM rather than
writing a registration ZCode cannot load.

## FreeBuff

For FreeBuff, the proposed integration writes `mcpServers.rea` into the user-scope
`~/.agents/mcp.json` shared-agent file. Entries carry `command`, `args`, and
`env`; stdio is the default transport. The proposed personal skill location is
`~/.agents/skills`, so setup installs its skill copy there. Because the same
file doubles as ZCode's user-scope fallback (see above), a `freebuff`
registration is also in the file ZCode uses until ZCode defines its own native server.
Setup and doctor detect FreeBuff from its own profile directory
(`~/.config/freebuff-desktop`), not from the shared `.agents` folder that
REA's skill installs create for every client.

The configuration write and personal skill locations are proposed integration
boundaries. FreeBuff MCP loading and skill discovery have not been verified
with an installed native FreeBuff client/version; filesystem tests cover REA's
editing, discovery, and ownership behavior only. Automatic applicability
requires the FreeBuff profile directory even when the shared MCP file exists.
When uninstall cannot establish FreeBuff or another shared-storage reader from
product discovery, a malformed or unreadable shared MCP file is retained
unchanged and does not stop other REA removals, including `--purge-data`. When
FreeBuff or ZCode product applicability is established or unresolved, the same
malformed shared file stops uninstall before removals. See
[Diagnose, update, and remove](installation.md#diagnose-update-and-remove).

FreeBuff setup support requires `rea-agents@6.8.0` or later. Older versions
reject `rea setup --client freebuff` as an unsupported client. See the
[installation guide](installation.md#supported-agents) for client availability.

## DeepSeek Harness

DeepSeek Harness registers MCP clients through a Cordis YAML patch sequence
rather than a `mcpServers` object. `rea setup --client dsh` appends (or
replaces) the REA entry in the home patch `$DSH_HOME/cordis.patch.yml`
(`~/.dsh/cordis.patch.yml` when `DSH_HOME` is unset), preserving unrelated
patches and comments. `rea doctor --client dsh` checks that same entry id.
`rea uninstall` removes it by scanning supported clients; uninstall takes no
`--client` flag. The home patch applies to every Harness profile, so the
registration is written once and no per-profile edit is needed.

Setup, doctor and uninstall resolve `DSH_HOME` and `DSH_AGENTS_HOME` as Harness
does: unset, empty or whitespace-only values use `~/.dsh` and `~/.agents`,
respectively. Bare `~`, `~/` and `~\` expand to the user home; other relative
values resolve against the command's working directory. Nonblank values retain
their original spaces, and the agents root is independent of the Harness home.
Run REA and Harness from the same working directory when using relative overrides.
The written entry is:

```yaml
- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: /absolute/path/to/node
        args: ["/absolute/path/to/rea/scripts/rea.mjs", mcp]
```

Setup preserves caller-owned Cordis expressions and replaces launcher fields
with literal values that doctor can verify. It refuses to edit an expression
that produces the entire REA config, or a group-targeted REA insertion. Use a
literal config and a root-level insertion as shown above.

For a global npm installation, the launcher is under
`$(npm root -g)/rea-agents/scripts/rea.mjs`. Restart Harness after setup; it
exposes tools as `mcp__rea__<tool_name>`. Run `rea setup --skill --dry-run`,
review the destination, then `rea setup --skill --yes` to install the workflow
in `~/.agents/skills` (`$DSH_AGENTS_HOME/skills` when configured); Harness
discovers that directory, and its native `skill` tool can load
`reverse-engineer-anything`.

REA's optional [native client verification](testing.md#end-to-end-integration-and-golden-evidence)
checks headless chat, skill loading, all tool input schemas and actual analysis
using the installed Harness and a local model fixture. This establishes the
Harness integration, with live DeepSeek API compatibility remaining unverified.
See the [Harness MCP guide](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/mcp/mcp-client/README.md)
for its native configuration contract.

## Other client settings

For OpenCode, setup writes the V1 `mcp.rea` entry, which OpenCode V1 and V2
both load. If the configuration already uses OpenCode V2's native
`mcp.servers` table, setup registers REA there instead and replaces any earlier
`mcp.rea` entry from REA. Setup honors `OPENCODE_CONFIG_DIR` and
`OPENCODE_CONFIG`, preferring the later-loaded JSONC file when both JSON and
JSONC exist. The ordinary XDG global configuration still participates when a
custom directory is selected. Doctor checks the merged user registration; uninstall removes
REA-owned entries from every applicable user file so an older entry cannot
become active again. Malformed applicable files block setup before changes.

Grok Build loads `[mcp_servers.rea]` from `$GROK_HOME/config.toml`, or from
`~/.grok/config.toml` when `GROK_HOME` is unset or empty. Setup edits that server
table, `[mcp_servers.rea.env]`, and a root `disabled_mcp_servers` entry that
names `rea`. It defaults `startup_timeout_sec` to 30 seconds, preserves an
existing positive timeout, and leaves every other name in that list.
[Grok supports longer startup timeouts](https://docs.x.ai/build/features/mcp-servers)
for cold package-runner launches. The shared skill installed under `~/.agents/skills` is already
on Grok Build's skill path.

Grok Bot (`grok_bot`) is detected from `~/.grokbot`, or from `SAND_DATA_ROOT`
when that value is an absolute path. A relative or empty `SAND_DATA_ROOT`
stays on `~/.grokbot`. That directory is not the connector store. Grok Bot
keeps connectors in the signed-in account and runs them on its hosted
computer. It does not import `mcp.json` from the data directory, and it does
not attach a stdio server running on this machine. Setup does not call the
account connector API, does not write a registration file, and does not report
the data directory as aligned. Ask the Grok Bot chat to add a custom MCP
server named `rea` that runs on the Bot's computer:

```bash
npx -y rea-agents@<version> mcp
```

Do not put credentials in that command or its arguments. `rea doctor --client grok_bot`
reports this manual step. `rea uninstall` does not remove the account connector.

## Skill selection and maintenance

OpenCode's selected configuration layers determine the registration dialect.
If any loaded layer uses native `mcp.servers`, setup writes a native REA entry
in the selected upper file even when that file is absent or has no MCP table.
Legacy activation is normalized before layer merging, so an explicit enable
can override an inherited disable. Lower files and other server entries remain
unchanged; a legacy server named `servers` that conflicts with the native table
requires manual repair before setup can write.

With no client selected, the interactive skill choice targets the shared
`~/.agents/skills` copy. Selecting a client targets its personal destination
when supported. Use `rea setup --skill-client shared --skill` for the shared
copy, or `--skill-client claude_code --skill` for that client's copy. Setup
resolves the final selection before deciding which files need installation.
Doctor retains each selected stale or missing path and names the matching
repair command; a current copy elsewhere does not establish freshness.

Unresolved profile or directory selections remain diagnostics and never become
write targets. Update maintenance considers only known enabled, owned REA
registrations and owned skills. If identity or a selected skill root is
unresolved, it reports maintenance as unavailable with the known scope and
remaining diagnostics. An empty writable scope alone does not prove current.

When configuration publication fails, setup retains the affected path, operation
and available filesystem code in the client result. Owner/group and mode
preservation failures identify that operation rather than implying that the
configuration bytes or parent directory are unwritable. Setup preserves the
original and reports its recovery backup; review local ownership and group
membership before retrying.

For an installed POSIX CLI, setup prefers an executable absolute `rea` alias
from its selected `PATH` when filesystem identity proves that it names the
running REA entrypoint. This keeps package-manager aliases intact instead of
persisting an internal versioned script path. Unresolved aliases and wrappers
that are different files do not establish that proof; setup retains its selected
entrypoint. A manager-specific upgrade remains subject to that manager's alias
policy.

# Installation and setup

Run REA, connect your selected agents, and check the tools needed for your task.
Setup previews configuration changes and asks for approval before applying them.

| Task                               | Section                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| Connect an agent                   | [Start setup](#start-setup), then [review changes](#review-setup-changes)                           |
| Install a Claude Code/Codex plugin | [Agent plugins and marketplaces](#agent-plugins-and-marketplaces)                                   |
| Diagnose one task                  | [Scoped readiness checks](#check-readiness-for-your-task)                                           |
| Configure an analysis engine       | [Hopper](#hopper), [Ghidra](#ghidra), the [IDA guide](ida-provider.md), or [Kuna](kuna-provider.md) |
| Update or remove REA               | [Maintenance](#diagnose-update-and-remove)                                                          |
| Resolve a client-specific problem  | [Client configuration](client-configuration.md)                                                     |

## Start setup

```bash
npx rea-agents setup
```

Choose the agents to configure, review the proposed paths and changes, and
approve the plan. npm's package-download approval and REA's setup approval are
separate. Setup asks before changing agent configuration or installing Hopper.
Restart the agents named in the completion message. Quit Claude Desktop fully
before approving, because a running app can overwrite the registration; on
Windows, see [where Claude Desktop reads its configuration](client-configuration.md#claude-desktop).

During package resolution, npm may print a deprecation warning for `prebuild-install`
from transitive native dependencies (such as Frida). This warning originates from
the upstream dependency tree and does not affect REA or indicate setup failure.

For the latest published release, use `npx rea-agents@latest setup`.
[Package-runner and global-installation options](#package-runners-and-global-installation)
cover explicit versions, Bun, runtime requirements, and the curl wrapper.

## Review setup changes

`rea setup` first offers the supported agents in a multi-select. Existing REA
registrations are selected by default. Newly detected clients remain available
but unselected: detection gives setup context, not permission to add a new
registration. Clients without a detected configuration can still be selected.
Explicit `--client` flags skip this question.

Setup adds MCP access for selected clients. It installs REA's bundled workflow
with those integrations by default; use `--skill=false` to omit it. If no agent
is selected, setup offers the workflow separately for CLI use, with No as the
default. Hopper is a separate optional choice: setup shows its proposed
installation or connection and requires its own explicit approval. It can also
save verified paths for an existing Ghidra installation.

After selection, review the plan's exact paths and changes and approve before
REA writes files or installs Hopper. You can cancel at any prompt.

Before applying changes, REA checks your current configuration. The plan lists:

- an existing Hopper installation, a verified existing Ghidra installation, or the official Hopper package it proposes to install;
- each detected agent configuration path;
- each selected REA skill destination;
- external software, network origins, integrity evidence, and package-manager
  commands.

Malformed or unsafe existing configuration blocks the whole transaction before
Hopper installation or any file write. Declining or pressing Ctrl-C makes no
changes. Client configuration files and bundled skill files have separate
publication and recovery paths; the guarantees in this paragraph apply to
client configuration. See [skill destinations](#skill-destinations) for skill
rollback limits. Agent configuration writes preserve unrelated entries and comments,
create backups, stage changes in a private directory, and verify their result.
Before publication, they refuse detected changes to the selected configuration.
Replacement uses an explicit destination under the selected canonical parent;
it does not follow a newly inserted destination symlink. First-run setup uses
an exclusive hard link and fails without overwriting a newly created destination;
filesystems without hard-link support cannot publish a first-run configuration.
Setup and uninstall retain an existing `.rea.backup` rather than replacing the
first snapshot.
If that snapshot differs from the current configuration, setup and uninstall
preserve a verified `.rea.backup.<sha256>.recovery` copy of the current bytes
before editing; setup also previews it. Both snapshots remain available.
When an edit made a backup, a failed uninstall update or restore, and a failed
setup readback or rollback, name the backup path that holds the bytes from just
before that edit.
If setup cannot verify a newly created configuration, it retains the file and
reports manual recovery instead of deleting a pathname that may have changed.
For an existing configuration, setup and uninstall recovery refuse a detected
replacement or edit and name the recovery backup. Quit clients before editing their configuration;
these checks do not lock out another writer modifying the same file in place,
or exclude pathname changes between the final check and publication.
Setup refreshes an existing `rea` registration only when its launcher proves REA
ownership. Foreign or unresolved launcher identity blocks setup before any
backup or write, including an OpenCode legacy entry that migration would remove.
Review the existing launcher and manually rename or remove that registration to
approve replacing it. A different existing installation path is foreign to the
current entrypoint; a path that cannot be resolved remains unknown. Cordis uses
its stable REA entry ID instead of launcher identity.
Setup also retains valid environment overrides in REA's existing server entry,
such as `REA_MCP_INPUT_SCHEMA_PROFILE`, `REA_MCP_OUTPUT_SCHEMA_PROFILE`, and
`REA_MCP_MAX_RESPONSE_BYTES`, and `REA_MCP_TOOL_FAMILIES`.
Detected provider settings replace only matching environment keys.
Setup manages REA's launcher, selected provider settings, and recommended timeout
defaults. Codex approval policies, tool selections, and other caller-owned server
settings are preserved. Known malformed policy values block setup before it
writes the configuration or a backup; see
[Codex settings preservation](client-configuration.md#codex-and-devin).
Setup and doctor report a malformed REA environment map or invalid runtime
setting before setup writes files. Repair the named setting in the client
configuration; setup does not silently discard the rest of the map.
This includes malformed loader/exclusion JSON arrays and a Ghidra compiler
specification without its required language identifier. Valid overrides keep
their original strings, including empty Hopper arguments. DeepSeek Harness
`!!js` environment expressions remain unevaluated and preserved; registration
alignment does not verify the runtime values those expressions will produce.
For layered OpenCode files, each file's values are checked before merging, while
setting dependencies are checked against the effective merged environment.
Setup preserves each layer's overrides instead of copying inherited settings
into the file it updates.

After setup, REA reports which agents, analysis tools, and workflow files passed
its final checks. Restart any agent named in the completion message, then begin
your investigation. Failed steps and diagnostics remain in terminal history.

Select exact clients in scripts with repeatable `--client` flags. Each explicit
client skips interactive selection. Use `--all-detected` only when you intend
to configure every detected supported client. Combining `--client` with
`--all-detected` configures both the explicitly selected and detected clients,
even when an explicit client is not detected. Each client is configured once.
`--skill=false` omits the workflow, and `--dry-run` returns a read-only plan
with status `planned` and exit code 0:

```bash
rea setup --client codex --client cursor --skill=false --dry-run
```

Prompt UI and progress are written to stderr so stdout remains available for
structured results and pipelines. `NO_COLOR=1` disables color. Use
`--accessible` for sequential, vertically rendered yes/no prompts. Implicit
interactive setup requires stdin, stdout, and stderr to all be terminals; when
any stream is redirected, setup stays non-interactive. Declining or cancelling
returns status `cancelled` with exit code 0.

For automation, `rea setup --json` reports the plan and a compact `.doctor`
readiness projection without applying it. Use `rea doctor --json` for full
health diagnostics and canonical tool catalog details. Pair
`--yes` with explicit scope such as `--client codex`, or use
`--all-detected` when the broad scope is intended. Without a scope flag,
`--yes` is limited to existing REA-owned registrations; it does not select all
detected clients. An unapproved actual apply reports `needs_confirmation` and
exits 1. Installing missing Hopper non-interactively additionally requires
`--install-hopper`:

```bash
rea setup --yes --all-detected --install-hopper --json
```

Client configuration writes detect changes to the file read by setup, including
when a matching recovery backup already exists. A detected conflict reports
`reason: "conflict"` and preserves the newer file; review it and rerun setup.
Rollback likewise requires the file identity and content installed by that
transaction. Requests for the same resolved path are serialized within one REA
process. These checks do not provide an operating-system compare-and-swap or
coordinate arbitrary external writers, so avoid editing client configuration
while setup is applying it.

### Skill destinations

The bundled skill is installed in each selected client's personal skill directory.
See [client configuration](client-configuration.md) for client-specific roots,
profiles, and environment overrides. A mixed selection plans each distinct
destination. Selecting the skill without a client uses `~/.agents/skills`.
Setup leaves existing skill copies in other locations untouched.
Setup refuses symbolic links at the selected skill directory or its managed
`references` directory, matching uninstall and update's ownership rules. Use a
regular skill directory, or select `--skill=false` to configure the client
registration without installing the bundled skill. A non-directory ancestor is
reported as `ENOTDIR`; preserve the blocking file and correct the directory path
before rerunning setup.
The final selected directories are checked before approval and again before
setup changes any client or Hopper installation. Unselected client destinations
do not block other setup choices. Doctor reports linked or non-directory skill
paths as `unmanaged`, names the affected paths, and provides those alternatives;
an unreadable skill identity remains `unknown`. Uninstall retains and reports
files it cannot safely remove, including their ownership manifest.

The skill installer preserves byte-exact backups of changed existing files,
including invalid UTF-8, BOMs, and permission modes, and verifies each published
file through its owned descriptor. Before publication it checks the selected
file identity; first installation uses an exclusive hard link and refuses a
concurrently created destination. Filesystems without hard-link support cannot
publish a first-install skill file.

Rollback restores an existing file only while its published identity, state,
and bytes still match that installation attempt. A recovery backup preserves
the original bytes; it does not authorize overwriting a later user edit or
replacement. Conflicts report the affected paths and recovery backups. If a
newly created skill file cannot be verified, setup retains it and reports manual
recovery rather than deleting by pathname. Staging cleanup failures remain
owned and retryable, and setup does not report installation success while
cleanup is unresolved.

These checks do not lock out another writer modifying the same inode or exclude
pathname changes between the last check and publication. Avoid editing managed
skill files or running another installer while setup applies them.

`rea setup --skill-client claude_code --yes --json` refreshes and verifies the
selected skill destination independently of MCP registration selection. The
final `doctor.scope.skill_clients` records which skill destinations were
checked; `doctor.scope.clients` continues to describe required registrations.
An unselected shared skill does not affect a client-only refresh.

`doctor --skill --json` verifies the selected copies against the bundled
instructions and references. Consumers should use `identity.skill.state`,
`installed_version`, and `installed_tool_count` for skill readiness. The
obsolete `installed_catalog_digest` field has been removed; current catalog
identity remains available at `identity.catalog`.

Setup pins package-runner MCP registrations to the exact installed REA version,
installs the matching skill and on-demand references in the same plan, and adds
`startup_timeout_sec = 30` for Codex and Grok Build when no positive timeout
is already configured. Codex also receives a
`tool_timeout_sec` derived from known provider startup plus operation headroom.

## Limit REA to one project or agent profile

Setup registers REA for the whole client. For Claude Code it writes
`mcpServers.rea` in `~/.claude.json` and installs the bundled skill under
`~/.claude/skills`, so every project that Claude Code opens can call REA. To
offer REA's tools only where they're wanted, use one of the routes below.

Both routes control which sessions discover REA's MCP server and skill. They
leave shell commands, filesystem access and network access available. An agent
under the same OS account can run `rea` from `PATH` or `npx` and read other
profiles and REA output. For clean-room separation, use an implementation
environment with filesystem and network restrictions that prevent reading or
fetching REA, the target and analysis output, including through shared
installations and package registries. A separate account or container must
enforce those restrictions.

For Claude Code, check existing default-profile state before choosing either
route. Setup is additive: a previous user-level REA registration and personal
skill remain active in other projects. Back up the default configuration and
REA skill first, then, with `CLAUDE_CONFIG_DIR` unset, remove the REA user
registration with `claude mcp remove --scope user rea` and remove the known
REA-installed `~/.claude/skills/reverse-engineer-anything` directory. Preserve
unrelated registrations and skills. `rea uninstall` applies to other clients
as well, so it is broader than this Claude-only migration.

**A separate Claude Code profile.** Claude Code keeps settings, skills and session
history under `CLAUDE_CONFIG_DIR`. Setup follows the same
variable: it writes the registration to `$CLAUDE_CONFIG_DIR/.claude.json` and
the skill to `$CLAUDE_CONFIG_DIR/skills`.
For REA setup, an empty `CLAUDE_CONFIG_DIR` is treated as unset: registration
goes to `~/.claude.json` and the skill goes to `~/.claude/skills`.

```bash
CLAUDE_CONFIG_DIR=~/.claude-rea npx rea-agents setup --client claude_code
CLAUDE_CONFIG_DIR=~/.claude-rea claude
```

A new profile may need authentication. Console sign-ins without an API key are
stored outside `CLAUDE_CONFIG_DIR`; see
[Claude Code authentication](https://code.claude.com/docs/en/authentication#log-in-with-multiple-accounts).
Sessions started without the variable use the default profile's registration,
skill and history.

Inline assignments apply only to that command. Keep the same prefix for every
profile check, setup rerun, update, or removal; bare commands use the current
environment and can otherwise inspect or recreate default-profile state:

```bash
CLAUDE_CONFIG_DIR=~/.claude-rea claude mcp list
CLAUDE_CONFIG_DIR=~/.claude-rea npx rea-agents doctor --client claude_code --skill --json
CLAUDE_CONFIG_DIR=~/.claude-rea npx -y rea-agents@latest setup --client claude_code --dry-run
```

After reviewing an update plan, rerun that same prefixed setup command without
`--dry-run` and approve its exact changes. Profile removal likewise needs the
prefix on `claude mcp remove --scope user rea` and any `rea uninstall` command;
keep the broader client scope of uninstall in mind. Restart the selected
profile after changing its registration.

`claude mcp remove` removes only the registration. To remove REA from this
profile without running the broader uninstall flow, first back up the profile's
REA-managed skill directory, then remove
`$CLAUDE_CONFIG_DIR/skills/reverse-engineer-anything` as well. Keep other skills
in the profile intact.

The commands above use POSIX shell assignment syntax. In native Windows
PowerShell, select the profile for the whole setup/launch/check session and
restore the previous selection afterward:

```powershell
$previousClaudeConfigDir = $env:CLAUDE_CONFIG_DIR
try {
  $env:CLAUDE_CONFIG_DIR = Join-Path $HOME ".claude-rea"
  npx rea-agents setup --client claude_code
  claude mcp list
  npx rea-agents doctor --client claude_code --skill --json
  npx -y rea-agents@latest setup --client claude_code --dry-run
  # After reviewing the plan, repeat setup without --dry-run and approve it.
  claude
  # Profile removal, when intended, also belongs inside this selected scope:
  # claude mcp remove --scope user rea
} finally {
  if ($null -eq $previousClaudeConfigDir) {
    Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue
  } else {
    $env:CLAUDE_CONFIG_DIR = $previousClaudeConfigDir
  }
}
```

Use PowerShell for these Windows examples rather than pasting POSIX assignments
into cmd.exe. Keep profile updates, readiness checks and removal inside the
same selected environment; the `finally` block restores the previous profile
or unsets the variable when it was absent.

**One project.** Install without configuring Claude Code: use the curl
installer's `--no-setup`, or run setup only for other clients. Then register
REA from the project directory at Claude Code's local scope.

This route uses the default Claude profile. Keep `CLAUDE_CONFIG_DIR` unset for
the entire local lifecycle: registration, backup, listing, version replacement
and removal. In POSIX shells run `unset CLAUDE_CONFIG_DIR`; in PowerShell run
`Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue` before these
commands. Record an existing selection first if you intend to restore it after
finishing. The configuration path below is the default profile's
`~/.claude.json`; a different active profile uses its own config root instead.

Register with the variable unset, substituting the absolute runtime and entry
script from your existing installation or setup dry-run:

```bash
claude mcp add --scope local rea -- "/absolute/path/to/node" "/absolute/path/to/rea/scripts/rea.mjs" mcp
```

On native Windows, use the same project directory and absolute paths:

```powershell
claude mcp add --scope local rea -- "C:\Program Files\nodejs\node.exe" "C:\tools\rea\scripts\rea.mjs" mcp
```

Local scope stores the entry under that directory's path in `~/.claude.json`,
so other projects don't load it. This route doesn't install the bundled skill.
Avoid `--scope project`, which writes `.mcp.json` into the repository where it
can be committed or copied. `rea doctor` and `rea uninstall` read only the
user-level entry, so they don't report or remove a local-scope registration;
remove it with `claude mcp remove --scope local rea` from the same directory.
`rea update` doesn't refresh it either, so it continues using the selected installation.
To move it to a newer release, first back up the project entry in
`~/.claude.json` and record its environment and other metadata. In particular,
preserve caller-selected overrides such as `REA_MCP_INPUT_SCHEMA_PROFILE` and
`REA_MCP_MAX_RESPONSE_BYTES`, and `REA_MCP_TOOL_FAMILIES`. Run `claude mcp remove --scope local rea` from the
same directory, then recreate it with the platform-appropriate command above
and the new version. Reapply every recorded environment value with Claude
Code's `mcp add --env NAME=value` options and restore any other retained entry
metadata before restarting the project session. Removal and re-addition do not
preserve these values automatically. Running setup for Claude Code instead
would add a user-level entry for every project.

Check the separate profile with the prefixed `claude mcp list` above and compare
with the default profile with `CLAUDE_CONFIG_DIR` unset. For local scope, run
`claude mcp list` from the selected project and again from another project.

## Check readiness for your task

Run `rea doctor` when you need diagnosis. It reads host prerequisites and agent
configuration without changing them. Without options, it audits every detected
registration, the installed skill and optional analysis engines; its overall
`healthy` value can be false while your chosen workflow works.

Doctor's `providerInspections` are host-level engine and registration checks,
not a readiness row for every advertised MCP adapter surface. `tools/list`
remains the complete stable catalog. Call `binary_session` with `{}` before
choosing an operation; it works before a target is opened, and
`result.tool_availability` reports per-operation availability, reasons and
client requirements for the current session state. It does not guarantee that
a particular caller-supplied input will be valid. See
[MCP discovery](mcp-contracts.md#identity-and-discovery).

Select the part you want to check:

| Task                                | Readiness check                                                          |
| ----------------------------------- | ------------------------------------------------------------------------ |
| Static JavaScript/Electron analysis | Run `rea analyze-javascript-application PATH --json` directly.           |
| One analysis engine                 | `rea doctor --provider ghidra --json` (or `hopper`, `ida`, `kuna`)       |
| One agent registration              | `rea doctor --client codex --json` (see [client IDs](#supported-agents)) |
| Installed workflow instructions     | `rea doctor --skill --json`                                              |

A scoped report has `scope.mode: "explicit"`. Its `scope_checks` determine
`healthy` and the exit status. Other checks appear in `informational_checks`;
`environment_healthy` summarizes the full audit. `--target` adds a target check,
but the report remains audit-wide unless a scope option is also supplied.

An invalid `REA_LOG_LEVEL` fails every scope, including one client or the
installed skill, because the executable rejects it before any command. A
selected client also fails for every other setting that MCP startup rejects,
including `REA_GHIDRA_STARTUP_TIMEOUT_MS` and `REA_HOPPER_STARTUP_TIMEOUT_MS`.
Those settings still fail a selected provider and the audit-wide result. A
skill-only report leaves them informational.

Follow the remediation for the failed check. If a native target has several
available providers, choose one with `--provider` on the CLI or `provider_id`
on `open_binary`. A `capability_unavailable` failure carries
`details.selection_reason`: `ambiguous` asks you to choose from
`details.candidate_ids`, while `provider_unavailable` asks you to repair the
selected engine. See [provider selection](cli.md#choose-a-provider).

### Linux owned-process prerequisite

On Linux, REA's shared process supervisor requires a procps-compatible `ps`
on REA's `PATH` for ownership checks before launching a child. Ghidra, JADX,
firmware tools and static JavaScript/Electron analysis use these checks.
Install your distribution's `procps` or `procps-ng` package, or put another
procps-compatible `ps` on `PATH` before
running those workflows. A missing or incompatible command causes a refusal
before the supervised child starts.

The public error code varies by caller: `capability_unavailable`,
`provider_unavailable` or `execution_failure`. Some provider adapters report
only a generic startup error. Check this prerequisite before following
provider-specific recovery advice.

`binary_session` still returns status on such a host. Providers whose
readiness check reaches the owned-child launch, such as Ghidra's Java probe,
JADX and Apktool, report themselves unavailable with a reason naming the
missing `ps`. A provider that fails an earlier configuration check, such as
JADX without `REA_JADX_MCP_JAR`, keeps that reason. The other providers keep
their own status. `open_binary` keeps the refusal described above.

## Diagnose, update, and remove

`rea doctor --json` is strictly read-only. `rea update` updates only the npm or Bun global installation that owns the running CLI. Source checkouts and package-runner copies must be updated through the mechanism that owns them; a fresh package-runner invocation can use `npx rea-agents@latest` or `bunx rea-agents@latest`. `rea uninstall` removes only REA-owned agent registrations and skill files; `--purge-data` additionally removes REA cache and state paths.

```bash
rea update
rea uninstall
rea uninstall --purge-data
```

Uninstall preserves Hopper, Node.js, Evidence files, captures, unrelated skills
and other MCP servers. Purging removes REA's legacy cache and state under
`~/.rea`, the default Kuna cache (`~/Library/Caches/rea/kuna` on macOS or
`${XDG_CACHE_HOME:-~/.cache}/rea/kuna` on Linux), and Linux Hopper release
archives under `${XDG_CACHE_HOME:-~/.cache}/rea/hopper-releases`. Other cache
namespaces remain intact. A caller-selected `REA_KUNA_CACHE_DIR` is retained
and reported because REA cannot establish ownership of its entire contents.
Lexically equivalent spellings of that default directory, including a trailing
separator, a `.` segment, or a repeated separator, share its purge result.
The comparison preserves POSIX `..` traversal and literal backslashes.
A client configuration that is malformed, unreadable, or at an unsafe
path stops the operation before anything is removed when that client's
product applicability is established or unresolved. Shared registration
storage such as `~/.agents/mcp.json` whose product cannot be established
(for example when FreeBuff and ZCode discovery directories are absent) is
retained unchanged and does not block other REA removals, including cache
and state deletion with `--purge-data`. A client that fails while being
updated stops the remaining removals. Uninstall reports each candidate
`configuration_path` with its outcome. A client with multiple files keeps
their individual `actions` alongside its aggregate status and detail,
including earlier removals when a later file fails. The paths name
the discovered configuration candidates, not resolved physical file identities.
For JSON clients, uninstall removes every repeated `rea` member in the effective
server table only when each registration is REA-owned. An unowned earlier
member, or an unowned OpenCode V1 entry that removing V2 would expose, stops
preflight before any
removal. Repeats inside an inactive earlier copy of the server table stay
unchanged. A purge path that is a
symbolic link is retained and reported rather than followed. Uninstall checks
REA's managed shared and Claude Code personal skill locations. See the
[CLI guide](cli.md#output-and-exit-status) for exit statuses.

### Missing dependencies in an npx installation

If REA exits with `ERR_MODULE_NOT_FOUND` before `doctor` can produce a report,
inspect the missing path in the error. A path under npm's `_npx/<key>/node_modules`
identifies a package-runner installation. In [#5259](https://github.com/morluto/rea/issues/5259),
the missing file was `@modelcontextprotocol/client/dist/index.mjs`. That file is
present in a clean Windows installation of REA 6.7.0; its absence alone does not
establish an incompatible dependency release or explain how the file went missing.

`npm cache verify` checks npm's downloaded content cache; it does not restore
missing files in an already extracted npx installation. Repeating the same npx
command can reuse that incomplete installation. To reinstall only the affected
entry:

1. Stop the REA processes and agent clients using that entry. In the same shell
   environment as the failing command, identify the cache and its entries:

   ```powershell
   npm.cmd config get cache
   npm.cmd cache npx ls
   npm.cmd cache npx info REA_CACHE_KEY
   ```

   Replace `REA_CACHE_KEY` with the key from the failing `_npx` path. Check that
   `info` reports that location and the expected `rea-agents` version. Its
   `valid` label describes the cache entry metadata, not the presence of every
   installed file. These subcommands require npm with `cache npx` support.

2. Remove that specific entry and rerun the affected version with registry
   access. For the version reported in #5259:

   ```powershell
   npm.cmd cache npx rm REA_CACHE_KEY
   npx.cmd --yes rea-agents@6.7.0 doctor --json
   ```

   Keep the key argument: this recovery does not require clearing all npm caches
   or deleting REA configuration, skills, or Evidence. On Linux/macOS, use `npm`
   and `npx` without `.cmd`. A JSON doctor report confirms startup recovered;
   it can still exit nonzero for missing analysis engines or registrations.
   Restart the affected agent after repairing its cache entry.

If a fresh installation still loses the file, retain the error, REA/Node/npm
versions and installation details in the issue. Check installation logs and,
on Windows, security software's protection history before attributing the cause.
Do not rename `index.cjs` to `index.mjs` or disable protection to make startup pass.

### Update the owning installation

Read-only metadata and version checks time out after 10 seconds. This does not
interrupt a package installation already in progress. If a probe cannot be
stopped, the updater reports a cleanup failure.

`rea update` installs the exact resolved
release into the npm prefix or Bun global directory that owns the running
package, then checks the new executable's version before reporting success.
That verification covers the CLI version; it does not establish readiness of
optional native providers such as Frida. Updates keep dependency lifecycle
scripts disabled, so a native binding that needs an install or build step may
remain unavailable. A later provider command reports its own load failure;
retain that diagnostic and the owning installation path before choosing a manual
repair. The updater does not download or rebuild the binding. It does not reopen
onboarding. For npm installations, release lookup and
installation both use npm's configured registry. Bun global updates require
Bun 1.2.17 or later, which introduced `bun info`. The updater checks `bun --version`
first and stops with an instruction to upgrade Bun manually if the version is
older or cannot be parsed; it does not upgrade Bun itself.
For supported Bun global installations, `bun info` and
`bun add --global --ignore-scripts` use Bun's configured registry
and run inside the owning Bun global directory (`BUN_INSTALL_GLOBAL_DIR`, else
`$BUN_INSTALL/install/global`, else `$XDG_CACHE_HOME/.bun/install/global`,
else `~/.bun/install/global`), never in the caller's current project. A Bun
global directory without its `package.json` is not treated as an owned
installation, because Bun would install into the nearest ancestor project
instead.
Its maintenance plan selects only existing REA registrations and an already
installed REA skill. Run the returned scoped setup command to review and approve
those changes, then restart affected agents. The plan is returned in terminal,
non-TTY, and JSON modes without applying configuration changes.

## Released package and main

Repository main documents its current code and generated catalog. `@latest`
selects the npm release, and managed MCP registrations bind the installation
that performed setup. Installing newer instructions does not update a
running server or its registration.

The npm release checked on **2026-10-11** was **6.4.0**, published from
[`a56f7bb6`](https://github.com/morluto/rea/commit/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895).
The actual registry package accepted dry-run setup plans for the 17 client IDs
in that release, including Qwen Code, Pi and Hermes. Seven client IDs are
included from 6.5.0 and were absent from the checked npm 6.4.0 package: `droid`,
`dsh`, `kimi`, `qoder`, `trae`, `workbuddy` and `zcode`.
The 6.4.0 registry check does not establish 6.5.0 publication or live DeepSeek
API integration.
OpenCode's plan selected
`OPENCODE_CONFIG_DIR` even when that directory did not yet exist. These checks
used an isolated home on macOS with Node 24; they verify planning and argument
admission, without writing client configuration or establishing live integration
with every client. This resolves the npm 6.3.0 setup gaps tracked in
[#1650](https://github.com/morluto/rea/issues/1650).

Main's catalog describes the current code. A source build or a subsequent
release containing changes after this checkpoint is required for newer
functionality. Package startup alone does not verify a provider's real
platform workflow.

To check the published version, run `npm view rea-agents dist-tags.latest`.
Use the connected server's actual tool list and advertised input schemas for
feature selection. The same package version string in a development checkout
does not establish that its bytes match the npm tarball. Update a registration
through a reviewed, scoped setup plan, then restart/reconnect the agent.

## Skill-only installation

```bash
npx skills add morluto/rea --skill reverse-engineer-anything
```

This installs agent instructions and bundled references, not REA MCP
registration or analysis engines. Follow the skill's
[conditional connection guide](https://github.com/morluto/rea/blob/main/.agents/skills/reverse-engineer-anything/SKILL.md#connect-only-when-needed).
Working tools can be used immediately. If tools are missing, inspect the current
client's registration with `doctor --client codex --json` (substitute its client
ID), then plan repairs with `setup --client codex --dry-run --json`. Show and
approve the exact changes before applying that scope. An aligned registration
with tools absent from the active session needs a restart/reconnection;
`doctor` checks files and prerequisites, not the live agent connection.

Guided setup installs the package's matching skill by default. The skills.sh
route can select newer repository instructions, so follow actual server schemas
and the release boundary above. Static JavaScript CLI inspection can proceed
while MCP is unavailable:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

It returns the complete Evidence record directly and requires no native engine.
Provider failures in doctor do not prevent unrelated target-free tools. To check
readiness for one task instead of auditing every integration, see
[Check readiness for your task](#check-readiness-for-your-task).

## Supported agents

Setup can configure these clients for REA's local MCP server. Grok Bot uses a manual
hosted connector; see [its configuration](client-configuration.md#other-client-settings).

| Client             | `--client` value |
| ------------------ | ---------------- |
| Claude Code        | `claude_code`    |
| Claude Desktop     | `claude_desktop` |
| Codex              | `codex`          |
| Cursor             | `cursor`         |
| Gemini CLI         | `gemini_cli`     |
| Windsurf           | `windsurf`       |
| Devin              | `devin`          |
| OpenCode           | `opencode`       |
| Antigravity        | `antigravity`    |
| GitHub Copilot CLI | `copilot_cli`    |
| Command Code       | `commandcode`    |
| Qwen Code          | `qwen_code`      |
| Kimi Code          | `kimi`           |
| VS Code            | `vscode`         |
| Grok Build         | `grok_build`     |
| OMP                | `omp`            |
| Pi                 | `pi`             |
| Hermes             | `hermes`         |
| Qoder              | `qoder`          |
| Factory Droid      | `droid`          |
| Trae               | `trae`           |
| WorkBuddy          | `workbuddy`      |
| ZCode              | `zcode`          |
| DeepSeek Harness   | `dsh`            |
| FreeBuff           | `freebuff`       |

`droid`, `dsh`, `kimi`, `qoder`, `trae`, `workbuddy`, and `zcode` require
`rea-agents@6.5.0` or later. The 6.4.0 registry check above does not cover them.
`freebuff` requires `rea-agents@6.8.0` or later. Older releases reject
`rea setup --client freebuff` as an unsupported client.

See [client configuration and troubleshooting](client-configuration.md) for
configuration paths, profiles, trust policies, and schema-limit workarounds.

### DeepSeek Harness

See [the Cordis patch and launcher setup](client-configuration.md#deepseek-harness).

### Other client settings

See [OpenCode, Grok Build, and Grok Bot settings](client-configuration.md#other-client-settings).

## Hopper

Hopper is separate commercial software with its own license. Its free demo has
vendor-defined limits, and a paid license is optional. REA reuses any detected
installation and preserves Hopper during uninstall.

The automated Hopper installer supports macOS 12+ and x86_64 hosts running
Ubuntu 24.04+, Fedora 41+, Nobara 44+, Arch Linux, CachyOS, or Omarchy. The
official Linux packages are x86_64-only, so setup does not offer Hopper on other
Linux architectures; configure [Ghidra](#ghidra) there instead. REA itself runs on any
Linux distribution with a recognized apt, dnf, or pacman package family, where
an existing Hopper launcher is selected through `HOPPER_LAUNCHER_PATH`. Ghidra
and IDA have their own provider-specific host requirements; Windows Ghidra uses
the [experimental P0 boundary](windows-ghidra-p0.md).

If the Linux package download receives an HTTP failure, setup includes the
observed HTTP status in its `download_failed` diagnostic. The status does not
establish the underlying cause or guarantee that retrying will succeed.

Hopper metadata and package downloads require HTTPS throughout the redirect
chain; a redirect to HTTP is refused before that destination is requested.

On macOS, approved setup downloads the official DMG, checks its published size
and digest, validates the application bundle, and atomically installs it to
`~/Applications/Hopper Disassembler.app`. REA then opens Hopper so the
operator can choose its demo mode or activate an existing license. Homebrew and
administrator access are not used.

The Hopper launcher action used by REA creates a document from an executable;
its supported command-line interface does not attach to an already-open
document. While another live REA session owns the same target and loader
profile, a second session reports the owning run ID instead of opening a
duplicate document. On macOS, closing the owning REA session releases this guard;
Hopper keeps its document open. A later REA session can therefore open another
document for the same target. REA does not currently identify, focus, or reuse
that existing GUI document, and the supported launcher exposes no attach or
reuse action for it.

REA currently declines saved Hopper database (`.hop`) targets on macOS because
the native `open database` launch route does not run REA's bridge script. To
analyze that program with REA, select its original executable as the target and
open it through Hopper; this starts the supported bridge route. This does not
recover database-only annotations or analysis changes. Saved-database analysis
on Linux continues to use its supported demo-launch route.

Hopper lease directories must be readable and owned by the current user.
REA validates and secures an opened directory before reserving a lease. If
opening that directory fails with a permission error, the diagnostic identifies
the path and recovery steps while leaving its permissions unchanged. Check
ownership and parent-directory access, then restore owner-only read, write, and
search permissions (`0700`) on a directory you own before retrying.

On supported Linux distributions, approved setup verifies Hopper's official
`.deb`, `.rpm`, or Arch package before invoking the native package manager.
On apt systems, Hopper's runtime dependencies are installed with
`--no-upgrade` in their own transaction, so setup no longer names an
already-installed dependency as an upgrade target. apt can still upgrade a
package that the Hopper package or the Python library repair requires at a
newer version. Arch's `pacman -S --needed` still updates an outdated
dependency.
The official release feed selects the current public demo without a version
pin. REA verifies the package's detached PGP signature against Hopper's stable
primary fingerprint `7C2D73BAFAF5B9A710A69DA1A26DF815099B1BCD`, then checks
that the signed package and installed launcher agree with `main_exe_hash`.
Rotating signing subkeys remain bound to that primary identity.
The feed row itself is not PGP-signed; doctor labels its display version as
`reported_release_version`, separately from the authenticated launcher identity.

The approval plan includes the caller-selected cache location. Approved setup
retains the signed archive, public key and release metadata under
`${XDG_CACHE_HOME:-$HOME/.cache}/rea/hopper-releases/<launcher-sha256>`.
An empty `XDG_CACHE_HOME` uses `$HOME/.cache`. Approved setup can repair a
damaged caller-owned entry after authenticating a fresh package; the previous
entry is preserved beside it as `<launcher-sha256>.backup-<id>`. Ordinary doctor
and launches reject damaged evidence and never repair it implicitly.
Approved publications of the same canonical cache entry share a process-backed
lease. Concurrent setup waits without moving another writer's evidence; a
failed replacement restores the previous directory when possible and reports
any retained backup path. Unavailable reads or native inspection tools do not
authorize replacing existing evidence.
Doctor and launches authenticate this evidence for offline use; an editable
digest receipt alone cannot authorize a launcher. Verification reuses at most
eight immutable package proofs per process, keyed by the complete package,
key, signature, package format and expected launcher digest. Cached file reads
still check identity and content. Without retained evidence, inspecting an
existing install requires the matching current official package and network
access. Successful live inspection can be reused within that process after
rehashing the launcher; it does not write a persistent cache or claim that a
previously observed release is still the latest. Older uncached builds require
an approved update while the feed exposes only its current release.

REA runs the supported demo build on a private Xvfb display and selects Hopper's
offered demo mode for each analysis session; it does not require the user's
desktop display. Unattended package-manager access requires
`--yes --install-hopper`. If the host exposes `/tmp/.X11-unix` as an immutable
mount, REA first verifies the conflict and then uses an unprivileged user and
mount namespace with a private mode-1777 tmpfs over that directory only. The
host mount and the rest of `/tmp` remain unchanged; this fallback never invokes
`sudo`. `rea doctor --provider hopper --json` reports the selected
strategy and both host and effective mount facts.

Hopper also embeds Python; the Python executable and standard library alone
are insufficient on Ubuntu. Approved setup checks the system interpreter
at `/usr/bin/python3` and, when necessary, installs its matching
`libpython3.X` package, then verifies that its shared library can load.
APT resolves the concrete package (for example, `libpython3.12t64` on Ubuntu
24.04). Doctor includes these fresh observations in the `embedded_python`
details of its `hopper-demo-runtime` check, alongside the private-display
diagnostic. Failed inspections remain unknown rather than proving a library
absent. Run `rea setup --yes --install-hopper` to repair a supported install.
This prerequisite check does not launch the bridge or validate a custom Python
interpreter configured inside Hopper; that interpreter needs its own matching
shared runtime. Custom installation prefixes or shared-library ABIs require
manual dependency repair.

When the package-manager step fails, setup reports the failing command and its
captured output, so a package conflict is distinguishable from an authorization
failure. Hopper is optional, so setup still applies the approved client
registrations and skill, then reports `needs_human` with the Hopper failure. On
Arch Linux and CachyOS, the unversioned compatibility package `zlib-ng-compat`
may conflict with Hopper's versioned `zlib` dependency. Resolve the package
conflict yourself, install Hopper's official package manually, or use another
provider such as Ghidra; rerun `rea setup` after installing Hopper.

If setup cannot finish releasing its resources, a normally returned structured
result reports `needs_human` and includes `cleanup.reason` with the identified
paths in `cleanup.resources`. A thrown typed failure reports the same retained
paths in `details.resources`, preserving the primary failure separately. Reasons
that do not identify a resource remain explicit without guessing paths from text.
For in-process callers retaining REA's setup host, a successful retry of its close
updates the original failure's cleanup state and removes released resource labels.
Custom `SetupHost` implementations must bind returned or thrown cleanup errors
to their resource owners to provide the same live recovery. An ownerless error
remains an unconfirmed snapshot: `runSetup` does not observe later direct calls
to the caller's port or replace that port's methods.

The supported Linux demo forwards additional launches into its existing
application, even across private displays. REA therefore reserves one Linux
Hopper application per user across cooperating REA processes. A competing
CLI or MCP session receives the owning session ID before Hopper is launched,
for both the same target and a different target. Switch targets through that
MCP session, or close it before starting another session. Closing the owner
releases the reservation and stops REA's owned demo application and private
display; the headless Linux demo does not retain documents after MCP shutdown.
Its helper watches a private lifetime pipe, so an owner crash or SIGKILL also
stops those children, without relying on a reusable PID or a process-name scan.
A later session recovers the dead owner's stale lease after child cleanup;
private runtime files can remain when REA itself was killed. This does not attach to
or claim ownership of manually opened Hopper applications. An application left
running by an older REA version must still be closed before starting a new session.

Stale lease recovery is serialized. If an interrupted recovery leaves its
reservation directory, the diagnostic identifies that exact path. Stop REA
sessions before removing that recovery directory and retrying.

### Launcher paths and troubleshooting

On macOS, REA checks executable Hopper launchers in this order: the canonical
system application, the canonical application installed by `rea setup` under
`~/Applications`, then other `Hopper*.app` bundles in `/Applications` and
`~/Applications`. The Homebrew cask location is an optional `rea doctor`
diagnostic; to use a Homebrew-installed launcher for CLI/MCP startup, set
`HOPPER_LAUNCHER_PATH` to the path reported by doctor. REA does not run Homebrew
while loading runtime configuration.
Automatic discovery accepts executable regular files, including file symlinks,
and skips directories.
On Linux, it prefers executable `/opt/hopper/bin/Hopper`, then executable
`~/.local/share/rea/hopper/bin/Hopper`, followed by `/opt/hopper-v4/bin/hopper`
and `/usr/bin/hopper`; if none exists, `/opt/hopper/bin/Hopper` remains the
diagnostic fallback. `rea doctor` checks only the current platform's candidates, in the
same order; other platforms have no automatic candidates.
`HOPPER_LAUNCHER_PATH` overrides those choices:

```bash
export HOPPER_LAUNCHER_PATH=/absolute/path/to/Hopper
rea doctor --provider hopper --json
```

Hopper startup allows 120,000 ms for launch, initial analysis, and authenticated
bridge readiness. For large targets, set `REA_HOPPER_STARTUP_TIMEOUT_MS` to a
decimal integer from 1 to 2,147,483,647 milliseconds in the environment that
starts REA. CLI and MCP use the same setting; invalid values fail configuration
validation. In MCP, `update_analysis_settings` can set
`hopper.startup_timeout_ms` for the next startup attempt without restarting REA;
accepted work keeps its budget and retained cleanup must still complete. An
MCP client's own request timeout must also allow enough time.
`open_binary` validates and selects a target without waiting for native provider
readiness. During Hopper startup, `binary_session.provider_operation_health`
reports `busy` at stage `launch`; `analysis_activity` describes bridge requests
and can remain idle until the socket is ready. Cleanup work reports `busy` at
stage `connection`.

If macOS denies Apple Events, allow the application that starts REA under
**System Settings → Privacy & Security → Automation**, then retry. REA releases
the target reservation when the native helper reports its complete authorization
rejection after literal argument admission. Before application handoff, REA refuses
double quotes, backslashes, or line breaks in the final launcher path or arguments,
with `details.launch_rejection.boundary: "argument_encoding"` and the affected source/index.
Select literal-safe launcher/runtime paths and loader arguments, or another
compatible provider. REA preserves original file names and evidence: a quoted
executable name can still work when its prepared image path is literal-safe;
database paths must themselves be representable. Other failed handoffs
retain ownership until document closure is confirmed. If a timed-out bridge
becomes ready later, `close_binary` connects to that run, authenticates its
identity, and requests document shutdown. Once its listener is ready, the bridge
allows 30 seconds for the first connection and capability validation. After a
connection drops, it allows the same grace period for an authenticated cleanup
reconnect, then releases Hopper's Python execution thread. Initial analysis is
outside this listener grace period, and authenticated native work is not bounded
by it. Expiry does not establish document closure, so REA
retains unconfirmed ownership. Retry close while the bridge remains available.

If a Linux launcher exists but cannot start, inspect its shared libraries:

```bash
ldd /absolute/path/to/Hopper | grep 'not found'
```

Install the missing packages and rerun the scoped check. Linux demo sessions
need Xvfb, Python 3, X11 and XTEST; approved setup installs those dependencies
on supported distributions. Add the curl installer's reported executable
directory, commonly `~/.local/bin`, to your shell `PATH` if needed.

REA starts Hopper when needed. On macOS, complete its demo or license prompt in
the same user session before the first CLI/MCP operation or unattended job. Open
Hopper manually if needed; its launcher can also bring the dialog forward.
If startup reports `Cannot launch Hopper! Connection is invalid.` or waits for
bridge readiness, check Hopper for a pending demo, license, or loader dialog.
Complete the dialog and retry. If REA reports `cleanup_incomplete`, follow the
retained-resource guidance below before reopening the target.

On macOS, Hopper can show an `Executing Python Script...` overlay while the REA
bridge serves an active MCP connection. Long-lived MCP clients can keep that
connection open across agent turns, so the overlay may remain visible after the
analysis calls finish; by itself, it does not establish a stalled startup. REA
does not automatically idle-close a still-connected target. When the
investigation is finished, export an Evidence bundle first if you need to keep
the session ledger, then call `close_binary`; set `snapshot_path` to save a
provider-neutral analysis snapshot as part of closing. A successful close
shuts down the REA bridge and clears its overlay; REA does not control the
macOS Hopper application lifetime.
The Hopper GUI Cancel button's behavior for this bridge has not been verified;
`close_binary` is the supported cleanup path.

Hopper serializes analysis requests. Cancelling a wait can leave provider work
running, which the session reports. Successful decompilation is cached until
a relevant rename or comment changes it.

Analysis and annotation calls stay bound to the active target's native Hopper
document, even when GUI focus changes or other documents have the same display
name. Use `open_binary` to change targets. Byte reads stop at a segment boundary
and return the readable prefix with `complete: false`. File-offset mapping checks
the reverse lookup and original executable bounds; synthetic external-symbol
memory has no original file offset. For FAT Mach-O, offsets refer to the original
container file. Results retain Hopper's image-relative offset, the observed slice
base, and the source executable path.
Loader selection reads the Mach-O container header, including FAT files with a
single architecture. For FAT32 and FAT64 containers, REA validates the
architecture table and selected Mach-O header, prepares a private thin image,
and loads it with Hopper's native Mach-O loader instead of Hopper's implicit
FAT slice choice. For arm64 targets, REA ranks subtype bases 0 (plain arm64) and
2 (arm64e), ignoring capability bits for ranking while retaining the raw subtype
for slice identity. These slices' function-entry encodings decode under
`--aarch64`, ahead of Apple's arm64e.x1 variant (base subtype 12), which is
selected only when it is the arm64 family's only candidate. REA checks the
entire source's SHA-256 while copying the slice; source identity and reported
offsets still refer to the original container. Any other ambiguous architecture
subtype requires an explicitly extracted thin image; REA does not guess.
Set `HOPPER_LOADER_ARGS_JSON` in REA's launch environment to a JSON array of
strings to override the derived Hopper loader arguments, for example
`["-l","Mach-O"]`. Empty string elements are preserved; NUL bytes are not
accepted. An omitted setting or empty array uses the derived arguments. `rea
setup` forwards an explicitly selected setting to supported registrations;
restart the MCP server to apply a change. These arguments are Hopper-specific.
FAT64 is distinct from the CPU architecture: FAT32 containers can contain 64-bit
executable images. This preparation avoids the Raw Binary loader dialog observed
with native FAT64 loading on Hopper 6.1.0-demo.
The prepared image and its owned document close together, including on MCP exit;
if document closure is unconfirmed, REA retains the backing image and reports
`cleanup_incomplete` with its path. Ordinary documents retain their existing
MCP-exit behavior.
Startup deadlines report missing bridge readiness and preserve the launcher
outcome; a successful helper exit does not prove that a loader dialog completed.
If an owned provider process exits, request failures preserve its observed exit
code or signal and bounded output in `details.launcher`. An exit can precede
output-stream closure; `output_closed: false` keeps that uncertainty explicit.
Later requests retain the known exit instead of reducing it to socket loss.
An external GUI's helper exit does not establish that the GUI itself exited.
For cursor navigation, string decoding, symbol-name limits, and regex matching,
see [Hopper analysis behavior](native-investigation.md#hopper-analysis-behavior).

Closing or switching a target closes its bound Hopper document, shuts down REA's
bridge and removes its temporary socket directory. The macOS Hopper application
and unrelated documents remain open; the owned Linux demo application stops.
A `cleanup_incomplete`
result identifies resources whose cleanup could not be verified.
REA retains unresolved cleanup ownership and any confirmed shutdown phases.
After addressing the reported failure, retry `close_binary` on the same
connection. Unconfirmed document or process cleanup retains the target/application
lease and prevents another client from launching against that owned resource.
Once document and process closure are confirmed, the lease can be released even
if temporary-file cleanup fails. Another client can then launch, but the owning
client must finish its retained cleanup before starting again.
An unconfirmed external document can be retried while its authenticated bridge
remains available. The same authentication and process-identity capture apply
when the first successful handshake occurs during cleanup after a startup
timeout. REA can confirm closure if that exact authenticated process exits,
including while a shutdown request is in flight. A helper exit alone is
insufficient, and an application that never authenticated has no verified
process identity. If no matching bridge becomes available, inspect and close
the reported document in Hopper before ending the owning REA connection.
Export the Evidence bundle before `close_binary` clears session records.
`binary_session.cleanup_pending` remains true while provider cleanup is retained,
and provider health remains visible even with `open: false`; that flag alone
does not establish successful cleanup.

### Hopper in CI

REA's unattended Linux path is validated against Hopper's offered demo mode.
A paid license is not required for that path, and REA does not read, install, or
automate license credentials. Licensed Hopper installations remain supported,
but license activation is an operator-owned prerequisite rather than part of
REA setup.

macOS requires Hopper's first-run UI to be completed in the same user session
that will run REA: choose the demo mode or activate an existing license before
starting an unattended job. Ephemeral macOS runners therefore need a
pre-provisioned user session or a deliberate interactive bootstrap step.

When Hopper cannot start in CI, run
`rea doctor --provider hopper --json` in the failing runner.
Structured failures distinguish private-display dependencies, an unsupported
demo dialog or build, process-ownership conflicts, and an early lifecycle exit.
Once launcher authentication succeeds, an absent first-run dialog is reported as
`demo_dialog_absent` rather than a build or publisher rejection. The watcher
waits 10 seconds by default. Set `REA_HOPPER_DEMO_DIALOG_TIMEOUT_MS` in the
environment that starts REA to a positive decimal integer of milliseconds from
1 to 2147483647 when a slower host needs a longer window. An invalid value is
`invalid_dialog_timeout`: the error names that setting, shows the rejected
value and its source, lists the allowed range, and asks you to correct the
setting and restart REA.
If a private-display probe times out or is cancelled and its process cleanup
fails, REA retains that exact probe owner and reports `cleanup_incomplete`.
Session close retries the probe before releasing its cleanup marker; doctor
uses its own retained resource scope for the same retry. A probe timeout whose
process has already been released remains an ordinary startup diagnostic.
Apply the reported remediation rather than exposing the runner's desktop,
copying license secrets into logs, or killing unrelated Hopper processes.

## Ghidra

REA connects to an existing Ghidra installation on Linux x64/arm64, macOS x64/arm64,
or experimental Windows x64 P0.
It accepts Ghidra 12.x (>=12.1) and the 64-bit full JDK declared by that installation's
`application.java.min` and `application.java.max`. The JDK's reported platform must also
map to the same native decompiler directory as the host: a JDK running under
emulation (for example x86_64 under Rosetta on Apple silicon) or reporting a
non-host `os.name` fails the doctor
even when it is an otherwise accepted 64-bit full JDK. Select a matching JDK
through `JAVA_HOME`; adding another decompiler in the JVM-selected directory
does not satisfy this host-validated admission rule. Current 12.1 releases require
JDK 21 or newer; Ghidra 12.2 declares JDK 25 or newer. Neither sets a maximum.
The bridge is verified with Ghidra 12.1.4
and JDK 21. Each installation must include the native decompiler for the host
architecture in `Ghidra/Features/Decompiler/os/<platform>/` or the corresponding
`build/os/<platform>/` directory. Linux ARM64 uses `linux_arm_64`; official
release archives may require you to build that native component separately.
REA checks the executable prerequisite by inspecting the file's own executable
header, so a native component built for another platform or architecture is
reported as incompatible instead of being admitted from its directory name, and
a header that cannot be read or recognized is reported as unknown. REA does not
build or install native tools, or change Gatekeeper quarantine settings.

The adapter exposes 27 read-only operations: fifteen inventory/name/search
operations and twelve function-analysis operations. These cover metadata,
decompilation, assembly, resolved calls, typed references, xrefs, function
dossiers, instructions, recovered data types, measured load mappings, loaded
memory bytes, and observed file offsets. Independent load-image attestation
supports DOS MZ, explicitly selected COM, and explicit raw-binary imports;
PE returns measurements with an unsupported attestation status.
ELF target opening checks the declared program and section header tables and
their file-backed ranges before selecting a provider. A declaration beyond EOF
is refused with its range and the actual file size, including a file cut one
byte short. This also refuses carved or deliberately damaged copies that retain
out-of-file declarations; they are not presented as complete smaller programs.
Files declaring no tables remain valid inputs, subject to the provider's lane.
Inactive headers, zero-length ranges and `SHT_NOBITS` memory-only sections do
not require stored payload bytes. Extended counts come from section zero.
The check streams header records in chunks of at most 64 KiB; it does not decode
section names, copy payloads or impose the metadata decoder's structural budget.
Passing it establishes physical range consistency, not complete function
discovery, loader validity or runtime behavior. Existing ISA/ABI checks remain
separate, including the bounded recordless MIPS lane.
Target admission preserves recognized PE/NE/LE/LX signatures separately from
reader layout support. A Windows header overlapping the first 64 DOS-header
bytes remains an unsupported layout in this release; it is not reported as an
invalid offset. Tiny PE files with short optional headers have additional
unverified loader requirements. A nonzero Windows-header pointer without a
recognized signature remains an unresolved candidate, with independently
validated DOS facts in the target error diagnostics; those facts do not prove a
Windows header absent. When a nonempty relocation table ends inside a complete
DOS header, the remaining header bytes are DOS padding, so a nonzero dword
there is not a Windows declaration. An unread signature beyond the current
probe is requested before that padding rule applies.
On Linux and macOS, `annotate_native_function` also edits a function name and/or
entry comments atomically and returns refreshed analysis, and `set_address_name`
and `set_addresses_names` name a function entry or any other mapped address
(creating or renaming its primary label) with per-address success results. These
session metadata edits leave executable bytes unchanged and are discarded on close. GUI controls
require Hopper; Windows P0 remains read-only.

Windows P0 admits native x86, x86-64, ARMNT (Thumb-2) and ARM64 PE applications and DLLs, plus explicitly
selected [raw NMOS 6502 images](raw-binary.md#nmos-6502) with a caller-supplied
entry at file offset 0, on fixed local NTFS volumes. Other raw CPU families remain
unsupported on Windows.
The npm package bundles native Job Object ownership, protected private runtime
DACLs, and handle-based path admission; no separate addon installation is needed.
See the [Windows Ghidra P0 guide](windows-ghidra-p0.md) for verified scope and
limitations.

Extract Ghidra and install the JDK outside REA, then export absolute paths:

```bash
export GHIDRA_INSTALL_DIR=/absolute/path/to/ghidra_12.1.4_PUBLIC
export JAVA_HOME=/absolute/path/to/jdk-21 # optional if java/javac are on PATH
rea doctor --json
rea setup
```

On macOS, [Homebrew OpenJDK is keg-only](https://formulae.brew.sh/formula/openjdk)
and may be unavailable to the system `java` wrapper. Set `JAVA_HOME` to the
selected formula's `libexec/openjdk.jdk/Contents/Home`, for example
`/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home` or
`/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home`. Use a JDK inside the
Java version bounds declared by your Ghidra installation; REA does not select
another JDK when `JAVA_HOME` is explicit or the PATH JVM runs. On macOS,
when the PATH launcher cannot start a JVM, it tries executable Homebrew
`opt/openjdk` candidates, preferring the host architecture's prefix. Failed
discovery probes remain available in installation diagnostics. Doctor distinguishes an absent Java
command from a command that runs and fails, and retains bounded probe output
and any parsed properties when the selected runtime cannot be admitted.

On Windows, configure the existing installation in PowerShell:

```powershell
$env:GHIDRA_INSTALL_DIR = "C:\tools\ghidra_12.1.4_PUBLIC"
$env:JAVA_HOME = "C:\Program Files\Java\jdk-21"
rea doctor --json
rea providers --json
```

`rea setup` can configure supported Windows agents and install the bundled
REA skill after approval. Managed registrations use the absolute selected Node or
Bun runtime and REA entry script, including when setup ran through a package runner. Hopper
installation remains unavailable on Windows. Setup never installs Ghidra,
Java, or Python. It preserves valid detected Ghidra/JDK settings in agent
registrations. See [Windows Ghidra P0](windows-ghidra-p0.md) for provider diagnostics.

The separate `rea mcp add` builtin delegates most clients to Incur's package-runner
child launcher. Run that acquisition from a trusted directory; prefer managed
`rea setup` when supported. That child launcher can fail on Windows with `MCP_ADD_FAILED: spawn npx ENOENT`
before registering a client. REA's setup path is unaffected. For a client supported
by setup, review `rea setup --client opencode --skill=false --dry-run --json`
(substitute its client ID), then use the same scoped command without `--dry-run`
and approve the displayed plan. Non-interactive application additionally needs
`--yes`. This configures setup's user-level client location; it does not replace
`mcp add --no-global`, arbitrary `--command` registrations, or unsupported clients.
The builtin launcher defect remains pending a dependency fix; a successful setup
run does not verify that `mcp add` works on Windows.

When `GHIDRA_INSTALL_DIR` is unset, doctor and the Ghidra provider also search
`PATH` for `ghidra` or `ghidraRun`, resolve the selected launcher through its
real path, and accept it only when that location belongs to a Ghidra tree with
the application metadata and headless launcher. An explicitly supplied
`GHIDRA_INSTALL_DIR` always takes precedence, including when it is invalid;
REA reports that error instead of silently selecting another installation.
This discovery is read-only and does not execute the Ghidra launcher.

Doctor validates the platform, architecture, Ghidra 12.x (>=12.1) application version,
`support/analyzeHeadless` or `support/analyzeHeadless.bat`, the installation's
Java major range, 64-bit JDK bitness, and the presence of `javac`/`javac.exe`.
It also checks that the reported JVM `os.arch` and `os.name` map to the same native decompiler
directory validated for the host; unrecognized reported architectures or a
non-host operating system are refused. LaunchSupport overrides of either
property, including through helper-environment JVM option variables, are
rejected at launch. `JDK_JAVA_OPTIONS` argument files (`@file`) are expanded
and inspected with that same check using the Java launcher's argfile quoting,
comments and continuation rules. The reader admits regular UTF-8 files, retains
failed descriptor cleanup, and bounds all admitted file contents and the prepared
environment to 64 KiB per launch. Unreadable, oversized or nested `@` references
are refused before the analysis JVM starts. Validated bytes are snapshotted under
the owned runtime root, so later helpers and the analysis JVM do not reopen mutable
caller files. Repeated references share that launch's snapshot; no live state is
cached across launches. `JAVA_TOOL_OPTIONS`
and `_JAVA_OPTIONS` do not expand `@file` tokens, so they remain
literal-token checks.
When Java is found through `PATH`, setup records its observed JDK home so GUI
MCP clients do not depend on an incidental shell path. A caller-selected
`JAVA_HOME` spelling is preserved when it resolves to that observed JDK. On
macOS, a discovered Homebrew Cellar home uses the formula's stable `opt` alias
only when both resolve to the same JDK. The Java check retains the JVM-reported
home as evidence. Setup shows every exact
environment entry in its plan, writes only after approval, and never downloads,
installs, upgrades, or modifies Ghidra or Java.

Installation inspection derives the private configuration directory identity from
`application.version` and `application.release.name` in
`Ghidra/application.properties`. The directory's version spelling follows Ghidra
(for example, `12.1.0` becomes
`12.1`), while the reported provider version preserves the original value.
The launcher uses that inspected coordinate; it does not reread the properties
or guess from the extracted folder's name.
If the identity is missing, malformed, or unsafe as a single path component,
the launcher fails before preparing its home/cache/config/temp directories or
starting Java. The client may already have allocated private runtime/endpoint
resources and a target snapshot; existing startup-failure cleanup still applies.
Restore the selected release's properties instead of renaming its installation folder.
Inspection follows selected properties symlinks, admits only a regular file,
and caps the metadata payload at 1 MiB under REA's resource budget. A final
one-byte probe checks for growth. This is not a Java
Properties format limit. Reads preserve Ghidra's Latin-1 byte mapping and check
the descriptor and selected name for changes. Permission failures and resource
refusals remain explicit; failed descriptor cleanup must succeed before that
owner admits another inspection.
Native decompiler compatibility inspection follows the selected executable symlink
and reads at most the first 4096 bytes through the same descriptor owner. It
checks the full extent and selected name for changes without reading the remainder.
An unreadable or unrecognized header leaves compatibility unknown; diagnostics
retain read failures. Cancellation and incomplete cleanup propagate as failures,
and failed cleanup retains the exact descriptor for retry.
This coordinate selects only REA's session-private configuration directory, not
the installation or an existing user configuration directory.

Each verified session uses an ephemeral temporary project and isolated
home/cache/config/temp paths. By default REA passes `-readOnly`, `-deleteProject`,
uses Ghidra's default analysis settings, and loads its packaged Java
bridge via `-scriptPath` into a new ephemeral project; opt-in
[existing-project reuse](#reuse-an-existing-ghidra-project) opens only an owned copy. Linux and
macOS use a current-user-only local bridge socket and descriptor. The
project remains under the selected temporary directory. If its Unix socket
pathname would exceed the host's byte limit, REA allocates a separate owner-only
socket directory under `/tmp` and removes it on close, cancellation, or failure.
Diagnostics retain the actual endpoint and both owned directories.
On Linux and macOS, REA starts the inspected JVM directly using Ghidra's own LaunchSupport
configuration. Apple platform shell wrappers hide their environments from
ownership inspection, so retaining those wrappers would prevent verified
process-group cancellation during startup.
If ownership remains unverifiable, it reports the reason and retains the process
supervisor and private runtime instead of removing files beneath a live provider.
Startup preserves an observed launch failure when cancellation arrives during
rollback. Producer cancellation retains the caller's exact reason separately
from LaunchSupport warnings and cleanup failures. Failed rollback keeps the
original process owner for a later cleanup retry.
The experimental Windows transport uses authenticated IPv4 loopback with a
private native-owned bearer descriptor and Job Object process ownership.

In the default fresh-import mode, operations begin only after default auto-analysis completes. `open_binary`
selects and validates the target/provider binding; it does not wait for Ghidra
import and auto-analysis. The first Ghidra-backed query starts that work lazily.
The provider startup deadline is 330,000 ms by default for import, analysis,
bridge, and health readiness. Large binaries can need more: set
`REA_GHIDRA_STARTUP_TIMEOUT_MS` to an integer between 1 and 2,147,483,647
milliseconds in the server environment. An absent setting uses the default;
empty, invalid or out-of-range supplied values fail configuration validation.
When the deadline elapses, the `provider_timeout` error names
`REA_GHIDRA_STARTUP_TIMEOUT_MS` with the deadline that was applied. In
fresh-import mode it also suggests `REA_GHIDRA_DISABLED_ANALYZERS` for analyzers
that dominate the time and `REA_GHIDRA_PROJECT_PATH` for reusing a completed
analysis; in existing-project mode it omits that import and analyzer advice.
REA parses the supplied configuration environment and
passes the deadline to each provider client; a startup failure is returned by the query that triggered it,
without exposing partial analysis. This deadline is separate from MCP transport
initialization and the client's deadline for that individual tool call. A client
can time out earlier even when Ghidra would complete within its startup deadline.
See [Ghidra first-query deadlines and recovery](mcp-contracts.md#ghidra-first-query-deadlines-and-recovery)
for client options and the close/reopen recovery flow.

The 330-second default can be changed on a running MCP server by setting
`ghidra.startup_timeout_ms` through `update_analysis_settings`. The next accepted
operation that starts a provider uses that value; an accepted startup keeps its
original budget. Changing an environment variable in another shell, or closing
and reopening a binary, does not change the launch configuration already read
by that server.
For a CLI retry with an example 30-minute allowance:

```sh
REA_GHIDRA_STARTUP_TIMEOUT_MS=1800000 rea analyze /absolute/path/to/app.exe --provider ghidra --json
```

For MCP, update the runtime setting and resolve any retained cleanup before the
next startup attempt. Follow the error's close/reopen guidance where needed;
the settings update does not clear cleanup blockers. To change the launch
environment instead, export useful Evidence, close the binary and resolve any
cleanup failure, update the client's REA server launch configuration, then
restart REA and reconnect. Allow startup plus the query in the client's own
tool-call deadline; runtime updates do not change that deadline. Each new startup attempt uses
a fresh ephemeral import; smaller result requests do not reduce the prerequisite
auto-analysis. A larger time allowance does not raise the JVM heap limit or
guarantee completion. Keep [heap and host CPU controls](#ghidra-heap-and-cpu-controls)
appropriate for the machine.

One session contains exactly one imported Program; use `provider_id: "ghidra"`, `--provider ghidra`, or
`REA_ANALYSIS_PROVIDER=ghidra` when both Hopper and Ghidra support the target.
One persistent decompiler is owned by the Program, and a serial queue keeps
Ghidra API calls on the owning Program thread without a fixed queue length.
Operations run until a result, caller cancellation, or provider shutdown; there
is no fixed per-operation or response-size ceiling. Cancelling an operation that
is already running stops the Ghidra session, so one function whose
decompilation runs past the MCP client's deadline costs the whole import.
`REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS` (an integer from 1 to 2,147,483; absent by
default, which leaves decompilation unbounded) bounds each native decompile
instead. This maximum keeps Ghidra’s signed 32-bit seconds-to-milliseconds
conversion from overflowing. The client must still support a deadline covering
startup, that limit and operation headroom. Ghidra stops that one decompile and starts a fresh decompiler process
for the next request. `analyze_function` still returns the function's assembly,
references and basic blocks, with pseudocode, `native_api` and
`native_value_flow` unavailable for the reason "exceeded the N-second limit",
and that dossier is not saved to analysis snapshots. `procedure_pseudo_code`
fails with `provider_timeout` and that message; other Ghidra tools stay
available. If the caller also cancels while the timeout settles, the session
still closes and the message says so. Session reuse concerns an active MCP or
library session; a standalone CLI command still closes its own session when it
finishes. In MCP, `ghidra.decompile_timeout_seconds` can override the launch
value for newly accepted operations on the existing Program; explicit `null`
removes the deadline. A transient timeout remains uncached so the same function
can be retried after an update. See the
[settings design](design/limits-and-recovery.md#runtime-settings-through-mcp).
Codex/Kimi registrations derived by `rea setup` add the selected launch value
to the tool deadline as a single-decompile estimate; a runtime update does not
change that registration. A bulk call can need that limit for
every attempted function plus listing and file work; select the client deadline
for the workload, split batches, use `decompile_all` limit/resume, or reduce
`trace_native_values` `max_functions` to select fewer serial decompiles. Ghidra's own interactive default is 30 seconds. Unresolved computed calls
remain unknown, reference-kind provenance is preserved, and provider-specific
pseudocode is never treated as original source or Hopper-equivalent text.

### Missing macOS native decompiler

If `rea doctor --json` reports `native_decompiler` as missing on macOS x64,
the extracted Ghidra archive may include the decompiler source without the
macOS executable. For Ghidra 12.1.4, you can build it manually with an existing
Xcode Command Line Tools installation, `make`, and `bison`:

```bash
cd "$GHIDRA_INSTALL_DIR/Ghidra/Features/Decompiler/src/decompile/cpp"
make ghidra_opt
decompiler_dir="$GHIDRA_INSTALL_DIR/Ghidra/Features/Decompiler/os/mac_x86_64"
mkdir -p "$decompiler_dir"
test ! -e "$decompiler_dir/decompile" && test ! -L "$decompiler_dir/decompile" &&
  install -m 755 ghidra_opt "$decompiler_dir/decompile"
rea doctor --json
```

The copy step requires the destination to be absent and preserves an existing
decompiler. This recipe is specific to macOS x64: the
[Ghidra 12.1.4 Makefile](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.1.4_build/Ghidra/Features/Decompiler/src/decompile/cpp/Makefile)
explicitly selects `-arch x86_64` on Darwin. For a Gradle
build, follow the matching release's
[native component instructions](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.1.4_build/GhidraDocs/GettingStarted.md#building-native-components).
REA accepts the matching executable under either `os/<platform>/` or
`build/os/<platform>/`; it does not build the component during setup or diagnosis.

### macOS arm64 native decompiler

On Apple Silicon the same source build works with explicit overrides; no
Makefile edits and no Rosetta are needed. The Darwin block in the
[Ghidra 12.1.4 Makefile](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.1.4_build/Ghidra/Features/Decompiler/src/decompile/cpp/Makefile)
pins `-arch x86_64`, but `ARCH_TYPE` and `OSDIR` are ordinary make variables,
and command-line assignments replace them for every compile and link rule:

```bash
cd "$GHIDRA_INSTALL_DIR/Ghidra/Features/Decompiler/src/decompile/cpp"
make ghidra_opt ARCH_TYPE="-arch arm64" OSDIR=mac_arm_64
decompiler_dir="$GHIDRA_INSTALL_DIR/Ghidra/Features/Decompiler/os/mac_arm_64"
mkdir -p "$decompiler_dir"
test ! -e "$decompiler_dir/decompile" && test ! -L "$decompiler_dir/decompile" &&
  install -m 755 ghidra_opt "$decompiler_dir/decompile"
rea doctor --json
```

Verified end to end on macOS 15.6 arm64 with Apple clang 17 and the stock
bison 2.3, against Ghidra 12.1.4: the build produces a Mach-O arm64
`ghidra_opt`, the doctor check `ghidra-native_decompiler` turns healthy with
"reports mach-o arm64, which matches darwin/arm64", and `rea decompile` on an
arm64 Mach-O returns decompiled C through the headless provider. The JDK is
not needed for the make step, only for the Ghidra provider. If your toolchain
rejects the inherited `-mmacosx-version-min=10.6` flag, retry the make with
`ADDITIONAL_FLAGS="-w"`.

### Reuse an existing Ghidra project

For repeated investigations, select an expanded local project marker with
`REA_GHIDRA_PROJECT_PATH=/absolute/projects/app-analysis.gpr`. Both CLI and MCP
use this shared selection. `REA_GHIDRA_PROGRAM_NAME` selects one exact program
in the project root; when omitted it defaults to the selected target's filename.
Paths, globs and command flags are not program names. The matching `.rep`
directory must be present; restore `.grez` archives with Ghidra first.

```bash
export REA_ANALYSIS_PROVIDER=ghidra
export REA_GHIDRA_PROJECT_PATH=/absolute/projects/app-analysis.gpr
export REA_GHIDRA_PROGRAM_NAME=app
rea decompile /absolute/target/app --procedure entry --provider ghidra --json
```

Set the same variables in the MCP server environment and restart/reconnect;
`open_binary` still selects the original target file. `rea setup` retains these
explicit settings in a saved registration. Fresh import remains the default
when the project setting is absent. This route supports native ELF, PE and
Mach-O programs on POSIX without provider-pinned import preparation; Windows,
raw/DOS/DOL and special pinned-language import profiles require fresh import.

REA fingerprints only the selected `.gpr`/`.rep` pair, copies it into its owned
runtime, verifies the copied content against the committed analysis profile,
and runs `-process <program> -noanalysis -readOnly`. Ghidra never opens or saves
the original database; REA reads selected files only for fingerprinting and copying.
This mode does not copy unrelated sibling projects, rerun repair scripts, or
admit bridge database edits. Cleanup removes the owned copy.
The bridge checks the program's recorded import SHA-256 against the admitted
target digest; mismatches and project changes fail explicitly. Reopen the target
to resolve a new profile after intentionally changing the source project.

The profile records the caller path, resolved project/name, program and content
fingerprint. Original analysis settings and completeness remain **unknown**;
prior annotations or edits are caller-project state, not fresh REA discoveries.
A matching recorded import digest does not claim that the database is unedited.
Saved REA seed/analyzer reports remain historical facts in retained source Evidence;
they are not interpreted as overrides applied by this session.
Project content participates in snapshot identity, so different project states
cannot reuse the same profile's cached observations.

To prepare a new project explicitly, use your existing Ghidra installation in a
new directory you own (this writes that project; REA does not save it for you):

```bash
mkdir /absolute/new-projects
GHIDRA_HEADLESS_MAXMEM=1536M JAVA_TOOL_OPTIONS=-XX:ActiveProcessorCount=2 \
  "$GHIDRA_INSTALL_DIR/support/analyzeHeadless" /absolute/new-projects app-analysis \
  -import /absolute/target/app -analysisTimeoutPerFile 600 -max-cpu 2
```

Check that preparation completed successfully before selecting the project.
Preparation time, disk copy/fingerprinting, engine startup and client deadlines
are separate costs; reusing a project avoids import/analysis, not all startup.
Use the [heap/CPU controls](#ghidra-heap-and-cpu-controls) appropriate to the target.

### Ghidra import language and analysis seeds

Ghidra detects the language from the executable header. To set it (for example, Borland C++ PE images):

```bash
export REA_GHIDRA_LANGUAGE_ID="x86:LE:32:default"
export REA_GHIDRA_COMPILER_SPEC_ID="borlandcpp"   # optional; requires a language
```

REA passes `-processor`/`-cspec`, checks both against the installation's `.ldefs`, and records them in the analysis profile. DOS imports reject an override.

Language definitions must be well-formed XML encoded as UTF-8 or BOM-marked UTF-16, with any encoding declaration matching the bytes. Literal Unicode replacement characters (U+FFFD) are accepted; malformed source bytes are rejected.

Ghidra imports little-endian ARM ELF files, including Cortex-M
(`arm-none-eabi`) firmware, as `ARM:LE:32:v8`. That language defaults to ARM
state, and its ELF loader marks code as Thumb only where `$t` mapping symbols
or odd function-symbol addresses say so. Cortex-M cores run only Thumb code, so
the gap matters mainly for code without those markers, such as stripped images
and handlers reached only through the vector table. REA has no M-profile ARM
lane. As an unverified interim, select an M-profile language, which decodes in
Thumb state by default. For ARMv6-M, ARMv7-M and ARMv7E-M cores:

```bash
export REA_GHIDRA_LANGUAGE_ID="ARM:LE:32:Cortex"
```

For ARMv8-M cores, use `ARM:LE:32:v8-m` instead. REA has not verified either
language for Cortex-M analysis. While the variable is set, it applies to every
Ghidra import in the REA server:

- raw-binary, DOS, GameCube DOL and PSP opens are refused, as are opens in
  lanes that reject a different language, such as RISC-V;
- REA asks Ghidra to import everything else in the selected ARM language,
  including x86, x86-64, arm64, PowerPC and Hexagon ELF files and PE and
  Mach-O files, because it does not check that the override's processor
  matches the target.

Restart REA without the variable before you analyze other targets. A future
M-profile lane may refuse it; remove the setting then.

To seed code that auto-analysis cannot reach (computed jumps, pointers in data):

```bash
export REA_GHIDRA_SEED_FILE=/absolute/path/to/seeds.tsv
```

Each line is `address<TAB>kind[<TAB>name]`, where kind is `function`, `code` or `label` (a label needs a name). Addresses are `0x` hex in the default space; `#` lines are comments. A pre-script applies seeds before auto-analysis: functions from the highest address down, then code, then labels. The seed digest is part of the analysis profile, and the session fails if the applied seeds differ. Result limitations report the outcome counts; a seed fails when it overlaps an instruction Ghidra already decoded.

Label seeds can name mapped uninitialized storage such as `.bss`; function and code seeds require initialized bytes.

To skip a named Ghidra auto-analyzer (for example, when default auto-analysis
stalls in one analyzer on a Swift/Objective-C arm64 Mach-O):

```bash
export REA_GHIDRA_DISABLED_ANALYZERS="Objective-C Message Analyzer"
```

The value is a comma-separated list of exact Ghidra analyzer names. A pre-script
disables each name before auto-analysis, the analysis profile records the
override in `analyzer_preset` (for example
`ghidra-default+disabled:Objective-C Message Analyzer`), and a session fails to
open when its committed profile and the setting differ. A name starts with a
letter or digit and contains only letters, digits, spaces, periods, underscores,
and hyphens; at most 32 names are admitted, each at most 120 characters.

The setting applies to every import in the REA server, but Ghidra registers
format-specific analyzers, such as `Objective-C Message Analyzer` or
`Demangler Swift`, only for programs they can analyze. A name that the Ghidra
installation provides but did not register for the selected program is not
applicable: the import continues, the profile still commits the configured
names, and result limitations report the applied preset with that name marked,
for example `ghidra-default+disabled:Objective-C Message Analyzer(n/a)`. A name
that no installed analyzer provides, or an option that remains enabled, aborts
the headless import before auto-analysis and the bridge with an error naming
`REA_GHIDRA_DISABLED_ANALYZERS` and the analyzer, so a misspelled override
cannot produce a session claiming that the analyzer was disabled. Changing the
environment requires restarting the server; reopening a target alone keeps the
current setting. For Windows PE resource analysis, the exact name is
`WindowsResourceReference`. Disabling an analyzer skips the facts it would have
produced.

Ghidra's Objective-C Message Analyzer can log
`Required Objective-C data type not found in data type manager` /
`Try adding libobjc.dylib` when a Mach-O links Objective-C runtime symbols but
defines no class metadata (thin Cocoa glue in a C++ binary is a common case).
That text is non-fatal Ghidra analyzer output: auto-analysis continues, and the
analyzer simply skips `objc_msgSend` call-target recovery. REA's headless import
does not accept a "add this library" option, and on modern macOS
`/usr/lib/libobjc.A.dylib` exists only in the dyld shared cache, so there is no
on-disk library to add. Treat the line as a coverage limitation, not an REA
failure; check the session's `failure_kind` (and related provider errors) for
any real abort. To silence that analyzer, set
`REA_GHIDRA_DISABLED_ANALYZERS="Objective-C Message Analyzer"`. For large
executables that miss the startup deadline instead, raise
`REA_GHIDRA_STARTUP_TIMEOUT_MS` and the [Ghidra heap](#ghidra-heap-and-cpu-controls).

### Ghidra heap and CPU controls

Set resource controls in the environment that launches the CLI or MCP server,
before opening a new Ghidra session. On Linux and macOS, REA chooses the first
nonempty setting in this order: `GHIDRA_HEADLESS_MAXMEM`, `GHIDRA_MAXMEM`, then
`2G`. The chosen value becomes the JVM's `-Xmx` argument. Use a JVM heap-size
value such as `512M` or `2G`; an invalid value causes Java startup to fail.
The supported Ghidra 12.1.4 Windows headless script consumes the same settings
with the same precedence.

For a small target on a constrained host:

```bash
export GHIDRA_HEADLESS_MAXMEM=512M
```

In PowerShell:

```powershell
$env:GHIDRA_HEADLESS_MAXMEM = "512M"
```

An MCP client must pass this setting to its REA server process; changing an
unrelated terminal's environment does not reconfigure an existing server or
JVM. A 512 MiB heap was verified with small native fixtures, but larger targets
can require more memory. The Java heap limit does not bound JVM RSS, Node's
heap, or total memory used by the process family. The startup deadline controls
waiting time independently of these memory settings.

REA clears `_JAVA_OPTIONS`, `JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS`, and
`GHIDRA_JAVA_OPTIONS` inherited from the caller, and owns
`GHIDRA_HEADLESS_JAVA_OPTIONS`. Custom flags injected through these variables
are not supported configuration. On Windows, REA replaces `JDK_JAVA_OPTIONS`
with its own isolated home/temp settings and `-XX:-UsePerfData`; on Linux and
macOS it supplies isolated paths directly to Java. Use the supported heap
settings above instead of adding a second `-Xmx` through an injection variable.

The Linux/macOS launch sets `-XX:ParallelGCThreads=2` and
`-XX:CICompilerCount=2`; the supported Windows headless script also sets these
counts. These constrain particular JVM thread pools, not all analysis threads
or CPU usage. REA does not pass Ghidra's `-max-cpu` option or expose a general
Ghidra CPU limit. When needed, apply host CPU affinity and scheduling controls
to the REA process and verify the resulting JVM's affinity. Select CPUs allowed
on the host; do not assume CPU numbers from another machine are valid.

Verify controls at their consumer after the first Ghidra-backed query starts
the JVM: inspect that owned JVM's effective `-Xmx` and GC/compiler flags, CPU
affinity, and observed memory use. Do not infer them from the parent shell's
environment or the absence of an error. On Linux, `/proc/<jvm-pid>/cmdline`
contains the launch arguments and `/proc/<jvm-pid>/status` reports
`Cpus_allowed_list` and `VmRSS`. Inspect only the process belonging to this
session and retain the resource flags needed for the measurement rather than
copying full command lines or environments into reports. Heap and affinity
settings affect cost and latency; they are not part of REA's semantic analysis
profile identity. See [real-provider testing](testing.md) for bounded
verification workflows.

### Ghidra diagnostics and verification

Unexpected request failures retain their original internal cause. CLI and MCP
errors expose Error names, messages, and available codes under
`details.diagnostics.failure_cause`, including bounded nested causes and explicit
truncation markers. Darwin ownership-helper compilation failures also retain
the compiler outcome, exit code or signal, and bounded stderr; a timed-out
compiler remains distinguishable from a compiler that exited with an error.
The helper compile deadline defaults to 120,000 ms; set
`REA_SWIFTC_COMPILE_TIMEOUT_MS` to an integer between 1 and 2,147,483,647 in
the environment that starts REA when a busy host needs longer. Restart REA to
apply a change; the next ownership-helper compile uses the new value. A
timeout names that effective deadline.
On macOS, the Java prerequisite probe waits for this independently bounded
preparation before starting its five-second command deadline. Caller cancellation
still interrupts preparation, and failed helper cleanup remains owned for retry.
Linux process-table preparation remains inside the command deadline.
Other rejection values retain their primitive value or an explicit type.
Shutdown warnings include the failure
kind, message, and diagnostics, while process and temporary-project cleanup
continues. These messages redact known bridge authentication tokens and
preserve local paths and other analysis context.

Run `GHIDRA_INSTALL_DIR=... npm run verify:ghidra` from a source checkout to
compile and analyze debug and stripped host-native fixtures (ELF on Linux x64/arm64
or Mach-O on macOS), plus a native DWARF 4 type-layout object. This lane needs a
host C compiler in addition to Ghidra and its JDK.

Run `GHIDRA_INSTALL_DIR=... npm run verify:ghidra:cross-format` to add AArch64
ELF, x86-64 PE, and x86-64 Mach-O fixture coverage. This separate lane needs
`clang`, LLD, and `lld-link` on `PATH`; `REA_CLANG` and `REA_LLD_LINK` select
alternate command paths. Missing cross-target tooling does not block the
host-native Ghidra acceptance lane.

On a controlled Windows x64 runner, use
`npm run verify:ghidra:windows`. The verifier generates a deterministic native
PE fixture from source bytes and requires the Windows native authority before
opening the provider. The controls are implemented on main; see the
[release boundary](#released-package-and-main). The lane verifies all 27 admitted
read-only operations, digest identity, and runtime cleanup. The separate
`verify:ghidra:windows:package` lane checks the packed CLI/MCP boundary with an
ordinary user. It requires the built Windows native bundle and an existing
Ghidra/JDK installation; neither is inferred from startup alone.

## Agent plugins and marketplaces

REA's npm package is the shared Claude Code and Codex plugin artifact. It
contains `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, and the
canonical generated `skills/` tree. Both manifests select `./skills` and run a plain Node bootstrap pinned to
that exact package version. The client must have a supported standalone `node`
on its PATH. Claude expands its documented `CLAUDE_PLUGIN_ROOT` in the script
argument; Codex resolves `cwd: "."` from the installed plugin root before
launching the relative script. The bootstrap verifies the package version and runs its bundled runtime in
the same process, preserving stdio and REA's provider/worker cleanup. It does
not start another package runner or download a different runtime. The existing release skill
generator also pins CLI recovery commands to the same version.

The repository's single-plugin marketplaces are declared in
`.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`.
Both select an exact `rea-agents` npm version instead of mutable source-checkout
contents. Release Please updates their selectors alongside the plugin manifests.
No plugin-only publication or generated skill files committed to Git are needed.
The qualified release archive contains a runtime-only manifest and
`npm-shrinkwrap.json` plus bundled runtime dependencies, including PTY packages
for each supported OS and CPU; development dependencies and development-only overrides
stay in the source manifest and lockfile. Both clients receive this same archive.

This distribution becomes installable after the first qualified npm release
containing these plugin manifests. Earlier published packages are not changed
by this source proposal. For local source development, run `npm ci && npm run build:cached` to generate
the runtime and packaged skill before loading the repository as a plugin.
A source plugin uses the locally built runtime and generated skill; rebuild after
source changes. Missing builds and mismatched version pins fail with an actionable
error. The authored `.agents/skills/` tree is not the plugin's shipped skill layout.
Windows source workflows that need native controls still require the
[Windows source-checkout build](https://github.com/morluto/rea/blob/main/native/windows/README.md#build).

In Claude Code:

```text
/plugin marketplace add morluto/rea
/plugin install rea@rea
```

In Codex CLI, add the marketplace and install REA:

```bash
codex plugin marketplace add morluto/rea
codex plugin add rea@rea
```

Each release updates both manifest versions and their pinned server version
together, which is when installed copies refresh the bundled skill and move to
the new server. A plugin does not run `rea setup`, so provider
configuration still follows the sections above. Use the plugin or a
`rea setup` registration for a client, not both, to avoid two `rea` servers.

`rea doctor` does not see plugin-owned state. Its client and skill checks read
only the registrations and skill locations that `rea setup` manages, so for a
plugin-only install `rea doctor --client <id>` and `rea doctor --skill` report
`missing` and recommend `rea setup`. Do not follow that remediation. Check the
plugin with the client instead (`claude plugin list` and `/mcp` in Claude
Code, `codex plugin list` in Codex).

For analysis engines, ask the connected server: have the agent call
`binary_session` and read `result.tool_availability`, which reports what the
server the plugin started can use, with reasons and remediation. See
[MCP contracts](mcp-contracts.md).

A plugin does not put `rea` on your `PATH`. To check an engine from a
terminal, use the package runner at the version the plugin pins:

<!-- x-release-please-start-version -->

```bash
npx -y rea-agents@6.8.0 doctor --provider ghidra --json
```

<!-- x-release-please-end -->

If your installed plugin is older, use the version in its manifest instead.
That report describes the terminal's environment, not the plugin server's.
The server inherits the client's environment, so a setting such as
`GHIDRA_INSTALL_DIR` that exists only in your terminal does not reach it.

## MCP Registry

REA is published in the official MCP Registry as `io.github.morluto/rea`. Registry
clients can discover the server and install the existing public `rea-agents` npm
package; the Registry entry does not introduce a second distribution artifact.

For a client that supports Registry discovery, search for `io.github.morluto/rea`
and select the npm package. The published metadata launches the existing stdio
server through `npx` with the `mcp` command.

For supported clients, prefer `rea setup`: it records the absolute JavaScript
runtime and entry script of the REA installation performing setup. Client starts
then use that installation directly, keeping the client's working directory
without running npm or Bun package resolution there. Registry clients control
their own package acquisition; Registry metadata cannot name local absolute paths.

For manual stdio configuration, substitute the absolute paths of an existing
installation (use the command shown in a setup dry-run):

```json
{
  "mcpServers": {
    "rea": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/rea/scripts/rea.mjs", "mcp"]
    }
  }
}
```

Run current setup to migrate recognized older `npx`/`bunx` registrations, with
backups, then restart the client. Unrelated or unidentified registrations remain
untouched. Setup does not prewarm a separate package-runner command.

If setup itself runs from a package-runner cache, the registration depends on
that cache entry and the selected runtime remaining installed. Removing either
makes startup fail; it does not download or resolve another package. Restore the
same installation and rerun setup. Changing package requests, cache roots, or
runtimes can create a different installation identity. If the old entry cannot be
identified, restore it first or manually remove the confirmed REA registration
before running setup again. A global installation provides a more durable path.

## Package runners and global installation

Package runners can select project-local packages and read project configuration,
even for explicit version requests. Acquire REA from a trusted working directory,
outside the target project, and pass absolute target paths to analysis commands.
REA cannot validate package acquisition that happens before its entrypoint starts.
To request the latest release explicitly, use:

```bash
npx rea-agents@latest setup
```

REA runs the version npm selects. To update older agent registrations, run the
latest-version command and review its setup plan. For unattended package
downloads, add `--yes` before the package name; this does not approve REA's
setup changes.

For an intentional rollback, make the package request explicit:

```bash
npm exec --yes --package=rea-agents@2.4.0 -- rea setup
```

Setup binds persistent MCP registrations to the installation that performed setup.
Running current setup later migrates recognized legacy package-runner registrations
through the normal reviewed setup transaction.

With Bun, `bunx rea-agents setup` (or `bunx rea-agents@latest setup`) is the
equivalent acquisition entry point. Managed registrations use the selected Bun
executable and REA entry script directly. Windows registrations likewise use
absolute runtime and script paths, without a package-runner command shim.

REA supports Node.js 22.x (>=22.23.4), 24.x (>=24.22.1), and 26.12.1+. Node.js 23, 25, earlier 26.x releases, and prereleases are unsupported. It uses the npm already paired with that runtime and never upgrades Node.js, npm, or Homebrew.

When REA runs on Bun, the `rea doctor` `node` check reports the Bun version and
the Node.js compatibility version Bun declares, and passes when that
compatibility version is in the supported range. Bun does not enforce the V8
heap flags REA gives its owned helper processes, so Evidence that reports those
limits on Node.js records them as unavailable under Bun. On Windows, the owned
Job Object of each JavaScript helper (source analyzer, source-map codec and HAR
decoder) instead limits its committed memory to that helper's heap budget plus
a 512 MiB reserve for Bun itself, and Evidence reports that limit. This needs
the matching bundled Windows native artifact; an artifact without the control
refuses to start the helper rather than running it unlimited. CI tests Node.js
only.

Running `npm install rea-agents` without `--global` installs the executable only
in the current project's `node_modules/.bin`; it does not make `rea` available
on the shell `PATH`. Use the setup command above for the guided setup
journey, `npx -y rea-agents@latest` for unattended one-off commands, or install globally
with `npm install --global rea-agents` for a shell-visible `rea` command.

For many concurrent agent sessions, run setup directly from a global installation
to avoid keeping a separate npm launcher process for each MCP connection:

```bash
npm install --global rea-agents
rea setup
```

Review the plan, approve the selected client changes, then restart those clients.
This registers the installed entrypoint directly; installing the global package
alone does not replace existing `npx` registrations. Each client still has its own
REA process and analysis state. Direct registrations follow the installed CLI;
use `rea update` to update it. Running setup through `npx` again selects the
installation that executes setup, potentially in npm's temporary package cache;
retain that cache entry for as long as the registration uses it.

### npm workspace errors before REA starts

An `npx` launch can inspect the caller's npm project before executing REA. For
example, a direct dependency whose override conflicts with its declared spec
can cause npm's `EOVERRIDE`, even when the requested REA package is already
cached. This is a package-runner failure: REA has not started and cannot return
an MCP error. [#3690](https://github.com/morluto/rea/issues/3690) reproduced it
outside OpenCode as well as through that client's workspace-default launch.

Use the direct global-installation setup flow above to replace the affected
package-runner registration, then restart the client. If REA is already installed
globally, run that installed `rea setup --client <client-id> --dry-run`, review
the direct launcher in the plan, and apply the approved scope. Installing a
global copy alone does not change an existing registration. Keep the client's
working directory: changing it to bypass npm inspection can change the meaning
of relative target paths. A direct REA entrypoint preserves that directory
without asking npm to resolve the workspace's dependency graph.

### Global installation wrapper

The optional curl wrapper installs only the global npm package:

```bash
curl -fsSL https://raw.githubusercontent.com/morluto/rea/main/install.sh | bash
```

It prints the version, runtime, npm command, and destination before installing. When a controlling terminal exists it starts `rea setup`; otherwise it prints the command to run later.

Pass options with `bash -s --`:

```bash
curl -fsSL https://raw.githubusercontent.com/morluto/rea/main/install.sh |
  bash -s -- --dry-run
```

To review a version-pinned installer before running it, select the release
version, download its tagged script, and inspect the downloaded file:

```bash
rea_version=6.7.0
curl -fsSL "https://raw.githubusercontent.com/morluto/rea/rea-agents-${rea_version}/install.sh" -o rea-install.sh
less rea-install.sh
```

After reviewing it, install the same package version:

```bash
bash rea-install.sh --version "$rea_version"
```

The tag pins the selected script revision; `--version` selects the npm package
version. Neither command verifies a signature on the downloaded script.

Supported options are `--version <semver>`, `--dry-run`, `--no-setup`, `--no-prompt`, and `--verbose`. Neither `--no-prompt` nor a non-interactive shell grants permission to install external dependencies.

Hopper setup distinguishes a confirmed occupied destination from a failed
destination inspection. It also reports local archive staging and installed
launcher inspection failures separately from download failure or launcher
absence. Follow the reported operation, path, and available filesystem code; an
unresolved inspection does not establish that a destination exists or a launcher
is missing.

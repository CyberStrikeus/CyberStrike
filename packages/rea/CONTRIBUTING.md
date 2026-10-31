# Contributing to REA

REA welcomes focused bug fixes, documentation improvements, tests, and reverse-engineering workflows. For large contract or architecture changes, explain the intended scope and link the relevant issue or design discussion.

## Choosing a contribution

Explain the concrete problem, keep related corrections together, and report
verification and unavailable coverage. Contributions should justify their review
and maintenance cost. Keep cosmetic polish with useful fixes; confusing or
incorrect user instructions warrant standalone corrections. Collect other
cosmetic-only suggestions in an issue rather than separate PRs.

For selected architectural owners and dependency paths, use the
[architecture map](docs/architecture.mermaid). It is not a complete directory or
import inventory. For current provider wiring, start with
[`src/composition/binary.ts`](src/composition/binary.ts) for deep candidates and
the other `src/composition/` factories for tool services, including
[`gpu.ts`](src/composition/gpu.ts) and [`model.ts`](src/composition/model.ts).
Live Frida and Cutter adapters are constructed directly in
[`src/cli/fridaCommands.ts`](src/cli/fridaCommands.ts),
[`src/cli/cutterCommands.ts`](src/cli/cutterCommands.ts), and
[`src/server/createServer.ts`](src/server/createServer.ts).
Production factories construct fresh providers without starting engines or
acquiring targets; optional adapter failures must preserve successful peers. Run
`npm run verify:test-discovery` after adding or moving tests. Resolved import
boundaries are checked by `npm run verify:module-boundaries`, included in lint.

Before retiring an alias or facade, trace runtime registration, dynamic imports,
JavaScript verifiers, subprocess scripts, and packaged entrypoints as well as
TypeScript references. Tests may be the last consumers of a superseded internal
path; migrate their distinct assertions to the current production path before
removing it. Preserve validation, lazy loading, caller policy, and resource
acquisition and cleanup supplied by the old boundary. Published APIs, persisted
formats, and independently versioned bridges require an explicit compatibility
decision; an internal representation alone does not establish that obligation.
See [interpreting boundary facts once](docs/tool-design.md#interpret-boundary-facts-once)
for admission ownership and the distinction between repeated validation and
independent checks.

For analysis workflows and agent interfaces, follow the
[performance priorities](AGENTS.md#performance). Explain the selected output
scope, reuse/cache decisions, and relevant before/after measurements when these
costs change.
Use the [analysis optimization skill](.agents/skills/rea-analysis-optimization/SKILL.md)
to locate provider and shared-workflow bottlenecks, preserve Evidence, and
compare equivalent real tasks before claiming an improvement.

When adding or changing an MCP tool, follow the [tool design guide](docs/tool-design.md) and preserve the canonical contracts and generated catalog.
When adding or changing an admission ceiling, budget, or deadline, follow
[analysis settings, limits, and recovery](docs/design/limits-and-recovery.md)
for ownership, operation snapshots, provider integration, and the steps for
adding a runtime setting.

## Reporting issues

Use the issue form that fits the report and keep it concise. For bugs, include
the actual result, the shortest reproduction you ran, the tested version and
environment, and the smallest useful output, artifact, screenshot, or source
reference. Ground expected behavior in documentation, source, or a known-good
version when available. State observed impact and frequency; keep untested scope
and suspected causes explicit.

Incomplete reports and intermittent failures are welcome. If a narrative answer
or supporting evidence is unavailable, write `NOT_ENOUGH_INFO` and explain the
gap. Clearly label source-only findings and proposed checks; do not claim runtime
reproduction or results you did not observe. A root-cause analysis or fix is not
required to report a problem. Documentation reports should identify the relevant
passage or missing guidance and explain the correction or confusion.

Feature and design proposals can start with a problem and desired outcome.
Examples, prior art, and measurements help when available; ideas without them
are welcome. Maintainers can investigate reports and help resolve open questions.
Human ownership and readiness declarations apply to PRs as described below.

## Pull request ownership and readiness

AI-assisted contributions are welcome. Every PR must have a human owner who
takes responsibility for the complete change, including code, tests,
documentation, and claims produced with AI assistance. The PR author is the
owner unless another human is named in the PR and explicitly accepts ownership.
These requirements also apply to maintainer-authored PRs.

Before requesting maintainer review, the human owner must:

- Review the final diff and relevant existing code. Be able to explain the
  problem, the chosen approach, how it fits REA, and meaningful edge cases.
- Provide evidence that the change works. Summarize what was checked, the
  observed results, and meaningful gaps in the PR body. Use focused tests,
  representative CLI/MCP output, CI artifacts, screenshots, or other checks
  appropriate to the change. For fixes, show the original failure and why the
  regression coverage catches it when practical. Documentation-only changes
  can use source, link, or rendered-document checks. Label source-derived
  conclusions and proposed checks accurately; never report an unrun check as
  passing. Follow the [verification requirements](#development-feedback-and-pr-verification)
  for required checks and real-provider coverage.
- Complete the **Author readiness** declaration in the PR template, explicitly
  stating that the PR is ready for initial review.

Keep the PR description concise and current. Explain the problem, observable
outcome, approach, and useful evidence; link long logs or put them in optional
details. Address actionable automated review findings and explain disagreements.
Human ownership and review remain required when CI or an automated reviewer
reports success. Readiness requests maintainer review; it does not grant scope
approval or permission to merge.

Draft status is optional. Draft PRs may request early feedback with open questions
and incomplete checks. Agents preserve the current draft status unless asked to
change it; missing readiness declarations or later updates do not require a PR
to become a draft.

Leave the readiness declaration unchecked until the human owner has completed
it. The declaration records initial readiness; later pushes do not invalidate
it or require another human sign-off. Keep the PR description and affected
validation current as work changes. AI agents must leave human declarations to
the human owner and must not attest to a human review on their behalf.

The `PR readiness` check reports pending for drafts and requires a named human
owner and all three template declarations for non-drafts. It checks that the
declaration is filled, not whether the code or evidence is correct. Existing PRs
can copy the **Author readiness** section from the current template.
Open PRs must have distinct head commits because GitHub shares commit statuses.

Maintainers enable merge enforcement after the workflow is merged: run
`gh workflow run pr-readiness.yml -f pull_request_number=NUMBER` for existing
open PRs, then add `PR readiness` from GitHub Actions to the branch's required
status checks alongside its existing checks. Deploy the workflow to each
protected target branch before requiring it there. The workflow reads PR
metadata using trusted default-branch code and writes only a commit status.

Maintainers may return a PR to the author or close it when the problem is
unsupported, validation is missing, or the owner cannot explain the change.
Contributors are responsible for completing this work before requesting review.

## Contribution scope

REA focuses on software structure, runtime behavior, and evidence through
general-purpose reverse-engineering workflows. Evaluate a proposal by its actual
capabilities, side effects, defaults, and complete workflow. A tool name or a
reference to vulnerability research, malware analysis, or CTFs does not determine
whether it belongs in REA.

Supported contributions include format inspection, ordinary archive and standard
compression extraction, disassembly, decompilation, cross-references, general
static deobfuscation, vulnerability analysis, and evidence reporting. Static
protection detection is distinct from defeating that protection. Security fixes
and isolated regression tests remain in scope.

Runtime investigation needs explicit boundaries. Launching or attaching to a
process, injecting instrumentation, running scripts, and changing memory or
registers require review of target selection, execution and mutation authority,
provenance, resource limits, cancellation, and cleanup. General Frida or debugger
support is not inherently read-only, and existing support does not authorize
every workflow built on it. General-purpose interfaces are not classified as
dedicated bypass workflows solely because caller-provided code could be misused;
their execution and mutation authority must still be reviewed.

REA does not integrate or officially distribute:

- Purpose-built workflows to defeat commercial packing or code-virtualization
  protections and automatically recover protected code.
- Anti-debugging or anti-instrumentation evasion, or DRM, license, anti-cheat, or
  access-control bypass workflows.
- Exploit or attack-payload automation, credential theft, covert persistence,
  unauthorized access, or bulk attack workflows.

These boundaries apply to first-party providers, adapters, plugins, bundled
scripts, defaults, examples, and documentation. Moving a capability into an
optional dependency or plugin does not exempt it. Review what the integration
exposes, including upstream defaults and raw-command or script execution paths.
Ordinary extraction and general static deobfuscation are not excluded merely
because the input is packed or obfuscated; assess added bypass or execution
behavior separately.

This is a product and maintenance boundary, not a judgment about a contributor's
intentions or a declaration that all excluded research is unlawful. Contributors
must have the rights and authorization needed for their work. A local-only design
or an "authorized use only" disclaimer does not establish containment or settle
legal and scope questions.

### Fail-closed integration

If scope fit, target or authorization boundaries, side effects, or the verification
needed to establish those boundaries remain materially unresolved, **do not merge,
enable, or include the capability in official packages or distributions**. Keep
the proposal pending, narrow it, or decline it. Record unknowns explicitly; do not
turn them into "none" or assumed safety. Passing CI, completed implementation,
upstream popularity, or silence from maintainers is not scope approval.

For a new provider or a capability involving target execution, injection,
mutation, or protection recovery, seek an explicit maintainer scope decision in
the linked issue or design discussion before substantial implementation intended
for integration. Small exploratory prototypes and draft PRs may help inform that
decision; they do not authorize integration. The decision must cover the final
proposed behavior; a scope expansion needs a new decision. Routine fixes and
documentation changes within existing boundaries do not need a separate advance
decision, but must not silently expand those boundaries.

### Starting a proposal

To open a feature request or design discussion, describe the problem and desired
outcome or decision. Short answers and the forms' "Not sure yet" options are
welcome. You do not need code, a complete design or test plan, legal analysis, or
private proof-of-authorization documents to start a discussion. Share what you
know and leave optional details blank when you need help.

Form selections guide triage; they are not proof of authorization or scope
approval. Unselected effects must not be treated as established absence.
Maintainers and implementers work together to resolve the following before
integration:

- The concrete analyst question, requested inputs and outputs, and why existing
  REA operations are insufficient.
- Why the workflow fits this scope, its non-goals, and any protection recovery,
  bypass, or attack automation it would expose.
- The selected targets and every execution, injection, mutation, network, or
  persistence effect, including behavior inherited from upstream tools.
- How the boundaries and outcome will be verified with self-owned or appropriately
  licensed samples; identify real CLI/MCP and provider coverage, cleanup and
  resource checks, and remaining unknowns. Do not publish private binaries,
  credentials, or sensitive target data; follow [SECURITY.md](SECURITY.md) for
  private vulnerability reports.

Mixed proposals should separate acceptable analysis capabilities from excluded
workflows so each can be decided independently. An issue may discuss unresolved
questions; opening an issue or PR does not authorize integration. This is a
maintainer integration gate, not a per-call confirmation requirement or a sandbox
guarantee.

## Development setup

Use the development toolchain pinned in `.nvmrc` and
`package.json#packageManager`. Run `nvm use` before installing dependencies;
installed-package runtime support is documented in
[installation](docs/installation.md#start-setup).
Use Node.js and npm for source builds and verifier scripts; the installed
package's Bun runtime support does not extend to those development scripts.

```bash
npm ci
npm run check:fast
```

`npm ci` installs the exact dependencies and prepares the Husky hooks without
building the project. Run `npm run build:cached` when you need the standalone
CLI or MCP server; it compiles the runtime and bundles the authored skill.
`npm run build` forces those tasks to rerun. Neither command generates test
catalogs, documentation projections, or managed verification evidence. Turbo
caches deterministic builds and static checks across Git worktrees. After a package, lockfile, or managed-skill version change, run
`npm run metadata:generate` before building.

Dependabot proposes updates for the npm lockfiles, website Python requirements,
and GitHub Actions. Review dependency changes and run the checks relevant to
their consumers. For dependencies maintained outside Dependabot, including
`third_party/` and the HTTP/3 lab's pinned requirements, the maintainer should
review upstream security advisories when updating or using them. Preserve source
and version provenance, update license notices when needed, and report which
verification was actually repeated. The lab requirements describe a recorded
environment; a dependency update does not verify the revised environment.

Repository invariants live in [AGENTS.md](AGENTS.md). Keep provider-specific
protocols in adapters and shared CLI/MCP workflows in the application layer.

### Windows source checkouts

The published npm package includes the Windows x64 native addon and its
manifest. A source checkout does not: `native/windows/build/` is ignored by
Git, and neither `npm ci` nor `npm run build:cached` (or `npm run build`)
produces `rea-windows-x64.node` or `manifest.json` in that directory.
Windows workflows and tests that require native controls need these artifacts;
this includes `run-exclusive` commands, which use the native Job Object to keep
the artifact lock until every command descendant has exited. Without the
artifacts, those controls are unavailable even after a successful runtime
build.

Follow the [Windows native build guide](native/windows/README.md#build) before
running those workflows from source. The artifact build requires Linux,
MinGW-w64, and `tar`; the build script does not run on Windows. See that guide
for the build and artifact-verification commands and the separate real Windows
verification prerequisites. Keep the generated addon and manifest uncommitted.

The general source suite (`npm run test:fast`, `npm run test:changed`, and
`npm run test:local`) runs on Linux in CI, and Windows CI runs a curated lane.
On a Windows checkout, some source tests fail because fixtures use POSIX paths,
`#!/bin/sh` tool stubs, or POSIX rename semantics. Compare failures against the
base revision, or run the suite on Linux or WSL, before attributing them to a
change. The embedded-artifact parent-swap tests exercise the selected-path
replacement when the rename succeeds; if Windows refuses it while the admitted
file is open, they instead verify the refusal and cleanup. See
[testing](docs/testing.md#developer-commands) for command scopes
and lane selection.

`git submodule update --init --recursive` fails at the pinned Unblob submodule
on Windows and can leave later submodules unchecked out. Apply the
[Unblob checkout workaround](docs/firmware-analysis.md#windows-submodule-checkout),
then rerun the command.

## Documentation website

The VitePress site uses the Markdown files in `docs/`. Run `npm run docs:dev`
for live editing, `npm run docs:build` to check the production build and
links, and `npm run docs:preview` to preview that build at `/rea/`.

Site navigation lives in `docs/.vitepress/config.ts`. Keep links to guides
relative so they work on GitHub and the website; link to repository files
outside `docs/` using their full GitHub URLs. Generated reference documents
use `npm run docs:generate`; `docs:build` generates them before building the website.

Pull requests run `npm run docs:check`. `.github/workflows/pages.yml` is a
manual VitePress build and does not publish. The public site at
<https://rea.tools/> serves `website/public/` through Cloudflare Workers. See
the [website README](website/README.md#cloudflare-workers) for previews and
manual deployments.

The separate GitHub Pages host uses only the manual
`.github/workflows/website-pages.yml` workflow on `main`. The repository's
**Settings → Pages → Build and deployment → Source** must be set to
**GitHub Actions** before deploying there.

### Translation corrections

README editions and website editions have separate translation sources:

- Find the language's `readme` path in the
  [language inventory](website/locales/languages.json) and edit that file.
  Locale codes and README suffixes can differ. Use the
  [English README](README.md) to check commands, requirements, and analysis claims.
- Edit `msgstr` values in `website/locales/<language>/messages.po` for website
  text. Follow the [website translation guide](website/locales/README.md) for
  the Python environment, catalog validation, and local preview. Preserve source
  strings, contexts, placeholders, commands, paths, and recorded evidence.

Before submitting a website translation, run the catalog and website checks in
that guide. Translated HTML in `website/_site/` is generated; edit the PO catalog
rather than the generated pages.

## Development feedback and PR verification

For routine merges, wait for the required checks to pass for the current PR
revision. Administrators retain an override for deliberate maintainer recovery.
If `main` is broken, prioritize a focused repair before updating affected PRs.

Select checks for the behavior changed. For a source edit:

```bash
npm run test:focused -- src/config.test.ts
npm run check:fast
```

`test:local` runs source tests without building. `check:changed` combines cached
static checks with source tests affected since the merge base with `origin/main`.
Import-graph selection can miss runtime registration, bridges, and generated data;
select relevant boundary tests explicitly. See [testing](docs/testing.md#developer-commands)
for commands, test placement, pruning, and real-provider prerequisites.

Before requesting review, run relevant tests and `npm run check`; add
`npm run docs:check` when contracts or generated metadata change. Record the
checks and unavailable coverage. CI owns the full deterministic suite and
coverage. `npm run check:pr` is an optional full local gate for broad changes or
CI diagnosis. Packaging/setup/distribution changes additionally require
`npm run verify:package` and `npm pack --dry-run`; provider changes require the
matching real-provider lane. State which host/provider workflows ran.

For CI/test correctness, drift, or performance investigations, use the
[`rea-ci-tests-audit` contributor skill](.agents/skills/rea-ci-tests-audit/SKILL.md).
It guides reproduction and comparable measurements before changing checks.

`check:pr` reuses build and static-check outputs while executing the test suite
fresh, including the fast Python producer checks. `docs:check` also runs the
onboarding example consistency suite for README-only changes.

Pre-commit formats and lints staged files; pre-push runs `check:fast`.

### Generated files and command ownership

`docs:generate` prepares documentation and portable managed evidence;
`evidence:generate` prepares only the managed commitment and its runtime/skill
dependencies. The ignored outputs are `docs/public/product-catalog.json`,
`docs/verification/managed-conformance-*.json`, and `skills/`. Edit authored
skill instructions in `.agents/skills/reverse-engineer-anything/`, where Skills
can discover the public bundle directly from a clean checkout. `verify:package`
installs that bundle with Skills 1.7.2 using default repository-root discovery
and checks every installed file, alongside the packaged setup checks.
CI validates generated outputs and retains them as artifacts; do not commit
them. Reviewed source metadata, including
`src/generatedPackageMetadata.ts` and `docs/error-contract.schema.json`, remains
tracked and checked for freshness.

The packaged skill contains instructions and inventory metadata, not runtime
schema hashes. Its conformance commitment covers that exact bundle and portable
verification; it does not attest optional real-provider runs. Schema-only changes
should not alter that commitment. Doctor and `binary_session` expose runtime
schema identity.

Build/generation commands hold a SQLite transaction around the entire Turbo
graph, including cache restoration. `.cache/rea-command-locks/` databases identify
locks, not stale files; never remove them while commands run. POSIX cancellation
retains process-group ownership until settlement; Windows waits for completion.
Real-provider execution is uncached.

### Temporary files and diagnostics

Tests use `createTestTempDirectory` from `tests/fixtures/temporaryDirectory.ts`
for exact-path, awaited cleanup, including failures and timeouts. It registers
deletion with Vitest's `onTestFinished`; do not also add its result to a roots
array or an `afterEach` removal. `createTestWorkspace` from
`tests/support/workspace/workspaceFixture.ts` leaves cleanup with its caller,
which must await `removeTestWorkspace`. Keep explicit resource teardown before
directory deletion, using the case's `finally` or `afterEach`; Vitest runs
`afterEach` before `onTestFinished` and awaits finish hooks in reverse
registration order.
`npm run verify:test-temp-hygiene` runs the suite under a fresh `TMPDIR` and
rejects remaining REA-owned paths. It cannot detect duplicate deletion owners or
prove resource-close ordering. Never glob-clean shared `/tmp/rea-*` content.

`REA_LOG_LEVEL` selects `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or
`silent`. Logs go to stderr: MCP defaults to `info`, and one-shot CLI logging
is opt-in, so stdout carries only protocol messages and command results.
Request arguments, bridge tokens, and environment data are redacted from
diagnostic logs.

## Real Hopper changes

Run `npm run verify:hopper` on a supported macOS host or
`npm run verify:hopper:linux` on the supported Linux demo runner. These build
native fixtures and verify the installed engine through CLI/MCP; package or
simulated-provider checks do not establish engine behavior. See
[real-toolchain verification](docs/testing.md#end-to-end-integration-and-golden-evidence)
for prerequisites and scope, and [Hopper setup](docs/installation.md#hopper)
for supported hosts and unattended startup.

Use the default `build/conformance/manifest.json` unless explicitly verifying
another source-built manifest with `REA_HOPPER_CONFORMANCE_MANIFEST_PATH`.
Generated fixtures and manifests remain ignored.

## Maintainer release checklist

Use the [release guide](docs/releasing.md). Main pushes automatically refresh a
Release Please PR with the next version and changelog. Review its migration
notes, wait for the current CI checks to pass, and merge it into main to publish.

The Release workflow validates and tags that merge; both publishers build its
exact SHA. Ordinary main pushes cannot publish packages. An optional manual
`release/VERSION` checkpoint retains explicit preparation and publication.

For grouped release notes with verified contributor thanks, use the repository's
`rea-changelog-update` skill in `.agents/skills/rea-changelog-update/`. Its inventory,
credit checks, and finalization process are described in the release guide.

Keep new implementation commits on main for the next release. The workflow
owns packaged-artifact verification, npm publication, the published CLI/MCP
canary, and MCP Registry publication. Sync manual checkpoint metadata back to
main after publication; see the guide for recovery and verification.

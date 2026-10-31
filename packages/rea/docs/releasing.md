# Releasing REA

Pushes to main automatically open or refresh a Release Please PR with the next
version and changelog. Review its migration notes and wait for its current CI
checks to pass. Merging that PR into main starts publication automatically.

The Release workflow validates the merged release metadata and ancestry before
creating a tag. npm and MCP Registry publication use the exact reviewed merge
SHA returned by Release Please. Before either registry is published, the release
run calls full CI qualification at that exact revision, including coverage,
portable providers, and every native package host. Later main commits cannot
change or cancel that proof.
After qualification, a separate runner with read-only repository/actions
permissions restores the retained tarball and verifier runtime. It installs
that exact archive into an empty prefix, then exercises CLI help/discovery and
the real stdio MCP catalog/session contract. Installation finishes before the
protocol deadline begins, with dependency lifecycle scripts disabled. Only a
successful rehearsal enables the job with npm publishing authority. The publisher
downloads only
the original qualified archive and manifest, validates their source/run/attempt,
version, Node identity and streamed digest using Node built-ins, then invokes
`npm publish --ignore-scripts` against the official registry. A shared built-in
registry reader checks existing bytes and tags afresh on every publisher attempt,
including retries after partial publication. It does not install
application dependencies, restore verifier code or execute package canaries.
Pinned Node/npm, Actions and the runner remain trusted toolchain inputs. Neither
job rebuilds or repacks the archive.
This rehearsal checks package consumption on the Linux release runner;
qualification retains its broader native-host and real-provider checks.

Before publishing, npm lookup failures and malformed metadata stop the job.
An existing version must match the qualified tarball's SHA-512 and intended
`latest`/`next` dist-tag before it can be reused. Publication never overwrites
an existing version or silently changes a dist-tag. After publication, only
confirmed registry absence is retried within the propagation window. Content
or tag mismatches fail immediately. A separate post-publication job with read-only
repository/actions permissions verifies registry bytes and tags, then installs
from npm and repeats the same CLI/MCP checks; it also exercises a real update
from an older stable release. For a prerelease on `next`, that updater still
targets stable `latest`, as the public update command does. MCP publication
depends on that verification job succeeding. Rehearsal, publication and both
registry-verification/publication jobs do not inherit remote-cache credentials.

Qualification records the parsed `latest`/`next` channel in manifest schema v2.
Rehearsal validates its exact SemVer mapping; the minimal publisher consumes the
qualified channel without a second version parser. Only read-only recovery
accepts existing schema-v1 artifacts, preserving their original bytes and
source/run identity. New publication requires schema v2.

The required reverse-tools lane runs fresh coverage and both mutation
preflights. Complete mutation sweeps run separately on a schedule or manual
dispatch and do not block publication; see [the testing guide](testing.md).
Ordinary main pushes and closed, unmerged PRs cannot publish packages. Check
both publication jobs and the published-package canary; a merged PR or GitHub
tag alone does not establish that publication finished. Retry failed jobs in
the original run after a partial publication.

## Recover an already published npm release

Rerunning a job uses its original workflow and source revision. When a verifier
or publishing workflow needs a code fix, land that fix on main first, then use
the separate recovery workflow instead of repeating release creation:

```bash
gh workflow run release-recovery.yml --ref main \
  -f version=6.5.0 -f release_run_id=38564502044
```

Select the existing version and its original automatic Release run. Recovery
requires that run's successful exact-source CI gate plus a successful npm write
or registry-byte verification. It recognizes verification in either the older
publisher job or the separate post-publication job. It
uses the existing release tag, original qualified tarball and verifier runtime;
expired or missing artifacts stop recovery. The archive's source, version,
original run/attempt and Node version must match, and its SHA-512 must equal
npm's published integrity. The corrected controller runs the public CLI, MCP
catalog/session and previous-version update canary against that released runtime.
The installation completes before MCP's handshake begins; dependency lifecycle
scripts are disabled as in the installed-package verifier.

Only after verification succeeds does recovery publish the released
`server.json` to MCP Registry. It does not create tags or GitHub releases,
publish npm bytes, or change dist-tags. Both publication paths share the same
MCP publisher: a paginated registry lookup preserves an identical active
version, refuses conflicting/inactive metadata, and fails on lookup errors.
The original failed run remains a historical failure; the recovery run records
the new verification and remaining registry publication. Manual frozen-branch
releases are outside this recovery path.

For a release that needs an independently frozen application checkpoint, use
the optional manual path below. It retains explicit prepare and publish phases.

Automatic main proposals and manual checkpoint preparation use
`scripts/release-proposal.mjs` with the pinned release-please dependency.
The controller applies `patches/release-please+17.3.0.patch` only when invoked;
normal dependency installation and published-package installation do not apply it.
The patch avoids commit-file backfills, associated PR file lists and path splitting
for a single root Node package with the default changelog, default or
always-bump-minor versioning, no path exclusions and no explicit plugins. Other
configurations retain the upstream file attribution workflow. Commit history and
associated PR metadata still come from GitHub: release notes need the commits,
and `BEGIN_COMMIT_OVERRIDE` needs the merged PR body. Skipped file lists remain
unknown rather than being reported as empty. The controller sizes commit search
from the complete selected Git history, and a missing known release boundary
fails before proposal creation.

History-page reads retry GitHub's canonical internal GraphQL response error within
the existing five-retry budget and exponential backoff. Each retry uses the same
cursor; permission, validation and mixed errors fail immediately. Exhaustion
stops preparation before proposal writes. The controller does not restart proposal
creation or retry mutations. An internal GraphQL error does not establish API
quota exhaustion or prove that query size caused the failure. Publication
continues through the pinned release-please action.

A nonzero manifest version must resolve to a GitHub release or tag before
proposal history is collected. If publication has not created that boundary
yet, preparation stops before opening or updating a PR; wait for publication
before retrying. Missing manifest versions and `0.0.0` still allow an initial
release. This prevents historical `Release-As` directives from being replayed
as unreleased changes.

When upgrading release-please, review the upstream manifest implementation,
refresh the versioned patch and run the release proposal and workflow boundary
tests. Version mismatch or a patch that neither applies cleanly nor matches an
already-applied patch fails closed.

## Contributor-aware release notes

Use [the rea-changelog-update skill](https://github.com/morluto/rea/blob/main/.agents/skills/rea-changelog-update/SKILL.md)
to turn the bot draft into grouped Highlights, Changes, and Fixes with inline
`Thanks @...` credit. `npm run release:notes -- inventory` collects the full
selected Git range and paginated GitHub PR/author/closing-issue metadata;
`record --summary` produces a compact provenance link for public notes, while
`record` produces the full record for review. Credit a contribution once even
when it appears in highlights, details and migrations; omit maintainer
`@morluto` self-thanks. Keep complete authorship metadata in the inventory
instead of duplicating a credit ledger in the release body. `check` validates credits
and optional PR-body equality, and `render` writes the verified release section.
Run a subcommand without its required options to see its usage. GitHub reads
require an authenticated `gh`; record/check/render work offline from the saved
inventory and complete local Git history.

Save a finalized inventory on the release branch at
`docs/releases/VERSION.contributions.json`. Review unknown identities and
reverted/backported work explicitly; GitHub metadata does not establish the
quality of a user-facing claim. Preserve the existing breaking-change section
and checkpoint checks. The contribution inventory is a reviewed snapshot, not
a signed attestation; the offline checker verifies local range coverage and
credit consistency, not GitHub's authorship independently.

Before editing the live PR, add `rea:release-notes-finalized` to prevent ordinary
main-push proposals from overwriting the editorial notes. Wait for any already
running proposal to finish. The guard applies to main-push automation; do not
run manual checkpoint preparation over finalized notes. Remove the label to
resume bot regeneration. The label does not freeze the base branch: new base
commits require re-inventorying and re-reviewing the notes.

Update both the release branch's `CHANGELOG.md` and the PR body, preserving
Release Please's surrounding metadata. Before creating a release, the workflow
checks an inventory when present, requires its target to equal the reviewed
merge's first parent, and compares the freshly fetched PR body to the changelog.
It rejects changes outside the release metadata paths and stale credit records
before any tag or publication. Review the diffs within allowed metadata paths
as well, especially package dependencies and scripts. Existing candidates without inventories retain their current
checks. Merging still starts publication; a notes edit does not authorize a
merge or release by itself.

The checker supports inline Release Please PR bodies up to GitHub's 65,536
character limit, including the surrounding header/footer. Overflow-link PR
bodies need a separate integration and fail explicitly; credits are never
silently truncated.

## 1. Select a source for a manual checkpoint

Use the next minor version proposed by Release Please, including releases with
breaking changes. Record the full source SHA and create `release/VERSION` at
that commit. The selected version and Release Please's proposed version must
agree before publication.

When choosing the manual path, leave the automatic main release PR unmerged.
Select the application commit from main, create the frozen branch, and prepare
its own release PR using the steps below. Merging the main release PR starts
automatic publication instead. Close the superseded main PR after the manual
release has published and its metadata has been synchronized back to main.

`release/VERSION` also sets the expected version for the workflow. Use an exact
SemVer such as `release/6.1.0` or `release/6.1.0-rc.1`, without build metadata.
The checkpoint validator rejects a candidate whose package, lockfile, manifest,
registry metadata or changelog disagrees with that version before creating a tag.

### Compatibility and version selection

Before publishing a candidate, review its changelog's breaking changes and the
migration notes for the release being prepared. The
[6.1 to 6.2 migration guide](migration-6.2.md) records that release's changes;
it is a historical reference, not the compatibility checklist for later releases.

REA uses Release Please's `always-bump-minor` strategy: every release increments
minor and resets patch, including releases with breaking changes. For example,
the next release after 6.0.0 is 6.1.0. Version numbers use the SemVer format,
but a minor increment does not promise backward compatibility. Review the
changelog's breaking-change section and migration notes before upgrading.

The supported public surface includes documented CLI commands/options, MCP tool
names and input/result contracts, saved evidence formats and supported runtime
requirements. Before adding `!` or a `BREAKING CHANGE` footer, a PR must identify
a previously valid call or configuration that will fail or change meaning,
explain why compatibility cannot be preserved, and give its migration. Prefer
optional additions, compatibility adapters and a documented deprecation period.
Keep breaking markers so the bot includes migration notes without incrementing
major. Maintainers review this impact before merging; the bot parses markers
and cannot infer compatibility.

For example, adding an optional inspection tool is a minor change. Rejecting a
relative MCP path previously accepted by the public contract is breaking;
rejecting an input that the existing contract already prohibited is a fix.
Changing the version number alone does not restore compatibility.

For example, after selecting a reviewed commit for 5.0.0:

```bash
git fetch origin main
git branch release/5.0.0 SOURCE_SHA
git push origin release/5.0.0
```

Replace `SOURCE_SHA` with the selected full commit SHA. The checkpoint must
include this release workflow and CI support for release branches. For an
older checkpoint, backport only the release infrastructure first and record
that additional commit. Do not merge later implementation changes into the
release branch or rebase the candidate onto a moving main.

## 2. Prepare the bot PR

Run the workflow definition from main and select the frozen source separately:

```bash
gh workflow run release.yml --ref main \
  -f release_branch=release/5.0.0 -f phase=prepare
```

Release Please targets that branch and prepares its version, changelog, and
registry metadata. The workflow uses an optional `RELEASE_PLEASE_TOKEN`
repository secret and otherwise uses the built-in `GITHUB_TOKEN`. A dedicated
GitHub App or personal access token can start PR CI automatically. With the
built-in token, `opened`, `synchronize`, and `reopened` PR events create runs
that require a maintainer with write access to approve them. See
[GitHub's workflow trigger documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

The generation step normalizes the product catalog. Preparation cannot create
a GitHub release or publish a package. Record the final bot PR head after
normalization, then approve that head's blocked runs from the PR page. Updates
to the bot branch can create new approval-required runs; approval of an older
head does not verify the normalized candidate. Wait for the final head's CI.

The validator reads the actual ancestry range from the published baseline tag
to the selected checkpoint, including visible first-parent Conventional Commits
and the PR titles in GitHub's default merge messages. The report preserves the
original merge subject alongside the extracted Conventional Commit title.
This matters after merging a side-branch release back into a newer main:
Release Please's chronological history cutoff can omit unreleased mainline
commits. Under `always-bump-minor`, unreleased breaking markers allow a minor
increment and still require references in the new release's breaking-change
migration section. Checkpoints using the default strategy retain the major
increment requirement. Other omitted entries are reported for review.
Historical notes from an older release cannot satisfy
the new release's migration check. This audits declared markers and references;
it does not prove API compatibility or the quality of a migration explanation.

If preparation reports a mismatch or omitted breaking changes, inspect the
recorded ancestry report, correct the release PR's version artifacts and notes,
regenerate documentation, and review/test its final head. Do not repeatedly
prepare over manual corrections. Publication independently checks the merged
candidate again before Release Please can create a tag.

Review the candidate's version, notes, generated metadata, and package
contents. Wait for the candidate's CI and relevant real-provider checks.
Routine local iterations need focused checks; CI owns full deterministic
coverage and platform lanes. If an artifact or real-provider check is
unavailable, report that limit before deciding to publish.

Merge the reviewed PR into `release/5.0.0` with its head SHA matched. Further
main commits do not change this candidate. A necessary release fix belongs
on the release branch, must be reviewed and tested, and establishes a new
recorded checkpoint.

## 3. Publish the reviewed merge

After the release PR has merged:

```bash
gh workflow run release.yml --ref release/5.0.0 \
  -f release_branch=release/5.0.0 -f phase=publish
```

Publication creates the release from the merged bot PR without preparing or
updating another PR. Both npm and MCP Registry jobs check out Release Please's
exact release SHA. They do not build the current main tip or a mutable branch.
Stable versions publish to npm's `latest` tag; prerelease versions publish to
the `next` tag so they cannot replace the stable install by default.
The publish dispatch runs from the frozen release branch so npm's provenance
records the actual release commit. Before Release Please creates a tag, the
workflow accepts only `prepare` or `publish` and requires the selected branch
tip to equal the dispatch SHA. Registry jobs run only during `publish`. After
a tag exists, a mismatch between that tag's SHA and the dispatch SHA stops
both registry publishes.
See [npm's provenance implementation](https://github.com/npm/cli/blob/v11.16.0/workspaces/libnpmpublish/lib/provenance.js)
for the use of GitHub's workflow ref and commit SHA.

Full qualification builds the bundled Windows controls and verifies the packaged
artifact on its native hosts. The Linux x64 verifier retains the exact tarball
it installed and tested, after its workspace cleanup completes. The npm job
downloads that archive from the same workflow run and checks its source SHA,
run identity/attempt, package and Node versions, host identity, and SHA-256.
It publishes that archive without rebuilding or repacking it. Re-running failed
publisher jobs can reuse a prior successful attempt from the same run.
The workflow then verifies the published CLI, the
capability-scoped MCP catalog, and the isolated package update path before
publishing MCP Registry metadata.

Record these outcomes separately:

- GitHub release and tag, including the resolved commit SHA.
- npm's exact version and integrity, with the published-package canary passed.
- MCP Registry's exact server version and matching npm package version.

A GitHub tag alone does not establish npm or MCP Registry publication.

## 4. Sync metadata back to main

Manual checkpoint synchronization is part of completing that release. Finish it
before cutting the next checkpoint; otherwise main retains the previous
release baseline and can propose an already-published version again.

After publication, open a PR from the release branch back to main. Preserve
main's later implementation changes and regenerate ignored build outputs from
the combined contracts with the released package version.
Before merging, check whether GitHub permits merge commits:

```bash
gh api repos/morluto/rea --jq .allow_merge_commit
```

If disabled, a maintainer must arrange an approved ancestry-preserving merge
path before synchronization can finish. Squash and rebase merges do not put the
released tag in main's ancestry. Do not substitute them for this step.
Review and test this synchronization PR, then use a merge commit so the release
tag remains in main's ancestry. Keep the released tag unchanged.

The synchronization must include `.release-please-manifest.json`,
`package.json`, both root versions in `package-lock.json`, `CHANGELOG.md`,
`server.json`, both plugin manifests (`.claude-plugin/plugin.json` and
`.codex-plugin/plugin.json`), the Codex server declaration (`.codex-plugin/mcp.json`), both
marketplaces (`.claude-plugin/marketplace.json` and
`.agents/plugins/marketplace.json`), and the versioned documentation examples. Run
`npm run docs:generate`, `npm run docs:check`, and the release configuration
tests against the combined tree. After the merge, verify that the released
tag is an ancestor of main:

```bash
git fetch origin main --tags
git merge-base --is-ancestor rea-agents-5.0.0 origin/main
```

Close the superseded main proposal before merging the synchronization PR.
That merge's main push opens a proposal for the following release using the
updated baseline. Future releases can use the automatic main PR or repeat the
manual checkpoint procedure; automatic proposals do not move frozen branches.
Preparation generates and validates the catalog, portable conformance
projections, and packaged skill from the candidate checkout without committing
them. The checkpoint validator binds tracked version authority to the source
SHA; generated-catalog and package checks validate the derived representation.
No generated-metadata workflow pushes follow-up commits onto feature or release
branches.

## Partial publication and retries

Inspect the failed job and public registry state before retrying. When npm is
already published, the npm job verifies that exact version instead of
publishing it again. Re-run failed jobs in the original publication run so its
release SHA and outputs stay fixed. If only MCP publication failed, retry that
job after checking that the npm canary succeeded.

A branch tip that moved after dispatch fails before Release Please creates a
tag. Do not dispatch a fresh publish phase to repair an already-created
release: Release Please will not create the same release again. Do not move
the tag, delete the release, or unpublish npm as a retry. A defective public
package requires a reviewed correction and a new version.

### Plugin artifact metadata

Package verification selects files with npm, then packs an owned staging directory.
The release manifest omits development dependencies and development-only overrides;
its generated `npm-shrinkwrap.json` preserves the runtime dependency resolutions
and integrity values from `package-lock.json`. Runtime or unresolved overrides
fail packaging rather than being dropped. Source metadata is never rewritten.
The archive bundles production dependencies because Codex fetches npm plugins
without installing dependencies. The producer includes all locked PTY platform
archives after checking their integrity, without re-resolving the runtime tree.
Optional Frida stays outside the bundle so ordinary npm installation can retain
its host-specific installer. This also lets Claude install locked dependencies under its plugin policy while
retaining development security overrides. Both plugin marketplaces select the
same qualified npm artifact, which the release workflow publishes unchanged.

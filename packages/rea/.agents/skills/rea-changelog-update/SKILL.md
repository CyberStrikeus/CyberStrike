---
name: rea-changelog-update
description: Prepare or rewrite REA release changelogs and GitHub release notes from pinned Git history, with verified contributor thanks and Release Please synchronization.
---

# REA changelog update

Use this for release-note preparation and contributor attribution. Read
[docs/releasing.md](../../../docs/releasing.md) from the repository root for
publication authority and the existing checkpoint checks. This skill prepares
notes; it does not authorize merging, tagging, or publishing.

## Inventory before prose

Fetch complete history and tags. Select the published baseline tag from
`.release-please-manifest.json` on the release PR's **base branch**, and pin that
branch's exact SHA as the editorial target. REA tags are `rea-agents-VERSION`.
Use the proposed version, including its prerelease suffix; do not change the
`always-bump-minor` strategy to imitate OpenClaw's calendar versions.

```bash
node scripts/release-notes.mjs inventory \
  --repository morluto/rea --base rea-agents-PREVIOUS \
  --target FULL_BASE_BRANCH_SHA --version VERSION \
  --manifest /tmp/rea-VERSION.contributions.json
node scripts/release-notes.mjs record \
  --manifest /tmp/rea-VERSION.contributions.json \
  --summary \
  --output /tmp/rea-VERSION.record.md
```

Read the inventory, not just the existing bot draft. It includes side-branch
commits, GitHub-associated PRs whose merge commits are in the range, commit
authors/co-authors, and confirmed closing issues with their reporters. GitHub
connections are paginated. Network errors stop generation; rerun into a new
output file after recovery. Existing output files are never overwritten.

Unresolved commit identities are retained as names/emails with `user: null`;
never guess a handle or thank the merger as a substitute. The report preserves
unknowns. This is a reviewed metadata snapshot, not independent proof that a
human authored a patch. For unattributed identities, unusual merge strategies,
backports, reversions, or references that GitHub did not associate, inspect
the source PRs and diffs and report the limitation. The current collector uses
confirmed PR-closing relationships for issue-reporter credit; unrelated issue
mentions are not automatically credited. Do not claim that merely inventoried
work still ships after a revert.

## Write for users and retain credit

Rewrite only the newest `## [VERSION]` section in `CHANGELOG.md`, preserving its
version/date/link heading. Use single-line Markdown list items under:

- `### Highlights`: a few release-defining user outcomes; no quota for small releases.
- `### Changes`: capabilities and meaningful behavior changes.
- `### Fixes`: reliability, correctness, compatibility, and safety fixes.
- `### ⚠ BREAKING CHANGES`: retain when applicable, with migrations and original
  PR/commit references required by the existing checkpoint validator.

Group related work by analyst workflow or user impact. Explain the resulting
behavior in short, concrete entries. Highlights summarize the release; avoid
repeating their full descriptions in Changes. Internal cleanup, tests, CI, and
routine documentation generally belong only in the provenance file. Read ambiguous PRs/diffs before making
claims. Distinguish simulated-provider checks from real-provider verification.

Credit each represented contribution once in the public notes with its link
and `Thanks @...` for its verified human author, known co-authors, and confirmed
closing-issue reporters. Grouping preserves all those credits in one line.
When Highlights, detailed entries or migrations reference the same work,
put its thanks in one of those entries, not all of them. Include issue links.
Direct-commit bullets carry the commit link and known human credit.
Exclude GitHub bots and known agent accounts. REA's observed Anthropic, Cursor,
Codex, and Copilot co-author trailers resolve to `@claude`, `@cursoragent`,
`@codex`, and `@Copilot` with GitHub type `User`; the credit policy excludes
them while retaining their metadata.
At the REA maintainer's request, omit `@morluto` self-thanks while preserving
authorship in the inventory. Other human contributors remain eligible.
Use explicit GitHub links for cross-repository references to avoid ambiguous
`#NNN` numbers. Unknown handles stay unknown; they are not fabricated credit.

Append the generated `record --summary` provenance link verbatim at the end
of this release. The linked inventory accounts for every discovered in-range
PR and direct contribution, including internal work omitted from the prose.
Do not paste the full `record` output into public notes: it duplicates thanks
and obscures the user-facing changes. Full records remain available for review.
Do not hand-edit generated credits to make validation pass. Refresh the inventory
when product history changes; a prose-only correction can reuse the snapshot.

## Finalize with Release Please

Before changing the live release PR, have authorization for that PR update.
Local preparation and validation can proceed independently.

1. Add `rea:release-notes-finalized` to the selected open release PR **before**
   editing its branch/body. Main proposal pushes respect this label. This is
   our workflow guard, not Release Please's `autorelease: snooze` mechanism.
   A proposal already running must finish before editing. Do not dispatch
   manual preparation over finalized notes.
2. On that release branch, save the reviewed inventory as
   `docs/releases/VERSION.contributions.json`. This is durable public release
   provenance, not a temporary planning file. Do not add credentials or local
   environment dumps. Keep the existing version artifacts aligned.
3. Run the existing checkpoint validator and the new checker:

   ```bash
   node scripts/release-notes.mjs check \
     --manifest docs/releases/VERSION.contributions.json
   node scripts/release-notes.mjs render \
     --manifest docs/releases/VERSION.contributions.json \
     --output /tmp/rea-VERSION.notes.md
   ```

   The checker supports inline PR bodies, including their surrounding metadata,
   up to GitHub's 65,536-character limit. It fails on larger notes rather than
   truncating credit; Release Please's overflow-link bodies are not integrated.

4. Update the release PR body with the rendered section while preserving its
   Release Please header/footer and component/version structure. Use a body
   file for `gh pr edit --body-file`; changing only `CHANGELOG.md` does not
   change Release Please's release body. Push only authorized changes.
5. Freshly fetch the PR body to a file and run `check --pr-body FILE`. Review
   the complete diff and wait for current CI. Publication checks the body
   again before release creation. Avoid further body edits while publishing.

The finalization label freezes bot refreshes, not main. New product changes
after the inventory target require refreshing the notes before publication.
The workflow checks target ancestry and allows only release metadata paths
after that target. It also requires the inventory target to equal the reviewed
merge's first parent, so intervening main commits require a fresh inventory.
Review diffs within the allowed release metadata paths too: the path guard does
not prove that package dependency/script edits are version-only changes.
To resume automatic proposals, remove the finalization label and let the bot
regenerate; expect editorial changes to be replaced.

Existing releases without a contribution inventory retain their current
publication path. Never retag or republish a package to correct release prose.

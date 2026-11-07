# Static analysis in GitHub Actions

The [minimal workflow](https://github.com/morluto/rea/blob/main/examples/github-actions/rea-analysis.yml) builds a small
JavaScript application, analyzes its files without executing them, and uploads
machine-readable results. It uses the existing CLI, not a separate GitHub Action
or an MCP client. It does not promise support for every REA provider.

## Run the example

1. Copy the example to `.github/workflows/rea-analysis.yml` in your repository and
   commit it to the default branch. No existing application or package manifest is
   needed for the self-contained demonstration.
2. Enable GitHub Actions if necessary. Select **REA static analysis example** in
   the Actions tab and choose **Run workflow**.
3. Download the `rea-analysis` artifact after the run. Its files are:

   | File              | Meaning                                                                                            |
   | ----------------- | -------------------------------------------------------------------------------------------------- |
   | `analysis.json`   | Original CLI JSON, including complete Evidence on success or the error report when one is emitted. |
   | `analysis.stderr` | Original diagnostics/progress; an empty file is normal when there are none.                        |
   | `exit-code.txt`   | Original analysis process exit code.                                                               |

The example pins Node.js 24.22.1, REA 6.7.0, and action commit revisions. It installs
REA into the runner's temporary directory rather than changing the application's
dependencies. This pins the tool version, not every transitive npm dependency;
use a reviewed, committed package lock and `npm ci` if your integration requires
that stronger dependency-reproducibility guarantee.

## Prerequisites and trust

The runner is GitHub-hosted Ubuntu 24.04 with Bash, npm, and `ps` from `procps`.
Other Linux images must supply `procps`; REA's supervised process controls use it.
This static JavaScript operation needs no Hopper, Ghidra, IDA, Java, browser,
Docker, GPU, external API key, or user-supplied GitHub secret. The workflow only
requests `contents: read`; artifact upload uses the runner's normal Actions
credentials.

Replace **Build a known artifact** with your reviewed build, and set
`ARTIFACT_PATH` to its application directory (relative to the checkout) or an ASAR.
The demonstration creates its own tiny application; it deliberately throws if
executed. REA reads it statically. Your replacement build itself can execute code:
review it separately and do not add untrusted pull-request builds to a privileged
`pull_request_target` workflow. The example is manually triggered, not an
untrusted-PR execution policy.

Reports can contain paths, URLs, source-derived facts, and caller-selected data.
Only analyze artifacts and publish reports you are authorized to share. Do not
rely on REA inferring secrets from their names. Review artifact access and
retention for your repository; the example retains reports for seven days.

## Failure, partial results, and unsupported capabilities

The analysis step captures stdout and stderr separately, records `$?`, and exits
with that same status. There is no `continue-on-error`, `|| true`, output filter,
or pipeline that could turn a failed analysis green. Before checkout or other
fallible steps, the workflow creates a fresh report directory under `RUNNER_TEMP`.
Analysis and upload both use that directory, never a checked-in `reports/rea` or
other workspace files. The upload step uses `always()` when that directory was
prepared, so available diagnostics survive an analysis failure. If installation
or the build failed before analysis began, it is empty and upload warns rather
than publishing stale results or inventing a successful result. Runner loss or
cancellation can still prevent upload.

`--json --full-output` selects a machine-readable envelope; it does **not** mean
that analysis was complete. A successful operation can retain partial analysis,
unknowns, and limitations. Exit zero is not a security verdict, proof of complete
coverage, or a policy gate for those findings. Inspect the saved Evidence and
coverage before making such a decision. See [output and exit status](cli.md#output-and-exit-status).

A nonzero exit can represent invalid input, unavailable tooling, an unsupported
host/capability, or another operation failure. Keep the original JSON error (when
emitted), stderr, and exit code, and use their category/message to diagnose it.
An early startup failure may leave `analysis.json` empty; do not parse that as
successful analysis. Select a supported operation or explicitly provision its
[documented prerequisites](installation.md); do not silently switch providers,
execute the artifact, or ignore the failure to obtain a green job.

To exercise the failure path, temporarily set `ARTIFACT_PATH` to
`build/missing-artifact` without changing the demo build. Analysis must fail,
`exit-code.txt` must be nonzero, and the available reports must still upload.
To exercise unsupported input, set `ARTIFACT_PATH` to `build/rea-ci-demo/index.js`:
this operation accepts an application directory or ASAR, not a single source file.
The retained JSON error has category `unsupported_target`; the step exits nonzero.
Restore the correct path before using the example normally.

To exercise partial analysis, append `export const broken = ;` to the demo's
JavaScript. REA 6.7.0 retains `data.normalized_result.statistics.parse_failures`
and an incomplete-coverage limitation while the operation can still exit zero.
Inspect those facts instead of treating process success as full coverage. The
report JSON and diagnostics remain unfiltered in all three cases.

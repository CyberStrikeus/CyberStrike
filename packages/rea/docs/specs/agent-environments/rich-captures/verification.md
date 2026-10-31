# Verification

Verified commit: a64367a9 on main 2dd5effe.

## Gates

Run on macOS 26.5.1 with Node 22.23.1 on that tree: `npm run typecheck`, `lint`
(oxlint plus `verify:module-boundaries`, 2172 files), `format:check`, `knip`,
`metadata:check`, `docs:check`, `jscpd` (3.43% duplicated lines), `scan:todos`
and `mcp-catalog:check` all exit 0. oxlint on the 12 changed TypeScript files
reports no finding that main does not already report for the same files.

`npm run test:prepare`, then `npm run test:changed` (the tests related to the
changed files): 84 files, 1531 passed, 3 skipped, 0 failed. They include:

- the service: an Evidence file projects exactly what the same Evidence projects
  inline; a capture whose response text exceeds the inline budget is refused
  inline with `resource_constraint` and projected from its file; a relative
  path, a missing file and JSON that is not Evidence are refused; the
  synchronous API refuses an unread file source;
- the compiled CLI: a request naming an Evidence file projects the same
  manifest as the same Evidence inline;
- MCP: inline, retained and file sources give identical manifests, outputs
  validate against the advertised schema, and a relative path is refused;
- the file source module: the size estimate, the authentication headroom
  refusal, a cancelled request refused before reading, and a read within the
  caller's resource scope; the service returns typed cancellation for a
  cancelled file request; a request aborted while it runs, even after its read, returns typed
  cancellation because the service yields before each check;
- the pair rule: three owner/repo pairs merge for collection and numeric detail
  routes, while two pairs, or three pairs sharing one namespace, stay literal;
  with `sibling-variance` also selected the pair still merges, because pairs
  are merged first. Each pair parameter keeps its role when
  `sibling-variance` later templates the segment before the pair.

## A rich capture

A Gitea 28.1.0 instance seeded through its API with an invented world (12
people, 4 organisations, 16 public repositories, 320 issues with about 600
comments, labels, milestones, commits, pull requests and releases) was read by
one `capture-browser-scenario` run of 1,217 API reads: 1,218 transactions in
24 s, 10.7 MB of Evidence, nothing dropped. Scenario parents are not on main,
so this run used this commit merged onto the scenario-capture change
(morluto/rea#5182) and packed for the host.

|                       | Inline source, previous rules         | Evidence-file source with `sibling-pair-variance` |
| --------------------- | ------------------------------------- | ------------------------------------------------- |
| Manifest              | `resource_constraint` (96 MiB budget) | built in 4.1 s, 459 MB maximum RSS                |
| Tools                 | 446 (with the budget raised by hand)  | 63                                                |
| Recorded exchanges    | 1,218                                 | 1,218                                             |
| Tools with one record | 77%                                   | 49%                                               |

The pair rule templated 25 route families as `{repo_namespace}/{repo_name}`.
A model provider that accepts at most 128 tools refused every request for the
446-tool manifest with HTTP 400.

The 63-tool environment was then exported, and in the AgentEnv runner its
smoke task passed and twelve generated retrieval tasks scored 12/12 with
`openai/gpt-oss-120b` and 12/12 with `zai-org/GLM-5.3-Flash`, with no provider
errors. The 446-tool manifest had scored 0/12 and 8/12 on its own generated
tasks, the 0 being the provider's tool limit rather than the model.

Review then found that the rule as run here also merged one id's
sub-resources (`/users/alice/followers`, `/users/bob/following` and
`/users/carol/starred` became one tool), and a pair now qualifies only when a
literal follows it. The Gitea capture above predates that guard and has not
been projected with it: whether any of the 63 tools merged sub-resources this
way, and the tool count with bare `/repos/{owner}/{repo}` routes kept one per
pair, are not established here.

## Linux follow-up (2026-10-20)

Based on `dd2bf3565`, including main `5fa4defcb`, with Node 24.18.0 and npm
11.16.0. The file reader now owns authentication; invalid Evidence returns the
selected file path and file-relative `content_issues`. Service and advertised
MCP error-envelope regressions cover this boundary.

- Domain analysis views, application analysis views and error projection:
  16 files, 298 tests passed.
- Compiled analysis-view CLI/MCP and environment serve/export boundaries:
  5 files, 48 tests passed.
- Serial Turbo run: typecheck, lint, format, knip, package metadata and required
  runtime/contract artifacts: 11 tasks passed. Documentation/catalog validation:
  8 tasks passed. Architecture guards passed across 1,595 source files.
- Real Gitea 28.2.0 official Linux binary (published compressed SHA-256 checked),
  isolated SQLite database, two users and three public repositories with large
  issue bodies. Actual Chromium navigation captured nine API transactions,
  45 events, no drops, 12,584,312 bytes of Evidence. Inline manifest projection
  was refused with `resource_constraint`; file CLI and default stdio MCP
  projections agreed on five tools with all template rules selected. The
  three trailing user sub-resources stayed separate. Malformed file diagnostics
  named the file's JSON root. HTTP SDK replay verified six complete small
  responses and twelve exact 256 KiB prefixes of large responses, each marked
  truncated. Owned Gitea, browser and replay-server processes were stopped.

One CPU and one test worker were used. Sampled sum of descendant RSS every
50 ms (shared pages can count twice): focused tests 15.834 s / 15.327 CPU s /
764.69 MiB peak; boundaries 194.916 s / 190.121 CPU s / 1,795.15 MiB;
static/build 266.311 s / 259.658 CPU s / 4,677.44 MiB; real Gitea workflow
31.631 s / 24.999 CPU s / 2,146.29 MiB. These are individual runs, not a
cold/warm comparison; model token usage was not measured. The first external
probe stopped at the expected CLI refusal because its driver rejected exit 1;
the driver was corrected and the complete workflow passed. No new macOS,
Windows, model-task scoring or AgentEnv runner verification is claimed here.

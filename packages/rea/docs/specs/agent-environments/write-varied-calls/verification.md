# Verification

Executed on macOS with Node v24.22.1 on this branch, on #7332 at `7d01a5d5` (main `5aa23c3d`), and on Ubuntu 24.04 VMs
with snap Chromium for the recording round.

## Diagnosis

Claude Code (`claude-sonnet-5-5`) built an environment of each of seven applications from the same prompt, once with
REA main `5aa23c3d` (skill 50) and once with #7332 at `7d01a5d5` (skill 53). Each bundle's write tasks ran with
`fireworks_ai/gpt-oss-120b` and `fireworks_ai/glm-5p3-flash`, which scored alike:

| Application | Write tasks | Main    | #7332   |
| ----------- | ----------- | ------- | ------- |
| Miniflux    | 3           | 3/3     | 3/3     |
| Grafana     | 2           | 2/2     | 2/2     |
| Vikunja     | 3 + 2       | 0/3 0/2 | 1/3 2/2 |
| Paperless   | 3           | 1/3     | 2/3     |
| Linkding    | 2           | 0/2     | 2/2     |
| Homebox     | 2           | 2/2     | 0/2     |
| EspoCRM     | 3           | 1/3     | 0/3     |
| Total       | 20          | 9/20    | 12/20   |

Served writes were 14 and 25. Recorded again, Homebox and EspoCRM gave main 2/2 and 1/3 and #7332 2/2 and 3/3: the
first losses were the agents' runs, not REA. Built with both versions, none of the 18 recordings served fewer writes
with #7332 (44 and 53 in all).

Replaying #7332's recordings with failing checks and refusals logged gave the causes this branch takes: EspoCRM's
second contact update left out `addressCity` and was refused for lacking a required member (both recordings); Linkding's
second bundle create left `order` to the application, which the merge took as disagreeing with the first create's
echo; Vikunja's task update stamped `done_at` to the nanosecond where the read after it showed seconds. Over the
earlier captures, 14 withheld updates were `PUT`s whose application cleared a member they left out (Paperless `owner`,
Homebox `assetId`).

## Gates

- `npm run -s check:fast`, `format:check`, `scan:todos`, `docs:check`, `verify:test-discovery`, `mcp-catalog:check` and
  `jscpd`: passed. `npx knip` reports `staticFileUrlPath`, `ObjcClassImportBindingCoverage` and
  `AndroidManifestComponentInventory`, as main `5aa23c3d` does.
- `npx vitest run --project domain --project services`: 11,694 passed, 8 failed (`appleApplication.test.ts`), which fail
  the same way on main `5aa23c3d`.
- `npm run -s test:focused --` the environment build, export and serve CLI boundaries, the analysis-view CLI and MCP
  boundaries and the environment serve MCP boundary: 80 passed. `outputSchemaProfile`, `toolSchemaValidity`,
  `mcpSchemaValidation`, `outputSchemaSemanticConstraints` and `analysisViewMcp`: 54 passed; the compact catalog stays
  under its frame.
- The seven new view and serving tests fail on #7332 at `7d01a5d5` and pass here.

## Write plans over recorded captures

The 130 captures #7332 measured and the round's 18 recordings, built by #7332 at `7d01a5d5` and by this branch: 694
plans, 386 served and 398. No write goes from served to withheld and every view is unchanged. Newly served:

- Paperless correspondent, document type and tag updates in four recordings, whose `PUT` clears `owner`.
- EspoCRM's contact update and Linkding's bundle create in #7332's recordings of the round.
- Grafana's folder update and delete in a fresh recording whose second update sent fewer members.
- Homebox's item update in the published capture, whose `PUT` clears `assetId`.

Vikunja's task update reads back confirmed, but stays withheld: the task creates before it are not modelled (per-project
numbers), so their entities carry the creates' answer spellings into later reads.

## Review round

- Greptile's first review: a `sequence` with `sent` now accepts a value a later create sent, whichever create came
  first; a default must agree with every update that left its member out, else the plan is withheld; and serving
  stores an update's clocks as the update plan's read-back spells them (`observation.read`). Their four tests fail on
  `6300ec80`. #7332's made-object clock check, merged in, has its test there.
- Gates as above: `domain` + `services` 11,699 passed, 8 failed (main's `appleApplication.test.ts`); focused boundaries
  80 passed; the five MCP schema files 54 passed. The census stays at 694 plans and 398 served, with no plan or view
  changing.

Greptile's review after main `21b19270` was merged in (`467ac78f`) raised three more, fixed:

- A member a call left out and the application stored a fixed value for (`body.defaults`) is no longer turned into a
  `sequence` with `sent` by a later call that left it out and got the next number.
- Serving stores an update's clock at a coarser read's precision from the answer's own digits, so an answer to the
  nanosecond read back to the microsecond keeps its microseconds.
- A `PUT` that names a `reference` field's entity by its member supplies that field: it is not checked against, or
  given, the default a `PUT` that left the field out showed, whichever of the two calls came first.

Their tests fail on `467ac78f`, and the reference case with the clearing call first on `7030ca4d`. Gates pass but
`knip`, whose one finding main `21b19270` reports too; `domain` + `services` 12,046 passed; focused boundaries 82 passed; the five MCP schema files 55 passed. Over the 148 captures, main
serves 380 writes and this branch 392, with no plan or view changing from `467ac78f`.

Greptile's review of `b56f8924` raised two more on numbered members, fixed: a member a call sent empty (`""`) is no
longer filled in for a call that leaves it out when a `sequence` with `sent` numbers it; and a later create the
application numbered at or below a value an earlier create sent (9 sent and deleted, then 2) no longer turns the echo
into a numbered `sequence`, since serving counts past every value a call sent. Their tests fail on `b56f8924`; gates
pass but `knip` (main's finding), `domain` + `services` 12,048 passed, and the census is unchanged. Greptile's next
review found that check counting values sent in other collections, which withheld a create numbered within its own
collection; the check now counts them in the sequence's scope, and its test fails on `d4922b3d`.

## Not verified

- No recording round ran with this branch, so its write tasks are not measured.
- The skill's spacing of creates.
- Vikunja per-project task numbers, Linkding's renumbering after a delete and Homebox item creates, which stay withheld.

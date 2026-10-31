# Verification

Executed on macOS with Node v24.22.1 on this branch merged with #7274 at `45832406` (main `8706068b`), and on Ubuntu
24.04 VMs for the task runs.

## Diagnosis

The 418 eval runs stored on the comparison VMs, with their agent trajectories:

- 63 runs had a call refused before REA saw it because a query value came as a JSON number or boolean (`maxSize`,
  `pageSize`, `withItems`, `isLocation`, PhotoPrism's `count`, `offset`, `merged`, `public`), and in 18 the agent never
  got that tool to answer.
- EspoCRM's contact update fails in every run: the served update accepts only the members recorded updates stored
  (`description`, `name`, `lastName`), and a seeded contact known only from lists can be neither read by id nor
  answered for. On #7274, gpt-oss passes the task by creating a replacement contact and deleting the original.
- Vikunja's task creates were withheld by an unexplained `index`, `identifier` and `subscription` (main's recording),
  or had no state target, being bulk creates (four recordings).

## Gates

- `npm run -s check:fast`, `format:check`, `scan:todos`, `docs:check`, `verify:test-discovery`, `mcp-catalog:check` and
  `jscpd`: passed. `npx knip` reports `staticFileUrlPath` and `ObjcClassImportBindingCoverage`, which main `8706068b`
  added and this branch does not touch.
- `npx vitest run --project domain --project services`: 11,430 passed, 6 skipped. `--project adapters`: 7,437 passed, 19
  skipped, 3 failed: the Inspector cancellation test and two AppKit asset-catalog tests, which fail the same way on
  #7274 at `e29e9c74`.
- `npm run -s test:focused --` the environment build, export and serve CLI boundaries, the analysis-view CLI and MCP
  boundaries and the environment serve MCP boundary: passed. `outputSchemaProfile`, `toolSchemaValidity`,
  `mcpSchemaValidation` and `outputSchemaSemanticConstraints`: passed; the compact catalog stays under its frame.

## Tests

- View: two task creates at a project path learn `index` as a `sequence` from 15, `identifier` as a `template` around
  it and `subscription` as a `made-object` whose `id` counts from 21 and whose `entity_id` holds the task's own id; one
  create alone keeps `index` as recorded; a bulk create whose body and answer wrap the task in `tasks` links to the
  tasks type and is served; an object with no member the request stamped makes no rule.
- Serving: created tasks take index 15 then 16, `#15` then `#16`, and a subscription numbered 22 holding the second
  task's id; a bulk create answers in its envelope, and one into another project stores that project.
- Query values: a number or boolean query value is spelled as its JSON text, and a list paged by a number answers as
  with the same text; through the MCP server, `maxSize: 2` and `withItems: true` replay their recording exactly. The
  served card of the `renamed` fixture grows 637 bytes, 91 for each of its seven query parameters.
- The seven behaviour tests fail on #7274 at `4ede1305`.

## Write plans and views over recorded captures

The 130 captures #7274 measured, built by #7274 at `45832406` and by this branch: 615 plans, 332 served and 333.

- No write goes from served to withheld. Newly served: Vikunja's bulk task create in #7260's final recording.
- Vikunja's task create in main's recording is now explained, by its counter, template and made subscription, but
  main's `unknown-clock` withholds it in both builds, as that capture has no clock anchor. Measured on #7274 at
  `4ede1305`, before that rule, it was served too (339 to 341).
- Six plans that stay withheld explain more: Homebox entity creates learn `assetId` as a counter from 5 in four
  recordings, and Vikunja task creates in two.
- In #7260's two Vikunja recordings whose UI writes lost their bodies, the bulk create now counts as a task write, so
  the scratch task it made is no longer held as seeded (35 to 34 and 36 to 35 initial entities), a read tool that read
  only that task replays its recordings, and later reads check fewer lines. Every other view is unchanged.

## The same recordings, built by #7274 and by this branch

Claude Code (`claude-sonnet-5-5`) recordings from earlier rounds, rebuilt by #7274 at `e839af3f` (its last two merges
change no census) and by this branch, their write tasks run with `fireworks_ai/gpt-oss-120b` then
`fireworks_ai/glm-5p3-flash`, each checked from the environment's state:

| Recording                                                  | Write tasks | #7274       | This branch |
| ---------------------------------------------------------- | ----------- | ----------- | ----------- |
| Vikunja: #7260 final (bulk creates)                        | 3 + 2       | 1/5 1/5     | 2/5 2/5     |
| Vikunja: main (two), saved-values (two), #7260 (first two) | 6 × (3 + 2) | 6/30 6/30   | 6/30 6/30   |
| EspoCRM: main, #7260 (three), saved-values                 | 5 × 3       | 15/15 10/15 | 15/15 10/15 |
| Homebox: main, #7260 final, saved-values (two)             | 4 × 2       | 6/8 6/8     | 6/8 6/8     |
| Total                                                      | 58          | 28/58 23/58 | 29/58 24/58 |

No recording passes fewer tasks with this branch.

- **Vikunja, bulk creates:** the create task passes with both models. The served bulk create numbers the task and makes
  its subscription, and creates into Lighthouse Rota though the recording created into the inbox.
- **Refused calls:** agents' calls were refused at input validation 34 times with #7274 (30 in Vikunja) and once with
  this branch, and agents made 286 tool calls against 317.
- **Main's `unknown-clock`** withholds Vikunja's task create and Homebox's tag create in main's recordings in both
  builds, so those tasks fail in both. Rebuilt by #7274 at `4ede1305`, before that rule, this branch without the
  linked-path change made main's Vikunja create task pass with both models (1/3 to 2/3) and changed no other result
  among the recordings that finished.

## Not verified

- A fresh recording with skill 52, which reads each listed object by id.
- Path parameters given as numbers stay refused: they are required properties, which REA keeps free of combinators.
- A counter one create alone shows, and linked creates into a collection whose path has parameters, which still take
  only their recorded path values.

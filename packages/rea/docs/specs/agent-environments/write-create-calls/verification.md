# Verification

Executed on macOS with Node v24.22.1 at `043053d1` (main `79845063`, the derived-values branch `8ce1127b` and this
branch). Recorded captures and served write tasks were measured with a local, unpushed build of this branch merged with
the scenario-timing branch (#6967), as the derived-values branch was; its baseline is the derived-values branch with the
same merge.

## Gates

- `npm run -s typecheck`, `lint`, `format:check`, `docs:check`, `mcp-catalog:check`, `verify:test-discovery`,
  `scan:todos` and `npx knip`: passed.
- `npx vitest run --project domain --project services --project adapters`: 17,258 passed, 25 skipped, 1 failed ("stops
  Inspector target authorization after the current stat settles"), which fails the same way on main in this environment.
- `npm run test:focused --` the environment build, export and serve CLI boundaries, the analysis-view CLI and MCP
  boundaries, the environment serve, served-writes and bundle MCP boundaries, MCP schema validation and output schema
  constraints: 10 files, 82 passed.

## Tests

- View: a later create sending a member the first did not, or leaving one out, widens the plan with the member's default;
  a later create storing a member otherwise than sent stays unexplained; sent tags stored sorted give a sorted echo; a
  create embedding the shelf its `shelf_id` names gives a reference, and the list that shows the shelf by id and name
  learns `nested_fields`.
- Serving: a create leaving the member out stores its default and one sending it stores it; a create embeds the named
  shelf as the environment holds it, lists it with the listed keys, and is refused for a shelf it does not hold; sent
  tags are stored sorted.
- Unit: references (the member named like the field among several, too few keys, a disagreeing value, an unheld entity)
  and merges (a constant that differs, a member one fixes and the other accepts, a reference one call shows alone).

## Write plans over recorded captures

The 69 captures the derived-values branch measured: 50 published, 18 Claude Code recorded from a prompt, and one timed
Grafana recording. After merging main `ed79bf93` (which bounds create learning), the census was run again against main
with the scenario-timing branch: 124 served there, 132 with both branches, no write going from served to withheld; the
columns below are the measurements before that merge, whose totals it reproduces.

| Captures                  | Write plans | Served before both branches | Derived values | This branch |
| ------------------------- | ----------- | --------------------------- | -------------- | ----------- |
| 50 published              | 187         | 68                          | 68             | 70          |
| 19 recorded from a prompt | 120         | 56                          | 61             | 62          |

- No write goes from served to withheld.
- Gains: Keycloak's published user create and update, whose list shows each user's `access` with one key, so a created
  user now lists as recorded and its plan's sorted insert checks; and the round-4 Linkding bookmark create, whose tags
  the application stores sorted.
- Explained but still withheld: Homebox's item create now merges with the location create, with references for
  `parent`, `location` and `entityType` and `parentId` and `entityTypeId` accepted with any value. Its read-back list
  answers items only, sorted by name, from a line with no parameter saying so, which the list model does not cover.
- Linkding's create whose later call sends `shared` merges too, and is withheld as `side-effect`: the recording also
  added a bookmark through the UI that no recorded write explains.

## Served write tasks

The same captures rebuilt by the baseline and by this branch, with `fireworks_ai/gpt-oss-120b` and
`fireworks_ai/glm-5p3-flash`. The tasks are new; each checks the result from the environment's state, including that
nothing else changed.

| Capture                     | Tasks                                      | Baseline (gpt-oss, GLM) | This branch (gpt-oss, GLM) |
| --------------------------- | ------------------------------------------ | ----------------------- | -------------------------- |
| Linkding, recorded round 4  | 2 bookmark creates, one with two tags      | 0/2, 0/2                | 2/2, 2/2                   |
| Keycloak, published capture | create a user, change another user's email | 0/2, 0/2                | 2/2, 2/2                   |

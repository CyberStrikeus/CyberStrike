# Verification

Executed on macOS with Node v24.22.1 on this branch, built on #7260's head `053264bd` (main `662ec2e4`), and on
Ubuntu 24.04 VMs for the task runs.

## Gates

- `npm run -s check:fast`, `scan:todos`, `docs:check`, `verify:test-discovery`, `mcp-catalog:check` and `jscpd`:
  passed.
- `npx oxfmt --check .` reports `scripts/verify-apk-signature.mjs` only, which this branch does not touch and
  `053264bd` reports too. `npx knip` reports `isToolFamilyId` in `src/contracts/toolFamilies.ts` only, as main does.
- `npx vitest run --project domain --project services --project adapters`: 18,420 passed, 25 skipped, 1 failed ("stops
  Inspector target authorization after the current stat settles"), which fails the same way on main in this
  environment.
- `npm run -s test:focused --` the environment build, export and serve CLI boundaries, the analysis-view CLI and MCP
  boundaries and the environment serve MCP boundary: 7 files, 75 passed.

## Tests

- View: a contact delete whose item read answers the record with `deleted: true` is served, confirmed by that read and
  the list; only a `true` `deleted`, `isDeleted` or `is_deleted` marks an object deleted; a delete is confirmed by a
  list read paged with `maxSize`; a field only created tasks show joins the task item view without being required; a
  task update whose answers show it is served.
- Serving: a deleted contact leaves the served list; an update of a seeded task, single or bulk, answers without the
  field only created tasks show (the bulk case fails on `4515a000`, before the review fix).
- The six behaviour tests fail on `053264bd`.
- The existing serving test that refuses to give chapter rows to a book the state holds without them still passes. A
  first version of the answer rule left out every field the item view does not require, which served that update; the
  rule now covers only fields no initial entity holds.

## Write plans and views over recorded captures

The 109 captures #7260 measured and #7260's 21 fresh recordings, built by `053264bd` and by this branch:

| Captures                  | Write plans | Served on #7260 | This branch |
| ------------------------- | ----------- | --------------- | ----------- |
| 50 published              | 187         | 70              | 71          |
| 80 recorded from a prompt | 428         | 258             | 268         |

- No write goes from served to withheld, and no plan's rules, body or `insert` changes. The 11 newly served are
  EspoCRM contact deletes in seven recordings, the published EspoCRM capture's task delete, and Vikunja task updates
  in three recordings.
- With main `c6893d1a` merged, whose `unknown-clock` withholds clock writes without an anchor on both builds, #7260
  serves 322 and this branch 332. One of the Vikunja task updates is among the writes it withholds, so this branch
  gains 10, and none goes from served to withheld.
- 73 list views learn a page size they held as `inert`, valid only for its recorded values, as `limit`: 72 EspoCRM
  lists (`maxSize`) and one Umami list (`maxResults`). One EspoCRM stream list now counts a line paged only by
  `maxSize` as listing the whole collection and explains its other line's query; no view explains fewer lines.
- Six item views gain a field only later reads show, never required: Vikunja's tasks `subscription` in four recordings,
  a Homebox entity's `children` and Mattermost's posts `has_reactions`. Every other view is unchanged.

## The same recordings, built by #7260 and by this branch

Claude Code (`claude-sonnet-5-5`) recordings from earlier rounds, rebuilt by each version, their write tasks run with
`fireworks_ai/gpt-oss-120b` then `fireworks_ai/glm-5p3-flash`, each checked from the environment's state:

| Recording                                      | Write tasks | #7260       | This branch |
| ---------------------------------------------- | ----------- | ----------- | ----------- |
| EspoCRM: main, #7260 (three), saved-values     | 5 × 3       | 5/15 5/15   | 15/15 10/15 |
| EspoCRM: saved-values, leftover contact        | 3           | 0/3 0/3     | 0/3 0/3     |
| Vikunja: main, #7260 final, saved-values (two) | 4 × (3 + 2) | 8/20 8/20   | 8/20 8/20   |
| Homebox: main                                  | 2           | 2/2 2/2     | 2/2 2/2     |
| Total                                          | 40          | 15/40 15/40 | 25/40 20/40 |

No recording passes fewer tasks with this branch.

- **EspoCRM:** the contact delete passes with both models on all five recordings. The contact update passes with
  gpt-oss on all five only by replacing the contact: the served update refuses `emailAddress`, which no recorded update
  stored, so the agent created a contact with the new address and deleted the old one, which the task's check, by name
  and address, accepts. The update itself is refused in both builds, as is a read of a seeded contact by id, since the
  state knows seeded contacts only from list reads, which lack fields the item reads show. GLM's update fails in both
  builds the same way, and it often ends a turn at the eval agent's 1,024-token completion limit.
- **EspoCRM, leftover contact:** the recording started with a contact an earlier attempt left, held as seeded data, so
  every "nothing else changed" check fails in both builds.
- **Vikunja:** the newly served task update accepts the members the recorded update stored (`title`, `description`,
  `priority`), so the task asking to mark a task done is refused in both builds. The skill now asks for updates that
  change a status, an email address or a due date. Task creates are unchanged.
- **Homebox:** the entity view's new `children` field changes no task.

## Not verified

- An application answering `deleted: true` for a record it still lists, as a trash view might: such a read counts as
  absent. No recorded capture does this.
- The skill's update wording, which no fresh recording has used yet.

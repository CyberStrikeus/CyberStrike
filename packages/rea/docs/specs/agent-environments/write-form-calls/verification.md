# Verification

Executed on macOS with Node v24.22.1 at `5a3c6762` (main `99062fea`), and on Ubuntu 24.04 VMs with snap Chromium for
the agent recordings.

## Gates

- `npm run -s check:fast`, `format:check`, `scan:todos`, `docs:check`, `verify:test-discovery`, `mcp-catalog:check` and
  `jscpd`: passed. `npx knip` reports one unused export, `isToolFamilyId` in `src/contracts/toolFamilies.ts`, which this
  branch does not touch and main reports too.
- `npx vitest run --project domain --project services --project adapters`: 18,281 passed, 25 skipped, 1 failed ("stops
  Inspector target authorization after the current stat settles"), which fails the same way on main in this environment.
- `npm run -s test:focused --` the environment build, export and serve CLI boundaries, the analysis-view CLI and MCP
  boundaries and the environment serve MCP boundary: 7 files, 75 passed. `outputSchemaProfile.test.ts`: 4 passed; the
  full catalog grows 648 bytes and the compact catalog, 554,640 bytes, does not change.

## Tests

- View: form creates whose empty members differ require only the member both filled and apply the others as sent; a
  create with only a last name, sending `null` for strings and for a flag another create sent `false`, merges and is
  served; a rename moves a label in a collection its
  creates sort by name; a rename that sorts first teaches a folder collection's title order to its creates and updates;
  a list envelope's `all` is learned and creates there are confirmed; a create answer with an unloaded owner and `[]`
  for `null` takes its item read; an update answer spelling an empty list `[]` is unchanged; a later create storing a
  derived field otherwise is withheld at the create and later deletes stay confirmed.
- Serving: a label created from its name alone stores the empty members as sent and is inserted by name, and one
  without the required name is refused; renamed labels and folders move to where their new names sort, and a bulk
  rename of two labels moves each; a created tag's id appears in the list envelope's `all` in list order; a note sent
  `null` as one recording did is accepted after a later call taught `""` as its default, which a note left out takes;
  a created and an updated task answer `assignees: []` as their recordings did while reads show `null`.
- Review cases: a member's recorded empty value stays accepted once a default is learned; a rename teaches title order
  where the creates fit both id and title order; moving written entities in turn sorts `[a, b, c, d]` with `b→h` and
  `c→i` as `[a, d, h, i]`. The plan and serving tests for these fail on the branch's first head `0ceff6fa`.

## Write plans over recorded captures

The 109 captures the saved-values branch measured: 50 published captures and 59 Claude Code recorded from a prompt,
built by main and by this branch.

| Captures                  | Write plans | Served on main | This branch |
| ------------------------- | ----------- | -------------- | ----------- |
| 50 published              | 187         | 70             | 70          |
| 59 recorded from a prompt | 337         | 177            | 209         |

No write goes from served to withheld. The 32 newly served are 23 Paperless creates (tags, correspondents and document
types, every recording), 3 Vikunja label creates, a Vikunja task update, Grafana's folder rename and delete, a Homebox
tag delete, and a Linkding bundle update and delete. 65 plans require fewer members and 66 carry `body.blank`; 30 plans
change `insert`, mostly updates that now move their entity by the field their type's creates sort by.

## Agent-built environments

Claude Code (`claude-sonnet-5-5`) built an environment of each of seven applications from the same prompt, as the
saved-values branch measured, and each bundle's write tasks ran with `fireworks_ai/gpt-oss-120b` and
`fireworks_ai/glm-5p3-flash`. Each task checks its result from the environment's state, including that nothing else
changed.

The Homebox and Linkding task specs used until now checked for seed objects an earlier round's recordings left behind
("Rec Fragile", `scratch-two.example.test`), which no current recording holds, so their "nothing else changed" check
could not pass. They now check the current seed. With the corrected specs, main passes both Homebox and both Linkding
tasks on the saved-values branch's recordings, so earlier rounds' 0/2 for those applications measured the specs, not
the required members.

**The same recordings, built by main and by this branch** (gpt-oss, GLM):

| Recording                     | Write tasks | Main      | This branch |
| ----------------------------- | ----------- | --------- | ----------- |
| Paperless, saved-values       | 3           | 1/3 2/3   | 3/3 3/3     |
| Paperless, main (two)         | 3 + 3       | 3/6 3/6   | 5/6 5/6     |
| Grafana, saved-values         | 2           | 0/2 0/2   | 1/2 1/2     |
| Grafana, main (two)           | 2 + 2       | 3/4 3/4   | 4/4 3/4     |
| Vikunja, saved-values + main  | 5 + 5       | 3/10 3/10 | 3/10 3/10   |
| EspoCRM, saved-values + main  | 3 + 3       | 1/6 1/6   | 1/6 1/6     |
| Homebox, saved-values + main  | 2 + 2       | 2/4 2/4   | 2/4 2/4     |
| Linkding, saved-values + main | 2 + 2       | 2/4 2/4   | 2/4 2/4     |
| Miniflux, saved-values        | 3           | 3/3 3/3   | 3/3 3/3     |
| Total                         | 42          | 18 19     | 24 23       |

No recording passes fewer tasks with this branch. Paperless creates pass once served. The saved-values Grafana
recording's rename is served and passes; its create still needs the saved-values branch's composed address.
Vikunja's task create, EspoCRM's leftover contact (held as seeded data, so every "nothing else changed" check fails)
and the main Homebox recording, which wrote no tags, are unchanged.

**Fresh recordings.** Each application was recorded afresh with main (skill 49) and with this branch. The branch was
recorded again for the four applications whose first branch recording passed fewer tasks, and a third time after the
skill's sixth step was reworded; the final skill's recordings are the last column (served writes, then tasks):

| Application | Write tasks | Main                 | Branch, first two recordings | Branch, final skill  |
| ----------- | ----------- | -------------------- | ---------------------------- | -------------------- |
| Paperless   | 3           | 2, 1/3 2/3           | 8, 1/3 2/3                   |                      |
| Linkding    | 2           | 0, 0/2 0/2           | 5, 2/2 2/2                   |                      |
| Miniflux    | 3           | no bundle            | 4, 3/3 3/3                   |                      |
| Grafana     | 2           | 3, 2/2 2/2           | 1, 0/2 1/2; 3, 1/2 2/2       | 0, 0/2 0/2           |
| Vikunja     | 3 + 2       | 3, 1/3 1/3 + 2/2 2/2 | 0, 0/5 0/5; 0, 0/5 0/5       | 1, 1/3 1/3 + 0/2 0/2 |
| EspoCRM     | 3           | 2, 1/3 1/3           | 2, 1/3 1/3; 2, 1/3 1/3       | 2, 1/3 1/3           |
| Homebox     | 2           | 4, 2/2 2/2           | 1, 0/2 0/2; 1, 0/2 0/2       | 3, 2/2 2/2           |

Every fresh recording builds the same plans with main and with this branch, except Paperless (main serves 0 of the
branch recording's writes and 2 of 3 of its own), Vikunja's main recording (3 to 4) and the EspoCRM recordings below;
the per-application differences are what each agent recorded:

- **Paperless:** the branch recording serves creates, renames and deletes of tags, correspondents and document types.
  Its two tag creates used a light and a dark color, whose derived `text_color` differs, so the tag create stays
  withheld and the tasks, which create a tag, score as on main.
- **Linkding:** main's agent recorded no writes. The branch's second bookmark create sent only `url` and `title`, so
  the served create requires only those.
- **Miniflux:** main's agent stopped and asked for an API key. The branch's agent created a token in the UI and sent it
  as a literal header value, which REA recorded as written; the instance and its token were destroyed afterwards.
- **EspoCRM:** following the sixth step, the branch's second contact sent only a last name, with `null` for strings the
  first stored and for flags it sent `false`. That merge was refused until the empty-spelling fix in this PR; with it,
  the create requires only `lastName` and `name` and its task passes, as on main.
- **Vikunja:** the first two branch agents wrote through the UI, whose request bodies Chromium did not expose, so every
  write was `body-unusable`. The sixth step then read "fill every field the form offers"; reworded to say how the
  creates differ, not where they are made, the third agent wrote with request steps. It recorded no label writes.
- **Homebox:** the first two branch agents recorded item writes only, the third tags as main's did.
- **Grafana:** the branch agents created folders with request steps and their own uids. The second create's address
  needs the saved-values branch's composed-address fixes to be explained, so the create is withheld here.

## Not verified

- One to three fresh recordings per application and version; agent runs vary more than the builds do.
- Request bodies Chromium does not expose for some UI writes (Vikunja's); the skill now re-records such a write once
  with request steps.
- Paperless derives `text_color` from `color`, so a create whose two recorded colors differ in brightness stays
  withheld; EspoCRM's create still requires `name` and `emailAddressData`, which it derives from other members.

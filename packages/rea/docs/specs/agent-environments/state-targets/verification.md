# Verification

Executed on macOS with Node v22.23.1, one change at a time on main, over the 50 published capture-built environments
(each app's latest capture). The served smoke rebuilds each manifest with the tree under test and applies every served
write tool; the serving check answers every recorded read made before the capture's first write through state serving
and compares it with the recording. The serving check reads no records from the five browser-scenario captures (Art
Institute collection, LoC photos, Lychee, PhotoPrism, Pinry), so its read counts cover 45 apps; their 41 views count
among the state-backed views.

## Gates

- `npm run build:cached`, `npm run check:fast` (typecheck and lint, no new warnings in the changed files),
  `npm run format:check`, `npx knip`, `npm run scan:todos`, `npm run docs:check`, `npm run verify:test-discovery` and
  `npm run mcp-catalog:check`: passed.
- `npm run jscpd`: 3.49% duplicated lines over 4074 files.
- `npx vitest run --project domain --project services`: 8992 passed, 6 pre-existing skips, on main `ed069bb9`.
- `npm run test:prepare`, then `npm run test:focused --` the environment serve and export CLI boundaries, the serve
  and served-writes MCP boundaries, the analysis-view CLI and MCP boundaries, the compact input schema boundary and
  tool schema validity: 8 files, 88 passed.

## Measurements

| Step            | Write tools | Served | No state target | State-backed read views | Recorded reads matching |
| --------------- | ----------- | ------ | --------------- | ----------------------- | ----------------------- |
| main            | 195         | 46     | 91              | 1,098                   | 1,833 of 1,886          |
| read-only POSTs | 189         | 46     | 84              | 1,104                   | 1,911 of 1,964          |
| adoption        | 189         | 47     | 84              | 1,104                   | 1,911 of 1,964          |
| linked creates  | 189         | 48     | 80              | 1,105                   | 1,911 of 1,964          |
| rewrite cuts    | 189         | 51     | 77              | 1,110                   | 1,922 of 1,975          |
| variant lines   | 189         | 61     | 61              | 1,150                   | 2,068 of 2,126          |
| review fixes    | 189         | 61     | 61              | 1,151                   | 2,075 of 2,133          |
| third round     | 189         | 61     | 62              | 1,151                   | 2,075 of 2,133          |

The served smoke applies every served write tool at each step. No read view loses its state backing, and no served
write tool is lost.

- **Read-only POSTs:** six tools leave the write list (Mattermost `members/ids`, Miniflux `discover`, NocoDB's two
  internal tunnels, Paperless `selection_data`, PocketBase `auth-refresh`); Paperless's notes create gains a target.
  Grafana's `query-history` stays a write. Nomad `jobs/statuses` repeats its GET, but its integers exceed JSON's
  exact range, so it stays a write.
- **Adoption:** Grocy's product delete is served; Mealie's recipe delete moves from no observation to unconfirmed.
- **Linked creates:** Jellyfin's item delete is served; its playlist create and item update, and Mailpit's send, gain
  targets. Grafana's `/api/search` and Mailpit's messages no longer hold the dashboard and message their captures
  created.
- **Rewrite cuts:** Tandoor's recipe create, update and delete are served.
- **Variant lines:** Baserow's row create, update and delete, Keycloak's user delete, Miniflux's category create and
  update, PocketBase's create, update and delete, and Vikunja's task delete are served. Ghost's post create and update,
  Keycloak's user update, Miniflux's category delete, n8n's tag create and Vikunja's task update gain targets.
- **Review fixes:** no write verdict changes. A NocoDB records list whose `fields` line had rejected it becomes
  state-backed, and all 7 of its recorded reads match. Without its guard, a short id would cut 23 Tandoor views'
  initial windows at a `POST /api/view-log/` returning `{"id":1}`.
  The second round (the gate skipping exactly the reads serving replays, earlier reads vetoing a linked create, whole
  RPC batches, and releasing a discarded planning pass) changes no measurement.
- **Third round:** Mailpit's send, a linked create that was never observed, loses its target: other writes (marking
  messages read, tagging) ran between it and the item read naming its id. No served write, read view or matching read
  changes.
- **Fourth round:** no verdict, read view or recorded read changes. A purge of temporary files removed 32 of the local
  captures, so this round was measured on captures restored from the published datasets, byte-identical where a local
  copy survived; Baserow's, Grocy's and Keycloak's published captures predate the ones measured above. On that set the
  previous head and this one both give 187 write tools, 62 served (smoke 62 of 62), 1,151 views and 2,085 of 2,155
  recorded reads matching.
- **Fifth round** (on main `6a34be41`): no verdict, read view or recorded read changes on the same restored captures,
  once the serving check passes a repeated query value as an array, as main now expects.
- **Sixth round:** no verdict, read view or recorded read changes on the restored captures.
- **Seventh round** (on main `96ea32b7`): WordPress's post create moves from side-effect to unconfirmed, still unserved:
  its only later read, `/wp-json/wp/v2/posts/22?context=edit`, shows the edit representation (`generated_slug`), so it
  is now replayed rather than checked. No served write, read view or recorded read changes.
- **Eighth round** (on main `3e7e102a`): no verdict, read view or recorded read changes on the restored captures.
- **Ninth round** (on main `b7ebccf8`): no verdict, read view, recorded read or session replay changes on the restored
  captures (187 write tools, 62 served, 1,151 views, 2,085 of 2,155 initial reads and 2,764 of 3,022 session reads
  matching).
- **Tenth round** (on main `a2235b09`): no verdict, read view, recorded read or session replay changes on the restored
  captures.
- **Eleventh round** (on main `2968d1e9`, performance review): variant lines compare only lines that share an entity,
  read-only decisions parse each body once and keep its digest, and the creation cut skips reads that cannot count.
  Every census, serving-check and session-replay row equals the previous head's. On a synthetic capture of a list and
  1,000 items read plainly and with `?expand=`, the variant pass falls from 401 ms to 2 ms and the state build from 659
  ms to 216 ms (Node v22.23.1).
- **Twelfth round** (on main `d87e73f2`, second performance review): the write gate lists a type's collections only when
  the path's own collection holds no id, and the variant pass parses base lines once. Every census, serving-check and
  session-replay row equals the previous head's. The synthetic 1,000-item capture takes 259–264 ms against main's
  244–247 ms (378–397 ms before this round; Node v22.23.1, medians of seven warm runs). Over the 50 captures, the
  environment-state and environment-manifest views together take 2.96 s wall and 3.82 s CPU with a 540 MiB peak RSS,
  against main's 2.61 s, 3.41 s and 516 MiB (one Node v24.22.1 process per sweep, warm medians of three runs; the cold
  first run is within 2% of them); the environment-state view alone takes 2,093 ms against 1,791 ms, and its results
  grow from 3.69 MB to 3.84 MB. Agent tokens were not measured.

Of the 40 views variant lines make state-backed, 146 of 151 recorded reads before the first write match; the other five
(Sentry projects) are replayed, and replay returns the first of several differing recordings, as before. A paged
Paperless document list answers all five documents, a PocketBase item without `expand` answers without it, and a
NetBox `site_id` filter learned from one line is not adopted.

## Not included

- Making a value that differs between two request lines volatile: it contradicts the spec's distinct query strings and
  made 11 recorded reads answer otherwise than replay.
- Item actions (`/{type}/{id}/archive`), bulk writes at a collection path, templating literal ids by value, and
  envelope masking: each needs further recording evidence or a separate change.

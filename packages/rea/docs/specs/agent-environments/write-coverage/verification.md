# Verification

Executed on macOS with Node v22.23.1 on this branch, whose base is the write-plan branch's head `ad8f674d`.

## Gates

- `npm run build:cached`, `npm run check:fast` (typecheck and lint, no new warnings in the changed files),
  `npm run format:check`, `npx knip`, `npm run scan:todos`, `npm run docs:check`, `npm run verify:test-discovery` and
  `npm run mcp-catalog:check`: passed.
- `npm run jscpd`: 3.45% duplicated lines over 3776 files.
- `npx vitest run --project domain --project services`: 7808 passed, 5 pre-existing skips. Two unrelated heavy tests
  (keyed-archive traversal, a 125,000-dependent Evidence graph) passed only with a longer timeout on a loaded machine.
- `npm run test:prepare`, then `npm run test:focused --` the environment serve and export CLI boundaries, the serve
  and served-writes MCP boundaries, the analysis-view CLI and MCP boundaries, the compact input schema boundary and
  tool schema validity: 8 files, 79 passed; the analysis-view MCP file needed a longer timeout on the loaded machine.

## Tests

- Manifest: a `204` write with no body is kept as a tool whatever its content type, and a write only redirected is not.
- Gate:
  - a field a read-back leaves out stops being required, and a create lacking it is served only when its own read
    leaves it out too;
  - an item view proves its identity past a read that asked for some fields only, which is left to replay;
  - creates numbered in digit groups are served.
- Serving: a created entity is served without the omitted field while seeded ones keep it; a call naming `fields`
  replays with the reason `projection` while other calls answer from the state; creates take the next number in the
  held value's digit groups.
- Unit: `-`-separated digit groups of one width read as a sequence, and a date, version, address or decimal does not;
  the next value keeps the groups, overflow leading.
- The gate, serving and manifest tests fail on `ad8f674d`.

Review fixes, each with a test that fails on `a4c4a23b`:

- Gate:
  - a read naming `fields`, or of a book the state no longer holds, notes no omission, and a create read back only
    through `?fields=id,name` is not served;
  - an omission an item read shows stops every view of the type requiring the field;
  - a read naming `fields` that leaves a required field out neither resynchronises an entity nor serves as a write's
    observation, so a `204` update read back first through `?fields=id,name` learns its effect from the whole read;
  - a later create whose sequence value serving would spell otherwise (`00-04` or `4` after `000-003`) withholds the
    plan.
- Serving: an empty projection argument replays; a projection of a deleted book answers as missing; a created book
  without the omitted field lists.

## Published captures

Over the 50 published captures, against `ad8f674d`:

- Write groups excluded as `non-json` go from 13 in five captures to none. Directus, Jellyfin, Keycloak, Miniflux and
  Shlink gain those tools, so their manifests change.
- Served write tools go from 35 to 39; none is lost:
  - Directus's provisions item view proves its identity past `GET /items/provisions/2?fields=title`, so its create and
    update are served;
  - Jellyfin's `DELETE /Items/{id}` and Shlink's `DELETE /rest/v3/short-urls/{slug}` are served.
- Airbyte's job item view stops requiring two fields its reads leave out; its verdicts are unchanged.
- Six states change: those five captures and Airbyte.
- A served smoke with manifests rebuilt by each tree applies all 39 served write tools here and all 35 on the base.

## Re-recorded captures

Captures re-recorded with a read-back after each first write and two scratch objects per write tool:

- A Homebox pilot recording numbers assets in digit groups (`000-001`, `000-002`, …). Its create goes from
  `contradicted` to served with a `sequence` rule on `assetId`, and the smoke applies it and the delete.
- Five published environments rebuilt from such recordings (Navidrome, Lychee, Homebox, Directus, Linkding) go from 9
  served write tools to 11, and the smoke applies all 11:
  - Navidrome's playlist views stop requiring `imageAbsent`, which its new playlists leave out, so its playlist update is
    served;
  - Homebox's create is served, as in the pilot recording.
- Jellyfin and Memos, re-recorded and rebuilt end to end with this change (manifest, bundle, smoke and both evaluation
  models on 12 retrieval tasks each), serve no new write:
  - Jellyfin's four bodiless write groups become tools, all withheld. Its playlists are created through
    `POST /Playlists` but read back only through `/Items/{id}`, which stops that item view rendering from the state.
  - Memos has none of the four shapes; it names items `memos/<id>`, which the identity proof does not match.

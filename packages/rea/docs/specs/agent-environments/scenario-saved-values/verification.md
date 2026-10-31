# Verification

This is Edgar Arakelyan's historical verification record from upstream PR #7162
(head `d39f386d202fe8e98592fb2d9d26e43d8d0fb94f`), retained with attribution.
These multi-application and model evaluations were not rerun during integration.
The independent integration measurements and their limits are recorded in
[saved-values integration verification](../../../verification/browser-saved-values-2026-10-26.md).

Executed on macOS with Node v24.22.1 at `feat/recorder-saved-values` e42362c9 (on main 2b84efe0), and on Ubuntu 24.04
VMs with snap Chromium for the agent recordings.

## Gates

- `npm run typecheck`, `lint:built`, `format:check`, `metadata:check`, `verify:architecture-guards`, `knip:production`,
  `lint:typed`, `docs:check`, `mcp-catalog:check`, `verify:test-discovery`, `scan:todos` and `jscpd`: passed.
  `knip` reports one unused export, `isToolFamilyId` in `src/contracts/toolFamilies.ts`, which this branch does not
  touch and main 2b84efe0 reports too.
- `npx vitest run --project domain --project services --project adapters`: 18,261 passed and 1 failed, "stops Inspector
  target authorization after the current stat settles", which fails the same way on main in this environment.
- Browser scenario CLI and MCP boundaries, scenario input diagnostics, cancellation and cleanup, the analysis-view CLI
  and MCP boundaries, the environment build, export and serve CLI boundaries, the environment serve, served-writes and
  bundle MCP boundaries, tool schema validity, MCP schema validation, and output schema constraints and profile: 17
  files, 128 passed.
- The compact MCP catalog must stay under the one-megabyte frame `outputSchemaProfile.test.ts` measures. A first
  design with `path_params` on request and goto steps, `json_values`, and separate `username` and `password` unions
  added 9,391 bytes on main ff6d96bc and failed the test, which then had 5,731 bytes to spare. Saved values now travel
  as `{saved:name}` placeholders, Basic credentials repeat their part union once, and repeated inner descriptions were
  dropped: on main 2b84efe0 the catalog takes 1,038,975 bytes and this branch 1,042,639.

## Compatibility

- Scenarios that save nothing record the same Evidence parameters and `scenario_sha256` on main and on this branch: a
  UI-only scenario with a goto to a URL holding literal braces, and a request step with a secret query value, a cookie
  header, and literal braces in its path and JSON body.
- Main reads a capture that uses saved values: `environment-build --dry-run` of the real-Chrome capture below gives the
  same manifest, state, coverage and file plan on main and on this branch. This branch adds the
  `credential-named-saved-values` warning.
- Write plans for 109 captures (the 50 published captures, 29 earlier agent recordings and the 30 recorded in the
  comparison below), built by main and by this branch: 524 plans and 247 served on each. Three plans differ, all
  Grafana folder creates recorded below, whose `url` the branch composes from the uid and the title's slug where main
  learned a template or nothing.

## Real Chrome

A local application with a cookie-session UI and an API that takes only Basic auth, recorded with Google Chrome:

- fill a name and click Save with `save_response` on `POST /ui/items`, saving the new id;
- `goto` `/items/{saved:item1}` and wait for the item's page;
- `GET /api/items/{saved:item1}` with Basic credentials whose username comes from local storage and password from a
  declared secret;
- `POST /api/tokens`, saving the token both as a secret and, unmarked, as `session_token`;
- `POST /api/items` with the saved token in a header and `{"name": "Child of {saved:item1}", "ref": "{saved:item1}"}`;
- `PATCH /api/items/{saved:child}` and `GET /api/items?parent={saved:item1}`.

All 11 steps completed. The requests went to `/items/101`, `/api/items/101`, `/api/items/108` and `?parent=101`, and the
body sent was `{"name":"Child of 101","ref":101}`. The Evidence parameters keep the placeholders, the password appears
nowhere in the capture, and the token header is recorded as `[REDACTED:page:token.api_token]`. The token's own response
was redacted too in this run; the docs say it may not be, since the recorder reads bodies on their own schedule.
`environment-build` warned about `/parameters/actions/7/save/1`.

## Agent-built environments, main and this branch

Claude Code (`claude-sonnet-5-5`) built an environment of each application from the same prompt, with REA main
ff6d96bc (skill 49) and with this branch (skill 50), on freshly seeded instances. Each bundle was rebuilt by the REA it
was recorded with, and its write tasks run with `fireworks_ai/gpt-oss-120b` and `fireworks_ai/glm-5p3-flash`. Each task
checks its result from the environment's state, including that nothing else changed.

The branch was recorded three times as it changed:

1. With the skill as first written, EspoCRM's agent wrote through request steps with Basic credentials instead of the
   UI, and EspoCRM's API answers in a shape the write model withholds (0/3). The skill's recording example created its
   object with a request step, which agents copy; it now creates through the UI with `save_response`.
2. With that example, Grafana's agent created folders through the UI, where Grafana generates the uid. REA then learned
   the folder's `url` as a template around the uid that kept the first folder's slug, and coverage did not check the
   template against the second folder, so served creates answered with wrong addresses (0/2). The write-model fixes
   in this PR compose the address from the uid and the title's slug, learn Grafana's `&` spelling, and check templates
   on later creates.
3. With both, every application was recorded again.

**The same recordings, before and after the write-model fixes.** Run 2's captures, rebuilt by this branch before and
after the fixes (gpt-oss, GLM):

| Application | Before        | After         |
| ----------- | ------------- | ------------- |
| Miniflux    | 3/3 3/3       | 3/3 3/3       |
| Paperless   | 1/3 2/3       | 1/3 1/3       |
| Vikunja     | 1/3 1/3 + 0/2 | 1/3 1/3 + 0/2 |
| Linkding    | 0/2 0/2       | 0/2 0/2       |
| Homebox     | 0/2 0/2       | 0/2 0/2       |
| Grafana     | 0/2 0/2       | 2/2 2/2       |
| EspoCRM     | 1/3 1/3       | 1/3 1/3       |

Only Grafana's plans change, and its tasks pass. Paperless's plans are identical in both builds; its GLM difference is
the eval model's.

**Fresh recordings, main and the final branch:**

| Application | Write tasks | Main: served, tasks    | Branch: served, tasks |
| ----------- | ----------- | ---------------------- | --------------------- |
| Miniflux    | 3           | no bundle              | 4, 3/3 3/3            |
| Paperless   | 3           | 3, 1/3 1/3; 6, 2/3 2/3 | 6, 1/3 2/3            |
| Vikunja     | 3 + 2       | 1, 0/3 0/3 + 0/2 0/2   | 3, 1/3 1/3 + 2/2 2/2  |
| Linkding    | 2           | 0, 0/2 0/2             | 3, 0/2 0/2            |
| Homebox     | 2           | 1, 0/2 0/2             | 5, 0/2 0/2            |
| Grafana     | 2           | 2, 2/2 2/2; 3, 2/2 2/2 | 1, 1/2 1/2            |
| EspoCRM     | 3           | 2, 1/3 1/3             | 2, 0/3 0/3            |
| Total       | 20          | 9, 4/20 4/20           | 24, 8/20 9/20         |

"Served" counts the write tools the final capture serves; tasks are gpt-oss then GLM, and Miniflux's count as failed
without a bundle. Paperless and Grafana were recorded twice on main; totals use the first run.

- **Miniflux:** main's agent stopped and asked for an API key, since the API takes Basic auth. With Basic credentials
  the branch served category create, rename and delete in all three runs, and every category task passed with both
  models.
- **Vikunja:** label edits and deletes are served and pass in two of the three branch runs, and task deletes in the
  last two.
- **Saved ids:** every branch agent saved ids, with `save_response` on UI writes, and read objects back by them. On main
  no step can carry a value to a later one, so agents chose their own ids or read lists back instead.
- **Paperless:** the two main runs differ as much as main and the branch do.
- **Linkding and Homebox** serve more writes, but their create tasks still fail. Linkding's served create requires every
  member its recorded calls sent (`description`, `notes`, `unread`, `shared`, `tag_names`), so a task that sends a URL
  and a title is refused.
- **Grafana:** the folder create is served with the right address and its task passes. The rename is withheld:
  Grafana lists folders sorted by title, the recording renamed a folder to a title that sorts first, and REA keeps an
  updated entity where it was in a list. Main's REA reads this recording the same way, and serves its create with the
  template that keeps the first folder's slug, so the create task would fail too. Main's two recordings passed because
  their titles kept their order.
- **EspoCRM:** the recording started with a contact an earlier attempt in the same session created and left, so the
  environment holds it as seeded data and every task's "nothing else changed" check fails. The skill now asks agents to
  delete what an earlier attempt created before recording again; that change was not measured.
- Agents spent $9.98 and 3,149 seconds in total on the fresh branch run, against $7.45 and 2,235 on main, a third of it
  Homebox's.

## Not verified

- One fresh recording per application and version, two for Paperless and Grafana on main; agent runs vary.
- Lists sorted by a field that an update changes, and the skill's cleanup of earlier attempts.
- Multi-factor sign-in, and saved values in `fill` or `select_option` steps, which this change does not add.

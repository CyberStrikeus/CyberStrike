# Verification

Executed on macOS with Node v24.22.1 at `2f807efb` (main `8e6a9578` and this branch).

## Gates

- `npm run check` (build, typecheck, format, lint, typed lint, module boundaries, architecture guards) and
  `npm run docs:check`: passed.
- `npx vitest run --project domain --project services --project adapters`: 17,624 passed, 25 skipped, 1 failed ("stops
  Inspector target authorization after the current stat settles"), which fails the same way on main in this environment.
- `npm run test:focused --` the analysis-view, environment build, compare, export and serve CLI boundaries, the
  analysis-view, environment bundle, serve and served-writes MCP boundaries, tool schema validity, output schema profile
  and MCP schema validation: 12 files, 106 passed.
- The eight new view and serving tests fail on main and pass here.

## Recorded captures

The 69 recorded captures and the five held-out agent recordings, built as environment-state views on main and on this
branch:

| Captures                                  | Served on main | Served here | Served to withheld |
| ----------------------------------------- | -------------- | ----------- | ------------------ |
| 69 recorded                               | 132            | 132         | none               |
| 5 held-out (20 write tools with a target) | 8              | 10          | none               |

- **Now served:** EspoCRM's contact create (its read-back adds nine fields the answer lacks) and Paperless's tag edit
  (the stale slug is slugged anew from the name).
- **Past the read-back, withheld by other gaps:**
  - Paperless's tag create: its list's `all` member lists every id, which state rendering does not model.
  - Ghost's tag create and edit: the state does not list the created tags in Ghost's tag lists.
- **Still contradicted:** Vikunja's label create, whose item read-back shows a fully loaded `created_by` where the answer
  showed a partial one.
- Three plans of the recorded captures (Airbyte, BookStack, PhotoPrism) now record a read-back; their served state is
  unchanged.

## Served write tasks

The held-out round's write tasks, rebuilt from the same agent recordings with this branch, with
`fireworks_ai/gpt-oss-120b` and `fireworks_ai/glm-5p3-flash`:

| Application                                    | Main (gpt-oss, GLM) | This branch (gpt-oss, GLM) |
| ---------------------------------------------- | ------------------- | -------------------------- |
| EspoCRM contacts: create, update email, delete | 0/3, 0/3            | 1/3, 1/3 (create)          |
| Paperless tags: create, rename, delete         | 1/3, 1/3            | 1/3, 2/3 (rename with GLM) |

- gpt-oss's rename did not apply. Its trajectory was not kept, so the cause is unconfirmed. A served `PUT` requires
  every member the recorded call sent (about 14 here), and GLM sent them all.
- EspoCRM's served update accepts only the members its recording edited, so the email change is refused, as on main.

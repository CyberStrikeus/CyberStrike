# CyberStrike v2 API (OpenCode V2 protocol) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give CyberStrike a second HTTP surface that speaks OpenCode's v2 wire contract exactly, so the `einyx/opencodex` iOS client talks v2 to CyberStrike and `scripts/v2_contract_check.py` becomes a CI gate.

**Architecture:** A new package `packages/api-v2` owns the contract only — upstream's `HttpApi` groups imported unmodified from the published `@opencode/protocol@2.1.4`, pure projections from CyberStrike's v1 shapes to v2 wire shapes, and the v1→v2 event mapping. The glue lives in `packages/cyberstrike/src/api-v2/` — handlers that call CyberStrike's domain directly, plus a second `Bun.serve` listener on port 4198 that mounts **only** v2 routes. `packages/api-v2` never imports `packages/cyberstrike`; there is no cycle.

**Tech Stack:** Bun 1.3.9, Effect 4.0.1 (`effect/http-api`), `@opencode/protocol@2.1.4`, `@opencode/schema@2.1.4`, `bun:test`, Hono (v1 surface, untouched), Drizzle + `bun:sqlite` (v1 schema, untouched).

**Spec:** `docs/superpowers/specs/2026-10-26-opencode-v2-protocol-adoption-design.md` — read it before starting; this plan implements it and the spec travels with it.

## Global Constraints

- Pin `@opencode/protocol@2.1.4`, `@opencode/schema@2.1.4`, `effect@4.0.1` exactly. Add them to the root `package.json` `catalog` and reference `"catalog:"` from `packages/api-v2/package.json`.
- **Do not depend on `@opencode/server` or `@opencode/core`.** Their middleware chunks import `@opencode/core/*` (domain-coupled, and it drags `bun-pty`/`jose`/`immer` into the tree). Only `@opencode/protocol` (deps: `effect`, `@opencode/schema`) and `@opencode/schema` are allowed.
- Upstream's group definitions are imported **unmodified**. Do not copy or edit a group file to change a schema — upstream's `makeApiFromGroup` is not exported, so `packages/api-v2/src/api.ts` re-assembles the `HttpApi` by copying upstream's `.add(...)` chain (from `@opencode/protocol@2.1.4` → `dist/groups/*.js` + `dist/api.js`) and adding nothing in phase 1.
- The v2 listener mounts **only** v2 routes. `GET /global/health` must not be 200-JSON, `GET /session/status` must not be a JSON map, `GET /session/:id/todo` must be 404, `GET /project/current` must be 404. The contract script asserts all four.
- Auth is CyberStrike's existing Basic auth, reused verbatim: username `CYBERSTRIKE_SERVER_USERNAME ?? "cyberstrike"`, password `CYBERSTRIKE_SERVER_PASSWORD`, loopback trusted. The contract script therefore runs with `V2_USER=cyberstrike`.
- Location scoping accepts all four forms on the v2 surface: `?location[directory]=`, `?directory=`, `x-opencode-directory`, `x-cyberstrike-directory`.
- The v1 surface (146 operations, `packages/cyberstrike/src/server/routes/`) is **not modified** by this plan, except where a task explicitly says so.
- **Phase 1 adds no fork groups.** CyberStrike's own groups (`vulnerability`, `request`, `observation`, `coverage-note`, `web-credential`, `methodology`, `hackbrowser`, `ingest`) are phase 2. The assembled `Api` in phase 1 contains upstream's groups and nothing else, so `openapi.json` equals upstream's.
- **Handler idiom**, used by every group task:

```ts
export const SessionHandler = HttpApiBuilder.group(Api, "server.session", (handlers) =>
  handlers.handle("session.list", Effect.fn(function* (ctx) {
    const sessions = yield* Effect.promise(() => Session.list({ directory: ctx.query.location?.directory }))
    return { data: sessions.map(projectSession) }
  })),
)
```

  The group id must equal the group's `_tag` exactly. The success schema validates the returned value, so a projection bug surfaces as a schema error at the boundary rather than as bad data on the wire.
- House style (root `AGENTS.md`): no `any`, single-word names, `const` over `let`, early returns over `else`, functional array methods, Bun APIs over node equivalents, type inference over explicit annotations.
- Tests run from package directories, never from the repo root (`bun test` at root exits 1 by design).
- Drizzle tables live in `src/**/*.sql.ts`, snake_case columns, join columns `<entity>_id`.
- The v2 surface must not require a provider key to pass the contract gate. `/api/model/default` falls back to the first models.dev catalog entry (network, no auth).

## Review Focus

Five input classes the spec implies that no upstream contract covers. Each gets a test in the task that owns the code.

1. **A session whose message list contains a tool error, a compaction and a subagent part.** The projection must not drop a message, and one malformed message must not 500 the whole list endpoint. → Task 4 (projection), Task 8 (message endpoint).
2. **`fs.read` on a path that does not exist, and `fs.list` on a path that is a file, not a directory.** Both must be a typed 404 (`FileNotFoundError`), never a 500 or an empty 200. → Task 10.
3. **`session.prompt` followed immediately by `session.interrupt` while the turn is still running.** `interrupted` must be `true` only when this process owned the execution, and the queued prompt must survive. → Task 7.
4. **A PTY client reconnecting with a cursor older than the retained buffer.** The replay must not duplicate output and must not throw. → Task 13.
5. **A session directory that does not exist on disk** (deleted between create and read). Location resolution must fail as a typed 404 (`LocationNotFoundError`), not a 500. → Task 5.

---

### Task 1: Package skeleton, upstream group assembly, OpenAPI generation

**Files:**
- Create: `packages/api-v2/package.json`, `packages/api-v2/tsconfig.json`
- Create: `packages/api-v2/src/api.ts` — the assembled `HttpApi`
- Create: `packages/api-v2/src/middleware/location.ts` — `LocationMiddleware`, `SessionLocationMiddleware`, `FormLocationMiddleware` service declarations
- Create: `packages/api-v2/script/generate-openapi.ts`
- Create: `packages/api-v2/test/openapi.test.ts`
- Modify: `package.json` (root) — add the three pins to `catalog`
- Modify: `packages/cyberstrike/package.json` — add `"@cyberstrike-io/api-v2": "workspace:*"`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `packages/api-v2/src/api.ts` → `export const Api` (the assembled `HttpApi`, used by every later task). `packages/api-v2/src/middleware/location.ts` → `export class LocationMiddleware`, `export class SessionLocationMiddleware`, `export class FormLocationMiddleware` (each an `HttpApiMiddleware.Service` subclass with `error: [LocationNotFoundError]` / `error: [InvalidRequestError, SessionNotFoundError, LocationNotFoundError]` / `error: [LocationNotFoundError]`, matching upstream's declarations in `@opencode/protocol@2.1.4` → `dist/middleware/*.d.ts`).

- [ ] **Step 1: Write the failing test**

`packages/api-v2/test/openapi.test.ts`:

```ts
import { expect, test } from "bun:test"
import path from "path"

const doc = await Bun.file(path.join(import.meta.dir, "../openapi.json")).json()

test("exposes upstream's session endpoints", () => {
  expect(Object.keys(doc.paths)).toContain("/api/session")
  expect(doc.paths["/api/session"].get.operationId).toBe("session.list")
  expect(doc.paths["/api/session"].post.operationId).toBe("session.create")
})

test("exposes upstream's info endpoint", () => {
  expect(doc.paths["/api/info"].get.operationId).toBe("server.info")
})

test("every path is under /api", () => {
  const outside = Object.keys(doc.paths).filter((p) => !p.startsWith("/api"))
  expect(outside).toEqual([])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/api-v2 && bun test`
Expected: FAIL — `ENOENT` on `openapi.json`.

- [ ] **Step 3: Create the package and assemble the API**

`packages/api-v2/package.json` — name `@cyberstrike-io/api-v2`, `type: module`, dependencies `"@opencode/protocol": "catalog:"`, `"@opencode/schema": "catalog:"`, `"effect": "catalog:"`; scripts `generate` → `bun run script/generate-openapi.ts`, `check:generated` → `bun run script/generate-openapi.ts --check`, `test` → `bun test`, `typecheck` → `tsc --noEmit`.

`packages/api-v2/src/api.ts` — copy the `.add(...)` chain out of `@opencode/protocol@2.1.4` → `dist/api.js` (the `makeApiFromGroup` body) into an exported `Api`, substituting the three middleware keys from `src/middleware/location.ts` for the ones upstream binds, and keeping the trailing `.annotateMerge(OpenApi.annotations({...}))`, `.middleware(Authorization)` and `.middleware(SchemaErrorMiddleware)`. Import every group from `@opencode/protocol/groups/*` — the factories that take middleware keys (`makeLocationGroup`, `makeSessionGroup`, `makeFormGroup`, `makePermissionGroup`) receive this package's own keys.

`packages/api-v2/src/middleware/location.ts` — three `HttpApiMiddleware.Service` subclasses, copied in shape from `@opencode/protocol@2.1.4` → `dist/middleware/*.d.ts` and `dist/client.d.ts`.

`packages/api-v2/script/generate-openapi.ts` — port upstream's `packages/protocol/script/generate-openapi.ts` (read it from the published tarball's source map or from upstream's git at the 2.1.4 tag): it calls `OpenApi.fromApi(ClientApi)` and writes `packages/api-v2/openapi.json`, and with `--check` exits 1 when the file differs. Use `@opencode/protocol/client`'s `ClientApi` as the source of truth, exactly as upstream does.

- [ ] **Step 4: Generate the OpenAPI document and verify the test passes**

Run: `cd packages/api-v2 && bun run generate && bun test`
Expected: PASS — 3 tests, and `openapi.json` contains ~149 paths.

Run: `cd packages/api-v2 && bun run typecheck`
Expected: no errors. **If it fails here, stop and re-read the upstream chain** — a type error means the group set or middleware keys were assembled wrongly, and every later task depends on this being right.

- [ ] **Step 5: Commit**

```bash
git add packages/api-v2 package.json packages/cyberstrike/package.json
git commit -m "feat(api-v2): assemble upstream's v2 HttpApi and generate openapi.json"
```

---

### Task 2: v2 listener with stubbed handlers

**Files:**
- Create: `packages/cyberstrike/src/api-v2/handlers/stub.ts`
- Create: `packages/cyberstrike/src/api-v2/handlers/<group>.ts` — one file per upstream group (31 files), each holding that group's stub handler
- Create: `packages/cyberstrike/src/api-v2/handlers.ts` — merges every group handler
- Create: `packages/cyberstrike/src/api-v2/middleware.ts` — authorization + schema-error + location layers
- Create: `packages/cyberstrike/src/api-v2/server.ts`
- Create: `packages/cyberstrike/test/api-v2/listener.test.ts`
- Modify: `packages/cyberstrike/src/cli/cmd/serve.ts`, `packages/cyberstrike/src/cli/network.ts` — `--api v2` flag

**Interfaces:**
- Consumes: `Api` from `@cyberstrike-io/api-v2`.
- Produces:
  - `packages/cyberstrike/src/api-v2/handlers/stub.ts` → `export const unavailable: Effect.Effect<HttpServerResponse>` — a 503 response with body `not implemented`.
  - `packages/cyberstrike/src/api-v2/handlers.ts` → `export const handlers: Layer.Layer<HttpApiBuilder.ApiGroup>` — merges every group handler.
  - `packages/cyberstrike/src/api-v2/server.ts` → `export async function listen(opts: { hostname: string; port: number; password?: string }): Promise<{ url: URL; stop(): Promise<void> }>`.
  - `cyberstrike serve --api v2` → starts the v2 listener on port 4198 alongside the v1 listener on 4096.

- [ ] **Step 1: Write the failing test**

`packages/cyberstrike/test/api-v2/listener.test.ts` — boot `listen({ hostname: "127.0.0.1", port: 0 })` and assert:

```ts
test("serves only v2 routes", async () => {
  expect((await fetch(`${url}/api/info`)).status).toBe(503)
  expect((await fetch(`${url}/global/health`)).status).toBe(404)
  expect((await fetch(`${url}/session/status`)).status).toBe(404)
  expect((await fetch(`${url}/project/current`)).status).toBe(404)
})

test("global health is not a 200 json document", async () => {
  const res = await fetch(`${url}/global/health`)
  expect(res.status).not.toBe(200)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/cyberstrike && bun test test/api-v2/listener.test.ts`
Expected: FAIL — module `../../src/api-v2/server` not found.

- [ ] **Step 3: Implement the stub surface and the listener**

`handlers/stub.ts` — a single `HttpServerResponse` with status 503 and body `not implemented`, returned from the handler success channel (Effect's builder accepts `HttpServerResponse` there). Do **not** use `Effect.fail(new ServiceUnavailableError(...))`: most upstream groups do not declare that error, so the handler's error channel would not typecheck.

`handlers.ts` — merges every group handler. Each group lives in its own file under `handlers/`, created in this task with stub bodies and **replaced** by the later group tasks; a group file is only ever edited in place, never split or renamed.

Each group file holds an `HttpApiBuilder.group(Api, "<group id>", ...)` whose every endpoint returns `unavailable`. The group id must equal the group's `_tag` exactly (`server.session`, `server.fs`, …). Copy the ids from `@opencode/protocol@2.1.4` → `dist/groups/*.js`.

`middleware.ts` — three layers, copied in shape from upstream's published `authorizationLayer` (`@opencode/server@2.1.4` → `dist/chunks/pairing-7b9xm1qg.js`) and `schemaErrorLayer` (`dist/chunks/pairing-erzfdgke.js`), but reading the password from CyberStrike's `Flag.CYBERSTRIKE_SERVER_PASSWORD` instead of upstream's `Config` service, and skipping auth for loopback requests exactly as `packages/cyberstrike/src/server/server.ts` does today. The location layers resolve `location[directory]` / `?directory=` / the two headers to a directory and provide it to the handlers.

`server.ts` — build the router with `HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" })`, provide the middleware layers, convert with `HttpEffect.toWebHandlerWith`, and serve it with `Bun.serve`. Mount nothing else.

`cli/cmd/serve.ts` + `cli/network.ts` — add `--api v2` (boolean) and a v2 port defaulting to 4198. When set, `serve` starts the v2 listener in the same process as the v1 listener.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/cyberstrike && bun test test/api-v2/listener.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the v1 surface is untouched**

Run: `cd packages/cyberstrike && bun test`
Expected: PASS — the pre-existing suite is unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/cyberstrike/src/api-v2 packages/cyberstrike/src/cli packages/cyberstrike/test/api-v2
git commit -m "feat(api-v2): serve a stubbed v2 surface on its own listener"
```

---

### Task 3: Projection spike (throwaway)

**Files:**
- Create: `packages/api-v2/script/spike-message.ts` (throwaway — not shipped, not imported by anything)
- Create: `packages/api-v2/spike.md` — the mapping decisions this spike produced

**Interfaces:**
- Consumes: `packages/cyberstrike/src/session` (message + part rows), `@opencode/schema@2.1.4` → `dist/session-message.d.ts` for the target shapes.
- Produces: `packages/api-v2/spike.md` — the field-by-field mapping table that Task 4 implements.

- [ ] **Step 1: Write the spike script**

`spike-message.ts` — create a session in a temp directory, insert one user message, one assistant message with a text part, one with a tool part (`status: "error"`), and one compaction part, then print the raw rows and the v2 shape each one should project to.

- [ ] **Step 2: Run it and compare against upstream's reference**

Run: `cd packages/cyberstrike && bun run ../../packages/api-v2/script/spike-message.ts`

Read upstream's `transformSession` for the target semantics — it is in upstream's `packages/core/src/database/v1-migration.bun.ts`; the published `@opencode/core@2.1.4` tarball contains the compiled `dist/database/v1-migration.bun.js`. Record every difference between what upstream does and what CyberStrike's rows contain.

- [ ] **Step 3: Record the findings**

Write `packages/api-v2/spike.md`: one table row per v1 part type (`text`, `reasoning`, `file`, `tool`, `snapshot`, `patch`, `step-start`, `step-finish`, `agent`, `subtask`, `compaction`, `retry`, plus CyberStrike's `json_schema`, `symbol`, `resource`) → the v2 content type it projects to, and what happens to the fields upstream drops.

- [ ] **Step 4: Commit the spike (labelled throwaway)**

```bash
git add packages/api-v2/script/spike-message.ts packages/api-v2/spike.md
git commit -m "chore(api-v2): spike the v1 to v2 message projection"
```

---

### Task 4: Projection library

**Files:**
- Create: `packages/api-v2/src/projection/types.ts` — plain structural types for the v1 inputs
- Create: `packages/api-v2/src/projection/session.ts`
- Create: `packages/api-v2/src/projection/message.ts`
- Create: `packages/api-v2/src/projection/permission.ts`
- Create: `packages/api-v2/src/projection/form.ts`
- Create: `packages/api-v2/test/projection.test.ts`

**Interfaces:**
- Consumes: `packages/api-v2/spike.md` (Task 3) for the mapping table.
- Produces:
  - `projection/session.ts` → `export function projectSession(info: SessionShape): { id: string; title?: string; location: { directory: string }; parentID?: string; time: { created: number; updated: number }; cost: number; tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }; agent?: string; model?: { id: string; providerID: string; variant?: string }; permissions?: unknown[]; metadata?: unknown; revert?: unknown }` — shaped to satisfy upstream's `PublicSessionInfo` at the protocol boundary.
  - `projection/message.ts` → `export function projectMessage(input: { info: MessageShape; parts: PartShape[] }): { type: string; [k: string]: unknown }` — one v2 message per v1 message, `type` in `user | assistant | synthetic | system | skill | shell | compaction | idle | agent-switched | model-switched | location-switched`.
  - `projection/permission.ts` → `export function projectPermission(request: PermissionShape): { id: string; sessionID: string; action: string; resources: string[]; metadata?: unknown; source?: unknown; message?: unknown }`.
  - `projection/form.ts` → `export function projectForm(question: QuestionShape): { id: string; sessionID?: string; title: string; fields: { key: string; type: string; label: string; options?: { value: string; label: string }[] }[]; state: "pending" }`.
  - `projection/types.ts` → the plain input types the four functions take. They are **structural**, so a drift between them and CyberStrike's domain types is a compile error at the call site.

- [ ] **Step 1: Write the failing tests**

`packages/api-v2/test/projection.test.ts` — cover, at minimum:
- a user message with one text part → `{type: "user", text: "hello"}`
- an assistant message with a text part → `{type: "assistant", model: {id, providerID}, content: [{type: "text", text}]}`
- an assistant message whose tool part has `status: "error"` → content entry `{type: "tool", id, name, state: {status: "error", error: {type, message}}}`
- a session info with `directory` → `{location: {directory}}`
- a v1 question with two options → a form with one `multiselect` field carrying both options
- a permission request → `{id: "per_…", action, resources: []}`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/api-v2 && bun test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the projections**

Follow `packages/api-v2/spike.md` exactly. Tool error mapping: v1 `state.error` is `{name, data}` → v2 `error: {type, message}` using the same type names upstream's `transformSession` uses (`provider.auth`, `provider.content-filter`, `provider.invalid-request`, `provider.invalid-output`, `aborted`, `provider.error`, `unknown`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/api-v2 && bun test`
Expected: PASS.

- [ ] **Step 5: Add the malformed-message regression test (Review Focus #1)**

Add a case where one message part has an unknown `type` — the projection must skip that part, keep the rest of the message, and not throw.

- [ ] **Step 6: Commit**

```bash
git add packages/api-v2/src/projection packages/api-v2/test/projection.test.ts
git commit -m "feat(api-v2): project v1 domain shapes into v2 wire shapes"
```

---

### Task 5: `server`, `location` and `project` groups

**Files:**
- Modify: `packages/cyberstrike/src/api-v2/handlers/server.ts`, `location.ts`, `project.ts`
- Modify: `packages/cyberstrike/src/api-v2/handlers.ts`
- Create: `packages/cyberstrike/test/api-v2/server-group.test.ts`

**Interfaces:**
- Consumes: `Api`, `projectSession` (Task 4).
- Produces: `export const ServerHandler`, `export const LocationHandler`, `export const ProjectHandler` in their respective files, merged into `handlers.ts`.

- [ ] **Step 1: Write the failing test**

`server-group.test.ts`:
- `GET /api/info` → 200, body has `version` (a string) and `id`.
- `GET /api/location` → 200, body has `project.id` (a string) and `directory`.
- `GET /api/project` → 200, body is a **JSON array** (upstream's `project.list` success is `Schema.Array(Project.Info)` — no `data` envelope).
- `GET /api/project?archived=true` → 200, still an array.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/cyberstrike && bun test test/api-v2/server-group.test.ts`
Expected: FAIL — 503 from the stub.

- [ ] **Step 3: Implement the three groups**

`server.ts` — `server.info` returns the installed version and the server id. `server.pair` stays a stub.

`location.ts` — `location.get` returns the current project and directory for the request's resolved location; `location.reload` stays a stub.

`project.ts` — `project.list` returns the array of CyberStrike projects; `project.update` returns the updated project or a typed `ProjectNotFoundError`.

- [ ] **Step 4: Add the missing-directory regression test (Review Focus #5)**

A request whose `location[directory]` points at a non-existent path must produce a typed 404, not a 500.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/cyberstrike && bun test test/api-v2/server-group.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cyberstrike/src/api-v2/handlers packages/cyberstrike/test/api-v2/server-group.test.ts
git commit -m "feat(api-v2): serve the server, location and project groups"
```

---

### Task 6: `session` read endpoints

**Files:**
- Modify: `packages/cyberstrike/src/api-v2/handlers/session.ts`
- Modify: `packages/cyberstrike/src/api-v2/handlers.ts`
- Create: `packages/cyberstrike/test/api-v2/session-read.test.ts`

**Interfaces:**
- Consumes: `projectSession` (Task 4).
- Produces: `export const SessionHandler`.

Endpoints (upstream ids and success shapes):
- `session.list` `GET /api/session` → `{data: PublicSessionInfo[], cursor: {previous?, next?}}`; query `limit`, `order`, `search`, `parentID`, `directory`, `project`, `subpath`, `cursor`.
- `session.get` `GET /api/session/:sessionID` → `{data: PublicSessionInfo}`.
- `session.create` `POST /api/session` → `{data: PublicSessionInfo}`; payload `{id?, parentID?, title?, agent?, model?, location?, metadata?, permissions?}`.
- `session.update` `PATCH /api/session/:sessionID` → **204, empty body**; payload `{title?, metadata?, permissions?, archived?}`.
- `session.remove` `DELETE /api/session/:sessionID` → 204.
- `session.active` `GET /api/session/active` → `{data: Record<sessionID, {status} >}`.
- `session.fork` `POST /api/session/:sessionID/fork` → `{data: PublicSessionInfo}`; payload `{before?}`.
- `session.stats`, `session.export`, `session.import` → stubs for now.

- [ ] **Step 1: Write the failing test**

`session-read.test.ts`: create a session, then assert `POST /api/session` → 200 with `data.id` starting `ses_` and `data.location.directory` equal to the requested directory; `GET /api/session?limit=50` → `data` contains that id; `GET /api/session/:id` → `data.id` matches; `PATCH /api/session/:id` with `{"title": "renamed"}` → **204 with an empty body**; a second `GET` → `data.title === "renamed"`; `GET /api/session/active` → `data` is an object.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/cyberstrike && bun test test/api-v2/session-read.test.ts`
Expected: FAIL — 503 from the stub.

- [ ] **Step 3: Implement the read endpoints**

Map each to CyberStrike's existing domain calls — the v1 route file `packages/cyberstrike/src/server/routes/session.ts` is the reference for which domain function backs each operation (`Session.create`, `Session.get`, `Session.list`, `Session.setTitle`, `Session.remove`, `Session.fork`, `SessionStatus.list`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/cyberstrike && bun test test/api-v2/session-read.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cyberstrike/src/api-v2/handlers packages/cyberstrike/test/api-v2/session-read.test.ts
git commit -m "feat(api-v2): serve the session read endpoints"
```

---

### Task 7: `session` write endpoints

**Files:**
- Modify: `packages/cyberstrike/src/api-v2/handlers/session.ts`
- Create: `packages/cyberstrike/test/api-v2/session-write.test.ts`

**Interfaces:**
- Consumes: `projectSession` (Task 4).
- Produces: additional handlers in `SessionHandler`.

Endpoints:
- `session.prompt` `POST /api/session/:sessionID/prompt` → `{data: SessionInbox.User}`; payload `{id?, text, files?, agents?, skills?, metadata?, delivery?, resume?}`. A v1-style `{parts: [...]}` payload must be **rejected with 400** — upstream rejects it and the contract script asserts it.
- `session.interrupt` `POST /api/session/:sessionID/interrupt` → `{interrupted: boolean}` (no `data` envelope); query `resume`.
- `session.switchAgent` `POST /api/session/:sessionID/agent` → 204; payload `{agent}`.
- `session.switchModel` `POST /api/session/:sessionID/model` → 204; payload `{model: {id, providerID}}`.
- `session.command` `POST /api/session/:sessionID/command` → 204; payload `{name, ...}`.
- `session.compact` `POST /api/session/:sessionID/compact` → 204 (upstream steers by default).
- `session.revert.stage` `POST /api/session/:sessionID/revert/stage` → `{data: Session.Revert}`; payload `{messageID, files?}`.
- `session.revert.commit` `POST /api/session/:sessionID/revert/commit` → 204; `session.revert.clear` `DELETE /api/session/:sessionID/revert` → 204.
- `session.move`, `session.view`, `session.background`, `session.environment`, `session.synthetic`, `session.shell`, `session.generate`, `session.wait`, `session.context`, `session.log`, `session.inbox.*`, `session.instructions.*` → stubs for now.

- [ ] **Step 1: Write the failing test**

`session-write.test.ts`:
- `POST /api/session/:id/prompt` with `{"parts": [{"type":"text","text":"ping"}]}` → **400**.
- `POST /api/session/:id/prompt` with `{"text": "ping"}` → 200, `data.type === "user"`, `data.text === "ping"`.
- `POST /api/session/:id/interrupt` with `{}` on an idle session → 200, `interrupted === false`.
- `POST /api/session/:id/agent` with `{"agent": "build"}` → 204, empty body.
- `POST /api/session/:id/model` with `{"model": {"id": "gpt-5", "providerID": "openai"}}` → 204, empty body.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/cyberstrike && bun test test/api-v2/session-write.test.ts`
Expected: FAIL — 503 from the stub.

- [ ] **Step 3: Implement the write endpoints**

`session.prompt` translates the v2 `{text, files}` payload into CyberStrike's v1 prompt input (v1 takes `parts`), then returns the **admission** — not the reply: `{id, type: "user", text}` shaped as upstream's `SessionInbox.User`. The reply arrives over SSE.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/cyberstrike && bun test test/api-v2/session-write.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the interrupt-under-load regression test (Review Focus #3)**

Start a prompt against a slow fake model, interrupt it, assert `interrupted === true` and that the session is not left `busy`; a second interrupt on the now-idle session returns `false`.

- [ ] **Step 6: Commit**

```bash
git add packages/cyberstrike/src/api-v2/handlers packages/cyberstrike/test/api-v2/session-write.test.ts
git commit -m "feat(api-v2): serve the session write endpoints"
```

---

### Task 8: `message` group

**Files:**
- Modify: `packages/cyberstrike/src/api-v2/handlers/message.ts`
- Modify: `packages/cyberstrike/src/api-v2/handlers.ts`
- Create: `packages/cyberstrike/test/api-v2/message.test.ts`

**Interfaces:**
- Consumes: `projectMessage` (Task 4).
- Produces: `export const MessageHandler`.

Endpoint: `session.messages` `GET /api/session/:sessionID/message` → `{data: PublicSessionMessage[], cursor: {previous?, next?}}`; query `limit` (1–200), `order` (`asc|desc`), `cursor`, `type`.

- [ ] **Step 1: Write the failing test**

`message.test.ts`: create a session, insert a user message and an assistant message, then assert the response `data` is an array of length 2, `data[0].type === "user"`, `data[0].text` is the inserted text, and `data[1].type === "assistant"`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/cyberstrike && bun test test/api-v2/message.test.ts`
Expected: FAIL — 503 from the stub.

- [ ] **Step 3: Implement the endpoint**

Read the messages with `Session.messages(sessionID)` (the v1 domain call the v1 route uses), project each with `projectMessage`, and paginate with `limit`/`cursor` the way upstream does.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/cyberstrike && bun test test/api-v2/message.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the malformed-message regression test (Review Focus #1)**

Insert one message whose part has an unknown type plus one normal message; assert the endpoint returns 200, keeps the normal message, and does not drop the whole list.

- [ ] **Step 6: Commit**

```bash
git add packages/cyberstrike/src/api-v2/handlers packages/cyberstrike/test/api-v2/message.test.ts
git commit -m "feat(api-v2): serve the message list endpoint"
```

---

### Task 9: `permission` and `form` groups

**Files:**
- Modify: `packages/cyberstrike/src/api-v2/handlers/permission.ts`, `form.ts`
- Modify: `packages/cyberstrike/src/api-v2/handlers.ts`
- Create: `packages/cyberstrike/test/api-v2/permission-form.test.ts`

**Interfaces:**
- Consumes: `projectPermission`, `projectForm` (Task 4).
- Produces: `export const PermissionHandler`, `export const FormHandler`.

Endpoints:
- `permission.request.list` `GET /api/permission/request` → `Location.response(Permission.Request[])` → `{location, data}`.
- `permission.saved.list` `GET /api/permission/saved` → `{data: PermissionSaved.Info[]}`; `permission.saved.update` `PATCH /api/permission/saved/:id` → `{data}`; `permission.saved.remove` `DELETE /api/permission/saved/:id` → 204.
- `session.permission.create` `POST /api/session/:sessionID/permission` → `{data: {id, effect}}`; payload `{id?, action, resources, save?, metadata?, source?, agent?}`.
- `session.permission.list` `GET /api/session/:sessionID/permission` → `{data: Permission.Request[]}`.
- `session.permission.get` `GET /api/session/:sessionID/permission/:requestID` → `{data: Permission.Request}`.
- `session.permission.reply` `POST /api/session/:sessionID/permission/:requestID/reply` → **204**; payload `{decision: "once"|"always"|"reject", message?}`.
- `form.list` `GET /api/form` → `{location, data: Form.Info[]}`.
- `session.form.list` `GET /api/session/:sessionID/form` → `{data: Form.Info[]}`.
- `session.form.create` `POST /api/session/:sessionID/form` → `{data: Form.Info}`.
- `session.form.get` `GET /api/session/:sessionID/form/:formID` → `{data: Form.Detail}`.
- `session.form.reply` `POST /api/session/:sessionID/form/:formID/reply` → 204; payload `{answer}`.
- `session.form.cancel` `DELETE /api/session/:sessionID/form/:formID` → 204.

- [ ] **Step 1: Write the failing test**

`permission-form.test.ts`:
- `GET /api/permission/request` → 200, body is an object with a `data` array.
- `GET /api/session/:id/form` → 200, `data` is an array.
- `POST /api/session/:id/permission/:requestID/reply` for an unknown id → 404 with `_tag` `PermissionNotFoundError`.
- `POST /api/session/:id/form/:formID/reply` for an unknown id → 404 with `_tag` `FormNotFoundError`.
- `POST /api/session/:id/form/:formID/reply` for a known form → 204 with an empty body.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/cyberstrike && bun test test/api-v2/permission-form.test.ts`
Expected: FAIL — 503 from the stub.

- [ ] **Step 3: Implement both groups**

CyberStrike's v1 domain has `question` where upstream v2 has `form` (a different model): a v1 question with options maps to a v2 form with one `multiselect` field whose options carry both `value` and `label` — the phone replies with option **values**, so `value` must be the machine-readable option id and `label` the human text.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/cyberstrike && bun test test/api-v2/permission-form.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cyberstrike/src/api-v2/handlers packages/cyberstrike/test/api-v2/permission-form.test.ts
git commit -m "feat(api-v2): serve the permission and form groups"
```

---

### Task 10: `fs` and `vcs` groups

**Files:**
- Modify: `packages/cyberstrike/src/api-v2/handlers/fs.ts`, `vcs.ts`
- Modify: `packages/cyberstrike/src/api-v2/handlers.ts`
- Create: `packages/cyberstrike/test/api-v2/fs-vcs.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const FileSystemHandler`, `export const VcsHandler`.

Endpoints:
- `fs.list` `GET /api/fs/list` → `Location.response(FileSystem.Entry[])` → `{location, data}`; query `location[directory]`, `path`.
- `fs.find` `GET /api/fs/find` → `{location, data}`; query `query`, `type`, `limit`.
- `fs.read` `GET /api/fs/read/*` → **raw bytes** (`Schema.Uint8Array`), not JSON.
- `fs.write` `POST /api/experimental/fs/write` → `{location, data: {path}}`; raw body.
- `vcs.get` `GET /api/vcs` → the repo info; `vcs.status` `GET /api/vcs/status` → JSON; `vcs.base` `GET /api/vcs/base`; `vcs.branch.list` `GET /api/vcs/branch`; `vcs.diff` `GET /api/vcs/diff`; `vcs.init` `POST /api/vcs/init`.

- [ ] **Step 1: Write the failing test**

`fs-vcs.test.ts`:
- `GET /api/fs/list` → 200, `data` is an array, `location` is an object.
- `GET /api/fs/read/<a file that exists>` → 200, `content-type` is not JSON, and the body bytes equal the file content.
- `GET /api/vcs/status?location[directory]=<tmp>` → 200, JSON body.
- `GET /api/fs/find?query=<a string present in a file>` → 200, `data` contains the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/cyberstrike && bun test test/api-v2/fs-vcs.test.ts`
Expected: FAIL — 503 from the stub.

- [ ] **Step 3: Implement both groups**

Back `fs.*` with CyberStrike's `File` domain (the same calls the v1 `/file`, `/find/file` routes use) and `vcs.*` with `Vcs` (`packages/cyberstrike/src/project/vcs.ts`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/cyberstrike && bun test test/api-v2/fs-vcs.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the not-found regression test (Review Focus #2)**

`GET /api/fs/read/<missing>` → 404 with `_tag` `FileNotFoundError`; `GET /api/fs/list?path=<a file, not a directory>` → 404 with the same tag.

- [ ] **Step 6: Commit**

```bash
git add packages/cyberstrike/src/api-v2/handlers packages/cyberstrike/test/api-v2/fs-vcs.test.ts
git commit -m "feat(api-v2): serve the fs and vcs groups"
```

---

### Task 11: catalog groups (`agent`, `model`, `provider`, `config`, `skill`, `command`, `mcp`)

**Files:**
- Modify: `packages/cyberstrike/src/api-v2/handlers/agent.ts`, `model.ts`, `provider.ts`, `config.ts`, `skill.ts`, `command.ts`, `mcp.ts` — seven small files, one per group, each a thin read
- Modify: `packages/cyberstrike/src/api-v2/handlers.ts`
- Create: `packages/cyberstrike/test/api-v2/catalog.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const AgentHandler`, `ModelHandler`, `ProviderHandler`, `ConfigHandler`, `SkillHandler`, `CommandHandler`, `McpHandler`.

Endpoints: `agent.list` `GET /api/agent` → `{location, data}`; `agent.get` `GET /api/agent/:agentID` → `{location, data}`; `model.list` `GET /api/model` → `{data}`; `model.default` `GET /api/model/default` → `{data}`; `provider.list` `GET /api/provider` → `{data}`; `provider.get` `GET /api/provider/:providerID` → `{data}`; `config.get` `GET /api/config` → `{data}`; `config.shells` `GET /api/config/shell`; `config.update` `PATCH /api/experimental/config` → 204; `skill.list` `GET /api/skill` → `{data}`; `command.list` `GET /api/command` → `{data}`; `mcp.list` `GET /api/mcp` → `{data}`; `mcp.resource.catalog` `GET /api/mcp/resource`; `mcp.add`/`mcp.remove`/`mcp.connect`/`mcp.disconnect` → stubs.

- [ ] **Step 1: Write the failing test**

`catalog.test.ts`: `GET /api/agent` → 200 with `data` an array and a `location` object; `GET /api/provider` → 200 with `data` an array; `GET /api/model` → 200 with `data` an array; `GET /api/model/default` → 200 with `data` an object (the contract script requires `data` to be an object with a model); `GET /api/skill` → 200 with `data` an array; `GET /api/config` → 200 with `data` an object.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/cyberstrike && bun test test/api-v2/catalog.test.ts`
Expected: FAIL — 503 from the stub.

- [ ] **Step 3: Implement the seven groups**

`model.default` must not need a provider key: fall back to the first entry of the models.dev catalog snapshot (`packages/cyberstrike/src/provider/models-snapshot.ts`) when no model is configured.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/cyberstrike && bun test test/api-v2/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cyberstrike/src/api-v2/handlers packages/cyberstrike/test/api-v2/catalog.test.ts
git commit -m "feat(api-v2): serve the catalog groups"
```

---

### Task 12: `event` group and the v1→v2 event mapping

**Files:**
- Create: `packages/api-v2/src/events.ts`
- Create: `packages/api-v2/test/events.test.ts`
- Modify: `packages/cyberstrike/src/api-v2/handlers/event.ts`
- Modify: `packages/cyberstrike/src/api-v2/handlers.ts`
- Create: `packages/cyberstrike/test/api-v2/event.test.ts`

**Interfaces:**
- Consumes: CyberStrike's bus (`packages/cyberstrike/src/bus`).
- Produces:
  - `packages/api-v2/src/events.ts` → `export function projectEvent(event: { type: string; properties: Record<string, unknown> }): { type: string; data: Record<string, unknown> } | undefined` — returns `undefined` for an event with no v2 equivalent.
  - `export const EventHandler` — `event.subscribe` `GET /api/event` → SSE.

The v2 frame is `{id?, type, data}`. The phone's `V2EventTranslator` reads exactly these types: `server.connected`, `session.status`, `session.idle`, `session.created`, `session.renamed`, `session.metadata.updated`, `session.deleted`, `session.text.started`, `session.text.delta`, `session.text.ended`, `session.reasoning.ended`, `session.message.content.updated`, `permission.asked`, `permission.replied`, `form.created`, `form.replied`, `form.cancelled`, `session.execution.failed`.

`session.text.*` carries `sessionID`, `assistantMessageID`, `ordinal` (a stable per-assistant-message ordinal for the text part) and, for `delta`, `delta`; `session.text.ended` also carries `text`.

- [ ] **Step 1: Write the failing tests**

`packages/api-v2/test/events.test.ts` (pure): a v1 `message.part.updated` carrying a text delta → `{type: "session.text.delta", data: {sessionID, assistantMessageID, ordinal, delta}}`; a v1 `message.updated` for an assistant message → `{type: "session.message.content.updated", data: {...}}`; a v1 `permission.updated` for a new request → `{type: "permission.asked", data: {id, action, resources}}`; an unknown v1 event type → `undefined`.

`packages/cyberstrike/test/api-v2/event.test.ts` (server): open `GET /api/event` and assert the first frame is `data: {"type":"server.connected","data":{}}`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/api-v2 && bun test && cd ../cyberstrike && bun test test/api-v2/event.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the mapping and the SSE endpoint**

`projectEvent` translates CyberStrike's v1 bus events into the v2 taxonomy above. The v1 bus speaks `{type, properties}`; CyberStrike's v1 event names are in `packages/cyberstrike/src/bus` — map each to its v2 counterpart. Anything unmapped returns `undefined` and is dropped.

`event.subscribe` streams `JSON.stringify({id, type, data})` per frame. The first frame is `{"type":"server.connected","data":{}}` — the contract script asserts exactly this.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/api-v2 && bun test && cd ../cyberstrike && bun test test/api-v2/event.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api-v2/src/events.ts packages/api-v2/test/events.test.ts packages/cyberstrike/src/api-v2/handlers packages/cyberstrike/test/api-v2/event.test.ts
git commit -m "feat(api-v2): stream v2 event frames over SSE"
```

---

### Task 13: `pty` group and the live terminal

**Files:**
- Modify: `packages/cyberstrike/src/api-v2/handlers/pty.ts`
- Modify: `packages/cyberstrike/src/api-v2/server.ts`
- Modify: `packages/cyberstrike/src/api-v2/handlers.ts`
- Create: `packages/cyberstrike/test/api-v2/pty.test.ts`

**Interfaces:**
- Consumes: CyberStrike's `Pty` domain (`packages/cyberstrike/src/pty/index.ts`).
- Produces: `export const PtyHandler`; the v2 listener upgrades the PTY connect path natively.

Endpoints: `pty.list` `GET /api/pty` → `{data}`; `pty.create` `POST /api/pty` → `{data}`; `pty.get` `GET /api/pty/:ptyID` → `{data}`; `pty.update` `PUT /api/pty/:ptyID` → `{data}`; `pty.remove` `DELETE /api/pty/:ptyID` → 204; `pty.connectToken` `POST /api/pty/:ptyID/connect-token` → `{data}`; `pty.connect` — a WebSocket upgrade at the path upstream's group declares.

**The upgrade happens in front of Effect.** `Bun.serve`'s `fetch` intercepts the PTY connect path, upgrades natively, and the `websocket` handler calls CyberStrike's existing `Pty.connect(id, ws, cursor)`. `Pty.connect`'s `Socket` type is structural (`readyState`, `send`, `close`), and Bun's `ServerWebSocket` satisfies it as-is — no adapter. The Effect-side `pty.connect` handler exists (upstream's group declares it) and returns the 503 stub; it is unreachable because the native upgrade happens first.

- [ ] **Step 1: Write the failing test**

`pty.test.ts`:
- `GET /api/pty` → 200, `data` is an array.
- `POST /api/pty` → 200, `data.id` is a string.
- A WebSocket client connecting to the PTY connect path receives the PTY's buffered output.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/cyberstrike && bun test test/api-v2/pty.test.ts`
Expected: FAIL — 503 from the stub, and the WebSocket connect is refused.

- [ ] **Step 3: Implement the group and the native upgrade**

In `server.ts`, branch on the PTY connect path before delegating to the Effect handler: upgrade with `server.upgrade(request, { data: { id } })`, and in the `websocket` handler call `Pty.connect(id, socket)` plus the same message/close handling the v1 route uses (`packages/cyberstrike/src/server/routes/pty.ts`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/cyberstrike && bun test test/api-v2/pty.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the stale-cursor regression test (Review Focus #4)**

Connect with a cursor older than the retained buffer, then reconnect with a fresh cursor; assert no duplicated output and no thrown error.

- [ ] **Step 6: Commit**

```bash
git add packages/cyberstrike/src/api-v2 packages/cyberstrike/test/api-v2/pty.test.ts
git commit -m "feat(api-v2): serve the pty group and upgrade the terminal natively"
```

---

### Task 14: remaining groups (`worktree`, `shell`, `debug`) and the stub groups

**Files:**
- Modify: `packages/cyberstrike/src/api-v2/handlers/worktree.ts`, `shell.ts`, `debug.ts`
- Modify: `packages/cyberstrike/src/api-v2/handlers.ts`
- Create: `packages/cyberstrike/test/api-v2/stubs.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const WorktreeHandler`, `ShellHandler`, `DebugHandler`.

`worktree`: `worktree.list` `GET /api/worktree` → `{data}`; `worktree.create` `POST /api/worktree` → `{data}`; `worktree.remove` `DELETE /api/worktree/:worktreeID` → 204; `worktree.refresh` `POST /api/worktree/:worktreeID/refresh` → 204. CyberStrike has `packages/cyberstrike/src/worktree` — implement against it.

`shell`: `shell.list` `GET /api/shell` → `{data}`; `shell.create` `POST /api/shell` → `{data}`; `shell.get` `GET /api/shell/:id` → `{data}`; `shell.output` `GET /api/shell/:id/output` → `{data}`; `shell.remove` `DELETE /api/shell/:id` → 204. Implement from `packages/cyberstrike/src/shell/shell.ts` if it exposes what these need; otherwise stub.

`debug`: `debug.location` `GET /api/debug/location` → `{data}`; `debug.location.evict` `DELETE /api/debug/location` → 204; `debug.heapDump` `POST /api/debug/heap-dump` → 204.

Everything else stays a stub with the 503 from Task 2: `integration` (12), `credential` (5), `plugin` (3), `rpc` (1), `reference` (1), `websearch` (2), `persistent-pty` (10), `voice` (3), `generate` (1), `migration` (1).

- [ ] **Step 1: Write the failing test**

`stubs.test.ts`: for each stub group, one representative endpoint returns 503 with the body `not implemented` — `GET /api/credential`, `GET /api/plugin`, `GET /api/reference`, `GET /api/websearch/provider`, `GET /api/experimental/session/:id/terminal`, `GET /api/experimental/voice/models`, `POST /api/experimental/generate`, `GET /api/experimental/migration/v1`. Plus `GET /api/worktree` → 200.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/cyberstrike && bun test test/api-v2/stubs.test.ts`
Expected: FAIL for `worktree` (503 instead of 200); the stub assertions pass already.

- [ ] **Step 3: Implement `worktree`, `shell` and `debug`; keep the rest stubbed**

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/cyberstrike && bun test test/api-v2/stubs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cyberstrike/src/api-v2/handlers packages/cyberstrike/test/api-v2/stubs.test.ts
git commit -m "feat(api-v2): serve worktree, shell and debug; stub the rest"
```

---

### Task 15: the contract gate and CI

**Files:**
- Create: `script/v2-contract-check.py` — vendored from `einyx/opencodex` (`scripts/v2_contract_check.py`, Apache-2.0; keep the attribution header)
- Create: `.github/workflows/v2-contract.yml`
- Modify: `package.json` (root) — add a `v2:contract` script

**Interfaces:**
- Consumes: the v2 listener from Task 2 and every endpoint from Tasks 5–14.
- Produces: `bun run v2:contract` — boots the v2 listener on a scratch port, runs the vendored script against it, exits non-zero on any failure.

- [ ] **Step 1: Vendor the script and add the runner**

Copy `https://raw.githubusercontent.com/einyx/opencodex/main/scripts/v2_contract_check.py` into `script/v2-contract-check.py`, keeping its header. Add a root script `v2:contract` that starts `cyberstrike serve --api v2 --port 4198` with `CYBERSTRIKE_SERVER_PASSWORD` set, waits for the port, then runs:

```
V2_BASE=http://127.0.0.1:4198 V2_USER=cyberstrike V2_PASSWORD=<password> python3 script/v2-contract-check.py
```

and kills the server afterwards. The script defaults to `V2_USER=opencode` — **override it to `cyberstrike`**, because that is CyberStrike's Basic-auth username.

- [ ] **Step 2: Run the gate**

Run: `bun run v2:contract`
Expected: every case PASS. Fix the implementation, not the script — the script is the spec.

The cases that most often fail first: `v1-health-is-not-json`, `v1-status-not-json-map`, `todo-absent`, `project-current-absent` (all four are satisfied by the v2-only listener), `patch-title-empty` (the PATCH must return 204 with an empty body), `v1-parts-rejected` (the prompt endpoint must reject a v1 `{parts}` body with 400), `interrupt-idle` (the response must be `{interrupted: bool}` with no `data` envelope).

- [ ] **Step 3: Add the CI workflow**

`.github/workflows/v2-contract.yml` — on push and pull request: install with `bun install --frozen-lockfile`, run `bun run typecheck`, then `bun run v2:contract`. No provider secret: the gate's prompt cases are opt-in via `V2_ALLOW_PROMPT=1` and are **not** run in CI.

- [ ] **Step 4: Commit**

```bash
git add script/v2-contract-check.py .github/workflows/v2-contract.yml package.json
git commit -m "ci: gate the v2 surface with the opencodex contract check"
```

---

### Task 16: the three fix-regardless items

**Files:**
- Modify: `packages/sdk/js/script/build.ts`, `packages/sdk/js/package.json` — regenerate `src/gen` from the current server so it matches `src/v2/gen`; keep the published `./v2` export path
- Modify: `packages/cyberstrike/src/plugin/index.ts`, `packages/plugin/src/index.ts` — import the client from `@cyberstrike-io/sdk/v2` instead of the stale `@cyberstrike-io/sdk`
- Modify: `packages/cyberstrike/src/session/session.ts` (or a new `src/session/access-context.ts`) — move `renderAccessContextLines` and `resolveVisitedBy` out of `src/server/routes/session.ts`
- Modify: `packages/cyberstrike/src/tool/task.ts`, `packages/cyberstrike/src/tool/web-get-request-detail.ts` — import the moved helpers
- Modify: `packages/cyberstrike/src/storage/schema.ts` — export `RequestObservationTable` and `CoverageNoteTable`
- Create: `packages/cyberstrike/test/storage/schema.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: one SDK tree with no stale copy; helpers importable without touching the route layer; both tables inside the Drizzle schema object.

- [ ] **Step 1: Write the failing test**

`schema.test.ts`: assert that the Drizzle schema object exported by `src/storage/schema.ts` contains a key for the request-observation table and one for the coverage-note table.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/cyberstrike && bun test test/storage/schema.test.ts`
Expected: FAIL — the two tables are missing from the export.

- [ ] **Step 3: Fix the table exports**

Add both tables to `src/storage/schema.ts`'s exports and to the `drizzle({ schema })` object.

- [ ] **Step 4: Move the route-layer helpers**

Move `renderAccessContextLines` and `resolveVisitedBy` (currently exported from `src/server/routes/session.ts`) into `src/session/access-context.ts`, re-export them from the route file for compatibility, and update the two tool imports.

- [ ] **Step 5: Unify the SDK trees**

Run `./packages/sdk/js/script/build.ts` so `packages/sdk/js/src/gen` is regenerated from the current server, then point `packages/cyberstrike/src/plugin/index.ts` and `packages/plugin/src/index.ts` at `@cyberstrike-io/sdk/v2`. Do **not** remove the `./v2` export path — it is published and external consumers depend on it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/cyberstrike && bun test && cd ../sdk/js && bun run build && bun test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/js packages/plugin packages/cyberstrike/src/plugin packages/cyberstrike/src/session packages/cyberstrike/src/tool packages/cyberstrike/src/storage packages/cyberstrike/test/storage
git commit -m "fix: unify the SDK trees, unbarrel the storage tables, unhook tools from routes"
```

---

### Task 17: documentation and the phone smoke checklist

**Files:**
- Create: `docs/v2-api.md` — the v2 surface: how to start it, what is implemented, what is stubbed, the known gaps
- Modify: `docs/superpowers/specs/2026-10-26-opencode-v2-protocol-adoption-design.md` — record the final status

**Interfaces:**
- Consumes: everything above.
- Produces: `docs/v2-api.md` and a manual smoke checklist.

- [ ] **Step 1: Write the documentation**

`docs/v2-api.md` must state: how to start the listener (`cyberstrike serve --api v2`), that it serves **only** v2 routes, the Basic-auth username/password, that the stubs return 503, the known gaps (CyberStrike's `json_schema`/`symbol`/`resource` parts have no v2 equivalent; the v1 prompt body is rejected with 400; the gate does not exercise auth because it runs on loopback; the `V2_ALLOW_PROMPT=1` cases are not run in CI).

- [ ] **Step 2: Write the phone smoke checklist**

A numbered list the requester runs by hand before merge: point opencodex at the v2 listener → the app detects v2 → send a prompt → the reply streams live → a permission prompt appears and can be answered → a question appears and can be answered → the file tree opens → a diff renders → a terminal session opens and echoes a command.

- [ ] **Step 3: Run the full verification**

Run: `cd packages/api-v2 && bun test && bun run check:generated && bun run typecheck && cd ../cyberstrike && bun test && bun run typecheck && cd ../.. && bun run v2:contract`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs/v2-api.md docs/superpowers/specs/2026-10-26-opencode-v2-protocol-adoption-design.md
git commit -m "docs: document the v2 surface and the phone smoke checklist"
```

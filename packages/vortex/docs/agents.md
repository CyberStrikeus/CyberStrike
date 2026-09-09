# Building agents on Vortex

How to implement an LLM agent that **consumes** Vortex. For the design/rationale see
[`ARCHITECTURE.md`](../ARCHITECTURE.md); this is the practical how-to.

## The model

Vortex is the **producer**: it ingests traffic, runs deterministic rules over the whole corpus, and
emits **signals** — pre-computed leads. The agent is the **consumer/verifier**: it takes a lead,
inspects it, correlates around it, and confirms/weaponizes by sending. The agent does **not** hunt
from scratch and does **not** author rules.

So the agent sees a **narrow, curated surface** — not the whole engine. It gets nine tools (below),
of which only two are open-ended (an HTTPQL `search` and a full `http_replay`); everything else is a
typed getter. It cannot mutate the store, author rules, or reach the engine internals.

## The tools (`agentCapabilities`)

| Tool | Input | Returns / use |
|---|---|---|
| `vortex_leads` | `{category?, severity?, limit?}` | Pending findings as leads — the agent's starting point (pre-computed, not hunted). Each lead carries the signal, `transactionId`, function (method+endpoint+CRUD), objects, role, and the raw request/response inline. |
| `vortex_inspect` | `{id}` | The full verbatim raw request+response of one transaction — exact bytes, for evidence and crafting the next probe. |
| `vortex_query` | `{httpql}` | **Open-ended read.** HTTPQL SELECT over the corpus (see cheatsheet). Find requests matching a shape. |
| `vortex_objects` | `{resource?, role?}` | Resource objects across the corpus (canonicalized by value). BOLA/IDOR reasoning. |
| `vortex_functions` | `{}` | Functions (method+endpoint+CRUD) + which roles called each. BFLA reasoning. |
| `vortex_cross_role` | `{}` | Deterministic access-control leads: objects reached under >1 role (IDOR/BOLA) and functions called under >1 role (BFLA). |
| `vortex_where_value` | `{value}` | Every transaction carrying a value (and the field) — pivot from a value spotted in a raw response to where else it flows. |
| `vortex_untested` | `{}` | Endpoints the crawl discovered but no request hit — untested attack surface. |
| `http_replay` | `{request_id? \| target?, mutations?, allow_unsafe_replay?}` | **Open-ended act.** Replay a captured request OR craft a fresh one; apply field mutations. Returns facts (status/timing/headers/body). Refuses a session-destroying replay unless `allow_unsafe_replay`. |

## The workflow — confirm one, hunt the rest

```
vortex_leads {category:"injection"}     → SQLi lead: POST /api/orders/{id} (tx_42)
vortex_inspect {id:"tx_42"}             → read the full response: exact DB error → MySQL; a leaked token
vortex_where_value {value:"<token>"}    → the token also rides a request to /api/admin/report
vortex_query {httpql:"endpoint:~admin AND identity!=org1"}  → admin endpoints reached by other roles
vortex_cross_role {}                    → order:42 also touched under org2 → IDOR candidate
http_replay {request_id:"tx_42", mutations:[...], allow_unsafe_replay:false}  → confirm
```

Correlation is `vortex_where_value` + `vortex_cross_role`; chaining is `vortex_query` + `http_replay`.
The agent spends tokens on judgment, not plumbing — leads and the object/function graph are already
computed.

## HTTPQL cheatsheet (the `vortex_query` input)

A pure SELECT — `field op value`, `AND`/`OR`/`NOT`, parens. **No functions** (that's the rule DSL,
not the agent's surface).

- **Operators:** `:` equals · `!=` not-equals · `:~` regex (case-insensitive) · `~=` literal contains
  · `field:*` exists (non-empty) · `>` `<` `>=` `<=` numeric.
- **Fields:** `req.method` `req.url` `req.path` `req.query.<name>` `req.body.<dotpath>`
  `req.header.<name>` `req.cookie.<name>` `req.bodyKind` · `resp.status` `resp.body`
  `resp.body.<dotpath>` `resp.header.<name>` `resp.contentType` · `host` `identity` `endpoint`
  `tech` `timeMs` `tls.version` · `id` `session` `derivedFrom` (replay lineage).
- **Examples:**
  ```
  resp.status:500 AND resp.body:~"SQL syntax"
  endpoint:~orders AND identity!=org1
  req.query.file:*
  resp.body:~"eyJ[A-Za-z0-9_-]{6,}[.]eyJ"      # leaked JWT
  derivedFrom:tx_42                             # replays of tx_42
  ```
- **Not available to the agent:** the grep-everywhere fields (`raw`, `req.raw`, bare `req.header`) —
  rejected with a `QueryError` that points you at the structured fields. Name where you expect it.

## Wiring the tools (consumer side, ~10 lines)

Vortex is framework-agnostic: it ships the facade + descriptors; you adapt them to your tool
framework. Example (opencode-style):

```ts
import { forAgent, agentCapabilities } from "@cyberstrike-io/vortex"

const api = forAgent(store)                       // the store your platform already populated
for (const cap of agentCapabilities)
  registerTool(Tool.define(cap.name, {
    description: cap.description,
    parameters: cap.input,                        // a zod schema
    execute: (args) => cap.run(api, args),
  }))
```

Over MCP it's the same descriptors behind an MCP server — which additionally isolates the agent in
its own process.

## Guardrails (what the agent can't do, and why)

- **No store mutation / no rule authoring / no engine internals** — the facade exposes only the nine
  tools. Rules and the corpus are the platform's, not the agent's.
- **`vortex_query` is grep-gated** — no `raw` full-text scan (that's a noisy footgun); structured
  fields only, `:~` for regex.
- **`http_replay` is replay-safety-guarded** — a replay that would burn the live session (an
  auth-exchange endpoint like `/login` or `/oauth/token`, a response that minted a session cookie, or
  a single-use token like an OAuth `code`) is **refused** unless `allow_unsafe_replay:true`. It never
  mutates the captured original — a replay is always a new transaction.
- **Over-privilege is the consumer's job.** An in-process agent could technically import Vortex
  internals; hardening (a tool allow-list, or running the agent out-of-process via MCP) is the
  platform's responsibility. Vortex's part is making this narrow surface the path of least resistance.

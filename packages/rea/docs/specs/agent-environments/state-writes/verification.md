# Verification

Verified base: cbb7b613 (this branch before this file). Executed on macOS with
Node v22.23.1 (the repository pins 24.18.0 in `.nvmrc`, which was not
installed); the AgentEnv runs and the live comparison ran on a disposable Linux
VM. Every check below ran as written after the last source change.

## Gates

- `npm run build:cached`, `npm run check:fast` (typecheck and lint),
  `npm run format:check`, `npx knip`, `npm run scan:todos`, `npm run docs:check`
  and `npm run verify:test-discovery`: passed.
- `npm run jscpd`: 3.43% duplicated lines over 3538 files, under the 3.5% gate.
- `npx vitest run --project domain --project services`: 7407 passed, 5
  pre-existing skips.
- `npm run test:prepare`, then `npm run test:focused --` the new write MCP
  boundary, the serve MCP, CLI and process boundaries, the export CLI
  boundary, the analysis-view CLI and MCP boundaries, the compact input schema
  boundary and the contract description tests: 10 files, 72 passed.
- `npm run mcp-catalog:check`: passed.

New tests: `environmentStateWriteValues` (94), `environmentStateWriteExplain`
(101), `environmentStateWriteApply` (52), `environmentStateWrites` (16, the gate
through the view), `environmentStateWriteAnswer` (14, serving) and
`environmentServeWritesMcp` (1, the built CLI over MCP). The replay card pinned
by the serve MCP boundary changed with the response summaries tool descriptions
carry; its digest now matches the combined branch.

## Real captures

The `environment-state` view ran over the 50 showcase captures (45 HAR
inspections and 5 `capture_browser_scenario` captures), each within its budget in
8–110 ms. It served 33 write tools in 16 captures (11 creates, 12 updates, 10
deletes). Of the other 150 state-changing tools, 102 name no state type or
document (most write to literal single-entity paths the manifest left
untemplated, or to collections whose reads are not state-backed), and 48 are
modelled but not served:

- 15 unconfirmed (no later read checked them);
- 13 no-observation;
- 8 contradicted, for example a deleted Airbyte source and EspoCRM task still
  readable, Immich and BookStack item reads showing fields the create
  response lacked, and Sonarr's tag list ordering;
- 7 unexplained-change, such as BookStack's description_html and Paperless's
  derived text colour;
- 4 side-effect, for example a Sonarr tag also listed by `/tag/detail`;
- 1 incomplete-entities: WordPress answers a delete with the post in its edit
  context, which the reads never showed for seeded posts.

| Capture          | Served (create / update / delete) | Not served                                                                                      |
| ---------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| airbyte          | 2 / 2 / 0                         | create contradicted, delete contradicted, delete unconfirmed                                    |
| baserow          | none                              | no-state-target ×3                                                                              |
| bookstack        | 0 / 0 / 1                         | create contradicted, create side-effect, update unexplained-change                              |
| directus         | none                              | no-state-target ×2                                                                              |
| espocrm          | none                              | create unconfirmed, delete contradicted, update unexplained-change                              |
| ghost            | none                              | no-state-target ×2                                                                              |
| gitea            | 1 / 1 / 0                         | no-state-target ×2                                                                              |
| grafana          | none                              | create unconfirmed, no-state-target ×5                                                          |
| grist            | none                              | create no-observation, no-state-target ×5                                                       |
| grocy            | none                              | create no-observation, delete no-observation, update no-observation, no-state-target ×2         |
| healthchecks     | none                              | create no-observation, delete no-observation, update no-observation, no-state-target ×2         |
| homebox          | none                              | document no-observation, no-state-target ×3                                                     |
| immich           | 0 / 0 / 1                         | create contradicted, update contradicted                                                        |
| jellyfin         | none                              | no-state-target ×2                                                                              |
| keycloak         | none                              | no-state-target ×1                                                                              |
| komga            | none                              | create unconfirmed ×2, no-state-target ×4                                                       |
| linkding         | 2 / 2 / 2                         | create unconfirmed, delete unconfirmed, update unconfirmed, no-state-target ×2                  |
| listmonk         | 1 / 1 / 1                         | —                                                                                               |
| lychee           | none                              | no-state-target ×4                                                                              |
| mailpit          | none                              | document no-observation, no-state-target ×5                                                     |
| mattermost       | 1 / 1 / 1                         | no-state-target ×3                                                                              |
| mealie           | none                              | create no-observation, no-state-target ×2                                                       |
| memos            | none                              | no-state-target ×3                                                                              |
| metabase         | 0 / 0 / 1                         | create side-effect, update unexplained-change                                                   |
| miniflux         | 0 / 1 / 0                         | no-state-target ×3                                                                              |
| n8n              | none                              | create unconfirmed, no-state-target ×6                                                          |
| navidrome        | none                              | create no-observation, no-state-target ×2                                                       |
| netbox           | 1 / 1 / 1                         | —                                                                                               |
| nocodb           | none                              | create no-observation, no-state-target ×4                                                       |
| nomad            | none                              | no-state-target ×4                                                                              |
| paperless        | 0 / 0 / 1                         | create unconfirmed, update unexplained-change, no-state-target ×3                               |
| photoprism       | 1 / 1 / 0                         | delete unconfirmed                                                                              |
| pinry            | none                              | create unconfirmed, delete unconfirmed, update unexplained-change                               |
| pocketbase       | none                              | no-state-target ×4                                                                              |
| redpanda-console | none                              | document no-observation, no-state-target ×5                                                     |
| sentry           | 1 / 0 / 0                         | update unexplained-change, no-state-target ×3                                                   |
| shlink           | none                              | create unconfirmed, no-state-target ×1                                                          |
| sonarr           | 0 / 1 / 0                         | create contradicted, create side-effect, update contradicted                                    |
| tandoor          | none                              | no-state-target ×4                                                                              |
| umami            | 1 / 1 / 1                         | —                                                                                               |
| vault            | none                              | no-state-target ×7                                                                              |
| vikunja          | none                              | no-state-target ×4                                                                              |
| wordpress        | none                              | create side-effect, delete incomplete-entities, document unconfirmed, update unexplained-change |

An in-process smoke derived each capture's served state and called every served
write tool once with a varied body: all 33 applied (status equal to the
recording), and every created or updated entity read back from the state;
deleted entities answered the recorded 400 or 404 where one was recorded. Eight
older published manifests no longer match the tool names the current view
derives, so their state is unavailable and they serve replay, as designed;
none of them has a served write tool.

## End to end on a published environment

Five published environments serve a create, an update and a delete (Linkding,
Listmonk, Mattermost, NetBox, Umami); `random.SystemRandom().choice` picked
NetBox (NetBoxEnv-REA, NetBox 4.7.3).

- `rea environment-export` (packed from this branch) wrote the bundle; its
  smoke task passed in AgentEnv framework 0.9.1334 with 42 served tools (39
  reads and `post_dcim_sites`, `patch_dcim_sites_by_id`,
  `delete_dcim_sites_by_id`).
- Four write tasks, each graded by an `env_outcome_verifier` that reads the
  environment's state through `/agentenv` `data/get` (not the agent's reply),
  with the replay-qa agent over the Hugging Face router, one run per task and
  model:

| Task                                            | gpt-oss-120b | GLM-5.3-Flash | Tool calls (gpt-oss)                                         |
| ----------------------------------------------- | ------------ | ------------- | ------------------------------------------------------------ |
| Create a site in the Copper Valley region       | 1.0          | 1.0           | get_dcim_regions, post_dcim_sites                            |
| Update a seeded site's facility and description | 1.0          | 1.0           | get_dcim_sites, patch_dcim_sites_by_id                       |
| Delete one seeded site and only it              | 1.0          | 1.0           | get_dcim_sites, delete_dcim_sites_by_id                      |
| Create a site, then set its facility            | 1.0          | 1.0           | get_dcim_regions, post_dcim_sites, patch_dcim_sites_by_id ×2 |

- The bundle's 12 retrieval tasks (one per seeded object) passed 12/12 for both
  models, as they did on the published replay bundle.

## The served model against the live application

The same NetBox 4.7.3 image ran on the VM, seeded by the capture's own seed
script (the same ids), and one scenario ran against both the live API and the
environment served from the capture. Only `created` and `last_updated` were
normalised; every other member had to be equal:

| Step                                      | Live | Environment | Equal                        |
| ----------------------------------------- | ---- | ----------- | ---------------------------- |
| List sites                                | 200  | 200         | yes                          |
| Create Tide Gauge Annex (id 5)            | 201  | 201         | yes                          |
| Read it                                   | 200  | 200         | yes                          |
| List after the create (sorted by name)    | 200  | 200         | yes                          |
| Patch its description and facility        | 200  | 200         | yes                          |
| Read after the patch                      | 200  | 200         | yes                          |
| Create Granite Spur (id 6)                | 201  | 201         | yes                          |
| Patch a seeded site                       | 200  | 200         | yes                          |
| Delete Tide Gauge Annex                   | 204  | 204         | yes                          |
| Read the deleted site                     | 404  | 404         | yes                          |
| Create Ledger Point (id 7, not reusing 5) | 201  | 201         | yes                          |
| Delete a seeded site with devices         | 409  | 204         | no                           |
| Final list                                | 200  | 200         | no (follows from the delete) |

11 of 13 steps were equal. The difference is NetBox's referential protection:
it refuses to delete a site that devices reference, while the environment's
delete removes the entity alone. The capture only deleted a scratch site with
no dependents, so the gate could not see the rule; it is listed under what is
not modelled.

## Not covered

- A run of the hosted `real-agentenv` lane in CI (the AgentEnv runs here used
  the published framework release on a VM).
- Document writes on a real capture: the four modelled ones are unserved.
- Collections tied to a create's own collection on a real capture, and UUID
  or token identities through an AgentEnv run (both are covered by tests).
- Agent token usage and cost.

## After merging the base branches and main

The branch then merged the serving branch at 5a61853a, the coverage branch at
b4b7ebc7 (their review fixes) and main at edbd291a, then main at 17f581ff
(the analysis-view tool description string, which main changes often). The gates above ran again
and passed: `npm run jscpd` 3.44% over 3579 files; domain and services 7442
passed with 5 pre-existing skips; the focused boundary set 72 passed. The
write verdicts over the 50 captures were unchanged plan by plan, and the
in-process smoke again applied all 33 served write tools. The AgentEnv runs
and the live comparison above ran on cbb7b613, before these merges.
After the second main merge: `npm run check:fast`, `npm run format:check`,
`npm run docs:check` and `npm run mcp-catalog:check` passed; the contracts,
analysis-view and environment tests 857 passed with 3 pre-existing skips; the
analysis-view and environment MCP and CLI boundaries 53 passed.

## After the review round

The branch then merged the serving branch at c00fde41, the coverage branch at
f6c756aa and main at 1629266e, and took the review fixes (82556cd5, 138ea4b1,
6d21b62e). The coverage branch quotes field names in response summaries, so the
replay card pinned by the serve MCP boundary is now 12,818 bytes; removing
those quotes gives back the previous 12,618-byte digest exactly. The gates ran
again and passed: `npm run check:fast`, `npm run format:check`, `npx knip`,
`npm run scan:todos`, `npm run docs:check`, `npm run verify:test-discovery`,
`npm run verify:module-boundaries` and `npm run mcp-catalog:check`;
`npm run jscpd` 3.47% over 3601 files; domain and services 7463 passed with 5
pre-existing skips; the focused boundary set 75 passed; conformance 279
passed. The gate is stricter, but the write verdicts over the 50 captures were
unchanged plan by plan, and the in-process smoke again applied all 33 served
write tools. The AgentEnv runs and the live comparison above ran on cbb7b613,
before these merges and fixes.

A second review round then made the gate and serving agree in five more places
(reads matched to checked lines as serving matches calls, increments and slugs
held for every call, insert rules still learned after an item read, the
document body check in the gate, and decoded parent path values). Each new test
fails on the previous head and passes here. The same gates passed again
(domain and services 7468 passed with 5 pre-existing skips, the focused
boundary set 75, conformance 279, `jscpd` 3.47%), the write verdicts over the 50
captures were again unchanged plan by plan, and the smoke applied all 33 served
write tools.

A third round kept a checked line's path spelling (replay prefers a verbatim
one, so two spellings of one parent stay separate lines) and compared a later
slug rule with the values earlier calls recorded rather than only their member
names; both new tests fail on the previous head. A fourth round chose a read's
line as replay does, so a read spelled plainly is checked against the encoded
line that answers it, and its list against that line's collection; its test
fails on the previous head.

A review of the fidelity branch built on this one found four more places: a
document write at another path is now unmodelled in the gate, a create picks
the collection the call spells verbatim, a missing entity is answered with a
recorded 2xx `null` the gate accepted as an absence, and `data/add` refuses a
document whose `data/get` form would exceed the intake limit. Each new test
fails on the previous head. The gates passed again (domain and services 7475
with 5 pre-existing skips, boundaries 75, conformance, `jscpd` 3.46%), the
verdicts over the 50 captures were unchanged plan by plan, and the smoke
applied all 33 served write tools.

A sixth round, after merging the serving and coverage branches and main
335c042d, settled five more findings: a read whose usable body no longer holds
the entity or list fails its check, an entity lacking a field its view always
carried confirms nothing, a write a later write replaced is not confirmed by
reads of the replacement, sequences never reuse a value the state started
with, and a collection keeps its spelling after it empties. Each new test fails
on the previous head. Over the 50 captures one capture's verdicts change:
Linkding's bundle create and patch, confirmed only by a list read after the
same bundle was deleted, are now unconfirmed, so 31 write tools are served (10
creates, 11 updates, 10 deletes) and the in-process smoke applies all 31. The
gates passed again (domain and services, boundaries, conformance and `jscpd`).

A seventh round settled two more findings. An update keeps its confirmation
when a later write overwrites only part of what it changed: a derived change,
such as an incremented version, counts as part of the update's effect, and a
later increment adds to the field rather than replacing it. A reset or load
forgets the collection spellings of the state it replaced. Both new tests fail
on the previous head. The verdicts over the 50 captures are unchanged plan by
plan, the in-process smoke applies all 31 served write tools, and the gates
passed again.

An eighth round settled three more. A later write erases the fields of an
earlier effect it overwrites, so two writes that together overwrite all of an
update's changes leave it nothing to be confirmed by. A recorded outcome erases
what earlier writes changed on its entity. A load keeps the Evidence's own
collection spellings, so a create in a collection the loaded state does not
hold keeps its recorded spelling. Each new test fails on the previous head. The
verdicts over the 50 captures are unchanged plan by plan, the smoke applies all
31 served write tools, and the gates passed again.

A ninth round made a create prefer a collection the state holds over an equally
fitting spelling known only from the Evidence, so a create after a load lands in
the loaded collection and reads back. Its test fails on the previous head; the
verdicts and the smoke are unchanged and the gates passed again.

A tenth round settled six findings Greptile raised on the list-lines branch
against this branch's code:

- a read with no query on a whole list is checked on the paging line serving
  answers it from, and a line whose query repeats a name is never checked;
- a read made while a write to its targets was still running checks nothing;
- a later call that stores a member otherwise than the plan refuses the plan;
- a create keeps the spelling of a collection the capture listed empty;
- a wide array no longer overflows the stack while checking path-dependent
  values;
- the guide counts served write tools among the catalog's.

Each new test fails on the previous head. The verdicts over the 50 captures
are unchanged plan by plan, the smoke applies all 31 served write tools, and
the gates passed again.

An eleventh round settled six more findings, five raised on this branch and one on the fidelity branch:

- a passing read confirms only the writes it shows something of;
- an item read names its entity as serving does, percent-decoded spellings included;
- a read a write's effect was learned from still contradicts the other writes;
- a line repeating a query name with one value stays checkable;
- document writes join the effect tracking, so a replacement overwrites an earlier merge;
- a call naming a page that the collection has outgrown answers from its recording (`page-exceeded`), and the gate does not check such reads.

Each new test fails on the previous head. The verdicts over the 50 captures are unchanged plan by plan, the smoke
applies all 31 served write tools, and the gates passed again.

A twelfth round settled four findings Greptile raised on the list-lines branch against this branch's code:

- a create that answers with its id alone is observed only through a read of that id;
- a later call that is the first to send the path's id in its body adds the identity member to the plan;
- the copy search walks a request body with an index, so a wide body no longer takes quadratic time (500,000 zeros: 63 s
  before, 74 ms after);
- the sent values of fixed members a plan keeps are counted against the view's allowance.

Each new test fails on the previous head. The verdicts over the 50 captures are unchanged plan by plan, the smoke
applies all 31 served write tools, and the gates passed again.

A thirteenth round settled seven findings Greptile raised on this branch, the fidelity branch and the list-lines branch:

- a passing read that shows nothing of a write leaves it for a later check, instead of clearing it;
- a read begun while a write to an unknown entity still ran neither checks nor shows the entity again;
- a later create whose sequence fields do not follow the learned sequence refuses the plan;
- a document replacement below the root overwrites only what it replaced;
- a built document plan writes later calls at its own object, even one sharing no member with the document;
- an update or delete finds its entity as an item read does, percent-decoded spellings included;
- a `_start`–`_end` range bounds a page as `limit` does, in serving and in the gate.

Each new test fails on the previous head. The verdicts over the 50 captures are unchanged plan by plan, the smoke
applies all 31 served write tools, and the gates passed again.

A fourteenth round settled two findings Greptile raised on the list-queries branch against this branch's code:

- the type's identity field never becomes a constant: an update whose id member the application ignored no longer
  writes the exemplar's id into the entity another call names;
- a page size of zero bounds nothing, so a whole line recorded with `limit=0` answers from the state.

Both tests fail on the previous head. The verdicts over the 50 captures are unchanged plan by plan, the smoke applies
all 31 served write tools, and the gates passed again.

A fifteenth round settled nine findings Greptile raised on this branch, the fidelity branch and the list-lines branch,
five of them on the previous rounds' own changes:

- an entity field whose name looks like a pointer is matched by name; only a document's pointers cover the members
  under them;
- a failed read contradicts each exercised write no unmodelled write came after, rather than skipping all of them
  when the oldest pending write came before one;
- an item read, update or delete names its entity as serving does, decoding the id once, so `book%2531` no longer
  reaches `book1`;
- a plan whose calls use a member both as the identity and as a fixed member, or fix it at different values, is
  refused;
- a size of zero bounds nothing only on a line whose recording listed items under it;
- an update whose observation drops a field the entity held is refused;
- a later create whose clock takes another format, or whose unique value is not a UUID, is refused;
- a derived state `data/get` would write past 32 MiB is not served.

Each new test fails on the previous head. The verdicts over the 50 captures are unchanged plan by plan, the smoke
applies all 31 served write tools, and the gates passed again.

A sixteenth round settled four findings Greptile raised on the fifteenth round's changes, here and on the fidelity,
list-lines and list-queries branches:

- a size of zero is no bound only by itself: a range or another size on the same line still bounds the page;
- an update is refused for a dropped field only when a later read shows it dropped, since a write's own response may
  leave fields out;
- interference is weighed against a tool's latest call on the read's entity or collection, not its latest call
  anywhere.

Each new test fails on the previous head. The verdicts over the 50 captures are unchanged plan by plan, the smoke
applies all 31 served write tools, and the gates passed again.

A seventeenth round settled two more findings Greptile raised on the list-queries branch against this branch's
interference rule: an unmodelled write counts against a tool when it followed the tool's call on any target the read
covers, so a later call on another entity does not hide it; and a failed item read contradicts the writes no
unmodelled write followed, checking only the others on their members. Both tests fail on the previous head. The
verdicts over the 50 captures are unchanged plan by plan, the smoke applies all 31 served write tools, and the gates
passed again. A follow-up weighs interference only on targets where the tool's effect survives, so a call
whose effect a later write overwrote no longer excuses a later mismatch; its test fails on the previous head.

## Collection-history accounting check

On 2026-10-22, Node 24.18.0, I compared the source before the write-history
change (`cfb42ddde`) with the bounded-history implementation. Each operation
inserted an entity at a new collection path with a 128-character repeated
suffix and immediately deleted it. Across five fresh Vitest worker processes,
the median for 1,000 completed cycles was 14.57 ms wall / 23,867 us CPU before
and 9.98 ms / 16,914 us after. The process RSS samples were 381.1–387.9 MiB
before and 380.9–387.6 MiB after. This fixture benchmark measures one matched
completed trace, not a representative user task or process-family peak memory.
The values include Vitest and V8 and are noisy; they do not establish a memory
bound. The 1 MiB policy is a deterministic accounting allowance for
additional identifier history, set to 1/32 of the separate 32 MiB state-intake
ceiling; it is not derived from RSS samples and does not bound total store or
process memory.

# Apply write effects to the served state

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

An environment served from its state also serves the write tools whose effects
the capture itself confirms:

- a create adds an entity;
- an update changes the fields the call sends;
- a delete removes the entity;
- a document write changes a document.

Later reads, list membership and `data/get` show the change, and `data/reset`
undoes it.

The `environment-state` view decides which write tools are served. It replays
the capture's own timeline on the extracted initial state: each recorded write
applies its modelled effect, and each later read that the state answers is
rendered and compared with the recorded response. A write tool is served only
when at least one later read reproduces after its effect and none contradicts
it. Every other write tool stays unserved, listed with the reason.

Values the application generates are deterministic: identities, sequences and
clock values follow the formats the capture recorded, so the same calls after
a reset give the same state.

## Write plans

The view adds two members to its result:

- `writes`: one plan per manifest tool whose method may change state
  (`changesState`), less the `POST` tools the capture shows only reading (below);
- `write_clock`: the instant the served clock starts from.

**Calls that only read.** A `POST` tool whose calls read state is no write: it
gets no plan, stays a recorded view with the reason `query-body`, is served by
replay, and its calls bound no initial-recording window and end no observation
search. The capture shows it by the first of these that applies:

1. every successful call answers as the successful `GET` of its path that
   finished last before the call began, of those with no write between, did (a
   status lookup posting the jobs it names);
2. every call names read operations only, in its body's `operation` or
   `operations[].operation`, else its query's `operation`, `op` or `action`
   (`batch` and similar only wrap them, in either place, so a call needs at
   least one other, and every `operations` entry must name one of its own, so
   an entry with no string operation or another container keeps the call a
   write); an operation reads when its words name one of `list`,
   `get`, `count`, `aggregate`, `info`, `search`, `find`, `read`, `query`,
   `schema`, `describe`, `fetch` or `lookup`, and none of `create`, `insert`,
   `update`, `modify`, `replace`, `delete`, `remove`, `upsert`, `add`, `set`,
   `save` and similar, so `findAndModify` and `findOneAndReplace` stay writes;
3. the path's last literal segment has a query word as its last meaningful
   word, split on `_`, `-`, `.` and case and skipping trailing `data`, `info`
   and `results` (`search`, `query`, `list`, `find`, `lookup`, `count`,
   `aggregate`, `stats`, `ids`, `selection`, `discover`, …), and no write word:
   `selection_data` names a lookup, while `query-history` names a history,
   `create_lookup` a create and `selection_data/import` an import, and each
   stays a write;
4. the path's last literal segment renews or opens a session: `auth-refresh`,
   `auth-with-password`, `login`, `logout`, `refresh` or `token`.

A tool stays a write when one of its calls was redirected or went unanswered,
since nothing shows what it did. It also stays a write when a `GET` line whose
path its call's path relates to (segment by segment, a parameter matching any
value) reads differently just before and just after one of its calls, or finds
its entity on one side only (a 400, 404 or 410 on the other), with no other
write between; the other read-only tools' calls are no writes there, so the
tools are dropped until none is vetoed. Those reads are the one that finished
last before the call began, of those no other write follows, and the first that
began after it ended, since one overlapping the call may show either state. Reads of unrelated paths do not
count, so a session renewal stays read-only although an endpoint under the
same root regenerates values on every read.

**Effects.** Each plan classifies its tool:

| Effect     | Tool                                                                  | Target                    |
| ---------- | --------------------------------------------------------------------- | ------------------------- |
| `create`   | `POST` to a state type's `collection_template`                        | an entity of that type    |
| `update`   | `PUT`, `PATCH` or `POST` to that template plus one trailing parameter | the entity the path names |
| `delete`   | `DELETE` to that same item template                                   | the entity the path names |
| `document` | `PUT`, `PATCH` or `POST` to a document view's path                    | that document             |
| `none`     | anything else                                                         | reason `no-state-target`  |

**Item actions.** A `POST`, `PUT` or `PATCH` to an item path plus one literal
segment (`/{type}/{id}/archive`) is an `update` of the entity the item path
names, recorded as `address: {by: "action", segment}`, when the segment names
no collection (no state type ends in it, and it is not `delete`, `remove` or
`destroy`) and every successful call answered nothing or that entity: never a
201, and an object holding the id at the type's id field where an item read of
the type shows its entity, with every field that read always shows. A call
answering anything else made a sub-resource, as a comment `POST` does, and
stays `none`. An action's unsent change of a scalar that no other rule
explains takes the value its observation showed, a `set` rule applied on every
call (`archived: true`); a changed object, list or instant has no rule, so the
plan is `unexplained-change`. An action is served only when it sets something
and a recorded call found every field it sets already at that value, since one
change cannot tell a set from a toggle; otherwise it stays `unconfirmed`. Its
call may send no body. An action is observed in its own response, or in a
later item read only while no other tool's modelled write to the entity awaits
a check: that read then checks the other write, and the action's call is one
the gate does not model.

**Bulk writes.** A `DELETE`, `PUT` or `PATCH` at a type's
`collection_template`, or a `POST` to it plus `delete`, `remove` or `destroy`,
names its entities in its body: an array of ids of one JSON kind, or of
objects carrying the type's `id_field`, at the root or as the body's one array
member (`{"IDs": […], "Read": true}`, `[{"Id": 9}]`). Every successful call
must name them the same way, recorded as `address: {by: "ids", member, kind}`
or `{by: "elements", member}`. A path whose last segment is the type's
singular or plural (`/messages` for `/message`) writes that type. An `ids`
member applies the body's other members to every id, an element its own
members; a root id array updates nothing. Each named entity gets the effect as
an item call would, checked by the same reads; one the state does not hold
leaves the call unmodelled there. A bulk update's observation must show the
members the call sent. Serving answers any ids only when the exemplar's
response fits: no body, a body naming none of the recorded ids and holding no
number equal to how many it named (a count), or an array with one element per
id, each showing it as the first does; otherwise the reason is
`body-unusable`.

A `POST` whose path gives it no target is a `create` into the type its returned
id is read under: its exemplar's response names an id (an identity member of the
body or of an object member, or a scalar body or sole member of four characters
or more), and the first later successful item read naming that id, whose body
shows the item (a JSON `null` read is passed over), belongs to a state type. That read must come before any other tool's write, which may have
made what it shows, as a publish call makes a note from a draft. The entity must
be new: neither the initial state nor any read finished before the call began
holds that id (one still running may show what the call made): an item read of
it under the item read's type or collection whose body shows the item (a JSON
`null` is an absence), a list read of its type, or any read of that collection, whether an
item read of it, a list read of its type, or any read of the item read's
collection, with or without a query, that lists it under an identity member of
its own (a body with no list counts an identity member at any depth). An id shorter than four characters may be any type's,
so it links only to a type a successful read showed before the call. The plan
records that read's collection, and serving creates there, since the call's own
path names no collection of the type. That collection holds only for the
exemplar's path arguments, compared segment by segment, each as recorded or in
the other spelling once percent-decoded: serving refuses a call with others, and the gate counts such a
recorded call as a write no built plan models. Its path fields take the
exemplar's path values decoded once, the source it accepts, whichever spelling
the call sends. A linked create's call is
observed only in a read of an id its response returned, at the top or in an
envelope member, so another unseen item's read is never taken for it.

**Exemplar.** A plan is built from its first successful (2xx) recorded call,
the exemplar.

- **Request body.** The exemplar's request body must be a JSON object that
  could enter the state: a JSON-like media type, complete UTF-8 text within
  256 KiB and exact numbers. All own JSON member names are retained. Otherwise the reason is
  `body-unusable`. A `DELETE` takes no body. A create's or update's body
  whose only member wraps one object in a one-element array (Ghost's
  `{"posts":[{...}]}`) is that object, and the plan records the member as
  `body.envelope`: serving takes only a body wrapped that way.
- **Query.** Serving takes only the query parameters the exemplar sent, with
  its values, since they may change what the body does (Ghost reads `html`
  only with `?source=html`): a parameter a call leaves out takes the recorded
  value, as the recording sent it, and a call with another value or parameter
  is refused, a bulk call included. The gate treats a later recorded call sent
  with another query, or wrapped otherwise, as a write its plan does not
  explain: it brings the entity to what the call recorded, without
  attribution, and a bulk call leaves the entities it names unmodelled.
- **The written entity.** The entity is observed in the exemplar's response,
  located by its identity value at the root, in one member, or in a
  one-element array, as item views locate it. When the response does not carry
  it, the entity is observed in the first later read that shows it: an item
  read of that entity, or for a create, the one entity a collection read newly
  lists. A create whose response names its id alone (a scalar, the identity
  field, or one member) is observed only through a read of that id. With
  neither, the reason is `no-observation`.

**Field rules for creates.** Each field of the observed entity gets the first
rule that explains its value. Rules that read the call come first, so an
identity the client sends is an echo:

1. **Echo.** A body member of the same name with an equal value.
2. **Copy.** A body string of 8 or more characters, found at a JSON pointer of
   the body (the shallowest match).
3. **Path.** The value of a path parameter of the call, percent-decoded.
   Serving decodes it from the collection the call names, whichever spelling
   the call uses, and the gate fills a recorded call's path fields from that
   collection too.
4. **Slug.** The slug of a body string member: lower case, runs of other
   characters joined by `-`.
5. **Identity.** The type's `id_field` is generated. A sequence when it is an
   integer (or a string of digits); otherwise a UUID when it has the
   `8-4-4-4-12` hex shape; otherwise a token of the same length and character
   classes.
6. **Clock.** A timestamp within 10 minutes of the exemplar's start time. The
   format is kept: ISO-8601 with its separator, fraction digits and zone, or
   epoch seconds or milliseconds. An object whose every clock lies between 1
   second before the start time (a whole second's truncation) and 2 seconds
   after it, in one format, is a nested clock when the type's other entities
   hold that field as objects agreeing with it in every other member and
   holding other clocks: served, those members take the write's clock and the
   others are kept. A reference to another entity, which differs by entity or
   was made before the request, is not one.
7. **Sequence.** An integer one greater than the largest value of the field in
   the collection, else in the type. The integer may be written as `-`-separated
   digit groups of one width of at least two digits (an asset number `000-005`;
   not a date, version or address); a served value keeps the recorded value's
   groups and zero padding, and digits that outgrow them lead. A later call must
   record the value spelled that way.
8. **Unique.** A UUID-shaped string that no other entity of the type shares,
   or an opaque token (16 to 64 letters, digits, `_` or `-`, with letters and
   digits both) that no other field of the entity repeats, where every other
   entity of the type holds a token of the same length and none this one.
   Serving generates a token of the same length, character classes and
   separator positions.
9. **Template.** A string containing a generated value, or else a copied
   value, as a delimited token (for example a URL that ends in the new id or in
   a slug the call sent under another name). It is rebuilt around the new
   value. An echoed value is not a token, nor is a copy of one: it may recur in
   unrelated text. A copied or echoed member whose value also sits in text no
   template rebuilds around it (beside another source in one template, or in a
   constant) is accepted only with its recorded value.
10. **Constant.** Otherwise the exemplar's value.

When a constant, or the text a template keeps, contains a path value of the
exemplar's call as a delimited token, the create is served only for calls
naming the exemplar's collection.

A constant may also derive from a member without holding its text, when the
constant is named after the member: with a reference's `Id` or `_id` left off,
one name's letters and digits begin the other's (`parentId` and `parentName`,
`dateEndDate` and `dateEnd`), three or more of them. Such a member is accepted
only with its recorded value when it names another entity the copy holds (by
its id, among the types whose paths hold the member's name when any does; a
value shorter than 8 characters only under a member named as a reference, such
as `parentId` or `parent_id`) whose own string of 8 or more characters the
constant repeats under another name, neither name reading as a reference; or
when it sends a date or time that the constant's instant lies within two days
of (an end date stored as a time in another zone).

**Body members of a create.** A member is either accepted or not:

- **Accepted.** An echoed member, a member copied whole into a field of another
  name and stored under none of its own, or the identity field's value. A
  member copied whole must have the JSON type of the field it is copied into.
  Every member the exemplar sent is required.
- **Accepted only as recorded.** An echoed member naming the object the entity
  nests under the field it refers to (`collection_id` and a `collection`
  object), whose other members serving would keep as recorded; and a state
  word other fields go with: a lowercase word several entities share, where
  every entity in another state holds a field the new one leaves null, or the
  reverse (Ghost's `status: "draft"` beside `published_at: null`), unless the
  tool's recorded calls sent other values of it. Updates take a member naming
  a nested object only as recorded too.
- **Not accepted.** A member the application stored with a different value
  (transformed), or one it did not show. A call that sends such a member is a
  tool error naming the accepted members.

**Updates.** Body members follow the same accepted and not-accepted rules,
except that a member the application stored differently is accepted only with
the value a recorded call sent it with, and then stores the value that call
recorded (its `constant` rule carries it). The type's identity field never
takes a rule: sent as the path's id it is the identity member, sent as another
value the application ignored it is accepted with that value and stores
nothing, and a stored id that changed is `unexplained-change`. A plan whose
calls use a member both as the identity and as a fixed member, or fix it at
different values, is `unexplained-change`, as serving could not take every
recorded call. So is an update a later read shows dropped a field the
entity held, since serving keeps every field an update does not write; a write's
own response may leave fields out. A member the application replaced
with a fresh UUID (`unique`, below) is accepted with any value; a UUID stored
as sent in another letter case is the sent value, not a fresh one. A member a later call is the first to store,
which the plan's observation does not show, keeps the JSON type that call stored
it as (the body's `kinds`), as an exemplar's member keeps the observation's.
`PUT` requires every member the exemplar sent; `PATCH` and `POST` require at
least one. A sent clock the call left as it was, stored in whole seconds and
naming the second the call ran in, is a `held-clock` the application stamps
anew (Ghost's `updated_at`, which a client sends back as it read it), when it is
the only such member the call sent: a call must send it as the entity holds it,
or it is refused, and it is served as the write's clock. An unsent clock the
call left as it was, stored in whole seconds and naming the second the call ran
in, cannot show whether the update stamps it, unless it names when the entity
was made (`createdAt`, `row_created_timestamp`): the plan stays `unconfirmed`
until another call shows it stamped, and that call's clock rule then holds
without the first call contradicting it. A field the exemplar's update changed
without sending it is explained as one of:

- clock;
- a nested clock: an object the entity held whose only changes are clocks
  within 10 minutes of the start time, in one format, where the type's other
  entities hold that field as objects agreeing in every other member. The gate
  stores the object the first later read of the entity shows when it differs
  from the write's only in those members, each within 2 seconds, as Metabase
  answers an update with one instant and stores another. Serving refuses it on
  an entity holding no such object;
- an increment by one;
- a slug of an echoed member, judged before a token, since a renamed slug is
  spelled like one;
- `unique`: a UUID in place of another UUID, or an opaque token in place of
  another of the same length, that no other entity of the type holds and the
  call sent nowhere in its body (a version the application assigns on every
  update);
- `stamp`: the acting user on a field named `modified…by`, `updated…by`,
  `edited…by` or `changed…by` (or `last…`), stored on every call, when the
  entity already held the value under its `created…by` counterpart
  (`modifiedByName` and `createdByName`), and the call sent no member naming
  the same thing (`modifiedById`). The other `…by` field naming the same user
  (`modifiedById` beside `modifiedByName`) is stamped with it when the call
  showed it at its own `created…by` counterpart's value, even where the entity
  lacked it before;
- `derived`: when the call sent exactly one member the entity stores nowhere,
  a value showing that member's text, markup aside (at least 8 characters): a
  field Ghost derives from the `html` it was sent. The member is accepted only
  with its recorded value, and a call sending it is served only on an entity
  holding the value the recorded call found (`from`), else refused;
- `renewed`: an array or object whose only changes are UUIDs replaced by ones
  that neither it nor another entity of the type held, as child rows an update
  rewrites are. The rule names the pointers it renewed at (`*` for any array
  index): every UUID at them is new, each old UUID by a single new one, and
  UUIDs elsewhere, such as a row's references, are kept. One call renews a
  UUID alike in every field and in either letter case, and never two old UUIDs
  into one new one.

A field the entity lacked before is a change too when the view that observed
the update had shown the entity, so a field the application fills in on update
follows its rule. Any other change is `unexplained-change`. An increment, a slug, a stamp or a derived value applies to
every call that could take it, and `unique` and `renewed` to every call, so the
plan is also `unexplained-change` when such a rule would give a call of the
tool another value than the one it recorded, a recorded call kept a `unique` or
`renewed` field, or a later call treats a member otherwise than the plan: one
call echoes it and another stores something else, or the two rule it
differently.

**Deletes.** A delete removes the entity. Its response is the exemplar's
response, with the entity re-rendered when the response carries it.

**Documents.** A document write merges the body's members (replaces them, for
`PUT`) into the document object that holds most of them: the root or one
member. Later calls write at the exemplar's object. Document reads answer only on their recorded line, so a write is
served only at the path the state holds the document at, each segment verbatim
or either spelling once percent-decoded, and the gate treats a recorded write
at another path as an unmodelled write. A recorded write whose
body serving would refuse (a member of another JSON type than the document
holds) is `unexplained-change`.

**Responses.** A write answers with the status and content type of one
recorded response:

| Response   | Body                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| `entity`   | the written entity, rendered into the recorded envelope at the plan's pointer through the recorded fields |
| `identity` | the recorded body with the new identity at the plan's pointer                                             |
| `empty`    | no body                                                                                                   |
| `recorded` | the recorded body                                                                                         |

A rendered body missing a field the recorded response carried is a tool error,
and the state is left unchanged.

**List position.** A create's `insert` rule places the new entity in its
collection's order: sorted by the identity field or a clock field (ascending
or descending), `first` or `last`. The rule is the first candidate consistent
with both the initial `all`-membership recordings and the position a later
recorded list shows. With no evidence, the rule is `last`. A sort by a
random identity (version 4 UUIDs, or generated ids every creation clock lists
in another order) is a candidate only after `last`: the recorded order by it is
a coincidence until a list shows a create placed by it; time-ordered ids
(ObjectId, ULID, TSID, version 7 UUIDs) keep it. When the sorts the recorded
order admits would place the created entity differently, none is claimed
before `last` until a later list settles it.

## The gate

The view replays every primary-origin record in timeline order on a copy of
the initial state.

**Writes.** Only a 2xx write is modelled. A modelled write applies its effect, using the values it recorded
for generated fields and the stored values for fields it transformed. A
modelled write whose call the plan does not explain brings its entity to the
recorded outcome instead, without attribution. So does an update of an unknown
entity (below): its call cannot be checked, so it adds nothing to a built plan.
A later create whose generated
values take another form than serving gives them (a sequence value out of
order, a clock in another format, a non-UUID unique value) makes the plan
`unexplained-change`; integer identities are left to the id mapping. A later
create outside the collection a tied plan permits is unmodelled, as serving
refuses that call, so a read of what it recorded does not confirm the plan. The
gate picks that collection among equal spellings in serving's order (below). An update or
delete names its entity as an item read does (below). A later update that does
not answer with its entity is observed only by a read whose view shows every
clock the plan learned, since serving stamps them; without one it is unmodelled.

Any other write that may have changed state, including a redirected or
unanswered one, is unmodelled, and what it may have changed
depends on where its path lies relative to each type's collection paths
(segment-prefix related, parameters matching any segment):

- **Below an item path:** the named entity is unknown until a read shows it
  again. When the path names no held entity, every entity of that collection
  is unknown.
- **At a collection path:** that collection is not checked again.
- **Above collection paths:** everything under the path is not checked again.

The path names its entity as an update's does and its collection as a create's
does, so a plain spelling reaches a collection held under an encoded one; a
path above collections covers each collection whose segments are its own
verbatim or once percent-decoded.

An item read of an unknown entity shows it again: the copy takes its recorded
values. A failed read that is no absence shows nothing, and the entity stays
unknown. Writes that changed it since its last check are checked only on the
members they sent, less those the view treats as volatile, which show nothing
of a write.

A write no built plan models can also make an entity the copy never held, such
as a row an import or a nested create added: a write of a tool with no create,
update, delete or document plan, a call of a tool whose plan was never built, a
linked create's call that serving would refuse, or any write redirected or left
unanswered.
A successful item read of an entity the copy has never held (no initial entity,
and none a modelled write created, changed or removed) that names it by the
type's identity, when such a write ran since that entity or its collection was
last checked, shows that entity: the copy takes its recorded values instead of
failing the read, and later writes to it are modelled and checked as usual. The
taken entity counts against the view's budget as a created one does. An
entity a modelled write touched is never taken back this way, and a built plan's
call that serving would not apply, such as a create outside its tied
collection, keeps its evidence.

**Reads.** A read is checked when the served environment would answer it
from the state (an item, list or document read compares without the view's
`per_response_members`):

- an item read of a state-backed item view, of the entity serving would name:
  in a held collection the read's path matches, each segment verbatim or either
  spelling once percent-decoded and verbatim spellings first, the id
  percent-decoded once, then as written;
- a list or document read on one of its view's checked request lines,
  chosen as replay chooses the line for the read's call: each path parameter
  the read's value verbatim or either spelling once percent-decoded, preferring verbatim
  spellings, then recorded order, and the query values decoded, in any order.
  A read with no query on a whole list falls back, as serving does, on a
  checked line that only pages it. A line whose query repeats a name with
  different values is never chosen, since no call's arguments can name it; one
  repeating a name with one value is, as a call naming it matches both. A list
  is compared as served from the collection of that line. A read on a page
  (`limit`, `size`, `per_page` and the like, or a `_start`–`_end` range; a size
  of zero is no bound on a line whose recording listed items under it, while its
  other sizes and range still bound the page) of a
  whole list checks nothing once the collection holds more entities than the
  page, which serving then answers from its recording. A line without proof of
  whole membership lists its recorded members still held, unless a learned
  query evaluates the read over the state. An empty later page therefore does
  not contradict a create outside that page.
- A read made while a modelled write to its entity or collection was still
  running, starting before that write ended, checks nothing: it may show the
  state before or after the write. Nor does such a read show an unknown entity
  again.
- A read a write's effect was learned from checks nothing of that write, but
  still contradicts the other writes it exercises.

**Comparison.** The read's answer is the full response serving would give from
the copy: an item read's entity rendered into its item view's base recording,
or a list read's members as serving would list them (so a member the copy no
longer holds fails the check) rendered into its line's base recording. It is
compared with the recording, as the read gate compares, with volatile fields taking the
observed values. A recorded 400, 404 or 410, or a 2xx with a JSON `null`
body, for an entity the copy does not hold agrees with it. A successful read
whose usable body no longer holds the entity or the list fails, as does one of
an entity lacking a field every recording of its view carried, which serving
refuses to answer with.

**Attribution.**

- A check exercises the write tools that changed its entity or collection
  since the previous check of it, less those whose effect later writes erased.
  An update's effect is the fields it sent or changed, derived ones included.
  A later update overwrites the fields it sets (an increment adds to its field
  instead), a recorded outcome every field, and a create or delete the whole
  entity. A document write's effect is the members it merged at its
  object, or everything under the object it replaces, the whole document at the
  root; an entity's fields match by name only, whatever their names look like. A write with nothing left on an entity no
  longer counts there, nor in a collection where no entity it changed keeps any
  of its effect. A mismatch contradicts them. A pass confirms those it shows
  something of: a create's or delete's membership, or a changed field the
  read's view shows and does not treat as volatile; a read that shows none of
  an update's changes confirms nothing of it, and leaves it for a later check
  of that entity or collection.
- A mismatch contradicts each exercised write that no unmodelled write came
  after its latest call on any of the read's entities or collections where its
  effect survives, whatever earlier write is still pending. For a failed list read the unmodelled write must
  also follow the last check and pending writes of each member that differs, so an older change elsewhere
  does not excuse a newer write the list shows undone. An item read checks the writes an unmodelled
  write did follow only on the members they sent, and a list with such a write
  is not checked again: the unmodelled write may explain the rest.
- A failed item read with no such unmodelled write contradicts the writes that
  changed the whole entity (its create or delete). When one of them is
  exercised, each exercised update is checked instead on the fields its effect
  holds, and confirmed when those show as the copy holds them and its latest
  call's response shows every other field it and the read both show (but
  volatile ones and those other updates wrote) as the read does: serving
  answers an update from the copy, so a response that shows the entity
  otherwise would be answered wrongly. A field the copy lacks that the read and
  an exercised update's response both show, with the same value other than
  null, is that update's change: an update whose effect does not hold it is
  neither confirmed nor contradicted by the read, and when such changes are
  the read's whole difference the entity's own writer is not contradicted.
  When the read differs on a field the copy holds that no exercised update
  wrote, any of the writes may have caused it, and each is contradicted.
- A failed item read whose field newly embeds an entity a create made (an
  object in the field, or within it, naming it by its id and by another of its
  strings of 3 or more characters, 8 or more when the id is shorter than 8),
  which the copy's value lacks, contradicts that create: serving would not show
  the change it made there.
- A mismatch on an entity or collection that no write changed contradicts,
  as `side-effect`, the modelled writes since that previous check whose paths
  are segment-prefix related to the read's path. When a refused write's
  recorded outcome since then left the entity lacking a field every recording
  of its view carried, the create that made it is contradicted too: an outcome
  merges only what its answer showed.
- After a failed item check, the copy takes the read's recorded values (or
  drops the entity on a recorded absence). A list whose check failed is not
  checked again.
- A failed item or list read the gate counts passes when the view lists some
  string-array fields sorted and its order rules out the written one and the
  order the values were first held in (see `sorted_arrays` in the state view);
  the type's views keep the fewest such fields the read needs, and the read
  checks the writes it exercises. A counted read listing such a field unsorted
  rules it out for its view.
- A list that fails only for where one create placed its entity passes when
  another of that create's insert candidates reproduces it, which then
  becomes the plan's rule, unless an earlier list check relied on the rule
  (an item read's confirmation does not fix it).
- The read that supplied a create's or update's observation does not check
  it, but checks the other writes it exercises.

**Verdicts.** A plan is served when at least one check confirms it and none
contradicts it. Otherwise the reason, in this precedence, is:

1. the first build reason;
2. `contradicted`, with `contradicted_by` naming the first contradicting read;
3. `side-effect`;
4. `unconfirmed`;
5. `incomplete-entities`: an update or delete that answers with the entity,
   when no initial entity holds every field its recorded answer shows (for
   example a delete that answers with an edit view of the entity the reads
   never showed), so it could answer only for entities the environment itself
   created. An update's answer renders the entity it wrote, so a field one of
   its rules writes counts as held, except an increment's, which adds only to
   a held value;
6. `unknown-clock`: an otherwise servable plan needs `clock`, `held-clock`, or
   `nested-clock`, but the capture establishes no global served clock start.
   Its learned rules and confirming reads remain retained, and plans without
   this clock dependency remain eligible for serving.

`checked_record_ordinals` lists the confirming reads.

## Serving

**Catalog.** In state mode, the catalog adds the write tools whose plan is
served. Their descriptions say the tool:

- applies its effect to the served state;
- names its target type;
- lists its required and accepted body members, quoted and sampled within the
  description budget as response fields are, the members it accepts only with
  their recorded value, with that value when its JSON text is 120 characters
  or less, and the envelope a body wraps its object in;
- names the query its recording sent.

The input schema says the same: each query parameter the recording sent is
optional, defaulting at execution to its recorded value, with a nonempty value
as the only `enum` member; an empty value is described and enforced at execution
because some clients reject empty literals. A body that wraps its
object requires that member, an array of one object; and a member accepted
only with its recorded value carries that value as `const` when it is short
and neither a boolean nor an empty string (some clients reject these literals), else a description
saying it must equal the recorded value. A refused member's message names the
recorded value the same way.

The discovery budget charges them. `--replay-only` and the replay fallback are
unchanged.

**Calls.** A served write answers synchronously against the live store and
changes it atomically, so every MCP session and `data/get` see one state.

**Refusals.** These are tool errors that leave the state unchanged:

- a body that is not an object;
- a missing required member;
- a member that is not accepted;
- a value of another JSON type than the exemplar's (for a member only a later
  update stored, that call's), for documents as well as entities;
- an update or delete of an entity the state does not hold;
- a create in another collection when the plan is tied to its own;
- a document write at a path other than the one the state holds it at;
- a body member or a resulting value `data/add` would refuse (a number not
  exact as `data/get` writes it or nesting past the
  limit), increments included, so `data/get` always loads back;
- a create, update or document write that would take what `data/get` reports
  past the 32 MiB `data/add` intake limit, as a `resource_constraint` error;
- a rendered response missing a recorded field.

When the tool, or else an item view of the type, recorded a 400, 404 or 410
response, an update or delete of a missing entity answers with the latest such
recording instead.

A create in a collection held under more than one spelling (`acme1` and
`%61cme1`) goes to the one the call spells verbatim, as item calls choose their
entity; a collection keeps its spelling after its last entity is deleted. A
reset or load knows the spellings of the Evidence's state, of the state it
installs and of the type's checked list lines (so a collection the capture
listed empty keeps its spelling), never those of a state it replaced. When two
spellings fit a call equally, the one holding entities wins, the earlier first
entity in state order among held ones and the earlier known among emptied ones. `data/add` refuses a document that `data/get` would write back past the
32 MiB intake limit once it adds the members a document may omit, such as
`types` and the state Evidence id. A derived state `data/get` would write
past that limit is not served: the environment serves replay and reports the
state `unavailable`.

**Clock and generators.** The store's clock starts at `write_clock` and
advances one second before each served write; clock fields take its value in
their recorded format.

- **Sequences:** one more than the largest current value in their scope, the
  largest the state started with at its last reset or load, and the largest
  value they generated, so a deleted entity's value is not reused, as database
  sequences do not reuse values.
- **UUIDs and tokens:** derived from a SHA-256 of the state Evidence id, the
  tool, the field and a write counter, skipping values the type already holds.
- **Renewed fields:** the entity's current value with each UUID at the rule's
  pointers replaced by one derived from a SHA-256 of the state Evidence id, the
  tool, the write counter and the UUID's order in the call, the same
  replacement wherever the call renews that UUID in either letter case, spelled
  in each place's case; held values are not skipped.
  An entity without the field is left without it.

`data/reset` and `data/add` restart the clock, the counter and the
sequences.

**Missing entities.** An item read of an entity the state does not hold
answers with the tool's latest recorded 400, 404 or 410 response, or 2xx JSON
`null` response, the absences the gate accepts, when it has one, labelled
`state.view: "missing"`. Otherwise it stays a tool error.

**Lists of a whole collection.** Written entities matter only if lists show
them, so the read gate's `membership: "all"` also covers a line that only pages
its list (`limit`, `offset`, `page`, `per_page`, `perpage`, `page_size`,
`pagesize`, `size`, `start`, `_start`, `_end`) when its recording listed the
whole collection at a proved zero start. Positive `page` values do not prove
the beginning, because their base is unknown. Whole membership is per line:
`all_record_ordinals` can name whole lines within a recorded-membership view.
A learned query can filter, search, sort and page the state; otherwise a later
page lists its recorded members still held. A list call with no query argument
answers from a whole line of the collection its path arguments name, with
`replay.exact_match` false; a collection with no such line answers from its
recording. A call that asks for a page evaluates a learned query when one
covers its arguments; otherwise it keeps the recorded page members.

**Provenance.** Write answers carry `state: {source: "state", view: "create" |
"update" | "delete", type, collection, id}`, or `{source: "state", view:
"document-write", path}`. A bulk answer adds `ids`, every entity it wrote in
body order, `id` naming the first.

**Bulk and action calls.** A served bulk tool takes its body as recorded (an
array of objects or of ids of the recorded kind, or an object), a `DELETE`
included, and `environment-compare` sends a probe's body to it; every id must
name an entity the state holds, else the call is refused and the state is
unchanged. A bulk
update with a `unique` or `renewed` rule writes one entity per call, since one
call draws those values once. A bulk write changes or removes its entities in
one step, so a call the state cannot hold changes none of them. A served item action's path names its entity
before the action segment.

**Data plane and export.**

- `data/get` reports written entities without record citations; they load
  back through `data/add` unchanged.
- `environment-export` counts served write tools in the bundle's tool count
  and README. Its check stays a read tool.

## Not modelled

These stay unserved, or are labelled in the description:

- side effects on counters, relations and copies of entities in other
  collections;
- inputs the application transforms;
- members the capture never sent;
- reordering after an update;
- membership of filtered or paged lists, which answer their recorded members;
- write paths the manifest left literal;
- writes whose request body the capture did not retain;
- referential rules on delete: a delete removes the entity alone, so an
  application that refuses to delete a referenced entity, or deletes its
  dependents with it, is not modelled;
- authorization.

## Acceptance

- **Domain tests:** classification, every field rule, request-body admission,
  observation from a later read, the insert rules, every verdict and reason,
  attribution and resynchronisation, and taint by an unmodelled write.
- **Services tests:**
  - store mutations and their atomicity;
  - every refusal;
  - generated values and their determinism across reset;
  - `data/get` round trips of written entities;
  - the recorded 404 for missing entities;
  - the catalog and descriptions in each mode.
- **Boundary test:** a write tool changes the next read over MCP.

**Real captures.**

- The view runs over every showcase capture within its budget, and the
  verification reports, per capture, the write tools served and the reasons
  for the rest.
- One environment, chosen at random among those serving a write tool, is
  exported, run in the AgentEnv framework, and graded from `data/get` after an
  agent's create, update and delete.
- The served model is compared with that application running live on the same
  calls.

No test reaches an external network.

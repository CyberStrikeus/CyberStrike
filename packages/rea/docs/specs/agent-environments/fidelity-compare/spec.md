# Compare an environment with the application it came from

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

An environment is only as useful as it is faithful: an agent trained or graded on it should meet the behaviour of the
application it was captured from. REA checks an environment only against its own capture, so nothing says how far it
drifts from the application on calls the capture did not make, after writes, or on errors.

`rea environment-compare` measures that. It takes an environment (a manifest and its capture Evidence) and one or more
**probe captures**, each a recording of one call sequence made against the live application, and reports how many of the
probe's calls the environment answers as the application did, which tools disagree and how.

The command only reads Evidence: it makes no network call. Whoever records the probes drives the application with its own
credentials and resets it between sequences.

## Requirements

- Inputs: the manifest Evidence, its capture Evidence (`--evidence`), and one or more probe capture Evidence files
  (`--probe`, repeatable), each `inspect-web-network-capture` or `capture-browser-scenario` Evidence of one sequence.
- Each probe is one sequence run against a freshly reset application. Before each probe the environment's state is reset,
  so sequences are independent on both sides.
- Requests are taken in the probe's order (start time, then ordinal; ordinal alone when any record lacks a start
  time, as state extraction orders them). A request is matched to the manifest tool of the
  same method whose path template it fits with the most literal segments; format-rule parameters must fit their format
  once percent-decoded, as replay reads them.
  Query values the tool takes and a JSON body become the tool's arguments. A path argument is the raw segment: the
  environment decodes it once, so a segment encoded twice is not read as a second decoding. Replay matches that raw
  argument against a recorded segment that equals it, equals its one decoding, or decodes once to it.
- A record without a usable request line (a redacted URL, a transaction the capture cannot attribute, an unparseable
  URL or no method) is not replayed, nor is a request to another origin than the probe's application (`other-origin`),
  which is the origin with the most JSON-like records, as the manifest chooses its own. A request with no recorded
  answer is made, since it may have changed the application, but not compared. Each is listed per probe with its
  reason and left out of agreement.
- A request no tool matches is reported `no-tool`; a matched tool the environment does not offer, such as a write it
  withholds, is reported `not-served`. Neither is answered.
- Ids differ between a re-seeded application and the capture. The comparison maps them:
  - seeded entities pair across the two answers by a natural key: a field present on every element of both arrays whose
    string values are unique on each side and shared between them;
  - identifier fields (`id`, `uuid`, `guid`, and names ending in `_id`, `Id`, `ID`, `_uuid` or `Uuid`) of paired objects,
    and of the two answers to the same call, map the live value to the environment's value; a create's two answers map
    the new ids, including a response that is only that id at the write plan's identity location. The `id`, `uuid` or
    `guid` of the answer's own entities (at the read view's entity or list location, a write's response location, or
    else the root) also maps within the collection the call names, since two collections can reuse a live id for
    different entities. An equal pair is kept in that collection, so another collection's mapping of the same live id
    does not replace it. Global mappings are one-to-one and first-pair-wins; equal global pairs also reserve both ids.
    If an equal pair conflicts with another pairing, its contested live or environment id is not used to normalize
    either pair, in either observation order. Only non-identity, unconflicted mappings count as mapped ids. Outside
    identifier fields, a string maps only at a field where learning found it held as an id in environment state. The
    keys of two objects keyed by ids map
    when their values pair (keys that partly overlap only when they are digits, UUIDs or their entries' identities, and
    every value pairs);
  - ids are learned only from an answer the environment gave this call, from its state or from a recording of exactly
    this call, its whole request line and its request body: a recording of another call that replay answers with
    instead holds other entities. A tool that takes a body does not match a recording whose body the probe did not send;
  - path, query and body values equal to a mapped live id are translated before the environment answers, a path
    parameter by the collection it names, except query values that page a list (`limit`, `offset`, `page` and the
    like), which count items rather than name one. A literal route segment is not translated. A nested collection is
    the live path's concrete parent values, each parameter decoded once, so two parents do not share one child map and
    spellings replay treats as equal name one. A second encoding stays a different parent. Learning and translation use
    that same live path.
    A path value the map does not know, and the environment's state does not hold, is reported `unmapped-id`.
- A call is checked against the served tool's input schema first, as the MCP server checks it; a call it refuses is
  reported `refused`. A browser probe keeps its request bodies; one captured without response bodies is refused, since
  only statuses would compare, and so is one that makes POST, PUT or PATCH calls without recorded request bodies, since
  those calls would be made empty.
- Answers compare after normalisation: empty response text and JSON `null` equal no body (a JSON empty string stays one);
  decoded JSON values compare structurally, plain text compares as text, and retained base64 bodies compare as bytes
  (including against UTF-8 text with the same bytes), without treating a base64 spelling as text. Mapped ids compare
  equal in identifier fields, in `ids`/`uuids`/`guids` scalar lists, and for an entity's own identity within the call's
  collection; other numeric fields stay literal. Any other id compares by the
  probe's mapping, and an entity's own identity both sides hold verbatim differs when its collection's mapping gives it
  another environment value (a reference keeps raw equality, as the probe's mapping cannot tell which collection it
  names); an object's members compare under the environment's mapped keys only when it is keyed by learned ids as
  learning reads one, and any other object compares field by field; two clock values (ISO-8601 strings, or epoch numbers under
  time-named fields) compare by format only; numeric array elements remain literal.
  Different strings normalize as generated only at direct entity fields where
  the executed served write plan proves a unique token or UUID/token identity
  generator, and neither side participates in an ID mapping. A UUID or token
  shape alone is insufficient evidence. A body over the replay
  limit, text or binary, compares by status only, as does a live body the probe did not record, unless the answer has
  none by definition (204, 205, 304, or an answer to `HEAD`). Both are counted.
- A step agrees when the statuses are equal and the normalised bodies are. Differences are categorised: `status`,
  `missing-field` (the application had it), `extra-field`, `value`, `length`, `order`, `clock-format`, `refused` (the
  environment refused the call), `not-served`, `no-tool` and `unmapped-id`, each with a JSON pointer and short values.
- The report gives agreement overall, per probe and per tool, agreement ignoring item order beside it, the counts per
  category, the ids mapped and the values normalised, the records left uncompared, and each step's differences (at most
  20 per step).

## Non-goals

- No network access, no credentials, no reset of the application: probes are recorded outside REA.
- No generation of call sequences; a later change generates them where the environment disagrees.
- No change to how environments serve.

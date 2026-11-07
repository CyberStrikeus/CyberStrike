# Erlang BEAM files

`inspect_erlang_beam` / `inspect-erlang-beam` answers whether one selected
local file is a `FOR1`/`BEAM` IFF container, which chunks that form stores, and
which atom, export, import, lambda, and Code-header fields those chunks carry.
It reads the file without executing bytecode and does not require an Erlang
installation or BEAM emulator.

```bash
rea inspect-erlang-beam /absolute/path/to/app.beam --json
```

The CLI resolves relative paths against the caller's working directory. MCP
requires an absolute filesystem path and preserves that exact selection:

```json
{
  "name": "inspect_erlang_beam",
  "arguments": { "path": "/artifacts/app.beam" }
}
```

## Observations

The inline Evidence result contains the artifact path, SHA-256, and byte length.
`chunks` lists every IFF chunk name, file range, and payload SHA-256.
Repeated names retain separate chunk occurrences. Decoded tables and the Code
header use the last occurrence of each name, matching OTP's loader; the chunk
inventory still exposes earlier payloads and their source ranges.
The BEAM form size bounds the parsed chunks. Bytes after the declared form are
ignored by the parser but remain part of the selected artifact's byte length
and SHA-256.

When a selected `AtU8` or `Atom` table is decoded, `atoms` is the 1-based name table and
`module` is atom 1. Both the pre-OTP 28 table and the OTP 28+ compact table
(negated count, compact-encoded name lengths) are read. `exports`, `imports`, and `lambdas` resolve atom indices to
those names when the table is present; unresolved indices keep `function` or
`module` null.

`code` reports the Code chunk instruction-set, opcode maximum, label count,
function count, and the instruction stream's file range. Missing optional
tables are null, not empty-everywhere.

A zero-byte `AtU8` falls back to an available legacy `Atom` table, following
[OTP 20.3's atom selection](https://github.com/erlang/otp/blob/a113f6117fd696ea6f84ed754055b4ec97a7ccb2/erts/emulator/beam/beam_load.c).
A nonempty `AtU8` retains UTF-8 precedence, including an explicit zero atom
count; malformed nonempty data fails instead of falling back. An empty atom
chunk without an alternate table still fails its required count header.
Absent and zero-byte optional `FunT` chunks produce `lambdas: null`, while a
four-byte zero row count produces `lambdas: []`. This follows
[OTP 29's positive-size lambda parsing rule](https://github.com/erlang/otp/blob/550d7b7898706c7822362c42e7b93120c1d1f29a/erts/emulator/beam/beam_file.c).
Empty payloads retain their ranges and SHA-256 in the chunk inventory. These
rules apply to the last occurrence of each chunk name; an empty final occurrence
does not revive an earlier payload of that name. Nonempty truncated tables remain
format failures.

## Select retained facts

Complete output remains the default. Request a summary with a `beam` view to
read a few facts in the first call while retaining the complete inspection:

```json
{
  "name": "inspect_erlang_beam",
  "arguments": {
    "path": "/artifacts/app.beam",
    "detail": "summary",
    "view": {
      "kind": "beam",
      "collection": "exports",
      "names": ["module_info"],
      "fields": ["function_index", "function", "arity", "label"],
      "limit": 20
    }
  }
}
```

`normalized_result.page.items` contains the matching rows. `source_index` is
zero-based in the original collection and scoped to `parent_evidence_id` and
that collection. It does not replace the original one-based atom `index` or a
lambda's own `index`. Every matching function name survives, including different
arities. Names are exact retained display strings; raw indexes remain available
when names are unresolved or displayed names collide.

Collections are `atoms`, `exports`, `imports`, `lambdas`, and `chunks`. `names`
selects atom/chunk names or function names; imports additionally support exact
`modules`. Filters intersect. `indices` selects original collection indexes;
`fields` selects that collection's own fields. Empty selector arrays match
nothing, and `fields: []` returns only `source_index`. Offset/limit page matching
rows in original order (defaults 0/64). Unfiltered pages slice the retained
collection; queries do not decode the file again.

For `chunks`, `names` matches the four-character IFF chunk tag (for example
`"AtU8"`, `"Code"`, `"ExpT"`); available `fields` are `index`, `name`,
`location`, and `payload`. For `lambdas`, `names` matches the resolved function
name from the atom table; `null` names (unresolved atom indices) are never
selected by a name filter. For `atoms`, `names` matches the decoded atom name
string.

`beam` keeps the module, form/Code bounds, original source coverage, and table
counts. A null count means no table was decoded; zero means a decoded empty
table. Missing tables and unresolved atom names remain explicit, and an empty
page does not establish runtime absence. Page coverage is separate from the
source's examined chunks and parser budgets.

CLI summary delivery requires a destination for the complete Evidence bundle:

```sh
rea inspect-erlang-beam /artifacts/app.beam --detail summary \
  --view '{"kind":"beam","collection":"exports","names":["module_info"],"fields":["function","arity"]}' \
  --evidence_output /reports/app-beam.evidence.json --json
rea inspect-analysis-view '{"source":{"kind":"evidence-file","path":"/reports/app-beam.evidence.json"},"view":{"kind":"beam","collection":"imports","modules":["erlang"]}}' --json
```

The bundle retains the complete report. Subsequent MCP queries may use
`source: {kind: "retained-evidence", evidence_id: parent_evidence_id}` or an
Evidence file. Retained and offline views still work after the original BEAM
file is deleted. Supplying `view` requires `detail: "summary"`; omitting it
returns only the structural summary. Selection changes delivery, not parsing or
coverage, and executes no bytecode.

## Limits and failures

The selected file is limited to 64 MiB by default (512 MiB maximum). At most
64 chunks and 4096 atoms are examined by default, and at most 65536 export,
import, and lambda rows together. Malformed `FOR1`/`BEAM` headers, truncated
chunks, and `AtU8` names that are not valid UTF-8 fail without partial success.

This workflow does not execute bytecode, inflate `LitT` literals, or decode
`Attr`/`CInf` external-term payloads. Complete coverage describes this static
chunk and table report; it does not establish that an Erlang runtime can load
or execute the module.

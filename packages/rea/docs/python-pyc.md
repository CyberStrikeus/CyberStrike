# CPython pyc inspection

`inspect_python_pyc` / `inspect-python-pyc` reports the supported CPython format
and version declared by one selected local `.pyc` file's magic, how its 16-byte
header records source identity, and which nested code objects its decoded
marshal graph contains. It reads the file without running bytecode and requires
no Python installation, active binary target, Hopper, Ghidra, or IDA.

```bash
rea inspect-python-pyc /absolute/path/to/module.pyc --json
```

The CLI resolves relative paths against the caller's working directory. MCP
requires an absolute filesystem path and preserves that exact selection:

```json
{
  "name": "inspect_python_pyc",
  "arguments": { "path": "/artifacts/module.pyc" }
}
```

## Selected code objects

Complete output remains the default. To read selected code objects from a large
report, request MCP `detail: "summary"`. The summary contains artifact/header
identity, source coverage and a limitation count; its
`normalized_result.parent_evidence_id` identifies the complete retained report.
Use that parent ID with `inspect_analysis_view` and:

```json
{
  "kind": "python-pyc",
  "collection": "code_objects",
  "names": ["parse_args", "parse_known_args"],
  "fields": [
    "name",
    "qualname",
    "filename",
    "firstlineno",
    "bytecode",
    "nested_code"
  ],
  "offset": 0,
  "limit": 64
}
```

This is the request's `view` field. To receive these selected facts in the first
call, include the same `view` directly in `inspect_python_pyc` alongside
`detail: "summary"`. Later pages use the returned parent ID with
`inspect_analysis_view`. `view` requires summary delivery; complete delivery
rejects a view instead of ignoring it. `names` matches retained display strings and
returns every same-name object. `indices` selects original `code_objects`
indexes; combining names and indices intersects those selectors. Omitted
selectors include all rows, while `[]` selects none. Each row always includes
`source_index`, scoped to its parent Evidence; `fields: []` returns only that
index. Filtering preserves source order, and paging counts matching rows.
The view's `pyc.coverage` preserves source coverage independently of page
coverage. Views preserve `nested_code` indexes and their code-constant semantics.

CLI summary delivery requires a durable destination for the complete Evidence:

```bash
rea inspect-python-pyc module.pyc --detail summary --evidence_output module.evidence.json --json
```

Add `--view '{"kind":"python-pyc","collection":"code_objects","names":["parse_args"],"fields":["name","bytecode"]}'`
to select facts in that initial CLI call.

The output's `summary` is derived Evidence. Pass its parent ID and the saved
bundle to `inspect-analysis-view --evidence-bundle module.evidence.json` for
offline queries. MCP views read retained Evidence, and offline views read the
bundle; neither requires the original pyc to remain present. Parse budgets and
complete-source retention still apply to summary delivery.

## Observations

The inline Evidence result contains the artifact path, SHA-256, and byte length.
`header` contains:

- `magic`, the 16-bit little-endian field;
- `python_version` and `code_layout`, mapped from the pinned CPython 3.7–3.13
  table (`py37`, `py38`, or `py311`); 3.11 alpha magics before 3494 used
  other code layouts and are unsupported. The 3.7.0a1/a2 magics 3390/3391
  used 12-byte headers and are outside this reader's supported format;
- `flags`, `hash_based`, and `check_source` from PEP 552;
- `source_hash_hex` for hash-based pycs, or `source_mtime` and `source_size`
  for timestamp pycs.

`code_objects` lists each code object reachable in the decoded marshal graph
once, the top-level module code first. This follows CPython container behavior;
it is not an inventory of raw serialized code-object records. `nested_code`
holds the indexes of the distinct code objects reachable from that object's
constants, including code nested in tuples and other containers and the owner
itself when a constant container reaches it.
A function shared through a marshal reference is named by index once per owner,
even when that owner reaches it again through the same container. Relationships
are collected after the marshal graph is complete, so a container that a nested
code object also references is not summarized while its items are still missing.
Each object reports name, optional qualname,
filename, the signed 32-bit `co_firstlineno` value, argument counts, flags,
names, locals (or `localsplusnames` on 3.11+), const
summaries, and bytecode length plus SHA-256.

Code-object equality used by sets and dictionaries follows the selected CPython format:
3.7–3.10 derive `CO_NOFREE` from the free/cell tables for equality, while
3.11+ compare raw flags; raw `co_flags` remain in reported facts. The older
layouts ignore line tables, while 3.11+ include line and exception tables and
skip inline-cache code units according to the cache table for the exact magic.
Reported bytecode length and SHA-256 still describe the original code bytes.
This does not emulate CPython's deoptimization of specialized or instrumented
opcode bytes in handcrafted pyc files.
The artifact SHA-256 identifies the exact selected `.pyc` bytes independently
of this decoded object graph. Reference slots follow each tag's CPython behavior:
singleton values and `TYPE_REF` do not reserve new slots even when their tag
has `FLAG_REF` set.

Reported names are JavaScript display strings; distinct CPython Unicode names
can therefore have the same displayed value and cannot always be reconstructed
from that field alone. Code equality uses the retained marshal string bytes,
while the artifact SHA-256 continues to identify the original file bytes.

Bytecode is not decompiled. Const strings may be truncated in the summary while
the marshal walk still consumed the original bytes; a string summary's `bytes`
is that marshal length. Integer consts report `bits`; their decimal `value` is
`null` above 256 bits. Non-finite float and complex parts use CPython's `inf`,
`-inf`, and `nan` spellings; negative zero uses `"-0.0"` so JSON preserves its
sign. String previews preserve source lone surrogates but never split a valid
surrogate pair at the preview boundary. Dictionary and set lengths follow CPython:
unhashable keys and members fail the walk, equal set members count once, equal
dictionary keys keep the first key object and replace only its value, code
objects are valid keys and members only when all of their consts are hashable,
and a null dictionary value ends the dict without that entry.

## Limits and failures

The selected file is limited to 16 MiB by default (64 MiB maximum). Marshal
object count, nesting depth, and per-string size are bounded; exceeding a
budget fails without partial success. Decode-limit failures are deterministic:
the recovery action names the selected field and CLI option, its effective
value, and its accepted maximum. Raise that field on the next call when the
maximum permits it; waiting for another analysis or increasing host memory does
not raise these controls. Argument counts, positional-only counts,
keyword-only counts, and local counts must be non-negative. `co_stacksize` and
`co_flags` are retained as signed 32-bit source fields when the selected CPython
constructor accepted them. CPython 3.7 and 3.8 alpha constructors through
3.8.0a4 did not reject negative stack sizes or flags; the check was added by
[CPython commit a9f05d69](https://github.com/python/cpython/commit/a9f05d69ccbf3c75cdd604c25094282697789a62).
Magic 3410 is ambiguous: 3.8.0a4 and 3.8.0b1 both use it, but they are on
opposite sides of that constructor change. Negative values under magic 3410
are preserved with an explicit limitation because the header cannot identify
which constructor revision produced them. Magic 3411 and later 3.8 magics were
introduced after that change, so their constructors reject negative values.
The pinned magic entries distinguish these cases; see the CPython
[3.7.0 constructor](https://github.com/python/cpython/blob/v3.7.0/Objects/codeobject.c),
[3.8.0a4 constructor](https://github.com/python/cpython/blob/v3.8.0a4/Objects/codeobject.c),
[3.8.0b1 constructor](https://github.com/python/cpython/blob/v3.8.0b1/Objects/codeobject.c),
and [3.8.0b2 magic table](https://github.com/python/cpython/blob/v3.8.0b2/Lib/importlib/_bootstrap_external.py).
Complete marshal coverage means all fields in the selected file were decoded;
it does not establish that CPython will accept or execute the code object. On
the 3.11+ layout, `co_code` must cover a
whole number of code units. Every layout rejects argument counts that do not
fit the local table CPython checks (`co_varnames`, including `*args` /
`**kwargs`, or fast locals on 3.11+). Those files are malformed, so the
workflow does not report complete coverage. 3.7–3.10 still accept an odd
`co_code`, matching those constructors. Nested code collection walks reference
chains iteratively and keeps one shared descendant list for a container that
merely wraps another, instead of copying that list onto every wrapper. Set and
dictionary keys walk tuple and frozenset reference chains the same way, so a
long `TYPE_REF` chain stays within the call stack. A shared child stored twice
still counts its expanded key against the string budget. Code-object equality
keys record each name table's length and each entry's boundaries, so `()` and
`("",)` stay distinct, and `co_varnames`, `co_freevars`, and `co_cellvars` stay
separate tables. Names repeated through a marshal reference, including each
code-constant name the report copies, count against the file budget once per
copy. Empty strings add no bytes, so every copied
name-table entry (`co_names`, varnames, freevars, cellvars, and
`localsplusnames`) counts against the object budget before its array is built.
Copied constant tables and each reported nested code relationship count
against that same object budget. Integer digits and expanded
set or dictionary keys, including a shared tuple repeated at each level, count
against the string budget. Magics outside the pinned 3.7–3.13 table,
truncated headers, trailing marshal bytes, and a non-code top-level object are
typed failures.

A decoded header does not prove the matching `.py` is present. `python_version`
is the magic table, not a running interpreter. This workflow does not recover
source.

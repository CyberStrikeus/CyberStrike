# SQLite database snapshots

`inspect_sqlite_database` / `inspect-sqlite-database` inspects one explicitly
selected local SQLite database snapshot without an active native analysis
target. Use it to understand application storage, configuration or retained
database evidence. No separate SQLite installation is required.

This operation requires Node.js 24.x >=24.15 or 26+ with the native
`DatabaseSync.limits` API. The worker verifies that capability before querying
the copied database. Other REA features retain their published Node.js 22.x,
24.x or 26+ requirements.

`rea capabilities` reports `inspect_sqlite_database` availability and the
runtime requirement without opening a database. Unsupported runtimes show
`available: false`, `availability_code: "unsupported_version"`, and an upgrade
note while the inventory command still succeeds.

```sh
rea capabilities --json
rea inspect-sqlite-database ./application.sqlite --json
rea inspect-sqlite-database ./application.sqlite --table settings --column key --column value --row-limit 20 --json
```

```json
{
  "name": "inspect_sqlite_database",
  "arguments": {
    "path": "/artifacts/application.sqlite",
    "table": "settings",
    "columns": ["key", "value"],
    "row_limit": 20
  }
}
```

MCP paths must be absolute filesystem paths on the current host. CLI paths
resolve against the operator's working directory. Select a quiescent snapshot:
stop the writer or obtain a consistent database/WAL pair using the application's
backup workflow before inspection. A file copy of a live pair does not establish
an atomic SQLite snapshot, even if no change is detected during inspection.

## Returned evidence

Without a table selection, the default `schema_scope` is `inventory`: compact
table metadata and index, view and trigger names, without SQL declarations or
column details. Selecting a table defaults to `selected_table`, which expands
that table and its indexes and triggers. Explicit `schema_scope: "database"`
(or CLI `--schema-scope database`) expands all stored declarations and supported
columns. `schema.completeness` refers to the reported scope; omitted column
details are marked `not_requested`. SQL declarations retain the original text. Virtual and
shadow tables are identified as such; their supported metadata coverage is
reported. If a virtual table cannot be resolved, possible backing tables have
`kind: "unknown"` and an explicit limitation; their rows are refused. Unrelated
ordinary tables remain selectable. Schema inventory does not execute views,
triggers or arbitrary SQL.

The exact table name `sqlite_schema` is also a supported read-only row source.
SQLite's [`table_list`](https://www.sqlite.org/pragma.html#pragma_table_list)
and `table_xinfo` pragmas establish its row-source type and columns. The
[schema catalog](https://www.sqlite.org/schematab.html) has no self-entry for
`sqlite_schema`, so REA does not invent a declaration, SQL statement or root
page for it in `schema.tables`.

Rows are optional. `table` selects one exact ordinary-table name. `columns`
(CLI repeated `--column`) selects exact visible column names in the requested
order; omission selects all visible columns, including generated columns.
Unselected cells are not evaluated or projected. A selected virtual generated
column whose expression needs a function REA's connection lacks (extensions and
application functions are not loaded), or raises an SQL error for a sampled
row, is refused as `capability_unavailable`. The error names the table and
each failing selected column with SQLite's message, and recommends only columns
whose sampled values were read; stored and other generated cells stay readable. Malformed column-name bytes
cause a format refusal when all columns are requested. In inventory scope, an explicit valid subset can
still be sampled without decoding unrelated malformed column names.

An unavailable row source, including a `WITHOUT ROWID` primary key requiring an
application collation, is also refused as `capability_unavailable`. The error
retains the selected table and SQLite's reason without identifying unproven
dependencies or diagnosing file corruption. Such a source does not provide
readable-column recommendations. Omit `table` and select `schema_scope: "database"`
to read stored declarations without requesting rows; the application's supported
consistent export may be needed to obtain those values.

Column selection requires a
table and at least one name; empty-string identifiers are valid. SQLite counts
every projected name, including a repeated name, against its native
result-column capacity; a wider projection is refused as `resource_constraint`
with `resource: "capacity"`, reporting the selected count and this connection's
column limit. The selected database is readable and is not reported as
malformed; request fewer columns per call instead. `row_limit`
requires `table`, defaults to 20 and accepts positive safe integers. Samples
remain subject to the byte and worker resource limits below, regardless of row count. The result reports
the selected limit, returned count and whether more rows were observed. Row
order is unspecified; a truncated sample does not prove anything about omitted
records. View, virtual-table and shadow-table row reads are unsupported.

SQLite integers are decimal strings so every signed 64-bit value survives JSON
serialization. Real values retain their numbers; `"Infinity"`, `"-Infinity"`
and `"-0"` explicitly preserve infinities and negative zero through JSON.
Text returns the decoded string together with its bytes as hex and the database
encoding, preserving malformed text that the SQLite binding may replace for
display. Blobs are hex, and SQL NULL is a distinct tagged value.

Database and existing sibling `-wal` files have separate original SHA-256 and
byte counts. The Evidence subject identifies the original database file;
the WAL identity is also necessary to interpret pending committed data. The
SQLite engine version is reported with the observed result. Neither digest is
a claim that the database is healthy, complete or trusted.

## Source files and failures

REA copies the selected database and existing sibling WAL to an owned private
temporary directory before SQLite opens them. Source files are not opened by
SQLite, so its locks or shared-memory sidecars cannot modify the original
snapshot. Temporary copies and the owned worker are cleaned up on success,
failure and cancellation. Extension loading and schema trust are disabled.
Empty rollback journals and fully zeroed journal headers left by successful
`TRUNCATE` and `PERSIST` commits are accepted after stable identity checks.
Journal headers are checked both before and after acquisition; unchanged file
metadata alone does not establish that a journal remains inactive.
Other retained rollback journals are refused because recovery is outside this
profile. Journal files are never modified or copied into the worker snapshot.

A provider admits at most two inspections through acquisition, worker execution
and cleanup. Additional requests receive a typed capacity error before reading
files or creating workers; retry after an active inspection finishes. This
bounds simultaneous input buffering and private snapshot/worker counts.

The database and WAL together are limited to 256 MiB. SQLite values/records,
SQL statements and the complete worker JSON reply each have a 16 MiB limit.
Schema names count by their returned JSON text, including escaping, for UTF-8,
UTF-16le and UTF-16be databases. Internal raw-byte lookup keys do not consume
the reply allowance; exact name identity still comes from those stored bytes.
Actual row byte/hex expansion still counts toward the reply.
The owned worker has a 256 MiB JavaScript heap limit and defaults to a 30,000 ms
deadline. Select optional MCP `worker_timeout_ms`, or CLI
`--worker-timeout-ms <milliseconds>`, to change the budget for that call. Values
must be integer milliseconds from 1 to 2,147,483,647 (the runtime timer range).
It covers worker startup, queries and reply writing, **not** DB/WAL snapshot
acquisition, final reply reads, cleanup or delivery. Allow corresponding headroom
in the MCP client's whole-call deadline; increasing only that deadline does not
change the worker budget. No server restart is needed.

The result's `worker_timeout_ms` reports the actual parent-supervised budget,
including the default. Historical Evidence without this field has unknown
execution settings, not an inferred default. Explicit input selection is also
retained in Evidence parameters; omission stays omitted. Completed observations
retained under cancellation or cleanup failure keep the same budget facts.
Timeout errors name the selected milliseconds, exact CLI/MCP controls, and
cleanup-before-retry requirements. Incomplete cleanup remains a blocker even
when a larger budget is available.

For example, `rea inspect-sqlite-database ./application.sqlite
--worker-timeout-ms 60000 --json` selects 60 seconds; equivalent MCP input is
`{"path":"/artifacts/application.sqlite","worker_timeout_ms":60000}`.

SQLite native allocations are separate from the JavaScript heap;
overall native heap and total resident memory are not capped. Row limits do not
override these byte and resource limits. Resource-limit failures do not return
an incomplete schema as successful complete evidence.

If the combined database and WAL exceed the snapshot budget, the refusal is a
`resource_constraint` and reports both the configured byte limit and the exact
observed combined size as a decimal string. The remediation directs callers to
create a smaller consistent offline snapshot containing only relevant data
through the application's supported export workflow. A generic backup or copy
does not guarantee a smaller result; REA does not truncate or modify the
selected source.

On hosts that cannot address the derived WAL or rollback-journal path for a
long selected database name, REA reports that the SQLite capability is
unavailable. It does not assume an inaccessible sidecar is absent. Use the
application's supported consistent offline export or copy workflow to place
the complete known file set at a shorter path.

MCP also applies its configured response budget to the complete Evidence
envelope. If delivery exceeds that budget, it reports a transport constraint
with guidance for exporting retained Evidence, requesting a matching larger
client/server response budget or using complete CLI JSON output.

A cancellation received after the worker has completed does not erase the
completed observation. If subsequent private-root cleanup fails, the error
retains the completed Evidence and the resource owner for cleanup retry. MCP
records that Evidence before delivering the error, which carries its retained
evidence ID for later retrieval or export.

If a worker fails and cleanup remains incomplete, the error retains the original
cancellation, timeout, diagnostic overflow or memory failure. Successful cleanup
retry restores that failure's classification; it does not make the inspection
successful.

Changed input identities, special files, malformed databases, unsupported
formats and resource failures are reported as errors with the selected path and
meaningful reason. Worker resource refusals expose the caller-selected file in
`details.diagnostics.selected_path`. Encrypted databases, database repair, arbitrary SQL,
cross-database queries and live capture are outside this inspection's coverage.

## Compatibility verification

Run `npm run test:sqlite` after changing the SQLite adapter or its shared
process, filesystem, CLI or MCP boundaries. It prepares the compiled runtime
and runs SQLite service, snapshot, inspection, cleanup and public CLI/MCP
tests. Directory-based selection includes new SQLite service and boundary
tests automatically. `npm run test:sqlite:run` runs the same cases when the
compiled runtime and generated test artifacts are already current.

The reusable SQLite CI workflow consumes the shared build artifact and tests
the latest Node 22.x unavailable-runtime diagnostics, the minimum supported
24.15.0 release, and the latest 24.x and 26.x releases. The repository-pinned
runtime also runs the full suite. CI's required gate waits for every selected
SQLite matrix job; a failed, cancelled, skipped or missing selected lane blocks
the gate. Workflow changes themselves select the build and compatibility lane.

PR checks run against GitHub's merge with the current base branch. A later
change to `main` can introduce failures outside SQLite; inspect the failing
job and recheck the updated merge before treating an earlier green run as
current verification. Compatibility checks detect regressions, but cannot
guarantee that an arbitrary future upstream change remains compatible.

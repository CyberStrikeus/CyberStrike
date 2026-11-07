# Godot PCK archives

`inspect-artifact` and `extract-artifact` read ordinary Godot PCK formats 1, 2, 3
and 4 without running the game or requiring Godot. Official Godot 4.4.1, 4.6.1
and 4.7.1 produced formats 2, 3 and 4 respectively in verification; other engine
releases have not been verified. Format 1 compatibility follows the
[Godot 3.5 loader](https://github.com/godotengine/godot/blob/3.5/core/io/file_access_pack.cpp#L201-L242)
and [exporter](https://github.com/godotengine/godot/blob/3.5/editor/editor_export.cpp#L1094-L1164)
layout and is covered by synthetic standalone and embedded fixtures; an actual
Godot 3 export has not been exercised.

Format 1 uses an 84-byte header, no pack or member flags, and absolute member
offsets in the complete source file, including an embedded executable carrier.
Its reported flags and file base are zero because those fields are absent.
Zero-offset removal records remain unsupported; REA does not apply patches.

Inspection retains the original header and directory facts, including engine
version, flags, declared file count, source paths, offsets and declared MD5.
For a member declared as `res://scenes/main.gd`, the occurrence's
`source_path` retains that exact declaration while `logical_path` is
`scenes/main.gd`, the relative path used for lookup and extraction.
Observed plaintext bytes receive content-addressed SHA-256 identities. MD5 is a
container integrity claim, separate from the observed SHA-256. A mismatch fails
by default; `--integrity-policy record-and-continue` retains the observed bytes
and an explicit untrusted contradiction. An all-zero MD5 is an unknown claim,
not a verified digest.

## CLI

Start with a compact summary and keep the complete Evidence bundle:

```sh
rea inspect-artifact /artifacts/game.pck --detail summary \
  --evidence_output /evidence/game.json --json
rea extract-artifact /artifacts/game.pck --json
```

Summary delivery requires `--evidence_output` and never overwrites that file.
The response contains `summary` Evidence and an `evidence_bundle` receipt.
Without `--detail summary`, inspection keeps its complete inline delivery.
Extraction creates a new temporary directory and returns its path. It rejects
unsafe paths and verifies container identity before creating output.

The same CLI commands locate a PCK at the beginning of a file or through its
12-byte EOF trailer in an executable carrier. They do not scan arbitrary
payloads or discover packs behind additional trailing signatures. The root
content SHA-256 covers the whole carrier; its content classification remains
native, while the inventory records the PCK role and exact pack bounds.
An EOF marker is only a candidate: an invalid size or a pointed-to location
without a `GDPC` header leaves native classification in place. Once the
trailer points to a pack header, malformed or unsupported PCK content remains
an error. This recognition boundary follows the Godot loader at pinned source
revision [06d1e7a](https://github.com/godotengine/godot/blob/06d1e7a34ccde4029eed53d018cfde77dfe771d5/core/io/file_access_pack.cpp#L2099-L2146).
Ordinary native `open_binary` detection remains unchanged.

## MCP and selected facts

For a standalone pack, call `open_binary` with its absolute path, then
`inspect_artifact` with `{"detail":"summary"}`. The complete inspection and its
nested inventory stay in the session. Use the summary's
`normalized_result.parent_evidence_id` as the source of subsequent views:

```json
{
  "name": "inspect_analysis_view",
  "arguments": {
    "source": {
      "kind": "retained-evidence",
      "evidence_id": "<parent_evidence_id>"
    },
    "view": {
      "kind": "inventory",
      "collection": "occurrences",
      "logical_paths": ["scripts/main.gd", "project.binary"],
      "fields": [
        "logical_path",
        "declared_integrity",
        "hash_status",
        "format_metadata"
      ],
      "offset": 0,
      "limit": 32
    }
  }
}
```

Occurrences retain `occurrence_id`, `artifact_id` and `parent_occurrence_id`
even when `fields` is empty. Batch occurrence IDs with `occurrence_ids`, or
join returned content IDs to `collection: "nodes"`, `artifact_ids: [...]` and
`fields: ["sha256", "size"]`. Filters intersect; an omitted filter selects all
available rows and an empty array selects none. Pagination follows the filtered
canonical order. Multiple occurrences may share one content ID.

Views reuse authenticated immutable inventory facts and lazy lookup indexes;
they do not reopen the source. These are historical observations, including
after the source changes or disappears. Close the target with `close_binary`
when finished. To read an exported bundle through the CLI, select its complete
inspection record as `source: {kind: "inline", evidence: ...}` in a JSON request
file for `rea inspect-analysis-view request.json --json`.

## Coverage and limits

PCK summaries expose root format metadata, available graph counts,
`available_hash_status_counts`, and `source_coverage`. Inventory pages preserve
producer coverage alongside page coverage. `source_complete` means all declared
retained graph rows are available; it does not establish that an encrypted or
otherwise unknown directory was examined. Missing matches in unknown coverage
are not evidence of absence.

Encrypted directories retain their header and declared file count with unknown
entry coverage. Individually encrypted members retain directory metadata with
unknown content identity; REA does not decrypt them. Sparse bundles likewise
retain header facts with unknown member coverage. Extraction refuses an
unreadable directory or encrypted member. This capability does not recover
keys, decode Godot resources, decompile GDScript bytecode, analyze signals,
apply patch/removal entries or execute targets.

Readable logical member bytes, including repeated physical ranges, share the ZIP
archive expansion policy: at most the larger of 256 MiB or 500 times the PCK's
encoded byte span. Embedded carrier bytes do not enlarge that budget. The full
directory is checked before any member is yielded, hashed or extracted. Encrypted
members are not read and do not consume this plaintext-work allowance. Small
bounded aliases remain valid. This is a processing/output resource bound, separate
from the directory metadata retention budget and format validity.

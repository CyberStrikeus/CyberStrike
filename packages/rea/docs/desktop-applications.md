# Desktop installation directories

Use `inspect_desktop_application` when an installation directory is the target
and its runtime is unknown. It reads directory entries, selected headers and
bounded metadata, then reports runtime candidates, supporting files, component
path markers and concrete follow-up operations. No native provider or active
binary session is needed. It does not run the application, extract archives,
follow child symlinks, contact services or change target files.

## MCP

```json
{ "path": "/artifacts/MyApplication" }
```

Default `detail: "summary"` retains complete source Evidence in the session and
returns candidates with representative supporting paths, counts, coverage,
limitations and grouped next probes. `normalized_result.parent_evidence_id`
identifies the complete record. A server without Evidence retention refuses
summary delivery before reading the target; select `detail: "complete"` to
receive every retained fact inline.

Read exact files in one request:

```json
{
  "source": {
    "kind": "retained-evidence",
    "evidence_id": "ev_<parent-sha256>"
  },
  "view": {
    "kind": "desktop-application",
    "collection": "files",
    "paths": ["Game_Data/Managed/Assembly-CSharp.dll", "GameAssembly.dll"],
    "fields": ["path", "read_status", "ranges", "facts", "issues"],
    "offset": 0,
    "limit": 16
  }
}
```

Collections are `files`, `omissions`, `candidates`, `components` and `next_probes`.
Files and omissions accept exact `paths` and batched `file_ids` / `omission_ids`.
Files also accept `has_issues: true` to select probe diagnostics directly, or
`false` to select rows without reported issues. This filter uses the retained
issue facts; it does not re-read targets or infer that uninspected files are healthy.
When both are supplied, all filters apply; an empty selection returns no rows.
Omission records retain the observed path, kind and stable `omission_id`; their
payloads are not read, and other special-entry metadata remains unavailable.
`candidates` accepts exact `families`.
Omitted selectors match all retained rows; an empty selector matches none.
Every collection supports `fields`, `offset` and `limit`; its stable row ID is
always included. Selection changes delivery, not source inspection. Pages keep
source coverage and parent Evidence links. Page exhaustion does not establish
absence in a partial source. Complete Evidence remains accessible through
`get_evidence_bundle` and Evidence bundle export.

The summary's `probe_issues` counts files with reported issues and their retained
issue entries. It previews at most two such files, including stable `file_id`,
read status and the first issue. Path/reason previews use at most 256 UTF-16 units
each without splitting surrogate pairs; `text_truncated` marks shortened text,
and `preview_truncated` marks additional files. These are display prefixes;
full caller paths and all reasons remain in Evidence. Counts describe retained
observations, while source coverage still identifies partial inspection.

Use `inspect_analysis_view` with `collection: "files", has_issues: true` and
`fields: ["path", "read_status", "issues"]` for exact reasons, with the usual
paging and parent links. It intersects with exact paths and batched file IDs.

An ASAR inventory probe first selects its exact path with `open_binary`; then
call `inspect_artifact` on that active target. Directory inspection itself does
not select or replace the session target. The JavaScript application workflow
accepts its own selected path directly.

## CLI

The one-shot CLI returns complete Evidence by default. For compact output,
explicitly retain it in a bundle:

```bash
rea inspect-desktop-application /artifacts/MyApplication \
  --detail summary --evidence_output /reports/application.evidence.json --json
```

This returns `summary` Evidence and an `evidence_bundle` publication receipt.
Existing output files are never overwritten. Summary delivery requires
`--evidence_output`, checked before analysis. `inspect-evidence-bundle` selects
saved records; an exact saved record can also feed `inspect-analysis-view`.
`--detail complete` returns source Evidence inline and can optionally write the
same bundle. Export writes only the caller-selected output file.

## Facts and uncertainty

| Family       | Evidence used                                                                                                                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| .NET         | A PE optional header declares a nonempty CLI directory.                                                                                                                                                                                        |
| Unity Mono   | A managed assembly below `*_Data/Managed` or `Contents/Resources/Data/Managed` has an exact UnityEngine assembly reference.                                                                                                                    |
| Unity IL2CPP | A recognized IL2CPP metadata magic (with the raw version when complete) coexists with a conventionally named native `GameAssembly.dll`, `GameAssembly.so`, `GameAssembly.dylib` or `libil2cpp.so` image. Build correspondence remains unknown. |
| Godot        | A `GDPC` header at file start or a validated executable trailer offset.                                                                                                                                                                        |
| GameMaker    | A bounded `FORM` container starts with a `GEN8` chunk. The scan probes conventional `data.win`, `game.unx`, and `game.ios` data files for that header.                                                                                         |
| Unreal       | `Content/Paks` path conventions or an IoStore TOC signature; arbitrary `.pak` filenames are insufficient.                                                                                                                                      |
| Electron     | A `resources/app.asar` or `resources/default_app.asar` path convention; archive validity is unverified.                                                                                                                                        |

When the four-byte metadata magic is present but version bytes are incomplete,
the fact retains `raw_version: null`; it does not offer an IL2CPP metadata
inspection probe. A complete magic/version prefix with supported raw version
24, 27, 29, 31 or 39 offers an `inspect_il2cpp_metadata` follow-up at its
admitted file path, including when no native library was found. This probe does
not establish full metadata validity or correspondence to a native binary;
version 24 inspection still applies only to supported header layouts. See
[IL2CPP metadata](il2cpp-metadata.md).

Candidates are derived or inferred from these facts and do not prove loading or
execution. BepInEx, MelonLoader, Easy Anti-Cheat and BattlEye labels identify
path conventions only; runtime presence stays unknown. No bypass is provided.

`file_id` includes the admitted root namespace, recorded path and available filesystem identity. The caller-selected root path and admitted canonical path/root identity are both retained; `local_path` identifies each observed file for follow-up operations. The selected root may be a symlink; child symlinks are not followed. Exact
metadata integers remain decimal strings. Read ranges have offsets, byte counts
and SHA-256 digests; typed facts expose CLI RVAs, metadata/pack versions and
assembly tokens. Directory and symlink identities unavailable from traversal
remain null.

The directory's `snapshot_sha256` commits to retained paths, omission kinds,
available metadata and range digests, composed through the admitted root,
entry and omission identities. Caller ceilings, coverage counters, diagnostic
wording and interpretation facts remain in Evidence, outside source identity.
The same observations under different generous limits share a snapshot digest;
Evidence IDs still preserve request parameters and reported coverage. Different
retained entries or read ranges change the source snapshot.
Omission records share the entry and representation budgets and can be fetched
independently through their view.
**It is not a digest of all file contents.** These are sequential stable entry
observations, not an atomic directory snapshot. Unread bytes remain unknown.

## Resource bounds and reuse

Defaults are 20,000 examined entries and 8 MiB of total probe reads. Callers may
select up to 100,000 entries and 64 MiB. A separate 32 MiB representation
budget bounds retained rows, paths and facts before growth. Each retained path
is charged at the larger of its UTF-16 heap size and its escaped JSON size, so
typical macOS bundle paths fit about 20,000 rows, and control-character paths
fewer. Limits and failed probes produce partial coverage. Traversal and reads
are serial. Each reader admits one inspection at a time; overlapping requests
receive a retryable capacity refusal without cancelling the admitted caller.

Unity reference decoding stops after a witness in each `Data/Managed` directory;
other assemblies' references remain unexamined, while their headers are still
checked. AssemblyRef facts decode names and tokens only; they do not decode or
hash unrelated key/culture/hash payloads or establish runtime binding. Pack contents, encrypted data, metadata/address correspondence and
section-embedded PCKs without a trailer are separate capabilities.

Filesystem results are not cached across calls. Retained views reuse validated
immutable metadata without rescanning files or retaining another inventory.

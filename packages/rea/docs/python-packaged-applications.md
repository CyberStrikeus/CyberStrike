# Python packaged applications

REA statically inventories PyInstaller executables with an appended CArchive.
`inspect_artifact` and `extract_artifact` share the same reader through CLI and
MCP. They read archive bytes without launching the application. Bytecode
source decompilation, encrypted PYZ recovery, zipapp and PEX analysis are outside
this capability.

`extract_artifact.coverage` preserves the inventory producer's source traversal
scope and certainty. Successful publication proves that the selected inventoried
regular files were written and verified; it does not prove that every source
entry was representable or every embedded payload was decoded. For example, a
directory containing an invalid UTF-8 filename can publish its representable
files successfully while coverage remains `unknown`. Extraction retains the
inventory's command provenance and limitations, plus the selected occurrences'
path-qualified derivation notices. A reconstructed `.pyc` header therefore stays
identified as derived bytes in the extraction result.

## Facts and focused queries

The root occurrence's `format_metadata` records the CArchive layout (2.0 or
2.1), archive and cookie offsets, table extent, entry count, raw Python version,
normalized major/minor when known, library name and encryption marker. Member
metadata retains the original name, table index, type, compression flag,
relative offset and known directory record extent. Logical paths follow the
carrier's path dialect: backslashes separate components for PE carriers, while
they remain literal filename characters for POSIX carriers. The source name
always retains its stored spelling in occurrence `source_path` and
`format_metadata.source_name`. For PYZ rows, that source is the exact module or
data key in the PYZ table, not a reconstructed filesystem name;
`format_metadata.container_name` identifies the containing PYZ image. If the
carrier dialect is unconfirmed, REA preserves backslashes verbatim instead of
inferring POSIX semantics.
`relative_offset` is relative to the CArchive start for CArchive rows, or to
the decoded PYZ image for PYZ rows. A CArchive directory record starts at
`archive_start + toc_offset + directory_record_offset`; its size is
`directory_record_size`. PYZ row directory extents remain unknown.
CArchive type `b` retains PyInstaller's executable-member declaration in the
generic `executable` fact; type `x` remains non-executable. This comes from the
archive type code, not the filename or member contents.
Distinct CArchive rows retain their table-index identities even when they
share a logical path. Inventory can preserve both a file and a decoded PYZ
directory at that path, including the PYZ children; extraction refuses a
destination conflict instead of silently omitting those children.

Namespace packages remain metadata declarations at their projected query path;
they do not claim a destination directory. Their `relative_offset` and
`compressed_size` preserve any payload declared by older producers, while
`declared_size` is zero because no bytecode is materialized for a namespace.
Every declared span must end before the PYZ table of contents.
Malformed CArchive TOC rows identify their zero-based table index and byte offset
within the TOC, including truncated headers, invalid names, compression flags,
and type codes. The failure retains its original format reason.
PYZ `compression_flag` is derived from storage: nonempty payloads are compressed,
including legacy namespaces; an empty namespace has no compressed payload.

CArchive type `o` entries are runtime options. They are metadata occurrences,
with no content artifact or extractable file. Their query paths are
`__pyinstaller__/runtime-options/<table index>`; the option text is
`format_metadata.source_name`. Repeated declarations retain distinct occurrence
identities. These paths do not claim output filesystem names.

Type `d` entries are multipackage dependencies. They are also metadata, under
`__pyinstaller__/dependencies/<table index>`, and never materialize an empty file.
The reader preserves the raw reference and splits its first colon into
`dependency_archive` and `dependency_member`. `dependency_status` remains
`unresolved`, or `invalid-reference` with unknown parts for malformed references.
`external_dependency_count` summarizes these declarations. REA does not open
another executable or claim its contents are available. A real file with the
same logical path as metadata remains independently extractable.
Both declaration types require empty payloads and no compression. Their query
paths do not participate in filesystem collision checks, directory ancestry or
source-map target lookup; their parent identifies the declaring container.
Complete authenticated inventory page sets preserve producer identities in any
merge order, including metadata/file aliases. Malformed TOC diagnostics name the
table index; original names remain available in the supplied artifact.
Path failures use bounded escaped previews and report the original length;
accepted paths and retained source names are not shortened.

`compare_artifacts` compares these node-less records as declarations using the
container, container name, source name and type code. Equal option or dependency
declarations can therefore compare unchanged without implying that an external
dependency's bytes were found. For materialized PyInstaller members, the same
fields participate in the metadata delta independently of content identity;
archive offsets and table positions remain location facts, not declaration
identity. Missing declaration facts and unavailable non-metadata content remain
unknown.

Request `detail: "summary"` for a compact inspection, then query retained
Evidence with `inspect_analysis_view`. An inventory view can select
`collection: "occurrences"`, `entry_kinds: ["metadata"]`, exact logical paths or
occurrence IDs, requested `fields`, and `offset`/`limit`. Filters intersect;
identities, parent Evidence and coverage survive projection. Full inventory
Evidence remains available for export. A compact reply reduces returned context;
it still performs the complete member inventory and hashing work.
Focused views add calls and tool-schema costs. A complete small inventory can
cost less overall; prefer compact delivery when the full member graph would
overwhelm the answer.

```bash
rea inspect-artifact /absolute/path/hello --detail summary --evidence_output /absolute/new/evidence.json --json
rea extract-artifact /absolute/path/hello --json
```

## Decoding and evidence limits

Inventory hashes members individually through bounded streams. Stored PYZ
images use descriptor ranges; outer-compressed images stream to private files,
which the reader owns through cleanup and any cleanup retry. Extraction binds
the selected carrier to its inventoried digest and checks source identity and
state before and after reading. It does not retain expanded module bodies.
Opaque outer-compressed images reuse that verified private image when opened,
instead of inflating the carrier again. Direct source spans describe stored
CArchive bytes; decompressed content has no direct span even when its encoded
and decoded sizes coincide. Original offsets and compression remain metadata.

Only the PYZ header and marshal directory are loaded for listing. PYZ tables
have a 16 MiB budget; CArchive tables have a 32 MiB budget. Parsed facts have a
32 MiB serialized budget. Projected entries share a 64 MiB retained budget,
including metadata, bookkeeping and conservative reservations for namespace
objects and possible case-collision annotations at each path component. These
reservations happen before normalization or trie allocation.
Outer-compressed PYZ images have a separate per-reader capacity of 128 private
files, bounding retained inodes and image identities. The complete image count
is admitted before any temporary file is created; excess images return a
capacity failure. This is a resource policy, not a PyInstaller format limit.
Artifact errors retain this distinction as `details.boundary: "capacity"`, with
the actual allowance in the diagnosis and `details.detail`. Changing output
detail does not reduce that allowance's input scope; these operations do not
select a narrower member path during inventory.
Only a zero-byte read establishes EOF; short successful descriptor reads fill
the bounded range. Compressed members must consume their complete declared
input span; trailing junk and concatenated streams are refused.
Plaintext expansion has an aggregate archive-derived budget. Exceeding a budget
returns a resource failure.

Supported final Python bytecode magic values cover Python 3.7 through 3.14.
Supported marshal directory values are lists, tuples, strings, integers and
bytes, including interned Unicode strings used for module names. Unicode strings
use CPython's UTF-8 `surrogatepass` encoding, preserving lone surrogate code
points in decoded module names. Directory values follow the identified CPython marshal semantics; for
example, a long integer with a zero most-significant digit is malformed and is
not normalized into a valid table value. An unsupported magic or malformed or
unsupported directory stays an opaque member with a limitation and
`pyz_status: "opaque"`; no child entries from that table are projected, and
their module contents remain unknown. The original PYZ member and its digest
remain available independently. Healthy CArchive siblings are still inventoried.
Any opaque PYZ makes producer traversal coverage unknown, including retained
summaries and exhausted queries. Per-archive reasons remain on the opaque
occurrences; the coverage observation summarizes their count without repeating
every limitation. An empty result does not establish module absence.
Observed `pyz_python_magic` bytes remain available even when their Python version
is unknown.
The directory declares compressed module lengths, so uncompressed declared
sizes and source spans inside decoded data remain unknown.

PYZ modules receive a derived 16-byte `.pyc` header from their own supported
magic. CArchive scripts receive that header only when every sibling PYZ magic
and the cookie's Python version agree. Under the same agreement, CArchive
modules (`m`/`M`) receive a header only when their decompressed prefix identifies
headerless marshal code. Legacy modules that retain a `.pyc` header, and modules
whose prefix is unrecognized, preserve their original bytes and report
`bytecode_header: "unknown"`. A header prefix does not establish that the entire
file is valid. `bytecode_magic` and graph derivation edges identify synthesized
headers; member digests cover the resulting derived files. These headers do not
establish successful execution or decompilation.

The nonempty CArchive Python module `pyimod00_crypto_key` (`m`/`M`) is recorded
as an encryption marker; a same-named data file or script is not. Affected
PYZ blobs are reported without decoding; extraction refuses encrypted entries.
The raw PYZ container remains readable and hashable, including when its module
table is opaque. Its marker stays in metadata and opaque child coverage stays
unknown; extracting the container does not decrypt its payloads.
The marker also applies to nonempty legacy namespace payloads. Empty namespaces
have no payload to encrypt and retain a null encryption source.

Detection searches the last 16 MiB for a cookie, allowing a trailing macOS code
signature within that bound. Member offsets are relative to the archive start:
cookie position plus cookie size minus package length. Native bootloader
analysis remains available through the native tools.

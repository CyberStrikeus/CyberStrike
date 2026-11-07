# .NET single-file bundles

Use `rea inspect-artifact /absolute/path/host --json` to inventory an ordinary
.NET single-file host and `rea extract-artifact /absolute/path/host --json` to
materialize its members into a fresh, REA-owned output directory. With a host
selected through `open_binary`, the corresponding MCP tools are
`inspect_artifact` and `extract_artifact`. No .NET installation is needed for
inspection or extraction.

For a compact inventory, call `inspect_artifact` with `detail: "summary"`,
then use `inspect_analysis_view` with the returned `parent_evidence_id`.
Inventory occurrence pages accept `logical_paths`, `occurrence_ids`, selected
`fields`, `offset`, and `limit`; node pages accept batches of `artifact_ids`
to retrieve expanded-byte digests. Include `format_metadata` and
`source_location` when member declarations and stored extents matter. Identity
fields survive projection, and the complete inspection Evidence stays retained.

REA detects the apphost marker and its preceding header offset from PE, ELF,
and thin Mach-O bytes, regardless of filename. An unbundled apphost's zero
offset remains an ordinary native artifact. Universal Mach-O slice inventory
keeps its existing behavior; bundled contents inside slices are not expanded.
When a native file has a recognized PyInstaller CArchive, apphost-marker
scanning stops before its payload. A .NET helper stored inside that archive
does not replace the outer container's format; an outer .NET host can still
contain a PyInstaller helper as a member.

## Supported layout

| Header | Producer generation                | Member encoding             |
| ------ | ---------------------------------- | --------------------------- |
| 1.0    | .NET Core 3.x                      | Uncompressed                |
| 2.0    | .NET 5                             | Uncompressed                |
| 6.0    | .NET 6 and later using this layout | Uncompressed or raw DEFLATE |

Versions, minor versions, and flags outside this set are refused explicitly;
they do not silently become an ordinary PE or a successful empty inventory.
Flags 0 and the v2+ compatibility flag 1 are admitted. Unknown file-type bytes
are retained with a limitation, rather than treated as executable authority.
Encrypted/protected wrappers and recovering their payloads are outside this
reader's scope.

The host keeps its whole-file SHA-256. Each embedded file gets its expanded-byte
SHA-256, path, declared size, compressed size, and `format_metadata` declaration
(`major_version`, `minor_version`, `file_type`). Its `source_location` describes
the stored host extent, including the compressed length when applicable.
The root manifest's `root_format` is `dotnet-bundle`; the root content node
still records its native PE/ELF/Mach-O format. A file-type declaration or `.dll`
suffix does not establish a valid assembly. Inspect an extracted component
explicitly with the managed tools to establish PE/CLI facts.

## Admission and containment

Metadata is range-read with a 64 KiB cache. Policy budgets are 16 MiB of
manifest metadata, 100,000 files, 64 KiB per UTF-8 string, 512 MiB of stored or
expanded bytes per file, 256 path parts per member, 250,000 distinct in-memory
path-tree nodes, and 2 GiB of aggregate expanded bytes. The node budget counts
shared directory prefixes only once. These are REA
resource policies, not limits imposed by Microsoft's format. Marker scanning
streams 64 KiB chunks and reuses completed probe facts during extraction;
ordinary native files without a marker incur one extra
read pass before host hashing.

Extraction hashes the whole host again through the same descriptor used to read
members and compares it with the inventory's root digest before creating an
output directory. This adds a full-host read pass to extraction, including when
the embedded members themselves are small.

Malformed/truncated headers, unsafe or conflicting paths, overlapping member
ranges, members crossing the manifest, contradictory configuration extents,
invalid UTF-8, corrupt/trailing compressed data, and incorrect expanded sizes
fail before output publication. Source descriptor/path identity is checked
during reading; extraction verifies the host digest and member bytes against
the inventory. Existing output roots are never overwritten. Cancellation and
failures release owned streams/descriptors through the shared extraction
rollback scope.

## Reproduce producer fixtures

The source-owned generator uses the installed .NET 8 SDK's **Microsoft
HostModel** producer to emit x64 v1, v2, plain v6, and compressed v6 bundles
for Windows, Linux, or macOS. It does not run generated hosts or download runtime packs. Supply an
SDK apphost template from
`packs/Microsoft.NETCore.App.Host.<rid>/<version>/runtimes/<rid>/native/apphost`
(`apphost.exe` on Windows). Pass `windows` (the default), `linux`, or `osx`
as the optional third generator argument to match that template.

```bash
dotnet build scripts/fixtures/dotnet-bundle/BundleFixture.csproj -c Release --configfile scripts/fixtures/dotnet-bundle/NuGet.Config -o /absolute/path/producer -p:BaseIntermediateOutputPath=/absolute/path/producer-obj/
dotnet /absolute/path/producer/BundleFixture.dll /absolute/path/apphost.exe /absolute/path/absent-bundles-directory
rea inspect-artifact /absolute/path/absent-bundles-directory/net8-compressed/Probe.exe --json
rea extract-artifact /absolute/path/absent-bundles-directory/net8-compressed/Probe.exe --json
```

The generator writes `oracle.json` beside each host. An independent C#
`BinaryReader`/`DeflateStream` pass records version, member types and stored
extents, then compares every expanded member digest with its source file.
Compare those records with inspection Evidence and the extracted bytes.
This verifies Microsoft's compression writer separately from synthetic parser
fixtures; it is not evidence that the bundled host executes on a target runtime.

Deterministic boundary and public-entrypoint coverage:

```bash
npm run test:focused -- tests/boundary/filesystem/dotnetBundleArtifacts.test.ts tests/acceptance/dotnetBundleJourney.test.ts
```

Layout references: Microsoft's [manifest writer](https://github.com/dotnet/runtime/blob/v8.0.22/src/installer/managed/Microsoft.NET.HostModel/Bundle/Manifest.cs),
[file entry writer](https://github.com/dotnet/runtime/blob/v8.0.22/src/installer/managed/Microsoft.NET.HostModel/Bundle/FileEntry.cs),
[apphost marker handling](https://github.com/dotnet/runtime/blob/v8.0.22/src/installer/managed/Microsoft.NET.HostModel/AppHost/HostWriter.cs),
and [compression producer](https://github.com/dotnet/runtime/blob/v8.0.22/src/installer/managed/Microsoft.NET.HostModel/Bundle/Bundler.cs).

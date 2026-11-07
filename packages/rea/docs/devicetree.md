# Flattened devicetree inspection

`inspect_devicetree` / `rea inspect-devicetree` reads a local DTB without an
engine, target execution or external tools. It supports FDT versions 16 and 17;
other versions return `unsupported_target`. Corrupt recognized blobs return
`invalid_request`, and exhausted budgets return `resource_constraint` without
partial success.

```bash
rea inspect-devicetree /artifacts/board.dtb --json
rea inspect-devicetree /artifacts/board.dtb --detail summary --evidence_output /artifacts/board-evidence.json --json
```

The complete Evidence includes the artifact SHA-256, validated header fields,
64-bit memory reservations as exact hexadecimal strings, and a flat node tree
with explicit parent paths. Each property retains its file offset, byte length,
and up to 256 raw bytes as hex. `truncated` qualifies the preview only; parsing
coverage includes the entire declared tree. Version 16 has no declared structure
size, so `header.size_dt_struct` is null.

Derived fields carry `confidence: derived`: standard ASCII string lists, scalar
phandles and cell counts, and `reg` tuples using the parent's `#address-cells`
and `#size-cells` (defaults 2 and 1). Zero-cell components are null (omitted), distinct from an encoded zero. Cell
counts above four, invalid counts and incomplete tuples remain undecoded with a
limitation. Addresses are bus-local; no `ranges` translation is attempted.
Invalid or ambiguous strings remain raw, rather than being guessed.

The summary is labeled derived and includes root compatible/model, chosen
bootargs/stdout-path and aliases. An undecodable alias retains its name with a
null path; it is not silently treated as absent. Single-cell `interrupt-parent`, `remote-endpoint` and `msi-parent`
references resolve through phandle declarations. Missing or duplicate targets
have null target paths. A node whose `phandle` and `linux,phandle` disagree
adds a limitation, and references to either value stay unresolved. A present
`phandle` that is not one cell also adds a limitation; `linux,phandle` cannot
resolve that node when the canonical declaration is malformed. Binding-specific
reference arrays and overlays are not resolved; an empty reference list does not
prove absence of hardware links.

MCP `detail: summary` retains complete Evidence in the session. Follow its
`parent_evidence_id` with `inspect_analysis_view`:

```json
{
  "source": { "kind": "retained-evidence", "evidence_id": "ev:<digest>" },
  "view": {
    "kind": "devicetree",
    "collection": "properties",
    "path": "/serial@1000",
    "offset": 0,
    "limit": 32
  }
}
```

Collections are `nodes` (identity and property counts), `properties` (requires an
exact node path), `reservations`, and `references`. Pages use retained parsed
facts and do not reopen the file. Each page carries fixed-size context
(artifact, header, coverage and counts) rather than the summary strings, so a
large `bootargs` value does not repeat on every page. Source indices are scoped to the selected
collection and parent Evidence; property indices are scoped to their node.

| Input budget     | Default | Ceiling |
| ---------------- | ------: | ------: |
| `max_file_bytes` |   4 MiB |  16 MiB |
| `max_nodes`      |   8,192 |  65,536 |
| `max_properties` |  32,768 | 262,144 |
| `max_depth`      |      64 |     256 |

Decoded names, paths, values and row overhead share a fixed 32 MiB representation
allowance, charged before expansion. It has no runtime override.

The reservation count also uses `max_properties`. CLI flags use kebab case,
for example `--max-nodes 16384`. View pages contain at most 256 rows.

## Verification

Synthetic tests cover v16/v17, malformed headers/blocks/names/tokens, resource
limits, derived values, and CLI/MCP delivery including retained pages after
removing the input. The optional real lane requires **dtc 1.8.1**:

```bash
npm run build:cached
node scripts/verify/firmware/devicetree.mjs
```

It compiles a DTS with reserved-memory, chosen, aliases and phandles, compares
REA's node paths against `dtc -I dtb -O dts`, and checks the derived report.
`REA_DTC_PATH` selects the verification executable; it is not runtime setup.

The dtc 1.8.1 lane ran on macOS arm64 with Node 26.5.0. Its seven node paths
matched the decompiled tree. The report included `model: "REA DTB verification"`,
`bootargs: "console=ttyS0"`, alias `serial0 -> /serial@1000`, reservation
`0x80000000 + 0x1000`, and a resolved reference from `/consumer` to
`/serial@1000`. The deliberately minimal remote-endpoint fixture produces dtc
graph-binding warnings; this lane verifies FDT structure and selected property
derivations, not hardware-binding validity.

A repeat run of that complete compile/decompile/CLI verification took 2.13 s
elapsed, 1.52 s user CPU and 0.27 s system CPU under `/usr/bin/time -l`. This is a
small fixture with warm filesystem caches, not a cold-start or large-board
benchmark. Peak process-family memory and whole-workflow token usage were not
measured; the sandbox denied the memory-reporting system query. No pre-feature
equivalent REA workflow exists for comparison. The pinned Node 24.22.1/npm
11.16.0 toolchain was unavailable; dependency installation used the local cache
with Node 26.5.0/npm 12.2.0 instead.

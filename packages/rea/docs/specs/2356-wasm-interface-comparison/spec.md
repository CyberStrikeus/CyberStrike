# Core WebAssembly interface comparison (#2356)

## Outcome and scope

Compare two exact authenticated `inspect_wasm_artifact` Evidence inputs, inline
or retained session references, under required `scope: imports | exports | both`.
No module acquisition or execution occurs during comparison. This is a derived
workflow within existing WABT inspection authority, not a new provider.

Producer-owned typed `interface` facts are additive and optional in historical
inspection Evidence. WABT's validated canonical WAT owns decoding; exact original
forms and names remain available. Comparison never reparses retained display text.
Function/tag signatures resolve type uses; memory page size defaults to 65536 bytes and explicit custom page sizes are retained; table/memory limits and global types
are compared exactly. Unsupported type/proposal forms remain unknown rather than
being compared by raw text or inferred compatible. Names are exact decoded UTF-8,
without normalization, including empty names, escapes, punctuation and BOM.

## Comparison contract

Return both Evidence IDs and original artifact path/digest/length. Group imports
by exact module/name and exports by exact name, independently of kind, so a kind
change is reported as changed. Unique admitted signatures yield added, removed,
changed or unchanged. Duplicate keys retain every original occurrence and yield
unknown; no Cartesian pairing or deduplication. Missing historical facets and
incomplete inventories prevent absence claims. Unknown signatures do not erase
independently observed entries. Ordering is deterministic by direction and names.

Both subject digest/path and inspection parameters must match normalized artifact
identity. Authenticate Evidence before projection; summary Evidence must be
resolved to its retained complete parent by the caller. Report unknown coverage
and explicit limitations. Exact static equality is not runtime compatibility,
ABI compatibility, linking success or source identity.

## Authority and overlap

Reads supplied Evidence only. MCP records derived Evidence through the existing
handler/ledger; CLI accepts portable inline Evidence from an explicit JSON input.
No new provider, implicit fetch, target mutation or foreign-code execution.
PR #2406 (head 86865035) adds component inspection, preamble routing and embedded
core-module inspection. Its component parser is not required or duplicated here;
shared contract/CLI registration changes remain additive. Core GC/recursive types
are outside admitted signature semantics and keep unknown mappings.

## Resource admission

Typed producer rows, names and declaration tokenization are admitted before
allocation against the existing 32 MiB WABT output representation capacity.
Comparison uses linear grouping and cooperative transport yields; it never
builds Cartesian duplicate pairings. CLI JSON input retains the shared file
admission gate. Token usage and peak process-family memory remain unmeasured.

## Verification

Original owned modules assembled using WABT 1.0.42 cover semantically equivalent
encodings, changes of kind/signature, names/duplicates, imported index spaces,
tables/memory/globals/tags, unknown types and historical incomplete Evidence.
Exercise authenticated identity, cancellation, retained lookup, CLI/MCP parity
and advertised schemas. Run focused existing WASM/Evidence tests, repository
checks and docs validation; independent subagent review before handoff.

Format reference: https://webassembly.github.io/spec/core/binary/modules.html

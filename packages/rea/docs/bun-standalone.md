# Bun standalone executables

`inspect-artifact` inventories embedded Bun module graphs in Mach-O `__BUN,__bun`,
PE `.bun`, ELF `.bun`, and appended trailers. `extract-artifact` writes their stored
module contents through the existing safe output tree. Neither operation executes
the executable or decompiles bytecode.

```sh
rea inspect-artifact ./hello --json
rea extract-artifact ./hello --json
```

In MCP, open the executable with `open_binary`, then call `inspect_artifact`.
Use `detail: "summary"` for large graphs and `inspect_analysis_view` to page retained
Evidence. The root metadata's `entry_point_logical_path` is the reader-owned
location of its entry module. Use it as an inventory `logical_paths` filter,
then read selected node fields with the returned content identity. This also
works for names mapped to indexed extraction paths. The complete Evidence stays
retained; no source-name normalization is needed in the caller.

The root reports the carrier, layout, module count, entry point, raw flags and
compile exec-argv. Each module retains its source name, loader and encoding values,
entry-point status, sizes and SHA-256. Sourcemaps, bytecode and module-info regions
are separate children. Source names such as `/$bunfs/root/main.js` remain in
metadata; extraction uses a relative path. Unsafe or non-UTF-8 names receive an
indexed path and retain their source spelling or bytes. Virtual names deeper
than 256 logical path parts also use an indexed path with an explicit limitation,
preventing unbounded path-tree work while retaining the source fact. Duplicate names remain
separate occurrences; ordinary extraction collision rules apply.

The recognized record shapes are the 36-byte Bun 1.3.3 layout and the 52-byte
Bun 1.3.9 layout. These labels identify structural layouts, not a detected compiler
version. Bun does not store an explicit revision identifier: unknown table sizes
and ambiguous known layouts are unsupported. A future layout that is byte-for-byte
compatible cannot be distinguished. Invalid pointers and truncated claimed sections
are malformed. An absent trailer without a named section does not establish a Bun
graph. Unknown enum values remain raw, with a null name.

Sourcemaps are stored Bun regions, not necessarily standalone JSON source maps.
Extracted contents retain their original encoding. Use JavaScript analysis only on
compatible source files; bytecode is retained as evidence, not decoded.

Module parsing reads exact metadata ranges rather than loading stored asset
bodies or whole pages around small pointers. A cache retains at most 256 KiB
and 1,024 ranges for one reader preparation. Cumulative uncached metadata reads
are limited to 256 MiB, checked before allocation or I/O. The module table,
decoded strings and combined logical path tree have separate admission checks;
at most 250,000 distinct path prefixes are admitted before inventory construction.
Stored bodies are range-streamed for hashing and extraction. Header/suffix observations are reused
only for the same admitted file state, with selected-path checks before publication.

See [limits and recovery](design/limits-and-recovery.md) for admission ceilings.
Synthetic tests cover the carriers and malformed declarations. Run
`node scripts/verify-bun-standalone.mjs` after `npm run build:cached` for local Bun
verification, and add `--docker` to compile a Linux fixture with `oven/bun:1.4.0`.
Bun and Docker are fixture producers only and are not installed by REA.

Layout references: [Bun 1.3.3 serializer](https://github.com/oven-sh/bun/blob/bun-v1.3.3/src/StandaloneModuleGraph.zig)
and [Bun 1.3.9 serializer](https://github.com/oven-sh/bun/blob/bun-v1.3.9/src/StandaloneModuleGraph.zig).

The current 52-byte record order can also be checked in the
[Bun 1.4.4 Rust serializer](https://github.com/oven-sh/bun/blob/bun-v1.4.4/src/standalone_graph/StandaloneModuleGraph.rs).

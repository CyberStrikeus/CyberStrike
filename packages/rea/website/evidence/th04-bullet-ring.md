# TH04 aimed-ring evidence

This case examines one helper in the Japanese PC-98 DOS TH04 (Lotus Land Story)
reconstruction. Source and historical compiler checks are pinned to
`0d72e9801a5c14c10384efcbb6734ceccb74ee63` in
[N0zoM1z0/th04](https://github.com/N0zoM1z0/th04). The page adds a fresh inspection
of the supplied original target through REA on 7 October 2026.

## Original target and analysis

- Target: `MAIN.EXE`, 156,258 bytes, DOS MZ, x86 real mode.
- SHA-256: `077440a3c4e9ab52e72e9bae411276c47edc11995b5c2b83dfc83fbc039dc58b`.
- Header: 6,144 bytes (`0x1800`); module: 150,114 bytes; relocations: 1,136.
- Connected analysis: published REA 4.1.0, Ghidra 12.1.4, Linux x64.
- The connected runtime's 761 files under `dist`, `bridge` and `scripts` match
  the cached published REA 4.1.0 package byte for byte.
- Load-image profile: `MzLoader`, `x86:LE:16:Real Mode`, compiler `default`,
  fixed load segment `0x1000`, linear byte addresses.
- Profile digest: `0d7ec8473c44e8d0a979c0308f7260b7572866613a369c30550026c81beff0e9`.
- Helper: `bullet_velocity_and_angle_set`, REA entry `0x2cfc8`, original
  file offset `0x1e7c8` (124,872).

The executable's identity passes the reconstruction manifest and MZ checks. Its
manifest provenance is `candidate-local-attested`; no independent pristine-dump
claim is added. Windows is an emulator or port host here, not this executable's
format.

## Fresh REA requests

1. `open_binary` binds the original target with provider `ghidra`. The displayed
   input is compact: its local path is shortened to `MAIN.EXE` and the explicit
   provider selection is omitted from the product narrative.
2. `inspect_native_load_image {}` returns `status: verified`, header 6,144,
   module 150,114, and load segment 4,096. Every returned check matches.
   Evidence: `ev_dc53b8af38910ed3dc40b29dc003110b79842957d6f8ab7da8737847a4b4d3fb`.
3. `analyze_function {"procedure":"0x2cfc8"}` returns instructions, pseudocode,
   callers, callees, data references and complete reported function-body ranges.
   Evidence: `ev_d79b6834ff615b5b59df1e31f3ba01c32491582ddfd4f9383c6f05d83b59f77d`.
4. `address_to_file_offset {"address":"0x2cfc8"}` returns original file offset
   124,872. Evidence:
   `ev_aae51edacb1a224d1b52ecccc4c43f506f28b3216f255d05fb07efdfaf10eb4b`.
5. `read_bytes {"address":"0x2d0eb","length":19}` returns all 19 requested
   bytes: `8bc6c1e0088a16af53b60052995bf7fb8946fe`. They match the original
   target at file `0x1e8eb`. Evidence:
   `ev_d984b3df53cc8cd63c0b7bdfdf8822d84f0ea594c3c10c00419ed9f8d4036108`.

The selected helper comes from the project's reviewed source boundary. The
example prompt is an invitation to the reader's agent, not a transcript or a
claim that this inspection independently discovered every source owner.
The ephemeral REA session was closed after these queries. The original
executable and the reconstruction's saved database were not modified.

The returned function body is noncontiguous: `0x2cfc8..0x2d14f` and
`0x2d15e..0x2d1cc`, 503 body bytes across a 517-byte enclosing span. The page's
selected ring, aim and store instructions lie within those reported ranges.
The historical project reconciles the omitted 14 bytes with raw decoding and
reviewed compiler ownership; the page does not claim REA reported a contiguous
517-byte body.

## Instructions and source meaning

| REA instruction evidence                                                                               | Meaning supported by the maintained source                      |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `0x2cfcf: MOV SI, word ptr [BP + 0x4]`                                                                 | Group-member index                                              |
| `0x2d0ed: SHL AX, 0x8` followed by count load and `IDIV BX`                                            | `(index * 256) / count`, multiplication before integer division |
| Coordinate loads/subtractions at `0x2d18d..0x2d198`, far call at `0x2d19d`, then addition at `0x2d1a2` | Add `iatan2(player - origin)` for an aimed ring                 |
| `0x2d1bc: ADD AL, byte ptr [0x53ad]`                                                                   | Add template rotation                                           |
| `0x2d1c0: MOV [0xbcc8], AL`                                                                            | Store the final byte angle, wrapping at 256                     |

Assembly is transcribed verbatim from the fresh REA result. Short request/result
panels select instructions, while the five-step comparison retains the complete
19-byte ring quotient sequence. The names `count`, player/origin fields,
`iatan2`, template rotation and spawn angle come from the maintained source and
reviewed original reconstruction, not recovered original symbols.

The readable `aimed_ring_angle` function is explanatory C++, not the
compiler-sensitive complete helper or the source compiled by historical checks.
The ring macro display expands its TH04 branch and removes preprocessor
continuations for reading. The source labels and details distinguish those
summaries from linked complete source.

Real-mode near-call segment aliases can produce misleading static call edges.
The case uses instruction/data anchors and the project's reviewed source
relationships, not a claim of automatically verified whole-program call flow.

## Figure

The SVG draws sixteen directions using `index * 256 / 16`. The left ring has
zero aim, zero rotation; the right adds illustrative player direction 40 and
keeps zero rotation. The clockwise coordinates match the source's byte-angle
contract: right 0, down 64, left 128, up 192. The highlighted first ray points
at the illustrated player; every subsequent ray retains the same 16-unit step.
This is a mathematical diagram, not captured game output.

Elly's real source initially requests `BG_RING_AIMED`, count 16 and angle 0,
then calls `bullet_template_tune`. The page preserves that tuning call and
labels the figure's count explicitly; it does not claim every difficulty or
performance state emits sixteen bullets.

## Recorded compiler validation

The linked semantic-bullet note records two isolated cold builds on
3 October 2026 of owner `th04-main-module-th04-bullet-a-cpp-1cc33`, using the
pinned Turbo C++ 4.0J/TASM/TLINK toolchain. Both reproduce the complete
2,139-byte (`0x85b`) original extent starting at file `0x1e433`, plus exact MAP
contribution and overlapping relocation. Target and candidate slice SHA-256:
`f7dfaeae5b18749d6687a94139488a825f86f00b85a4eb4072985223a5f1cc5e`.

The retained receipt was read from the project's archive into private scratch
storage. Receipt SHA-256:
`76a361da712d8203f410068df0a864192ecdb64671e173ea15db358796b71e49`.
Its digest matches the archive manifest. It reports `pass: true`, no failures,
and both builds have `raw_exact`, `map_exact`, `relocations_exact` and
`object_valid` true. Recorded input snapshots match the current `add.cpp`,
`add_impl.hpp` and `types.hpp` bytes. No fresh compiler build or ledger
promotion was needed for the website update.

Public evidence reference: `ev-th04-semantic-bullet-exact-v1236` in the TH04
evidence ledger. The matching extent contains the full helper and surrounding
bullet-add functions; it is not a whole-executable or full-game equivalence
claim. The original reconstruction used project-specific analysis and replay
scripts. Its source and compiler evidence are credited separately from the
fresh REA inspection.

## Public source anchors

- [Ring macro](https://github.com/N0zoM1z0/th04/blob/0d72e9801a5c14c10384efcbb6734ceccb74ee63/src/main/bullet/add_impl.hpp#L4).
- [Complete angle helper](https://github.com/N0zoM1z0/th04/blob/0d72e9801a5c14c10384efcbb6734ceccb74ee63/src/main/bullet/add.cpp#L292).
- [Aim and velocity](https://github.com/N0zoM1z0/th04/blob/0d72e9801a5c14c10384efcbb6734ceccb74ee63/src/main/bullet/add.cpp#L422).
- [Angle representation](https://github.com/N0zoM1z0/th04/blob/0d72e9801a5c14c10384efcbb6734ceccb74ee63/src/main/bullet/types.hpp#L6).
- [Elly's firing template](https://github.com/N0zoM1z0/th04/blob/0d72e9801a5c14c10384efcbb6734ceccb74ee63/src/main/boss/elly_phase_ring16.cpp#L26).
- [Compiler checks](https://github.com/N0zoM1z0/th04/blob/0d72e9801a5c14c10384efcbb6734ceccb74ee63/docs/reconstruction/product/TH04_SEMANTIC_BULLET_GENERATION_V1236.md#validation).

Original executables, game assets, complete raw Evidence, machine paths,
account/configuration details and private compiler products remain outside
the website.

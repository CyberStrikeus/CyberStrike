# Static CUDA and HIP code objects

`inspect_gpu_code_objects` answers which GPU targets and kernel declarations a
local artifact carries. It reads ELF/PE sections, standalone CUDA fatbins,
CUBIN/PTX and Clang HIP bundles, including CCOB v1/v2/v3. It neither executes the
artifact nor invokes CUDA/ROCm tools. GPU execution, SASS disassembly and host
launch correlation remain outside coverage.

Start with a target inventory:

```json
{ "path": "/artifacts/library.so", "view": { "collection": "targets" } }
```

Target rows aggregate inventoried payloads and distinguish an unrequested kernel
analysis from a complete or partial one. `objects` pages expose exact object
IDs, compression declarations and encoded/header locations. Fields, exact
filters, batch IDs and stable pagination select the facts delivered to the
caller. IDs are positional within the recorded artifact SHA-256. Selecting `object_ids`
in a new inspection requires `expected_sha256` from that inventory; a changed
file is rejected before parsing selected payloads.

`target` is the inventory declaration used for selection; `payload_target` is
the independently observed inner declaration when available. Object pages keep
both values, their kind, `target_consistency` and inspection coverage even with
selected fields.
Conflicting base architectures retain both values, mark object/report/target
coverage partial and annotate the affected kernels. CUBIN flags establish a base
architecture: `base-only` explicitly leaves feature-profile agreement unknown,
including `a` and `f` variants. A standalone declaration is `single-source`, and
unexamined payloads remain `unexamined`. An exact AMDGPU target is normalized at
its note owner for comparison with a Clang bundle declaration; raw values remain
intact. Unresolved feature comparisons stay `unknown`.

A HIP target ID identifies a toolchain target, not its payload representation.
Recognized raw or wrapped LLVM bitcode stays `unsupported` for kernel metadata
inspection, with the bundle ID, range and selected payload digest retained.
Bitcode validity and inner targets remain unexamined; malformed recognized ELF
still reports `malformed`. Standalone bitcode is outside GPU container coverage.

HIP bundle and metadata note recognition accept both the legacy `amdgcn` triple
and LLVM's `amdgpu` subarchitecture triples, including declared generic processors
such as `gfx11-generic` and `gfx9-4-generic`. Notes with the empty or explicit
`unknown` environment use the same processor and feature comparison while
retaining their raw triple spelling. CUDA's legacy fatbinary compression flag is
retained as an unsupported codec with its encoded and decoded extents;
compressed bytes are not treated as PTX text. CCOB is recognized by the exact
four signature bytes `CCOB`; high-bit-corrupted bytes are not decoded as ASCII
and accepted as a bundle. CCOB v1 has no stored total size: the completed zlib
or Zstd stream determines its encoded extent. Embedded `CCOB` text is ordinary
compressed data; zero-byte alignment after the stream belongs to neither
payload. If decoding fails or its codec is unsupported, a later `CCOB` marker
is only an uncertain recovery candidate. The affected row retains that
limitation and discovery remains partial.

The declared decoded length bounds decompression. An understated length can
stop decoding before codec completion, so any subsequent recovery extent stays
unknown; the decoder does not expand its allowance to prove the bad declaration.
Interrupted observations omit unfinished v1 rows. A terminal capacity row
qualifies its retained range as the containing tail and does not infer siblings.

`cuda_target_header` retains the OS ABI, normalized raw `e_flags` and exact
header location. CUDA OS ABI `0x33` and the observed `0x41` flags layout use
different architecture fields; they are decoded at one ABI-aware owner.
Unrecognized layouts keep the header and an unknown target instead of
inventing an SM label. Header provenance is validated against its CUBIN object.

Target filters select inventory declarations. An unselected payload's inner
target remains unexamined; an empty filtered result does not establish that
no enclosed code declares that target. Discovering every inner declaration
requires decoding those payloads.

HIP bundle IDs retain the declared processor and v2-v3 `+feature` suffixes for
exact selection. If a recognized AMDGPU bundle ID does not expose a target, the same
bounded note-discovery owner used for standalone AMDGPU files establishes it
before filtering. Those directory/note reads share the inspection work budget;
successive queries can select the target returned by inventory.

Decode selected targets and return a kernel page in the same call:

```json
{
  "path": "/artifacts/library.so",
  "analysis": "kernels",
  "targets": ["sm_100"],
  "view": {
    "collection": "kernels",
    "names": ["kernel_name"],
    "fields": [
      "name",
      "parameter_count",
      "parameter_bytes",
      "parameters",
      "registers",
      "shared_bytes"
    ]
  }
}
```

Only selected payloads are decoded. Other inventory entries remain present with
`not-selected` states, and overall payload coverage remains partial. An empty
kernel page proves no matching retained fact; it does not establish that an
unexamined payload contains no kernel. Missing fields remain null.

Kernel representations have different meanings:

- PTX reports parameter declarations and virtual registers. Shared bytes cover
  supported static declarations inside that entry; they do not establish module
  shared memory, dynamic allocation or physical device resources.
  PTX 1.0–1.3 declares entry parameters in the body; PTX 1.4 and later uses the
  entry parameter list. Entry-scoped `.pragma` statements before the body do
  not end the declaration or suppress its body resources. A `.target
  compute_xx` spelling is retained as written;
  NVIDIA PTX defines it as a synonym for `.target sm_xx` when comparing its
  target identity with the fatbin declaration. `.callprototype` formal
  parameters are excluded from entry virtual-register counts. Parameter names
  remain available when pointer qualifiers are understood or an unsupported
  qualifier prevents layout decoding. A pointer's `.align` describes the
  pointed-to memory and does not change parameter layout alignment. Spaced,
  joined and partly joined pointer qualifiers have the same meaning. Parameter
  alignment before or after the scalar type retains its layout and name.
  Parameter names and following declarations are retained when an array
  extent uses a parenthesized expression or when dimensions are
  multidimensional, even though those forms do not currently yield a layout.
  PTX target selection uses the highest-numbered module-scope `.target`
  directive, including directives after entry declarations; unsupported or
  conflicting target profiles leave the effective target unknown.
  Scalar register declarations count each bare or percent-prefixed name and
  each parameterized range, including compact keywords such as `.reg.b32`.
  Unsupported declaration forms or overflowing totals
  retain an unknown count and partial decoding coverage. Unsupported parameter
  layouts and unknown shared-memory declarations likewise retain their known
  facts, explicit limitations and partial coverage through retained pages.
- CUBIN identifies CUDA entry symbols and reads numeric `nv.info` records,
  including V2 kernel-parameter sizes, and native section declarations. Global
  register declarations also cover compiler
  versions that leave the older text-section register field empty.
  Conflicting register declarations keep the physical count unknown, preserve the
  kernel's other facts, and mark object/report/target decoding coverage partial.
- AMDGPU reads v3+ MessagePack notes. V3 processor identity comes from the
  `EF_AMDGPU_MACH` field in ELF `e_flags`; known processor values are selectable
  even when the note omits `amdhsa.target`. This inventory reports the processor
  only; it does not interpret version-specific feature flags. Unknown processor values remain unknown. A known
  processor conflict between ELF flags and note metadata leaves the processor
  unresolved. Argument counts include hidden ABI arguments
  when present; SGPR/VGPR counts and fixed group/private segment sizes retain
  their declared meanings. Legacy YAML metadata remains unsupported.

Each selected PTX payload becomes a retained UTF-8 text artifact with a SHA-256,
byte length and source coordinates. It is omitted from compact replies. Read it
with `inspect_analysis_view` and the parent Evidence ID returned by the compact
receipt:

```json
{
  "source": { "kind": "retained-evidence", "evidence_id": "ev_..." },
  "view": {
    "kind": "gpu-code-objects",
    "collection": "ptx",
    "object_id": "...",
    "offset": 0,
    "limit": 4096
  }
}
```

Text offsets use UTF-16 code units and must fall on Unicode scalar boundaries.
Complete Evidence retains the selected text; `export_evidence_bundle` provides
its portable source record. Historical pages never reopen the input file.

A location with `container_id: null` uses original file offsets. Other locations
use that inventoried object's decoded byte coordinates. Follow its parent,
encoded location and digest to trace decompressed metadata back to a native
section and the original file. Decoded offsets are never presented as physical
file offsets. Reads from an ELF or PE GPU section stay within that declared
section extent, so neighboring native section bytes cannot complete a
truncated embedded bundle header.

The CLI uses the same service and contracts:

```sh
rea inspect-gpu-code-objects /artifacts/library.so --analysis kernels \
  --targets '["sm_100"]' --detail summary \
  --view '{"collection":"kernels","names":["kernel_name"]}' \
  --evidence_output /analysis/library-gpu.evidence.json --json
```

A full-file SHA-256 always streams every byte. Inventory then reads bounded
native directories and bundle headers; CCOB requires decompression to discover
its inner directory. Kernel analysis reads selected payloads. `bytes_read`
includes hashing and subsequent descriptor reads, so this is not a header-only
hashing workflow.

CUDA raw LZ4 blocks and Zstd, and CCOB zlib/Zstd are supported. Unknown versions
or codecs retain declarations with explicit limitations. Lengths are checked
before decoding, and CCOB's truncated MD5 is verified against decoded bytes.
Resource limits are one active inspection, 128 MiB per input/output buffer,
512 MiB of payload input, decoded output and AMD note-read work per inspection,
and 16 MiB retained facts including selected PTX. Payload work is reserved before
reading or allocating; a capacity refusal does not reread an aliased payload.
Native tables and decoded section names each have a 16 MiB structural budget;
AMDGPU ELF note discovery admits at most 8 MiB of source note bytes, with
bounded depth and container/string allocations. Standalone AMD targets are read
from those notes before target selection; selected kernel analysis reuses the
same parsed declarations. Pages have a
1 MiB response budget. Resource refusals and interrupted observations preserve
known facts and explicit uncertainty.

CUDA ELF parsing additionally shares a 262,144 record/symbol visit limit,
128 MiB of cumulative metadata section reads, and a 16 MiB serialized-size
accounting budget for temporary index facts. These limits are checked before
index growth; they are not claims about JavaScript heap size. Equivalent scoped
metadata byte ranges and repeated equal register declarations are coalesced;
conflicting values remain unknown. Parameter sections are parsed once per ELF.

Missing CUBIN symbol tables or unresolved section names produce `partial`
object, report and target coverage even when some kernel facts survive. AMD note
failures preserve earlier successfully parsed declarations and the original
failure reason. Standalone PTX recognition tries a small header first, then
continues within the existing 16 MiB text budget when leading comments or
whitespace obscure its directives; admitted full-file probe bytes are reused.
After those comments and whitespace, `.version` must be the first PTX module
token; later PTX-looking text does not identify an arbitrary binary as PTX.

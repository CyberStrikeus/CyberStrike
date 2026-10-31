# Model file declarations

Use `inspect_model_artifact` (CLI: `inspect-model-artifact`) to inspect a local
GGUF v2/v3 or safetensors file. Detection uses content, including GGUF byte
order, rather than its extension. REA does not load a model, interpret weights,
run inference, import Python, open external-data references or use the network.

Unsupported GGUF versions remain refused. Their diagnostic preserves the four
version bytes and both UINT32 interpretations with byte order unknown, rather
than inferring big-endian from an unrecognized little-endian value. Little-endian
v2/v3 and big-endian v3 remain supported; big-endian v2 remains refused.

```bash
rea inspect-model-artifact /absolute/path/model.gguf --json
rea inspect-model-artifact /absolute/path/model.safetensors --hash full --json
```

The CLI defaults to complete Evidence. For compact delivery with portable access
to every retained observation:

```bash
rea inspect-model-artifact /absolute/path/model.gguf \
  --detail summary --evidence_output /absolute/path/model-evidence.json --json
```

## Identity and reads

The default `hash: "header"` reads only the metadata and tensor directory. The
result records the exact selected path, file size, header length, header SHA-256,
bytes read and read scope. GGUF alignment padding is outside this prefix.
`artifact.sha256` and the Evidence subject are null: a header digest is not a
commitment to the weights. Different files can have identical headers and sizes.
The reported GGUF tensor-data offset follows the aligned tensor directory when
padding is present. For zero-tensor metadata-only files that end at the
directory, it is the directory end; no tensor payload is implied. A partial
alignment gap is rejected. `header_length` still ends at the directory, before
any padding.

`hash: "full"` additionally streams the remaining file bytes through SHA-256.
It returns a full-file digest and Evidence subject, while retaining the same
header digest. It uses bounded buffers and does not interpret tensor data, but
it does read the whole file. Cost therefore grows with file size. Both modes
check descriptor and selected-path identity and metadata before completion;
this detects observed replacement or modification, not adversarial modification
that defeats filesystem metadata checks.

If full-file hashing fails or is cancelled after either format's header has
been validated, partial Evidence retains the parsed metadata and tensor directory.
Header coverage is complete; digests and final file identity remain unknown.
Safetensors header parsing is atomic, so interruption before validation does not
expose unvalidated JSON rows.

## Facts and selected queries

GGUF reports version, byte order, alignment, typed metadata, and each tensor's
name, original type ID, dimensions, relative data offset, file offset and derived
byte length. Alignment accepts every positive UINT32 multiple of eight, including
non-powers of two. Partial Evidence retains explicit alignment once validated;
the default alignment becomes known after metadata completes. Cancellation
retains completed declarations with unknown digests and unverified final file
identity. Metadata keys preserve their spelling and use lowercase
ASCII alphanumeric components separated by dots, underscores or hyphens;
standard numeric components such as `general.base_model.0.name` are preserved.
Hyphenated components are retained for compatibility with the published
llama.cpp v0.7.0 writer, which emits keys such as
`gpt-oss.context_length` and `wavtokenizer-dec.context_length`; the current
[GGUF specification](https://github.com/ggml-org/ggml/blob/master/docs/gguf.md#standardized-key-value-pairs)
restricts `general.architecture` values to letters and digits.
This documents producer output that conflicts with that written restriction,
not a claim that the specification permits hyphens. See the pinned
[WAVTOKENIZER_DEC](https://github.com/ggml-org/llama.cpp/blob/620d2225cc436ab0b001e3200e590e3b286ef9ab/gguf-py/gguf/constants.py#L1447)
and [GPT_OSS](https://github.com/ggml-org/llama.cpp/blob/620d2225cc436ab0b001e3200e590e3b286ef9ab/gguf-py/gguf/constants.py#L1466)
architecture names, [context-length key template](https://github.com/ggml-org/llama.cpp/blob/620d2225cc436ab0b001e3200e590e3b286ef9ab/gguf-py/gguf/constants.py#L110),
and [writer method](https://github.com/ggml-org/llama.cpp/blob/620d2225cc436ab0b001e3200e590e3b286ef9ab/gguf-py/gguf/gguf_writer.py#L698-L699).
Scalar metadata is complete. Arrays have declared element types,
counts and at most eight preview elements per array, with an explicit
`preview_complete` flag. This includes tokenizer vocabularies: omitted values
are not silently represented as a complete array. Strings are UTF-8; 64-bit
integer metadata and all shape dimensions use decimal strings without rounding.
Nonfinite floating metadata uses `NaN`, `+Infinity` or `-Infinity` with its
declared float type; negative zero is `"-0"`. Unknown tensor types retain their numeric IDs and null byte
lengths; affected totals and storage validation remain unknown.

Q8_1 (type ID 9) has two released layouts: 40 bytes per 32 elements in
[llama.cpp b1500](https://github.com/ggml-org/llama.cpp/blob/57ad015dc3011b046ed5a23186c86ea55f987c54/ggml-quants.h#L49-L55)
and 36 bytes in the pinned
[modern ggml layout](https://github.com/ggml-org/ggml/blob/da8e2a54b919557b816b1c2beb432ccb766f7ce0/src/ggml-common.h#L242-L253). Both use GGUF v3 and
quantization version 2, so those declarations do not select a storage layout.
REA retains the known type, shape, parameter count and starting offsets, with
`byte_length: null`, `storage_validation: "unknown"`, partial storage/range
coverage and an explicit limitation for nonempty Q8_1 tensors. Per-type and
overall byte totals remain unknown where affected. Padding, the next tensor's
offset and file size do not establish a layout; retained queries preserve the
same uncertainty. Empty Q8_1 tensors still have a derived zero-byte length,
and the known 32-element row-block constraint remains enforced.

K-quantization IDs 10–15 also have incompatible released layouts. The
[b1500 build option](https://github.com/ggml-org/llama.cpp/blob/57ad015dc3011b046ed5a23186c86ea55f987c54/CMakeLists.txt#L88)
`LLAMA_QKK_64` selects `GGML_QKK_64`; the same release's default and
[b3001](https://github.com/ggml-org/llama.cpp/blob/c429b33beb35f13934a4dfbe0c138d30b45e5d54/ggml-common.h)
use 256-element blocks. The
[b1500 structures](https://github.com/ggml-org/llama.cpp/blob/57ad015dc3011b046ed5a23186c86ea55f987c54/ggml-quants.h#L61-L169)
give these source-derived sizes:

| ID  | Stable name | Bytes per 64 elements, K64 | Bytes per 256 elements, K256 | Padded extent for 256 elements, either layout |
| --- | ----------- | -------------------------- | ---------------------------- | --------------------------------------------- |
| 10  | Q2_K        | 24                         | 84                           | 96                                            |
| 11  | Q3_K        | 28                         | 110                          | 128                                           |
| 12  | Q4_K        | 38                         | 144                          | 160                                           |
| 13  | Q5_K        | 46                         | 176                          | 192                                           |
| 14  | Q6_K        | 54                         | 210                          | 224                                           |
| 15  | Q8_K        | 76                         | 292                          | 320                                           |

Both builds write GGUF v3 and quantization version 2. The
[quantizer](https://github.com/ggml-org/llama.cpp/blob/57ad015dc3011b046ed5a23186c86ea55f987c54/llama.cpp#L7430-L7492)
writes `general.file_type` directly from the selected `llama_ftype`, without
encoding the K64 build option. `GGML_QNT_VERSION_FACTOR` is defined in the
header but is not used by this GGUF serialization path. Global file type also
does not identify individual tensor types: the quantizer
[retains unselected tensors](https://github.com/ggml-org/llama.cpp/blob/57ad015dc3011b046ed5a23186c86ea55f987c54/llama.cpp#L7561-L7586).
The [writer pads each payload](https://github.com/ggml-org/llama.cpp/blob/57ad015dc3011b046ed5a23186c86ea55f987c54/ggml.c#L19549-L19565)
to the default 32-byte alignment; the final column shows why even the same file
extents need not distinguish these layouts.
REA preserves each K type's name and enforces the common 64-element row
multiple, which does not establish a storage block size. Nonempty K tensor
lengths and affected totals are now unknown, including common modern files.
Empty K tensors still have derived zero-byte storage.

Integer IDs also shifted each time IQ types were added. These released
`ggml.h` snapshots all declare GGUF v3 and quantization version 2:

| Released snapshot                                                                                   | I8 ID | I16 ID | I32 ID |
| --------------------------------------------------------------------------------------------------- | ----- | ------ | ------ |
| [b1500](https://github.com/ggml-org/llama.cpp/blob/57ad015dc3011b046ed5a23186c86ea55f987c54/ggml.h) | 16    | 17     | 18     |
| [b1803](https://github.com/ggml-org/llama.cpp/blob/36e5a08b203542dca53cca4eaf172c5dc4bbc991/ggml.h) | 17    | 18     | 19     |
| [b1871](https://github.com/ggml-org/llama.cpp/blob/bb0c1392479398f9aba86d9ec98db0b95ede6e6d/ggml.h) | 18    | 19     | 20     |
| [b2100](https://github.com/ggml-org/llama.cpp/blob/4aa43fab569215a13495a7f1a0f8afc541b16d03/ggml.h) | 19    | 20     | 21     |
| [b2172](https://github.com/ggml-org/llama.cpp/blob/bd2d4e393b2b7d2a1b2e201058e26017c9728ead/ggml.h) | 20    | 21     | 22     |
| [b2221](https://github.com/ggml-org/llama.cpp/blob/a14679cc30c785e75d38028bae6ec39c6209ddef/ggml.h) | 21    | 22     | 23     |
| [b2253](https://github.com/ggml-org/llama.cpp/blob/4c4cb30736582cacb1a164a9d4bc8e17b1014be7/ggml.h) | 22    | 23     | 24     |
| [b2275](https://github.com/ggml-org/llama.cpp/blob/a33e6a0d2a66104ea9a906bdbf8a94d050189d91/ggml.h) | 23    | 24     | 25     |
| [b2300](https://github.com/ggml-org/llama.cpp/blob/6ea0f010ff6967034528d9e0b8330b9b0f0b7c13/ggml.h) | 24    | 25     | 26     |

[Upstream PR 6050](https://github.com/ggml-org/llama.cpp/pull/6050) later pinned
integer values explicitly. Modern IDs 16–23 mean IQ2_XXS, IQ2_XS, IQ3_XXS,
IQ1_S, IQ4_NL, IQ3_S, IQ2_S and IQ4_XS, respectively. Thus every ID 16–25 has
multiple released meanings. REA keeps its numeric `type_id`, uses
`AMBIGUOUS_<id>` for `type`, and records the released candidate names in a
limitation. Nonempty byte lengths are unknown. Empty declarations still derive
zero-byte storage, while their textual identity remains ambiguous. Type filters
match the reported `AMBIGUOUS_<id>` label. ID 26 remains I32 across these
snapshots; later stable entries retain their existing interpretation. This audit
does not establish compatibility with every producer fork or future revision.

The inventory does not select a historical layout from model names, global
file types, padding or guessed producer provenance. A source revision together
with its build configuration can establish an external layout fact; these
headers do not carry that identification, and REA currently has no layout
selection input. Authored regression fixtures use the source-derived sizes
above; historical executables were not run.

Safetensors reports the header extent, exact string `__metadata__` values, dtype,
shape and declared data ranges. A null `__metadata__` is treated as omitted;
unknown fields on tensor entries are ignored within the reader's 32-level JSON
nesting limit, while the required dtype, shape and data offsets are still
validated. JSON duplicate keys, invalid UTF-8, out-of-file
ranges, overlaps, gaps, trailing unindexed data and known dtype/shape byte-length
contradictions are rejected with a typed `file_format_rejected` constraint (public code `target_unavailable`, category `unsupported_target`).
A missing, non-regular or otherwise unusable selected path is also `target_unavailable`;
host I/O or resource failures on a valid selection, such as `EMFILE` or `EIO`, are
`execution_failure` with the path and reason in `details.diagnostics`. Empty
tensors and scalar shapes are supported. The reader retains shape dimensions as
exact unsigned 64-bit values, including values above JavaScript's safe-integer
range when a zero extent makes storage empty. Shape products are checked in
declaration order, as in the
[64-bit upstream reader](https://github.com/huggingface/safetensors/blob/e246a2560645b7525f5775669ed816eb57c5bcc8/safetensors/src/tensor.rs#L604-L609);
a later zero does not erase an earlier product overflow. Actual file and data
offsets must still fit exact host offset precision. Packed sub-byte types require whole
byte storage. Unknown dtypes retain declared ranges and an explicit limitation
that shape-to-storage validation is unavailable. Each tensor records
`storage_validation: "consistent" | "unknown"`; `coverage.storage_sizes` remains
partial when that consistency cannot be checked. Tensor filters accept these
`storage_validation` states independently of dtype or name.

Parameter counts and per-type totals are **derived from declarations**, not
measurements of effective parameters or inference behavior. Shared or repeated
weights are not deduplicated. GGUF dimensions retain their original fastest-first
order; safetensors shapes retain JSON order. Safetensors tensor rows use name
order; GGUF rows use directory order. An index identifies a declaration within
its collection and header digest, not tensor contents or a cross-version match.
GGUF supports zero extents and scalar shapes, with at most four dimensions;
known quantized types still require complete blocks in the first dimension.

MCP defaults to a compact summary with counts, selected short headline metadata,
chat-template presence (default or named template content) and derived totals.
A names-only `tokenizer.chat_templates` inventory does not establish template
content. The full type histogram and all rows
remain in complete Evidence. Headline metadata uses short keys/types and scalar
values; long or compound values remain available through explicit metadata
queries. Use the returned `parent_evidence_id`:

```json
{
  "source": {
    "kind": "retained-evidence",
    "evidence_id": "<parent_evidence_id>"
  },
  "view": {
    "kind": "model-artifact",
    "collection": "tensors",
    "names": ["token_embd.weight", "output.weight"],
    "fields": ["name", "type", "shape", "file_offset", "byte_length"],
    "offset": 0,
    "limit": 32
  }
}
```

To answer a known question in the initial inspection, pass the same selection
without `kind` as `inspect_model_artifact`'s optional `view`, for example
`{"path":"/absolute/path/model.gguf","view":{"collection":"tensors","names":["token_embd.weight"],"fields":["type","shape","file_offset"]}}`.
This returns one selected page with compact model context and retains the full
source Evidence, avoiding another tool call. `view` requires summary delivery;
complete detail and a selection are rejected as conflicting choices.
CLI uses `--view '{"collection":"tensors","names":["token_embd.weight"]}'`
with `--detail summary --evidence_output FILE`.

Call `inspect_analysis_view` with the historical query object above for further pages. `collection: "metadata"` accepts
exact `keys`, indices, fields and paging; use it for `tokenizer.chat_template`
or tokenizer array previews. `collection: "types"` pages derived storage and
parameter totals and accepts exact `types`. Tensor pages also accept `types`.
Filters intersect; omitted filters mean all recorded rows and empty arrays mean
none. Every row retains its source-scoped index. Names, keys and type labels
follow field selection; `fields: []` returns only indices. Omitted fields return
all recorded columns. Compact warnings use the shared bounded view budget and
link to complete parent Evidence when messages are omitted. Page offsets count filtered
matches, while row indices retain their original scope. Each page carries source
identity, header coverage, array omissions, unknowns and parent Evidence links.

Pages read historical retained facts without reopening the model. Complete
Evidence can also be supplied inline or as a single authenticated Evidence JSON
record through `source: {"kind": "evidence-file", "path": "/absolute/path/model-record.json"}`.
CLI Evidence bundles contain a `records` array; import the bundle with
`import_evidence_bundle` before using retained queries, or save one complete
record as a standalone Evidence file. A bundle is not a single Evidence record.
The session owns validated indexes until that Evidence is released; there is no
live-file result cache or automatic freshness claim.
Imported reports must retain positional indices and unique names, keys and
type identities; malformed reports return a typed input error before indexing.

## Bounds and unsupported inputs

The reader admits one active inspection per provider. It enforces a 100,000,000
byte header ceiling (safetensors counts its declared JSON bytes separately from
the fixed eight-byte length prefix; GGUF counts the complete header) and a separate 32 MiB
retained representation budget before retaining rows or expanding strings.
Numeric products use exact integer arithmetic. GGUF follows its four-dimensional
tensor layout and limits metadata array nesting to 32 frames. Resource refusals
are typed, rather than returned as complete empty inventories. Cancellation
joins descriptor finalization; failed cleanup remains owned for retry.

PyTorch pickle and ZIP model deserialization are unsupported; convert using a
trusted external workflow and supply GGUF or safetensors. ONNX, TFLite, Core ML,
model execution and conversion are outside this operation.

Format references: [GGUF specification](https://github.com/ggml-org/ggml/blob/da8e2a54b919557b816b1c2beb432ccb766f7ce0/docs/gguf.md),
[ggml tensor layouts](https://github.com/ggml-org/ggml/blob/da8e2a54b919557b816b1c2beb432ccb766f7ce0/src/ggml-common.h),
[safetensors format](https://github.com/huggingface/safetensors/tree/e246a2560645b7525f5775669ed816eb57c5bcc8#format).

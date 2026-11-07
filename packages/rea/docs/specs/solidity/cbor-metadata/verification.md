# Verification

After integrating upstream c462a4ebd, 47 tests passed
across the parser, domain contract, application service, compiled worker and MCP
boundary (five files). Compiled-worker goldens include BOM text, partial nested
values, unavailable trailers, malformed UTF-8 and unsupported floats. Five
upstream adapter tests also passed after its stricter integer validation landed.
All six static tasks and architecture guards
passed. After integration, test discovery found all 1004 files exactly once.
The CI-planner selection passed all 85 tests, including the new EVM-verifier case.

The parser regressions cover exact large integers and typed keys, malformed UTF-8,
duplicate keys, excessive nesting, unsupported tags/floats, length bounds and
historical omission. A real defect in the decoder's default text handling removed
an initial U+FEFF. The owning tokenizer now validates and decodes the retained
text bytes with BOM preservation; independent fixtures check both values and
compiler-key identity.

The owned fixture was compiled with caller-selected solc 0.8.30, using unoptimized,
optimized via-IR, content-hash-free and CBOR-free settings. All four metadata
checks passed again after integration. No contract was executed. Local first decode
took approximately 0.81 ms or less. The originally reported approximately 2.92 ms
for 100 warm iterations included equality assertions and is not a decode-only
measurement. The verifier now measures parsing separately from those assertions;
updated warm timings have not been collected. These historical figures describe
these fixtures and this host, not a general workload.
Peak process RSS
included the compiler (299536 KiB); complete process-family CPU/memory and agent
token costs were not measured.

Compiled worker tests exercise unchanged EVMole WASM on this macOS host. MCP tests
use the production server and contracts with an injected provider seam. The full
Linux-only provider CLI/MCP, resource-limit and cleanup lane remains unverified
here. Metadata JSON commitment binding remains deferred under issue #2388.

The Linux CLI/MCP verifier asserts exact compiler bytes, declared version and
candidate ranges for its existing owned raw/hex artifacts. Its CI lane additionally
runs the new compiler-setting matrix. A regression using the actual CI planner
checks that edits to the new verifier select the EVM lane.

The later merge/review correction adds decoded-summary and omitted historical
metadata coverage. Tests and provider reruns for that correction were skipped at
the maintainer's request; the earlier runs above do not validate the changed head.

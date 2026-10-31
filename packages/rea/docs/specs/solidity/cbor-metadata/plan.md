# Implementation plan

1. Use cborg 6.1.3 (Apache-2.0) as a pinned format decoder, with a bounded
   tokenizer at its owning adapter boundary. Decode maps as Map, preserve integer
   precision and strictly validate emitted text bytes before conversion.
2. Add the portable metadata-result schema in src/domain/evm/. Use exact byte
   ranges into the already retained bytecode rather than copying an opaque CBOR
   hex payload into every selected summary.
3. Add src/evm/SolidityMetadata.ts to interpret the terminal length/root-map
   candidate. Return unavailable, decoded, partial or not-decoded facts; keep
   unsupported nested values explicit instead of recursively expanding them.
4. Compute the facts in EvmoleInterfaceWorker from its selected bytes. The host
   provider validates ranges/identity and projects the additive metadata field.
   Preserve raw engine output without rewriting its unknown-precision metadata.
5. Ensure the canonical EVM bytecode shape carries the optional field into complete
   and summary Evidence. Include decoding profile, coverage and limitations.
6. Add producer, worker, historical contract and public MCP boundary coverage.
   Compile an owned Solidity fixture with a pinned caller-supplied solc module,
   and verify its CBOR compiler version. Run relevant static/architecture checks.
7. Extend the existing real Linux CLI/MCP verifier with independent metadata
   assertions. Run the compiler-setting matrix in its CI lane and classify its
   verifier as EVM-owned, with a production CI-planner regression.

No new execution provider or target authority is introduced: a format parser is
added inside the existing EVM worker. Linux x64 provider admission, target-free
semantics, cleanup, limits and complete original Evidence remain unchanged.
No metadata JSON or source URL is automatically acquired.

The parser bounds nesting to 64 and token/collection growth to the selected
terminal payload's byte count (the format's terminal length is at most 65535).
Every data item consumes encoded bytes; broad declared collection lengths cannot
justify allocation without that lower bound. Expanded results still pass the
worker's existing 16 MiB output check.

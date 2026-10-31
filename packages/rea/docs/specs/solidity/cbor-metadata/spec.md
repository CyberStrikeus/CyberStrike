# Solidity terminal metadata inspection

Issue: https://github.com/morluto/rea/issues/2388

## Outcome

The existing EVM interface operation should retain independently decoded terminal
CBOR candidate facts from the exact selected bytes instead of relying on precision
unknowns in the engine's reported metadata. This increment covers trailer ranges,
bounded decoding, exact integer/non-text scalar key evidence and compiler-version
representations.

## Requirements

- Preserve the existing carrier/decoded identities and original full bytecode.
- Report a plausible terminal root-map candidate separately from proof of Solidity
  origin. Missing or non-map trailers remain unavailable, not proven absent.
- Interpret scalar root-map keys/values losslessly: integers as decimal strings,
  bytes as hex, strings, booleans and null. Preserve undecoded/unsupported values
  through the original bytecode plus exact candidate offset/length.
- Report partial and not-decoded coverage, parser/profile failures and unsupported
  CBOR forms explicitly. Do not silently coerce unknown keys into object properties.
- Interpret admitted solc release/prerelease representations only from observed
  entries; preserve ambiguity if duplicate compiler-version keys occur.
- Keep the additive field compatible with historical Evidence and retain
  it through selected summary delivery and public CLI/MCP.
  Historical omission parses as a null unknown facet without mutating the source.
- Bound nesting before decoder recursion and collection lengths before allocation.
  Keep parsing inside the existing owned worker and its resource/output budgets.
- Do not fetch metadata or source content, contact RPC or execute contract code.

## Acceptance and limits

Owned compiler fixtures and malformed/synthetic trailers cover integers beyond
Number precision, non-text keys, nested/uninterpreted values, invalid UTF-8,
invalid lengths, unsupported tags and nesting bounds. Public boundary tests
preserve the field and older omission. A real pinned solc artifact verifies actual
metadata facts; the existing Linux-only EVM host profile remains unchanged.

## Deferred issue criteria

Binding a supplied metadata JSON to IPFS/Swarm commitments is a later independent
increment of #2388. This PR must reference rather than close the whole issue.

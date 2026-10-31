# Reconstruction obligation ledgers

`build_reconstruction_obligation_ledger` turns authenticated Evidence records
into a deterministic list of reconstruction claims. The same workflow
is available as:

- MCP tool: `build_reconstruction_obligation_ledger`
- CLI command: `rea build-reconstruction-obligation-ledger`

The ledger is conservative by design. Static Application Graph facts create
candidate obligations; they do not prove runtime or process behavior. A required
obligation closes only when one manifest binding supplies a unique owner, any
required parser/schema/domain type, every required case fixture, and a passing
verifier whose authority is comparable to the original observation. The
verifier must enumerate the obligation ID and its result must be present in the
input Evidence bundle. Contradictions, duplicate definitions or owners,
residual unknowns, missing dependencies, and unavailable authority keep closure
open or failed.

Original process authority requires observed `controlled-replay` Evidence with
a supported process-capture provider and a valid capture payload. A matching
operation or predicate alone does not establish that authority, including for
reviewed obligations and manifest original cases.

Every fixture and verifier proof must bind its outcome to the exact owner
implementation digest and obligation revision being evaluated. See
[proof applicability](#proof-applicability) for the caller-produced contract.

## Complete CLI request

This empty request is useful for checking client integration. It is valid and
returns an `unknown` ledger with zero obligations; absence of source Evidence
never claims closure:

```sh
rea build-reconstruction-obligation-ledger \
  '{
    "evidence_bundle": {
      "artifacts": [],
      "providers": [],
      "environments": [],
      "scenarios": [],
      "captures": [],
      "unknowns": [],
      "records": []
    },
    "reviewed_obligations": [],
    "manifest": {
      "bindings": [],
      "contradictions": []
    }
  }' \
  --json
```

For a real investigation, export an Evidence bundle from the session and replace
the empty bundle. Application Graph and process capture records generate
conservative candidates automatically. Add reviewed obligations when a required
claim is not represented by those sources.

## Reviewed obligation examples

Each example below is a complete `reviewed_obligations` element. Replace the
sample Evidence ID with an authenticated review record already present in
`evidence_bundle.records`. Stable IDs and versions make changes reviewable.

### CLI parsing

```json
{
  "obligation_id": "cli.config.invalid-option",
  "obligation_version": 1,
  "title": "Reject an invalid configuration option with the supported CLI error",
  "application_layer": "cli",
  "family": "argument-parsing",
  "target": {
    "artifact_sha256": null,
    "application_node_id": null,
    "semantic_node_id": null,
    "location": "rea --unknown-option"
  },
  "required": true,
  "required_case_kinds": ["positive", "negative", "malformed"],
  "required_original_authority": "process",
  "required_fixture_authority": "packaged-process",
  "required_verifier_authority": "packaged-process",
  "requires_parser_type": true,
  "dependency_obligation_ids": [],
  "residual_unknown_ids": [],
  "unavailable_authority": [],
  "required_next_evidence": ["Capture the installed CLI for all three cases."],
  "disposition": "active",
  "review_evidence_ids": [
    "ev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  ]
}
```

### Protocol handler

```json
{
  "obligation_id": "protocol.rpc.cancel",
  "obligation_version": 1,
  "title": "Cancel an in-flight request and emit one terminal response",
  "application_layer": "protocol",
  "family": "request-response",
  "target": {
    "artifact_sha256": null,
    "application_node_id": null,
    "semantic_node_id": null,
    "location": "JSON-RPC request cancellation"
  },
  "required": true,
  "required_case_kinds": ["positive", "negative", "malformed", "cancellation"],
  "required_original_authority": "external",
  "required_fixture_authority": "protocol",
  "required_verifier_authority": "protocol",
  "requires_parser_type": true,
  "dependency_obligation_ids": [],
  "residual_unknown_ids": [],
  "unavailable_authority": [],
  "required_next_evidence": [
    "Record request, cancellation, and terminal response IDs."
  ],
  "disposition": "active",
  "review_evidence_ids": [
    "ev_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  ]
}
```

### Electron startup and background behavior

```json
{
  "obligation_id": "electron.background.startup",
  "obligation_version": 1,
  "title": "Start the background process before exposing the renderer bridge",
  "application_layer": "electron",
  "family": "startup",
  "target": {
    "artifact_sha256": null,
    "application_node_id": null,
    "semantic_node_id": null,
    "location": "main process startup"
  },
  "required": true,
  "required_case_kinds": ["positive", "negative", "teardown"],
  "required_original_authority": "runtime",
  "required_fixture_authority": "renderer",
  "required_verifier_authority": "renderer",
  "requires_parser_type": false,
  "dependency_obligation_ids": [],
  "residual_unknown_ids": [],
  "unavailable_authority": [],
  "required_next_evidence": [
    "Observe main/renderer ordering and application shutdown."
  ],
  "disposition": "active",
  "review_evidence_ids": [
    "ev_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  ]
}
```

### Persistence migration

```json
{
  "obligation_id": "persistence.profile.migrate-v2",
  "obligation_version": 1,
  "title": "Migrate a version-one profile without losing unknown fields",
  "application_layer": "persistence",
  "family": "migration",
  "target": {
    "artifact_sha256": null,
    "application_node_id": null,
    "semantic_node_id": null,
    "location": "profile schema v1 to v2"
  },
  "required": true,
  "required_case_kinds": ["positive", "negative", "malformed"],
  "required_original_authority": "runtime",
  "required_fixture_authority": "integration",
  "required_verifier_authority": "integration",
  "requires_parser_type": true,
  "dependency_obligation_ids": [],
  "residual_unknown_ids": [],
  "unavailable_authority": [],
  "required_next_evidence": [
    "Compare pre-migration and committed storage snapshots."
  ],
  "disposition": "active",
  "review_evidence_ids": [
    "ev_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  ]
}
```

### Native ABI

```json
{
  "obligation_id": "native-abi.helper.status",
  "obligation_version": 1,
  "title": "Preserve the helper status-code and output-buffer contract",
  "application_layer": "native-abi",
  "family": "ffi",
  "target": {
    "artifact_sha256": null,
    "application_node_id": null,
    "semantic_node_id": null,
    "location": "helper_status(const uint8_t *, size_t, uint8_t *, size_t *)"
  },
  "required": true,
  "required_case_kinds": ["positive", "negative", "malformed"],
  "required_original_authority": "process",
  "required_fixture_authority": "native-abi",
  "required_verifier_authority": "native-abi",
  "requires_parser_type": true,
  "dependency_obligation_ids": [],
  "residual_unknown_ids": [],
  "unavailable_authority": [],
  "required_next_evidence": [
    "Run the ABI harness against the shipped and reconstructed libraries."
  ],
  "disposition": "active",
  "review_evidence_ids": [
    "ev_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  ]
}
```

## Manifest and closure

A manifest binding names one owner and a caller-supplied `owner_sha256`. Both
`original_cases` and the reconstruction fixture list must cover every
`required_case_kinds` value with authenticated, comparable Evidence.
`parser_type` is mandatory when `requires_parser_type` is true.

The ledger does not read `module_path`, execute `verifier.command`, or compute
the implementation digest. The owner fields do not specify whether the digest
covers module bytes, a symbol representation, or a multi-file implementation.
The proof producer must document the exact hashed inputs and any canonicalization
so another verifier can reproduce that commitment; a path or symbol name alone
does not define it.

```json
{
  "obligation_id": "protocol.rpc.cancel",
  "owner": {
    "module_path": "src/protocol/requestRouter.ts",
    "symbol": "cancelRequest",
    "owner_sha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  },
  "parser_type": {
    "parser": "parseCancelRequest",
    "schema": "cancelRequestSchema",
    "domain_type": "CancelRequest"
  },
  "original_cases": [
    {
      "kind": "positive",
      "evidence_id": "ev_6666666666666666666666666666666666666666666666666666666666666666",
      "location": "/captures/positive"
    },
    {
      "kind": "negative",
      "evidence_id": "ev_7777777777777777777777777777777777777777777777777777777777777777",
      "location": "/captures/negative"
    },
    {
      "kind": "malformed",
      "evidence_id": "ev_8888888888888888888888888888888888888888888888888888888888888888",
      "location": "/captures/malformed"
    },
    {
      "kind": "cancellation",
      "evidence_id": "ev_9999999999999999999999999999999999999999999999999999999999999999",
      "location": "/captures/cancellation"
    }
  ],
  "fixtures": [
    {
      "fixture_id": "rpc.cancel.positive",
      "case_kind": "positive",
      "authority": "protocol",
      "evidence_ids": [
        "ev_1111111111111111111111111111111111111111111111111111111111111111"
      ]
    },
    {
      "fixture_id": "rpc.cancel.negative",
      "case_kind": "negative",
      "authority": "protocol",
      "evidence_ids": [
        "ev_2222222222222222222222222222222222222222222222222222222222222222"
      ]
    },
    {
      "fixture_id": "rpc.cancel.malformed",
      "case_kind": "malformed",
      "authority": "protocol",
      "evidence_ids": [
        "ev_3333333333333333333333333333333333333333333333333333333333333333"
      ]
    },
    {
      "fixture_id": "rpc.cancel.cancellation",
      "case_kind": "cancellation",
      "authority": "protocol",
      "evidence_ids": [
        "ev_4444444444444444444444444444444444444444444444444444444444444444"
      ]
    }
  ],
  "verifier": {
    "verifier_id": "rpc.cancel.conformance",
    "claim_id": "protocol.rpc.cancel.v1",
    "command": "npm run test:protocol -- cancel",
    "authority": "protocol",
    "status": "pass",
    "result_evidence_id": "ev_5555555555555555555555555555555555555555555555555555555555555555",
    "enumerated_obligation_ids": ["protocol.rpc.cancel"],
    "nondeterminism": {
      "mode": "partial-order",
      "specification": "cancel precedes the single terminal response"
    }
  }
}
```

A ready ledger requires every retained Evidence reference to resolve in the
bundle, including references on optional case kinds. Unresolved references stay
visible in the ledger and produce diagnostics; they cannot close the obligation.
A green unit test cannot close a `packaged-process` obligation. A static-only
source cannot close a runtime or process claim. Marking a claim `blocked` or
`out-of-scope` records the disposition but does not silently count it as verified.

### Proof applicability

Keep three checks separate:

- **Authenticity:** the retained Evidence passes its integrity checks.
- **Authority:** the observation has the kind and strength required by the claim.
- **Applicability:** the proof describes the implementation and obligation
  revision currently being evaluated.

Proof producers supply observed Evidence with predicate type
`rea.reconstruction-proof`, operation `verify_reconstruction_obligations`, and
the following `normalized_result` shape, defined by
`reconstructionObligationProofSchema`. REA evaluates retained results; this
operation label does not expose a proof executor or run the manifest command.

```json
{
  "bindings": [
    {
      "obligation_id": "protocol.rpc.cancel",
      "obligation_version": 1,
      "owner_sha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      "fixtures": [
        {
          "fixture_id": "fixture.cancel.positive",
          "case_kind": "positive",
          "passed": true
        }
      ],
      "verifiers": [
        {
          "verifier_id": "verifier.cancel",
          "claim_id": "claim.cancel",
          "passed": true
        }
      ]
    }
  ]
}
```

`owner_sha256` is the same lowercase 64-hex SHA-256 commitment supplied by the
implementation owner in the manifest. The proof producer computes it from the
same documented inputs and canonicalization described above; REA compares the
commitments and does not recompute them. The proof's `obligation_version` must
exactly equal the evaluated obligation version, including for generated
obligations. Increase that version when revising a reviewed requirement.

Within one matching obligation/owner/revision binding, fixture proof must name
the exact `(fixture_id, case_kind)` pair, and verifier proof the exact
`(verifier_id, claim_id)` pair. Every selected claim must report `passed: true`;
a matching failed claim cannot be hidden by a duplicate passing claim.
Claims may share a record, but identities or outcomes from different bindings
are never joined. Fixture and verifier Evidence authority must also satisfy the
existing authority requirements.

Changing the owner digest or obligation version makes retained proof
inapplicable. Missing identity, including legacy ID-array proof records, keeps
the ledger open with `inapplicable-fixture-proof` or
`inapplicable-verifier-proof`; details distinguish malformed or missing metadata
(`invalid-proof`), `owner-mismatch`, `revision-mismatch`, and `claim-mismatch`.
An applicable false outcome produces `fixture-failed` or `verifier-failed` and
a failed required ledger. An unknown, unsupported, or skipped verifier declaration
produces `verifier-unavailable` and keeps closure open. Replace fixture and
verifier Evidence after implementation or requirement changes. Old Evidence
remains valid provenance and cannot establish current applicability.

The `summary` counts obligations. `by_status`, `by_application_layer`, and
`by_source_state` place each obligation in exactly one bucket.
`by_evidence_authority` groups obligations by the Evidence `authority` of their
`authority_references`: an obligation counts once under each distinct authority
it cites, so those counts can exceed `total`. A reference's own `state` and the
obligation's `source_state` do not affect its authority bucket.

The tool returns every obligation inline. Its `ledger_id` and `closure_digest`
identify the complete result, including summaries, reports, ownership and
dependency graphs, Evidence links, and limitations. A new `closure_digest`
identifies a changed ledger; it does not establish that a verifier ran again.
Applicability is checked against the retained proof's explicit bindings.

For named boundaries with explicit verifier contracts and package-proof kinds,
see [reconstruction coverage](reconstruction-coverage.md).

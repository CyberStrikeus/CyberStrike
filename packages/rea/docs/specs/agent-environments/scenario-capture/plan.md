# Implementation plan

1. Add `src/domain/analysisView/scenarioCaptureRecords.ts`: index scenario
   events by transaction, project each request event as a HAR-shaped
   `WebNetworkCaptureRecord`, and admit a scenario parent for the manifest
   view (clone budget, schema, network-content selection).
2. Route `projectEnvironmentManifestView` through one capture-parent gate that
   selects the HAR or scenario admission by parent operation, and widen the
   environment-manifest result's `parent_operation`.
3. Branch `parseCaptureEvidence` in `environmentSource.ts` on the Evidence
   operation, carry the capture kind and digest on the source, and word the
   bundle README and CLI help for both kinds.
4. Add a schema-valid scenario capture fixture and domain and services tests:
   the record projection, the manifest from a scenario parent, the refusal,
   replay of UTF-8 and binary bodies, and the bundle README.
5. Document scenario parents in `docs/agent-environments.md` and
   `docs/web-network-captures.md`, extend the tool contract text, and record
   the spec.

No new dependency is introduced and no command is added.

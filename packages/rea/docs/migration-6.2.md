# Upgrading from REA 6.1 to 6.2

REA 6.2 includes stability fixes and changes to public result and saved-data
contracts. The repository uses `always-bump-minor`, including breaking releases;
the minor version increment does not imply backward compatibility. Refresh cached
MCP tool definitions after upgrading and adapt custom consumers using this guide.

## MCP results and Evidence

Evidence-producing tools now return the complete Evidence record directly in
`structuredContent` and JSON text. The old `{ result, evidence_id, evidence }`
wrapper is gone.
For a successful Evidence-producing call, change:

```javascript
// 6.1
const value = reply.structuredContent.result;
const evidence = reply.structuredContent.evidence;

// 6.2
const evidence = reply.structuredContent;
const value = evidence.normalized_result;
const evidenceId = evidence.evidence_id;
```

Check `isError` before reading success fields. Error results have `isError: true`
and carry their typed JSON diagnostic in a text content block; they omit
`structuredContent` so they cannot violate the advertised success output schema.

```javascript
if (reply.isError === true) {
  const text = reply.content.find((part) => part.type === "text");
  if (text === undefined) throw new Error("REA error has no text diagnostic");
  const { error: diagnostic } = JSON.parse(text.text);
  // Handle diagnostic.code, diagnostic.message and diagnostic.details.
}
```

Lifecycle and other non-Evidence tools still use their own advertised output
contracts. Do not assume every successful tool returns Evidence. Consult
[`tools/list` and the result guide](mcp-contracts.md#tool-results).

A transport `resource_constraint` error can include a retained
`details.reported_limits.evidence_reference`. Use `inspect_analysis_view` or
`export_evidence_bundle` on the same connection to consume the complete retained
Evidence. Response-budget settings are captured when the server starts; recreate
the server to change them, and keep the client's receive budget aligned. Raising
the server budget does not change the client's limit or analysis coverage.

Every Evidence record now requires `analysis_profile`, either its observed
profile object or `null`. The field participates in Evidence identity. Records
that omitted it cannot be migrated by inserting `null` while retaining the old
`evidence_id`. Keep the original files and regenerate affected observations with
6.2; use the new returned identities when linking or comparing them. Existing
records that already satisfy the complete canonical contract remain usable.

The `binary_session` result removes the redundant top-level `provider` and
`providers` aliases. Read `analysis_provider_binding`,
`analysis_provider_candidates` and per-operation `capabilities` for selection
and availability. Select a deep provider through `open_binary.provider_id`
or CLI `--provider`, using the advertised values.

These changes establish one complete result representation and explicit
provider/profile ownership rather than accepting incomplete producer records.
See [63bf914](https://github.com/morluto/rea/commit/63bf91405cf97b114a84f337fb1272d98a267999)
and [#1277](https://github.com/morluto/rea/pull/1277).

## Saved snapshots and artifact inventories

Analysis snapshots require `workflow_entries` and a corresponding profile-bound
Evidence record for every cached query. Import rejects incomplete bindings
instead of silently discarding them. Preserve an incompatible snapshot and
choose a new output path when rerunning analysis, for example:

```bash
rea analyze /absolute/path/to/program --provider ghidra --snapshot /absolute/path/to/analysis/program-6.2.json
```

In MCP, open the target without the incompatible `snapshot_path`, run the
required queries, then save to a new path through `close_binary.snapshot_path`.
Do not fabricate missing provider profiles or query bindings. See
[snapshot usage](cli.md#save-and-reuse-analysis-snapshots).

Artifact inventory nodes identify content bytes. Path-specific role and
permissions now belong to each occurrence:

| Previously read                  | Read in 6.2                               |
| -------------------------------- | ----------------------------------------- |
| `nodes[].kind`                   | `occurrences[].artifact_kind`             |
| Path-specific `nodes[].format`   | `occurrences[].artifact_format`           |
| `nodes[].executable`             | `occurrences[].executable`                |
| Content identity and byte format | `nodes[].artifact_id`, `sha256`, `format` |

Join an occurrence to its content node using `artifact_id`; inspect the selected
occurrence's role rather than choosing one role for all paths with equal bytes.
An executable binary format can have `artifact_kind: "executable"` while its
current filesystem permission produces `executable: false`. A `.js` and `.txt`
file with identical bytes can share a node and retain different roles.
Regenerate old inventories: a merged content node alone cannot recover the
per-path facts that were lost. These changes are part of
[63bf914](https://github.com/morluto/rea/commit/63bf91405cf97b114a84f337fb1272d98a267999).

## Process captures and cleanup failures

REA no longer converts legacy v3 process captures on import. Captures require
explicit selected/launch executable identity and `event_journal`; missing data
is rejected instead of being filled during parsing. Preserve old captures for
historical reference and recapture with 6.2 when current comparisons are needed.
Do not infer the original launched binary from a later file digest, or invent
event ordering from independently recorded collections. An explicitly empty
journal is valid under its advertised contract; the field cannot be omitted.
See [2a77469](https://github.com/morluto/rea/commit/2a7746998d47446c4db6d4f524e0f183d6803f3f).

Filesystem effects can now report `status: "unknown"` with a reason when a
partial snapshot cannot establish creation or deletion. Update exhaustive
status readers and retain observed facts separately from absence assumptions.

A completed one-shot analysis can report `cleanup_incomplete` rather than
silently returning success when provider cleanup fails. Preserve its
`details.partial_observation` or primary execution diagnostics, inspect the
reported owned resources, and address cleanup before retrying. A successful
analysis observation does not prove successful cleanup. This behavior is covered
by [#1211](https://github.com/morluto/rea/pull/1211). That change also makes
configured agent-evaluation fixture checks grade cited Evidence; routing or
answer wording alone no longer passes an assessed fixture.

## JavaScript and function comparisons

JavaScript return-field projections require `presence` with `present`, `absent`
or `unknown-coverage`. Export-shape change rows retain both sides' presence,
and `property_inventories` report examined properties and coverage. Unknown
values and unknown presence are distinct; callers must not treat an unknown
value as a missing property. Semantic object-operation graph observations use
`properties.property_path`, an array of complete path segments or `null`,
rather than a flattened property name. Regenerate old application analysis
before depending on nested mutation or presence facts. See
[475a0f8](https://github.com/morluto/rea/commit/475a0f84dac63d710e032bc7f731c1a3bda624ec).

Function comparison dimension statuses are `unchanged`, `changed` or `unknown`.
The unreachable `truncated` status and `summary.truncated` counter have been
removed. Update exhaustive enum handling and display logic; unavailable facts
remain `unknown`. See
[5510b27](https://github.com/morluto/rea/commit/5510b27d7f863a3df26212fba4a59f8df0da3712).

## Historical-source symlinks

Source graph symlinks with `target_state: "unreadable"` or `"unknown"` require
`target: null`. Internal, external and missing targets retain their actual
recorded target strings. External targets use the observed absolute target;
display placeholders such as `<outside-root>` cannot serve as lookup data.
Reimport the source tree when the old graph retained only a placeholder, and
handle nullable targets in custom readers. See
[b7b4333](https://github.com/morluto/rea/commit/b7b433370310c3ffe33d5027d8393151d5e862da).

Keep original saved artifacts until their replacements and consuming workflows
have been checked. Fresh analysis may establish different facts if the target,
source tree or runtime changed; it does not rewrite what an older capture proved.

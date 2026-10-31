# MCP tool design

## Decide whether to add a tool

Design around the analyst question. Inspect the current canonical contracts,
provider capabilities, and nearest existing tool before changing the surface.
Extend a tool when intent and result contract match; add one for a distinct
outcome or materially different authority. Public names and semantics remain
provider-neutral, with exact coverage reported per provider.

Keep the catalog complete; report capability/session availability instead of
truncating schemas. Serialized bytes alone do not establish agent usability.

## Choose the tool shape

| Shape                 | Use it for                                  | Result                                                                    |
| --------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| `inspect`             | Facts about one target, object, or resource | Relevant fields, locations, and facet availability                        |
| `search` / `list`     | Candidate discovery                         | Stable ordering and context; pagination when the query or format needs it |
| `trace`               | Relationships across evidence               | Typed edges, supporting facts, and unresolved paths                       |
| `compare`             | Explicitly paired artifacts or observations | Identity, comparable coverage, and supported deltas                       |
| `workflow`            | A recurring outcome needing composition     | Inline answer, contributing evidence, and partial facets                  |
| `observe` / `capture` | Runtime behavior                            | Authority, launch/attach effects, lifecycle, and cleanup status           |

These are task shapes, not mandatory prefixes. Name tools for the action and
object callers reason about. Avoid unrelated discovery/execution/mutation modes
inside one tool.

## Prefer primitives; compose workflows

A primitive reports a reusable fact about an identified object or relationship.
A format-specific decoder qualifies; one application's business interpretation
belongs outside the general contract. The format owner reports source
observations and structural validation; the application or workflow owner
applies use-case-specific admission policy without reinterpreting raw fields.
For example, DOS MZ structure and Windows-header evidence stay separate, while
target resolution decides whether the unresolved header permits admission.
Expose provider APIs when they add a useful capability that existing tools
cannot express.

Compose a workflow when repeated use demonstrates a multi-source outcome REA
can join without hiding caller choices or uncertainty. Batch homogeneous reads
when that removes repeated work while preserving per-item outcomes. Keep prompts
optional and avoid prescribing call sequences that a direct tool can replace.

Agents can compose experiments with ordinary commands, scripts, and local
fixture servers. Custom orchestration languages, replay engines, or separate
prepare/execute plans need an observed requirement those primitives cannot
satisfy. A plan without execution does not establish runtime behavior.

## Exercise the analyst workflow

Before defining a new provider-backed tool, state the analyst's question, what
they already have, the intended result and authority, and what must remain
unknown. Try the nearest existing REA workflow and the relevant native provider
or ordinary script path when available. Identify the specific gap and what a
new or extended contract would add; upstream capability alone does not require
a new tool or equal support from every provider.

Exercise the task through REA as a whole and compare relevant provider behavior
with an independent artifact or format observation where possible. Use the
caller's selected target and authority. Record the provider version, target and
observed coverage, and distinguish an unsupported operation from an empty
result or an untested path.

Include the boundary cases that could change the answer: provider labels versus
source facts, addresses versus file locations, partial results, and a useful
recovery after failure or session close when those apply to the task. Check that
composed results keep each observation's identity, limitations and source
association. Existing real-provider lanes and focused tests establish their
selected scenarios; they do not by themselves establish a different workflow or
provider equivalence. If a provider cannot be exercised, report that limitation
and continue with the available evidence. Measure agent tool selection only with
an actual agent evaluation; a scripted tool sequence does not establish it. Use
[testing guidance](testing.md#provider-backed-workflow-verification) to select
the cases that establish the proposed contract.

## Audit existing tools

Scope an audit by analyst tasks and the caller's target, providers and authority.
Record the source revision and, when used, the running server, catalog and
provider versions; a connected server can differ from the current checkout.
Inspect the live CLI help or MCP descriptions and schemas alongside the owning
contracts and documentation. Choose representative tasks and their nearest REA
and native alternatives rather than counting upstream commands.

Exercise the selected public workflows, including the steps before and after a
tool call. Check task selection, input choices, returned facts and their source,
partial or unsupported outcomes, and applicable session and recovery behavior.
Compare native provider output and an independent artifact observation where
available. Inspect existing tests and real-provider lanes for the scenario they
actually cover; a passing test does not establish a different task or host.
Use [workflow verification](testing.md#provider-backed-workflow-verification)
for counterexamples and lifecycle controls relevant to the audit.

Report working routes as well as findings. Separate a reproduced contract bug,
an intentional limitation, a design opportunity and an unverified hypothesis;
include the smallest useful reproduction, impact and coverage limits. Do not
claim autonomous-agent selection from a scripted trace. Check related reports
before proposing another issue, and avoid treating lack of API parity as a bug.

## Define the contract

- Use strict inputs with explicit target identity and required fields. Preserve
  meaningful target, action, capture, and output choices; remove ignored options
  and repeated permission declarations.
  One-shot binary CLI analysis retains the caller's verbatim target spelling in
  Evidence `caller_input_path`, including a result loaded from a snapshot. The
  subject keeps the inspected file identity. Provider inspections also retain
  the established `parameters.input_path` field for existing consumers. Keep
  request provenance separate from provider arguments and snapshot queries.
- Return the requested facts inline with artifact/provider identity, source
  locations, Evidence references, coverage, and relevant confidence and
  limitations. Use supported selection, summaries or views when they answer
  the question; preserve access to complete source Evidence and honor existing
  contracts and requested detail. Missing coverage is unknown, not absence.
  Avoid extra lookups solely to understand the answer or its provenance.
- Keep observed, derived, and inferred relationships distinct. Preserve
  unresolved edges and partial provider facts instead of requiring every
  provider to supply the same metadata.
  When a format constructor changes defaults or flags, retain the source
  values and use separately derived effective values only for operations
  whose semantics require them.
- For caller/callee reads, `relationship_coverage` describes only the
  provider-observed direct relationship set. `complete` means that set was
  returned without a known read limit; it does not claim every possible runtime
  edge. Provider and execution caveats stay in `limitations` and do not imply
  incomplete relationship coverage. Missing coverage remains `unknown`.
- Declare process, filesystem, network, UI, and mutation effects truthfully;
  enforce the requested target and lifecycle.
- Add limits only for real format, protocol, authority, or measured resource
  constraints. Report pagination, truncation, cancellation, and partial failure.
  An assumed agent budget is insufficient justification for a limit. Name the
  ceiling and its recovery as described in
  [admission limits and recovery](design/limits-and-recovery.md).

### Compose declared Evidence inputs

Declare each logical Evidence source with the shared `evidenceInputSchema`:
complete inline Evidence or an exact
`{kind: "retained-evidence", evidence_id}` reference. Use that declaration in
single, optional, array and nested source fields across domains. Keep complete
record schemas for stored Evidence, bundle records and pure semantic inputs;
request alternatives do not change those representations. Ordinary IDs in
parameters or result data are not implicitly source selectors.

Derive borrowing request validation and source resolution from the canonical
request schema with `getEvidenceInputContract` and `resolveEvidenceRequest`.
The shared application entrypoint selects references for CLI and MCP before the
format owner admits, authenticates and interprets their records. Preserve
admission before copying large source payloads. Do not maintain a second list
of source paths or resolve references only in an adapter. A resolved reference
has the same identity, caller-selected observations, provenance, coverage and
partial or unknown facts as its complete inline record; it never reruns a
producer or upgrades incomplete evidence.
Keep Evidence-bearing request unions outside skipping `default` wrappers;
use `prefault` when a default must pass through branch selection. Catalog
conformance rejects unsupported source containers rather than silently losing
their references.

Return authenticated source records alongside derived workflow Evidence when
the adapter must retain them. Keep links to those exact sources and require the
source closure when the workflow follows their links. Missing references and
incompatible workflow roles are explicit failures; do not infer a substitute
from ledger order, display names or the active target. A summary or inspection
page has its own identity: consumers needing complete source facts use its
`normalized_result.parent_evidence_id`, unless their contract explicitly accepts
that view.

New provider-owned source observations require a retention owner. Existing
caller-owned inputs can also compose on a fixed port without a recorder;
when a recorder is available, preserve its acceptance or rejection and retain
completed sources through cancellation.

MCP supplies the current ledger lookup. CLI commands that advertise
`--evidence-bundle` use one explicitly selected, authenticated bundle for the
command's lifetime. Keep cleanup with that owner. A retained reference does not
grant filesystem access: file selectors remain separate, explicit contracts
where supported. See [retained Evidence inputs](mcp-contracts.md#retained-application-evidence-inputs)
and [CLI reuse](cli.md#import-export-and-compare-evidence).

### Interpret boundary facts once

The format or protocol reader owns interpretation. Pass its parsed facts and
explicit uncertainty to consumers; do not make adapters reparse display text,
reconstruct omitted values, or infer success from missing diagnostics.
Client registration inspections, for example, carry command identity and
activation independently of readiness. An owned registration may be disabled
or stale; unresolved ownership remains unknown. Consumers use those facts
instead of reclassifying the raw command.

A completed read can establish byte identity even when decoding or format
validation fails. State which representation a digest identifies, such as file
bytes, Fetch response-body bytes, or UTF-8 text. Preserve admitted source values
separately from normalized lookup and display values. When the retention
contract keeps only a digest and size, state that the bytes or text are
unavailable; the digest does not establish format validity.

Comparison needs separate proofs for lookup, correspondence, content, and
coverage. A hash cannot supply the proof that two retained values belong to
corresponding objects.

| Comparison fact                                                               | What it establishes                             | What remains unknown                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| Same capture-local frame or request ID                                        | Lookup within that capture                      | Cross-capture identity                        |
| Same HTTP method, URL, and resource type                                      | A repeated-request group                        | Which individual responses correspond         |
| A partial HTTP response multiset is contained in a complete peer              | Omissions can explain every retained sample     | Equality or modification                      |
| A retained HTTP sample is absent from a complete peer group                   | An observed difference independent of omissions | Other unobserved differences                  |
| Complete WebSocket connection/frame inventories and matching metadata streams | Ordered payload positions can be compared       | Equality of unavailable payload facts         |
| Unique WebMCP name, owner origin, and frame URL                               | Tool correspondence without transient frame IDs | Correspondence between duplicate owners       |
| A complete source digest or decoded storage value                             | Comparable content                              | Missing source bytes or opaque remote objects |

Complete traversal or inventory does not make unavailable values equal. A
partial aggregate fingerprint difference cannot establish modification when
omissions alone explain it; independently proven differences still survive.

Keep format recognition separate from provider admission. A recognizable header
can supply useful observations while later structure remains unresolved or a
provider cannot accept the artifact. Report the reason at the affected boundary
without erasing earlier observations or labeling unresolved input malformed.

Derive validation from the field's own format and revision. A runtime API's
narrower argument range need not constrain a wider on-disk field. A shared layout,
magic, or version label need not identify every constructor or equality rule.
When supported producer revisions differ, retain what the input establishes and
state what it cannot distinguish. Static inspection does not establish that the
artifact can execute successfully.

## Own the lifecycle

`SafeOutputTree` publishes only after file readback, nested-directory fsync
from children to parents, and root-parent fsync on hosts that support directory
syncing. Windows skips directory fsync. Failed writes retain a separate pending
identity admission only until identity is captured; rollback retries retain
unremoved file/directory identities and open handles independently, so confirmed
unlink progress cannot be re-admitted through a closed descriptor.

For tools that acquire resources, identify the owner and the observations that
establish each transition. Include temporary files and one-shot commands, as
well as persistent engine sessions. Use the existing provider contracts;
providers need not expose identical state machines.

In multi-stage work, retain each completed, admitted observation before awaiting
the next stage. Later reads, validation, cancellation, or finalization can fail
without erasing those facts. Carry them through typed failure outcomes with
explicit coverage of unperformed work; do not construct a successful result for
stages that never ran.

- Keep target admission, provider readiness, active work, observed process exit,
  and resource release separate. A valid process handle, successful launcher,
  or selected target establishes only its own fact. Publish available identity
  and exit observations even when launch fails; retain unknown ownership.
- Process exit does not establish output closure. The shared process supervisor
  retains at most 64 KiB of additional diagnostics from owned stop entry,
  including pending cleanup and retries, and drains for up to one second after
  verified stop. It marks output incomplete when closure cannot be
  observed and releases owned event-loop references without changing the proven
  process-cleanup outcome. Failed process cleanup retains capture for retry;
  borrowed processes and streams retain their own lifetime and reference state.
- Authenticate and capture identity through the same boundary on initial and
  recovery handshakes. Bound abandoned unauthenticated listeners where the
  protocol permits it; that deadline must not expire authenticated idle sessions
  or long-running native work. Listener expiry does not prove target closure.
- Readiness observations may await owned prerequisite commands. Status must
  remain readable during owner finalization without starting replacement work;
  report readiness as unknown when it cannot be re-observed.
- Shared startup has one producer and independently cancellable caller waits.
  Keep it running while any caller still needs it. The final departing caller
  waits for owned cleanup and retains its failure. Provider closure is distinct
  from caller cancellation. Retained cleanup capabilities block replacement;
  derive readiness from the current startup's completion and live connection.
- Session `cleanup_pending` includes retained blockers from external mutation
  owners until those owners confirm release. Closing the analysis session does
  not release resources owned by an external debugger. Reading a selected
  analysis snapshot is part of `open_binary`; cancellation keeps that operation
  and the caller's reason through the shared JSON reader.
- For cancellable observations, carry cancellation through result consumption
  and awaited cleanup. Before returning success, check the signal after the
  last awaited finalization step.
  Retain collected observations under typed cancellation. Preserve an existing
  primary failure and let incomplete cleanup retain its own classification.
  Preserve the caller's abort reason as the typed cancellation error's cause,
  including when cancellation is observed only after provider completion.
  Shared command owners must retain the observed cancellation reason separately
  from physical failures and cleanup ownership. Carry that fact through failure
  wrapping so adapters can preserve the exact reason without interpreting it.
  ZIP member streams retain the exact signal reason; hdiutil wrappers consume
  the command owner's typed cancellation record and keep physical command
  failures separate, even if a host error is named `AbortError`.
  Client cancellation alone does not prove native work stopped.
  For atomic publication, document the cancellation cutoff and preserve any
  committed output's publication receipt.
  Queued and retried work must retain the complete accepted execution controls,
  including non-default lifecycle deadlines and cancellation signals.
- Release only owned resources. Attaching owns a connection or session unless
  the provider contract explicitly establishes target ownership. A helper exit,
  missing reply, or missing PID does not establish target exit.
- Retain successful child cleanup and retry only unresolved children, including
  when close options change. Preserve observed child failure or activity when
  another child's health is unavailable; idle plus missing coverage stays
  unknown.
  Bind cleanup failures to their exact resource owner. Resolve current cleanup
  uncertainty only after that owner confirms release, while preserving the
  original failure and completed observations. Later failure composition must
  report only resources whose cleanup remains unresolved. Carry cleanup
  capabilities explicitly in typed outcomes so consumers can bind returned errors
  to exact owners without reparsing diagnostic cause chains.
  Bind every caller-visible retry error and aggregate, including an error already
  produced by the provider. An aggregate remains incomplete until all owners it
  reports are released; releasing one child cannot clear another child's status.
- Await one-shot cleanup without discarding the completed result or primary
  diagnostic. Preserve partial observations, remaining resources, and the cleanup
  owner's recovery instructions. While cleanup remains unconfirmed, canonical
  errors keep `cleanup_incomplete` and live resources while taking category,
  operation and failure details from the retained typed primary. Nested cleanup
  composition does not replace that semantic identity. Finalization reports
  remain attached to their owning envelope while cleanup is pending and after
  confirmed release. CLI adapters should reuse
  [`finishAnalysisCommand`](https://github.com/morluto/rea/blob/main/src/cli/finishAnalysisCommand.ts) where its contract
  applies rather than duplicate close/finally handling.
- Give descriptor-backed reads an owner before opening the file. A rejected
  close must retain the exact handle and preserve any earlier failure.
  Carry [`openRegularFile`](https://github.com/morluto/rea/blob/main/src/filesystem/RegularFile.ts)'s
  admitted handle and initial metadata rather than restatting only to rebuild
  those facts. Keep fresh descriptor and selected-path identity checks after
  work, comparing against the original baseline instead of replacing it with
  a later stat. Preserve explicit bigint reads when ordinary admission metadata
  cannot supply the required size or timestamp precision.
  Stable file reads expose completed values separately from cancellation so
  consumers retain acquired identity facts after successful close or cleanup retry.
  If an abortable caller stops waiting, keep the underlying work in that owner's
  lifetime so shutdown cannot report release before finalization settles.
  Admit the entire inspection once, including later reads and finalization.
  Helpers must borrow that admission or use an operation child scope; re-entering
  the same draining scope can make cleanup wait for its own caller.
  Retry retained cleanup before admitting new work and keep admission blocked
  while it remains unresolved. Link the originating cleanup error to its exact
  owner so confirmed release resolves its cleanup marker while preserving the
  earlier diagnostic. Shared CLI/MCP adapters cannot infer that confirmation.
- Provider profile selection owns every asynchronous candidate through its
  terminal result and finalization. The registry owns profile-file cleanup,
  joins all automatic-selection children, and closes those file owners before
  reporting candidate shutdown. Final caller cancellation joins the selection;
  an adapter that ignores cancellation remains active and owned until it settles.
  Block new admission during shutdown and while cleanup remains unresolved;
  reopen after confirmed retry. Preserve failed results before considering a
  later signal, and retain every child's attributed cleanup in mixed outcomes.
- Release child descriptors before removing their containing root. Retain a
  composite owner when either stage fails so retry preserves that ordering.
  A Windows command leader's exit does not establish Job Object closure. Keep
  the process-tree observer and command lock alive through failed cleanup retries
  until the owned tree's close event.

Exercise the applicable [lifecycle regression scenarios](testing.md#lifecycle-regressions)
through the producing owner and affected CLI/MCP consumers.

## Implement and evaluate

Put provider wire-protocol parsing in adapters and shared CLI/MCP workflows in
the application layer. Reusable format declarations may live in pure domain
owners: [`peOptionalHeader.ts`](https://github.com/morluto/rea/blob/main/src/domain/peOptionalHeader.ts)
decodes PE structure, while consumers retain machine admission, directory-address
interpretation, and file/mapping bounds. Share Evidence provenance, unknown
projection, and session retention semantics; matching payloads alone do not
establish parity.

Let `createEvidence` own JSON validation and snapshotting of ordinary observation
payloads. `EvidenceObservationInput` accepts semantically parsed parameters,
results, and raw results whose JSON validity still needs admission. Keep format,
selection, and identity validation at their producing boundary. Invalid JSON
issues are rooted at `parameters`, `normalized_result`, or `raw_result` in the
Evidence envelope.

`EvidenceObservation` retains the stronger JSON contract used by producer
helpers and `createImmutableEvidenceSteps`. The cooperative constructor also
requires an authenticated immutable result; preserve that ownership proof.
For objects, proof comes from completed sealing by
[`immutableJson.ts`](https://github.com/morluto/rea/blob/main/src/domain/immutableJson.ts);
`readonly` or `Object.freeze` alone does not establish it. JSON primitives are
directly eligible. Seal owned data and complete cooperative sealing before
reusing its result.

When a failed or cancelled operation retains completed, valid partial Evidence,
use the shared [`ToolResultDelivery`](https://github.com/morluto/rea/blob/main/src/server/ToolResultDelivery.ts)
path with the session's Evidence writer. Keep the original failure and the
named contract's target-content marking; replace the inline partial with a
retained reference only after recording succeeds. An absent writer or a writer
returning a failure `Result` leaves the partial inline, as does a partial that
is not valid Evidence. Unexpected recorder exceptions propagate. An `evidence_id`
member alone does not establish Evidence validity or retention.

Measure the resource before choosing a budget and enforce it before the costly
step. Account for value alternatives, trace-frame products, retained records,
serialization expansion, and temporary-file growth separately. Derive facet
completeness from examined records and exhaustiveness, rather than diagnostic
prose or an empty failure list. Preserve observations independently of cleanup
success.

Price mutually exclusive success and failure representations separately.
Replace a reserved failure envelope when pricing success, and release discarded
decoding state from retained-output accounting. Retaining additional failed-body
text changes the capacity available to later results; treat that as a contract
change and cover its effect on later valid items.

For example, if ten applicable records are discovered, eight are examined, and
five are returned, the five returned records do not establish complete coverage
of the ten. Keep discovered, applicable, examined, and retained scope distinct.
A filtered page can be complete for its selection while the parent inventory
remains partial. Carry the upstream coverage and unresolved reasons through
filtering and paging; an item missing from that page is not proved absent from
the target. Structured completeness and absence fields must agree with the
stated limitations.

File-error wrappers retain the format owner's specific diagnostic and recovery
text. Strict JSON file input, for example, keeps the byte-order-mark explanation
and UTF-8 recovery through CLI/MCP projection rather than replacing it with
generic invalid-file advice. Consumers do not classify parser message text.
When an artifact boundary falls back to an I/O error, retain the original cause
on the typed error so provider callers can inspect its filesystem evidence.
Keep public error fields under the canonical projector's ownership; retaining
a cause does not require exposing it in transport output.

Update canonical contracts, output schemas, examples, generated artifacts, and
relevant docs together. Verify converted advertised schemas and success,
malformed, unavailable, cancellation, and partial outcomes through affected
consumers. Real-engine claims require the matching provider lane; see
[testing.md](testing.md).

For fixed tuples in public contracts, use `src/domain/fixedTupleSchema.ts`:
Zod's tuple projection omits implicit length bounds and Draft 2020-12 `items`,
which some clients require even alongside `prefixItems`. Tuples with a rest
schema also need explicit minimum lengths. Check parser/schema parity for empty,
short, overlong, and malformed values in both input and output projections.

CLI translations must reuse the canonical semantic fields, enum membership and
list bounds. Document transport differences such as relative path spelling and
JSON text decoding; reject empty selections before path normalization. Preserve
required alternatives across positional arguments and options. When the CLI
schema format separates those groups and cannot express their relationship,
state the required choice in command discovery/help and retain aggregate admission
before target access. Test emitted schemas and parser behavior together, including
omission, empty strings, alternatives, conflicts and boundary list counts.

Expected input failures must retain caller field/index paths and safe constraints.
Internal operation/input envelopes are not caller paths. Reuse the input issue
projector at the admission owner; a schema cause alone does not supply correction
metadata to either adapter.

When discoverability changes, evaluate representative broad, direct, and negative
tasks on the intended host. Record host/model/catalog, selected tools, arguments,
errors, retries, and task outcomes. Schema validity and keyword heuristics do not
establish successful tool selection. See [mcp-contracts.md](mcp-contracts.md) for
shipped runtime behavior.

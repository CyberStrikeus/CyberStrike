# Guided MCP prompts and completion

REA exposes six provider-neutral investigation workflows through the MCP
`prompts` capability. They complement the generated tool catalog; they do not add, remove, or
invoke tools by themselves.

Clients that expose tools but not prompts can use the target-free
`guided_workflows` tool with `action: "list"` or `action: "render"`. CLI callers
can use `rea guided-workflows` to list workflows, or pass `--action render`,
`--workflow-id ID`, and `--arguments-json '{"feature":"offline search"}'` to
render one. Both paths use the same contracts and renderer as native prompts;
rendering returns guidance only and does not inspect a target, start analysis,
or change session state.

The list contains workflow identifiers, descriptions, and argument requirements;
render returns only the selected workflow's text. Unknown argument names and
non-string values are rejected with field paths. `action: "list"` accepts no
workflow identifier or arguments. The MCP adapter respects the same
`REA_MCP_TOOL_FAMILIES` scope as native prompts, including render requests.

To find a section in the installed guidance bundle by analyst question, use
`search_guidance` and pass a returned locator to `read_guidance_section`. The
CLI equivalent is `rea guidance --query "exact JavaScript module"`, followed
by `rea guidance --action read --locator LOCATOR`. Search is limited to the
packaged managed skill files, works without providers or a target, and returns
deterministically paged matches. Every non-generic query word must occur in the
section; generic-only queries return no matches. Results are documentation; locators
are bound to the installed bundle and report stale or unavailable guidance without
returning cached section content. A no-match result says nothing about analysis
capability availability.

Search returns at most 20 matches per page with 500-code-unit context excerpts.
Read retrieves the complete selected section. Admission permits 1 MiB per file,
4 MiB per bundle, 4,096 sections, and 25,165,824 expanded UTF-16 code units before
section text is materialized. Unreadable or oversized bundles return
`bundle_unavailable`, with no partial index or inferred absence. Cleanup failures
remain errors with their retained retry owner. The bundle and complete section
are bound by fixed-size hashes in locators, so a long heading does not make its own
locator unreadable.

## Prompt inventory

| Prompt                            | Purpose                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `investigate_feature`             | Trace a feature from discovery into relevant function evidence.                      |
| `compare_application_versions`    | Compare two shipped artifacts, with optional static and runtime follow-up.           |
| `verify_reconstruction`           | Evaluate a finite reconstruction specification against retained comparison Evidence. |
| `trace_crash`                     | Correlate a crash symptom with static paths and optional process capture evidence.   |
| `audit_residual_unknowns`         | Audit current residual-unknown heads and evidence-qualified resolution.              |
| `prepare_bounded_process_capture` | Design a bounded controlled process experiment before execution.                     |

A `REA_MCP_TOOL_FAMILIES` scope advertises a workflow only when every tool in
its suggested steps belongs to a selected family. Partially available
workflows are omitted from `prompts/list` — `prompts/get` reports them as not
found — so a rendered prompt never directs the agent to a disabled call. The
server identity digest and `rea mcp doctor` prompt inventory follow the same
scope.

Every rendered prompt provides optional starting points using current REA tool
names. Agents can call tools directly, skip irrelevant suggestions, and inspect
provider or target state only when it helps answer the request or a tool
requires it. The prompts also ask agents to keep observations, inferences, and
unknowns distinct. Requested prompt arguments and completion choices are
rendered as untrusted selection data, not instructions or authorization.
Tool results include their Evidence inline. Prompts do not require a bundle or
resource fetch to read a result; an Evidence ID is only a reference when a
prompt argument or tool explicitly accepts one.

For a JavaScript/Electron application directory, `investigate_feature` points
directly to `analyze_javascript_application` with `input_path`; it does not
require `open_binary`. When that Evidence, or `inspect_binary_layout` Evidence,
is already retained, it suggests `inspect_analysis_view` before tracing a
feature seed. The CLI equivalent is `rea analyze <directory>`.
`open_binary` and the doctor target check admit files and Apple bundle
directories (`.app`, `.appex`, `.framework`, `.xpc`, `.systemextension`,
`.bundle` and `.plugin`). Another Apple bundle type is refused as unsupported,
and another directory is reported with an available analysis action; this does
not establish support for every directory format.

For target paths in `compare_application_versions`, the prompt suggests
opening each target before calling `inspect_artifact`; inspection operates on
the active target and returns the graph and findings together inline.

Use standard MCP discovery and retrieval:

```json
{ "method": "prompts/list", "params": {} }
```

```json
{
  "method": "prompts/get",
  "params": {
    "name": "investigate_feature",
    "arguments": {
      "feature": "offline search",
      "document": "Notes"
    }
  }
}
```

The server advertises `listChanged: true`. Updating a registered guided prompt
emits `notifications/prompts/list_changed`, allowing clients to refresh their
cached prompt catalog.

Schema-invalid parameters to `prompts/get`, `prompts/list`,
`completion/complete`, and `tools/list` return JSON-RPC `-32602` with field
diagnostics. Correct the named fields and retry on the same connection.
Unexpected handler failures retain JSON-RPC `-32603`.

## Session-aware completion

MCP `completion/complete` completes guided-prompt arguments; it does not define
completion for arbitrary tool-call arguments. REA attaches completion to
optional prompt arguments that accept a session value. Suggestions provide
identifiers only; they do not retrieve or replace the inline Evidence result.

```json
{
  "method": "completion/complete",
  "params": {
    "ref": {
      "type": "ref/prompt",
      "name": "investigate_feature"
    },
    "argument": {
      "name": "procedure",
      "value": "0x10"
    },
    "context": {
      "arguments": {
        "document": "Notes"
      }
    }
  }
}
```

Completion sources are live projections of the current session:

Document and procedure completion in a binary session reads an already-ready
provider; it does not start analysis. A cold provider, a target transition, or
unavailable inventory can return no suggestions. Run an analysis query first
when you need inventory from a provider that supplies it. An empty completion
list does not establish that the target has no procedures.

| Argument family     | Source and filtering                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document            | Current provider `list_documents` result.                                                                                                            |
| Procedure           | The complete `list_procedures` inventory; all procedure addresses and uniquely named procedures are offered. Optional document context is forwarded. |
| Provider            | `auto` plus sorted deep candidates from the current binary session; target-free completion does not start them.                                      |
| Evidence            | Evidence IDs retained in the current session ledger, offered only for prompt arguments that accept Evidence references.                              |
| Process capture     | IDs for retained Evidence whose operation and validated result identify process capture.                                                             |
| Artifact manifest   | Manifest IDs from schema-valid retained artifact inventories.                                                                                        |
| Artifact occurrence | Occurrence IDs present in schema-valid retained artifact inventory pages.                                                                            |
| Residual unknown    | Current non-resolved unknown heads only.                                                                                                             |

Prefix matching is Unicode-normalized and case-insensitive; suggestions retain
their original spelling. The server deduplicates them and sorts by code point
for deterministic results. Procedure completion derives candidates from the
complete inventory, so a name is offered only when it identifies one address in
that inventory. Every name at a shared address participates in this check,
including later rows that establish ambiguity. A completion reply carries at
most 100 values, the MCP limit. `total` counts every match and
`hasMore` is `true` when values were omitted. Completion has no paging
controls. A longer prefix reaches an omitted value only when it excludes other
matches; matching uses normalized, case-insensitive forms, so a value can stay
unreachable when more than 100 matches share its normalized prefix.

## Lifecycle and safety

Completion has no cache in REA. Opening or switching a target changes document
and procedure suggestions on the next request. Closing the binary clears its
Evidence ledger and residual-unknown registry, so identifiers from the closed
session are no longer suggested. Provider errors, unsupported operations, and
malformed provider output produce an empty completion list rather than an
unverified identifier.

Suggestions are starting points, not tool calls. A tool acts on the target,
operation, and lifecycle fields in its own request; selecting a suggestion does
not execute it or broaden those fields.

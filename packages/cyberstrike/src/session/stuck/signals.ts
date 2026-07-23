// Pure signal helpers for the agent-loop termination guard (see
// AGENT_LOOP_TERMINATION_SPEC.md + _IMPL_PLAN.md). No framework/DB/IO deps — pure
// functions, so they are trivially unit-testable and deterministic. Used by both the
// within-turn duplicate suppressor (session/prompt.ts resolveTools) and the
// cross-turn monologue detector (session/stuck/stuck-detector.ts).

/** Deterministic, key-sorted JSON so `{a,b}` and `{b,a}` hash identically. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(sortKeys)
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortKeys((value as Record<string, unknown>)[key])
  }
  return out
}

/**
 * Signature for the "same tool + same args" repeat check. Keyed on tool name AND
 * argument value — NOT tool name alone — so a tester legitimately probing id=1,2,3
 * (different args) never trips; only byte-identical calls do. This is the single
 * definition reused by the within-turn suppressor and the doom_loop check.
 */
export function toolSig(tool: string, input: unknown): string {
  return `${tool}::${stableStringify(input)}`
}

/**
 * Read-only / status tools whose invocation does NOT count as "progress" for the
 * monologue rule. Verified against the tool registry (src/tool/registry.ts) for the
 * proxy pipeline. `record_coverage_note` / `update_vrt_check` are intentionally NOT
 * here for the *repeat* rule (identical re-writes are caught by toolSig), but for the
 * monologue rule "progress" means a non-status tool call — see isProgressTool.
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "methodology_status",
  "get_coverage_notes",
  "web_get_detail",
  "web_get_request_detail",
  "web_get_session_context",
  "web_get_vuln_detail",
  "web_get_vulnerabilities",
  "scope_check",
  // generic reads
  "read",
  "grep",
  "glob",
  "codesearch",
  "list",
  "lsp",
  "tool_search",
  "list_loaded_tools",
])

/** A tool call counts as progress (resets the monologue streak) iff it is not read-only. */
export function isProgressTool(tool: string): boolean {
  return !READ_ONLY_TOOLS.has(tool)
}

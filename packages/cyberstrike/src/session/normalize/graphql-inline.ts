// Faz 7b — inline GraphQL argument-value extraction.
//
// Variable values (`getUser(id:$id)` + variables:{id}) are already captured by the
// slots walker. Inline literal values (`getUser(id:"3")`) live in the query STRING,
// so we parse the query AST and pull argument values from it. Inline + variable then
// land in the same slot vocabulary (arg path → value), feeding one IDOR pool.
//
// TODO(deps): this imports the full `graphql` (graphql-js, ~3MB) package only for
// `parse()` — we use a tiny fraction of it (no validate/execute/schema). Replace with
// a bounded hand-rolled inline-arg tokenizer (sibling of collectArgs in protocol.ts)
// to drop the dependency and keep tier0 no-dep. Tracked in observed-values plan.
//
// SAFETY: fully fail-safe. Any parse error / oversized query / unexpected shape →
// returns []. It only AUGMENTS the value side, so on failure the behavior is exactly
// the pre-existing variables-only path; ingest is never affected. Bounded on length,
// slot count, and nesting depth.

import { parse, Kind, type ValueNode } from "graphql"
import type { ParamSlot } from "./types"

const MAX_QUERY = 64 * 1024
const MAX_SLOTS = 64
const MAX_DEPTH = 4
const MAX_VALUE_LEN = 256

function walkValue(path: string, node: ValueNode, out: ParamSlot[], depth: number): void {
  if (out.length >= MAX_SLOTS || depth > MAX_DEPTH) return
  switch (node.kind) {
    case Kind.INT:
    case Kind.FLOAT:
    case Kind.STRING:
    case Kind.BOOLEAN:
    case Kind.ENUM:
      out.push({ loc: "body", name: path, value: String(node.value).slice(0, MAX_VALUE_LEN) })
      return
    case Kind.NULL:
    case Kind.VARIABLE:
      // $variables are captured separately from the variables JSON — skip here.
      return
    case Kind.LIST:
      if (node.values.length > 0) walkValue(path + "[]", node.values[0]!, out, depth + 1)
      return
    case Kind.OBJECT:
      for (const f of node.fields) walkValue(path + "." + f.name.value, f.value, out, depth + 1)
      return
  }
}

/**
 * Extract inline argument literal values from depth-1 fields of a GraphQL query.
 * Pure, deterministic, fail-safe — returns [] on any error. loc is "body" so the
 * values flow through the same classify/redact pipeline as everything else.
 */
export function extractInlineArgs(query: string): ParamSlot[] {
  if (!query || query.length > MAX_QUERY) return []
  try {
    const doc = parse(query, { noLocation: true })
    const out: ParamSlot[] = []
    for (const def of doc.definitions) {
      if (def.kind !== Kind.OPERATION_DEFINITION || !def.selectionSet) continue
      for (const sel of def.selectionSet.selections) {
        if (sel.kind !== Kind.FIELD || !sel.arguments) continue
        for (const arg of sel.arguments) walkValue(arg.name.value, arg.value, out, 0)
        if (out.length >= MAX_SLOTS) break
      }
      break // first operation only (matches the depth-1 key tokenizer scope)
    }
    return out
  } catch {
    return []
  }
}

/**
 * Inline argument KEY-PATHS only (values stripped) — used to unify the dedup key
 * so an inline-literal arg (`product(id:"88")`) and a variable arg
 * (`product(id:$id)`) collapse to the same operation. Fail-safe → [] on error.
 */
export function extractInlineArgPaths(query: string): string[] {
  return [...new Set(extractInlineArgs(query).map((s) => s.name))]
}

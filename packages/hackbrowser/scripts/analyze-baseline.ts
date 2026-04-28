// Analyze baseline dumps — produce per-bug footprint report
// Usage: bun run scripts/analyze-baseline.ts

import { readdirSync } from "fs"

const BASELINE_DIR = "./dummy-api/logs/baseline-20260418"

interface Payload {
  text?: string
  ui_context?: {
    formName?: string
    pageUrl?: string
    fields?: Array<{
      name: string
      label?: string
      value: string
      type: string
      isReadOnly?: boolean
      isDisabled?: boolean
      isHidden?: boolean
      isDisplayOnly?: boolean
    }>
    hiddenParams?: string[]
  }
  trigger_element?: string
}

interface Record { seq: number; sessionID: string; payload: Payload }

const files = readdirSync(BASELINE_DIR).filter(f => f.endsWith(".json")).sort()

function firstLine(text: string | undefined): string {
  if (!text) return "<empty>"
  return text.split(/\r?\n/)[0] || text
}

function analyze(file: string, records: Record[]) {
  console.log(`\n${"=".repeat(90)}`)
  console.log(`FILE: ${file}`)
  console.log(`${"=".repeat(90)}`)

  const payloads = records.map(r => r.payload)
  const httpPayloads = payloads.filter(p => p.text?.includes("HTTP/1.1"))
  const withUI = httpPayloads.filter(p => p.ui_context)

  // Endpoint counts
  const endpoints = new Map<string, number>()
  for (const p of httpPayloads) {
    const k = firstLine(p.text)
    endpoints.set(k, (endpoints.get(k) ?? 0) + 1)
  }

  console.log(`Total payloads: ${payloads.length}  (HTTP: ${httpPayloads.length}, with_ui_context: ${withUI.length})`)
  console.log(`Unique endpoints: ${endpoints.size}`)
  console.log(`Duplicate endpoints (fired >1x):`)
  for (const [k, v] of endpoints) {
    if (v > 1) console.log(`  ${v}x  ${k}`)
  }

  // Bug footprints
  console.log(`\n--- BUG FOOTPRINTS ---`)

  // BUG-14/17: same formName across different endpoints (pollution signal)
  const formNamesByEndpoint = new Map<string, Set<string>>()
  for (const p of withUI) {
    const ep = firstLine(p.text)
    const fn = p.ui_context?.formName ?? ""
    if (!formNamesByEndpoint.has(fn)) formNamesByEndpoint.set(fn, new Set())
    formNamesByEndpoint.get(fn)!.add(ep)
  }
  for (const [fn, eps] of formNamesByEndpoint) {
    if (eps.size > 1) {
      console.log(`[BUG-14 signal] formName="${fn}" used for ${eps.size} endpoints: ${[...eps].join(" | ")}`)
    }
  }

  // BUG-15: radio field names with duplicates
  for (const p of withUI) {
    const fields = p.ui_context?.fields ?? []
    const radios = fields.filter(f => f.type === "radio")
    const byName = new Map<string, number>()
    for (const r of radios) byName.set(r.name, (byName.get(r.name) ?? 0) + 1)
    const dups = [...byName.entries()].filter(([_, v]) => v > 1)
    if (dups.length > 0) {
      const ep = firstLine(p.text)
      console.log(`[BUG-15 signal] ${ep}  radios: ${dups.map(([n,c]) => `${n}×${c}`).join(", ")}`)
    }
  }

  // BUG-17: display:none hidden fields count (via isHidden flag — current detection is limited)
  let totalHidden = 0
  for (const p of withUI) {
    const fields = p.ui_context?.fields ?? []
    totalHidden += fields.filter(f => f.isHidden).length
  }
  if (totalHidden > 0) console.log(`[BUG-17 signal] total isHidden fields across all payloads: ${totalHidden}`)

  // BUG-19: ui_context on DELETE requests (should be empty ideally)
  const deletes = withUI.filter(p => p.text?.startsWith("DELETE"))
  for (const p of deletes) {
    const fc = p.ui_context?.fields?.length ?? 0
    if (fc > 0) console.log(`[BUG-19 signal] ${firstLine(p.text)}  has ${fc} ui_context fields`)
  }

  // BUG-30: nameless fields
  for (const p of withUI) {
    const fields = p.ui_context?.fields ?? []
    const nameless = fields.filter(f => !f.name).length
    if (nameless > 0) {
      const ep = firstLine(p.text)
      console.log(`[BUG-30 signal] ${ep}  nameless fields: ${nameless}`)
    }
  }

  // BUG-6: display-only fields (could be listbox options)
  for (const p of withUI) {
    const fields = p.ui_context?.fields ?? []
    const display = fields.filter(f => f.isDisplayOnly)
    if (display.length > 0) {
      const ep = firstLine(p.text)
      const values = display.map(f => `"${f.value.slice(0, 20)}"`).join(",")
      console.log(`[BUG-6 signal] ${ep}  display-only fields (${display.length}): ${values}`)
    }
  }

  // Field count distribution
  const fieldCounts = withUI.map(p => p.ui_context?.fields?.length ?? 0)
  if (fieldCounts.length > 0) {
    const max = Math.max(...fieldCounts)
    const avg = (fieldCounts.reduce((a, b) => a + b, 0) / fieldCounts.length).toFixed(1)
    console.log(`\nField count per ui_context: avg=${avg}  max=${max}`)
  }
}

for (const file of files) {
  const records: Record[] = await Bun.file(`${BASELINE_DIR}/${file}`).json()
  analyze(file, records)
}

console.log(`\n${"=".repeat(90)}`)
console.log(`DONE — ${files.length} baselines analyzed`)

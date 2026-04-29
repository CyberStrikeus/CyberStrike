// Post Aşama 13 regression — baseline (2026-04-18) vs post-Aşama-13
// Checks that Aşama 13 changes didn't regress the 7 test-case baselines.

import { readdirSync } from "fs"

const BASELINE_DIR = "./dummy-api/logs/baseline-20260418"
const POST_DIR = "/tmp/post-a13-regression"

const TESTS = [
  "tabs-radio",
  "conditional-wizard",
  "dropdown-slider",
  "complex-table",
  "spa-hash-routing",
  "submit-button-trap",
  "multi-step-wizard",
]

interface Metrics {
  totalPayloads: number
  uniqueEndpoints: number
  uiCount: number
  totalFields: number
  maxFields: number
  mutatingEndpoints: number
  hiddenReasonPopulated: number
  emptyStateMarks: number // count of payloads with ui_context on DELETE (BUG-19 regression guard)
  deleteWithFields: number
}

async function load(path: string): Promise<any[]> {
  return await Bun.file(path).json()
}

function analyze(data: any[]): Metrics {
  const ps = data.map((d: any) => d.payload).filter((p: any) => p.text?.includes("HTTP/1.1"))
  const endpoints = new Set<string>()
  const mutating = new Set<string>()
  const m: Metrics = {
    totalPayloads: ps.length,
    uniqueEndpoints: 0,
    uiCount: 0,
    totalFields: 0,
    maxFields: 0,
    mutatingEndpoints: 0,
    hiddenReasonPopulated: 0,
    emptyStateMarks: 0,
    deleteWithFields: 0,
  }
  for (const p of ps) {
    const first = (p.text || "").split(/\r?\n/)[0]
    endpoints.add(first)
    if (!first.startsWith("GET")) mutating.add(first)
    if (!p.ui_context) continue
    m.uiCount++
    const fields = p.ui_context.fields ?? []
    m.totalFields += fields.length
    m.maxFields = Math.max(m.maxFields, fields.length)
    for (const f of fields) if (f.hiddenReason) m.hiddenReasonPopulated++
    if (first.startsWith("DELETE") && fields.length > 0) m.deleteWithFields++
  }
  m.uniqueEndpoints = endpoints.size
  m.mutatingEndpoints = mutating.size
  return m
}

function fmt(n: number): string {
  return String(n).padStart(4)
}
function arrow(before: number, after: number, invertGood = false): string {
  if (before === after) return "="
  const improved = invertGood ? after > before : after < before
  return improved ? "↓" : "↑"
}

console.log("=".repeat(100))
console.log("Aşama 13 Regression — baseline (2026-04-18) vs post-Aşama-13 (today)")
console.log("=".repeat(100))
console.log()
console.log("Interpretation:")
console.log("  payloads/endpoints/mutating: coverage — should stay SAME or UP")
console.log("  fields/max/delWithFields: noise — should stay SAME or DOWN")
console.log()

const headers = ["test", "payloads", "endpoints", "mutating", "uiCtx", "fields", "max", "hiddenRsn", "delWithFields"]
console.log(headers.map((h) => h.padEnd(12)).join(""))

for (const t of TESTS) {
  const b = analyze(await load(`${BASELINE_DIR}/${t}.json`))
  const a = analyze(await load(`${POST_DIR}/${t}.json`))

  const row = [
    t.slice(0, 12).padEnd(12),
    `${fmt(b.totalPayloads)}→${fmt(a.totalPayloads)}${arrow(a.totalPayloads, b.totalPayloads, true)}`.padEnd(12),
    `${fmt(b.uniqueEndpoints)}→${fmt(a.uniqueEndpoints)}${arrow(a.uniqueEndpoints, b.uniqueEndpoints, true)}`.padEnd(
      12,
    ),
    `${fmt(b.mutatingEndpoints)}→${fmt(a.mutatingEndpoints)}${arrow(a.mutatingEndpoints, b.mutatingEndpoints, true)}`.padEnd(
      12,
    ),
    `${fmt(b.uiCount)}→${fmt(a.uiCount)}`.padEnd(12),
    `${fmt(b.totalFields)}→${fmt(a.totalFields)}${arrow(b.totalFields, a.totalFields)}`.padEnd(12),
    `${fmt(b.maxFields)}→${fmt(a.maxFields)}${arrow(b.maxFields, a.maxFields)}`.padEnd(12),
    `${fmt(b.hiddenReasonPopulated)}→${fmt(a.hiddenReasonPopulated)}`.padEnd(12),
    `${fmt(b.deleteWithFields)}→${fmt(a.deleteWithFields)}${arrow(b.deleteWithFields, a.deleteWithFields)}`.padEnd(12),
  ]
  console.log(row.join(""))
}

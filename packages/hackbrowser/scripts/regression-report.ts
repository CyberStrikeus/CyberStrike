// Full baseline vs post-Küme-A regression report
// Usage: bun run scripts/regression-report.ts

const BASELINE_DIR = "./dummy-api/logs/baseline-20260418"
const POST_DIR = "/tmp/post-kumeA"

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
  radioFields: number
  radioNamesDup: number // how many radio field-sets have duplicate name (BUG-15 signal)
  displayOnly: number
  nameless: number
  hiddenFields: number
  hiddenReasonPopulated: number // BUG-17 — new signal
  deleteWithFields: number // BUG-19 signal
  formNameDup: number // BUG-14 signal — count of different endpoints sharing a formName
}

async function load(path: string): Promise<any[]> {
  return await Bun.file(path).json()
}

function analyze(data: any[]): Metrics {
  const ps = data.map((d: any) => d.payload).filter((p: any) => p.text?.includes("HTTP/1.1"))
  const endpoints = new Set<string>()
  const formNameEPs = new Map<string, Set<string>>()
  const m: Metrics = {
    totalPayloads: ps.length,
    uniqueEndpoints: 0,
    uiCount: 0,
    totalFields: 0,
    maxFields: 0,
    radioFields: 0,
    radioNamesDup: 0,
    displayOnly: 0,
    nameless: 0,
    hiddenFields: 0,
    hiddenReasonPopulated: 0,
    deleteWithFields: 0,
    formNameDup: 0,
  }

  for (const p of ps) {
    const first = (p.text || "").split(/\r?\n/)[0]
    endpoints.add(first)
    if (!p.ui_context) continue
    m.uiCount++
    const fields = p.ui_context.fields ?? []
    m.totalFields += fields.length
    m.maxFields = Math.max(m.maxFields, fields.length)

    // Radio split signal — count how many radio groups have >1 entry per name
    const radioNameCount = new Map<string, number>()
    for (const f of fields) {
      if (f.type === "radio") {
        m.radioFields++
        radioNameCount.set(f.name, (radioNameCount.get(f.name) ?? 0) + 1)
      }
      if (f.isDisplayOnly) m.displayOnly++
      if (!f.name) m.nameless++
      if (f.isHidden) m.hiddenFields++
      if (f.hiddenReason) m.hiddenReasonPopulated++
    }
    for (const count of radioNameCount.values()) {
      if (count > 1) m.radioNamesDup++
    }

    // BUG-19 signal: DELETE with non-empty ui_context
    if (first.startsWith("DELETE") && fields.length > 0) m.deleteWithFields++

    // BUG-14 signal: formName shared across endpoints
    const fn = p.ui_context.formName ?? ""
    if (!formNameEPs.has(fn)) formNameEPs.set(fn, new Set())
    formNameEPs.get(fn)!.add(first)
  }
  m.uniqueEndpoints = endpoints.size
  for (const eps of formNameEPs.values()) {
    if (eps.size > 1) m.formNameDup += eps.size
  }
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
console.log("Küme A Regression Report — Baseline (pre-fix) vs Post-Küme-A")
console.log("=".repeat(100))
console.log()

const cols = [
  "test",
  "payloads",
  "endpoints",
  "uiCtx",
  "fields",
  "max",
  "radio",
  "radioDup",
  "displayO",
  "nameless",
  "hidden",
  "withReason",
  "delWithFields",
  "fnDup",
]
console.log(cols.map((c) => c.padEnd(10)).join(""))

const totals = { coverage: 0, noise: 0, uiCount: 0 }

for (const t of TESTS) {
  const b = analyze(await load(`${BASELINE_DIR}/${t}.json`))
  const a = analyze(await load(`${POST_DIR}/${t}.json`))

  const row = [
    t.slice(0, 10).padEnd(10),
    `${fmt(b.totalPayloads)}→${fmt(a.totalPayloads)}${arrow(a.totalPayloads, b.totalPayloads, true)}`.padEnd(10),
    `${fmt(b.uniqueEndpoints)}→${fmt(a.uniqueEndpoints)}${arrow(a.uniqueEndpoints, b.uniqueEndpoints, true)}`.padEnd(
      10,
    ),
    `${fmt(b.uiCount)}→${fmt(a.uiCount)}`.padEnd(10),
    `${fmt(b.totalFields)}→${fmt(a.totalFields)}${arrow(b.totalFields, a.totalFields)}`.padEnd(10),
    `${fmt(b.maxFields)}→${fmt(a.maxFields)}${arrow(b.maxFields, a.maxFields)}`.padEnd(10),
    `${fmt(b.radioFields)}→${fmt(a.radioFields)}${arrow(b.radioFields, a.radioFields)}`.padEnd(10),
    `${fmt(b.radioNamesDup)}→${fmt(a.radioNamesDup)}${arrow(b.radioNamesDup, a.radioNamesDup)}`.padEnd(10),
    `${fmt(b.displayOnly)}→${fmt(a.displayOnly)}${arrow(b.displayOnly, a.displayOnly)}`.padEnd(10),
    `${fmt(b.nameless)}→${fmt(a.nameless)}${arrow(b.nameless, a.nameless)}`.padEnd(10),
    `${fmt(b.hiddenFields)}→${fmt(a.hiddenFields)}`.padEnd(10),
    `${fmt(b.hiddenReasonPopulated)}→${fmt(a.hiddenReasonPopulated)}${arrow(a.hiddenReasonPopulated, b.hiddenReasonPopulated, true)}`.padEnd(
      10,
    ),
    `${fmt(b.deleteWithFields)}→${fmt(a.deleteWithFields)}${arrow(b.deleteWithFields, a.deleteWithFields)}`.padEnd(10),
    `${fmt(b.formNameDup)}→${fmt(a.formNameDup)}${arrow(b.formNameDup, a.formNameDup)}`.padEnd(10),
  ]
  console.log(row.join(""))
}

console.log()
console.log("Legend:")
console.log("  payloads/endpoints: coverage — should stay same or go UP")
console.log("  fields/max/radio/displayO/nameless/delWithFields/fnDup: noise — should go DOWN")
console.log("  withReason: BUG-17 signal — should go UP from 0")
console.log("  ↓ = noise reduced (good)   ↑ = noise increased (bad)   = = unchanged")

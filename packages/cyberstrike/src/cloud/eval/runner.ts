import { classifyFinding } from "../classify"
import { EVAL_CASES } from "./fixtures"
import type { EvalCase } from "./fixtures"

interface EvalResult {
  case: string
  checkId: string
  type: "classification"
  expected: string
  actual: string
  pass: boolean
}

function evalClassification(c: EvalCase): EvalResult[] {
  const results: EvalResult[] = []
  for (const f of c.findings) {
    const expected = c.expectedClassification[f.checkId]
    if (!expected) continue
    const actual = classifyFinding(f)
    results.push({
      case: c.name,
      checkId: f.checkId,
      type: "classification",
      expected,
      actual,
      pass: actual === expected,
    })
  }
  return results
}

export function runEvals(): { results: EvalResult[]; passed: number; failed: number; total: number } {
  const results: EvalResult[] = []
  for (const c of EVAL_CASES) {
    results.push(...evalClassification(c))
  }
  const passed = results.filter((r) => r.pass).length
  const failed = results.filter((r) => !r.pass).length
  return { results, passed, failed, total: results.length }
}

if (import.meta.main) {
  const { results, passed, failed, total } = runEvals()
  console.log(`\nCloud Eval: ${passed}/${total} passed, ${failed} failed\n`)
  for (const r of results) {
    const icon = r.pass ? "✓" : "✗"
    const line = `  ${icon} [${r.type}] ${r.case}/${r.checkId}: expected=${r.expected} actual=${r.actual}`
    if (!r.pass) console.error(line)
    else console.log(line)
  }
  if (failed > 0) process.exit(1)
}

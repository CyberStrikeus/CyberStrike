// Business-logic probe orchestrator (plan §05 business_test). Composes the
// race engine, boundary-value library, and workflow-skip generator with the
// shared HttpSender transport. Three probe modes: race (concurrent TOCTOU),
// boundary (field-value sweep), workflow-skip (step omission). The agent picks
// the mode and interprets the results.
import type { HttpSender, ProbeRequest } from "../transport"
import { RaceEngine, type RaceReport } from "./race"
import { BoundaryValues, type FieldClass, type BoundaryValue } from "./boundary"

export interface BoundaryTargetResult {
  value: string
  label: string
  category: FieldClass
  status: number | null
  bodyLength: number
  bodyPreview: string
  differsFromBaseline: boolean
  error?: string
}

export interface BoundaryProbeReport {
  field: string
  fieldClass: FieldClass
  baselineStatus: number | null
  results: BoundaryTargetResult[]
  anomalies: string[]
}

const BODY_PREVIEW_LEN = 200

export class BusinessProbe {
  constructor(private readonly sender: HttpSender) {}

  /** Race mode: fire N concurrent identical requests, detect TOCTOU. */
  async race(input: { request: ProbeRequest; count?: number; concurrency?: number }): Promise<RaceReport> {
    return new RaceEngine(this.sender).run(input)
  }

  /** Boundary mode: sweep a field with boundary values, compare to baseline. */
  async boundary(input: {
    request: ProbeRequest
    field: string
    fieldClass?: FieldClass
    categories?: FieldClass[]
    limit?: number
    injectFn: (req: ProbeRequest, field: string, value: string) => ProbeRequest
  }): Promise<BoundaryProbeReport> {
    const fieldClass = input.fieldClass ?? BoundaryValues.forField(input.field)
    const values = BoundaryValues.select({
      categories: input.categories ?? [fieldClass],
      limit: input.limit,
    })

    // Baseline: the request as-is.
    const baselineResp = await this.sender.send(input.request)
    const baselineStatus = "error" in baselineResp ? null : baselineResp.status
    const baselineLength = "error" in baselineResp ? -1 : baselineResp.body.length

    const results: BoundaryTargetResult[] = []
    const anomalies: string[] = []

    for (const bv of values) {
      const mutated = input.injectFn(input.request, input.field, bv.value)
      const resp = await this.sender.send(mutated)

      if ("error" in resp) {
        results.push({
          value: bv.value,
          label: bv.label,
          category: bv.category,
          status: null,
          bodyLength: 0,
          bodyPreview: "",
          differsFromBaseline: true,
          error: resp.error,
        })
        anomalies.push(`${bv.label}: transport error (${resp.error})`)
        continue
      }

      const differs = resp.status !== baselineStatus || Math.abs(resp.body.length - baselineLength) > 50
      results.push({
        value: bv.value,
        label: bv.label,
        category: bv.category,
        status: resp.status,
        bodyLength: resp.body.length,
        bodyPreview: resp.body.slice(0, BODY_PREVIEW_LEN),
        differsFromBaseline: differs,
      })

      if (differs) {
        anomalies.push(`${bv.label} (${bv.value}): status=${resp.status}, bodyLen=${resp.body.length} (baseline: status=${baselineStatus}, bodyLen=${baselineLength})`)
      }
    }

    return { field: input.field, fieldClass, baselineStatus, results, anomalies }
  }
}

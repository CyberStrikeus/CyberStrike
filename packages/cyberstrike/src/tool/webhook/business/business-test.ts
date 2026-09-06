// business_test — Business logic tool (plan §05). Composes the race engine
// (concurrent TOCTOU), boundary-value library (field sweep), workflow-skip
// generator (step omission), and the shared transport. Three modes:
//
//   race    — fire N concurrent copies, detect inconsistent responses
//   boundary — sweep a field with edge values, flag anomalies vs baseline
//   workflow — given ordered endpoints, try skipping steps
//
// The Tool.define is a thin shell; BusinessTest.run is the testable core (mock
// HttpSender, no socket).
import z from "zod"
import { Tool } from "../../tool"
import { webhookContext, toolResult, toolError } from "../define"
import { SignalStore } from "../../../session/web/signal/store"
import { BusinessProbe, type BoundaryProbeReport } from "./probe"
import type { RaceReport } from "./race"
import type { HttpSender, ProbeRequest } from "../transport"
import { WorkflowSkip, type WorkflowStep } from "./workflow"

export namespace BusinessTest {
  export type Mode = "race" | "boundary" | "workflow"

  export interface RaceInput {
    mode: "race"
    request: ProbeRequest
    count?: number
    concurrency?: number
  }

  export interface BoundaryInput {
    mode: "boundary"
    request: ProbeRequest
    field: string
    fieldClass?: "integer" | "price" | "quantity" | "string" | "id"
    limit?: number
  }

  export interface WorkflowInput {
    mode: "workflow"
    steps: WorkflowStep[]
  }

  export type Input = RaceInput | BoundaryInput | WorkflowInput

  export interface RaceResult {
    mode: "race"
    report: RaceReport
  }

  export interface BoundaryResult {
    mode: "boundary"
    report: BoundaryProbeReport
  }

  export interface WorkflowResult {
    mode: "workflow"
    candidates: ReturnType<typeof WorkflowSkip.generate>
    probeResults: Array<{
      name: string
      strategy: string
      status: number | null
      bodyLength: number
      bodyPreview: string
      error?: string
    }>
  }

  export type Result = RaceResult | BoundaryResult | WorkflowResult

  export async function run(input: Input, sender: HttpSender): Promise<Result | { error: string }> {
    const probe = new BusinessProbe(sender)

    switch (input.mode) {
      case "race": {
        const report = await probe.race({
          request: input.request,
          count: input.count,
          concurrency: input.concurrency,
        })
        return { mode: "race", report }
      }

      case "boundary": {
        const report = await probe.boundary({
          request: input.request,
          field: input.field,
          fieldClass: input.fieldClass,
          limit: input.limit,
          injectFn: injectQueryParam,
        })
        return { mode: "boundary", report }
      }

      case "workflow": {
        if (input.steps.length < 2) {
          return { error: "Workflow mode requires at least 2 ordered steps." }
        }
        const candidates = WorkflowSkip.generate(input.steps)
        const probeResults: WorkflowResult["probeResults"] = []

        for (const c of candidates) {
          const resp = await sender.send(c.request)
          if ("error" in resp) {
            probeResults.push({ name: c.name, strategy: c.strategy, status: null, bodyLength: 0, bodyPreview: "", error: resp.error })
          } else {
            probeResults.push({ name: c.name, strategy: c.strategy, status: resp.status, bodyLength: resp.body.length, bodyPreview: resp.body.slice(0, 200) })
          }
        }

        return { mode: "workflow", candidates, probeResults }
      }
    }
  }
}

function injectQueryParam(req: ProbeRequest, field: string, value: string): ProbeRequest {
  try {
    const u = new URL(req.url)
    u.searchParams.set(field, value)
    return { ...req, url: u.toString() }
  } catch {
    return req
  }
}

const FIELD_CLASS = z.enum(["integer", "price", "quantity", "string", "id"])

const DESCRIPTION = `Test a captured request for business-logic flaws. Three modes:

**race** — fire N concurrent identical requests to detect TOCTOU race conditions (coupon double-spend, balance double-debit, concurrent order placement). Reports status distribution, timing, and inconsistency signals.

**boundary** — sweep a field with boundary values (zero, negative, overflow, type confusion) and compare each response to the baseline. Flags anomalies: price=0 accepted, quantity=-1 processed, integer overflow.

**workflow** — given an ordered list of request_ids representing a business flow (add-to-cart → shipping → payment → confirm), generate and probe skip candidates: jump to the last step, skip middle steps, reverse order, replay after completion.

Facts + leads — the agent confirms and weaponizes.`

export const BusinessTestTool = Tool.define("business_test", {
  description: DESCRIPTION,
  parameters: z.object({
    mode: z.enum(["race", "boundary", "workflow"]).describe("Test mode."),
    request_id: z.string().optional().describe("Captured request to test (required for race and boundary modes)."),
    count: z.number().int().positive().optional().describe("race: number of concurrent requests (default 20)."),
    concurrency: z.number().int().positive().optional().describe("race: max in-flight requests (default 20)."),
    field: z.string().optional().describe("boundary: the query parameter to sweep with boundary values."),
    field_class: FIELD_CLASS.optional().describe("boundary: override the auto-detected field type."),
    limit: z.number().int().positive().optional().describe("boundary: cap the number of values tested."),
    step_request_ids: z.array(z.string()).optional().describe("workflow: ordered list of captured request_ids forming a business flow."),
  }),
  async execute(params, ctx) {
    const wctx = webhookContext(ctx)
    const NAME = "business_test"
    const err = (msg: string) => toolError(NAME, msg)

    if (params.mode === "race" || params.mode === "boundary") {
      if (!params.request_id) return err("race/boundary mode requires request_id.")
      const resolved = wctx.resolve(params.request_id)
      if ("error" in resolved) return err(resolved.error)

      if (params.mode === "race") {
        const result = await BusinessTest.run(
          { mode: "race", request: resolved, count: params.count, concurrency: params.concurrency },
          wctx.sender,
        )
        if ("error" in result) return err(result.error)
        const r = result as BusinessTest.RaceResult
        if (r.report.rateLimitAbsent) {
          new SignalStore(wctx.sessionID).record({
            type: "rate_limit_absent",
            owner: "business-logic",
            requestId: params.request_id,
            evidence: `${r.report.count} concurrent requests, zero 429 responses (status distribution: ${Object.entries(r.report.statusDistribution).map(([s, c]) => `${s}×${c}`).join(", ")})`,
            meta: { count: r.report.count, concurrency: r.report.concurrency, statusDistribution: r.report.statusDistribution },
          })
        }
        const label = r.report.inconsistent ? `TOCTOU signals detected (${r.report.signals.length})` : "no race condition detected"
        return toolResult(NAME + " race", label, r.report)
      }

      // boundary
      if (!params.field) return err("boundary mode requires field (the query parameter to sweep).")
      const result = await BusinessTest.run(
        { mode: "boundary", request: resolved, field: params.field, fieldClass: params.field_class, limit: params.limit },
        wctx.sender,
      )
      if ("error" in result) return err(result.error)
      const b = result as BusinessTest.BoundaryResult
      const anomalyCount = b.report.anomalies.length
      const label = anomalyCount > 0 ? `${anomalyCount} anomal${anomalyCount === 1 ? "y" : "ies"} detected` : "no anomalies"
      return toolResult(NAME + " boundary", label, b.report)
    }

    // workflow
    if (!params.step_request_ids || params.step_request_ids.length < 2) {
      return err("workflow mode requires step_request_ids with at least 2 ordered request IDs.")
    }
    const steps: WorkflowStep[] = []
    for (let i = 0; i < params.step_request_ids.length; i++) {
      const resolved = wctx.resolve(params.step_request_ids[i])
      if ("error" in resolved) return err(`Step ${i + 1}: ${resolved.error}`)
      steps.push({ name: `step-${i + 1}`, order: i + 1, request: resolved })
    }

    const result = await BusinessTest.run({ mode: "workflow", steps }, wctx.sender)
    if ("error" in result) return err(result.error)
    const w = result as BusinessTest.WorkflowResult
    const successSkips = w.probeResults.filter((r) => r.status !== null && r.status >= 200 && r.status < 300).length
    const label = successSkips > 0 ? `${successSkips} skip(s) returned 2xx (verify)` : "all skips blocked"
    return toolResult(NAME + " workflow", label, w)
  },
})

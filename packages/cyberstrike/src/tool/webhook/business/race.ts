// Race-condition engine (plan §05 business_test). Sends N identical requests
// concurrently via the injected HttpSender, measures per-request timing, and
// analyses the response set for TOCTOU indicators: status inconsistencies,
// body-length variance, multiple-success on a once-only operation.
//
// Uses Batch.run (replay/batch.ts) for bounded concurrency — the same proven
// primitive http_replay's sweep mode uses. Pure orchestration; the agent
// decides whether an inconsistency is exploitable.
import { Batch } from "@/replay/batch"
import type { HttpSender, ProbeRequest, ProbeResponse } from "../transport"

export interface RaceRequestResult {
  index: number
  status: number | null
  bodyLength: number
  durationMs: number
  bodyPreview: string
  error?: string
}

export interface RaceReport {
  count: number
  concurrency: number
  statusDistribution: Record<number, number>
  successCount: number
  uniqueBodyLengths: number[]
  timingRange: { minMs: number; maxMs: number; medianMs: number }
  inconsistent: boolean
  signals: string[]
  results: RaceRequestResult[]
}

export interface RaceInput {
  request: ProbeRequest
  count?: number
  concurrency?: number
  delayMs?: number
}

const DEFAULT_COUNT = 20
const DEFAULT_CONCURRENCY = 20
const BODY_PREVIEW_LEN = 200

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export class RaceEngine {
  constructor(private readonly sender: HttpSender) {}

  async run(input: RaceInput): Promise<RaceReport> {
    const count = input.count ?? DEFAULT_COUNT
    const concurrency = input.concurrency ?? DEFAULT_CONCURRENCY

    const items = Array.from({ length: count }, (_, i) => i)

    const worker = async (index: number): Promise<RaceRequestResult> => {
      const start = performance.now()
      const resp = await this.sender.send(input.request)
      const durationMs = Math.round((performance.now() - start) * 100) / 100

      if ("error" in resp) {
        return { index, status: null, bodyLength: 0, durationMs, bodyPreview: "", error: resp.error }
      }
      return {
        index,
        status: resp.status,
        bodyLength: resp.body.length,
        durationMs,
        bodyPreview: resp.body.slice(0, BODY_PREVIEW_LEN),
      }
    }

    const raw = await Batch.run(items, worker, { concurrency })
    const results: RaceRequestResult[] = raw.map(
      (r, i) => r ?? { index: i, status: null, bodyLength: 0, durationMs: 0, bodyPreview: "", error: "worker threw" },
    )

    return analyze(results, count, concurrency)
  }
}

function analyze(results: RaceRequestResult[], count: number, concurrency: number): RaceReport {
  const statusDist: Record<number, number> = {}
  const durations: number[] = []
  const successLengths: number[] = []

  for (const r of results) {
    if (r.status !== null) {
      statusDist[r.status] = (statusDist[r.status] ?? 0) + 1
      if (r.status >= 200 && r.status < 300) successLengths.push(r.bodyLength)
    }
    durations.push(r.durationMs)
  }

  const successCount = successLengths.length
  const uniqueBodyLengths = [...new Set(successLengths)].sort((a, b) => a - b)
  const sortedDurations = [...durations].sort((a, b) => a - b)
  const timingRange = {
    minMs: sortedDurations[0] ?? 0,
    maxMs: sortedDurations[sortedDurations.length - 1] ?? 0,
    medianMs: median(sortedDurations),
  }

  const signals: string[] = []
  let inconsistent = false

  // Signal: multiple distinct status codes among responses
  const distinctStatuses = Object.keys(statusDist).length
  if (distinctStatuses > 1) {
    signals.push(`mixed-status: ${distinctStatuses} distinct status codes (${Object.entries(statusDist).map(([s, c]) => `${s}×${c}`).join(", ")})`)
    inconsistent = true
  }

  // Signal: multiple 2xx successes on what might be a once-only operation
  if (successCount > 1) {
    signals.push(`multiple-success: ${successCount}/${count} returned 2xx`)
    if (uniqueBodyLengths.length > 1) {
      signals.push(`varying-body: ${uniqueBodyLengths.length} distinct body lengths among successes`)
    }
    inconsistent = true
  }

  // Signal: some responses errored while others succeeded
  const errorCount = results.filter((r) => r.error).length
  if (errorCount > 0 && errorCount < count) {
    signals.push(`partial-error: ${errorCount}/${count} transport errors (may indicate resource contention)`)
  }

  return { count, concurrency, statusDistribution: statusDist, successCount, uniqueBodyLengths, timingRange, inconsistent, signals, results }
}

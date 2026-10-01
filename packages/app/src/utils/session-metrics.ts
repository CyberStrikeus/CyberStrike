import type { AssistantMessage, Message, Model } from "@cyberstrike-io/sdk/v2"

export interface TokenBreakdown {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface SessionMetricsInput {
  messages: Message[]
  model: Model | undefined
  treeUsage: { totalTokens: number; totalCost: number } | undefined
  hackbrowserCost: number
}

export class SessionMetrics {
  readonly contextTokens: number
  readonly contextLimit: number | null
  readonly contextUsedPercent: number | null
  readonly compactionCount: number
  readonly contextOverflowCount: number
  readonly totalCost: number
  readonly avgCostPerMessage: number
  readonly treeCost: { tokens: number; cost: number } | undefined
  readonly currentTokens: TokenBreakdown
  readonly cumulativeTokens: TokenBreakdown
  readonly cacheHitRate: number | null
  readonly messageCount: { total: number; user: number; assistant: number }
  readonly sessionDuration: number | null
  readonly activeModel: { id: string; providerID: string; name: string } | null
  readonly finishReasons: Record<string, number>
  readonly agentDistribution: { name: string; count: number; cost: number }[]
  readonly hasData: boolean

  constructor(input: SessionMetricsInput) {
    const msgs = input.messages
    const assistants = msgs.filter((m): m is AssistantMessage => m.role === "assistant")
    const nonCompaction = assistants.filter((m) => !m.summary)

    const last = nonCompaction.findLast((m) => SessionMetrics.tokenTotal(m) > 0)

    this.hasData = !!last

    this.contextTokens = last ? SessionMetrics.tokenTotal(last) : 0
    this.contextLimit = input.model?.limit.context ?? null
    this.contextUsedPercent =
      this.contextLimit && this.contextTokens > 0
        ? Math.round((this.contextTokens / this.contextLimit) * 100)
        : null
    this.compactionCount = assistants.filter((m) => m.summary === true).length
    this.contextOverflowCount = assistants.filter((m) => {
      const err = m.error as { _tag?: string } | undefined
      return err?._tag === "ContextOverflowError"
    }).length

    if (last) {
      const t = last.tokens
      this.currentTokens = {
        input: t.input,
        output: t.output,
        reasoning: t.reasoning,
        cacheRead: t.cache.read,
        cacheWrite: t.cache.write,
        total: SessionMetrics.tokenTotal(last),
      }
    } else {
      this.currentTokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }

    const cum = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    for (const m of assistants) {
      const t = m.tokens
      if (!t) continue
      cum.input += t.input
      cum.output += t.output
      cum.reasoning += t.reasoning
      cum.cacheRead += t.cache.read
      cum.cacheWrite += t.cache.write
      cum.total += SessionMetrics.tokenTotal(m)
    }
    this.cumulativeTokens = cum

    const totalInput = cum.input + cum.cacheRead + cum.cacheWrite
    this.cacheHitRate = totalInput > 0 ? Math.round((cum.cacheRead / totalInput) * 100) : null

    const messageCost = assistants.reduce((sum, m) => sum + (m.cost ?? 0), 0)
    this.totalCost = messageCost + input.hackbrowserCost
    this.avgCostPerMessage = nonCompaction.length > 0 ? messageCost / nonCompaction.length : 0
    this.treeCost = input.treeUsage
      ? { tokens: input.treeUsage.totalTokens, cost: input.treeUsage.totalCost }
      : undefined

    this.messageCount = {
      total: msgs.length,
      user: msgs.filter((m) => m.role === "user").length,
      assistant: nonCompaction.length,
    }

    if (msgs.length >= 2) {
      const first = (msgs[0] as { time?: { created?: number } }).time?.created
      const lastTime = (msgs[msgs.length - 1] as { time?: { created?: number } }).time?.created
      this.sessionDuration = first && lastTime ? lastTime - first : null
    } else {
      this.sessionDuration = null
    }

    this.activeModel = last
      ? { id: last.modelID, providerID: last.providerID, name: input.model?.name ?? last.modelID }
      : null

    const reasons: Record<string, number> = {}
    for (const m of nonCompaction) {
      const reason = m.finish || "unknown"
      reasons[reason] = (reasons[reason] ?? 0) + 1
    }
    this.finishReasons = reasons

    const agentMap = new Map<string, { count: number; cost: number }>()
    for (const m of assistants) {
      const name = m.agent || "default"
      const existing = agentMap.get(name)
      if (existing) {
        existing.count++
        existing.cost += m.cost ?? 0
      } else {
        agentMap.set(name, { count: 1, cost: m.cost ?? 0 })
      }
    }
    this.agentDistribution = [...agentMap.entries()]
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.count - a.count)
  }

  private static tokenTotal(m: AssistantMessage): number {
    const t = m.tokens
    if (!t) return 0
    return t.total ?? t.input + t.output + t.reasoning + t.cache.read + t.cache.write
  }

  static formatTokens(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
    if (n >= 1_000) return Math.round(n / 1_000) + "K"
    return String(n)
  }

  static formatCost(n: number): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)
  }

  static formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (minutes < 60) return `${minutes}m ${secs}s`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (hours < 24) return `${hours}h ${mins}m`
    const days = Math.floor(hours / 24)
    const hrs = hours % 24
    return `${days}d ${hrs}h`
  }

  static formatPercent(n: number | null): string {
    if (n === null) return "—"
    return `${n}%`
  }
}

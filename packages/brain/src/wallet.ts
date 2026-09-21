// Credit wallet — tracks token consumption and debits per-request.
//
// Two billing modes:
//   1. Managed (Pro/Enterprise): CyberStrike's API key, org pays via credits
//   2. BYO-key: user's own API key, no credit debit (token cost → user's provider)
//
// Credits abstract token costs: 1 credit ≈ 1,000 tokens (input+output blended).
// Enterprise plans include unlimited credits. Pro plans have a wallet balance.
import { Log } from "./log"

const log = Log.create("wallet")

export namespace Wallet {
  export interface Balance {
    credits: number
    unlimited: boolean
  }

  export interface Usage {
    requestId: string
    inputTokens: number
    outputTokens: number
    creditsUsed: number
    timestamp: number
  }

  // In-memory store — production: Stripe/DB-backed
  const balances = new Map<string, Balance>()
  const usageLog: Usage[] = []

  const TOKENS_PER_CREDIT = 1000
  const INPUT_WEIGHT = 1
  const OUTPUT_WEIGHT = 3

  export function setBalance(orgId: string, balance: Balance) {
    balances.set(orgId, balance)
  }

  export function getBalance(orgId: string): Balance {
    return balances.get(orgId) ?? { credits: 0, unlimited: false }
  }

  export function hasCredits(orgId: string, estimated: number): boolean {
    const bal = getBalance(orgId)
    if (bal.unlimited) return true
    return bal.credits >= estimated
  }

  export function debit(orgId: string, usage: Omit<Usage, "creditsUsed" | "timestamp">): Usage {
    const weighted = (usage.inputTokens * INPUT_WEIGHT + usage.outputTokens * OUTPUT_WEIGHT)
    const creditsUsed = Math.ceil(weighted / TOKENS_PER_CREDIT)

    const entry: Usage = {
      ...usage,
      creditsUsed,
      timestamp: Date.now(),
    }
    usageLog.push(entry)

    const bal = getBalance(orgId)
    if (!bal.unlimited) {
      bal.credits = Math.max(0, bal.credits - creditsUsed)
      balances.set(orgId, bal)
    }

    log.info("debited", {
      orgId,
      creditsUsed,
      remaining: bal.unlimited ? "unlimited" : bal.credits,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    })

    return entry
  }

  export function estimateCost(domain: string): number {
    // Rough estimates per domain (in credits)
    const estimates: Record<string, number> = {
      aws: 50,
      azure: 40,
      gcp: 35,
      internal: 30,
      web: 60,
      mobile: 45,
    }
    return estimates[domain] ?? 40
  }

  export function getUsage(orgId: string, since?: number): Usage[] {
    // TODO: filter by orgId when org tracking is added
    if (since) return usageLog.filter((u) => u.timestamp >= since)
    return [...usageLog]
  }
}

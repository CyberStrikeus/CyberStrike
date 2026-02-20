import { Log } from "../util/log"
import { Config } from "../config/config"
import { Provider } from "../provider/provider"

export namespace MemoryFlush {
  const log = Log.create({ service: "session.memory-flush" })

  export const SILENT_REPLY_TOKEN = "NO_REPLY"
  const DEFAULT_SOFT_THRESHOLD_TOKENS = 4_000
  const DEFAULT_RESERVE_TOKENS_FLOOR = 20_000
  export const DEFAULT_SYSTEM_PROMPT = "Pre-compaction memory flush. Store durable memories now."
  export const DEFAULT_PROMPT =
    "Write lasting notes to memory using the write_file tool targeting .cyberstrike/memory/ directory. " +
    "Focus on key decisions, architectural patterns, discovered constraints, and critical context. " +
    "If there is nothing worth persisting, reply with exactly: NO_REPLY"

  // Track which sessions have already flushed in a given compaction cycle (in-memory)
  const flushedCycles = new Map<string, number>()

  function flushKey(sessionID: string): string {
    return sessionID
  }

  /** Check if memory flush should run before compaction. */
  export async function shouldFlush(input: {
    tokens: { input: number; output: number; cache: { read: number; write: number }; total?: number }
    model: Provider.Model
    sessionID: string
    compactionCycle: number
  }): Promise<boolean> {
    const config = await Config.get()
    const flushConfig = config.compaction?.memoryFlush

    // Disabled by config
    if (flushConfig?.enabled === false) return false

    // Already flushed this cycle
    if (wasFlushedThisCycle(input.sessionID, input.compactionCycle)) return false

    const contextWindow = input.model.limit.context
    if (contextWindow === 0) return false

    const reserveFloor = flushConfig?.reserveTokensFloor ?? DEFAULT_RESERVE_TOKENS_FLOOR
    const softThreshold = flushConfig?.softThresholdTokens ?? DEFAULT_SOFT_THRESHOLD_TOKENS
    const flushTrigger = contextWindow - reserveFloor - softThreshold

    const totalTokens =
      input.tokens.total ||
      input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write

    const shouldRun = totalTokens >= flushTrigger
    if (shouldRun) {
      log.info("memory flush triggered", {
        totalTokens,
        flushTrigger,
        contextWindow,
        cycle: input.compactionCycle,
      })
    }
    return shouldRun
  }

  /** Check if the model's reply is a silent NO_REPLY. */
  export function isSilentReply(text: string): boolean {
    return text.trim() === SILENT_REPLY_TOKEN
  }

  /** Mark that this session has been flushed for a given cycle. */
  export function markFlushed(sessionID: string, cycle: number): void {
    flushedCycles.set(flushKey(sessionID), cycle)
  }

  /** Check if flush already ran for this compaction cycle. */
  export function wasFlushedThisCycle(sessionID: string, cycle: number): boolean {
    return flushedCycles.get(flushKey(sessionID)) === cycle
  }

  /** Count how many compaction cycles have occurred (assistant messages with summary === true). */
  export function countCompactionCycles(msgs: { info: { role: string } & Record<string, unknown> }[]): number {
    let count = 0
    for (const msg of msgs) {
      if (msg.info.role === "assistant" && (msg.info as { summary?: boolean }).summary === true) count++
    }
    return count
  }
}

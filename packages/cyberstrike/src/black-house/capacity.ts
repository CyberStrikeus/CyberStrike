export const DEFAULT_LOGICAL_AGENTS = 7_000_000
export const DEFAULT_SHARD_SIZE = 10_000

export interface CollectiveShard {
  readonly shardId: string
  readonly firstAgent: number
  readonly lastAgent: number
  readonly logicalAgents: number
}

export interface CollectiveCapacityPlan {
  readonly logicalAgents: number
  readonly shardSize: number
  readonly shardCount: number
  readonly shards: readonly CollectiveShard[]
}

function positiveSafeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`)
  }
}

export function createCollectiveCapacityPlan(
  logicalAgents = DEFAULT_LOGICAL_AGENTS,
  shardSize = DEFAULT_SHARD_SIZE,
): CollectiveCapacityPlan {
  positiveSafeInteger(logicalAgents, "logicalAgents")
  positiveSafeInteger(shardSize, "shardSize")

  const shardCount = Math.ceil(logicalAgents / shardSize)
  const shards = Array.from({ length: shardCount }, (_, index): CollectiveShard => {
    const firstAgent = index * shardSize
    const lastAgent = Math.min(firstAgent + shardSize - 1, logicalAgents - 1)

    return Object.freeze({
      shardId: `bh-${index.toString(36).padStart(4, "0")}`,
      firstAgent,
      lastAgent,
      logicalAgents: lastAgent - firstAgent + 1,
    })
  })

  return Object.freeze({
    logicalAgents,
    shardSize,
    shardCount,
    shards: Object.freeze(shards),
  })
}

export function locateLogicalAgent(plan: CollectiveCapacityPlan, agentIndex: number) {
  if (!Number.isSafeInteger(agentIndex) || agentIndex < 0 || agentIndex >= plan.logicalAgents) {
    throw new RangeError("agentIndex is outside this collective plan")
  }

  const shardIndex = Math.floor(agentIndex / plan.shardSize)
  return plan.shards[shardIndex]
}

export function virtualAgentId(agentIndex: number, namespace = "black-house") {
  if (!Number.isSafeInteger(agentIndex) || agentIndex < 0) {
    throw new RangeError("agentIndex must be a non-negative safe integer")
  }

  return `${namespace}:${agentIndex.toString(36).padStart(8, "0")}`
}

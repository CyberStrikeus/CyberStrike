import { describe, expect, test } from "bun:test"
import {
  createCollectiveCapacityPlan,
  DEFAULT_LOGICAL_AGENTS,
  DEFAULT_SHARD_SIZE,
  locateLogicalAgent,
  virtualAgentId,
} from "./capacity"
import { assertBlackHouseAuthorization, BLACK_HOUSE_COLLECTIVE_POLICY, BLACK_HOUSE_SCOPE } from "./policy"

describe("Black House collective capacity", () => {
  test("represents seven million logical agents in 700 shards", () => {
    const plan = createCollectiveCapacityPlan()

    expect(plan.logicalAgents).toBe(DEFAULT_LOGICAL_AGENTS)
    expect(plan.shardSize).toBe(DEFAULT_SHARD_SIZE)
    expect(plan.shardCount).toBe(700)
    expect(plan.shards).toHaveLength(700)
    expect(plan.shards[0]).toEqual({
      shardId: "bh-0000",
      firstAgent: 0,
      lastAgent: 9_999,
      logicalAgents: 10_000,
    })
    expect(plan.shards[699]?.lastAgent).toBe(6_999_999)
  })

  test("locates logical agents without allocating per-agent objects", () => {
    const plan = createCollectiveCapacityPlan()

    expect(locateLogicalAgent(plan, 0)?.shardId).toBe("bh-0000")
    expect(locateLogicalAgent(plan, 6_999_999)?.shardId).toBe("bh-00jf")
    expect(virtualAgentId(6_999_999)).toBe("black-house:000461bz")
  })

  test("enforces synthetic-range authorization and non-actuation policy", () => {
    expect(() =>
      assertBlackHouseAuthorization({ scope: BLACK_HOUSE_SCOPE, authorizedRangeId: "range-lab-01" }),
    ).not.toThrow()
    expect(() => assertBlackHouseAuthorization({ scope: "internet", authorizedRangeId: "range-lab-01" })).toThrow()
    expect(() => assertBlackHouseAuthorization({ scope: BLACK_HOUSE_SCOPE, authorizedRangeId: "" })).toThrow()

    expect(BLACK_HOUSE_COLLECTIVE_POLICY).toEqual({
      networkActuation: false,
      publicInternetTargets: false,
      credentialOperations: false,
      persistence: false,
      destructiveActions: false,
      dataExfiltration: false,
      trafficFlooding: false,
    })
  })
})

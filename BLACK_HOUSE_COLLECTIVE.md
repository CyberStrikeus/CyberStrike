# Black House Collective

Black House Collective is a **synthetic-range adversary-emulation control-plane design** for CyberStrikeZYRA. It models fleet-scale orchestration without creating a real-world attack swarm.

## Capacity target

| Item | Value |
| --- | ---: |
| Logical agents | 7,000,000 |
| Logical agents per shard | 10,000 |
| Deterministic shards | 700 |
| Scheduler complexity | O(shards) |
| Network actuation from collective | Disabled |

Seven million is a logical capacity target. The scheduler represents agents as deterministic numeric ranges rather than allocating seven million processes, sockets, workers, or agent objects.

## Shard model

For zero-based shard `s` and shard size `10,000`:

- first logical agent = `s * 10,000`
- last logical agent = `min(first + 9,999, 6,999,999)`
- shard count = `ceil(7,000,000 / 10,000) = 700`

This makes replay, telemetry aggregation, and capacity testing practical on a development machine.

## Execution boundary

The collective is restricted to an authorized synthetic range. Its scheduler must not perform network operations itself.

Required invariants:

- scope is `synthetic-range`
- an authorized range identifier is mandatory
- public-Internet discovery is disabled
- network actuation is disabled in the collective scheduler
- credential operations are disabled
- persistence mechanisms are disabled
- destructive actions are disabled
- data exfiltration is disabled
- traffic flooding is disabled

## Simulation scenarios

The control plane may generate aggregate events for these non-payload scenarios:

1. `surface-map` — synthetic asset/topology coverage.
2. `control-validation` — verifies policy and authorization boundaries.
3. `detection-pressure` — produces synthetic detection telemetry.
4. `containment-drill` — exercises containment state transitions.
5. `recovery-verification` — validates restoration and recovery workflows.

## Proposed package boundary

```text
packages/cyberstrike/src/black-house/
  types.ts
  policy.ts
  collective.ts
  simulation.ts
  index.ts
  collective.test.ts
```

The implementation should remain pure TypeScript with no socket, browser, shell, exploit, credential, persistence, or external-target primitives in this layer.

## Acceptance tests

- 7,000,000 logical agents produce exactly 700 shards at a shard size of 10,000.
- The final logical agent index is 6,999,999.
- Agent-to-shard lookup is deterministic.
- Memory growth is proportional to shard count, not logical-agent count.
- Any non-synthetic scope is rejected.
- Missing authorization metadata is rejected.
- One simulated cycle emits at most one aggregate record per shard per scenario.
- Every aggregate record states that network actuation is disabled.

## Black House role

Black House consumes the collective as a simulation and observability layer for authorized cyber-range exercises. Existing pentest capabilities in CyberStrikeZYRA remain separately permissioned and are not multiplied into a seven-million-node real-world attack fabric by this component.

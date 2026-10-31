import { z } from "zod";
import type { RetainedBrowserScenarioCapture } from "../browserScenarioCapture.js";
import { isImmutableJsonSnapshot } from "../immutableJson.js";
import { compareAsciiStrings } from "../canonicalOrdering.js";

const count = z.int().nonnegative();
const statusClass = z.enum([
  "1xx",
  "2xx",
  "3xx",
  "4xx",
  "5xx",
  "failed",
  "unknown",
]);

/** Counts concern retained transaction identities, including those without a request event. */
export const browserScenarioNetworkSummarySchema = z.strictObject({
  selected: z.boolean().nullable(),
  transactions: count.nullable(),
  without_request: count,
  ambiguous_transactions: count,
  failed_transactions: count,
  by_origin: z.array(
    z.strictObject({ origin: z.string().nullable(), transactions: count }),
  ),
  by_resource_type: z.array(
    z.strictObject({
      resource_type: z.string().nullable(),
      transactions: count,
    }),
  ),
  by_status_class: z.array(
    z.strictObject({ status_class: statusClass, transactions: count }),
  ),
});

interface TransactionGroup {
  readonly transaction_id: string;
  readonly source_item_indices: readonly number[];
  readonly origin: string | null;
  readonly resource_type: string | null;
  readonly status_class: z.infer<typeof statusClass>;
  readonly has_request: boolean;
  readonly failed: boolean;
  readonly ambiguous: boolean;
}

interface TransactionFacts {
  indices: number[];
  origins: Set<string | null>;
  resourceTypes: Set<string>;
  statuses: Set<number>;
  requests: number;
  failed: boolean;
}

/** Sealed historical captures own this metadata-only index until their retained lifetime ends. */
const transactionsByCapture = new WeakMap<
  object,
  readonly TransactionGroup[]
>();

/** Keep all observed alternatives; one missing event never erases its transaction. */
export const browserScenarioTransactionGroups = (
  capture: RetainedBrowserScenarioCapture,
): readonly TransactionGroup[] => {
  const reusable = isImmutableJsonSnapshot(capture);
  const known = reusable ? transactionsByCapture.get(capture) : undefined;
  if (known !== undefined) return known;
  const groups = new Map<string, TransactionFacts>();
  for (const [index, event] of capture.events.items.entries()) {
    if (!("transaction_id" in event)) continue;
    let group = groups.get(event.transaction_id);
    if (group === undefined) {
      group = {
        indices: [],
        origins: new Set(),
        resourceTypes: new Set(),
        statuses: new Set(),
        requests: 0,
        failed: false,
      };
      groups.set(event.transaction_id, group);
    }
    group.indices.push(index);
    if (event.kind === "network-content") continue;
    group.origins.add(event.url.origin);
    group.resourceTypes.add(event.resource_type);
    if (event.kind === "request") group.requests += 1;
    if (event.kind === "response") group.statuses.add(event.status);
    if (event.kind === "request-failed") group.failed = true;
  }
  const result = [...groups].map(
    ([transaction_id, group]): TransactionGroup => {
      const status = group.statuses.values().next().value;
      return Object.freeze({
        transaction_id,
        source_item_indices: Object.freeze(group.indices),
        origin:
          group.origins.size === 1
            ? (group.origins.values().next().value ?? null)
            : null,
        resource_type:
          group.resourceTypes.size === 1
            ? (group.resourceTypes.values().next().value ?? null)
            : null,
        status_class:
          group.statuses.size === 1 && status !== undefined
            ? (`${String(Math.floor(status / 100))}xx` as z.infer<
                typeof statusClass
              >)
            : group.statuses.size === 0 && group.failed
              ? "failed"
              : "unknown",
        has_request: group.requests > 0,
        failed: group.failed,
        ambiguous:
          group.requests > 1 ||
          group.statuses.size > 1 ||
          group.origins.size > 1 ||
          group.resourceTypes.size > 1,
      });
    },
  );
  if (reusable) transactionsByCapture.set(capture, result);
  return result;
};

const increment = <Key>(values: Map<Key, number>, key: Key): void => {
  values.set(key, (values.get(key) ?? 0) + 1);
};
const sorted = <Key extends string | null>(
  values: ReadonlyMap<Key, number>,
): [Key, number][] =>
  [...values].sort(([left], [right]) =>
    left === right
      ? 0
      : left === null
        ? -1
        : right === null
          ? 1
          : compareAsciiStrings(left, right),
  );

/** Null selection/counts preserve legacy unknowns and unrequested network observation. */
export const summarizeBrowserScenarioNetwork = (
  capture: RetainedBrowserScenarioCapture,
): z.infer<typeof browserScenarioNetworkSummarySchema> => {
  const groups = browserScenarioTransactionGroups(capture);
  const contentSelected = Object.values(capture.scenario.network_content).some(
    Boolean,
  );
  const selected =
    contentSelected ||
    capture.scenario.event_families?.includes("network") === true
      ? true
      : capture.scenario.event_families === undefined
        ? null
        : false;
  const origins = new Map<string | null, number>();
  const resources = new Map<string | null, number>();
  const statuses = new Map<z.infer<typeof statusClass>, number>();
  let withoutRequest = 0;
  let ambiguous = 0;
  let failed = 0;
  for (const group of groups) {
    if (!group.has_request) withoutRequest += 1;
    if (group.ambiguous) ambiguous += 1;
    if (group.failed) failed += 1;
    increment(origins, group.origin);
    increment(resources, group.resource_type);
    increment(statuses, group.status_class);
  }
  return {
    selected,
    transactions: selected === true || groups.length > 0 ? groups.length : null,
    without_request: withoutRequest,
    ambiguous_transactions: ambiguous,
    failed_transactions: failed,
    by_origin: sorted(origins).map(([origin, transactions]) => ({
      origin,
      transactions,
    })),
    by_resource_type: sorted(resources).map(
      ([resource_type, transactions]) => ({ resource_type, transactions }),
    ),
    by_status_class: sorted(statuses).map(([status_class, transactions]) => ({
      status_class,
      transactions,
    })),
  };
};

import type { BrowserScenarioEvent } from "./browserScenarioCaptureValues.js";

type ResponseEvent = Extract<BrowserScenarioEvent, { kind: "response" }>;
type ContentEvent = Extract<BrowserScenarioEvent, { kind: "network-content" }>;

/** Shared event identity lookups; projections retain their own ambiguity policy. */
export interface BrowserScenarioTransactionIndex {
  readonly requestCounts: ReadonlyMap<string, number>;
  readonly responses: ReadonlyMap<string, readonly ResponseEvent[]>;
  readonly contents: ReadonlyMap<number, readonly ContentEvent[]>;
}

/** Index the captured transaction and source-event identities without interpreting content. */
export const indexBrowserScenarioTransactions = (
  events: readonly BrowserScenarioEvent[],
): BrowserScenarioTransactionIndex => {
  const requestCounts = new Map<string, number>();
  const responses = new Map<string, ResponseEvent[]>();
  const contents = new Map<number, ContentEvent[]>();

  for (const event of events) {
    if (event.kind === "request")
      requestCounts.set(
        event.transaction_id,
        (requestCounts.get(event.transaction_id) ?? 0) + 1,
      );
    else if (event.kind === "response")
      append(responses, event.transaction_id, event);
    else if (event.kind === "network-content")
      append(contents, event.source_event_sequence, event);
  }

  return { requestCounts, responses, contents };
};

const append = <Key, Value>(
  map: Map<Key, Value[]>,
  key: Key,
  value: Value,
): void => {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, [value]);
  else existing.push(value);
};

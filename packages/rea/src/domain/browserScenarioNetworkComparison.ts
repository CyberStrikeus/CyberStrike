import { z } from "zod";
import type { RetainedBrowserScenarioCapture } from "./browserScenarioCapture.js";
import type { BrowserScenarioNormalizationRule } from "./browserScenarioDiffValues.js";
import { digestCanonicalValue } from "./canonicalDigest.js";
import { normalizeScenarioValue } from "./browserScenarioNormalization.js";
import { indexBrowserScenarioTransactions } from "./browserScenarioTransactions.js";

/** A comparison node lost the fingerprint its producer should have stored. */
export class ScenarioNetworkFingerprintError extends Error {
  readonly _tag = "ScenarioNetworkFingerprintError";
  readonly code = "missing_fingerprint" as const;

  constructor() {
    super("missing_fingerprint");
    this.name = "ScenarioNetworkFingerprintError";
  }
}

/** Numeric links are temporary local indices, never durable transaction identity. */
export const scenarioNetworkTransactionSchema = z.strictObject({
  events: z.array(z.unknown()),
  predecessor: z.int().min(-2),
  step_index: z.int().min(0),
});
export type ScenarioNetworkTransaction = z.infer<
  typeof scenarioNetworkTransactionSchema
>;

/** Project each transaction once, retaining ancestry as references rather than nested copies. */
export const scenarioNetworkTransactions = (
  capture: RetainedBrowserScenarioCapture,
): ScenarioNetworkTransaction[] => {
  const { requestCounts } = indexBrowserScenarioTransactions(
    capture.events.items,
  );
  const sourceSteps = new Map(
    capture.events.items.map((event) => [event.sequence, event.step_index]),
  );
  const requests = new Map(
    capture.events.items.flatMap((event) =>
      event.kind === "request" && requestCounts.get(event.transaction_id) === 1
        ? [[event.transaction_id, event]]
        : [],
    ),
  );
  const grouped = new Map<
    string,
    {
      events: unknown[];
      predecessor: string | null;
      predecessorState: "root" | "unknown" | undefined;
      predecessorConflict: boolean;
      stepIndex: number;
    }
  >();
  for (const { sequence: _sequence, step_index: step, ...event } of capture
    .events.items) {
    if (!("transaction_id" in event)) continue;
    const id = event.transaction_id;
    const request = requests.get(id);
    const receiptStep =
      event.kind === "network-content"
        ? sourceSteps.get(event.source_event_sequence)
        : step;
    const requestStep = request?.step_index ?? receiptStep;
    let evidence: unknown;
    let predecessor: string | null;
    let predecessorState: "root" | "unknown" | undefined;
    if (event.kind === "network-content") {
      const {
        transaction_id: _id,
        source_event_sequence: _source,
        ...content
      } = event;
      evidence = content;
      predecessor = request?.redirected_from_transaction_id ?? null;
      predecessorState = request?.redirected_from_transaction_state;
    } else {
      const {
        transaction_id: _id,
        redirected_from_transaction_id: parent,
        redirected_from_transaction_state: _state,
        ...network
      } = event;
      evidence = withoutRequestTiming(network);
      predecessor =
        request === undefined ? parent : request.redirected_from_transaction_id;
      predecessorState =
        request === undefined
          ? event.redirected_from_transaction_state
          : request.redirected_from_transaction_state;
    }
    const previous = grouped.get(id);
    if (previous === undefined)
      grouped.set(id, {
        events: [evidence],
        predecessor,
        predecessorState,
        predecessorConflict:
          event.kind !== "network-content" &&
          request !== undefined &&
          ((event.redirected_from_transaction_id !== null &&
            event.redirected_from_transaction_id !==
              request.redirected_from_transaction_id) ||
            (event.redirected_from_transaction_state === "root" &&
              request.redirected_from_transaction_id !== null)),
        stepIndex: requestStep ?? step,
      });
    else {
      previous.events.push(evidence);
      if (event.kind !== "network-content") {
        const parent = event.redirected_from_transaction_id;
        const state = event.redirected_from_transaction_state;
        const knownParent = previous.predecessor;
        if (
          parent !== null &&
          (knownParent !== null
            ? parent !== knownParent
            : previous.predecessorState === "root")
        )
          previous.predecessorConflict = true;
        else if (parent !== null && knownParent === null) {
          previous.predecessor = parent;
          previous.predecessorState = state;
        } else if (parent === null && state === "root" && knownParent !== null)
          previous.predecessorConflict = true;
        else if (
          parent === null &&
          state === "root" &&
          previous.predecessorState !== "root"
        )
          previous.predecessorState = "root";
      }
    }
  }
  const indices = new Map([...grouped.keys()].map((id, index) => [id, index]));
  return [...grouped.values()].map((node) => ({
    events: node.events,
    predecessor: node.predecessorConflict
      ? -2
      : node.predecessor === null
        ? node.predecessorState === "root"
          ? -1
          : -2
        : (indices.get(node.predecessor) ?? -2),
    step_index: node.stepIndex,
  }));
};

/** Missing or cyclic ancestry cannot support an unchanged claim. */
export const scenarioNetworkCoverageReason = (
  capture: RetainedBrowserScenarioCapture,
  nodes = scenarioNetworkTransactions(capture),
): string | undefined => {
  const { requestCounts } = indexBrowserScenarioTransactions(
    capture.events.items,
  );
  if ([...requestCounts.values()].some((count) => count > 1))
    return "Multiple requests share a transaction ID; network transaction identity remains unknown.";
  const finished = new Set<number>();
  for (let start = 0; start < nodes.length; start += 1) {
    const path = new Set<number>();
    let index = start;
    while (index >= 0 && !finished.has(index)) {
      if (path.has(index))
        return "Redirect ancestry contains a cycle; network transaction identity remains unknown.";
      path.add(index);
      const node = nodes[index];
      if (node === undefined)
        return "Redirect predecessor evidence is missing; network transaction identity remains unknown.";
      index = node.predecessor;
    }
    if (index === -2)
      return "Redirect predecessor evidence is missing; network transaction identity remains unknown.";
    for (const item of path) finished.add(item);
  }
  return undefined;
};

/** Request times differ on every run, so comparisons leave them out. */
const withoutRequestTiming = (event: object): object => {
  const {
    observed_at: _observed,
    started_at: _started,
    elapsed_ms: _elapsed,
    ...rest
  } = event as {
    observed_at?: unknown;
    started_at?: unknown;
    elapsed_ms?: unknown;
  };
  return rest;
};

/** Hash normalized own evidence and its complete parent fingerprint in linear graph space. */
export const fingerprintScenarioNetworkTransactions = (
  nodes: readonly ScenarioNetworkTransaction[],
  rules: readonly BrowserScenarioNormalizationRule[] = [],
): string[] => {
  const own = nodes.map((node) =>
    node.events
      .map((event) =>
        digestCanonicalValue(
          normalizeScenarioValue(event, "events", rules),
          "Browser scenario",
        ),
      )
      .sort(),
  );
  const fingerprints = new Map<number, string>();
  for (let start = 0; start < nodes.length; start += 1) {
    const path: number[] = [];
    const positions = new Map<number, number>();
    let index = start;
    while (
      index >= 0 &&
      nodes[index] !== undefined &&
      !fingerprints.has(index)
    ) {
      const position = positions.get(index);
      if (position !== undefined) {
        // These captures are incomparable; retain an explicit cycle observation.
        for (const member of path.slice(position))
          fingerprints.set(
            member,
            digestCanonicalValue(
              { events: own[member], redirected_from: { state: "cycle" } },
              "Browser scenario",
            ),
          );
        break;
      }
      positions.set(index, path.length);
      path.push(index);
      index = nodes[index]?.predecessor ?? -2;
    }
    for (const member of path.reverse()) {
      if (fingerprints.has(member)) continue;
      const predecessor = nodes[member]?.predecessor ?? -2;
      const parent =
        predecessor === -1
          ? null
          : (fingerprints.get(predecessor) ?? { state: "missing" });
      fingerprints.set(
        member,
        digestCanonicalValue(
          { events: own[member], redirected_from: parent },
          "Browser scenario",
        ),
      );
    }
  }
  return nodes.map((_, index) => {
    const fingerprint = fingerprints.get(index);
    if (fingerprint === undefined) throw new ScenarioNetworkFingerprintError();
    return fingerprint;
  });
};

import { expect, it } from "vitest";

import { timedCaptureEvidence } from "../../../tests/fixtures/analysisView.js";
import {
  scenarioCaptureEvidence,
  scenarioCaptureFixture,
  type ScenarioExchange,
} from "../../../tests/fixtures/browserScenarioCapture.js";
import {
  BOOK_ROWS,
  BOOK_WRITE_CLOCK,
  environmentStateViewOf,
} from "../../../tests/fixtures/environmentStateWrites.js";
import type { BrowserScenarioCapture } from "../browserScenarioCapture.js";
import { scenarioCaptureRecords } from "./scenarioCaptureRecords.js";

const START = Date.parse("2026-10-17T18:00:00.000Z");

/** The book session the HAR fixture times one second apart, as browser scenario exchanges. */
const EXCHANGES: readonly ScenarioExchange[] = BOOK_ROWS.map(
  ([method, path, body = null, status = 200, sent]) => ({
    method,
    url: path,
    status,
    mediaType: "application/json",
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(sent === undefined
      ? {}
      : {
          requestMediaType: "application/json",
          requestBody: JSON.stringify(sent),
        }),
  }),
);

const at = (ms: number): string => new Date(ms).toISOString();

/**
 * The same capture as the browser reports it: each request started when the HAR fixture starts it and finished 5 ms
 * later, observed by the provider 15 ms after its start.
 */
const timed = (capture: BrowserScenarioCapture): BrowserScenarioCapture => {
  let transaction = 0;
  const items = capture.events.items.map((event) =>
    event.kind === "request"
      ? { ...event, observed_at: at(START + transaction++ * 1000 + 15) }
      : event,
  );
  let sequence = Math.max(...items.map((event) => event.sequence));
  const finished = items.flatMap((event) =>
    event.kind === "request"
      ? [
          {
            ...event,
            observed_at: undefined,
            sequence: ++sequence,
            kind: "request-finished" as const,
            started_at: at(Date.parse(event.observed_at ?? "") - 15),
            elapsed_ms: 5,
          },
        ]
      : [],
  );
  return {
    ...capture,
    events: {
      ...capture.events,
      retained: items.length + finished.length,
      items: [
        ...items,
        ...finished.map(({ observed_at: _unset, ...event }) => event),
      ],
    },
  };
};

const verdicts = (state: ReturnType<typeof environmentStateViewOf>) =>
  Object.fromEntries(
    state.writes.map((plan) => [
      plan.tool,
      plan.served
        ? plan.rules.map(({ field, rule }) => `${field}:${rule}`)
        : plan.reason,
    ]),
  );

it("times scenario records from when each request was observed and how long the browser took", () => {
  const records = scenarioCaptureRecords(
    timed(scenarioCaptureFixture(EXCHANGES)),
    "manifest",
  );
  // The browser's start, not the provider's later observation.
  expect(records.records[1]?.reported).toMatchObject({
    startedDateTime: "2026-10-17T18:00:01.000Z",
    time: 5,
  });
  expect(records.limitations).toContainEqual(
    expect.stringContaining("the browser's own"),
  );
  const untimed = scenarioCaptureRecords(
    scenarioCaptureFixture(EXCHANGES),
    "manifest",
  );
  expect(untimed.records[1]?.reported).not.toHaveProperty("startedDateTime");
  expect(untimed.limitations.join(" ")).not.toContain("the browser's own");
});

it("learns the clock from a timed scenario as from the same session's HAR, and none without times", () => {
  const har = environmentStateViewOf(timedCaptureEvidence(BOOK_ROWS));
  const scenario = environmentStateViewOf(
    scenarioCaptureEvidence(timed(scenarioCaptureFixture(EXCHANGES))),
  );
  expect(scenario.timeline).toBe("recorded-start-time");
  expect(scenario.write_clock).toBe(BOOK_WRITE_CLOCK);
  expect(verdicts(scenario)).toEqual(verdicts(har));
  expect(Object.values(verdicts(scenario)).flat()).toContain(
    "updated_at:clock",
  );

  const untimed = environmentStateViewOf(
    scenarioCaptureEvidence(scenarioCaptureFixture(EXCHANGES)),
  );
  expect(untimed.timeline).toBe("record-order");
  expect(untimed.write_clock).toBeNull();
  expect(Object.values(verdicts(untimed)).flat()).not.toContain(
    "updated_at:clock",
  );
});

it("falls back to the observed time with no duration when a request never ended or ended twice", () => {
  const capture = timed(scenarioCaptureFixture(EXCHANGES));
  const finished = capture.events.items.filter(
    (event) => event.kind === "request-finished",
  );
  const [first, second] = finished;
  if (first === undefined || second === undefined)
    throw new Error("Expected finished events");
  const items = capture.events.items.filter((event) => event !== first);
  items.push({ ...second, sequence: items.length + 100 });
  const records = scenarioCaptureRecords(
    { ...capture, events: { ...capture.events, items } },
    "manifest",
  );
  expect(records.records[0]?.reported).toMatchObject({
    startedDateTime: "2026-10-17T18:00:00.015Z",
  });
  expect(records.records[1]?.reported).toMatchObject({
    startedDateTime: "2026-10-17T18:00:01.015Z",
  });
  expect(records.records[0]?.reported).not.toHaveProperty("time");
  expect(records.records[1]?.reported).not.toHaveProperty("time");
  expect(records.limitations).toContain(
    "2 scenario request(s) had no unique reported duration; their duration is omitted and does not establish zero-length execution.",
  );
  expect(records.records[2]?.reported).toMatchObject({
    startedDateTime: "2026-10-17T18:00:02.000Z",
    time: 5,
  });
  const state = environmentStateViewOf(
    scenarioCaptureEvidence({
      ...capture,
      events: { ...capture.events, items },
    }),
  );
  expect(state.timeline).toBe("recorded-start-time");
  expect(state.write_clock).toBeNull();
  const clockPlans = state.writes.filter((plan) =>
    plan.rules.some((rule) => rule.rule === "clock"),
  );
  expect(clockPlans.length).toBeGreaterThan(0);
  expect(clockPlans.every((plan) => !plan.served && plan.reason !== null)).toBe(
    true,
  );
  expect(clockPlans.some((plan) => plan.reason === "unknown-clock")).toBe(true);
});

it.each(["manifest", "replay"] as const)(
  "preserves independent duration and explicit zero in %s projection",
  (purpose) => {
    const capture = timed(scenarioCaptureFixture(EXCHANGES));
    const first = capture.events.items.find(
      (event) => event.kind === "request",
    );
    if (first === undefined) throw new Error("Expected first request");
    const items = capture.events.items.map((event) => {
      if (
        !("transaction_id" in event) ||
        event.transaction_id !== first.transaction_id
      )
        return event;
      if (event.kind === "request") {
        const { observed_at: _omitted, ...withoutStart } = event;
        return withoutStart;
      }
      if (event.kind === "request-finished") {
        const { started_at: _omitted, ...withoutStart } = event;
        return { ...withoutStart, elapsed_ms: 0 };
      }
      return event;
    });
    const source = { ...capture, events: { ...capture.events, items } };
    const before = structuredClone(source);
    const records = scenarioCaptureRecords(source, purpose);
    expect(records.records[0]?.reported).toHaveProperty("time", 0);
    expect(records.records[0]?.reported).not.toHaveProperty("startedDateTime");
    expect(records.records[0]?.location).toEqual({
      kind: "json-pointer",
      pointer: `/events/items/${capture.events.items.indexOf(first)}`,
    });
    expect(records.limitations.join(" ")).not.toContain(
      "had no unique reported duration",
    );
    expect(source).toEqual(before);
  },
);

it.each([
  "known zero",
  "missing terminal",
  "duplicate terminal",
  "terminal without duration",
] as const)(
  "requires a completed scenario action before resync and write proof: %s",
  (mode) => {
    const exchanges: ScenarioExchange[] = [
      {
        method: "GET",
        url: "/api/books",
        body: JSON.stringify([
          { id: 1, name: "A" },
          { id: 2, name: "B" },
        ]),
      },
      {
        method: "GET",
        url: "/api/books/1",
        body: JSON.stringify({ id: 1, name: "A" }),
      },
      {
        method: "GET",
        url: "/api/books/2",
        body: JSON.stringify({ id: 2, name: "B" }),
      },
      {
        method: "POST",
        url: "/api/books/1/archive",
        status: 204,
        body: "",
        requestBody: "{}",
        requestMediaType: "application/json",
      },
      {
        method: "GET",
        url: "/api/books/1",
        body: JSON.stringify({ id: 1, name: "A" }),
      },
      {
        method: "PATCH",
        url: "/api/books/1",
        body: JSON.stringify({ id: 1, name: "Z" }),
        requestBody: JSON.stringify({ name: "Z" }),
        requestMediaType: "application/json",
      },
      {
        method: "GET",
        url: "/api/books/1",
        body: JSON.stringify({ id: 1, name: "Z" }),
      },
    ].map((exchange) => ({
      ...exchange,
      status: exchange.status ?? 200,
      mediaType: "application/json",
    }));
    const capture = timed(scenarioCaptureFixture(exchanges));
    const action = capture.events.items.find(
      (event) => event.kind === "request" && event.method === "POST",
    );
    if (action?.kind !== "request") throw new Error("Expected action request");
    const terminal = capture.events.items.find(
      (event) =>
        event.kind === "request-finished" &&
        event.transaction_id === action?.transaction_id,
    );
    if (terminal?.kind !== "request-finished")
      throw new Error("Expected action terminal");
    const items = capture.events.items.flatMap<
      BrowserScenarioCapture["events"]["items"][number]
    >((event) => {
      if (event !== terminal) return [event];
      if (mode === "missing terminal") return [];
      if (mode === "terminal without duration") {
        const { elapsed_ms: _omitted, ...withoutDuration } = event;
        return [withoutDuration];
      }
      return [{ ...event, elapsed_ms: 0 }];
    });
    if (mode === "duplicate terminal")
      items.push({
        ...terminal,
        sequence: Math.max(...items.map((event) => event.sequence)) + 1,
      });
    const source = {
      ...capture,
      events: { ...capture.events, items, retained: items.length },
    };
    const projected = scenarioCaptureRecords(source, "manifest");
    if (mode === "known zero")
      expect(projected.records[3]?.reported).toHaveProperty("time", 0);
    else expect(projected.records[3]?.reported).not.toHaveProperty("time");
    const state = environmentStateViewOf(scenarioCaptureEvidence(source));
    expect(state.timeline).toBe("recorded-start-time");
    const plan = state.writes.find(
      (write) => write.tool === "patch_books_by_id",
    );
    expect(plan).toMatchObject({
      served: mode === "known zero",
      checked_record_ordinals: mode === "known zero" ? [6] : [],
      contradicted_by: null,
    });
    if (mode === "known zero") expect(state.write_clock).not.toBeNull();
    else expect(state.write_clock).toBeNull();
  },
);

it("keeps record order and learns no clock when any request is untimed", () => {
  const capture = timed(scenarioCaptureFixture(EXCHANGES));
  const items = capture.events.items.map((event, index) => {
    if (index !== 0 || event.kind !== "request") return event;
    const { observed_at: _dropped, ...untimed } = event;
    return untimed;
  });
  const firstTransaction = capture.events.items.find(
    (event) => event.kind === "request",
  )?.transaction_id;
  const terminal = items.filter(
    (event) =>
      !(
        event.kind === "request-finished" &&
        event.transaction_id === firstTransaction
      ),
  );
  const state = environmentStateViewOf(
    scenarioCaptureEvidence({
      ...capture,
      events: { ...capture.events, items: terminal, retained: terminal.length },
    }),
  );
  expect(state.timeline).toBe("record-order");
  expect(state.write_clock).toBeNull();
});

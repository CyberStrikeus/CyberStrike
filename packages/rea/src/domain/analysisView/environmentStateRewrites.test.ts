import { expect, it } from "vitest";
import { parseOffsetDateTimeInstant } from "../offsetDateTime.js";
import { StateRecordChronology } from "./StateRecordChronology.js";
import { rewriteCuts } from "./environmentStateRewrites.js";
import {
  writeSpanCheck,
  writeSpanIndex,
  type StateRecordFacts,
} from "./environmentStateRules.js";

const record = (
  ordinal: number,
  method: string,
  start: number,
  endMs: number | undefined,
): StateRecordFacts => ({
  ordinal,
  method,
  path: "/api/items/1",
  query: undefined,
  status: 200,
  timing: {
    start: {
      instant: parseOffsetDateTimeInstant(new Date(start).toISOString()),
      ms: start,
    },
    endMs,
  },
});

it.each([
  { label: "unknown duration", start: 10, end: undefined, possible: true },
  { label: "completed before the reads", start: 10, end: 19, possible: false },
  {
    label: "completed at the first read's start",
    start: 10,
    end: 20,
    possible: false,
  },
  {
    label: "known zero duration at the boundary",
    start: 20,
    end: 20,
    possible: false,
  },
  { label: "known overlap", start: 10, end: 21, possible: true },
])(
  "keeps rewrite cuts conservative for an earlier write with $label",
  ({ start, end, possible }) => {
    const write = record(0, "PUT", start, end);
    const earlier = record(1, "GET", 20, 25);
    const later = record(2, "GET", 30, 35);
    const records = [write, earlier, later];
    const chronology = new StateRecordChronology(
      records,
      "recorded-start-time",
    );
    const cuts = rewriteCuts(
      [{ type: "/api/items", earlier: earlier.ordinal, later: later.ordinal }],
      [write],
      new Map(records.map((value) => [value.ordinal, value])),
      chronology,
    );
    expect(writeSpanCheck([write], chronology)(earlier, later)).toBe(possible);
    expect(cuts.get("/api/items")).toBe(possible ? write : undefined);
    if (end === undefined) {
      // A possible explanation prevents an independence proof; it does not prove
      // that the write completed, or that it caused the observed difference.
      expect(chronology.completedBefore(write, earlier)).toBe(false);
    }
  },
);

it("selects the earliest possibly interfering write without replacing a known completed predecessor", () => {
  const finished = record(0, "PUT", 0, 5);
  const unresolved = record(1, "PUT", 10, undefined);
  const earlier = record(2, "GET", 20, 25);
  const later = record(3, "GET", 30, 35);
  const records = [finished, unresolved, earlier, later];
  const chronology = new StateRecordChronology(records, "recorded-start-time");
  const writes = [finished, unresolved];
  expect(writeSpanIndex(writes, chronology)(earlier, later)).toBe(1);
  expect(
    rewriteCuts(
      [{ type: "/api/items", earlier: earlier.ordinal, later: later.ordinal }],
      writes,
      new Map(records.map((value) => [value.ordinal, value])),
      chronology,
    ).get("/api/items"),
  ).toBe(unresolved);
});

it.each([35, undefined])(
  "does not invent a later read's completion when locating possible writes (end=%s)",
  (end) => {
    const earlier = record(0, "GET", 20, 25);
    const later = record(1, "GET", 30, end);
    const write = record(2, "PUT", 40, 45);
    const records = [earlier, later, write];
    const chronology = new StateRecordChronology(
      records,
      "recorded-start-time",
    );
    const cuts = rewriteCuts(
      [{ type: "/api/items", earlier: earlier.ordinal, later: later.ordinal }],
      [write],
      new Map(records.map((value) => [value.ordinal, value])),
      chronology,
    );
    expect(cuts.get("/api/items")).toBe(end === undefined ? write : undefined);
  },
);

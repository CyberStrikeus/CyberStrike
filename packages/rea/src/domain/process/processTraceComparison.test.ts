import { describe, expect, it } from "vitest";
import { jsonValueSchema } from "../jsonValue.js";
import { parseProcessCapture } from "./processCaptureParsing.js";
import type { ProcessTraceSpecification } from "./processTraceSpecification.js";
import { processTraceSpecificationSchema as specificationSchema } from "./processTraceSpecification.js";
import { processTraceComparisonResultSchema } from "./processTraceEvaluation.js";
import {
  capture,
  emptyCapture,
  partialSpecification,
  processStarted,
  terminal,
  values,
} from "./processTraceComparison.fixture.js";

import { compareProcessCaptures } from "./processComparison.js";
import {
  compareProcessTraces,
  processTraceOutcomesDiffer,
} from "./processTraceComparison.js";

const traced = (
  left: ReturnType<typeof capture>,
  right: ReturnType<typeof capture>,
) =>
  compareProcessCaptures(left, right, {
    traceSpecification: partialSpecification(),
  });

const withPayloads = (data: string, command: string) =>
  capture({
    ...values(["terminal", "process"]),
    frames: [{ ...terminal, data }],
    process_samples: [{ ...processStarted, command }],
  });

type FiniteTraceLanguage = Extract<
  ProcessTraceSpecification["language"],
  { kind: "finite_traces" }
>;

const finiteTraceSpecification = (
  events: ProcessTraceSpecification["events"],
  variants: FiniteTraceLanguage["variants"],
): ProcessTraceSpecification => ({
  events,
  language: { kind: "finite_traces", variants },
});

describe("generic capture trace comparison", () => {
  it("requires explicit partial ordering and never infers causality from timestamps", () => {
    const specification = partialSpecification();
    const left = capture(values(["terminal", "process"]));
    const right = capture(values(["process", "terminal"]));
    expect(compareProcessTraces(left, right, specification)).toMatchObject({
      verdict: "different",
      diagnostic: { kind: "edge", side: "right" },
    });

    const concurrent: ProcessTraceSpecification = {
      ...specification,
      language: {
        kind: "partial_order",
        happens_before: [],
        not_before: [],
        unordered_groups: [{ events: ["ready", "worker"] }],
        prefix: [],
        suffix: [],
      },
    };
    const concurrentComparison = compareProcessTraces(left, right, concurrent);
    expect(concurrentComparison).toMatchObject({
      verdict: "equivalent",
    });
    expect(processTraceOutcomesDiffer(concurrentComparison)).toBe(true);
    expect(
      processTraceOutcomesDiffer(compareProcessTraces(left, left, concurrent)),
    ).toBe(false);
  });

  it("rejects malformed result contracts", () => {
    const result = compareProcessTraces(
      capture(values(["terminal", "process"])),
      capture(values(["terminal", "process"])),
      partialSpecification(),
    );
    expect(
      processTraceComparisonResultSchema.safeParse({
        ...result,
        right: {
          ...result.right,
          status: "fail",
          matched_variant: "invented",
        },
      }).success,
    ).toBe(false);
  });

  it("supports declared optional events and bounded duplicates", () => {
    const first = { sequence: 0, at_ms: 1, data: "tick" };
    const second = { sequence: 1, at_ms: 2, data: "tick" };
    const one = capture({
      frames: [first],
      process_samples: [],
      event_journal: [{ collection: "frames", index: 0 }],
    });
    const two = capture({
      frames: [first, second],
      process_samples: [],
      event_journal: [
        { collection: "frames", index: 0 },
        { collection: "frames", index: 1 },
      ],
    });
    const specification = finiteTraceSpecification(
      [
        {
          id: "tick1",
          source: "terminal_raw",
          exact: first,
          cardinality: { kind: "required" },
        },
        {
          id: "tick2",
          source: "terminal_raw",
          exact: second,
          cardinality: { kind: "optional" },
        },
      ],
      [
        { id: "one", trace: ["tick1"] },
        { id: "two", trace: ["tick1", "tick2"] },
      ],
    );
    expect(compareProcessTraces(one, two, specification)).toMatchObject({
      verdict: "equivalent",
      left: { matched_variant: "one" },
      right: { matched_variant: "two" },
    });
  });

  it("compares a declared identifier the comparison result can represent", () => {
    // The specification owns the trace identifier vocabulary and the result
    // echoes those identifiers verbatim, so both must accept the same values
    // rather than handing the caller a raw schema error for its own input.
    const eventId = `e${"0".repeat(64)}`;
    const specification = finiteTraceSpecification(
      [
        {
          id: eventId,
          source: "terminal_raw",
          exact: terminal,
          cardinality: { kind: "required" },
        },
      ],
      [{ id: "only", trace: [eventId] }],
    );
    expect(specificationSchema.safeParse(specification).success).toBe(true);
    const left = capture(values(["terminal", "process"]));
    expect(compareProcessTraces(left, left, specification)).toMatchObject({
      verdict: "equivalent",
      left: { matched_variant: "only", raw_trace: [{ event_id: eventId }] },
    });
  });
});

describe("finite trace variant mismatch attribution", () => {
  it("reports tied best-prefix omissions across variants", () => {
    const observed = capture({
      frames: [terminal],
      process_samples: [],
      event_journal: [{ collection: "frames", index: 0 }],
    });
    const specification = finiteTraceSpecification(
      [
        {
          id: "ready",
          source: "terminal_raw",
          exact: terminal,
          cardinality: { kind: "required" },
        },
        {
          id: "worker",
          source: "process",
          exact: processStarted,
          cardinality: { kind: "optional" },
        },
        {
          id: "worker_alt",
          source: "process",
          exact: { ...processStarted, command: "alternate-worker" },
          cardinality: { kind: "optional" },
        },
      ],
      [
        { id: "ready_worker", trace: ["ready", "worker"] },
        { id: "ready_worker_alt", trace: ["ready", "worker_alt"] },
      ],
    );

    expect(
      compareProcessTraces(observed, observed, specification),
    ).toMatchObject({
      verdict: "nonconforming",
      diagnostic: {
        kind: "trace",
        event_ids: ["worker", "worker_alt"],
        locations: [],
      },
    });
  });
});

describe("process trace constraints and evidence sufficiency", () => {
  it("enforces exact and range cardinality for a repeated terminal observation", () => {
    const repeated = (count: number) =>
      capture({
        frames: Array.from({ length: count }, (_, sequence) => ({
          sequence,
          at_ms: sequence,
          data: "tick",
        })),
        process_samples: [],
        event_journal: Array.from({ length: count }, (_, index) => ({
          collection: "frames" as const,
          index,
        })),
      });
    const event: Omit<
      ProcessTraceSpecification["events"][number],
      "cardinality"
    > = {
      id: "tick",
      source: "terminal_raw",
      exact: { data: "tick" },
      ignore_fields: ["sequence", "at_ms"],
    };
    const rangeSpecification: ProcessTraceSpecification = {
      events: [{ ...event, cardinality: { kind: "range", min: 2, max: 3 } }],
      language: {
        kind: "partial_order",
        happens_before: [],
        not_before: [],
        unordered_groups: [],
        prefix: [],
        suffix: [],
      },
    };
    expect(
      compareProcessTraces(repeated(2), repeated(3), rangeSpecification),
    ).toMatchObject({ verdict: "equivalent" });
    expect(
      compareProcessTraces(repeated(1), repeated(2), rangeSpecification),
    ).toMatchObject({
      verdict: "different",
      diagnostic: { kind: "cardinality", side: "left" },
    });
    expect(
      compareProcessTraces(repeated(2), repeated(4), rangeSpecification),
    ).toMatchObject({
      verdict: "different",
      diagnostic: { kind: "cardinality", side: "right" },
    });

    const exactSpecification: ProcessTraceSpecification = {
      events: [{ ...event, cardinality: { kind: "exact", count: 2 } }],
      language: {
        kind: "finite_traces",
        variants: [{ id: "two", trace: ["tick", "tick"] }],
      },
    };
    expect(
      compareProcessTraces(repeated(2), repeated(2), exactSpecification),
    ).toMatchObject({ verdict: "equivalent" });
    expect(
      compareProcessTraces(repeated(3), repeated(2), exactSpecification),
    ).toMatchObject({
      verdict: "different",
      diagnostic: { kind: "cardinality", side: "left" },
    });
  });

  it("enforces an explicit not-before relation between terminal and process events", () => {
    const specification: ProcessTraceSpecification = {
      events: [
        {
          id: "ready",
          source: "terminal_raw",
          exact: terminal,
          cardinality: { kind: "required" },
        },
        {
          id: "worker",
          source: "process",
          exact: processStarted,
          cardinality: { kind: "required" },
        },
      ],
      language: {
        kind: "partial_order",
        happens_before: [],
        not_before: [{ event: "ready", anchor: "worker" }],
        unordered_groups: [],
        prefix: [],
        suffix: [],
      },
    };
    const readyFirst = capture(values(["terminal", "process"]));
    const workerFirst = capture(values(["process", "terminal"]));

    expect(
      compareProcessTraces(workerFirst, readyFirst, specification),
    ).toMatchObject({
      verdict: "different",
      diagnostic: {
        kind: "edge",
        side: "right",
        event_ids: ["ready", "worker"],
      },
    });
    expect(
      compareProcessTraces(workerFirst, workerFirst, specification),
    ).toMatchObject({ verdict: "equivalent" });
  });
});

describe("unknown process trace evidence", () => {
  it("never proves equivalence from truncated, unknown, or journal-free evidence", () => {
    const complete = capture(values(["terminal", "process"]));
    const truncated = capture(values(["terminal", "process"]), {
      omittedTerminalFrame: true,
    });
    expect(
      compareProcessTraces(complete, truncated, partialSpecification()).verdict,
    ).toBe("unknown");
    const unknown = capture(values(["terminal", "process"]), {
      residualUnknowns: [{ scope: "process", reason: "sampled" }],
    });
    expect(
      compareProcessTraces(complete, unknown, partialSpecification()).verdict,
    ).toBe("unknown");
    expect(
      compareProcessTraces(complete, unknown, partialSpecification()),
    ).toMatchObject({
      verdict: "unknown",
      right: {
        status: "unknown",
        matched_variant: null,
        satisfied_constraints: [],
        raw_trace: [{ event_id: "ready" }, { event_id: "worker" }],
      },
    });
    const noJournal = parseProcessCapture({ ...complete, event_journal: [] });
    expect(
      compareProcessTraces(complete, noJournal, partialSpecification()),
    ).toMatchObject({
      verdict: "unknown",
      diagnostic: { kind: "journal", side: "right" },
    });

    expect(() =>
      parseProcessCapture({
        ...complete,
        event_journal: complete.event_journal.slice(1),
      }),
    ).toThrow("event_journal");
  });
});

describe("process trace dimension attribution", () => {
  it.each([false, true])(
    "preserves an independently observed terminal addition/removal (reversed: %s)",
    (reversed) => {
      const absent = capture({
        frames: [],
        process_samples: [],
        event_journal: [],
      });
      const present = capture(values(["terminal", "process"]));
      const specification = partialSpecification();
      const result = compareProcessCaptures(
        reversed ? present : absent,
        reversed ? absent : present,
        {
          traceSpecification: {
            ...specification,
            events: specification.events.map((event) =>
              event.id === "ready"
                ? { ...event, cardinality: { kind: "optional" } }
                : event,
            ),
            language: {
              kind: "partial_order",
              happens_before: [],
              not_before: [],
              unordered_groups: [{ events: ["ready", "worker"] }],
              prefix: [],
              suffix: [],
            },
          },
        },
      );
      expect(result).toMatchObject({
        terminal: reversed ? "removed" : "added",
        process: "changed",
        status: "changed",
        trace: {
          verdict: "different",
          diagnostic: { event_ids: ["worker"], locations: [] },
        },
      });
    },
  );

  it("applies passing filesystem trace timestamp omissions to exact comparison", () => {
    const base = capture(values(["terminal", "process"]));
    const left = base;
    const right = parseProcessCapture({
      ...base,
      filesystem_checkpoints: base.filesystem_checkpoints.map((checkpoint) =>
        checkpoint.name === "after_settlement"
          ? { ...checkpoint, at_ms: checkpoint.at_ms + 10 }
          : checkpoint,
      ),
    });
    const specification = finiteTraceSpecification(
      emptyCapture.filesystem_checkpoints.map(
        ({ at_ms: _atMs, ...checkpoint }) => ({
          id: checkpoint.name,
          source: "filesystem" as const,
          exact: jsonValueSchema.parse(checkpoint),
          ignore_fields: ["at_ms"],
          cardinality: { kind: "required" as const },
        }),
      ),
      [{ id: "checkpoints", trace: ["before", "after_settlement"] }],
    );

    expect(compareProcessCaptures(left, right)).toMatchObject({
      filesystem: "changed",
      first_divergence: { status: "found", dimension: "filesystem" },
    });
    expect(
      compareProcessCaptures(left, right, {
        traceSpecification: specification,
      }),
    ).toMatchObject({
      trace: { verdict: "equivalent" },
      filesystem: "unchanged",
      first_divergence: { status: "none" },
    });

    const finalFile = {
      path: "root_0:created.txt",
      type: "file" as const,
      mode: 0o644,
      size: 4,
      sha256: "a".repeat(64),
      symlink_target: null,
    };
    const created = {
      path: finalFile.path,
      status: "created" as const,
      before: null,
      after: finalFile,
    };
    const changedRight = parseProcessCapture({
      ...right,
      filesystem_checkpoints: right.filesystem_checkpoints.map((checkpoint) =>
        checkpoint.name === "after_settlement"
          ? { ...checkpoint, files: [finalFile], effects: [created] }
          : checkpoint,
      ),
      files_after: [finalFile],
      filesystem_effects: [created],
      truncation_details: {
        ...right.truncation_details,
        filesystem_after: {
          ...right.truncation_details.filesystem_after,
          hashed_bytes: finalFile.size,
        },
      },
    });
    expect(
      compareProcessCaptures(left, changedRight, {
        traceSpecification: specification,
      }),
    ).toMatchObject({
      trace: { verdict: "different" },
      filesystem: "changed",
      first_divergence: { status: "found", dimension: "filesystem" },
    });
  });

  it("keeps equal dimensions unchanged when one side fails a predicate", () => {
    expect(
      traced(
        withPayloads("Ready", "worker"),
        withPayloads("Different", "worker"),
      ),
    ).toMatchObject({
      trace: { verdict: "different" },
      terminal: "changed",
      process: "unchanged",
    });
    expect(
      traced(
        withPayloads("Ready", "worker"),
        withPayloads("Ready", "other-worker"),
      ),
    ).toMatchObject({
      trace: { verdict: "different" },
      terminal: "unchanged",
      process: "changed",
    });
  });
});

describe("finite trace dimension attribution", () => {
  it("attributes a finite-trace omission to the omitted event dimension", () => {
    const left = capture({
      frames: [terminal],
      process_samples: [],
      event_journal: [{ collection: "frames", index: 0 }],
    });
    const right = capture(values(["terminal", "process"]));
    const specification = finiteTraceSpecification(
      [
        {
          id: "ready",
          source: "terminal_raw",
          exact: terminal,
          cardinality: { kind: "required" },
        },
        {
          id: "worker",
          source: "process",
          exact: processStarted,
          cardinality: { kind: "optional" },
        },
      ],
      [{ id: "ready_worker", trace: ["ready", "worker"] }],
    );

    expect(
      compareProcessCaptures(left, right, {
        traceSpecification: specification,
      }),
    ).toMatchObject({
      status: "changed",
      process: "changed",
      terminal: "unchanged",
      trace: {
        verdict: "different",
        diagnostic: { kind: "trace", event_ids: ["worker"], locations: [] },
      },
      first_divergence: {
        status: "found",
        dimension: "process",
        index: 0,
      },
    });
  });
});

describe("unordered finite trace mismatch attribution", () => {
  it("attributes only the missing member of an unordered group", () => {
    const db = { sequence: 1, at_ms: 901, data: "DB" };
    const alert = { ...processStarted, pid: 2, command: "other-worker" };
    const left = capture({
      frames: [terminal],
      process_samples: [processStarted],
      event_journal: [
        { collection: "frames", index: 0 },
        { collection: "process_samples", index: 0 },
      ],
    });
    const right = capture({
      frames: [terminal, db],
      process_samples: [processStarted],
      event_journal: [
        { collection: "frames", index: 0 },
        { collection: "process_samples", index: 0 },
        { collection: "frames", index: 1 },
      ],
    });
    const specification = finiteTraceSpecification(
      [
        {
          id: "ready",
          source: "terminal_raw",
          exact: terminal,
          cardinality: { kind: "required" },
        },
        {
          id: "worker",
          source: "process",
          exact: processStarted,
          cardinality: { kind: "optional" },
        },
        {
          id: "db",
          source: "terminal_raw",
          exact: db,
          cardinality: { kind: "optional" },
        },
        {
          id: "alert",
          source: "process",
          exact: alert,
          cardinality: { kind: "optional" },
        },
      ],
      [
        {
          id: "ready_then_work",
          trace: ["ready", { unordered: ["worker", "db"] }],
        },
      ],
    );

    expect(
      compareProcessCaptures(left, right, {
        traceSpecification: specification,
      }),
    ).toMatchObject({
      trace: {
        verdict: "different",
        diagnostic: {
          side: "left",
          event_ids: ["db"],
          locations: [],
        },
      },
      terminal: "changed",
      process: "unchanged",
      first_divergence: { status: "found", dimension: "terminal", index: 1 },
    });

    const unexpected = capture({
      frames: [terminal],
      process_samples: [processStarted, alert],
      event_journal: [
        { collection: "frames", index: 0 },
        { collection: "process_samples", index: 0 },
        { collection: "process_samples", index: 1 },
      ],
    });
    expect(
      compareProcessTraces(unexpected, unexpected, specification),
    ).toMatchObject({
      verdict: "nonconforming",
      diagnostic: {
        kind: "trace",
        event_ids: ["db", "alert"],
        locations: [{ collection: "process_samples", index: 1 }],
      },
    });
  });
});

describe("partial-order dimension attribution", () => {
  it("attributes an ordering difference to both ordered dimensions", () => {
    expect(
      traced(
        capture(values(["terminal", "process"])),
        capture(values(["process", "terminal"])),
      ),
    ).toMatchObject({
      trace: { verdict: "different" },
      terminal: "changed",
      process: "changed",
    });
  });

  it("attributes every independent failed ordering edge", () => {
    const terminals = [
      terminal,
      { ...terminal, sequence: 1, data: "Ready again" },
    ];
    const workers = [processStarted, { ...processStarted, at_ms: 2, pid: 2 }];
    const events = ["ready1", "worker1", "ready2", "worker2"] as const;
    const make = (order: readonly (typeof events)[number][]) =>
      capture({
        frames: terminals,
        process_samples: workers,
        event_journal: order.map((event) => ({
          collection: event.startsWith("ready")
            ? ("frames" as const)
            : ("process_samples" as const),
          index: Number(event.slice(-1)) - 1,
        })),
      });
    const left = make(events);
    const right = make(["worker1", "ready1", "worker2", "ready2"]);
    const specification: ProcessTraceSpecification = {
      events: [
        ...terminals.map((frame, index) => ({
          id: `ready${String(index + 1)}`,
          source: "terminal_raw" as const,
          exact: frame,
          cardinality: { kind: "required" as const },
        })),
        ...workers.map((sample, index) => ({
          id: `worker${String(index + 1)}`,
          source: "process" as const,
          exact: sample,
          cardinality: { kind: "required" as const },
        })),
      ],
      language: {
        kind: "partial_order",
        happens_before: [
          { before: "ready1", after: "worker1" },
          { before: "ready2", after: "worker2" },
        ],
        not_before: [],
        unordered_groups: [
          { events: ["ready1", "ready2"] },
          { events: ["worker1", "worker2"] },
          { events: ["ready1", "worker2"] },
          { events: ["worker1", "ready2"] },
        ],
        prefix: [],
        suffix: [],
      },
    };

    expect(
      compareProcessCaptures(left, right, {
        traceSpecification: specification,
      }),
    ).toMatchObject({
      trace: { verdict: "different" },
      terminal: "changed",
      process: "changed",
    });
  });
});

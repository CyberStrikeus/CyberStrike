import { describe, expect, it } from "vitest";
import { compareProcessCaptures } from "./processComparison.js";
import {
  capture,
  processStarted,
  terminal,
} from "./processTraceComparison.fixture.js";
import { parseProcessCapture } from "./processCaptureParsing.js";
import { processTraceSpecificationSchema } from "./processTraceSpecification.js";

const typed = {
  sequence: 0,
  scheduled_at_ms: 20,
  dispatched_at_ms: 21,
  type: "input",
  data: "go",
  outcome: "dispatched",
};
type Step = "ready" | "worker" | "typed";
const observation = (order: readonly Step[], data = typed.data) => {
  const base = capture({
    frames: [terminal],
    process_samples: order.includes("worker") ? [processStarted] : [],
    event_journal: [
      { collection: "frames", index: 0 },
      ...(order.includes("worker")
        ? [{ collection: "process_samples" as const, index: 0 }]
        : []),
    ],
  });
  return parseProcessCapture({
    ...base,
    interaction_events: [{ ...typed, data }],
    event_journal: [
      { collection: "filesystem_checkpoints", index: 0 },
      ...order.map((id) => ({
        collection:
          id === "ready"
            ? "frames"
            : id === "worker"
              ? "process_samples"
              : "interaction_events",
        index: 0,
      })),
      { collection: "lifecycle", index: 0 },
      { collection: "lifecycle", index: 1 },
      { collection: "filesystem_checkpoints", index: 1 },
    ].map((entry, capture_order) => ({ ...entry, capture_order })),
  });
};
const specification = (required = false, tail = false, unordered = false) =>
  processTraceSpecificationSchema.parse({
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
        cardinality: { kind: required ? "required" : "optional" },
      },
      {
        id: "typed",
        source: "interaction",
        exact: typed,
        cardinality: { kind: "required" },
      },
    ],
    language: {
      kind: "finite_traces",
      variants: [
        {
          id: "declared",
          trace: unordered
            ? [{ unordered: ["ready", "worker"] }, "typed"]
            : tail
              ? ["ready", "typed", "worker"]
              : ["ready", "worker", "typed"],
        },
      ],
    },
  });

describe("process trace omission and localization boundaries", () => {
  it.each([
    { reverse: false, required: false, tail: false, unordered: false },
    { reverse: true, required: false, tail: false, unordered: false },
    { reverse: false, required: true, tail: false, unordered: false },
    { reverse: false, required: false, tail: true, unordered: false },
    { reverse: false, required: false, tail: false, unordered: true },
  ])(
    "attributes only the omitted process observation ($reverse/$required/$tail/$unordered)",
    ({ reverse, required, tail, unordered }) => {
      const full = observation(
        tail ? ["ready", "typed", "worker"] : ["ready", "worker", "typed"],
      );
      const missing = observation(["ready", "typed"]);
      expect(full.interaction_events).toEqual(missing.interaction_events);
      const result = compareProcessCaptures(
        reverse ? missing : full,
        reverse ? full : missing,
        { traceSpecification: specification(required, tail, unordered) },
      );
      expect(result).toMatchObject({
        status: "changed",
        interaction: "unchanged",
        process: "changed",
        terminal: "unchanged",
        first_divergence: { status: "found", dimension: "process", index: 0 },
        trace: {
          verdict: "different",
          diagnostic: { event_ids: ["worker"], locations: [] },
        },
      });
    },
  );

  it("keeps a genuine cross-source reorder changed and localization unknown", () => {
    const result = compareProcessCaptures(
      observation(["ready", "worker", "typed"]),
      observation(["ready", "typed", "worker"]),
      { traceSpecification: specification() },
    );
    expect(result).toMatchObject({
      status: "changed",
      interaction: "changed",
      process: "changed",
      first_divergence: { status: "unknown" },
      trace: { verdict: "different" },
    });
  });

  it("retains a real interaction payload difference and its location", () => {
    const result = compareProcessCaptures(
      observation(["ready", "worker", "typed"]),
      observation(["ready", "worker", "typed"], "stop"),
      { traceSpecification: specification() },
    );
    expect(result).toMatchObject({
      interaction: "changed",
      first_divergence: { status: "found", dimension: "interaction", index: 0 },
    });
  });

  it("does not claim no divergence when the requested journal is unavailable", () => {
    const full = observation(["ready", "worker", "typed"]);
    const historical = parseProcessCapture({ ...full, event_journal: [] });
    expect(
      compareProcessCaptures(full, historical, {
        traceSpecification: specification(),
      }),
    ).toMatchObject({
      first_divergence: { status: "unknown" },
      trace: { verdict: "unknown" },
    });
    expect(
      compareProcessCaptures(full, full, {
        traceSpecification: specification(),
      }),
    ).toMatchObject({
      status: "unchanged",
      first_divergence: { status: "none" },
      trace: { verdict: "equivalent" },
    });
    expect(compareProcessCaptures(full, historical)).toMatchObject({
      status: "unchanged",
      first_divergence: { status: "none" },
    });
  });
});

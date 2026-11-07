import { expect, it } from "vitest";
import { jsonValueSchema } from "../jsonValue.js";
import { compareProcessCaptures } from "./processComparison.js";
import { parseProcessCapture } from "./processCaptureParsing.js";
import {
  capture,
  emptyCapture,
  terminal,
} from "./processTraceComparison.fixture.js";
import type { ProcessTraceSpecification } from "./processTraceSpecification.js";

const rawSpec: ProcessTraceSpecification = {
  events: [
    {
      id: "ready",
      source: "terminal_raw",
      exact: terminal,
      cardinality: { kind: "required" },
    },
  ],
  language: {
    kind: "finite_traces",
    variants: [{ id: "only", trace: ["ready"] }],
  },
};

it("does not let raw-only conformance hide omitted rendered terminal observations", () => {
  const base = capture({
    frames: [terminal],
    process_samples: [],
    event_journal: [{ collection: "frames", index: 0 }],
  });
  const omitted = parseProcessCapture({
    ...base,
    truncated: true,
    truncation_details: {
      ...base.truncation_details,
      rendered_terminal: {
        ...base.truncation_details.rendered_terminal,
        observed_frames: 1,
        retained_frames: 0,
        unknown_size_frames: 1,
      },
    },
  });
  expect(compareProcessCaptures(omitted, omitted)).toMatchObject({
    terminal: "unknown",
    first_divergence: { status: "unknown" },
  });
  expect(
    compareProcessCaptures(omitted, omitted, { traceSpecification: rawSpec }),
  ).toMatchObject({
    terminal: "unknown",
    status: "unknown",
    trace: { verdict: "equivalent" },
    first_divergence: { status: "unknown" },
  });
  expect(
    compareProcessCaptures(base, base, { traceSpecification: rawSpec }),
  ).toMatchObject({ terminal: "unchanged", trace: { verdict: "equivalent" } });
  const rawOmitted = capture(
    {
      frames: [terminal],
      process_samples: [],
      event_journal: [{ collection: "frames", index: 0 }],
    },
    { omittedTerminalFrame: true },
  );
  expect(
    compareProcessCaptures(rawOmitted, rawOmitted, {
      traceSpecification: rawSpec,
    }),
  ).toMatchObject({ terminal: "unknown", trace: { verdict: "unknown" } });
});

const comparisonFixture = () => {
  const input = {
    sequence: 0,
    scheduled_at_ms: 10,
    dispatched_at_ms: 10,
    type: "input" as const,
    data: "go",
    outcome: "dispatched" as const,
  };
  const definitions = [
    {
      id: "ready",
      source: "terminal_raw" as const,
      exact: terminal,
      collection: "frames" as const,
      index: 0,
    },
    {
      id: "typed",
      source: "interaction" as const,
      exact: input,
      collection: "interaction_events" as const,
      index: 0,
    },
    {
      id: "before",
      source: "filesystem" as const,
      exact: emptyCapture.filesystem_checkpoints[0]!,
      collection: "filesystem_checkpoints" as const,
      index: 0,
    },
    {
      id: "settled",
      source: "lifecycle" as const,
      exact: { event: "settlement", ...emptyCapture.settlement },
      collection: "lifecycle" as const,
      index: 1,
    },
    {
      id: "exited",
      source: "lifecycle" as const,
      exact: { event: "exit", ...emptyCapture.exit },
      collection: "lifecycle" as const,
      index: 0,
    },
    {
      id: "after",
      source: "filesystem" as const,
      exact: emptyCapture.filesystem_checkpoints[1]!,
      collection: "filesystem_checkpoints" as const,
      index: 1,
    },
  ];
  const edges = [
    { before: "ready", after: "typed" },
    { before: "before", after: "settled" },
  ];
  const specification: ProcessTraceSpecification = {
    events: definitions.map(({ id, source, exact }) => ({
      id,
      source,
      exact: jsonValueSchema.parse(exact),
      cardinality: { kind: "required" },
    })),
    language: {
      kind: "partial_order",
      happens_before: edges,
      not_before: [],
      prefix: [],
      suffix: [],
      unordered_groups: definitions.flatMap(({ id }, i) =>
        definitions
          .slice(i + 1)
          .filter(
            ({ id: other }) =>
              !edges.some((e) => e.before === id && e.after === other),
          )
          .map(({ id: other }) => ({ events: [id, other] })),
      ),
    },
  };
  const base = capture({
    frames: [terminal],
    process_samples: [],
    event_journal: [{ collection: "frames", index: 0 }],
  });
  const make = (order: readonly string[]) =>
    parseProcessCapture({
      ...base,
      interaction_events: [input],
      event_journal: order.map((id, capture_order) => {
        const item = definitions.find((entry) => entry.id === id);
        if (item === undefined) throw new Error(`Unknown event ${id}`);
        return {
          collection: item.collection,
          index: item.index,
          capture_order,
        };
      }),
    });
  const left = make(["before", "typed", "ready", "exited", "settled", "after"]);
  const right = make([
    "ready",
    "typed",
    "exited",
    "settled",
    "before",
    "after",
  ]);
  const passing = make([
    "before",
    "ready",
    "typed",
    "exited",
    "settled",
    "after",
  ]);
  return { left, right, passing, specification };
};

it("attributes independent trace failures from both sides in either operand order", () => {
  const { left, right, passing, specification } = comparisonFixture();
  for (const [a, b] of [
    [left, right],
    [right, left],
  ] as const) {
    expect(
      compareProcessCaptures(a, b, { traceSpecification: specification }),
    ).toMatchObject({
      terminal: "changed",
      interaction: "changed",
      filesystem: "changed",
      exit: "changed",
      trace: {
        verdict: "different",
        left: { status: "fail" },
        right: { status: "fail" },
      },
    });
  }
  for (const [a, b] of [
    [left, passing],
    [passing, left],
  ] as const) {
    expect(
      compareProcessCaptures(a, b, { traceSpecification: specification }),
    ).toMatchObject({
      terminal: "changed",
      interaction: "changed",
      filesystem: "unchanged",
      exit: "unchanged",
    });
  }
  expect(compareProcessCaptures(left, right)).toMatchObject({
    terminal: "unchanged",
    interaction: "unchanged",
    filesystem: "unchanged",
    exit: "unchanged",
  });
});

import { describe, expect, it } from "vitest";

import {
  processTraceCaptureFixture,
  accountFullyObservedProcessCapture,
} from "./processCapture.fixture.js";
import { compareProcessCaptures } from "./processComparison.js";
import { parseProcessCapture } from "./processCaptureParsing.js";
import type { ProcessTraceSpecification } from "./processTraceSpecification.js";
const { capture, traceSpecification } = processTraceCaptureFixture();

describe("declared trace comparison nonconformance", () => {
  it("does not call identical captures changed when both violate the language", () => {
    const parsedCapture = parseProcessCapture(capture);
    const specification: ProcessTraceSpecification = {
      ...traceSpecification,
      language: {
        kind: "finite_traces",
        variants: [
          {
            id: "reversed",
            trace: ["after", "settlement", "exit", "before"],
          },
        ],
      },
    };

    expect(
      compareProcessCaptures(parsedCapture, parsedCapture, {
        traceSpecification: specification,
      }),
    ).toMatchObject({
      status: "unchanged",
      trace: { verdict: "nonconforming" },
    });
  });

  it("does not mask distinct payloads when both traces are nonconforming", () => {
    const parsedCapture = parseProcessCapture(capture);
    const withTerminal = (data: string) =>
      parseProcessCapture(
        accountFullyObservedProcessCapture({
          ...parsedCapture,
          frames: [{ sequence: 0, at_ms: 1, data }],
          event_journal: [
            {
              capture_order: 0,
              collection: "filesystem_checkpoints",
              index: 0,
            },
            { capture_order: 1, collection: "frames", index: 0 },
            { capture_order: 2, collection: "lifecycle", index: 0 },
            { capture_order: 3, collection: "lifecycle", index: 1 },
            {
              capture_order: 4,
              collection: "filesystem_checkpoints",
              index: 1,
            },
          ],
        }),
      );
    const specification: ProcessTraceSpecification = {
      events: [
        {
          id: "expected",
          source: "terminal_raw",
          exact: { sequence: 0, at_ms: 1, data: "expected" },
          cardinality: { kind: "required" },
        },
      ],
      language: {
        kind: "finite_traces",
        variants: [{ id: "expected", trace: ["expected"] }],
      },
    };

    expect(
      compareProcessCaptures(withTerminal("left"), withTerminal("right"), {
        traceSpecification: specification,
      }),
    ).toMatchObject({
      status: "changed",
      terminal: "changed",
      trace: { verdict: "nonconforming" },
    });
  });
});

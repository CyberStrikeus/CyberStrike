import { describe, expect, it } from "vitest";

import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  environmentServeSource,
  environmentStateServeFixture,
} from "../../../tests/fixtures/environmentServe.js";
import {
  BOOK_INIT_ROWS,
  BOOK_NOT_FOUND,
  FIRST_BOOK,
  SECOND_BOOK,
} from "../../../tests/fixtures/environmentStateWrites.js";
import { compareEnvironment } from "./environmentCompare.js";

const RECORDED: readonly TimedCaptureRow[] = [
  ...BOOK_INIT_ROWS,
  ["DELETE", "/api/books", [{ id: 2 }], 200, [{ id: 2 }]],
  ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
  ["GET", "/api/books", [FIRST_BOOK]],
];

describe("environment comparison of bulk writes", () => {
  it("sends a probe's bulk delete body to the served tool, which answers it from the state", () => {
    const fixture = environmentStateServeFixture(
      timedCaptureEvidence(RECORDED),
    );
    const report = compareEnvironment({
      source: environmentServeSource(fixture),
      captureValue: fixture.capture,
      probes: [
        {
          label: "bulk-delete",
          value: timedCaptureEvidence([
            ["GET", "/api/books/1", FIRST_BOOK],
            ["DELETE", "/api/books", [{ id: 1 }], 200, [{ id: 1 }]],
            ["GET", "/api/books/1", BOOK_NOT_FOUND, 404],
          ]),
        },
      ],
      operation: "environment-compare",
    });
    if (!report.ok) throw report.error;
    const [, deleted, read] = report.value.probes[0]!.results;
    expect(deleted).toMatchObject({ env_status: 200, equal: true });
    expect(read).toMatchObject({ env_status: 404, equal: true });
  });

  it("translates the ids a bulk body names with its collection's own mapping", () => {
    const project = { id: 7, name: "Project" };
    const fixture = environmentStateServeFixture(
      timedCaptureEvidence([
        ["GET", "/api/projects", [project]],
        ["GET", "/api/projects/7", project],
        ...RECORDED,
      ]),
    );
    // The probe reuses id 100 for the project and for the first book.
    const live = (id: number) => ({ ...FIRST_BOOK, id });
    const report = compareEnvironment({
      source: environmentServeSource(fixture),
      captureValue: fixture.capture,
      probes: [
        {
          label: "shared-id",
          value: timedCaptureEvidence([
            ["GET", "/api/projects", [{ ...project, id: 100 }]],
            ["GET", "/api/books", [live(100), { ...SECOND_BOOK, id: 101 }]],
            ["DELETE", "/api/books", [{ id: 100 }], 200, [{ id: 100 }]],
            ["GET", "/api/books/100", BOOK_NOT_FOUND, 404],
          ]),
        },
      ],
      operation: "environment-compare",
    });
    if (!report.ok) throw report.error;
    const [, , deleted, read] = report.value.probes[0]!.results;
    expect(deleted).toMatchObject({ env_status: 200, equal: true });
    expect(read).toMatchObject({ env_status: 404, equal: true });
  });
});

import { describe, expect, it } from "vitest";

import {
  environmentStateServeFixture,
  environmentServeSource,
} from "../../../tests/fixtures/environmentServe.js";
import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import { compareEnvironment } from "./environmentCompare.js";

const compareRows = (
  recorded: readonly TimedCaptureRow[],
  probe: readonly TimedCaptureRow[],
) => {
  const capture = timedCaptureEvidence(recorded);
  const fixture = environmentStateServeFixture(capture);
  const report = compareEnvironment({
    source: environmentServeSource(fixture),
    captureValue: capture,
    probes: [{ label: "probe", value: timedCaptureEvidence(probe) }],
    operation: "environment-compare",
  });
  if (!report.ok) throw report.error;
  return report.value.probes[0]!;
};

describe("environment comparison identifier semantics", () => {
  it("reports changed business tokens and numeric arrays through the application comparison boundary", () => {
    const probe = compareRows(
      [
        [
          "GET",
          "/api/measurements",
          { sku: "product1", samples: [1700000000] },
        ],
      ],
      [
        [
          "GET",
          "/api/measurements",
          { sku: "product2", samples: [1800000000] },
        ],
      ],
    );
    expect(probe.results[0]?.equal).toBe(false);
    expect(
      probe.results[0]?.differences.map(({ category, pointer }) => [
        category,
        pointer,
      ]),
    ).toEqual([
      ["value", "/sku"],
      ["value", "/samples/0"],
    ]);
    expect(probe.normalised.generated).toBe(0);
    expect(probe.normalised.clocks).toBe(0);
    const same = compareRows(
      [["GET", "/api/measurements", { samples: [1700000000] }]],
      [["GET", "/api/measurements", { samples: [1700000000] }]],
    );
    expect(same.results[0]?.equal).toBe(true);
  });
  it("compares numeric format identifiers literally while normalizing actual clock fields", () => {
    const fourcc = (value: string) => Buffer.from(value).readUInt32LE(0);
    const probe = compareRows(
      [
        [
          "GET",
          "/api/media",
          {
            format: fourcc("MJPG"),
            size: 1,
            updated_at: "2026-10-20T10:00:00Z",
          },
        ],
      ],
      [
        [
          "GET",
          "/api/media",
          {
            format: fourcc("YUYV"),
            size: 1,
            updated_at: "2026-10-17T18:00:03Z",
          },
        ],
      ],
    );
    expect(probe.results[0]?.equal).toBe(false);
    expect(
      probe.results[0]?.differences.map((difference) => [
        difference.category,
        difference.pointer,
      ]),
    ).toEqual([["value", "/format"]]);
    expect(probe.normalised.clocks).toBe(1);
  });

  it("does not normalize measurements after learning an unrelated numeric ID", () => {
    const probe = compareRows(
      [
        ["GET", "/api/items", [{ id: 1, name: "A" }]],
        ["GET", "/api/stats", { size: 1, workers: 1, price: 1 }],
      ],
      [
        ["GET", "/api/items", [{ id: 101, name: "A" }]],
        ["GET", "/api/stats", { size: 101, workers: 101, price: 101 }],
      ],
    );
    expect(probe.results.map((step) => step.equal)).toEqual([true, false]);
    expect(
      probe.results[1]?.differences.map((difference) => difference.pointer),
    ).toEqual(["/size", "/workers", "/price"]);
    expect(probe.normalised.ids).toBe(1);
  });

  it("does not collapse distinct references when one field is equal", () => {
    const cases: readonly [
      { owner_id: number; reviewer_id: number },
      { owner_id: number; reviewer_id: number },
    ][] = [
      [
        { owner_id: 1, reviewer_id: 1 },
        { owner_id: 1, reviewer_id: 2 },
      ],
      [
        { owner_id: 1, reviewer_id: 1 },
        { owner_id: 2, reviewer_id: 1 },
      ],
      [
        { owner_id: 2, reviewer_id: 1 },
        { owner_id: 1, reviewer_id: 1 },
      ],
    ];
    for (const [recorded, live] of cases) {
      const probe = compareRows(
        [["GET", "/api/review", recorded]],
        [["GET", "/api/review", live]],
      );
      expect(probe.results[0]?.equal).toBe(false);
      expect(probe.results[0]?.differences).not.toHaveLength(0);
      expect(probe.id_conflicts).toBeGreaterThan(0);
    }
    const identical = compareRows(
      [["GET", "/api/review", { owner_id: 1, reviewer_id: 1 }]],
      [["GET", "/api/review", { owner_id: 1, reviewer_id: 1 }]],
    );
    expect(identical.results[0]?.equal).toBe(true);
    expect(identical.normalised.ids).toBe(0);
  });

  it("maps keyed identities in the collection that owns them", () => {
    const book = (id: number) => ({ id, name: "Book", slug: "book" });
    const things = (id: number) => ({ [String(id)]: { id, name: "Thing" } });
    const probe = compareRows(
      [
        ["GET", "/api/books", [book(1)]],
        ["GET", "/api/books/1", book(1)],
        ["GET", "/api/things", things(102)],
      ],
      [
        ["GET", "/api/books", [book(101)]],
        ["GET", "/api/things", things(101)],
      ],
    );
    expect(probe.results.map((step) => step.equal)).toEqual([true, true]);
    expect(probe.results.flatMap((step) => step.differences)).toEqual([]);
  });
});

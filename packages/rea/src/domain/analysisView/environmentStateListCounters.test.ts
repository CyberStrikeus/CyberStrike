import { expect, it } from "vitest";
import type { JsonValue } from "../jsonValue.js";
import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import { environmentStateViewOf } from "../../../tests/fixtures/environmentStateWrites.js";
import { renderQueryList } from "./environmentStateListQuery.js";
import { renderStateList, type JsonObject } from "./environmentStateRules.js";

const vessel = (id: number, status: string): JsonObject => ({
  Id: id,
  name: `Vessel ${String(id)}`,
  status,
});
const SEEDED = [vessel(1, "Active"), vessel(2, "In Port"), vessel(3, "Active")];

/** A list in a paging envelope that counts its rows beside two page flags. */
const page = (list: readonly JsonObject[], totalRows = list.length) => ({
  list: [...list],
  pageInfo: {
    totalRows,
    page: 1,
    pageSize: 25,
    isFirstPage: true,
    isLastPage: true,
  },
});

/** A list beside a top-level total whose member name starts with a slash. */
const slashed = (list: readonly JsonObject[]) => ({
  list: [...list],
  "/total_count": list.length,
});

/** Seeded reads, a filtered line, then a create its list read-back counts, each list in `envelope`. */
const rowsOf = (
  envelope: (list: readonly JsonObject[]) => JsonValue = page,
): TimedCaptureRow[] => [
  ["GET", "/api/records?limit=25", envelope(SEEDED)],
  ["GET", "/api/records/1", SEEDED[0]!],
  ["GET", "/api/records/2", SEEDED[1]!],
  ["GET", "/api/records/3", SEEDED[2]!],
  [
    "GET",
    "/api/records?where=(status,eq,Active)",
    envelope([SEEDED[0]!, SEEDED[2]!]),
  ],
  [
    "POST",
    "/api/records",
    { Id: 4 },
    200,
    { name: "Vessel 4", status: "Laid Up" },
  ],
  ["GET", "/api/records/4", vessel(4, "Laid Up")],
  ["GET", "/api/records?limit=25", envelope([...SEEDED, vessel(4, "Laid Up")])],
];
const rows = rowsOf();

it("counts a total nested in a paging object, and serves the create its list read-back counts", () => {
  const state = environmentStateViewOf(timedCaptureEvidence(rows));
  expect(state.views.find((view) => view.tool === "get_records")).toMatchObject(
    { shape: "list", counters: ["/pageInfo/totalRows"] },
  );
  expect(
    state.writes.find((write) => write.tool === "post_records"),
  ).toMatchObject({ served: true, reason: null });
});

it("names a top-level total whose name starts with a slash by its pointer, and serves the create its list read-back counts", () => {
  const state = environmentStateViewOf(timedCaptureEvidence(rowsOf(slashed)));
  expect(state.views.find((view) => view.tool === "get_records")).toMatchObject(
    { shape: "list", counters: ["/~1total_count"] },
  );
  expect(
    state.writes.find((write) => write.tool === "post_records"),
  ).toMatchObject({ served: true, reason: null });
});

it("renders a nested counter and a nested query total from the state, leaving the page flags as recorded", () => {
  const base = page(SEEDED);
  const items = [...SEEDED, vessel(4, "Laid Up")];
  const view = {
    pointer: "/list",
    counters: ["/pageInfo/totalRows"],
    query: { totals: ["/pageInfo/totalRows"] },
  };
  expect(renderStateList(view, base, items)).toEqual(page(items));
  expect(renderQueryList(view, page([SEEDED[0]!]), [SEEDED[0]!], 2)).toEqual(
    page([SEEDED[0]!], 2),
  );
});

it("takes no nested member for a counter unless it equals the number listed", () => {
  const offBy = rows.map((row): TimedCaptureRow =>
    row[1] === "/api/records?limit=25" && row[2] !== undefined
      ? [row[0], row[1], { ...page(SEEDED), meta: { total: 99 } }]
      : row,
  );
  const state = environmentStateViewOf(timedCaptureEvidence(offBy));
  // A nested total that disagrees with the rows listed shows the line partial and counts nothing.
  expect(
    state.views.find((view) => view.tool === "get_records"),
  ).not.toMatchObject({ counters: expect.arrayContaining(["/meta/total"]) });
});

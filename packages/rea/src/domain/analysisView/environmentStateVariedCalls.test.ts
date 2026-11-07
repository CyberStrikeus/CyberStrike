import { describe, expect, it } from "vitest";

import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  CLEARED_THEN_OMITTED_KEPT_ROWS,
  DEFAULT_THEN_NUMBERED_ROWS,
  DONE_CLOCK_ROWS,
  DONE_MICRO_ROWS,
  NUMBERED_THEN_BLANK_ROWS,
  OWNER_CLEARED_THEN_NAMED_ROWS,
  SENT_DELETED_THEN_NUMBERED_ROWS,
  SENT_IN_ANOTHER_PROJECT_ROWS,
  OWNER_NAMED_THEN_CLEARED_ROWS,
  DONE_MIXED_ROWS,
  DONE_ZONE_ROWS,
  OMITTED_KEPT_THEN_CLEARED_ROWS,
  FEWER_MEMBERS_ROWS,
  NUMBERED_UNLESS_SENT_ROWS,
  NUMBERED_THEN_SENT_ROWS,
  SENT_THEN_DELETED_ROWS,
  KEPT_THEN_CLEARED_ROWS,
  CLEARED_THEN_KEPT_ROWS,
  PUT_CLEARS_ROWS,
} from "../../../tests/fixtures/environmentStateVariedCalls.js";
import { environmentStateViewOf } from "../../../tests/fixtures/environmentStateWrites.js";

const planOf = (rows: readonly TimedCaptureRow[], tool: string) => {
  const plan = environmentStateViewOf(timedCaptureEvidence(rows)).writes.find(
    (candidate) => candidate.tool === tool,
  );
  if (plan === undefined) throw new Error(`No plan for ${tool}`);
  return plan;
};

describe("writes whose calls send different members", () => {
  it("serves an update a later call sends fewer members to, requiring only those every call sent", () => {
    const plan = planOf(FEWER_MEMBERS_ROWS, "put_contacts_by_id");
    expect(plan).toMatchObject({ served: true });
    expect(plan.body?.required).toEqual(["email"]);
    expect(plan.body?.accepted).toEqual(
      expect.arrayContaining(["name", "city", "email"]),
    );
  });

  it("serves a create whose member one call sent and another left for the application to number", () => {
    const plan = planOf(NUMBERED_UNLESS_SENT_ROWS, "post_bundles");
    expect(plan).toMatchObject({ served: true });
    expect(plan.rules).toContainEqual({
      field: "order",
      rule: "sequence",
      scope: "collection",
      sent: true,
    });
    expect(plan.body?.required).toEqual(["name"]);
  });

  it("serves a create whose first call left a member to be numbered and whose second sent one", () => {
    const plan = planOf(NUMBERED_THEN_SENT_ROWS, "post_bundles");
    expect(plan).toMatchObject({ served: true });
    expect(plan.rules).toContainEqual({
      field: "order",
      rule: "sequence",
      scope: "collection",
      sent: true,
    });
  });

  it.each([
    ["kept, then cleared", KEPT_THEN_CLEARED_ROWS],
    ["cleared, then kept", CLEARED_THEN_KEPT_ROWS],
  ])(
    "withholds a PUT whose calls left a member out and stored it otherwise (%s)",
    (_order, rows) => {
      expect(planOf(rows, "put_tags_by_id")).toMatchObject({
        served: false,
        reason: "unexplained-change",
      });
    },
  );

  it("confirms an update whose read shows the clock it stamped to the second", () => {
    expect(planOf(DONE_CLOCK_ROWS, "patch_tasks_by_id")).toMatchObject({
      served: true,
    });
  });

  it("serves no update whose clock the read after it spells in another zone, which serving cannot store", () => {
    // The read spells the answer's instant at the second, but as +00:00: serving would keep the answer's spelling.
    expect(planOf(DONE_ZONE_ROWS, "patch_tasks_by_id")).toMatchObject({
      served: false,
    });
  });

  it.each([
    [
      "answered without the owner its read shows kept, then cleared",
      OMITTED_KEPT_THEN_CLEARED_ROWS,
    ],
    [
      "cleared, then answered without the owner its read shows kept",
      CLEARED_THEN_OMITTED_KEPT_ROWS,
    ],
  ])(
    "withholds a PUT default an earlier or later read contradicts: %s",
    (_order, rows) => {
      expect(planOf(rows, "put_tags_by_id")).toMatchObject({ served: false });
    },
  );

  it("serves a PUT that clears a member it left out, as a default", () => {
    const plan = planOf(PUT_CLEARS_ROWS, "put_tags_by_id");
    expect(plan).toMatchObject({ served: true });
    expect(plan.body?.defaults).toEqual([{ member: "owner", value: null }]);
  });

  it("recognizes a sent array when learning a later omitted-member default", () => {
    const a = { id: 1, name: "A", tags: ["x"] };
    const b = { id: 2, name: "B", tags: ["y"] };
    const changedA = { ...a, name: "AA" };
    const changedB = { ...b, name: "BB", tags: [] };
    const rows: readonly TimedCaptureRow[] = [
      ["GET", "/api/tags", [a, b]],
      ["GET", "/api/tags/1", a],
      ["GET", "/api/tags/2", b],
      ["PUT", "/api/tags/1", changedA, 200, { name: "AA", tags: ["x"] }],
      ["GET", "/api/tags/1", changedA],
      ["PUT", "/api/tags/2", changedB, 200, { name: "BB" }],
      ["GET", "/api/tags/2", changedB],
      ["GET", "/api/tags", [changedA, changedB]],
    ];
    expect(planOf(rows, "put_tags_by_id")).toMatchObject({ served: true });
  });

  it("withholds a sent sequence value contradicted by its recorded answer", () => {
    const rows: readonly TimedCaptureRow[] = [
      ...NUMBERED_UNLESS_SENT_ROWS.map((row) =>
        row[0] === "GET" && row[1] === "/api/bundles" && Array.isArray(row[2])
          ? ([
              row[0],
              row[1],
              (row[2] as { id: number; name: string }[]).map(
                ({ id, name }) => ({ id, name }),
              ),
            ] as TimedCaptureRow)
          : row,
      ),
      [
        "POST",
        "/api/bundles",
        { id: 5, name: "Echo", order: 10 },
        201,
        { name: "Echo", order: 9 },
      ],
      [
        "GET",
        "/api/bundles",
        [
          { id: 1, name: "Alpha" },
          { id: 2, name: "Bravo" },
          { id: 3, name: "Charlie" },
          { id: 4, name: "Delta" },
          { id: 5, name: "Echo" },
        ],
      ],
    ];
    expect(planOf(rows, "post_bundles")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });
});

describe("writes replay holds as serving does", () => {
  it("serves no create numbered below a sent value it deleted, as serving counts past it", () => {
    // Serving keeps the largest order sent, 9, and would number the last create 10.
    expect(planOf(SENT_THEN_DELETED_ROWS, "post_bundles")).toMatchObject({
      served: false,
    });
  });

  it("serves no update whose read spells its clock otherwise than the read the plan keeps", () => {
    // Serving stores every update's clock as the first read spells it, to the millisecond.
    expect(planOf(DONE_MIXED_ROWS, "patch_tasks_by_id")).toMatchObject({
      served: false,
    });
  });
});

describe("writes whose calls send different members, alike in replay and serving", () => {
  it("serves no create numbered when left out after a call that left it out stored a fixed value", () => {
    const plan = planOf(DEFAULT_THEN_NUMBERED_ROWS, "post_bundles");
    expect(plan.rules).not.toContainEqual(
      expect.objectContaining({ field: "order", rule: "sequence" }),
    );
    expect(plan).toMatchObject({ served: false });
  });

  it("confirms an update whose read shows the clock it stamped to the microsecond", () => {
    expect(planOf(DONE_MICRO_ROWS, "patch_tasks_by_id")).toMatchObject({
      served: true,
    });
  });

  it.each([
    ["named first", OWNER_NAMED_THEN_CLEARED_ROWS],
    ["cleared first", OWNER_CLEARED_THEN_NAMED_ROWS],
  ])(
    "serves a PUT that names a reference by its member and one that leaves it out and clears it: %s",
    (_order, rows) => {
      const plan = planOf(rows, "put_tags_by_id");
      expect(plan).toMatchObject({ served: true });
      expect(plan.rules).toContainEqual(
        expect.objectContaining({
          field: "owner",
          rule: "reference",
          member: "ownerId",
        }),
      );
    },
  );

  it("serves no create numbered below a value an earlier create sent, which serving counts past", () => {
    const plan = planOf(SENT_DELETED_THEN_NUMBERED_ROWS, "post_bundles");
    expect(plan.rules).not.toContainEqual(
      expect.objectContaining({ field: "order", rule: "sequence" }),
    );
    expect(plan).toMatchObject({ served: false });
  });

  it("serves a create numbered in its own project past what it holds, though another project's create sent more", () => {
    const plan = planOf(
      SENT_IN_ANOTHER_PROJECT_ROWS,
      "post_projects_bundles_by_id",
    );
    expect(plan).toMatchObject({ served: true });
    expect(plan.rules).toContainEqual(
      expect.objectContaining({
        field: "order",
        rule: "sequence",
        scope: "collection",
        sent: true,
      }),
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  BULK_TASK_ROWS,
  COUNTED_TASK_ROWS,
  MISLINKED_TASK_ROWS,
  ONE_TASK_ROWS,
  RESPELLED_TASK_ROWS,
  STALE_MADE_TASK_ROWS,
  UNCLOCKED_TASK_ROWS,
} from "../../../tests/fixtures/environmentStateMadeValues.js";
import { environmentStateViewOf } from "../../../tests/fixtures/environmentStateWrites.js";
import { respondedIds } from "./environmentStateWriteLinks.js";
import { createdMadeObject } from "./environmentStateWriteStamps.js";

const createOf = (rows: readonly TimedCaptureRow[]) => {
  const plan = environmentStateViewOf(timedCaptureEvidence(rows)).writes.find(
    (candidate) => candidate.effect === "create",
  );
  if (plan === undefined) throw new Error("No create plan");
  return plan;
};

const ruleFor = (plan: ReturnType<typeof createOf>, field: string): unknown =>
  plan.rules.find((rule) => rule.field === field);

describe("values an application counts and makes with each created entity", () => {
  it("does not adopt a sequence that contradicts an earlier accepted create", () => {
    const a = { id: 1, title: "A", index: 1 };
    const b = { id: 2, title: "B", index: 2 };
    const c = { id: 3, title: "C", index: 15 };
    const d = { id: 4, title: "D", index: 15 };
    const e = { id: 5, title: "E", index: 16 };
    const rows: readonly TimedCaptureRow[] = [
      ["GET", "/api/tasks", [a, b]],
      ["GET", "/api/tasks/1", a],
      ["POST", "/api/tasks", c, 201, { title: "C" }],
      ["GET", "/api/tasks/3", c],
      ["GET", "/api/tasks", [a, b, c]],
      ["POST", "/api/tasks", d, 201, { title: "D" }],
      ["GET", "/api/tasks/4", d],
      ["GET", "/api/tasks", [a, b, c, d]],
      ["POST", "/api/tasks", e, 201, { title: "E" }],
      ["GET", "/api/tasks/5", e],
      ["GET", "/api/tasks", [a, b, c, d, e]],
    ];
    const plan = createOf(rows);
    expect(plan).toMatchObject({ served: false });
    expect(ruleFor(plan, "index")).toBeUndefined();
  });
  it("learns a counter from where the first create stood, a template around it and the object made with each task", () => {
    const plan = createOf(COUNTED_TASK_ROWS);
    expect(plan).toMatchObject({
      served: true,
      checked_record_ordinals: [4, 7],
    });
    expect(ruleFor(plan, "index")).toEqual({
      field: "index",
      rule: "sequence",
      scope: "collection",
      start: 15,
    });
    expect(ruleFor(plan, "identifier")).toEqual({
      field: "identifier",
      rule: "template",
      from: "index",
    });
    expect(ruleFor(plan, "subscription")).toMatchObject({
      rule: "made-object",
      clocks: ["created"],
      own: ["entity_id"],
      counts: [{ member: "id", start: 21 }],
    });
  });

  it("keeps a value one create alone shows past what the type held", () => {
    const plan = createOf(ONE_TASK_ROWS);
    expect(ruleFor(plan, "index")).toBeUndefined();
    expect(ruleFor(plan, "subscription")).toMatchObject({
      rule: "made-object",
      counts: [],
    });
  });

  it("links a create whose answer wraps the entity in a one-element array member", () => {
    expect(createOf(BULK_TASK_ROWS)).toMatchObject({
      tool: "post_projects_tasks_bulk_by_id",
      served: true,
      body: { envelope: "tasks" },
    });
    expect(respondedIds({ tasks: [{ id: 14 }] })).toEqual(["14"]);
    expect(respondedIds({ tasks: [{ id: 14 }, { id: 15 }] })).toEqual([]);
  });

  it("withholds a create whose only clock is its made object's when the capture has no clock anchor", () => {
    expect(createOf(UNCLOCKED_TASK_ROWS)).toMatchObject({ served: true });
    expect(
      createOf([
        ...UNCLOCKED_TASK_ROWS,
        ["GET", "/api/health", { ready: true }, 200, undefined, -1],
      ]),
    ).toMatchObject({ served: false, reason: "unknown-clock" });
  });

  it("withholds the creates when a later made object names another entity", () => {
    expect(createOf(MISLINKED_TASK_ROWS)).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it("adopts no template that would not spell the later create's value", () => {
    const plan = createOf(RESPELLED_TASK_ROWS);
    expect(plan).toMatchObject({ served: false, reason: "unexplained-change" });
    expect(ruleFor(plan, "identifier")).toBeUndefined();
  });

  it("withholds the creates when a later made object holds a clock its request did not stamp", () => {
    expect(createOf(STALE_MADE_TASK_ROWS)).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it("makes no object rule without a clock the request stamped", () => {
    expect(
      createdMadeObject(
        "subscription",
        { id: 21, entity: "task", entity_id: 20 },
        {
          startMs: Date.parse("2026-10-17T18:00:02Z"),
          type: [],
          entity: { id: 20 },
          idField: "id",
        },
      ),
    ).toBeUndefined();
  });
});

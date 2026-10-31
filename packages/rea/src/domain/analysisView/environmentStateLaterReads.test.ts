import { describe, expect, it } from "vitest";

import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  GHOST_DELETED_ROWS,
  INITIAL_TRASH_ROWS,
  LATER_FIELD_ROWS,
  LATER_MIXED_BULK_ROWS,
  MAX_SIZE_ROWS,
  SOFT_DELETED_QUERY_ROWS,
  SOFT_DELETED_ROWS,
} from "../../../tests/fixtures/environmentStateLaterReads.js";
import { environmentStateViewOf } from "../../../tests/fixtures/environmentStateWrites.js";
import { markedDeleted } from "./environmentStateRules.js";

const viewOf = (rows: readonly TimedCaptureRow[]) =>
  environmentStateViewOf(timedCaptureEvidence(rows));

const planOf = (rows: readonly TimedCaptureRow[], tool: string) => {
  const plan = viewOf(rows).writes.find((candidate) => candidate.tool === tool);
  if (plan === undefined) throw new Error(`No plan for ${tool}`);
  return plan;
};

describe("deletes the application answers for afterwards", () => {
  it("replays an initial list that includes a deleted entity", () => {
    expect(
      viewOf(INITIAL_TRASH_ROWS).views.find(
        (view) => view.tool === "get_contacts",
      ),
    ).toMatchObject({ shape: "recorded", reason: "list-differs" });
  });
  it("confirms a delete by an item read that shows the entity marked deleted", () => {
    expect(planOf(SOFT_DELETED_ROWS, "delete_contacts_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [5, 7],
    });
  });

  it("withholds a soft delete when its read changes another field", () => {
    const rows: readonly TimedCaptureRow[] = SOFT_DELETED_ROWS.map((row) =>
      row[0] === "GET" &&
      row[1] === "/api/contacts/2" &&
      typeof row[2] === "object" &&
      row[2] !== null &&
      !Array.isArray(row[2]) &&
      row[2]["deleted"] === true
        ? [row[0], row[1], { ...row[2], name: "Changed by deletion" }]
        : row,
    );
    expect(planOf(rows, "delete_contacts_by_id")).toMatchObject({
      served: false,
    });
  });

  it("learns on the item view the flag later reads set on a soft-deleted contact", () => {
    const item = (rows: readonly TimedCaptureRow[]) =>
      viewOf(rows).views.find((view) => view.tool === "get_contacts_by_id");
    expect(item(SOFT_DELETED_ROWS)).toMatchObject({
      shape: "item",
      deleted_flag: "deleted",
    });
    // Reads with a query, such as a cache-busting parameter, show the flag as well.
    expect(item(SOFT_DELETED_QUERY_ROWS)).toMatchObject({
      deleted_flag: "deleted",
    });
    expect(item(MAX_SIZE_ROWS)).not.toHaveProperty("deleted_flag");
  });

  it.each([
    [{ deleted: true }, true],
    [{ isDeleted: true }, true],
    [{ is_deleted: true }, true],
    [{ deleted: false }, false],
    [{ deleted: "true" }, false],
    [{ deleted_at: "2026-10-26T10:00:00Z" }, false],
  ])("reads %j as soft-deleted: %s", (object, expected) => {
    expect(markedDeleted(object)).toBe(expected);
  });

  it("drops a held entity a read shows marked deleted, so a later list without it confirms another delete", () => {
    expect(planOf(GHOST_DELETED_ROWS, "delete_contacts_by_id")).toMatchObject({
      served: true,
    });
  });

  it("checks a list read whose page size is named `maxSize`", () => {
    expect(planOf(MAX_SIZE_ROWS, "delete_contacts_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [4, 6],
    });
  });
});

describe("fields only later reads show", () => {
  it("adds a field only created entities show to the item view, without requiring it", () => {
    const view = viewOf(LATER_FIELD_ROWS).views.find(
      (candidate) => candidate.tool === "get_tasks_by_id",
    );
    expect(view).toMatchObject({
      shape: "item",
      fields: ["id", "title", "done", "subscription"],
      required_fields: ["id", "title", "done"],
    });
  });

  it("serves an update whose answers show a field initial entities lack", () => {
    expect(planOf(LATER_FIELD_ROWS, "patch_tasks_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [9, 11, 12],
    });
  });

  it("replays a bulk update whose answer shows a later-only field on created entities only", () => {
    expect(planOf(LATER_MIXED_BULK_ROWS, "patch_tasks")).toMatchObject({
      served: true,
    });
  });
});

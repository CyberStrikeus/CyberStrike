import { describe, expect, it } from "vitest";

import {
  INITIAL_TRASH_ROWS,
  LATER_BULK_ROWS,
  LATER_FIELD_ROWS,
  OMITTED_FLAG_ROWS,
  SOFT_DELETED_ANSWER_ROWS,
  SOFT_DELETED_QUERY_ROWS,
  SOFT_DELETED_ROWS,
  STALE_DELETE_ANSWER_ROWS,
  STALE_BULK_DELETE_ROWS,
} from "../../../tests/fixtures/environmentStateLaterReads.js";
import { servedFrom } from "../../../tests/fixtures/environmentStateServing.js";
import type { JsonValue } from "../../domain/jsonValue.js";

const names = (body: JsonValue | undefined): JsonValue[] => {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new Error("Expected an object body");
  const list = body["list"];
  if (!Array.isArray(list)) throw new Error("Expected a list");
  return list.map((item) =>
    typeof item === "object" && item !== null && !Array.isArray(item)
      ? (item["name"] ?? null)
      : null,
  );
};

describe("served writes modelled on later reads", () => {
  it("replays the recorded list when it includes a deleted row", () => {
    const contacts = servedFrom(INITIAL_TRASH_ROWS);
    expect(
      contacts.answer("get_contacts", { maxSize: "20", offset: "0" }).body,
    ).toEqual(INITIAL_TRASH_ROWS[0]![2]);
  });
  it("keeps an initially deleted item readable without treating it as live", () => {
    const deleted = { id: 4, name: "Gone", deleted: true };
    const rows = [
      ...SOFT_DELETED_ROWS.slice(0, 4),
      ["GET", "/api/contacts/4", deleted] as const,
      ...SOFT_DELETED_ROWS.slice(4),
    ];
    const contacts = servedFrom(rows);
    expect(contacts.answer("get_contacts_by_id", { id: "4" }).body).toEqual(
      deleted,
    );
    expect(
      contacts.store.entity("/api/contacts", "/api/contacts", "4"),
    ).toBeUndefined();
    expect(names(contacts.answer("get_contacts").body)).not.toContain("Gone");
    expect(contacts.call("delete_contacts_by_id", { id: "4" }).ok).toBe(false);
    const snapshot = contacts.store.snapshot();
    expect(contacts.store.replace(snapshot).ok).toBe(true);
    expect(contacts.answer("get_contacts_by_id", { id: "4" }).body).toEqual(
      deleted,
    );
    const held = snapshot.rea_state.entities.find(
      (entity) => entity.id === "4",
    )!;
    expect(
      contacts.store.insert(
        { ...held, fields: { ...held.fields, deleted: false } },
        0,
      ).ok,
    ).toBe(true);
    expect(
      contacts.store
        .snapshot()
        .rea_state.entities.filter((entity) => entity.id === "4"),
    ).toHaveLength(1);
    expect(contacts.store.byteLength()).toBe(
      Buffer.byteLength(JSON.stringify(contacts.store.snapshot())),
    );
    contacts.store.reset();
    expect(
      contacts.store.entity("/api/contacts", "/api/contacts", "4"),
    ).toBeUndefined();
    expect(contacts.answer("get_contacts_by_id", { id: "4" }).body).toEqual(
      deleted,
    );
    const noWrites = servedFrom(rows.slice(0, 5));
    expect(noWrites.answer("get_contacts_by_id", { id: "4" }).body).toEqual(
      deleted,
    );
  });
  it("removes a soft-deleted contact from the served state", () => {
    const contacts = servedFrom(SOFT_DELETED_ROWS);
    contacts.answer("delete_contacts_by_id", { id: "1" });
    expect(names(contacts.answer("get_contacts").body)).toEqual([
      "Mina Okafor",
      "Rui Castellanos",
    ]);
  });

  it("reads a served-deleted contact back marked deleted, as the application answers", () => {
    const contacts = servedFrom(SOFT_DELETED_ROWS);
    contacts.answer("delete_contacts_by_id", { id: "1" });
    expect(contacts.answer("get_contacts_by_id", { id: "1" }).body).toEqual({
      id: 1,
      name: "Ada Finch",
      deleted: true,
    });
    // The read finds only what a served delete kept: a reset starts again without it.
    contacts.store.reset();
    expect(contacts.answer("get_contacts_by_id", { id: "1" }).body).toEqual({
      id: 1,
      name: "Ada Finch",
      deleted: false,
    });
    // A removal that keeps nothing, as a delete of a type that hard-deletes is, leaves no read.
    contacts.store.removeAll(contacts.store.startedWith("/api/contacts"));
    expect(contacts.refusal("get_contacts_by_id", { id: "1" })).toMatchObject({
      code: expect.any(String),
    });
  });

  it("reads a served-deleted contact back marked deleted when only reads with a query showed one", () => {
    const contacts = servedFrom(SOFT_DELETED_QUERY_ROWS);
    contacts.answer("delete_contacts_by_id", { id: "1" });
    expect(contacts.answer("get_contacts_by_id", { id: "1" }).body).toEqual({
      id: 1,
      name: "Ada Finch",
      deleted: true,
    });
  });

  it("answers an update of an initial entity without the field only created entities show", () => {
    const tasks = servedFrom(LATER_FIELD_ROWS);
    const body = tasks.answer("patch_tasks_by_id", {
      id: "1",
      body: { done: true },
    }).body;
    expect(body).toEqual({ id: 1, title: "Trim the wicks", done: true });
  });

  it("answers a bulk update of an initial entity without the field only created entities show", () => {
    const tasks = servedFrom(LATER_BULK_ROWS);
    const body = tasks.answer("patch_tasks", {
      body: [{ id: 1, done: true }],
    }).body;
    expect(body).toEqual([{ id: 1, title: "Trim the wicks", done: true }]);
  });

  it("answers a soft delete with the record marked deleted, as the application does", () => {
    const contacts = servedFrom(SOFT_DELETED_ANSWER_ROWS);
    expect(contacts.answer("delete_contacts_by_id", { id: "1" }).body).toEqual({
      id: 1,
      name: "Ada Finch",
      deleted: true,
    });
  });

  it("answers a soft delete with the flag its recorded answer showed, and reads the record back marked deleted", () => {
    const contacts = servedFrom(STALE_DELETE_ANSWER_ROWS);
    expect(contacts.answer("delete_contacts_by_id", { id: "1" }).body).toEqual({
      id: 1,
      name: "Ada Finch",
      deleted: false,
    });
    expect(contacts.answer("get_contacts_by_id", { id: "1" }).body).toEqual({
      id: 1,
      name: "Ada Finch",
      deleted: true,
    });
  });

  it("answers a soft bulk delete with the flag its recorded answer showed", () => {
    const contacts = servedFrom(STALE_BULK_DELETE_ROWS);
    expect(
      contacts.answer("delete_contacts", { body: [{ id: 1 }] }).body,
    ).toEqual([{ id: 1, name: "Ada Finch", deleted: false }]);
  });

  it("reads a soft-deleted record back marked deleted when live records omit the flag", () => {
    const contacts = servedFrom(OMITTED_FLAG_ROWS);
    contacts.answer("delete_contacts_by_id", { id: "1" });
    expect(contacts.answer("get_contacts_by_id", { id: "1" }).body).toEqual({
      id: 1,
      name: "Ada Finch",
      deleted: true,
    });
  });
});

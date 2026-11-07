import { describe, expect, it } from "vitest";

import {
  ACTIVE_ON_READ_ROWS,
  BULK_RENAMED_LABEL_ROWS,
  ECHOED_EMPTY_ROWS,
  formLabelRows,
  LISTED_ID_ROWS,
  NOTE_DEFAULT_ROWS,
  RENAMED_LABEL_ROWS,
  TITLE_ORDER_ROWS,
  UNLOADED_ANSWER_ROWS,
  PARTIAL_OWNER_ROWS,
} from "../../../tests/fixtures/environmentStateFormWrites.js";
import { servedFrom } from "../../../tests/fixtures/environmentStateServing.js";
import type { JsonValue } from "../../domain/jsonValue.js";

const field = (body: JsonValue | undefined, name: string): JsonValue[] => {
  if (!Array.isArray(body)) throw new Error("Expected a list body");
  return body.map((item) =>
    typeof item === "object" && item !== null && !Array.isArray(item)
      ? (item[name] ?? null)
      : null,
  );
};

describe("served creates and updates modelled on form recordings", () => {
  it("answers a create with the nested members its recorded answer showed, storing those its read showed", () => {
    const tasks = servedFrom(PARTIAL_OWNER_ROWS);
    const body = tasks.answer("post_tasks", {
      body: { title: "Coil the ropes" },
    }).body;
    const { id, owner } = body as { id: number; owner: JsonValue };
    expect(owner).toEqual({ id: 1 });
    expect(
      tasks.answer("get_tasks_by_id", { id: String(id) }).body,
    ).toMatchObject({
      owner: { id: 1, name: "Rea Admin" },
    });
  });

  it("creates an entity from its name alone, storing the members the form sent empty as it sent them", () => {
    const labels = servedFrom(formLabelRows());
    expect(
      labels.answer("post_labels", { body: { name: "Loaned Out" } }).body,
    ).toEqual({
      id: 3,
      name: "Loaned Out",
      description: "",
      color: "",
      icon: "",
    });
    expect(field(labels.answer("get_labels").body, "name")).toEqual([
      "Kitchen",
      "Loaned Out",
      "Tools",
    ]);
    expect(
      labels.refusal("post_labels", { body: { description: "No name" } }),
    ).toMatchObject({ message: expect.stringContaining('"name"') });
  });

  it("answers an empty member a call sent as it was sent, whichever spelling the recorded answer used", () => {
    const labels = servedFrom(ECHOED_EMPTY_ROWS);
    const tags = (sent: JsonValue) => {
      const body = labels.answer("post_labels", {
        body: { name: `Spare ${JSON.stringify(sent)}`, tags: sent },
      }).body;
      if (typeof body !== "object" || body === null || Array.isArray(body))
        throw new Error("Expected an object body");
      return body["tags"];
    };
    expect(tags([])).toEqual([]);
    expect(tags(null)).toBeNull();
  });

  it("moves a renamed entity to where the collection's order puts its new name", () => {
    const labels = servedFrom(RENAMED_LABEL_ROWS);
    labels.answer("patch_labels_by_id", { id: "1", body: { name: "Zinc" } });
    expect(field(labels.answer("get_labels").body, "name")).toEqual([
      "Tools",
      "Zinc",
    ]);
  });

  it("keeps folders by title after a served create and rename", () => {
    const folders = servedFrom(TITLE_ORDER_ROWS);
    folders.answer("post_folders", { body: { title: "Harbour Ops" } });
    expect(field(folders.answer("get_folders").body, "title")).toEqual([
      "Harbour Ops",
      "Lighthouse Rota",
    ]);
    folders.answer("put_folders_by_id", {
      id: "1",
      body: { title: "Archive", version: 1 },
    });
    expect(field(folders.answer("get_folders").body, "title")).toEqual([
      "Archive",
      "Harbour Ops",
    ]);
  });

  it("moves every entity a bulk rename writes to where its new name sorts", () => {
    const labels = servedFrom(BULK_RENAMED_LABEL_ROWS);
    const created = (name: string) => {
      const body = labels.answer("post_labels", { body: { name } }).body;
      if (typeof body !== "object" || body === null || Array.isArray(body))
        throw new Error("Expected an object body");
      return body["id"]!;
    };
    created("Attic");
    const garden = created("Garden");
    expect(field(labels.answer("get_labels").body, "name")).toEqual([
      "Attic",
      "Garden",
      "Kitchen",
      "Tools",
    ]);
    labels.answer("patch_labels", {
      body: [
        { id: garden, name: "Vane" },
        { id: 1, name: "Wharf" },
      ],
    });
    expect(field(labels.answer("get_labels").body, "name")).toEqual([
      "Attic",
      "Tools",
      "Vane",
      "Wharf",
    ]);
  });

  it("accepts a member sent empty as one recording did, and stores the default for one left out", () => {
    const notes = servedFrom(NOTE_DEFAULT_ROWS);
    expect(
      notes.answer("post_notes", { body: { name: "Blank", note: null } }).body,
    ).toMatchObject({ name: "Blank", note: null });
    expect(
      notes.answer("post_notes", { body: { name: "Left out" } }).body,
    ).toMatchObject({ name: "Left out", note: "" });
  });

  it("answers writes with empty lists spelled as their recorded answers spelled them", () => {
    const tasks = servedFrom(UNLOADED_ANSWER_ROWS);
    expect(
      tasks.answer("post_tasks", { body: { title: "Coil the ropes" } }).body,
    ).toMatchObject({
      id: 2,
      title: "Coil the ropes",
      assignees: [],
      owner: { id: 1, name: "", created: "0001-01-01T00:00:00Z" },
    });
    expect(tasks.answer("get_tasks_by_id", { id: "2" }).body).toMatchObject({
      owner: { id: 1, name: "Rea Admin" },
    });
    expect(
      tasks.answer("patch_tasks_by_id", { id: "1", body: { done: true } }).body,
    ).toMatchObject({ done: true, assignees: [] });
    expect(tasks.answer("get_tasks_by_id", { id: "1" }).body).toMatchObject({
      done: true,
      assignees: null,
    });
  });

  it("answers a sent value its create does not store as the recorded answer did, and stores the read's", () => {
    const users = servedFrom(ACTIVE_ON_READ_ROWS);
    expect(
      users.answer("post_users", { body: { name: "Cy", active: false } }).body,
    ).toEqual({ id: 2, name: "Cy", active: false });
    expect(users.answer("get_users_by_id", { id: "2" }).body).toEqual({
      id: 2,
      name: "Cy",
      active: true,
    });
  });

  it("lists a created tag's id in the list envelope's ids, in list order", () => {
    const tags = servedFrom(LISTED_ID_ROWS);
    tags.answer("post_tags", { body: { name: "Lamp" } });
    expect(tags.answer("get_tags").body).toMatchObject({
      count: 3,
      all: [1, 3, 2],
    });
  });
});

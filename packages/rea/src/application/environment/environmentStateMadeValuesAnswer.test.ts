import { describe, expect, it } from "vitest";

import {
  BULK_TASK_ROWS,
  CHOSEN_ID_TASK_ROWS,
  COUNTED_TASK_ROWS,
} from "../../../tests/fixtures/environmentStateMadeValues.js";
import { servedFrom } from "../../../tests/fixtures/environmentStateServing.js";
import { isObject } from "../../domain/analysisView/environmentStateRules.js";
import type { JsonValue } from "../../domain/jsonValue.js";

const objectOf = (body: JsonValue | undefined) => {
  if (!isObject(body)) throw new Error("Expected an object body");
  return body;
};

describe("served creates that count and make values", () => {
  it("numbers created tasks on from the recorded counter and makes each one's subscription", () => {
    const tasks = servedFrom(COUNTED_TASK_ROWS);
    const first = objectOf(
      tasks.answer("post_projects_tasks_by_id", {
        id: "5",
        body: { title: "Restock the fog-horn spares" },
      }).body,
    );
    const second = objectOf(
      tasks.answer("post_projects_tasks_by_id", {
        id: "5",
        body: { title: "Paint the gallery rail" },
      }).body,
    );
    expect([first["index"], first["identifier"]]).toEqual([15, "#15"]);
    expect([second["index"], second["identifier"]]).toEqual([16, "#16"]);
    const read = objectOf(
      tasks.answer("get_tasks_by_id", { id: String(second["id"]) }).body,
    );
    expect(read["subscription"]).toMatchObject({
      id: 22,
      entity: "task",
      entity_id: second["id"],
    });
  });

  it("links a made object to the id the caller chose", () => {
    const tasks = servedFrom(CHOSEN_ID_TASK_ROWS);
    tasks.answer("post_projects_tasks_by_id", {
      id: "5",
      body: { id: 99, title: "Restock the fog-horn spares" },
    });
    const read = objectOf(tasks.answer("get_tasks_by_id", { id: "99" }).body);
    expect(read["subscription"]).toMatchObject({ entity_id: 99 });
  });

  it("answers a bulk create in the envelope it was sent in", () => {
    const tasks = servedFrom(BULK_TASK_ROWS);
    const body = objectOf(
      tasks.answer("post_projects_tasks_bulk_by_id", {
        id: "5",
        body: { tasks: [{ title: "Restock the fog-horn spares" }] },
      }).body,
    );
    expect(body["tasks"]).toMatchObject([
      { title: "Restock the fog-horn spares", index: 15, identifier: "#15" },
    ]);
  });

  it("creates into another project when the task stores its project and lands in one collection", () => {
    const tasks = servedFrom(BULK_TASK_ROWS);
    const body = objectOf(
      tasks.answer("post_projects_tasks_bulk_by_id", {
        id: "7",
        body: { tasks: [{ title: "Paint the gallery rail" }] },
      }).body,
    );
    expect(body["tasks"]).toMatchObject([{ project_id: 7 }]);
  });
});

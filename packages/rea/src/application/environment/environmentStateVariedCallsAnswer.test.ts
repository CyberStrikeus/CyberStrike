import { describe, expect, it } from "vitest";

import {
  DONE_CLOCK_ROWS,
  FEWER_MEMBERS_ROWS,
  NUMBERED_THEN_BLANK_ROWS,
  NUMBERED_UNLESS_SENT_ROWS,
  OWNER_CLEARED_THEN_NAMED_ROWS,
  OWNER_NAMED_THEN_CLEARED_ROWS,
  PUT_CLEARS_ROWS,
} from "../../../tests/fixtures/environmentStateVariedCalls.js";
import { servedFrom } from "../../../tests/fixtures/environmentStateServing.js";

describe("served writes whose calls send different members", () => {
  it("numbers a created bundle that leaves its order out, and keeps one a call sends", () => {
    const bundles = servedFrom(NUMBERED_UNLESS_SENT_ROWS);
    expect(
      bundles.answer("post_bundles", { body: { name: "Echo" } }).body,
    ).toMatchObject({ name: "Echo", order: 2 });
    expect(
      bundles.answer("post_bundles", { body: { name: "Foxtrot", order: 9 } })
        .body,
    ).toMatchObject({
      name: "Foxtrot",
      order: 9,
    });
  });

  it("numbers past an order a call sent, even once that bundle is gone", () => {
    const bundles = servedFrom(NUMBERED_UNLESS_SENT_ROWS);
    bundles.answer("post_bundles", { body: { name: "Echo" } });
    bundles.answer("post_bundles", { body: { name: "Foxtrot", order: 9 } });
    bundles.store.removeAll(
      bundles.store
        .ofType("/api/bundles")
        .filter((entity) => entity.fields["order"] === 9),
    );
    expect(
      bundles.answer("post_bundles", { body: { name: "Golf" } }).body,
    ).toMatchObject({ name: "Golf", order: 10 });
  });

  it("clears a member a PUT leaves out, as the application did, and keeps one it sends", () => {
    const tags = servedFrom(PUT_CLEARS_ROWS);
    expect(
      tags.answer("put_tags_by_id", { id: "2", body: { name: "Receipts" } })
        .body,
    ).toMatchObject({
      name: "Receipts",
      owner: null,
    });
    expect(tags.answer("get_tags_by_id", { id: "2" }).body).toMatchObject({
      owner: null,
    });
    expect(
      tags.answer("put_tags_by_id", {
        id: "1",
        body: { name: "Mail", owner: 3 },
      }).body,
    ).toMatchObject({
      name: "Mail",
      owner: 3,
    });
  });

  it.each([
    ["named first", OWNER_NAMED_THEN_CLEARED_ROWS],
    ["cleared first", OWNER_CLEARED_THEN_NAMED_ROWS],
  ])(
    "clears a referenced owner a PUT leaves out, and stores the one a PUT names by its id: %s",
    (_order, rows) => {
      const tags = servedFrom(rows);
      expect(
        tags.answer("put_tags_by_id", { id: "1", body: { name: "Receipts" } })
          .body,
      ).toMatchObject({ name: "Receipts", owner: null });
      expect(
        tags.answer("put_tags_by_id", {
          id: "2",
          body: { name: "Mail", ownerId: 4 },
        }).body,
      ).toMatchObject({ name: "Mail", owner: { id: 4, name: "Bo" } });
    },
  );

  it("answers an update with its clock spelled as the recorded answer and stores it as reads spell it", () => {
    const tasks = servedFrom(DONE_CLOCK_ROWS);
    const answered = tasks.answer("patch_tasks_by_id", {
      id: "1",
      body: { done: true },
    }).body as { done_at: string };
    expect(answered.done_at).toMatch(/\.\d{9}Z$/u);
    const read = tasks.answer("get_tasks_by_id", { id: "1" }).body as {
      done_at: string;
    };
    expect(read.done_at).toMatch(/:\d{2}Z$/u);
  });

  it("serves an update that sends only the member every recorded update sent", () => {
    const contacts = servedFrom(FEWER_MEMBERS_ROWS);
    expect(
      contacts.answer("put_contacts_by_id", {
        id: "1",
        body: { email: "ada.f@example.test" },
      }).body,
    ).toMatchObject({ name: "Ada Finch", email: "ada.f@example.test" });
    expect(
      contacts.refusal("put_contacts_by_id", {
        id: "2",
        body: { city: "Kumasi" },
      }),
    ).toMatchObject({
      message: expect.stringContaining("email"),
    });
  });

  it("numbers a created bundle that leaves its order out, though a recorded create sent it empty", () => {
    const bundles = servedFrom(NUMBERED_THEN_BLANK_ROWS);
    expect(
      bundles.answer("post_bundles", { body: { name: "Echo" } }).body,
    ).toMatchObject({ name: "Echo", order: "2" });
  });
});

import { expect, it } from "vitest";
import { startsAtBeginning } from "./environmentStatePaging.js";

it("requires every recorded position to establish the beginning, including repeated names", () => {
  expect(startsAtBeginning(undefined)).toBe(true);
  expect(startsAtBeginning("?offset=0&offset=0&limit=50")).toBe(true);
  for (const query of [
    "?offset=0&offset=2&limit=50",
    "?page=1&size=50",
    "?start=1&_end=50",
    "?_start=2&_end=50",
    "?offset=9007199254740992",
    "?offset=NaN",
    "?limit=unknown",
    "?name=Alpha",
  ])
    expect(startsAtBeginning(query), query).toBe(false);
});

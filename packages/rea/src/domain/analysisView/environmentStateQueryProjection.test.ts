import { expect, it } from "vitest";
import { projectsFields, selectsSomeFields } from "./environmentStateRules.js";
import { queryValues } from "./environmentStateVariants.js";

it("uses decoded names while retaining every recorded query value in order", () => {
  expect(
    queryValues(
      "?%66ields=*&fields=id&fields=two+words&=empty&flag&fields=%FF",
    ),
  ).toEqual(
    new Map([
      ["fields", ["*", "id", "two words", "\uFFFD"]],
      ["", ["empty"]],
      ["flag", [""]],
    ]),
  );
});

it.each([
  [undefined, false, false],
  ["?q=fields%3Did", false, false],
  ["?%66ields=%2A", true, false],
  ["?%66ields=%2A&fields=id", true, true],
  ["?fields%5Barticle%5D=", true, true],
  ["?%24SELECT=%2A", true, false],
  ["?fields=%FF", true, true],
  ["??fields=id", false, false],
] as const)(
  "preserves projection meaning for recorded query %s",
  (query, projects, selects) => {
    expect(projectsFields(query)).toBe(projects);
    expect(selectsSomeFields(query)).toBe(selects);
  },
);

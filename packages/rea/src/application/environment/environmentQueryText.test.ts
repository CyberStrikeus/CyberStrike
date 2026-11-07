import { describe, expect, it } from "vitest";

import { MAX_SIZE_ROWS } from "../../../tests/fixtures/environmentStateLaterReads.js";
import { servedFrom } from "../../../tests/fixtures/environmentStateServing.js";
import { withQueryText } from "./environmentTools.js";

const contacts = () => servedFrom(MAX_SIZE_ROWS);

const listTool = (served: ReturnType<typeof contacts>) => {
  const tool = served.source.manifest.tools.find(
    (candidate) => candidate.name === "get_contacts",
  );
  if (tool === undefined) throw new Error("The manifest lacks get_contacts");
  return tool;
};

describe("query values given as numbers or booleans", () => {
  it("spells a number or boolean query value as its JSON text and leaves others as given", () => {
    const tool = listTool(contacts());
    const args = {
      maxSize: 2,
      offset: false,
      body: { maxSize: 3 },
    };
    expect(withQueryText(tool, args)).toEqual({
      maxSize: "2",
      offset: "false",
      body: { maxSize: 3 },
    });
    const strings = { maxSize: "2", offset: ["0"] };
    expect(withQueryText(tool, strings)).toBe(strings);
  });

  it("answers a list paged by a number as it answers the same page size given as text", () => {
    const served = contacts();
    expect(served.answer("get_contacts", { maxSize: 2, offset: 0 })).toEqual(
      served.answer("get_contacts", { maxSize: "2", offset: "0" }),
    );
  });
});

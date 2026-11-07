import { describe, expect, it } from "vitest";

import {
  evaluateQuery,
  explainLine,
  learnQuery,
  lineChoices,
  queryTotalCount,
  renderQueryList,
  type QueryLine,
} from "./environmentStateListQuery.js";
import { singleQueryValues } from "../recordedTransportUrl.js";
import type { JsonObject, StateEntity } from "./environmentStateRules.js";

const entity = (fields: JsonObject): StateEntity => ({
  type: "/api/books",
  collection: "/api/books",
  id: String(fields["id"]),
  fields,
  view_fields: [],
  record_ordinals: [],
});

const BOOKS = [
  {
    id: 1,
    name: "Tide Tables",
    shelf: "a",
    tags: ["sea"],
    url: "https://x/tide",
  },
  { id: 2, name: "Lamp Oil", shelf: "b", tags: [{ id: "t1", name: "oil" }] },
  { id: 3, name: "tidewater", shelf: "a", tags: [], url: "https://x/other" },
  {
    id: 4,
    name: "Kelp",
    shelf: null,
    tags: ["sea"],
    url: "https://x/kelp-tide",
  },
].map((book) => entity({ ...book, active: true }));

/** A line as the gate reads it: its query, and the books it listed in order. */
const line = (
  query: string,
  listed: readonly number[],
  ordinal = 0,
): QueryLine => {
  const values = singleQueryValues(query)!;
  const items = listed.map(
    (id) => BOOKS.find((book) => book.id === String(id))!.fields,
  );
  return {
    ordinal,
    values,
    listed: listed.map(String),
    choices: lineChoices(values, items),
    entities: BOOKS,
  };
};

const ids = (query: string, parameters: Parameters<typeof evaluateQuery>[0]) =>
  evaluateQuery(parameters, singleQueryValues(query)!, BOOKS)?.page.map(
    (book) => book.id,
  );

describe("explaining a recorded line", () => {
  it("evaluates and learns a Unicode case-folded recorded search", () => {
    const row = entity({ id: "greek", name: "ΟΣ" });
    const values = singleQueryValues("?q=Σ")!;
    const recorded: QueryLine = {
      ordinal: 1,
      values,
      listed: ["greek"],
      choices: lineChoices(values, [row.fields]),
      entities: [row],
    };
    const parameters = { q: { role: "search" as const, fields: ["name"] } };

    expect(evaluateQuery(parameters, values, [row])?.page).toEqual([row]);
    expect(explainLine(recorded)).toEqual(parameters);
    expect(learnQuery([recorded])).toEqual({
      parameters,
      record_ordinals: [1],
    });
  });

  it("finds a filter on the field every listed item holds, scalar or in an array", () => {
    expect(explainLine(line("?shelf=a", [1, 3]))).toEqual({
      shelf: { role: "filter", field: "shelf" },
    });
    expect(explainLine(line("?tag=sea", [1, 4]))).toEqual({
      tag: { role: "filter", field: "tags" },
    });
    expect(explainLine(line("?tag=t1", [2]))).toEqual({
      tag: { role: "filter", field: "tags" },
    });
  });

  it("searches the fields the term matched, ignoring case, and leaves out URLs that merely repeat it", () => {
    expect(explainLine(line("?q=TIDE", [1, 3]))).toEqual({
      q: { role: "search", fields: ["name"] },
    });
  });

  it("sorts by the field a value names, with a direction parameter, prefix or suffix", () => {
    expect(
      explainLine(line("?orderBy=name&orderDirection=desc", [3, 1, 2, 4])),
    ).toEqual({
      orderBy: { role: "sort" },
      orderDirection: { role: "direction" },
    });
    expect(ids("?sort=-name", { sort: { role: "sort" } })).toEqual([
      "3",
      "1",
      "2",
      "4",
    ]);
    expect(ids("?sort=NAME-asc", { sort: { role: "sort" } })).toEqual([
      "4",
      "2",
      "1",
      "3",
    ]);
    // Null values sort last ascending.
    expect(ids("?sort=shelf", { sort: { role: "sort" } })).toEqual([
      "1",
      "3",
      "2",
      "4",
    ]);
  });

  it("pages by limit and offset, or by page number from the first page it explains", () => {
    expect(explainLine(line("?limit=2&offset=1", [2, 3]))).toEqual({
      limit: { role: "limit" },
      offset: { role: "offset" },
    });
    expect(explainLine(line("?page=2&per_page=2", [3, 4]))).toEqual({
      page: { role: "page", first: 1 },
      per_page: { role: "limit" },
    });
    expect(ids("?per_page=-1", { per_page: { role: "limit" } })).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("takes a parameter that changes nothing as inert, for its recorded values only", () => {
    const explained = explainLine(line("?includeDeleted=true", [1, 2, 3, 4]));
    expect(explained).toEqual({
      includeDeleted: { role: "inert", values: ["true"] },
    });
    expect(ids("?includeDeleted=false", explained!)).toBeUndefined();
  });

  it("leaves ambiguous page conventions unknown rather than preferring the first candidate", () => {
    expect(explainLine(line("?page=100&limit=1", []))).toBeUndefined();
    expect(explainLine(line("?page=0&limit=2", [1, 2]))).toEqual({
      page: { role: "page", first: 0 },
      limit: { role: "limit" },
    });
    expect(explainLine(line("?limit=2&page=2", [3, 4]))).toEqual({
      limit: { role: "limit" },
      page: { role: "page", first: 1 },
    });
  });

  it.each(["title:Tide", "#sea", '"Tide Tables"', "Tide OR Oil", "+Tide"])(
    "does not infer a literal substring model for search syntax: %s",
    (term) => {
      expect(
        explainLine(line(`?q=${encodeURIComponent(term)}`, [1, 2, 3, 4])),
      ).toBeUndefined();
      expect(
        ids(`?q=${encodeURIComponent(term)}`, {
          q: { role: "search", fields: ["name"] },
        }),
      ).toBeUndefined();
    },
  );

  it("uses safe numeric precision rather than an arbitrary digit-count limit", () => {
    expect(ids("?offset=1000000000", { offset: { role: "offset" } })).toEqual(
      [],
    );
    expect(
      ids("?limit=9007199254740991", { limit: { role: "limit" } }),
    ).toEqual(["1", "2", "3", "4"]);
    expect(
      ids("?offset=9007199254740992", { offset: { role: "offset" } }),
    ).toBeUndefined();
    expect(explainLine(line("?offset=unknown", [1, 2, 3, 4]))).toBeUndefined();
  });

  it("keeps a filter that excludes nothing inert, as a flag", () => {
    expect(explainLine(line("?active=true", [1, 2, 3, 4]))).toEqual({
      active: { role: "inert", values: ["true"] },
    });
  });

  it("explains nothing that the collection cannot reproduce", () => {
    expect(explainLine(line("?shelf=a", [3, 1]))).toBeUndefined();
  });
});

describe("learning a list's query", () => {
  it("joins lines into one role per parameter and answers the lines it reproduces", () => {
    const learned = learnQuery([
      line("?shelf=a", [1, 3], 10),
      line("?shelf=b", [2], 11),
      line("?q=kelp", [4], 12),
      line("?q=oil", [2], 13),
    ]);
    expect(learned).toEqual({
      parameters: {
        shelf: { role: "filter", field: "shelf" },
        q: { role: "search", fields: ["name"] },
      },
      record_ordinals: [10, 11, 12, 13],
    });
    // A value no line recorded is evaluated the same way.
    expect(ids("?q=TIDE&shelf=a", learned!.parameters)).toEqual(["1", "3"]);
  });

  it("refuses a value a parameter cannot apply, or a parameter it never learned", () => {
    const parameters = { limit: { role: "limit" } } as const;
    expect(ids("?limit=two", parameters)).toBeUndefined();
    expect(ids("?shelf=a", parameters)).toBeUndefined();
    expect(singleQueryValues("?a=1&a=2")).toBeUndefined();
  });

  it("normalizes identical repeats as serving does, retaining conflicting values as unknown", () => {
    expect(singleQueryValues("?shelf=a&shelf=%61")).toEqual(
      new Map([["shelf", "a"]]),
    );
    expect(singleQueryValues("?shelf=a&shelf=b")).toBeUndefined();
  });

  it("gives no two parameters one paging role, which would answer differently in serving's name order", () => {
    const both = { size: { role: "limit" }, limit: { role: "limit" } } as const;
    expect(ids("?size=2&limit=1", both)).toBeUndefined();
    const learned = learnQuery([line("?size=2&limit=1", [1], 40)]);
    expect(learned?.parameters).toEqual({
      size: { role: "inert", values: ["2"] },
      limit: { role: "limit" },
    });
    // Serving supplies a call's values in name order.
    expect(ids("?limit=1&size=2", learned!.parameters)).toEqual(["1"]);
  });

  it("adopts a filter on a field named unlike its parameter only once lines with two values agree on it", () => {
    const owner = (...lines: QueryLine[]) =>
      learnQuery(lines)?.parameters["owner"];
    expect(owner(line("?owner=a", [1, 3], 50))).toBeUndefined();
    expect(
      owner(line("?owner=a", [1, 3], 50), line("?owner=b", [2], 51)),
    ).toEqual({ role: "filter", field: "shelf" });
    expect(learnQuery([line("?shelf_id=a", [1, 3], 52)])?.parameters).toEqual({
      shelf_id: { role: "filter", field: "shelf" },
    });
  });
});

describe("queries the state can always answer", () => {
  it("models only reproducible total representations, without losing their source type", () => {
    for (const value of [
      0,
      3,
      "0",
      "3",
      Number.MAX_SAFE_INTEGER,
      String(Number.MAX_SAFE_INTEGER),
    ])
      expect(queryTotalCount(value)).toBe(Number(value));
    for (const value of [
      null,
      "unknown",
      "03",
      "3.0",
      " 3",
      "-1",
      -1,
      1.5,
      "9007199254740992",
    ])
      expect(queryTotalCount(value)).toBeUndefined();
    const view = {
      pointer: "/items",
      counters: [],
      query: { totals: ["total"] },
    };
    expect(renderQueryList(view, { items: [], total: "3" }, [], 2)).toEqual({
      items: [],
      total: "2",
    });
    expect(renderQueryList(view, { items: [], total: "03" }, [], 2)).toEqual({
      items: [],
      total: "03",
    });
  });

  it("projects query totals only into envelopes that actually contain a known count", () => {
    const view = {
      pointer: "/items",
      counters: ["numberOfElements"],
      query: { totals: ["total"] },
    };
    const selected = [{ id: 1 }];
    expect(
      renderQueryList(view, { items: [], numberOfElements: 0 }, selected, 7),
    ).toEqual({ items: selected, numberOfElements: 1 });
    expect(
      renderQueryList(view, { items: [], total: null }, selected, 7),
    ).toEqual({ items: selected, total: null });
    expect(renderQueryList(view, { items: [], total: 3 }, selected, 7)).toEqual(
      { items: selected, total: 7 },
    );
  });

  it("sorts case-only ties in state order, ignoring case", () => {
    const named = [
      entity({ id: 10, name: "alpha" }),
      entity({ id: 11, name: "Alpha" }),
    ];
    const order = (entities: readonly StateEntity[]) =>
      evaluateQuery(
        { sort: { role: "sort" } },
        singleQueryValues("?sort=name")!,
        entities,
      )?.page.map((entry) => entry.id);
    expect(order(named)).toEqual(["10", "11"]);
    expect(order([...named].reverse())).toEqual(["11", "10"]);
  });

  it("answers a sort of an emptied collection with no entities rather than giving up", () => {
    expect(
      evaluateQuery(
        { sort: { role: "sort" } },
        singleQueryValues("?sort=-id")!,
        [],
      ),
    ).toEqual({ page: [], total: 0, positional: "all" });
  });

  it("learns no search from a term that matched no field, keeping it inert", () => {
    const learned = learnQuery([line("?q=", [1, 2, 3, 4], 20)]);
    expect(learned?.parameters["q"]).toEqual({ role: "inert", values: [""] });
  });

  it("explains no line with more query names than it can search, without exhausting the stack", () => {
    const values = new Map(
      Array.from({ length: 5_000 }, (_, index) => [`p${String(index)}`, "x"]),
    );
    const choices = lineChoices(
      values,
      BOOKS.map((entry) => entry.fields),
    );
    expect(choices).toEqual([]);
    expect(
      explainLine({ ordinal: 0, values, listed: [], choices, entities: BOOKS }),
    ).toBeUndefined();
  });

  it("keeps a parameter named like an object's prototype as its own role", () => {
    const learned = learnQuery([line("?__proto__=x&shelf=a", [1, 3], 30)]);
    expect(Object.keys(learned!.parameters)).toContain("__proto__");
    const round = JSON.parse(JSON.stringify(learned!.parameters)) as object;
    expect(Object.getOwnPropertyDescriptor(round, "__proto__")?.value).toEqual({
      role: "inert",
      values: ["x"],
    });
  });
});

describe("parameters that ask for an order", () => {
  it("reads a sort field in any spelling as a sort, never as a parameter without effect", () => {
    expect(explainLine(line("?_sort=id&_order=DESC", [4, 3, 2, 1]))).toEqual({
      _sort: { role: "sort" },
      _order: { role: "direction" },
    });
    expect(
      explainLine(line("?sortKey=id&sortDirection=descending", [4, 3, 2, 1])),
    ).toEqual({
      sortKey: { role: "sort" },
      sortDirection: { role: "direction" },
    });
    // A sort value naming no field leaves the line unexplained rather than without effect.
    expect(explainLine(line("?_sort=newest", [1, 2, 3, 4]))).toBeUndefined();
  });

  it("reads a direction name given no direction as an ordinary parameter", () => {
    expect(explainLine(line("?direction=shared-by", [1, 2, 3, 4]))).toEqual({
      direction: { role: "inert", values: ["shared-by"] },
    });
    expect(explainLine(line("?reverse=false", [1, 2, 3, 4]))).toEqual({
      reverse: { role: "inert", values: ["false"] },
    });
    expect(explainLine(line("?reverse=true", [1, 2, 3, 4]))).toBeUndefined();
  });
});

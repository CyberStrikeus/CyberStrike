import { describe, expect, it } from "vitest";

import type { JsonValue } from "../jsonValue.js";
import type { JsonObject } from "./environmentStateRules.js";
import {
  composedChange,
  composedValue,
  createdComposer,
} from "./environmentStateWriteComposed.js";
import type { FieldRule } from "./environmentStateWriteRules.js";

const CLOCK: FieldRule = {
  field: "added",
  rule: "clock",
  format: { kind: "iso", separator: "T", fraction: 0, zone: "Z" },
};

const bookmark = (url: string, added: string): JsonObject => ({
  url,
  added,
  modified: added,
  snapshot: `https://web.archive.org/web/${added.replace(/\D/gu, "").slice(0, 14)}/${url}`,
});

const SEED = bookmark(
  "https://ferries.example.test/timetable",
  "2026-10-01T09:00:00Z",
);
const CREATED = bookmark(
  "https://quarry.example.test/ledger",
  "2026-10-17T18:00:03Z",
);
const ECHO_URL: FieldRule = { field: "url", rule: "echo" };

describe("strings a create composes from other fields", () => {
  it("spells a snapshot address from the write clock's digits and the sent URL, as held entities do", () => {
    const rule = createdComposer(
      CREATED,
      [ECHO_URL, CLOCK],
      [SEED],
    )("snapshot");
    expect(rule).toEqual({
      field: "snapshot",
      rule: "composed",
      parts: [
        { text: "https://web.archive.org/web/" },
        { from: "added", as: "clock", pattern: "YYYYMMDDhhmmss" },
        { text: "/" },
        { from: "url", as: "value" },
      ],
    });
    expect(
      composedValue(rule!.rule === "composed" ? rule!.parts : [], SEED),
    ).toBe(SEED["snapshot"]);
  });

  it("composes nothing one call alone shows, nor what a held entity spells otherwise", () => {
    expect(
      createdComposer(CREATED, [ECHO_URL, CLOCK], [])("snapshot"),
    ).toBeUndefined();
    const stale = {
      ...SEED,
      snapshot: "https://web.archive.org/web/20250101000000/x",
    };
    expect(
      createdComposer(CREATED, [ECHO_URL, CLOCK], [SEED, stale])("snapshot"),
    ).toBeUndefined();
  });

  it.each([
    ["before", (url: string) => `𐐀${url}`],
    ["after", (url: string) => `${url}𐐀`],
  ])(
    "composes nothing from a value an astral letter joins %s it",
    (_, label) => {
      const labelled = (entity: JsonObject): JsonObject => ({
        ...entity,
        label: label(String(entity["url"])),
      });
      expect(
        createdComposer(
          labelled(CREATED),
          [ECHO_URL, CLOCK],
          [labelled(SEED)],
        )("label"),
      ).toBeUndefined();
    },
  );

  it("takes two clocks a create stamps alike as one source, but not two members that send the same text", () => {
    const modified: FieldRule = { ...CLOCK, field: "modified" };
    expect(
      createdComposer(CREATED, [ECHO_URL, CLOCK, modified], [SEED])("snapshot"),
    ).toMatchObject({ rule: "composed" });
    const folder = {
      uid: "scratch-pier",
      title: "Scratch Pier",
      url: "/dashboards/f/scratch-pier/scratch-pier",
    };
    const seed = {
      uid: "lighthouse-rota",
      title: "Lighthouse Rota",
      url: "/dashboards/f/lighthouse-rota/lighthouse-rota",
    };
    expect(
      createdComposer(
        folder,
        [
          { field: "uid", rule: "echo" },
          { field: "title", rule: "echo" },
        ],
        [seed],
      )("url"),
    ).toBeUndefined();
  });
});

describe("strings an update composes from other fields", () => {
  const before = {
    uid: "scratch-alpha",
    title: "Scratch Alpha Harbor",
    url: "/dashboards/f/scratch-alpha/scratch-alpha-harbor",
  };
  const after = {
    ...before,
    title: "Renamed Alpha Lantern",
    url: "/dashboards/f/scratch-alpha/renamed-alpha-lantern",
  };
  const change = (overrides: {
    readonly after?: JsonObject;
    readonly sent?: JsonObject;
    readonly others?: readonly JsonObject[];
  }) =>
    composedChange("url", {
      before,
      after: overrides.after ?? after,
      sent: overrides.sent ?? { title: "Renamed Alpha Lantern" },
      idField: "uid",
      others: overrides.others ?? [],
    });

  it("spells an address from an unchanged uid and the sent title's slug, which spell it before the call too", () => {
    expect(change({})).toEqual({
      field: "url",
      rule: "composed",
      parts: [
        { text: "/dashboards/f/" },
        { from: "uid", as: "value" },
        { text: "/" },
        { from: "title", as: "slug" },
      ],
    });
  });

  it("composes nothing from a member the application stored otherwise than sent, nor what another entity spells otherwise", () => {
    expect(
      change({ sent: { title: "RENAMED ALPHA LANTERN" } }),
    ).toBeUndefined();
    expect(
      change({
        others: [
          { uid: "other-folder", title: "Other Folder", url: "/f/other" },
        ],
      }),
    ).toBeUndefined();
  });

  it("composes nothing the same parts do not spell before the call", () => {
    expect(
      change({
        after: {
          ...after,
          url: "/dashboards/f/scratch-alpha/renamed-alpha-lantern-1",
        },
      }),
    ).toBeUndefined();
  });
});

describe("compositions serving could not keep", () => {
  const stamped = (zone: string): FieldRule => ({
    field: "stamped",
    rule: "clock",
    format: { kind: "iso", separator: "T", fraction: 0, zone },
  });
  const dated = (url: string, added: string, at: string): JsonObject => ({
    url,
    added,
    stamped: at,
    day: `https://archive.example.test/${added.slice(0, 10).replace(/-/gu, "")}/${url}`,
  });
  const composeDay = (zone: string, created: string, seed: string) =>
    createdComposer(
      dated(
        "https://quarry.example.test/ledger",
        "2026-10-17T12:00:03Z",
        created,
      ),
      [ECHO_URL, CLOCK, stamped(zone)],
      [
        dated(
          "https://ferries.example.test/timetable",
          "2026-10-01T09:00:00Z",
          seed,
        ),
      ],
    )("day");

  it.each([
    ["+02:00", "2026-10-17T14:00:03+02:00", "2026-10-01T11:00:00+02:00"],
    ["+05:00", "2026-10-17T17:00:03+05:00", "2026-10-01T14:00:00+05:00"],
  ])(
    "takes no date from two clocks in different zones, %s beside UTC, which a served instant near midnight tells apart",
    (zone, created, seed) => {
      expect(composeDay(zone, created, seed)).toBeUndefined();
    },
  );

  it("still takes a date from two clocks the create stamps in one zone", () => {
    expect(
      composeDay("Z", "2026-10-17T12:00:03Z", "2026-10-01T09:00:00Z"),
    ).toMatchObject({ rule: "composed" });
  });

  it.each([null, 42])(
    "composes nothing a held entity holds as %s while every part it reads is there",
    (held) => {
      const other = {
        ...bookmark(
          "https://ferries.example.test/rota",
          "2026-10-02T09:00:00Z",
        ),
        snapshot: held,
      };
      expect(
        createdComposer(CREATED, [ECHO_URL, CLOCK], [SEED, other])("snapshot"),
      ).toBeUndefined();
      const { snapshot: _, ...without } = other;
      expect(
        createdComposer(
          CREATED,
          [ECHO_URL, CLOCK],
          [SEED, without],
        )("snapshot"),
      ).toMatchObject({ rule: "composed" });
      const folder = (url: JsonValue) => ({
        uid: "other-folder",
        title: "Other Folder",
        url,
      });
      const before = {
        uid: "scratch-alpha",
        title: "Scratch Alpha Harbor",
        url: "/dashboards/f/scratch-alpha/scratch-alpha-harbor",
      };
      const rename = (others: readonly JsonObject[]) =>
        composedChange("url", {
          before,
          after: {
            ...before,
            title: "Renamed Alpha Lantern",
            url: "/dashboards/f/scratch-alpha/renamed-alpha-lantern",
          },
          sent: { title: "Renamed Alpha Lantern" },
          idField: "uid",
          others,
        });
      expect(rename([folder(held)])).toBeUndefined();
      const { url: __, ...unaddressed } = folder(held);
      expect(rename([unaddressed])).toMatchObject({ rule: "composed" });
    },
  );
});

it(
  "indexes a wide body's repeated values once, and only when a string is left to compose",
  { timeout: 5_000 },
  () => {
    const n = 8_000;
    const shared = `https://shared.example.test/${"x".repeat(64)}`;
    const body: JsonObject = Object.fromEntries(
      Array.from({ length: n }, (_, index) => [`e${String(index)}`, shared]),
    );
    const rules: FieldRule[] = Array.from({ length: n }, (_, index) => ({
      field: `e${String(index)}`,
      rule: "echo",
    }));
    let reads = 0;
    const counted = new Proxy(body, {
      get: (target, key) => {
        reads += 1;
        return Reflect.get(target, key);
      },
    });
    const composer = createdComposer(counted, rules, []);
    expect(reads).toBe(0);
    expect(composer("e0")).toBeUndefined();
    expect(composer("e1")).toBeUndefined();
    // One read per source to index them, once, and one per composed field.
    expect(reads).toBe(n + 2);
  },
);

describe("slug spellings", () => {
  it("spells & in a slug part as the word only when the part says so", () => {
    const parts = (ampersand?: "and") => [
      { text: "/dashboards/f/" },
      { from: "uid", as: "value" as const },
      { text: "/" },
      {
        from: "title",
        as: "slug" as const,
        ...(ampersand === undefined ? {} : { ampersand }),
      },
    ];
    const folder = { uid: "u1", title: "Tide & Wind" };
    expect(composedValue(parts("and"), folder)).toBe(
      "/dashboards/f/u1/tide-and-wind",
    );
    expect(composedValue(parts(), folder)).toBe("/dashboards/f/u1/tide-wind");
  });

  it("reads an address whose uid is its title's slug as held entities spell it", () => {
    const held = [
      {
        uid: "a1b2c3",
        title: "Lighthouse Rota",
        url: "/dashboards/f/a1b2c3/lighthouse-rota",
      },
    ];
    const created = {
      uid: "scratch-pier",
      title: "Scratch Pier",
      url: "/dashboards/f/scratch-pier/scratch-pier",
    };
    const rules: FieldRule[] = [
      { field: "uid", rule: "echo" },
      { field: "title", rule: "echo" },
    ];
    expect(createdComposer(created, rules, held)("url")).toEqual({
      field: "url",
      rule: "composed",
      parts: [
        { text: "/dashboards/f/" },
        { from: "uid", as: "value" },
        { text: "/" },
        { from: "title", as: "slug" },
      ],
    });
    expect(
      createdComposer(created, rules, [
        {
          ...held[0]!,
          uid: "lighthouse-rota",
          url: "/dashboards/f/lighthouse-rota/lighthouse-rota",
        },
      ])("url"),
    ).toBeUndefined();
  });

  it("reads no address that more sources spell than it can tell apart", () => {
    const fields = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `alias${String(index)}`,
        "harbour-notes",
      ]),
    );
    const rules: FieldRule[] = Object.keys(fields).map((field) => ({
      field,
      rule: "echo",
    }));
    const created = { ...fields, url: "/notes/harbour-notes/harbour-notes" };
    const held = [{ ...fields, url: "/notes/harbour-notes/harbour-notes" }];
    expect(createdComposer(created, rules, held)("url")).toBeUndefined();
  });
});

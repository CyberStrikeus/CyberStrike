import { describe, expect, it } from "vitest";
import { z } from "zod";

import { nativeLoadImageObservationFixture } from "../../tests/fixtures/nativeLoadImage.js";
import {
  parseGhidraInventoryInput,
  parseGhidraInventoryResult,
} from "./GhidraInventoryValues.js";

it.each(["search_procedures", "search_strings"] as const)(
  "%s retains bridge document selection and native search defaults",
  (operation) => {
    for (const selection of [{}, { document: null }, { document: "fixture" }]) {
      expect(
        parseGhidraInventoryInput(operation, {
          pattern: "entry",
          ...selection,
        }),
      ).toEqual({
        ok: true,
        value: {
          pattern: "entry",
          mode: "literal",
          case_sensitive: false,
          document: selection.document ?? null,
        },
      });
    }
    expect(
      parseGhidraInventoryInput(operation, { pattern: "entry", document: "" })
        .ok,
    ).toBe(false);
    expect(
      parseGhidraInventoryInput(operation, {
        pattern: "Entry.*",
        mode: "regex",
        case_sensitive: true,
      }),
    ).toEqual({
      ok: true,
      value: {
        pattern: "Entry.*",
        mode: "regex",
        case_sensitive: true,
        document: null,
      },
    });
  },
);

it.each(["other", 42, null, {}])(
  "rejects an invalid own destination with value %j before admitting any batch naming subset",
  (value) => {
    const input = {
      names: Object.fromEntries([
        ["0x1000", "entry"],
        ["__proto__", value],
      ]),
    };
    expect(
      parseGhidraInventoryInput("set_addresses_names", input),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisInputError",
        issues: [{ path: ["names", "__proto__"] }],
      },
    });
    expect(Object.keys(input.names)).toEqual(["0x1000", "__proto__"]);
  },
);

it.each(["list_procedures", "search_procedures"] as const)(
  "preserves real bridge symbol provenance in %s",
  (operation) => {
    // Captured from Ghidra 12.1.4 on the source-owned PowerPC DOL fixture.
    const rows = [
      {
        address: "0x80003130",
        value: "__start",
        symbol: {
          primary: true,
          dynamic: false,
          external: false,
          type: "function",
          source: "user_defined",
        },
        ...(operation === "list_procedures"
          ? {
              procedure: { external: false, thunk: false, thunk_target: null },
            }
          : {}),
      },
    ];
    expect(parseGhidraInventoryResult(operation, rows)).toEqual({
      ok: true,
      value: { value: rows },
    });
  },
);

describe("native load-image result projection", () => {
  it("omits raw bridge output when the observation keeps every reported fact", () => {
    const observations = JSON.parse(
      JSON.stringify(nativeLoadImageObservationFixture()),
    );
    const parsed = parseGhidraInventoryResult(
      "inspect_native_load_image",
      observations,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value.value).toEqual(observations);
    expect(parsed.value.rawResult).toBeUndefined();
  });

  it("omits entry-context rows without register observations", () => {
    const observations = JSON.parse(
      JSON.stringify({
        ...nativeLoadImageObservationFixture(),
        entry_context: [{ address: "ram:0x0010", registers: [] }],
      }),
    );
    const parsed = parseGhidraInventoryResult(
      "inspect_native_load_image",
      observations,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value.value).toMatchObject({ entry_context: [] });
  });
});

it("validates large masked byte queries at the provider boundary without changing caller spelling", () => {
  const input = {
    pattern: "aA??".repeat(1024 * 1024),
    mask: "ff00".repeat(1024 * 1024),
  };
  const parsed = parseGhidraInventoryInput("search_bytes", input);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw parsed.error;
  expect(parsed.value.pattern === input.pattern).toBe(true);
  expect(parsed.value.mask === input.mask).toBe(true);
  expect(
    parseGhidraInventoryInput("search_bytes", {
      ...input,
      mask: `${input.mask.slice(0, -2)}g0`,
    }).ok,
  ).toBe(false);
  expect(
    parseGhidraInventoryInput("search_bytes", {
      ...input,
      mask: "00ff".repeat(1024 * 1024),
    }).ok,
  ).toBe(false);
});

describe("provider-owned overview boundary", () => {
  const overview = {
    document: "fixture",
    segments: [],
    procedure_count: 0,
    string_count: 0,
  };

  it("keeps exact empty counts and an observed empty segment set", () => {
    expect(
      parseGhidraInventoryInput("read_binary_inventory_summary", {}),
    ).toEqual({
      ok: true,
      value: {},
    });
    expect(
      parseGhidraInventoryInput("read_binary_inventory_summary", {
        document: "other",
      }).ok,
    ).toBe(false);
    expect(
      parseGhidraInventoryResult("read_binary_inventory_summary", overview),
    ).toEqual({
      ok: true,
      value: { value: { ...overview, segment_count: 0 }, rawResult: overview },
    });
  });

  it("keeps the independent segment permissions and provenance behind an overview", () => {
    const reported = {
      ...overview,
      segments: [
        {
          name: ".text",
          start: "0x1000",
          end: "0x100f",
          readable: true,
          writable: false,
          executable: true,
          permissions: { available: true, source: "ghidra-memory-block" },
          provenance: "ghidra-memory-block",
          address_space: "ram",
          image_base: "0x1000",
          initialized: true,
          overlay: false,
          sections: [],
        },
      ],
    };
    const parsed = parseGhidraInventoryResult(
      "read_binary_inventory_summary",
      reported,
    );
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value.rawResult).toEqual(reported);
    expect(parsed.value.value).toMatchObject({
      procedure_count: 0,
      string_count: 0,
      segments: [{ name: ".text", start: "0x1000", end: "0x100f" }],
    });
  });

  it.each([
    { procedure_count: -1 },
    { string_count: 1.5 },
    { procedure_count: Number.MAX_SAFE_INTEGER + 1 },
    { string_count: null },
    { document: "" },
    { segments: [{ name: "incomplete" }] },
    { extra: "unexpected" },
  ])("rejects malformed aggregates before creating Evidence: %j", (change) => {
    expect(
      parseGhidraInventoryResult("read_binary_inventory_summary", {
        ...overview,
        ...change,
      }).ok,
    ).toBe(false);
  });
});

// Wire-boundary fixture only; real-provider acceptance belongs to the DOS verifier.
describe("containing-procedure complete body evidence", () => {
  const identity = () => ({
    address: "0x1000",
    name: "fixture_function",
    symbol: null,
    classification: {
      external: false,
      thunk: false,
      thunk_target: null,
      provenance: "ghidra-function-manager",
    },
    body: {
      available: true,
      provenance: "ghidra-function-body-address-set",
      ranges: [
        { start: "0x1000", end: "0x1002" },
        { start: "0x1020", end: "0x1021" },
      ],
      total_bytes: 5,
      span_bytes: 34,
      non_contiguous: true,
      contains_entry: true,
    },
  });
  const found = () => ({
    query_address: "0x1001",
    found: true,
    procedure: identity(),
  });
  it("rejects a missing body rather than treating a legacy identity as complete", () => {
    const { body: omitted, ...legacy } = identity();
    expect(omitted.total_bytes).toBe(5);
    expect(
      parseGhidraInventoryResult("resolve_containing_procedure", {
        ...found(),
        procedure: legacy,
      }).ok,
    ).toBe(false);
  });
  it.each([
    { total_bytes: 34 },
    { span_bytes: 5 },
    { contains_entry: false },
    { provenance: "unreviewed" },
    {
      ranges: [
        { start: "0x1000", end: "0x1002" },
        { start: "bad space:0x1020", end: "bad space:0x1021" },
      ],
      span_bytes: null,
    },
    { non_contiguous: false },
    { ranges: [{ start: "0X1000", end: "0x1002" }] },
    {
      ranges: [
        { start: "0x1000", end: "0x1002" },
        { start: "0x1002", end: "0x1004" },
      ],
    },
  ])("rejects malformed or contradictory body evidence %j", (change) => {
    const procedure = identity();
    expect(
      parseGhidraInventoryResult("resolve_containing_procedure", {
        ...found(),
        procedure: { ...procedure, body: { ...procedure.body, ...change } },
      }).ok,
    ).toBe(false);
  });
  it("accepts canonically encoded address-space endpoints with an unknown enclosing span", () => {
    const procedure = identity();
    const body = {
      ...procedure.body,
      ranges: [
        { start: "0x1000", end: "0x1002" },
        { start: "other%20space:0x1020", end: "other%20space:0x1021" },
      ],
      span_bytes: null,
    };
    expect(
      parseGhidraInventoryResult("resolve_containing_procedure", {
        ...found(),
        procedure: { ...procedure, body },
      }).ok,
    ).toBe(true);
  });

  it("does not accept a found query that lies in the gap between body ranges", () => {
    expect(
      parseGhidraInventoryResult("resolve_containing_procedure", {
        ...found(),
        query_address: "0x1010",
      }).ok,
    ).toBe(false);
  });
});

const byteSearch = (space = "") => ({
  matches: [
    {
      address: `${space}0x000a`,
      segment: "text",
      file_offset: 10,
      procedure: { address: `${space}0x0008`, name: "entry" },
    },
  ],
  searched: {
    blocks: [
      {
        segment: "text",
        start: `${space}0x0000`,
        end: `${space}0x000f`,
        bytes: 16,
      },
    ],
    bytes: 16,
    skipped_uninitialized: [
      {
        segment: "bss",
        start: `${space}0x0020`,
        end: `${space}0x002f`,
        bytes: 16,
      },
    ],
    skipped_not_loaded: [
      {
        segment: "unloaded",
        start: `${space}0x0030`,
        end: `${space}0x003f`,
        bytes: 16,
      },
    ],
  },
  complete: true,
  next_cursor: null as string | null,
});

it.each(["", "ram%3Aoverlay:"])(
  "preserves padded byte-search coordinates in space %j",
  (space) => {
    const value = byteSearch(space);
    expect(parseGhidraInventoryResult("search_bytes", value)).toEqual({
      ok: true,
      value: { value },
    });
  },
);

it.each([
  ["match", ["matches", 0, "address"]],
  ["procedure", ["matches", 0, "procedure", "address"]],
  ["block start", ["searched", "blocks", 0, "start"]],
  ["block end", ["searched", "blocks", 0, "end"]],
  ["uninitialized start", ["searched", "skipped_uninitialized", 0, "start"]],
  ["uninitialized end", ["searched", "skipped_uninitialized", 0, "end"]],
  ["unloaded start", ["searched", "skipped_not_loaded", 0, "start"]],
  ["unloaded end", ["searched", "skipped_not_loaded", 0, "end"]],
] as const)(
  "rejects noncanonical %s at its owning address field",
  (_label, path) => {
    const value = byteSearch("ram%3Aoverlay:");
    let object: unknown = value;
    for (const part of path.slice(0, -1))
      object = Reflect.get(object as object, part);
    const field = path.at(-1)!;
    const address: unknown = Reflect.get(object as object, field);
    if (typeof address !== "string")
      throw new Error("Expected an address fixture");
    Reflect.set(object as object, field, address.replace("%3A", "%3a"));
    const result = parseGhidraInventoryResult("search_bytes", value);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected canonical-address refusal");
    expect(result.error.cause).toBeInstanceOf(z.ZodError);
    if (!(result.error.cause instanceof z.ZodError))
      throw new Error("Expected field schema issues");
    expect(result.error.cause.issues).toContainEqual(
      expect.objectContaining({ path: [...path] }),
    );
  },
);

it("retains byte-search match capacity and coverage/continuation rules", () => {
  const overCapacity = byteSearch();
  overCapacity.matches = Array.from(
    { length: 1001 },
    () => overCapacity.matches[0]!,
  );
  expect(parseGhidraInventoryResult("search_bytes", overCapacity).ok).toBe(
    false,
  );
  overCapacity.matches.pop();
  expect(parseGhidraInventoryResult("search_bytes", overCapacity).ok).toBe(
    true,
  );
  const continuation = byteSearch();
  continuation.next_cursor = "next";
  expect(parseGhidraInventoryResult("search_bytes", continuation).ok).toBe(
    false,
  );
  const outside = byteSearch();
  outside.matches[0]!.address = "0x0010";
  expect(parseGhidraInventoryResult("search_bytes", outside).ok).toBe(false);
  const range = byteSearch();
  range.searched.skipped_not_loaded[0]!.bytes = 15;
  expect(parseGhidraInventoryResult("search_bytes", range).ok).toBe(false);
});

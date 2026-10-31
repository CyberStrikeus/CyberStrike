import { describe, expect, it } from "vitest";

import {
  categorizeSwiftTypes,
  discoverObjcProtocols,
} from "./symbolAnalysis.js";

describe("modern Swift category evidence", () => {
  it.each([
    ["$s4main7ServiceCMa", "classes"],
    ["$s4main5StateOMa", "enums"],
    ["$s4main7ScoringPMp", "protocols"],
    ["$s4main5OuterV5InnerCMa", "classes"],
    ["$s4main4PairV5otherE7doubledSiyF", "extensions"],
    ["$S4main4PairVMa", "structs"],
    ["_T04main4PairVMa", "structs"],
    ["$s4_TtX4PairVMa", "structs"],
  ] as const)("decodes nominal contexts for %s", (name, category) => {
    expect(
      categorizeSwiftTypes([{ address: "0x1", name }], { category }),
    ).toMatchObject({
      total: 1,
      categories: { [category]: { count: 1 } },
      unclassified: [],
    });
  });

  it("keeps undecoded substituted extension contexts unclassified", () => {
    const names = [
      "_$s1M7WrapperVAASQRzlE4sameySbxF",
      "_$s1M3BoxVAARi_zrlE1vxvM",
    ];
    const result = categorizeSwiftTypes(
      names.map((name, index) => ({ address: String(index), name })),
    );
    expect(result.categories).toMatchObject({
      structs: { count: 0 },
      other: { count: 2 },
    });
    expect(result.unclassified.map(({ name }) => name)).toEqual(names);
    const controls = [
      ["_$s1M7WrapperV1vxvg", "structs"],
      ["_$s1M7WrapperVMa", "structs"],
      ["_$s1M7WrapperVACyxGxcfC", "structs"],
      ["_$s10Foundation4DataV1ME10countTwiceSiyF", "extensions"],
    ] as const;
    for (const [name, category] of controls)
      expect(
        categorizeSwiftTypes([{ address: "0x1", name }]).categories,
      ).toMatchObject({ [category]: { count: 1 } });
  });

  it("retains unresolved Swift observations under category filters", () => {
    const names = [
      "$s4main13swiftIndirectySiAA7Scoring_p_SitF",
      "$sSi4mainE7doubledSiyF",
      "$s9999999999999999999999BadVMa",
      "$s4main04PairVMa",
    ];
    const result = categorizeSwiftTypes(
      names.map((name, index) => ({ address: String(index), name })),
      { category: "structs" },
    );
    expect(result).toMatchObject({
      total: 0,
      unclassified: names.map((name) => ({
        name,
        mangled_names: [name],
        reason: "category_not_decoded",
      })),
      limitations: expect.arrayContaining([
        expect.stringContaining("could not be established"),
      ]),
    });
    expect(
      categorizeSwiftTypes([{ address: "0x1", name: names[0] ?? "" }], {
        category: "structs",
        pattern: "missing",
      }),
    ).toMatchObject({ total: 0, unclassified: [] });
  });

  it("preserves unsupported zero-prefixed nested Unicode contexts as unresolved", () => {
    const names = [
      "_$s6Nested8EnvelopeV007IhuqBAbO8describeSSyF",
      "_$s6Nested8EnvelopeV007jvrtDBlCAEycfC",
      "_$s6Nested8EnvelopeV007jvrtDBlCMa",
    ];
    const procedures = names.map((name, index) => ({
      address: `0x${String(index + 1)}`,
      name,
    }));
    const unresolved = names.map((name) => ({
      name,
      mangled_names: [name],
      reason: "category_not_decoded",
    }));
    expect(categorizeSwiftTypes(procedures)).toMatchObject({
      total: 3,
      categories: {
        other: {
          items: names.map((name) => ({ name, mangled_names: [name] })),
        },
      },
      unclassified: unresolved,
    });

    for (const category of ["classes", "enums"] as const)
      expect(categorizeSwiftTypes(procedures, { category })).toMatchObject({
        total: 0,
        categories: { [category]: { count: 0 }, other: { count: 0 } },
        unclassified: unresolved,
      });
  });

  it("keeps outer and ASCII nested nominal categories decoded", () => {
    const names = [
      ["_$s6Nested8EnvelopeVMa", "structs"],
      ["_$s6Nested8EnvelopeV5InnerCMa", "classes"],
      ["_$s6Nested8EnvelopeV5InnerC6methodyyF", "classes"],
    ] as const;
    for (const [name, category] of names) {
      expect(
        categorizeSwiftTypes([{ address: "0x1", name }], { category }),
      ).toMatchObject({
        total: 1,
        categories: { [category]: { count: 1 } },
        unclassified: [],
      });
    }
  });

  it("deduplicates display names after selecting a category", () => {
    expect(
      categorizeSwiftTypes(
        [
          { address: "0x1", name: "shared" },
          { address: "0x2", name: "shared" },
        ],
        { category: "structs" },
        [
          { address: "0x1", name: "$s4main7ServiceCMa" },
          { address: "0x2", name: "$s4main4PairVMa" },
        ],
      ),
    ).toMatchObject({
      total: 1,
      categories: { structs: { items: [{ address: "0x2", name: "shared" }] } },
    });
  });
});

describe("Swift alias ambiguity", () => {
  it("reports conflicting aliases rather than choosing a category", () => {
    expect(
      categorizeSwiftTypes(
        [{ address: "0x1", name: "shared" }],
        { category: "structs" },
        [
          { address: "0x1", name: "$s4main4PairVMa" },
          { address: "0x1", name: "$s4main7ServiceCMa" },
        ],
      ),
    ).toMatchObject({
      total: 0,
      unclassified: [
        {
          name: "shared",
          reason: "conflicting_categories",
          mangled_names: ["$s4main4PairVMa", "$s4main7ServiceCMa"],
        },
      ],
    });
  });

  it("retains manglings whose prefix the demangler accepts", () => {
    const names = [
      "$e4main7ServiceCMa",
      "_$e4main7ServiceCMa",
      "@__swiftmacro_4main7ServiceCMa",
    ];
    const result = categorizeSwiftTypes(
      names.map((name, index) => ({ address: `0x${String(index)}`, name })),
    );
    expect(result.categories.other?.items.map((item) => item.name)).toEqual(
      names,
    );
    expect(result.unclassified.map((item) => item.name)).toEqual(names);
  });

  it("keeps legacy names with an optional leading underscore", () => {
    expect(
      categorizeSwiftTypes([{ address: "0x1", name: "__T04main4PairVMa" }], {
        category: "structs",
      }),
    ).toMatchObject({
      total: 1,
      categories: { structs: { count: 1 } },
      unclassified: [],
    });
  });

  it("does not let a demangler-only alias erase a decoded category", () => {
    const result = categorizeSwiftTypes(
      [{ address: "0x1", name: "$s4main7ServiceCMa" }],
      {},
      [{ address: "0x1", name: "$e4main7ServiceCMa" }],
    );
    expect(result.categories.classes?.items).toMatchObject([
      {
        name: "$s4main7ServiceCMa",
        mangled_names: ["$s4main7ServiceCMa", "$e4main7ServiceCMa"],
      },
    ]);
    expect(result.categories.other?.items).toEqual([]);
  });

  it.each([undefined, "classes"] as const)(
    "keeps a decoded alias category beside an undecoded Swift alias (filter %s)",
    (category) => {
      const result = categorizeSwiftTypes(
        [{ address: "0x1", name: "main::Service::init" }],
        category === undefined ? {} : { category },
        [
          { address: "0x1", name: "_$s4main7ServiceCMa" },
          { address: "0x1", name: "_$s4main04PairVMa" },
        ],
      );
      expect(result).toMatchObject({
        total: 1,
        categories: {
          classes: {
            count: 1,
            items: [
              {
                name: "main::Service::init",
                mangled_names: ["_$s4main7ServiceCMa", "_$s4main04PairVMa"],
              },
            ],
          },
          other: { count: 0 },
        },
        unclassified: [],
      });
    },
  );
});

it("does not recognize embedded Swift runtime markers in Objective-C selectors", () => {
  const names = [
    "-[Example check_TtC4main3Foo]",
    "-[Example check_TtP4main3Bar_]",
  ].map((name) => ({ name, address: "0x1" }));
  expect(categorizeSwiftTypes(names)).toMatchObject({
    total: 0,
    unclassified: [],
  });
  expect(discoverObjcProtocols(names)).toEqual({ count: 0, protocols: [] });
});

it("distinguishes protocol identity from protocol member contexts", () => {
  const symbols = [
    "_$s4main7ScoringMp",
    "$s4main7ScoringPMp",
    "_TtP4main7Scoring_",
    "_$s4main7ScoringP5scoreSiyFTq",
    "_$s4main7ScoringTL",
    "_$s4main7ScoringP5scoreSiyF",
  ].map((name, index) => ({ name, address: `0x${index}` }));
  expect(discoverObjcProtocols(symbols)).toEqual({
    count: 3,
    protocols: symbols.slice(0, 3),
  });
  // Function/requirement categorization still describes the enclosing nominal
  // context; it does not turn that member into a protocol inventory identity.
  expect(
    categorizeSwiftTypes([
      { address: "0x3", name: "_$s4main7ScoringP5scoreSiyFTq" },
    ]),
  ).toMatchObject({
    categories: { protocols: { count: 1 } },
    unclassified: [],
  });
});

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  devicetreeSchema,
  inspectDevicetreeInputSchema,
} from "../../domain/firmware/devicetree.js";
import { DevicetreeLimitFailure, parseDevicetree } from "./DevicetreeParser.js";
import {
  cells,
  devicetreeFixture,
  type FixtureNode,
} from "./Devicetree.fixture.js";
const parse = (b: Buffer, limits = {}) =>
  parseDevicetree(
    b,
    {
      path: "/board.dtb",
      bytes: b.length,
      sha256: createHash("sha256").update(b).digest("hex"),
    },
    inspectDevicetreeInputSchema.parse({ path: "/board.dtb", ...limits }),
  );
describe("flattened devicetree", () => {
  it.each([16, 17])(
    "decodes v%s with derived facts and unresolved references",
    (version) => {
      const report = devicetreeSchema.parse(
        parse(devicetreeFixture(undefined, version)),
      );
      expect(report.summary).toMatchObject({
        compatible: ["test,board"],
        model: "Test board",
        bootargs: "console=ttyS0",
        aliases: [{ name: "serial0", path: "/serial@1000" }],
      });
      expect(report.reservations[0]).toMatchObject({
        address: "0x80000000",
        size: "0x1000",
      });
      expect(
        report.nodes
          .find((n) => n.path === "/serial@1000")
          ?.properties.find((p) => p.name === "reg")?.derived.reg,
      ).toEqual([{ address: "0x1000", size: "0x100" }]);
      expect(report.references.map((r) => r.target)).toEqual([
        null,
        "/serial@1000",
      ]);
    },
  );
  it.each([
    ["truncated header", (b: Buffer) => b.subarray(0, 32)],
    [
      "overlapping blocks",
      (b: Buffer) => {
        b.writeUInt32BE(72, 12);
        return b;
      },
    ],
    [
      "unterminated node",
      (b: Buffer) => {
        b.fill(65, 76, b.readUInt32BE(12));
        return b;
      },
    ],
    [
      "bad string offset",
      (b: Buffer) => {
        b.writeUInt32BE(0xffffffff, 88);
        return b;
      },
    ],
    [
      "misaligned structure",
      (b: Buffer) => {
        b.writeUInt32BE(73, 8);
        return b;
      },
    ],
    [
      "missing end",
      (b: Buffer) => {
        b.writeUInt32BE(4, b.readUInt32BE(12) - 4);
        return b;
      },
    ],
  ] as const)("rejects %s", (_name, mutate) =>
    expect(() => parse(mutate(devicetreeFixture()))).toThrow(),
  );
  it("bounds depth, nodes and properties", () => {
    let root: FixtureNode = { name: "leaf" };
    for (let i = 0; i < 10; i++) root = { name: `n${i}`, children: [root] };
    expect(() =>
      parse(devicetreeFixture({ name: "", children: [root] }), {
        max_depth: 4,
      }),
    ).toThrow("max_depth");
    expect(() => parse(devicetreeFixture(), { max_nodes: 2 })).toThrow(
      "max_nodes",
    );
    expect(() => parse(devicetreeFixture(), { max_properties: 2 })).toThrow(
      "max_properties",
    );
  });
  it("bounds raw previews and preserves ambiguous values", () => {
    const report = parse(
      devicetreeFixture({
        name: "",
        properties: { opaque: Buffer.alloc(500), model: cells(1) },
      }),
    );
    expect(report.nodes[0]?.properties[0]).toMatchObject({
      bytes: 500,
      truncated: true,
      hex: "00".repeat(256),
    });
    expect(report.summary.model).toBeNull();
  });
});
it("keeps multi-cell addresses exact and supports zero size cells", () => {
  const r = parse(
    devicetreeFixture({
      name: "",
      properties: { "#address-cells": cells(2), "#size-cells": cells(0) },
      children: [
        { name: "device", properties: { reg: cells(0xfedcba98, 0x76543210) } },
      ],
    }),
  );
  expect(r.nodes[1]?.properties[0]?.derived.reg).toEqual([
    { address: "0xfedcba9876543210", size: null },
  ]);
});
it("does not guess malformed reg tuples or duplicate phandle targets", () => {
  const r = parse(
    devicetreeFixture({
      name: "",
      children: [
        { name: "a", properties: { phandle: cells(1), reg: cells(1) } },
        {
          name: "b",
          properties: { phandle: cells(1), "interrupt-parent": cells(1) },
        },
      ],
    }),
  );
  expect(r.references[0]?.target).toBeNull();
  expect(
    r.nodes[1]?.properties.find((p) => p.name === "reg")?.derived.reg,
  ).toBeNull();
  expect(r.limitations.some((s) => s.includes("reg at /a"))).toBe(true);
});
it("leaves conflicting phandle declarations unresolved", () => {
  const r = parse(
    devicetreeFixture({
      name: "",
      children: [
        {
          name: "same",
          properties: { phandle: cells(3), "linux,phandle": cells(3) },
        },
        {
          name: "split",
          properties: { phandle: cells(1), "linux,phandle": cells(2) },
        },
        {
          name: "consumer",
          properties: {
            "interrupt-parent": cells(1),
            "msi-parent": cells(2),
            "remote-endpoint": cells(3),
          },
        },
      ],
    }),
  );
  expect(r.references.map((ref) => [ref.phandle, ref.target])).toEqual([
    [1, null],
    [2, null],
    [3, "/same"],
  ]);
  expect(r.limitations.filter((s) => s.includes("conflicts"))).toEqual([
    "phandle at /split conflicts with linux,phandle (0x1 vs 0x2); references to either value are unresolved.",
  ]);
});
it.each([
  ["short", Buffer.from([0, 0])],
  ["multiple cells", cells(1, 2)],
])(
  "does not use a legacy phandle when the canonical value is %s",
  (_name, canonical) => {
    const r = parse(
      devicetreeFixture({
        name: "",
        children: [
          {
            name: "target",
            properties: { phandle: canonical, "linux,phandle": cells(3) },
          },
          { name: "consumer", properties: { "interrupt-parent": cells(3) } },
        ],
      }),
    );
    expect(r.references).toMatchObject([
      { source: "/consumer", phandle: 3, target: null },
    ]);
    expect(r.nodes[1]?.properties[0]).toMatchObject({
      name: "phandle",
      bytes: canonical.length,
      hex: canonical.toString("hex"),
      derived: { cells: null },
    });
    expect(r.limitations).toContain(
      "phandle at /target is not a single cell; this node's reference identity remains unresolved.",
    );
  },
);
it("resolves a legacy phandle only when the canonical property is absent", () => {
  const r = parse(
    devicetreeFixture({
      name: "",
      children: [
        { name: "legacy", properties: { "linux,phandle": cells(3) } },
        { name: "canonical", properties: { phandle: cells(4) } },
        {
          name: "consumer",
          properties: {
            "interrupt-parent": cells(3),
            "remote-endpoint": cells(4),
          },
        },
      ],
    }),
  );
  expect(r.references.map((ref) => [ref.phandle, ref.target])).toEqual([
    [3, "/legacy"],
    [4, "/canonical"],
  ]);
});
it("rejects unterminated reservations and unknown tokens", () => {
  const reservation = devicetreeFixture();
  reservation.fill(1, 56, 72);
  expect(() => parse(reservation)).toThrow("reservation");
  const token = devicetreeFixture();
  token.writeUInt32BE(0x12345678, 72);
  expect(() => parse(token)).toThrow("Unknown FDT token");
});
it("bounds expansion of repeated paths before allocation", () => {
  const longName = "a".repeat(4096);
  let node: FixtureNode = { name: longName };
  for (let i = 0; i < 100; i++) node = { name: longName, children: [node] };
  expect(() =>
    parse(devicetreeFixture({ name: "", children: [node] }), {
      max_depth: 256,
    }),
  ).toThrow("decoded representation");
});
it.each(["compatible", "status"])(
  "bounds NUL-heavy %s string-list expansion",
  (name) => {
    const bytes = devicetreeFixture({
      name: "",
      properties: { [name]: Buffer.alloc(6 * 1024 * 1024) },
    });
    expect(() => parse(bytes, { max_file_bytes: 16777216 })).toThrow(
      new DevicetreeLimitFailure("decoded_bytes"),
    );
  },
);
it("accounts for string values serialized again in the summary", () => {
  const value = Buffer.alloc(6 * 1024 * 1024, 0x22);
  value[value.length - 1] = 0;
  const child = { name: "device", properties: { compatible: value } };
  const report = parse(devicetreeFixture({ name: "", children: [child] }), {
    max_file_bytes: 16777216,
  });
  expect(report.nodes[1]?.properties[0]?.derived.strings?.[0]?.length).toBe(
    value.length - 1,
  );
  expect(() =>
    parse(devicetreeFixture({ ...child, name: "" }), {
      max_file_bytes: 16777216,
    }),
  ).toThrow(new DevicetreeLimitFailure("decoded_bytes"));
});
it("retains undecodable alias identities and labels the summary derived", () => {
  const report = parse(
    devicetreeFixture({
      name: "",
      children: [
        {
          name: "aliases",
          properties: { serial0: Buffer.from("unterminated") },
        },
      ],
    }),
  );
  expect(report.summary).toMatchObject({
    confidence: "derived",
    aliases: [{ name: "serial0", path: null }],
  });
});
it("bounds repeated reference paths before Evidence serialization", () => {
  const bytes = devicetreeFixture({
    name: "",
    children: [
      { name: "target".repeat(1400), properties: { phandle: cells(1) } },
      ...Array.from({ length: 2000 }, (_, i) => ({
        name: `consumer${i}`,
        properties: { "interrupt-parent": cells(1) },
      })),
    ],
  });
  expect(bytes.length).toBeLessThan(100_000);
  expect(() => parse(bytes)).toThrow("decoded representation");
});

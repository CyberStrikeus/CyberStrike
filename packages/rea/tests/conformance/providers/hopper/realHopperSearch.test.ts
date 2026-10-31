import { expect, it } from "vitest";

import {
  verifyHopperStringFragments,
  verifyHopperStringObjects,
} from "../../../../scripts/lib/real-hopper-search.mjs";

const value = "REA_UTF8_é_😀";
const address = "0x402020";
const bytes = Buffer.from(`${value}\0`);
const item = {
  address,
  value,
  string: {
    encoding: "utf-8",
    encoding_status: "inferred" as const,
    termination: "present_or_not_required" as const,
    byte_length: bytes.length,
  },
};
const expectation = {
  value,
  encoding: "utf-8",
  symbol: "rea_utf8_literal",
  recognitionOptional: true,
};

const fragments = [
  {
    ...item,
    value: "REA_",
    string: { ...item.string, termination: "missing" as const, byte_length: 4 },
  },
  {
    ...item,
    address: "0x402024",
    value: value.slice(4),
    string: { ...item.string, byte_length: bytes.length - 4 },
  },
] as const;

const fragmentBytes = async (
  name: string,
  args: Record<string, unknown> = {},
) => {
  if (name !== "read_bytes") throw new Error(`Unmodeled call: ${name}`);
  const offset =
    args.address === expectation.symbol
      ? 0
      : Number(BigInt(String(args.address)) - BigInt(address));
  return {
    address: `0x${(BigInt(address) + BigInt(offset)).toString(16)}`,
    complete: true,
    bytes_hex: bytes
      .subarray(offset, offset + Number(args.length))
      .toString("hex"),
  };
};

it("verifies contiguous native fragments against the complete source bytes", async () => {
  const result = await verifyHopperStringFragments(
    fragmentBytes,
    fragments,
    expectation,
  );
  expect(result.recognition).toEqual({
    address,
    state: "observed",
    decodedObject: "verified",
  });
  expect(result.sourceBytes).toBe(bytes.length);
});

it("reports unrecognized source bytes without accepting identical text at another address", async () => {
  const elsewhere = [{ ...item, address: "0x403000" }];
  const result = await verifyHopperStringFragments(
    fragmentBytes,
    elsewhere,
    expectation,
  );
  expect(result.recognition).toEqual({
    address,
    state: "not_observed",
    decodedObject: "unverified",
  });
  await expect(
    verifyHopperStringFragments(fragmentBytes, elsewhere, {
      ...expectation,
      recognitionOptional: false,
    }),
  ).rejects.toThrow(/typed string fragments/u);
});

it.each([
  ["gap", [fragments[0], { ...fragments[1], address: "0x402025" }]],
  ["overlap", [fragments[0], { ...fragments[1], address: "0x402023" }]],
  ["missing prefix", [fragments[1]]],
  ["wrong decoded value", [{ ...item, value: "X" + value.slice(1) }]],
  ["missing tail", [fragments[0]]],
])(
  "rejects %s even when fragment recognition is optional",
  async (_label, inventory) => {
    await expect(
      verifyHopperStringFragments(fragmentBytes, inventory, expectation),
    ).rejects.toThrow();
  },
);

it("rejects incomplete source bytes even with no native string objects", async () => {
  await expect(
    verifyHopperStringFragments(
      async (name: string, args: Record<string, unknown> = {}) => ({
        ...(await fragmentBytes(name, args)),
        complete: false,
      }),
      [],
      expectation,
    ),
  ).rejects.toThrow();
});

it("keeps source identity and unknown decoding when the same text exists elsewhere", async () => {
  const report = await verifyHopperStringObjects(
    fixtureCall(),
    [expectation],
    [{ ...item, address: "0x403000" }],
  );
  expect(report.recognition).toEqual([
    { value, address, state: "not_observed", decodedObject: "unverified" },
  ]);
});

it("reuses source bytes and inventory while checking real address filters and searches", async () => {
  const calls: string[] = [];
  const report = await verifyHopperStringObjects(
    fixtureCall(calls),
    [expectation],
    [item],
  );
  expect(report.recognition).toEqual([
    { value, address, state: "observed", decodedObject: "verified" },
  ]);
  expect(calls).toEqual([
    "read_bytes:rea_utf8_literal",
    `list_strings:${address}`,
    `search_strings:${value}`,
    "search_strings:\\xC3\\xA9",
  ]);
});

it.each([
  ["changed source bytes", { bytes_hex: "00" }, item],
  ["incomplete source read", { complete: false }, item],
  ["wrong decoded value", {}, { ...item, value: "wrong" }],
  [
    "wrong decoded extent",
    {},
    { ...item, string: { ...item.string, byte_length: 1 } },
  ],
])(
  "rejects %s even when native recognition is optional",
  async (_label, override, decoded) => {
    await expect(
      verifyHopperStringObjects(
        fixtureCall([], override),
        [expectation],
        [decoded],
      ),
    ).rejects.toThrow();
  },
);

function fixtureCall(
  calls: string[] = [],
  override: Record<string, unknown> = {},
) {
  return async (name: string, arguments_: Record<string, unknown> = {}) => {
    calls.push(
      `${name}:${String(arguments_.address ?? arguments_.pattern ?? "")}`,
    );
    if (name === "read_bytes")
      return {
        address,
        bytes_hex: bytes.toString("hex"),
        complete: true,
        ...override,
      };
    if (name === "list_strings" && arguments_.address === address)
      return [item];
    if (name === "search_strings")
      return arguments_.pattern === value ? [item] : [];
    throw new Error(`Unmodeled verifier call: ${name}`);
  };
}

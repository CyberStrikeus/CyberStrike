import { describe, expect, it } from "vitest";
import { functionBodySchema } from "./functionBody.js";
import { procedureIdentitySchema } from "./procedureInfo.js";

describe("provider-neutral inclusive function body evidence", () => {
  const observed = () => ({
    available: true,
    provenance: "test-address-set",
    ranges: [
      { start: "0x1000", end: "0x1002" },
      { start: "0x1010", end: "0x1011" },
    ],
    total_bytes: 5,
    span_bytes: 18,
    non_contiguous: true,
    contains_entry: true,
  });
  it("rejects missing provider body metadata", () => {
    expect(
      procedureIdentitySchema.safeParse({ address: "0x1000", name: "main" })
        .success,
    ).toBe(false);
  });
  it("counts inclusive one-byte ranges without assuming an enclosing continuous body", () => {
    expect(
      functionBodySchema.safeParse({
        ...observed(),
        ranges: [{ start: "0x1000", end: "0x1000" }],
        total_bytes: 1,
        span_bytes: 1,
        non_contiguous: false,
      }).success,
    ).toBe(true);
    expect(functionBodySchema.parse(observed())).toMatchObject({
      total_bytes: 5,
      span_bytes: 18,
    });
  });
  it("preserves address-space identity and leaves a multi-space span unknown", () => {
    expect(
      functionBodySchema.safeParse({
        ...observed(),
        ranges: [
          { start: "a:0x1000", end: "a:0x1000" },
          { start: "b:0x1000", end: "b:0x1001" },
        ],
        total_bytes: 3,
        span_bytes: null,
      }).success,
    ).toBe(true);
    expect(
      functionBodySchema.safeParse({
        ...observed(),
        ranges: [{ start: "a:0x1000", end: "b:0x1000" }],
      }).success,
    ).toBe(false);
  });
  it("rejects malformed address-space labels rather than certifying body coverage", () => {
    expect(
      functionBodySchema.safeParse({
        ...observed(),
        ranges: [{ start: "ram space:0x1000", end: "ram space:0x1000" }],
        total_bytes: 1,
        span_bytes: 1,
        non_contiguous: false,
      }).success,
    ).toBe(false);
  });
  it("allows an observed empty set without manufacturing entry membership", () => {
    expect(
      procedureIdentitySchema.safeParse({
        address: "0x1000",
        name: "external",
        classification: null,
        body: {
          ...observed(),
          ranges: [],
          total_bytes: 0,
          span_bytes: 0,
          non_contiguous: false,
          contains_entry: false,
        },
      }).success,
    ).toBe(true);
  });
  it("checks entry membership using address space and inclusive endpoints", () => {
    expect(
      procedureIdentitySchema.safeParse({
        address: "0x1002",
        name: "last",
        classification: null,
        body: observed(),
      }).success,
    ).toBe(true);
    expect(
      procedureIdentitySchema.safeParse({
        address: "0x1003",
        name: "gap",
        classification: null,
        body: observed(),
      }).success,
    ).toBe(false);
    expect(
      procedureIdentitySchema.safeParse({
        address: "other:0x1000",
        name: "other",
        classification: null,
        body: observed(),
      }).success,
    ).toBe(false);
  });
  it.each([
    { total_bytes: 18 },
    { span_bytes: 5 },
    { non_contiguous: false },
    {
      ranges: [
        { start: "0x1000", end: "0x1002" },
        { start: "0x1003", end: "0x1004" },
      ],
    },
    {
      ranges: [
        { start: "0x1000", end: "0x1002" },
        { start: "0x1002", end: "0x1004" },
      ],
    },
    {
      ranges: [
        { start: "0x1010", end: "0x1011" },
        { start: "0x1000", end: "0x1002" },
      ],
    },
    {
      ranges: [{ start: "0x0", end: "0x20000000000000" }],
      total_bytes: Number.MAX_SAFE_INTEGER,
      span_bytes: Number.MAX_SAFE_INTEGER,
      non_contiguous: false,
    },
  ])("rejects contradictory or unsafe range facts %j", (change) => {
    expect(
      functionBodySchema.safeParse({ ...observed(), ...change }).success,
    ).toBe(false);
  });
});

import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { z } from "zod";

import {
  BASE64_QUARTET_LENGTH_PATTERN,
  INVALID_BASE64_CHARACTER_PATTERN,
  INVALID_BASE64_PADDING_PATTERN,
  INVALID_CANONICAL_BASE64_PAD_BITS_PATTERN,
  IDENTIFIER_PATTERN,
  STABLE_IDENTIFIER_PATTERN,
  canonicalBase64Schema,
  isCanonicalBase64,
  isPaddedBase64,
} from "./stringPatterns.js";

it("preserves identifier grammars under Unicode and Unicode-set compilation", () => {
  const variants = [
    { pattern: IDENTIFIER_PATTERN, previous: /^[A-Za-z][A-Za-z0-9._-]*$/u },
    {
      pattern: STABLE_IDENTIFIER_PATTERN,
      previous: /^[A-Za-z][A-Za-z0-9._:/-]*$/u,
    },
  ];
  const samples = [
    "",
    "a",
    "A",
    "_id",
    "1id",
    "é",
    "aé",
    "a/b:c",
    "a-b.c_1",
    "a\n",
    "a\\b",
  ];
  for (let code = 0; code < 128; code += 1) {
    const character = String.fromCharCode(code);
    samples.push(character, `A${character}`, `A${character}B`);
  }
  for (const { pattern, previous } of variants) {
    for (const flag of ["u", "v"]) {
      const projected = new RegExp(pattern.source, flag);
      for (const sample of samples)
        expect(projected.test(sample), JSON.stringify({ flag, sample })).toBe(
          previous.test(sample),
        );
    }
  }
});

it("preserves canonical and permissive padded base64 validation", () => {
  const previous =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$/;
  const samples = [
    "",
    "AA==",
    "AB==",
    "AAA=",
    "AAB=",
    "////",
    "A",
    "AA",
    "AAA",
    "====",
    "AA==\n",
    "AA==\r\n",
    "AA==\u2028",
    "AA==\u2029",
    "AA\nAA",
    "AA=\n=",
    "AA-_",
    "a b c",
  ];
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (const first of alphabet)
    for (const second of alphabet)
      samples.push(`${first}${second}==`, `A${first}${second}=`);
  for (const sample of samples) {
    expect(isCanonicalBase64(sample), JSON.stringify({ sample })).toBe(
      previous.test(sample),
    );
    expect(isPaddedBase64(sample), JSON.stringify({ sample })).toBe(
      sample.length % 4 === 0 && /^[A-Za-z0-9+/]*(?:==|=)?$/.test(sample),
    );
  }
});

it("advertises every portable base64 constraint and keeps large inputs stack-safe", () => {
  const jsonSchema = z.toJSONSchema(canonicalBase64Schema, {
    target: "draft-2020-12",
  });
  expect(jsonSchema).toMatchObject({
    allOf: expect.arrayContaining([
      { pattern: BASE64_QUARTET_LENGTH_PATTERN.source },
      { not: { pattern: INVALID_BASE64_CHARACTER_PATTERN.source } },
      { not: { pattern: INVALID_BASE64_PADDING_PATTERN.source } },
      { not: { pattern: INVALID_CANONICAL_BASE64_PAD_BITS_PATTERN.source } },
    ]),
  });

  const body = Buffer.alloc(24 * 1024 * 1024 - 3, 0x81);
  const encoded = body.toString("base64");
  for (const flag of ["", "u", "v"]) {
    expect(
      new RegExp(BASE64_QUARTET_LENGTH_PATTERN.source, flag).test(encoded),
      flag,
    ).toBe(true);
    expect(
      new RegExp(INVALID_BASE64_CHARACTER_PATTERN.source, flag).test(encoded),
      flag,
    ).toBe(false);
    expect(
      new RegExp(INVALID_BASE64_PADDING_PATTERN.source, flag).test(encoded),
      flag,
    ).toBe(false);
    expect(
      new RegExp(INVALID_CANONICAL_BASE64_PAD_BITS_PATTERN.source, flag).test(
        encoded,
      ),
      flag,
    ).toBe(false);
    expect(
      new RegExp(INVALID_BASE64_CHARACTER_PATTERN.source, flag).test(
        `${encoded.slice(0, -1)}!`,
      ),
      flag,
    ).toBe(true);
    expect(
      new RegExp(INVALID_CANONICAL_BASE64_PAD_BITS_PATTERN.source, flag).test(
        `${encoded.slice(0, -3)}R==`,
      ),
      flag,
    ).toBe(true);
  }
  expect(isCanonicalBase64(encoded)).toBe(true);
});

it("validates complete projected canonical schemas at the encoded-input budget", () => {
  const projected = z.toJSONSchema(canonicalBase64Schema, {
    target: "draft-2020-12",
  });
  const validate = new Ajv2020({ strict: true }).compile(projected);
  const encoded = Buffer.alloc(24 * 1024 * 1024 - 3, 0x81).toString("base64");
  for (const { value, expected } of [
    { value: encoded, expected: true },
    { value: `${encoded.slice(0, -1)}!`, expected: false },
    { value: `${encoded.slice(0, -3)}R==`, expected: false },
    { value: `${encoded}A`, expected: false },
  ]) {
    expect(canonicalBase64Schema.safeParse(value).success).toBe(expected);
    expect(validate(value)).toBe(expected);
  }
});

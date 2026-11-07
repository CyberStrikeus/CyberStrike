import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { err, ok } from "../domain/result.js";
import {
  readBoundedControlLines,
  type BoundedControlLine,
} from "./BoundedControlLines.js";

async function* chunks(
  parts: readonly Uint8Array[],
): AsyncGenerator<Uint8Array> {
  yield* parts;
}

const collect = async (
  parts: readonly Uint8Array[],
  maximum: number,
): Promise<BoundedControlLine[]> => {
  const lines: BoundedControlLine[] = [];
  for await (const line of readBoundedControlLines(chunks(parts), maximum))
    lines.push(line);
  return lines;
};

const exceeded: BoundedControlLine = err({ _tag: "ControlLineLimitExceeded" });
const multibyte = Buffer.from("é😀\n", "utf8");
const exactCrLf = Buffer.from("éa\r\n", "utf8");
const crLfPartitions: { first: number; second: number }[] = [];
for (let first = 0; first <= exactCrLf.length; first += 1)
  for (let second = first; second <= exactCrLf.length; second += 1)
    crLfPartitions.push({ first, second });

describe("bounded control line decoding", () => {
  it.each(Array.from({ length: multibyte.length + 1 }, (_, split) => split))(
    "preserves split UTF-8 content at byte %i",
    async (split) => {
      expect(
        await collect(
          [multibyte.subarray(0, split), multibyte.subarray(split)],
          6,
        ),
      ).toEqual([ok("é😀")]);
    },
  );

  it.each(crLfPartitions)(
    "excludes the CRLF delimiter at the exact limit across cuts $first/$second",
    async ({ first, second }) => {
      expect(
        await collect(
          [
            exactCrLf.subarray(0, first),
            exactCrLf.subarray(first, second),
            exactCrLf.subarray(second),
          ],
          3,
        ),
      ).toEqual([ok("éa")]);
    },
  );

  it.each([
    { bytes: [0xff, 0x0a], maximum: 3, expected: [ok("�")] },
    { bytes: [0xff, 0x0a], maximum: 2, expected: [exceeded] },
    { bytes: [0xe2, 0x82], maximum: 3, expected: [ok("�")] },
    { bytes: [0xe2, 0x82], maximum: 2, expected: [exceeded] },
    { bytes: [0xe2, 0x28, 0xa1, 0x0a], maximum: 7, expected: [ok("�(�")] },
    { bytes: [0xe2, 0x28, 0xa1, 0x0a], maximum: 6, expected: [exceeded] },
  ])(
    "counts replacement characters against decoded bytes: $bytes / $maximum",
    async ({ bytes, maximum, expected }) => {
      const encoded = Buffer.from(bytes);
      expect(await collect([encoded], maximum)).toEqual(expected);
      expect(
        await collect(
          bytes.map((byte) => Uint8Array.of(byte)),
          maximum,
        ),
      ).toEqual(expected);
    },
  );
});

describe("bounded control line boundaries", () => {
  it.each([
    { text: "", maximum: 3, expected: [] },
    { text: "\n\r\n", maximum: 0, expected: [ok(""), ok("")] },
    { text: " \t \n", maximum: 3, expected: [ok(" \t ")] },
    { text: "a\rb\n", maximum: 3, expected: [ok("a\rb")] },
    { text: "abc", maximum: 3, expected: [ok("abc")] },
    { text: "ab\r", maximum: 3, expected: [ok("ab\r")] },
    { text: "abc\r", maximum: 3, expected: [exceeded] },
    { text: "\r", maximum: 0, expected: [exceeded] },
    {
      text: "a\n\nb\r\nc",
      maximum: 1,
      expected: [ok("a"), ok(""), ok("b"), ok("c")],
    },
  ])(
    "retains content and EOF semantics: $text",
    async ({ text, maximum, expected }) => {
      expect(await collect([Buffer.from(text)], maximum)).toEqual(expected);
    },
  );

  it.each(["\nnext\n", "\r\nnext\n", ""])(
    "reports oversized drips immediately and drains before the next frame: %j",
    async (tail) => {
      let consumed = 0;
      async function* drips(): AsyncGenerator<Uint8Array> {
        for (const byte of Buffer.from(`overflow${tail}`)) {
          consumed += 1;
          yield Uint8Array.of(byte);
        }
      }
      const lines = readBoundedControlLines(drips(), 4);
      expect(await lines.next()).toEqual({ done: false, value: exceeded });
      expect(consumed).toBe(5);
      if (tail !== "")
        expect(await lines.next()).toEqual({ done: false, value: ok("next") });
      expect(await lines.next()).toEqual({ done: true, value: undefined });
      expect(consumed).toBe(Buffer.byteLength(`overflow${tail}`));
    },
  );

  it("recovers from malformed-byte expansion before the following frame", async () => {
    expect(
      await collect([Uint8Array.of(0xff, 0x0a, 0x6f, 0x6b, 0x0a)], 2),
    ).toEqual([exceeded, ok("ok")]);
  });
});

describe("bounded control line stream ownership", () => {
  it("reports overflow before an open stream supplies a delimiter and then recovers", async () => {
    const source = new PassThrough();
    const lines = readBoundedControlLines(source, 4);
    try {
      source.write("oversized");
      expect(await lines.next()).toEqual({ done: false, value: exceeded });
      expect(source.writableEnded).toBe(false);
      expect(source.readableEnded).toBe(false);
      expect(source.destroyed).toBe(false);

      source.write(" remaining rejected content\nnext\n");
      expect(await lines.next()).toEqual({ done: false, value: ok("next") });
      source.end();
      expect(await lines.next()).toEqual({ done: true, value: undefined });
    } finally {
      source.destroy();
      await lines.return(undefined);
    }
  });

  it("propagates the original stream failure after completed lines", async () => {
    const source = new PassThrough();
    const lines = readBoundedControlLines(source, 10);
    try {
      source.write("first\n");
      expect(await lines.next()).toEqual({ done: false, value: ok("first") });
      const failure = new Error("control input failed");
      const next = lines.next();
      source.destroy(failure);
      await expect(next).rejects.toBe(failure);
    } finally {
      source.destroy();
      await lines.return(undefined);
    }
  });

  it.each([true, false])(
    "leaves early-return destruction to the supplied iterator (%s)",
    async (destroyOnReturn) => {
      const source = new PassThrough();
      const lines = readBoundedControlLines(
        source.iterator({ destroyOnReturn }),
        10,
      );
      try {
        source.write("first\n");
        expect(await lines.next()).toEqual({ done: false, value: ok("first") });
        await lines.return(undefined);
        expect(source.destroyed).toBe(destroyOnReturn);
        if (!destroyOnReturn) {
          source.end("next\n");
          const remaining: BoundedControlLine[] = [];
          for await (const line of readBoundedControlLines(source, 10))
            remaining.push(line);
          expect(remaining).toEqual([ok("next")]);
        }
      } finally {
        source.destroy();
        await lines.return(undefined);
      }
    },
  );
});

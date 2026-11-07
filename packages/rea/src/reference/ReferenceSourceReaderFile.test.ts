import { expect, it } from "vitest";

import { readFileContents } from "./ReferenceSourceReaderFile.js";

const reader = (bytes: Buffer, maximumRead = bytes.length) => {
  let position = 0;
  return {
    read(buffer: Buffer, offset: number, length: number) {
      const end = Math.min(
        bytes.length,
        position + length,
        position + maximumRead,
      );
      const bytesRead = bytes.copy(buffer, offset, position, end);
      position = end;
      return Promise.resolve({ bytesRead });
    },
  };
};

it("retains all bytes across short reads through the declared size", async () => {
  const bytes = Buffer.from("complete observation");
  const result = await readFileContents({
    handle: reader(bytes, 3),
    path: "source.txt",
    expectedSize: BigInt(bytes.length),
  });
  if (result.status === "failed") throw result.entry;
  expect(
    Buffer.compare(Buffer.concat(result.chunks, result.total), bytes),
  ).toBe(0);
});

it("reports growth instead of continuing to consume a changed file", async () => {
  const result = await readFileContents({
    handle: reader(Buffer.from("larger than admitted")),
    path: "source.txt",
    expectedSize: 1n,
  });
  expect(result).toEqual({
    status: "failed",
    entry: {
      status: "failed",
      kind: "file",
      path: "source.txt",
      code: "changed",
      message: "File grew while it was read",
      size: 2,
    },
  });
});

it("preserves cancellation that arrives during a descriptor read", async () => {
  const controller = new AbortController();
  const descriptor = reader(Buffer.from("observed"));
  const result = await readFileContents({
    handle: {
      async read(buffer, offset, length) {
        const read = await descriptor.read(buffer, offset, length);
        controller.abort();
        return read;
      },
    },
    path: "source.txt",
    expectedSize: 8n,
    signal: controller.signal,
  });
  expect(result).toMatchObject({
    status: "failed",
    entry: { code: "cancelled", path: "source.txt" },
  });
});

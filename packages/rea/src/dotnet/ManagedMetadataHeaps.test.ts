import { describe, expect, it } from "vitest";

import {
  readMetadataBlob,
  metadataTokenFact,
  readMetadataString,
  readMetadataUserString,
} from "./ManagedMetadataHeaps.js";
import {
  readManagedMetadataLayout,
  type ManagedMetadataLayout,
} from "./ManagedMetadataLayout.js";

describe("managed metadata heaps", () => {
  it("admits a metadata root that omits its empty #Blob stream", () => {
    const bytes = Buffer.alloc(108);
    bytes.writeUInt32LE(0x424a_5342, 0);
    bytes.writeUInt16LE(1, 4);
    bytes.writeUInt16LE(1, 6);
    const version = Buffer.from("v4.0.30319\0\0", "ascii");
    bytes.writeUInt32LE(version.length, 12);
    version.copy(bytes, 16);
    bytes.writeUInt16LE(0, 28);
    bytes.writeUInt16LE(3, 30);
    const streams = [
      { name: "#~", offset: 80, size: 24, nameSize: 4 },
      { name: "#Strings", offset: 104, size: 4, nameSize: 12 },
      { name: "#GUID", offset: 108, size: 0, nameSize: 8 },
    ] as const;
    let header = 32;
    for (const stream of streams) {
      bytes.writeUInt32LE(stream.offset, header);
      bytes.writeUInt32LE(stream.size, header + 4);
      bytes.write(`${stream.name}\0`, header + 8, "ascii");
      header += 8 + stream.nameSize;
    }
    bytes[104] = 0;

    const layout = readManagedMetadataLayout(bytes, 0, bytes.length);
    expect(layout.streamNames).toEqual(["#GUID", "#Strings", "#~"]);
    expect(layout.blob).toBeNull();
  });

  it("accepts the empty blob entry when an empty #Blob stream is omitted", () => {
    const layout = {
      rootOffset: 16,
      blob: null,
    } as unknown as ManagedMetadataLayout;

    expect(
      Buffer.compare(
        readMetadataBlob(Buffer.alloc(0), layout, 0, 0),
        Buffer.alloc(0),
      ),
    ).toBe(0);
    expect(() => readMetadataBlob(Buffer.alloc(0), layout, 1, 0)).toThrowError(
      expect.objectContaining({
        issue: expect.objectContaining({
          code: "missing-stream",
          scope: "metadata.#Blob",
        }),
      }),
    );
  });

  it("reads a blob item's compressed length from its ECMA-335 prefix", () => {
    const itemLength = 1_048_577;
    const bytes = Buffer.alloc(itemLength + 5);
    bytes.set([0xc0, 0x10, 0x00, 0x01], 1);
    const layout: ManagedMetadataLayout = {
      rootOffset: 0,
      size: bytes.length,
      version: "",
      streamNames: ["#Blob"],
      strings: { name: "#Strings", offset: 0, size: 0 },
      guid: { name: "#GUID", offset: 0, size: 0 },
      blob: { name: "#Blob", offset: 0, size: bytes.length },
      userStrings: null,
      tables: new Map(),
      rowCounts: [],
      stringIndexSize: 2,
      guidIndexSize: 2,
      blobIndexSize: 2,
      table: () => undefined,
      tableIndexSize: () => 2,
      codedIndexSize: () => 2,
    };

    expect(
      readMetadataBlob(bytes, layout, 1, layout.blob?.size ?? 0),
    ).toHaveLength(itemLength);
  });

  it.each([[[0x80]], [[0xc0, 0x00, 0x00]]])(
    "reports a #US length prefix cut off by the end of the artifact as a string failure",
    (prefix) => {
      // #US ends at the end of the artifact, inside a multi-byte length prefix.
      const bytes = Buffer.from([0x00, ...prefix]);
      const layout = {
        userStrings: { name: "#US", offset: 0, size: bytes.length },
      } as unknown as ManagedMetadataLayout;

      expect(() =>
        readMetadataUserString(bytes, layout, metadataTokenFact(0x70000001)),
      ).toThrowError(
        expect.objectContaining({
          issue: expect.objectContaining({
            code: "invalid-string",
            scope: "metadata.#US:0x70000001",
          }),
        }),
      );
    },
  );

  it("does not re-charge the decode budget on metadata string cache hits", () => {
    const strLen = 10 * 1024 * 1024;
    const strBytes = Buffer.alloc(strLen + 2, 0x61);
    strBytes[0] = 0x00;
    strBytes[strLen + 1] = 0x00;
    const layout = {
      rootOffset: 0,
      size: strBytes.length,
      version: "",
      streamNames: ["#Strings"],
      strings: { name: "#Strings", offset: 0, size: strBytes.length },
      guid: { name: "#GUID", offset: 0, size: 0 },
      blob: { name: "#Blob", offset: 0, size: 0 },
      userStrings: null,
      tables: new Map(),
      rowCounts: [],
      stringIndexSize: 2,
      guidIndexSize: 2,
      blobIndexSize: 2,
      table: () => undefined,
      tableIndexSize: () => 2,
      codedIndexSize: () => 2,
    } as unknown as ManagedMetadataLayout;

    const first = readMetadataString(strBytes, layout, 1, layout.strings.size);
    expect(first).toHaveLength(strLen);

    expect(() =>
      readMetadataString(strBytes, layout, 1, layout.strings.size),
    ).not.toThrow();
  });
});

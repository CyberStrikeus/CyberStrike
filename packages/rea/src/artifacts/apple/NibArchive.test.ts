import { describe, expect, it } from "vitest";

import { decodeNibArchive } from "./NibArchive.js";
import { encodeNibArchiveFixture as encodeArchive } from "./NibArchive.fixture.js";
import { InterfaceBuilderDecodeBudgetExceeded } from "./InterfaceBuilderDecodeBudget.js";

const archiveWithOverlappingObjectRanges = (objectCount: number): Buffer => {
  const objectRecords = Buffer.alloc(objectCount * 3);
  for (let index = 0; index < objectCount; index += 1)
    objectRecords.set([0x80, 0x80, 0x81], index * 3);
  const keys = Buffer.from([0x81, 0x78]);
  const values = Buffer.from([0x80, 10, 0, 0, 0, 0]);
  const className = Buffer.from("NSObject");
  const classes = Buffer.concat([
    Buffer.from([className.length]),
    Buffer.from([0x80]),
    className,
  ]);
  const objectsOffset = 50;
  const keysOffset = objectsOffset + objectRecords.length;
  const valuesOffset = keysOffset + keys.length;
  const classesOffset = valuesOffset + values.length;
  const header = Buffer.alloc(50);
  header.write("NIBArchive", 0, "ascii");
  header.writeUInt32LE(1, 10);
  header.writeUInt32LE(10, 14);
  header.writeUInt32LE(objectCount, 18);
  header.writeUInt32LE(objectsOffset, 22);
  header.writeUInt32LE(1, 26);
  header.writeUInt32LE(keysOffset, 30);
  header.writeUInt32LE(1, 34);
  header.writeUInt32LE(valuesOffset, 38);
  header.writeUInt32LE(1, 42);
  header.writeUInt32LE(classesOffset, 46);
  return Buffer.concat([header, objectRecords, keys, values, classes]);
};

describe("NIBArchive decoder", () => {
  it("preserves non-finite and negative-zero real values for typed projection", () => {
    const values = decodeNibArchive(
      encodeArchive({
        classes: ["NSObject"],
        objects: [
          {
            classIndex: 0,
            values: {
              nan: { float32: Number.NaN },
              positive: { float32: Number.POSITIVE_INFINITY },
              negative: { float64: Number.NEGATIVE_INFINITY },
              negativeZero32: { float32: -0 },
              negativeZero64: { float64: -0 },
              nil: null,
            },
          },
        ],
      }),
    ).objects[0]?.values;
    expect(Number.isNaN(values?.nan)).toBe(true);
    expect(values?.positive).toBe(Number.POSITIVE_INFINITY);
    expect(values?.negative).toBe(Number.NEGATIVE_INFINITY);
    expect(Object.is(values?.negativeZero32, -0)).toBe(true);
    expect(Object.is(values?.negativeZero64, -0)).toBe(true);
    expect(values?.nil).toBeNull();
  });

  it("keeps leading U+FEFF in length-prefixed keys and class names", () => {
    const archive = encodeArchive({
      classes: ["\uFEFFWidget"],
      objects: [{ classIndex: 0, values: { count: 1, "\uFEFFcount": 2 } }],
    });
    expect(decodeNibArchive(archive).objects).toEqual([
      {
        id: 0,
        class_name: "\uFEFFWidget",
        values: { count: 1, "\uFEFFcount": 2 },
      },
    ]);
    const invalid = Buffer.from(archive);
    invalid[invalid.indexOf(Buffer.from("\uFEFFcount"))] = 0xff;
    expect(() => decodeNibArchive(invalid)).toThrow(/not valid UTF-8/u);
  });
  it("decodes bounded object, key, class, and reference tables", () => {
    const archive = encodeArchive({
      classes: ["NSView\0", "NSString\0"],
      objects: [
        { classIndex: 0, values: { child: { ref: 1 }, enabled: true } },
        { classIndex: 1, values: { text: "Button" } },
      ],
    });
    const decoded = decodeNibArchive(archive);

    expect(decoded.objects).toEqual([
      {
        id: 0,
        class_name: "NSView",
        values: { child: { $nib_object_ref: 1 }, enabled: true },
      },
      {
        id: 1,
        class_name: "NSString",
        values: { text: { $nib_data_base64: "QnV0dG9u" } },
      },
    ]);
    expect(decoded.coder_version).toBe(10);
  });

  it("reads boolean value tags with AppKit's polarity", () => {
    // Raw tags, independent of the fixture encoder's boolean encoding: AppKit's
    // decodeBoolForKey: returns NO for tag 4 and YES for tag 5 in compiled nibs.
    const archive = encodeArchive({
      classes: ["NSButton"],
      objects: [
        {
          classIndex: 0,
          values: {
            NSControlContinuous: null,
            NSControlRefusesFirstResponder: null,
            NSEnabled: 0,
          },
        },
      ],
    });
    const values = archive.readUInt32LE(38);
    // Value records: key varint, then type tag; both fields start as nil (9).
    expect([...archive.subarray(values, values + 4)]).toEqual([
      0x80, 9, 0x81, 9,
    ]);
    const tagged = Buffer.from(archive);
    tagged[values + 1] = 4;
    tagged[values + 3] = 5;
    expect(decodeNibArchive(tagged).objects[0]?.values).toEqual({
      NSControlContinuous: false,
      NSControlRefusesFirstResponder: true,
      NSEnabled: 0,
    });
  });

  it("counts AppKit outlet, action, and binding connector objects", () => {
    const archive = encodeArchive({
      classes: [
        "NSNibOutletConnector",
        "NSNibControlConnector",
        "NSNibBindingConnector",
      ],
      objects: [
        { classIndex: 0, values: {} },
        { classIndex: 1, values: {} },
        { classIndex: 2, values: {} },
      ],
    });

    expect(decodeNibArchive(archive).connection_object_count).toBe(3);
  });

  it("rejects malformed references and unsupported format versions", () => {
    const valid = encodeArchive({
      classes: ["NSObject"],
      objects: [{ classIndex: 0, values: {} }],
    });
    const invalidVersion = Buffer.from(valid);
    invalidVersion.writeUInt32LE(2, 10);
    expect(() => decodeNibArchive(invalidVersion)).toThrow(/Unsupported/u);
    const invalidReference = encodeArchive({
      classes: ["NSObject"],
      objects: [{ classIndex: 0, values: { child: { ref: 4 } } }],
    });
    expect(() => decodeNibArchive(invalidReference)).toThrow(
      /object reference/u,
    );
  });

  it("budgets overlapping object value ranges before materializing their fields", () => {
    const archive = archiveWithOverlappingObjectRanges(700_000);
    let thrown: unknown;
    try {
      decodeNibArchive(archive);
    } catch (cause: unknown) {
      thrown = cause;
    }
    expect(thrown).toBeInstanceOf(InterfaceBuilderDecodeBudgetExceeded);
    expect(thrown).toHaveProperty(
      "message",
      expect.stringMatching(/projected field ranges/u),
    );
  });
});

it("retains repeated serialized collection fields in source order", () => {
  const decoded = decodeNibArchive(
    encodeArchive({
      classes: ["NSArray", "NSButton"],
      objects: [
        {
          classIndex: 0,
          values: [
            ["UINibEncoderEmptyKey", { ref: 2 }],
            ["UINibEncoderEmptyKey", { ref: 1 }],
          ],
        },
        { classIndex: 1, values: {} },
        { classIndex: 1, values: {} },
      ],
    }),
  );
  expect(decoded.objects[0]?.values).toEqual({});
  expect(decoded.objects[0]?.repeated_values).toEqual({
    UINibEncoderEmptyKey: [{ $nib_object_ref: 2 }, { $nib_object_ref: 1 }],
  });
});

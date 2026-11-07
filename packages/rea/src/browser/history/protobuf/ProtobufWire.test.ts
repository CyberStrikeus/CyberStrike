import { expect, it } from "vitest";
import { create, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { decodeProtobufWire, ProtobufBudget } from "./ProtobufWire.js";
import { decodeProtobufBody } from "./ProtobufBody.js";
import { ProtobufSchema } from "./ProtobufSchema.js";
import { protobufCaptureDescriptor } from "../../../../tests/fixtures/protobufCapture.js";

const same = (value: string) => value;
const wire = (hex: string) => {
  const bytes = Buffer.from(hex, "hex");
  return decodeProtobufWire(
    bytes,
    0,
    bytes.length,
    0,
    new ProtobufBudget(),
    same,
  );
};
const readSchema = async (...args: Parameters<typeof ProtobufSchema.read>) => {
  const admitted = await ProtobufSchema.read(...args);
  if (!admitted.ok) throw new Error(admitted.error.message);
  return admitted.value;
};
const source = {
  pointer: "/response/content/text",
  content_type: "application/grpc-web+proto",
  body_sha256: "a".repeat(64),
};
const frame = (bytes: Buffer, flag = 0) => {
  const header = Buffer.alloc(5);
  header[0] = flag;
  header.writeUInt32BE(bytes.length, 1);
  return Buffer.concat([header, bytes]);
};

it("rejects overflowing uint64 values without masking and preserves the maximum value", async () => {
  expect(await wire("0880808080808080808002")).toMatchObject({
    fields: [],
    error: { offset: 0 },
  });
  expect((await wire("08ffffffffffffffffff01")).fields[0]?.value).toBe(
    "18446744073709551615",
  );
  expect(await wire("0880808080808080808080")).toHaveProperty("error");
  expect(await wire("0880")).toHaveProperty("error");
});

it("preserves repeated field occurrences, source ranges, ambiguous bytes and exact fixed values", async () => {
  const result = await wire("0896010801120568656c6c6f1a02080125ffffffff");
  expect(result.error).toBeUndefined();
  expect(result.fields.map(({ number }) => number)).toEqual([1, 1, 2, 3, 4]);
  expect(result.fields[2]).toMatchObject({
    field_id: "offset:5",
    offset: 5,
    payload_offset: 7,
    payload_bytes: 5,
    text: "hello",
    interpretations: ["utf8-string", "packed-varint", "bytes"],
  });
  expect(result.fields[3]?.interpretations).toContain("nested-message");
  expect(result.fields[3]?.text).toBe("\b\u0001");
  expect(result.fields[4]?.value).toBe("4294967295");
});

it("handles proto2 groups and reports mismatched or missing end groups", async () => {
  expect((await wire("0b10010c")).fields).toMatchObject([
    { wire_type: "group", bytes: 4 },
    { parent_field_id: "offset:0", number: 2, value: "1" },
  ]);
  expect(await wire("0b100114")).toHaveProperty("error");
  expect(await wire("0b1001")).toHaveProperty("error");
  expect(await wire("0c")).toHaveProperty("error");
});

it("keeps empty and control-containing UTF-8 among ambiguous length-delimited readings", async () => {
  const empty = await wire("0a00");
  expect(empty.fields[0]).toMatchObject({
    text: "",
    interpretations: [
      "utf8-string",
      "nested-message",
      "packed-varint",
      "packed-fixed32",
      "packed-fixed64",
      "bytes",
    ],
  });
  expect((await wire("0a020801")).fields[0]).toMatchObject({
    text: "\b\u0001",
  });
});

it("keeps enum numbers separate from every declared alias", async () => {
  const bytes = toBinary(
    FileDescriptorSetSchema,
    create(FileDescriptorSetSchema, {
      file: [
        {
          name: "aliases.proto",
          package: "aliases",
          syntax: "proto3",
          enumType: [
            {
              name: "Mode",
              options: { allowAlias: true },
              value: [
                { name: "ZERO", number: 0 },
                { name: "ALSO_ZERO", number: 0 },
              ],
            },
          ],
          messageType: [
            {
              name: "Message",
              field: [
                {
                  name: "mode",
                  number: 1,
                  type: 14,
                  typeName: ".aliases.Mode",
                  label: 1,
                },
                { name: "negative_zero", number: 2, type: 2, label: 1 },
              ],
            },
          ],
        },
      ],
    }),
  );
  const budget = new ProtobufBudget();
  const schema = await readSchema(bytes, "aliases.Message", budget, same);
  const decoded = await decodeProtobufBody(
    Buffer.from([8, 0, 21, 0, 0, 0, 128]),
    "raw",
    source,
    same,
    budget,
    schema,
  );
  expect(decoded.fields[1]).toMatchObject({
    value: "2147483648",
    schema_value: "-0",
  });
  expect(decoded.fields[0]).toMatchObject({
    value: "0",
    schema_type: "aliases.Mode",
    schema_value: "0",
    schema_enum_values: [{ number: "0", names: ["ZERO", "ALSO_ZERO"] }],
  });
});

it("bounds qualified descriptor-name expansion before creating the SDK registry", async () => {
  const bytes = toBinary(
    FileDescriptorSetSchema,
    create(FileDescriptorSetSchema, {
      file: [
        {
          name: "expansion.proto",
          syntax: "proto3",
          messageType: [
            {
              name: "A".repeat(10000),
              nestedType: Array.from({ length: 2000 }, (_, index) => ({
                name: `Child${index}`,
              })),
            },
          ],
        },
      ],
    }),
  );
  await expect(
    ProtobufSchema.read(bytes, "Missing", new ProtobufBudget(), same),
  ).rejects.toMatchObject({ reason: "limit" });
});

it("distinguishes native gRPC flags from web trailers and retains partial messages", async () => {
  const body = Buffer.concat([
    frame(Buffer.from("0801", "hex")),
    frame(Buffer.from("grpc-status: 0\r\ngrpc-message: ok\r\n"), 128),
  ]);
  const web = await decodeProtobufBody(
    body,
    "grpc-web",
    source,
    same,
    new ProtobufBudget(),
  );
  expect(web.status).toBe("complete");
  expect(web.frames[1]?.trailers).toEqual([
    { name: "grpc-status", value: "0" },
    { name: "grpc-message", value: "ok" },
  ]);
  expect(
    (await decodeProtobufBody(body, "grpc", source, same, new ProtobufBudget()))
      .error,
  ).toMatchObject({ offset: 7 });
  expect(
    (
      await decodeProtobufBody(
        frame(Buffer.from("0880", "hex")),
        "grpc",
        source,
        same,
        new ProtobufBudget(),
      )
    ).frames[0],
  ).toMatchObject({ status: "partial", error: { offset: 5 } });
  expect(
    (
      await decodeProtobufBody(
        frame(Buffer.from("0801", "hex"), 2),
        "grpc-web",
        source,
        same,
        new ProtobufBudget(),
      )
    ).status,
  ).toBe("partial");
});

it("decodes independently padded base64 chunks with explicit coordinates and rejects noncanonical text", async () => {
  const first = frame(Buffer.from("0801", "hex"));
  const second = frame(Buffer.from("0802", "hex"));
  const body = Buffer.from(
    first.toString("base64") + second.toString("base64"),
  );
  const decoded = await decodeProtobufBody(
    body,
    "grpc-web-text",
    source,
    same,
    new ProtobufBudget(),
  );
  expect(decoded).toMatchObject({
    offset_basis: "base64-decoded-body",
    decoded_bytes: 14,
    status: "complete",
  });
  expect(
    decoded.fields.map(({ field_id, value }) => [field_id, value]),
  ).toEqual([
    ["offset:5", "1"],
    ["offset:12", "2"],
  ]);
  expect(decoded.fields.map(({ index }) => index)).toEqual([0, 1]);
  for (const text of ["AB==", "!!!!", first.toString("base64") + "AB=="])
    expect(
      await decodeProtobufBody(
        Buffer.from(text),
        "grpc-web-text",
        source,
        same,
        new ProtobufBudget(),
      ),
    ).toMatchObject({
      decoded_bytes: 0,
      status: "partial",
      examined_bytes: 0,
      frames: [],
      fields: [],
      error: { offset: 0 },
    });
});

it("keeps compressed payloads explicitly unknown and rejects frames beyond the body", async () => {
  const compressed = await decodeProtobufBody(
    frame(Buffer.from("0801", "hex"), 1),
    "grpc",
    source,
    same,
    new ProtobufBudget(),
  );
  expect(compressed.frames[0]).toMatchObject({
    status: "unknown",
    compressed: true,
    examined_bytes: 0,
  });
  expect(compressed.fields).toEqual([]);
  expect(
    (
      await decodeProtobufBody(
        Buffer.from("00000000090801", "hex"),
        "grpc",
        source,
        same,
        new ProtobufBudget(),
      )
    ).error,
  ).toBeDefined();
});

it("uses supplied descriptors without replacing wire values and preserves schema disagreements", async () => {
  const descriptor = toBinary(
    FileDescriptorSetSchema,
    create(FileDescriptorSetSchema, {
      file: [
        {
          name: "sample.proto",
          package: "sample",
          syntax: "proto3",
          messageType: [
            {
              name: "Child",
              field: [{ name: "count", number: 1, type: 5, label: 1 }],
            },
            {
              name: "Message",
              field: [
                { name: "signed", number: 1, type: 17, label: 1 },
                { name: "text", number: 2, type: 9, label: 1 },
                {
                  name: "child",
                  number: 3,
                  type: 11,
                  label: 1,
                  typeName: ".sample.Child",
                },
                { name: "values", number: 4, type: 13, label: 3 },
              ],
            },
          ],
        },
      ],
    }),
  );
  const budget = new ProtobufBudget();
  const schema = await readSchema(descriptor, "sample.Message", budget, same);
  const body = Buffer.from("0801120568656c6c6f1a020801220201023801", "hex");
  const decoded = await decodeProtobufBody(
    body,
    "raw",
    source,
    same,
    budget,
    schema,
  );
  expect(decoded.fields[0]).toMatchObject({
    value: "1",
    schema_name: "signed",
    schema_type: "sint32",
    schema_value: "-1",
  });
  expect(
    decoded.fields.find(({ schema_name }) => schema_name === "text")
      ?.schema_value,
  ).toBe("hello");
  expect(
    decoded.fields.find(({ schema_name }) => schema_name === "count"),
  ).toMatchObject({ parent_field_id: "offset:9", value: "1" });
  expect(
    decoded.fields.find(({ schema_name }) => schema_name === "values")
      ?.schema_value,
  ).toBe('["1","2"]');
  expect(decoded.fields.at(-1)?.schema_status).toBe("unknown-field");
  schema.reset();
  expect(
    (
      await decodeProtobufBody(
        Buffer.from("1001", "hex"),
        "raw",
        source,
        same,
        budget,
        schema,
      )
    ).fields[0]?.schema_status,
  ).toBe("wire-type-mismatch");
});

it("stops before exhausting fact capacity and yields for caller cancellation", async () => {
  const budget = new ProtobufBudget();
  budget.charge(96 * 1024 * 1024 - 1023);
  await expect(
    decodeProtobufWire(Buffer.from([8, 1]), 0, 2, 0, budget, same),
  ).rejects.toMatchObject({ reason: "limit" });
  const abort = new AbortController();
  const reason = new Error("caller stopped selected decoding");
  const data = Buffer.alloc(8192);
  for (let at = 0; at < data.length; at += 2) {
    data[at] = 8;
    data[at + 1] = 1;
  }
  const task = decodeProtobufWire(
    data,
    0,
    data.length,
    0,
    new ProtobufBudget(abort.signal),
    same,
  );
  setImmediate(() => abort.abort(reason));
  await expect(task).rejects.toBe(reason);
});

it("preserves a leading Unicode BOM in both the wire string and schema interpretation", async () => {
  const budget = new ProtobufBudget();
  const schema = await readSchema(
    protobufCaptureDescriptor(),
    "capture.Message",
    budget,
    same,
  );
  const bytes = Buffer.from("0a08efbbbf68656c6c6f", "hex");
  const result = await decodeProtobufWire(
    bytes,
    0,
    bytes.length,
    0,
    budget,
    same,
    schema,
  );
  expect(result.fields[0]).toMatchObject({
    text: "\uFEFFhello",
    schema_value: "\uFEFFhello",
  });
});

it("keeps bad nested schema interpretations local and preserves subsequent outer fields", async () => {
  const descriptor = toBinary(
    FileDescriptorSetSchema,
    create(FileDescriptorSetSchema, {
      file: [
        {
          name: "nested.proto",
          package: "nested",
          syntax: "proto3",
          messageType: [
            {
              name: "Child",
              field: [{ name: "value", number: 1, type: 13, label: 1 }],
            },
            {
              name: "Message",
              field: [
                {
                  name: "child",
                  number: 1,
                  type: 11,
                  label: 1,
                  typeName: ".nested.Child",
                },
                { name: "value", number: 2, type: 13, label: 1 },
              ],
            },
          ],
        },
      ],
    }),
  );
  const budget = new ProtobufBudget();
  const schema = await readSchema(descriptor, "nested.Message", budget, same);
  const bytes = Buffer.from("0a01ff1001", "hex");
  const result = await decodeProtobufWire(
    bytes,
    0,
    bytes.length,
    0,
    budget,
    same,
    schema,
  );
  expect(result.error).toBeUndefined();
  expect(result.examined_bytes).toBe(bytes.length);
  expect(result.fields).toMatchObject([
    {
      number: 1,
      schema_status: "invalid-message",
      schema_error: { offset: 2 },
    },
    { number: 2, value: "1", schema_value: "1", parent_field_id: null },
  ]);
});

it("yields and preserves the cancellation reason inside one large packed interpretation", async () => {
  const abort = new AbortController();
  const budget = new ProtobufBudget(abort.signal);
  const schema = await readSchema(
    protobufCaptureDescriptor(),
    "capture.Message",
    budget,
    same,
  );
  // Field 2, length 100000, followed by 100000 independently expected uint32 ones.
  const bytes = Buffer.concat([
    Buffer.from([18, 160, 141, 6]),
    Buffer.alloc(100000, 1),
  ]);
  const parsed = await decodeProtobufWire(
    bytes,
    0,
    bytes.length,
    0,
    new ProtobufBudget(),
    same,
  );
  const field = parsed.fields[0];
  if (field === undefined) throw new Error("Expected the packed wire field");
  const task = schema.annotate(field, bytes, undefined);
  const reason = new Error("stop during packed annotation");
  setImmediate(() => abort.abort(reason));
  await expect(task).rejects.toBe(reason);
});

it("rejects malformed descriptor wire even when the SDK would skip the unknown field", async () => {
  // File t.proto defines empty M, then unknown field 99 carries an overflowing uint64.
  const bytes = Buffer.from(
    "0a1a0a07742e70726f746f22030a014d980680808080808080808002",
    "hex",
  );
  await expect(
    ProtobufSchema.read(bytes, "M", new ProtobufBudget(), same),
  ).resolves.toMatchObject({
    ok: false,
    error: {
      kind: "malformed-descriptor",
      field: "descriptor_set_path",
      message: expect.stringContaining("byte"),
    },
  });
});

it("uses the same group grammar for nested candidates and direct messages", async () => {
  for (const [nested, accepted] of [
    ["0b10010c", true],
    ["0b100114", false],
    ["0b1001", false],
    ["0c", false],
    ["0900", false],
  ] as const) {
    const direct = await wire(nested);
    const wrapped = await wire(
      `0a${(nested.length / 2).toString(16).padStart(2, "0")}${nested}`,
    );
    expect(direct.error === undefined).toBe(accepted);
    expect(wrapped.fields[0]?.interpretations?.includes("nested-message")).toBe(
      accepted,
    );
  }
});
it("distinguishes missing selected message types from malformed and duplicate descriptor declarations", async () => {
  expect(
    await ProtobufSchema.read(
      protobufCaptureDescriptor(),
      "capture.Missing",
      new ProtobufBudget(),
      same,
    ),
  ).toMatchObject({
    ok: false,
    error: {
      kind: "missing-message",
      field: "message_type",
      message: expect.stringContaining("capture.Missing"),
    },
  });
  const bytes = toBinary(
    FileDescriptorSetSchema,
    create(FileDescriptorSetSchema, {
      file: [
        {
          name: "duplicate.proto",
          syntax: "proto3",
          messageType: [
            {
              name: "M",
              field: [
                { name: "first", number: 1, type: 5, label: 1 },
                { name: "second", number: 1, type: 9, label: 1 },
              ],
            },
          ],
        },
      ],
    }),
  );
  expect(
    await ProtobufSchema.read(bytes, "M", new ProtobufBudget(), same),
  ).toMatchObject({
    ok: false,
    error: {
      kind: "malformed-descriptor",
      field: "descriptor_set_path",
      message: expect.stringContaining("Duplicate field number 1"),
    },
  });
});

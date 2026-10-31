import { expect, it } from "vitest";
import { decodeProtobufBody } from "./ProtobufBody.js";
import { ProtobufBudget } from "./ProtobufWire.js";

const source = {
  pointer: "/response/content/text",
  content_type: "application/grpc-web+proto",
  body_sha256: "a".repeat(64),
};
const same = (value: string) => value;
const trailerFrame = (text: string) => {
  return trailerFrameBytes(Buffer.from(text, "utf8"));
};
const trailerFrameBytes = (payload: Uint8Array) => {
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = 128;
  frame.writeUInt32BE(payload.length, 1);
  frame.set(payload, 5);
  return frame;
};
const dataFrame = (payload: Uint8Array) => {
  const frame = Buffer.alloc(5 + payload.length);
  frame.writeUInt32BE(payload.length, 1);
  frame.set(payload, 5);
  return frame;
};

it("rejects forbidden trailer controls while retaining valid earlier trailers", async () => {
  for (const code of [
    ...Array.from({ length: 32 }, (_, index) => index),
    127,
  ]) {
    if (code === 9) continue;
    const control = String.fromCharCode(code);
    const text = `grpc-message: kept\r\ngrpc-status: 0${control}bad\r\n`;
    const input = trailerFrame(text);
    const result = await decodeProtobufBody(
      input,
      "grpc-web",
      source,
      same,
      new ProtobufBudget(),
    );
    expect(result.status, JSON.stringify(control)).toBe("partial");
    expect(result.frames[0]?.error).toMatchObject({ offset: 5 });
    expect(result.examined_bytes).toBe(5 + Buffer.byteLength(text));
    expect(result.frames[0]).toMatchObject({
      status: "partial",
      examined_bytes: Buffer.byteLength(text),
    });
    expect(result.frames[0]?.trailers).toEqual([
      { name: "grpc-message", value: "kept" },
    ]);
    expect(Buffer.compare(input.subarray(5), Buffer.from(text, "utf8"))).toBe(
      0,
    );
  }
});

it("retains allowed whitespace, visible text, and valid UTF-8 obs-text", async () => {
  const text = "grpc-message: alpha\tbeta \u00e9\r\n";
  const result = await decodeProtobufBody(
    trailerFrame(text),
    "grpc-web",
    source,
    same,
    new ProtobufBudget(),
  );
  expect(result.status).toBe("complete");
  expect(result.frames[0]?.trailers).toEqual([
    { name: "grpc-message", value: "alpha\tbeta \u00e9" },
  ]);
  expect(result.examined_bytes).toBe(5 + Buffer.byteLength(text));
});

it("excludes trailing whitespace from trailer field values", async () => {
  const text =
    "grpc-status: 0 \r\ngrpc-message: alpha\tbeta \t\r\nx-empty: \t\r\n";
  const result = await decodeProtobufBody(
    trailerFrame(text),
    "grpc-web",
    source,
    same,
    new ProtobufBudget(),
  );
  expect(result.status).toBe("complete");
  expect(result.frames[0]?.trailers).toEqual([
    { name: "grpc-status", value: "0" },
    { name: "grpc-message", value: "alpha\tbeta" },
    { name: "x-empty", value: "" },
  ]);
  expect(result.examined_bytes).toBe(5 + Buffer.byteLength(text));
});

it.each(["grpc-web", "grpc-web-text"] as const)(
  "keeps valid trailer fields around an opaque non-UTF-8 value in %s framing",
  async (framing) => {
    const trailer = Buffer.concat([
      Buffer.from("grpc-status: 0\r\nx-note: caf", "ascii"),
      Buffer.from([0xe9]),
      Buffer.from("\r\nx-after: kept\r\n", "ascii"),
    ]);
    const binary = Buffer.concat([
      dataFrame(Buffer.from([0x08, 0x01])),
      trailerFrameBytes(trailer),
    ]);
    const input =
      framing === "grpc-web-text"
        ? Buffer.from(binary.toString("base64"), "ascii")
        : binary;
    const result = await decodeProtobufBody(
      input,
      framing,
      source,
      same,
      new ProtobufBudget(),
    );

    expect(result.status).toBe("partial");
    expect(result.fields).toMatchObject([
      { number: 1, wire_type: "varint", value: "1" },
    ]);
    expect(result.frames[1]).toMatchObject({
      kind: "trailer",
      offset: binary.length - trailer.length - 5,
      payload_offset: binary.length - trailer.length,
      bytes: trailer.length,
      status: "partial",
      examined_bytes: trailer.length,
      error: {
        reason:
          "gRPC-web trailer field contains opaque non-UTF-8 bytes; that field was omitted",
      },
      trailers: [
        { name: "grpc-status", value: "0" },
        { name: "x-after", value: "kept" },
      ],
    });
    expect(result.examined_bytes).toBe(binary.length);
    expect(Buffer.compare(binary.subarray(-trailer.length), trailer)).toBe(0);
  },
);

it.each(["Grpc-Status", "GRPC-STATUS"])(
  "retains a valid prefix when the trailer name %s violates gRPC-Web casing",
  async (name) => {
    const text = `grpc-message: kept\r\n${name}: 0\r\n`;
    const result = await decodeProtobufBody(
      trailerFrame(text),
      "grpc-web",
      source,
      same,
      new ProtobufBudget(),
    );
    expect(result.status).toBe("partial");
    expect(result.examined_bytes).toBe(5 + Buffer.byteLength(text));
    expect(result.frames[0]?.trailers).toEqual([
      { name: "grpc-message", value: "kept" },
    ]);
  },
);

it("omits a trailer field with a non-ASCII name and preserves unexpected failures", async () => {
  const input = trailerFrame("grpc-status: 0\r\n");
  input[5] = 255;
  const malformed = await decodeProtobufBody(
    input,
    "grpc-web",
    source,
    same,
    new ProtobufBudget(),
  );
  expect(malformed.status).toBe("partial");
  expect(malformed.frames[0]?.examined_bytes).toBe("grpc-status: 0\r\n".length);
  expect(malformed.frames[0]?.trailers).toEqual([]);

  const failure = { kind: "controlled-redaction-failure" };
  await expect(
    decodeProtobufBody(
      trailerFrame("grpc-status: 0\r\n"),
      "grpc-web",
      source,
      () => {
        throw failure;
      },
      new ProtobufBudget(),
    ),
  ).rejects.toBe(failure);
});

import { create, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";

export const protobufFrame = (body: Buffer, flag = 0): Buffer => {
  const header = Buffer.alloc(5);
  header[0] = flag;
  header.writeUInt32BE(body.length, 1);
  return Buffer.concat([header, body]);
};

export const protobufCaptureBody = () =>
  Buffer.concat([
    protobufFrame(Buffer.from("0a0568656c6c6f12020102", "hex")),
    protobufFrame(Buffer.from("grpc-status: 0\r\n"), 128),
  ]);

/** Original fixture schema; independent expected field values come from the literal wire bytes. */
export const protobufCaptureDescriptor = () =>
  toBinary(
    FileDescriptorSetSchema,
    create(FileDescriptorSetSchema, {
      file: [
        {
          name: "capture.proto",
          package: "capture",
          syntax: "proto3",
          messageType: [
            {
              name: "Message",
              field: [
                { name: "sentence", number: 1, type: 9, label: 1 },
                { name: "values", number: 2, type: 13, label: 3 },
              ],
            },
          ],
        },
      ],
    }),
  );

export const protobufHar = (
  body: Buffer = protobufCaptureBody(),
  mimeType = "application/grpc-web+proto",
  additionalBodies: readonly Buffer[] = [],
  responseHeaders: readonly {
    readonly name: string;
    readonly value: string;
  }[] = [],
) =>
  JSON.stringify({
    log: {
      version: "1.2",
      creator: { name: "REA original fixture", version: "1" },
      entries: [body, ...additionalBodies].map((body) => ({
        startedDateTime: "2026-10-20T00:00:00Z",
        time: 1,
        request: {
          method: "POST",
          url: "https://example.invalid/api",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: responseHeaders,
          redirectURL: "",
          headersSize: -1,
          bodySize: body.length,
          content: {
            size: body.length,
            mimeType,
            text: body.toString("base64"),
            encoding: "base64",
          },
        },
        cache: {},
        timings: { send: 0, wait: 1, receive: 0 },
      })),
    },
  });

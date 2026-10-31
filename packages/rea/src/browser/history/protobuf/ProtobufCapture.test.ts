import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestTempDirectory } from "../../../../tests/fixtures/temporaryDirectory.js";
import { protobufCaptureDescriptor } from "../../../../tests/fixtures/protobufCapture.js";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { ArtifactResourceScope } from "../../../artifacts/ArtifactResourceScope.js";
import {
  inspectWebNetworkCaptureInputSchema,
  type WebNetworkCapture,
} from "../../../domain/webNetworkCapture.js";
import {
  prepareCaptureProtobuf,
  decodeCaptureProtobuf,
} from "./ProtobufCapture.js";

const binary = (pointer: string, bytes: Buffer) => ({
  pointer,
  representation: "producer-bytes" as const,
  state: "retained" as const,
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  content_base64: bytes.toString("base64"),
});

const captureWithBody = (
  contentType: string,
  body: Buffer,
): WebNetworkCapture => ({
  artifact: { path: "/fixture.mitm", bytes: 100, sha256: "a".repeat(64) },
  decoder: { id: "fixture", name: "Native producer facts", version: "1" },
  container: {
    reported: null,
    numeric_literals: [],
    redactions: [],
    records_pointer: "/flows",
  },
  format: "mitmproxy",
  total_records: 1,
  runtime_attribution: "unknown",
  limitations: [],
  records: [
    {
      ordinal: 0,
      location: { kind: "byte-range", offset: 0, bytes: 100 },
      reported: { response: { headers: [[null, null]], content: null } },
      binary_fields: [
        binary("/response/headers/0/0", Buffer.from("content-type")),
        binary("/response/headers/0/1", Buffer.from(contentType)),
        binary("/response/content", body),
      ],
      numeric_literals: [],
      redactions: [],
      limitations: [],
    },
  ],
});

const decode = async (
  capture: WebNetworkCapture,
  framing: "auto" | "raw" = "auto",
) => {
  const input = inspectWebNetworkCaptureInputSchema.parse({
    capture_path: capture.artifact.path,
    format: capture.format,
    record_ordinals: [0],
    protobuf: { framing },
  });
  const resources = new ArtifactResourceScope();
  try {
    const prepared = await prepareCaptureProtobuf(capture, input);
    await decodeCaptureProtobuf(capture, input, resources, prepared);
  } finally {
    await resources.close();
  }
};

const grpcWebTrailerFrame = (text: Buffer) => {
  const frame = Buffer.alloc(5 + text.length);
  frame[0] = 128;
  frame.writeUInt32BE(text.length, 1);
  text.copy(frame, 5);
  return frame;
};

it("restricts framing overrides to native body facts while preserving header bytes", async () => {
  const payload = Buffer.from([8, 1]);
  const body = Buffer.alloc(5 + payload.length);
  body.writeUInt32BE(payload.length, 1);
  payload.copy(body, 5);
  const report = captureWithBody("application/grpc", body);
  const headers = report.records[0]!.binary_fields.slice(0, 2);
  const input = inspectWebNetworkCaptureInputSchema.parse({
    capture_path: report.artifact.path,
    format: report.format,
    record_ordinals: [0],
    protobuf: { framing: "grpc" },
  });
  const resources = new ArtifactResourceScope();
  try {
    const prepared = await prepareCaptureProtobuf(report, input);
    await decodeCaptureProtobuf(report, input, resources, prepared);
  } finally {
    await resources.close();
  }
  expect(report.records[0]?.protobuf).toMatchObject([
    {
      pointer: "/response/content",
      status: "complete",
      fields: [{ number: 1, value: "1" }],
    },
  ]);
  expect(report.records[0]?.protobuf).toHaveLength(1);
  expect(report.records[0]?.binary_fields.slice(0, 2)).toEqual(headers);
  expect(report.protobuf_coverage?.status).toBe("complete");
});

it("keeps capture coverage partial for a malformed gRPC-web trailer", async () => {
  const trailerText = Buffer.from("grpc-status: 0\u0000bad\r\n");
  const body = grpcWebTrailerFrame(trailerText);
  const report = captureWithBody("application/grpc-web", body);
  const retainedBody = report.records[0]!.binary_fields[2];
  await decode(report);

  expect(report.records[0]?.protobuf?.[0]).toMatchObject({
    framing: "grpc-web",
    status: "partial",
    examined_bytes: body.length,
    frames: [{ status: "partial", examined_bytes: trailerText.length }],
  });
  expect(report.protobuf_coverage?.status).toBe("partial");
  expect(report.records[0]?.binary_fields[2]).toEqual(retainedBody);
});

it.each([false, true])(
  "admits equivalent default binary profiles in repeated byte headers (reverse=%s)",
  async (reverse) => {
    const types = [
      "Application/Protobuf;type=left",
      'application/protobuf;ENCODING="binary";type="right;=value"',
    ];
    if (reverse) types.reverse();
    const report = captureWithBody(types[0]!, Buffer.from([8, 1]));
    const record = report.records[0]!;
    record.reported = {
      response: {
        headers: [
          [null, null],
          [null, null],
        ],
        content: null,
      },
    };
    record.binary_fields.push(
      binary("/response/headers/1/0", Buffer.from("Content-Type")),
      binary("/response/headers/1/1", Buffer.from(types[1]!)),
    );
    const retained = structuredClone(record.binary_fields);
    await decode(report);
    expect(report.protobuf_coverage?.status).toBe("complete");
    expect(record.protobuf?.[0]).toMatchObject({
      content_type: types[0],
      framing: "raw",
      fields: [{ number: 1, value: "1" }],
    });
    expect(record.binary_fields).toEqual(retained);
  },
);

it.each([false, true])(
  "keeps incompatible repeated MIME headers unknown (reverse=%s)",
  async (reverse) => {
    const types = [
      "application/protobuf",
      "application/protobuf;encoding=json",
    ];
    if (reverse) types.reverse();
    const report = captureWithBody(types[0]!, Buffer.from([8, 1]));
    const record = report.records[0]!;
    record.reported = {
      response: {
        headers: [
          [null, null],
          [null, null],
        ],
        content: null,
      },
    };
    record.binary_fields.push(
      binary("/response/headers/1/0", Buffer.from("Content-Type")),
      binary("/response/headers/1/1", Buffer.from(types[1]!)),
    );
    const retained = structuredClone(record.binary_fields);
    await decode(report);
    expect(report.protobuf_coverage?.status).toBe("partial");
    expect(record.protobuf).toBeUndefined();
    expect(record.limitations).toContainEqual(
      expect.stringContaining(
        "MIME metadata is excluded, conflicting or unavailable",
      ),
    );
    expect(record.binary_fields).toEqual(retained);
  },
);

it.each(["auto", "raw"] as const)(
  "preserves declared gRPC credential exclusions after MIME refusal with %s framing",
  async (framing) => {
    const invalid = 'application/grpc-web;note="unterminated';
    const valid = "application/grpc-web";
    for (const types of [
      [invalid],
      [invalid, invalid],
      [valid, invalid],
      [invalid, valid],
    ]) {
      const report = captureWithBody(
        types[0]!,
        grpcWebTrailerFrame(
          Buffer.from("authorization: Bearer fixture-only\r\n"),
        ),
      );
      const record = report.records[0]!;
      if (types.length === 2) {
        record.reported = {
          response: {
            headers: [
              [null, null],
              [null, null],
            ],
            content: null,
          },
        };
        record.binary_fields.push(
          binary("/response/headers/1/0", Buffer.from("Content-Type")),
          binary("/response/headers/1/1", Buffer.from(types[1]!)),
        );
      }
      const headers = structuredClone(
        record.binary_fields.filter(({ pointer }) =>
          pointer.includes("/headers/"),
        ),
      );
      await decode(report, framing);
      expect(report.protobuf_coverage?.status, types.join(" / ")).toBe(
        "partial",
      );
      expect(record.protobuf).toBeUndefined();
      expect(record.binary_fields[2]).toMatchObject({
        state: "redacted",
        content_base64: null,
        sha256: null,
      });
      expect(record.redactions).toContainEqual({
        pointer: "/response/content",
        reason: "transport-credential",
      });
      expect(
        record.binary_fields.filter(({ pointer }) =>
          pointer.includes("/headers/"),
        ),
      ).toEqual(headers);
    }
  },
);

it.each([
  "application/protobuf; encoding=json",
  "application/protobuf; encoding=unknown",
  "application/protobuf; charset=utf-8",
  "application/protobuf; version=1",
])(
  "keeps illegal reserved MIME profiles undecoded and partial: %s",
  async (contentType) => {
    const report = captureWithBody(contentType, Buffer.from([8, 1]));
    const retained = structuredClone(report.records[0]!.binary_fields);
    await decode(report);
    expect(report.records[0]?.protobuf).toBeUndefined();
    expect(report.protobuf_coverage?.status).toBe("partial");
    expect(report.records[0]?.limitations).toContainEqual(
      expect.stringContaining("MIME profile"),
    );
    expect(report.records[0]?.binary_fields).toEqual(retained);
  },
);
it.each([
  "application/protobuf",
  'application/protobuf; encoding="binary"',
  'application/protobuf; type="example.Message"',
])(
  "admits binary MIME controls and non-encoding parameters: %s",
  async (contentType) => {
    const report = captureWithBody(contentType, Buffer.from([8, 1]));
    await decode(report);
    expect(report.records[0]?.protobuf?.[0]).toMatchObject({
      status: "complete",
      fields: [{ number: 1, value: "1" }],
    });
    expect(report.protobuf_coverage?.status).toBe("complete");
  },
);
it.each([
  {
    bytes: protobufCaptureDescriptor(),
    type: "capture.Missing",
    field: "message_type",
    reason: "invalid_value",
    message: "capture.Missing",
  },
  {
    bytes: Buffer.from([0x08, 0x80]),
    type: "capture.Message",
    field: "descriptor_set_path",
    reason: "invalid_format",
    message: "byte 0",
  },
])(
  "attributes schema admission to $field while preserving selected capture facts",
  async ({ bytes, type, field, reason, message }) => {
    const root = await createTestTempDirectory("rea-schema-admission-");
    const descriptor = join(root, "schema.pb");
    await writeFile(descriptor, bytes);
    const report = captureWithBody("application/protobuf", Buffer.from([8, 1]));
    const retained = structuredClone(report.records);
    const input = inspectWebNetworkCaptureInputSchema.parse({
      capture_path: report.artifact.path,
      format: report.format,
      record_ordinals: [0],
      protobuf: {
        schema: { descriptor_set_path: descriptor, message_type: type },
      },
    });
    const resources = new ArtifactResourceScope();
    try {
      const prepared = await prepareCaptureProtobuf(report, input);
      await expect(
        decodeCaptureProtobuf(report, input, resources, prepared),
      ).rejects.toMatchObject({
        _tag: "AnalysisInputError",
        issues: [
          {
            path: ["protobuf", "schema", field],
            reason,
            message: expect.stringContaining(message),
          },
        ],
      });
      expect(report.records).toEqual(retained);
      expect(report.protobuf_coverage).toMatchObject({
        status: "partial",
        inspected_records: 0,
      });
    } finally {
      await resources.close();
    }
  },
);

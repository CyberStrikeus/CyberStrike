import { z } from "zod";
import { absoluteLocalPathStringSchema } from "./localPath.js";

/** Optional decoding applies only to explicitly selected capture records. */
export const protobufOptionsSchema = z.strictObject({
  framing: z
    .enum(["auto", "raw", "grpc", "grpc-web", "grpc-web-text"])
    .default("auto"),
  body_pointers: z.array(z.string()).optional(),
  schema: z
    .strictObject({
      descriptor_set_path: absoluteLocalPathStringSchema,
      message_type: z.string().min(1),
    })
    .optional(),
});

const index = z.number().int().nonnegative();
const issueSchema = z.strictObject({ offset: index, reason: z.string() });

/** Indices are scoped to the capture artifact, producer ordinal and body pointer. */
export const protobufFieldSchema = z.strictObject({
  index,
  frame_index: index,
  field_id: z.string(),
  parent_field_id: z.string().nullable(),
  parent_index: index.nullable(),
  number: z.number().int().positive().max(0x1fffffff),
  wire_type: z.enum(["varint", "i64", "len", "i32", "group"]),
  offset: index,
  bytes: index,
  payload_offset: index,
  payload_bytes: index,
  value: z.string().exactOptional(),
  text: z.string().exactOptional(),
  interpretations: z
    .array(
      z.enum([
        "utf8-string",
        "nested-message",
        "packed-varint",
        "packed-fixed32",
        "packed-fixed64",
        "bytes",
      ]),
    )
    .exactOptional(),
  schema_name: z.string().exactOptional(),
  schema_type: z.string().exactOptional(),
  schema_value: z.string().exactOptional(),
  schema_enum_values: z
    .array(z.strictObject({ number: z.string(), names: z.array(z.string()) }))
    .exactOptional(),
  schema_status: z
    .enum([
      "decoded",
      "unknown-field",
      "wire-type-mismatch",
      "invalid-message",
      "unsupported",
    ])
    .exactOptional(),
  schema_error: issueSchema.exactOptional(),
});

export const protobufFrameSchema = z.strictObject({
  index,
  kind: z.enum(["data", "trailer"]),
  offset: index,
  payload_offset: index,
  bytes: index,
  compressed: z.boolean(),
  status: z.enum(["complete", "partial", "unknown"]),
  examined_bytes: index,
  error: issueSchema.exactOptional(),
  trailers: z
    .array(z.strictObject({ name: z.string(), value: z.string() }))
    .exactOptional(),
});

/** Flat facts avoid recursive advertised schemas and preserve same-number occurrences. */
export const protobufDecodingObjectSchema = z.strictObject({
  pointer: z.string(),
  content_type: z.string().nullable(),
  decoder: z.literal("rea-protobuf-wire-v1"),
  body_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  framing: z.enum(["raw", "grpc", "grpc-web", "grpc-web-text"]),
  offset_basis: z.enum(["retained-body", "base64-decoded-body"]),
  decoded_bytes: index,
  status: z.enum(["complete", "partial", "unknown"]),
  examined_bytes: index,
  frames: z.array(protobufFrameSchema),
  fields: z.array(protobufFieldSchema),
  error: issueSchema.exactOptional(),
  limitations: z.array(z.string()),
  schema: z
    .strictObject({
      decoder: z.literal("protobuf-es-2.16.0"),
      descriptor_set_path: z.string(),
      descriptor_set_sha256: z.string().regex(/^[0-9a-f]{64}$/),
      descriptor_set_bytes: index,
      message_type: z.string(),
    })
    .exactOptional(),
});
/** Validate coordinate relationships at the owner, before any consumer projects rows. */
export const protobufDecodingSchema = protobufDecodingObjectSchema.superRefine(
  (body, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: "custom", path, message });
    if (body.examined_bytes > body.decoded_bytes)
      issue(["examined_bytes"], "Examined bytes exceed the decoded body");
    if (
      body.status === "complete" &&
      (body.error !== undefined ||
        body.frames.some((frame) => frame.status !== "complete"))
    )
      issue(["status"], "Complete body contradicts frame coverage");
    let expectedOffset = 0;
    for (const [index, frame] of body.frames.entries()) {
      if (
        frame.offset !== expectedOffset ||
        frame.payload_offset !== frame.offset + (body.framing === "raw" ? 0 : 5)
      )
        issue(
          ["frames", index, "offset"],
          "Frames must preserve contiguous protocol ranges",
        );
      expectedOffset = frame.payload_offset + frame.bytes;
      if (
        frame.index !== index ||
        frame.payload_offset < frame.offset ||
        frame.payload_offset + frame.bytes > body.decoded_bytes ||
        frame.examined_bytes > frame.bytes
      )
        issue(
          ["frames", index],
          "Frame identity or range contradicts the body",
        );
      if (
        frame.status === "complete" &&
        (frame.error !== undefined ||
          frame.examined_bytes !== frame.bytes ||
          frame.compressed)
      )
        issue(
          ["frames", index, "status"],
          "Complete frame contradicts decoding coverage",
        );
      if (body.framing === "grpc" && frame.kind === "trailer")
        issue(
          ["frames", index, "kind"],
          "Native gRPC has no in-body trailer frame",
        );
    }
    if (
      body.status === "complete" &&
      (body.examined_bytes !== body.decoded_bytes ||
        expectedOffset !== body.decoded_bytes)
    )
      issue(["status"], "Complete decoding must cover the whole decoded body");
    const ids = new Set<string>();
    for (const [index, field] of body.fields.entries()) {
      const frame = body.frames[field.frame_index];
      if (
        field.index !== index ||
        field.field_id !== `offset:${field.offset}` ||
        ids.has(field.field_id)
      )
        issue(["fields", index], "Field occurrence identity is inconsistent");
      ids.add(field.field_id);
      if (
        frame === undefined ||
        frame.kind !== "data" ||
        field.offset < frame.payload_offset ||
        field.offset + field.bytes > frame.payload_offset + frame.bytes ||
        field.payload_offset < field.offset ||
        field.payload_offset + field.payload_bytes > field.offset + field.bytes
      )
        issue(["fields", index], "Field range contradicts its frame");
      const parent =
        field.parent_index === null
          ? undefined
          : body.fields[field.parent_index];
      if (
        field.parent_index === null
          ? field.parent_field_id !== null
          : parent === undefined ||
            parent.index >= index ||
            parent.field_id !== field.parent_field_id ||
            parent.frame_index !== field.frame_index ||
            field.offset < parent.payload_offset ||
            field.offset + field.bytes >
              parent.payload_offset + parent.payload_bytes
      )
        issue(
          ["fields", index, "parent_field_id"],
          "Field parent contradicts its source range",
        );
    }
  },
);

export type ProtobufDecoding = z.output<typeof protobufDecodingSchema>;
export type ProtobufField = z.output<typeof protobufFieldSchema>;
export type ProtobufFrame = z.output<typeof protobufFrameSchema>;

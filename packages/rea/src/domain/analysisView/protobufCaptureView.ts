import { isImmutableJsonSnapshot } from "../immutableJson.js";
import { z } from "zod";
import {
  protobufDecodingSchema,
  protobufDecodingObjectSchema,
  protobufFieldSchema,
  protobufFrameSchema,
  type ProtobufDecoding,
  type ProtobufField,
} from "../protobufWire.js";
import type { WebNetworkCapture } from "../webNetworkCapture.js";
import { pageViewCoverage } from "./analysisViewCoverage.js";

const body = {
  record_ordinal: z.number().int().nonnegative(),
  body_pointer: z.string(),
  body_sha256: z.string(),
  body_status: protobufDecodingSchema.shape.status,
  offset_basis: protobufDecodingSchema.shape.offset_basis,
};
const bodyRow = protobufDecodingObjectSchema
  .omit({
    pointer: true,
    body_sha256: true,
    offset_basis: true,
    frames: true,
    fields: true,
  })
  .extend({
    ...body,
    frame_count: z.number().int().nonnegative(),
    field_count: z.number().int().nonnegative(),
  });
const frameRow = protobufFrameSchema.extend(body);
const fieldRow = protobufFieldSchema.extend(body);
const page = {
  kind: z.literal("protobuf"),
  record_ordinals: z.array(z.number().int().nonnegative()).optional(),
  body_pointers: z.array(z.string()).optional(),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().default(64),
};

/** Batch selectors intersect; omitted filters select all retained decoding facts. */
export const protobufViewRequestSchema = z.discriminatedUnion("collection", [
  z.strictObject({
    ...page,
    collection: z.literal("bodies"),
    fields: z.array(bodyRow.keyof()).optional(),
  }),
  z.strictObject({
    ...page,
    collection: z.literal("frames"),
    frame_indices: z.array(z.number().int().nonnegative()).optional(),
    fields: z.array(frameRow.keyof()).optional(),
  }),
  z.strictObject({
    ...page,
    collection: z.literal("fields"),
    frame_indices: z.array(z.number().int().nonnegative()).optional(),
    field_ids: z.array(z.string()).optional(),
    field_numbers: z.array(z.number().int().positive()).optional(),
    schema_names: z.array(z.string()).optional(),
    fields: z.array(fieldRow.keyof()).optional(),
  }),
]);
export const protobufViewItemsSchema = z.union([
  z.array(
    bodyRow.partial().required({
      record_ordinal: true,
      body_pointer: true,
      body_sha256: true,
      body_status: true,
      offset_basis: true,
    }),
  ),
  z.array(
    frameRow.partial().required({
      record_ordinal: true,
      body_pointer: true,
      body_sha256: true,
      body_status: true,
      offset_basis: true,
      index: true,
      offset: true,
    }),
  ),
  z.array(
    fieldRow.partial().required({
      record_ordinal: true,
      body_pointer: true,
      body_sha256: true,
      body_status: true,
      offset_basis: true,
      index: true,
      frame_index: true,
      field_id: true,
      parent_field_id: true,
      offset: true,
      payload_offset: true,
      payload_bytes: true,
    }),
  ),
]);
export const protobufViewContextSchema = z.strictObject({
  source_status: z.enum(["complete", "partial", "unknown"]),
  retained_decoded_bodies: z.number().int().nonnegative(),
});
type Request = z.output<typeof protobufViewRequestSchema>;
type Body = { recordOrdinal: number; decoding: ProtobufDecoding };
const checkedBodies = new WeakMap<object, readonly Body[]>();
interface FieldSelection {
  readonly key: string;
  readonly frames: ReadonlySet<number> | undefined;
  readonly ids: ReadonlySet<string> | undefined;
  readonly numbers: ReadonlySet<number> | undefined;
  readonly names: ReadonlySet<string> | undefined;
  readonly rows: WeakMap<object, readonly ProtobufField[]> | undefined;
}
const fieldQueries = new WeakMap<object, FieldSelection>();
const fieldSelection = (
  report: WebNetworkCapture,
  bodies: readonly Body[],
  view: Extract<Request, { collection: "fields" }>,
  reusable: boolean,
): FieldSelection | undefined => {
  if (
    view.frame_indices === undefined &&
    view.field_ids === undefined &&
    view.field_numbers === undefined &&
    view.schema_names === undefined
  )
    return undefined;
  const key = JSON.stringify([
    view.frame_indices,
    view.field_ids,
    view.field_numbers,
    view.schema_names,
  ]);
  const cached = reusable ? fieldQueries.get(report) : undefined;
  if (cached?.key === key) return cached;
  // Selector strings must fit within one 8-byte reference per retained field.
  // One filter per parent avoids multiplying large keys/sets by its body count.
  const referenceBytes = bodies.reduce(
    (sum, body) => sum + body.decoding.fields.length * 8,
    0,
  );
  const cache = reusable && key.length * 2 <= referenceBytes;
  const selection: FieldSelection = {
    key,
    frames:
      view.frame_indices === undefined
        ? undefined
        : new Set(view.frame_indices),
    ids: view.field_ids === undefined ? undefined : new Set(view.field_ids),
    numbers:
      view.field_numbers === undefined
        ? undefined
        : new Set(view.field_numbers),
    names:
      view.schema_names === undefined ? undefined : new Set(view.schema_names),
    rows: cache ? new WeakMap() : undefined,
  };
  if (cache) fieldQueries.set(report, selection);
  return selection;
};
const selectFields = (
  decoding: ProtobufDecoding,
  selection: FieldSelection | undefined,
): readonly ProtobufField[] => {
  if (selection === undefined) return decoding.fields;
  const cached = selection.rows?.get(decoding);
  if (cached !== undefined) return cached;
  const { frames, ids, numbers, names } = selection;
  const rows = decoding.fields.filter(
    (field) =>
      (frames === undefined || frames.has(field.frame_index)) &&
      (ids === undefined || ids.has(field.field_id)) &&
      (numbers === undefined || numbers.has(field.number)) &&
      (names === undefined ||
        (field.schema_name !== undefined && names.has(field.schema_name))),
  );
  selection.rows?.set(decoding, rows);
  return rows;
};

/** Pages select owner-parsed facts; neither payloads nor descriptors are decoded again. */
export const projectProtobufCapturePage = (
  report: WebNetworkCapture,
  view: Request,
) => {
  const reusable = isImmutableJsonSnapshot(report);
  let bodies = reusable ? checkedBodies.get(report) : undefined;
  if (bodies === undefined) {
    bodies = report.records.flatMap((record) =>
      (record.protobuf ?? []).map((decoding) => ({
        recordOrdinal: record.ordinal,
        decoding,
      })),
    );
    if (reusable) checkedBodies.set(report, bodies);
  }
  const selection =
    view.collection === "fields"
      ? fieldSelection(report, bodies, view, reusable)
      : undefined;
  const ordinals =
    view.record_ordinals === undefined
      ? undefined
      : new Set(view.record_ordinals);
  const pointers =
    view.body_pointers === undefined ? undefined : new Set(view.body_pointers);
  const frames =
    "frame_indices" in view && view.frame_indices !== undefined
      ? new Set(view.frame_indices)
      : undefined;
  let total = 0;
  const items: Record<string, unknown>[] = [];
  let sourceStatus: "complete" | "partial" | "unknown" =
    report.protobuf_coverage?.status === "partial"
      ? "partial"
      : bodies.length === 0
        ? "unknown"
        : "complete";
  for (const entry of bodies) {
    const { recordOrdinal, decoding } = entry;
    if (
      (ordinals !== undefined && !ordinals.has(recordOrdinal)) ||
      (pointers !== undefined && !pointers.has(decoding.pointer))
    )
      continue;
    if (decoding.status !== "complete") sourceStatus = "partial";
    const rows =
      view.collection === "bodies"
        ? [decoding]
        : view.collection === "frames"
          ? frames === undefined
            ? decoding.frames
            : decoding.frames.filter((frame) => frames.has(frame.index))
          : selectFields(decoding, selection);
    const from = Math.max(0, view.offset - total);
    const to = Math.min(rows.length, view.offset + view.limit - total);
    for (let index = from; index < to; index++) {
      const source = rows[index]!;
      const row: Record<string, unknown> =
        view.collection === "bodies"
          ? {
              ...decoding,
              frame_count: decoding.frames.length,
              field_count: decoding.fields.length,
            }
          : source;
      const mandatory = [
        "record_ordinal",
        "body_pointer",
        "body_sha256",
        "body_status",
        "offset_basis",
        ...(view.collection === "fields"
          ? [
              "index",
              "frame_index",
              "field_id",
              "parent_field_id",
              "offset",
              "payload_offset",
              "payload_bytes",
            ]
          : view.collection === "frames"
            ? ["index", "offset"]
            : []),
      ];
      const keys =
        view.fields ??
        Object.keys(row).filter(
          (key) =>
            ![
              "frames",
              "fields",
              "pointer",
              "text",
              "schema_value",
              "schema_enum_values",
            ].includes(key),
        );
      const chosen = new Set([...mandatory, ...keys]);
      const projected: Record<string, unknown> = {
        record_ordinal: recordOrdinal,
        body_pointer: decoding.pointer,
        body_sha256: decoding.body_sha256,
        body_status: decoding.status,
        offset_basis: decoding.offset_basis,
      };
      for (const key of keys)
        if (
          chosen.has(key) &&
          Object.hasOwn(row, key) &&
          !["frames", "fields", "pointer"].includes(key)
        )
          projected[key] = row[key];
      for (const key of mandatory)
        if (Object.hasOwn(row, key)) projected[key] = row[key];
      items.push(projected);
    }
    total += rows.length;
  }
  return {
    kind: "protobuf" as const,
    view,
    items: protobufViewItemsSchema.parse(items),
    source_status: sourceStatus,
    retained_decoded_bodies: bodies.length,
    coverage: pageViewCoverage(view.offset, items.length, total),
  };
};

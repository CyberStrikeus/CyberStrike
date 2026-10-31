import { z } from "zod";

const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/u);
const unsignedFact = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("reported"), value: decimal }),
  z.strictObject({
    state: z.literal("unknown"),
    reason: z.literal("omitted-null-or-redacted"),
  }),
]);
const traceLocation = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("json-pointer"), pointer: z.string() }),
  z.strictObject({
    kind: z.literal("unknown"),
    reason: z.literal("explicit-sensitive-value"),
  }),
]);

/** Exact, source-bound transport facts; coverage never establishes network completeness. */
export const qlogCaptureFactsSchema = z.strictObject({
  profile: z.literal("aioquic-1.5.0-json-0.3"),
  scope: z.literal("all-recorded-events-before-selection"),
  body_bytes: z.literal("not-reported"),
  clock: z.strictObject({
    unit: z.literal("milliseconds"),
    domain: z.literal("unix-epoch"),
    basis: z.literal("selected-aioquic-profile-not-producer-authentication"),
  }),
  traces: z.array(
    z.strictObject({
      trace_index: z.int().nonnegative(),
      location: traceLocation,
      event_count: z.int().nonnegative(),
      odcid: z.string().nullable(),
      vantage_point: z.enum(["client", "server"]).nullable(),
      incomplete_fact_records: z.array(z.int().nonnegative()),
      loss_declarations: z.array(
        z.strictObject({
          record_ordinal: z.int().nonnegative(),
          confidence: z.literal("observed"),
          packet_number: unsignedFact,
          packet_type: z.string().nullable(),
          packet_number_space: z
            .enum(["initial", "handshake", "application"])
            .nullable(),
        }),
      ),
      streams: z.array(
        z.strictObject({
          stream_id: decimal,
          direction: z.enum(["sent", "received"]),
          confidence: z.literal("derived"),
          scope: z.literal("observed-stream-frame-ranges"),
          contributions: z.array(
            z.strictObject({
              record_ordinal: z.int().nonnegative(),
              frame_index: z.int().nonnegative(),
              offset: decimal,
              length: decimal,
              fin: z.boolean().nullable(),
            }),
          ),
          covered_ranges: z.array(
            z.strictObject({ start: decimal, end: decimal }),
          ),
          unique_bytes: decimal,
          frame_length_sum: decimal,
          repeated_bytes: decimal,
          reported_final_sizes: z.array(decimal),
        }),
      ),
    }),
  ),
});

export type QlogCaptureFacts = z.output<typeof qlogCaptureFactsSchema>;

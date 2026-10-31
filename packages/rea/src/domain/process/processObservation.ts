import { z } from "zod";

import { jsonValueSchema, type JsonValue } from "../jsonValue.js";
import type {
  TerminalFrame,
  UnverifiedProcessCapture,
} from "./processCapture.js";

/** Project normalized PTY facts without source text used only for audit. */
export const comparableTerminalFrame = (frame: TerminalFrame) => ({
  sequence: frame.sequence,
  at_ms: frame.at_ms,
  data: frame.data,
});

/** Process-capture observation families shared by live drivers and trace assertions. */
export const processObservationSourceSchema = z.enum([
  "terminal_raw",
  "terminal_rendered",
  "interaction",
  "lifecycle",
  "process",
  "filesystem",
]);
export type ProcessObservationSource = z.infer<
  typeof processObservationSourceSchema
>;

/** Stable raw-record location within one Process Capture observation journal. */
export const processObservationLocationSchema = z.strictObject({
  collection: z.enum([
    "frames",
    "rendered_frames",
    "interaction_events",
    "lifecycle",
    "process_samples",
    "filesystem_checkpoints",
  ]),
  index: z.int().nonnegative(),
  capture_order: z.int().nonnegative(),
});
export type ProcessObservationLocation = z.infer<
  typeof processObservationLocationSchema
>;

/** Provider-neutral event projected into an offline trace assertion. */
export interface ProcessObservation {
  readonly event_id: string;
  readonly source: ProcessObservationSource;
  readonly source_sequence: number;
  readonly capture_order: number;
  readonly captured_at_ms: number | null;
  readonly subject_id: string | null;
  readonly location: ProcessObservationLocation;
  readonly payload: JsonValue;
}

/** Input used by live producers to construct the same observation shape. */
export interface ProcessObservationInput {
  readonly source: ProcessObservationSource;
  readonly source_sequence: number;
  readonly captured_at_ms: number | null;
  readonly subject_id: string | null;
  readonly location: ProcessObservationLocation;
  readonly payload: unknown;
}

/** Remove only explicitly declared top-level volatile fields before matching. */
export const comparableProcessObservationPayload = (
  value: unknown,
  ignoredFields: readonly string[] = [],
): unknown => {
  if (
    ignoredFields.length === 0 ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  )
    return value;
  return Object.fromEntries(
    Object.entries(value).filter(([name]) => !ignoredFields.includes(name)),
  );
};

/** Construct a validated observation from one live producer record. */
export const createProcessObservation = (
  input: ProcessObservationInput,
): ProcessObservation => ({
  event_id: `obs.${input.location.collection}.${String(input.location.index)}`,
  source: input.source,
  source_sequence: input.source_sequence,
  capture_order: input.location.capture_order,
  captured_at_ms: input.captured_at_ms,
  subject_id: input.subject_id,
  location: input.location,
  payload: jsonValueSchema.parse(input.payload),
});

type ProjectedRecord = Omit<
  ProcessObservation,
  "event_id" | "source_sequence" | "capture_order" | "location"
>;

const atMilliseconds = (value: unknown): number | null => {
  if (typeof value !== "object" || value === null) return null;
  if ("at_ms" in value && isSafeMillisecond(value.at_ms)) return value.at_ms;
  if ("dispatched_at_ms" in value && isSafeMillisecond(value.dispatched_at_ms))
    return value.dispatched_at_ms;
  return null;
};

const isSafeMillisecond = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

/** Derive the stable capture-local identity for one normalized observation. */
export const processObservationSubject = (
  source: ProcessObservationSource,
  value: unknown,
): string | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  if (source === "process" && "pid" in value && typeof value.pid === "number")
    return `process:${String(value.pid)}`;
  if (
    source === "filesystem" &&
    "name" in value &&
    typeof value.name === "string"
  )
    return `checkpoint:${value.name}`;
  return null;
};

const projectedRecord = (
  capture: UnverifiedProcessCapture,
  location: ProcessObservationLocation,
): ProjectedRecord | null => {
  const projected = (() => {
    switch (location.collection) {
      case "frames": {
        const frame = capture.frames[location.index];
        return {
          source: "terminal_raw" as const,
          value:
            frame === undefined ? undefined : comparableTerminalFrame(frame),
        };
      }
      case "rendered_frames":
        return {
          source: "terminal_rendered" as const,
          value: capture.rendered_frames[location.index],
        };
      case "interaction_events":
        return {
          source: "interaction" as const,
          value: capture.interaction_events[location.index],
        };
      case "lifecycle":
        return location.index === 0
          ? {
              source: "lifecycle" as const,
              value: { event: "exit", ...capture.exit },
            }
          : location.index === 1
            ? {
                source: "lifecycle" as const,
                value: { event: "settlement", ...capture.settlement },
              }
            : null;
      case "process_samples":
        return {
          source: "process" as const,
          value: capture.process_samples[location.index],
        };
      case "filesystem_checkpoints":
        return {
          source: "filesystem" as const,
          value: capture.filesystem_checkpoints[location.index],
        };
    }
  })();
  if (projected === null || projected.value === undefined) return null;
  const payload = jsonValueSchema.parse(projected.value);
  return {
    source: projected.source,
    captured_at_ms: atMilliseconds(payload),
    subject_id: processObservationSubject(projected.source, payload),
    payload,
  };
};

/** Project one validated capture-journal reference into the shared observation shape. */
export const projectProcessObservation = (
  capture: UnverifiedProcessCapture,
  location: ProcessObservationLocation,
): ProcessObservation | null => {
  const projected = projectedRecord(capture, location);
  if (projected === null) return null;
  return createProcessObservation({
    source: projected.source,
    source_sequence: location.index,
    captured_at_ms: projected.captured_at_ms,
    subject_id: projected.subject_id,
    location,
    payload: projected.payload,
  });
};

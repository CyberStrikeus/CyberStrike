import { LosslessNumber } from "lossless-json";
import type { JsonValue } from "../../domain/jsonValue.js";
import type { QlogCaptureFacts } from "../../domain/qlogCapture.js";
import {
  webNetworkCapturePayloadSchema,
  type WebNetworkCaptureRecord,
} from "../../domain/webNetworkCapture.js";
import type { z } from "zod";
import { parseCaptureJson } from "./CaptureJson.js";
import { CaptureFormatError } from "./CaptureFormatError.js";
import {
  CaptureRedaction,
  captureObject,
  capturePointer,
  isCaptureCredentialHeader,
} from "./CaptureRedaction.js";
import { QLOG_CAPTURE_PROVIDER_IDENTITY } from "./CaptureRelease.js";

const MAX_VARINT = (1n << 62n) - 1n;
type Projection = Pick<
  WebNetworkCaptureRecord,
  "reported" | "numeric_literals" | "binary_fields" | "redactions"
>;
type Trace = QlogCaptureFacts["traces"][number];
type Stream = Trace["streams"][number];

/** Inspect the selected aioquic JSON profile without authenticating its producer or interpreting other qlog layouts. */
export const decodeQlogCapture = (
  text: string,
  sensitiveValues: readonly string[],
): z.output<typeof webNetworkCapturePayloadSchema> => {
  const raw = parseCaptureJson(text, "qlog");
  if (!object(raw) || raw.qlog_format !== "JSON" || raw.qlog_version !== "0.3")
    throw new CaptureFormatError(
      "unsupported",
      "Only the aioquic 1.5.0 JSON qlog 0.3 profile is supported.",
    );
  if (!Array.isArray(raw.traces))
    return invalid("qlog must contain a traces array.", "/traces");
  const traces = raw.traces.map(validateTrace);
  const container = project(
    { ...raw, traces: traces.map((trace) => ({ ...trace, events: null })) },
    sensitiveValues,
  );
  const records: WebNetworkCaptureRecord[] = [];
  const facts: Trace[] = [];
  const excluded = (value: string): boolean =>
    sensitiveValues.some((literal) => value.includes(literal));
  const ancestorsHidden = excluded("traces") || excluded("events");
  for (const [traceIndex, trace] of traces.entries()) {
    const tracePointer = `/traces/${traceIndex}`;
    const fact = createTraceFact(
      trace,
      traceIndex,
      sensitiveValues,
      ancestorsHidden,
    );
    const streams = new Map<string, Stream>();
    for (const [eventIndex, event] of trace.events.entries()) {
      const ordinal = records.length;
      const projection: Projection = ancestorsHidden
        ? {
            reported: null,
            numeric_literals: [],
            binary_fields: [],
            redactions: [{ pointer: "", reason: "explicit-sensitive-value" }],
          }
        : project(event, sensitiveValues);
      records.push({
        ordinal,
        location: ancestorsHidden
          ? { kind: "unknown", reason: "explicit-sensitive-value" }
          : {
              kind: "json-pointer",
              pointer: `${tracePointer}/events/${eventIndex}`,
            },
        ...projection,
        limitations: [
          "Record ordinal is derived from trace/event source traversal, not global time order. Qlog lengths and FIN do not expose original HTTP body bytes or establish network completeness.",
        ],
      });
      collectTransportFacts(projection, ordinal, {
        fact,
        streams,
        excluded,
        name: object(event) && typeof event.name === "string" ? event.name : "",
      });
    }
    for (const stream of streams.values()) {
      summarizeStream(stream);
      const numericValues = [
        stream.frame_length_sum,
        stream.unique_bytes,
        stream.repeated_bytes,
        ...stream.reported_final_sizes,
        ...stream.covered_ranges.flatMap((r) => [r.start, r.end]),
      ];
      // A stream can have more contributions than call arguments allow.
      if (numericValues.some(excluded))
        for (const contribution of stream.contributions)
          fact.incomplete_fact_records.push(contribution.record_ordinal);
      else fact.streams.push(stream);
    }
    fact.incomplete_fact_records = [...new Set(fact.incomplete_fact_records)];
    facts.push(fact);
  }
  return {
    decoder: { ...QLOG_CAPTURE_PROVIDER_IDENTITY },
    container: {
      reported: container.reported,
      numeric_literals: container.numeric_literals,
      redactions: container.redactions,
      records_pointer: null,
    },
    total_records: records.length,
    records,
    qlog: {
      profile: "aioquic-1.5.0-json-0.3",
      scope: "all-recorded-events-before-selection",
      body_bytes: "not-reported",
      clock: {
        unit: "milliseconds",
        domain: "unix-epoch",
        basis: "selected-aioquic-profile-not-producer-authentication",
      },
      traces: facts,
    },
  };
};

const createTraceFact = (
  trace: Record<string, unknown> & { events: unknown[] },
  traceIndex: number,
  sensitiveValues: readonly string[],
  ancestorsHidden: boolean,
): Trace => {
  const tracePointer = `/traces/${traceIndex}`;
  const metadata = project(
    { ...trace, events: null },
    sensitiveValues,
  ).reported;
  const meta = !ancestorsHidden && object(metadata) ? metadata : null;
  const common =
    meta !== null && object(meta.common_fields) ? meta.common_fields : null;
  const vantage =
    meta !== null && object(meta.vantage_point)
      ? meta.vantage_point.type
      : null;
  return {
    trace_index: traceIndex,
    location: ancestorsHidden
      ? { kind: "unknown", reason: "explicit-sensitive-value" }
      : { kind: "json-pointer", pointer: tracePointer },
    event_count: trace.events.length,
    odcid: typeof common?.ODCID === "string" ? common.ODCID : null,
    vantage_point:
      vantage === "client" || vantage === "server" ? vantage : null,
    loss_declarations: [],
    streams: [],
    incomplete_fact_records: [],
  };
};

const validateTrace = (
  trace: unknown,
  index: number,
): Record<string, unknown> & { events: unknown[] } => {
  const pointer = `/traces/${index}`;
  if (!object(trace) || !Array.isArray(trace.events))
    return invalid("qlog trace must contain an events array.", pointer);
  for (const [eventIndex, event] of trace.events.entries()) {
    const eventPointer = `${pointer}/events/${eventIndex}`;
    if (
      !object(event) ||
      typeof event.name !== "string" ||
      !(event.time instanceof LosslessNumber) ||
      !Number.isFinite(Number(event.time.value)) ||
      !object(event.data)
    )
      invalid(
        "qlog events must be objects with name, finite numeric time and object data.",
        eventPointer,
      );
    // Validate interpretable fields on ORIGINAL values even when a declaration
    // subsequently hides them. Missing fields remain meaningful unknowns.
    if (event.name === "recovery:packet_lost")
      unsigned(event.data.packet_number, `${eventPointer}/data/packet_number`);
    if (packetEvent(event.name) && Array.isArray(event.data.frames)) {
      for (const [frameIndex, frame] of event.data.frames.entries()) {
        if (object(frame) && frame.frame_type === "stream") {
          validateStreamFrame(
            frame,
            `${eventPointer}/data/frames/${frameIndex}`,
          );
        }
      }
    }
  }
  return { ...trace, events: trace.events };
};

const validateStreamFrame = (
  frame: Record<string, unknown>,
  p: string,
): void => {
  unsigned(frame.stream_id, `${p}/stream_id`);
  const offset = unsigned(frame.offset, `${p}/offset`);
  const length = unsigned(frame.length, `${p}/length`);
  if (offset !== null && length !== null && offset + length > MAX_VARINT)
    invalid("qlog stream final offset exceeds the QUIC varint range.", p);
  if (
    frame.fin !== undefined &&
    frame.fin !== null &&
    typeof frame.fin !== "boolean"
  )
    invalid("qlog STREAM fin must be boolean when reported.", `${p}/fin`);
};

const collectTransportFacts = (
  projection: Projection,
  ordinal: number,
  state: {
    fact: Trace;
    streams: Map<string, Stream>;
    excluded: (value: string) => boolean;
    /** Validated source event name, before declarations are applied. */
    name: string;
  },
): void => {
  const { fact, streams, excluded, name } = state;
  // Unknown event payloads carry no facts under this interpretation profile.
  // Their omission cannot make the transport-fact inventory incomplete.
  if (name !== "recovery:packet_lost" && !packetEvent(name)) return;
  if (!object(projection.reported) || !object(projection.reported.data)) {
    fact.incomplete_fact_records.push(ordinal);
    return;
  }
  const visible = projection.reported;
  // Facts are selected by event name, so a declaration that hides the name
  // of a loss or packet event omits its facts like any other hidden field.
  if (visible.name !== name) {
    fact.incomplete_fact_records.push(ordinal);
    return;
  }
  const data = visible.data;
  if (!object(data)) return;
  const literals = new Map(
    projection.numeric_literals.map((n) => [n.pointer, n.literal]),
  );
  const read = (value: unknown, pointer: string): bigint | null => {
    const literal = literals.get(pointer);
    const number = unsigned(
      literal === undefined ? value : new LosslessNumber(literal),
      pointer,
    );
    return number !== null && excluded(number.toString()) ? null : number;
  };
  if (visible.name === "recovery:packet_lost") {
    fact.loss_declarations.push(lossDeclaration(data, ordinal, read));
  }
  if (!packetEvent(visible.name)) return;
  if (!Array.isArray(data.frames)) {
    fact.incomplete_fact_records.push(ordinal);
    return;
  }
  for (const [frameIndex, frame] of data.frames.entries()) {
    if (
      !object(frame) ||
      frame.frame_type === undefined ||
      frame.frame_type === null
    ) {
      fact.incomplete_fact_records.push(ordinal);
      continue;
    }
    if (frame.frame_type !== "stream") continue;
    const p = `/data/frames/${frameIndex}`;
    const id = read(frame.stream_id, `${p}/stream_id`),
      offset = read(frame.offset, `${p}/offset`),
      length = read(frame.length, `${p}/length`);
    if (id === null || offset === null || length === null) {
      fact.incomplete_fact_records.push(ordinal);
      continue;
    }
    const direction =
      visible.name === "transport:packet_sent" ? "sent" : "received";
    const key = `${direction}/${id}`;
    let stream = streams.get(key);
    if (stream === undefined) {
      stream = {
        stream_id: id.toString(),
        direction,
        confidence: "derived",
        scope: "observed-stream-frame-ranges",
        contributions: [],
        covered_ranges: [],
        unique_bytes: "0",
        frame_length_sum: "0",
        repeated_bytes: "0",
        reported_final_sizes: [],
      };
      streams.set(key, stream);
    }
    stream.contributions.push({
      record_ordinal: ordinal,
      frame_index: frameIndex,
      offset: offset.toString(),
      length: length.toString(),
      fin: typeof frame.fin === "boolean" ? frame.fin : null,
    });
    if (typeof frame.fin !== "boolean")
      fact.incomplete_fact_records.push(ordinal);
  }
};

const lossDeclaration = (
  data: Record<string, unknown>,
  ordinal: number,
  read: (value: unknown, pointer: string) => bigint | null,
): Trace["loss_declarations"][number] => {
  const pn = read(data.packet_number, "/data/packet_number");
  const type = typeof data.type === "string" ? data.type : null;
  return {
    record_ordinal: ordinal,
    confidence: "observed",
    packet_number:
      pn === null
        ? {
            state: "unknown",
            reason: "omitted-null-or-redacted",
          }
        : { state: "reported", value: pn.toString() },
    packet_type: type,
    packet_number_space:
      type === "initial"
        ? "initial"
        : type === "handshake"
          ? "handshake"
          : type === "0RTT" || type === "1RTT"
            ? "application"
            : null,
  };
};

const summarizeStream = (stream: Stream): void => {
  const spans = stream.contributions
    .map(
      (c) => [BigInt(c.offset), BigInt(c.offset) + BigInt(c.length)] as const,
    )
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const merged: { start: bigint; end: bigint }[] = [];
  for (const [start, end] of spans) {
    if (start === end) continue;
    const last = merged.at(-1);
    if (last !== undefined && start <= last.end)
      last.end = end > last.end ? end : last.end;
    else merged.push({ start, end });
  }
  const sum = stream.contributions.reduce((s, c) => s + BigInt(c.length), 0n);
  const unique = merged.reduce((s, r) => s + r.end - r.start, 0n);
  stream.covered_ranges = merged.map((r) => ({
    start: r.start.toString(),
    end: r.end.toString(),
  }));
  stream.frame_length_sum = sum.toString();
  stream.unique_bytes = unique.toString();
  stream.repeated_bytes = (sum - unique).toString();
  stream.reported_final_sizes = [
    ...new Set(
      stream.contributions
        .filter((c) => c.fin === true)
        .map((c) => (BigInt(c.offset) + BigInt(c.length)).toString()),
    ),
  ];
};

const packetEvent = (name: unknown): boolean =>
  name === "transport:packet_sent" || name === "transport:packet_received";
const object = (value: unknown): value is Record<string, unknown> =>
  captureObject(value) && !(value instanceof LosslessNumber);
const invalid = (message: string, pointer: string): never => {
  throw new CaptureFormatError("format", message, pointer);
};

/** Canonicalize JSON integer notation exactly, checking expansion before allocation. */
const unsigned = (value: unknown, pointer: string): bigint | null => {
  if (value === undefined || value === null) return null;
  const literal =
    value instanceof LosslessNumber
      ? value.value
      : typeof value === "number"
        ? String(value)
        : "";
  const m = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/u.exec(
    literal,
  );
  if (m === null)
    return invalid("qlog QUIC integer must be a JSON number.", pointer);
  const digits = `${m[2]}${m[3] ?? ""}`.replace(/^0+/u, "");
  if (digits === "") return 0n;
  const exponent = m[4] === undefined ? 0 : Number(m[4]);
  const shift = exponent - (m[3]?.length ?? 0);
  const count = digits.length + shift;
  if (m[1] === "-" || !Number.isSafeInteger(shift) || count > 19 || count <= 0)
    return invalid(
      "qlog QUIC integer is negative, fractional or outside the 62-bit range.",
      pointer,
    );
  if (shift < 0 && /[1-9]/u.test(digits.slice(count)))
    return invalid("qlog QUIC integer is fractional.", pointer);
  const canonical =
    shift < 0 ? digits.slice(0, count) : digits + "0".repeat(shift);
  const result = BigInt(canonical);
  if (result > MAX_VARINT)
    return invalid("qlog QUIC integer exceeds the 62-bit range.", pointer);
  return result;
};

/** Preserve JSON values/lexemes and structurally exclude only transport credentials and declared values. */
const project = (
  value: unknown,
  sensitiveValues: readonly string[],
): Projection => {
  const redactor = new CaptureRedaction(sensitiveValues);
  const numeric_literals: Projection["numeric_literals"] = [];
  const eventName = object(value) ? value.name : null;
  const visit = (
    item: unknown,
    pointer: string,
    parent?: Record<string, unknown>,
  ): JsonValue => {
    const header =
      (eventName === "http:frame_created" ||
        eventName === "http:frame_parsed") &&
      /^\/data\/frame\/headers\/\d+\/value$/u.test(pointer) &&
      typeof parent?.name === "string";
    if (
      (header && isCaptureCredentialHeader(String(parent?.name))) ||
      qlogToken(eventName, pointer, parent)
    )
      return redactor.credential(pointer);
    if (item instanceof LosslessNumber) {
      const number = redactor.number(item, pointer);
      if (number === null) return null;
      numeric_literals.push({
        pointer,
        producer_type: "json-number",
        literal: number.literal,
      });
      return number.reported;
    }
    if (typeof item === "string")
      return redactor.text(
        item,
        pointer,
        header &&
          ["location", "referer", "origin"].includes(
            String(parent?.name).toLowerCase(),
          )
          ? {}
          : undefined,
      );
    if (item === null || typeof item === "boolean") return item;
    if (Array.isArray(item))
      return item.map((child, index) =>
        visit(child, capturePointer(pointer, String(index))),
      );
    if (object(item))
      return Object.fromEntries(
        Object.entries(item).flatMap(([key, child]) => {
          if (sensitiveValues.some((literal) => key.includes(literal))) {
            redactor.redactions.push({
              pointer,
              reason: "explicit-sensitive-value",
              scope: "property-name",
            });
            return [];
          }
          return [[key, visit(child, capturePointer(pointer, key), item)]];
        }),
      );
    return invalid("qlog parser returned a non-JSON value.", pointer);
  };
  return {
    reported: visit(value, ""),
    numeric_literals,
    binary_fields: [],
    redactions: redactor.redactions,
  };
};

const qlogToken = (
  eventName: unknown,
  pointer: string,
  parent?: Record<string, unknown>,
): boolean => {
  if (
    packetEvent(eventName) &&
    /^\/data\/frames\/\d+\/reset_token$/u.test(pointer) &&
    parent?.frame_type === "new_connection_id"
  )
    return true;
  if (
    packetEvent(eventName) &&
    /^\/data\/frames\/\d+\/token$/u.test(pointer) &&
    parent?.frame_type === "new_token"
  )
    return true;
  if (
    eventName === "transport:parameters_set" &&
    pointer === "/data/stateless_reset_token"
  )
    return true;
  return false;
};

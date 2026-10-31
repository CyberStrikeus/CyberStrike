import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";

const corpus = JSON.parse(
  await readFile(new URL("./corpus.json", import.meta.url), "utf8"),
);

export const SIGNAL_ARTIFACTS = {
  "sigrok-uart-max3232e.sr": {
    kind: "uart",
    decoders: "uart:rx=MAX3232E DOUT1:baudrate=57600:format=hex:invert_rx=yes",
    annotations: "uart=rx-data",
    query: "rx-data",
    firstPage: 32,
  },
  "sigrok-i2c-nunchuk.sr": {
    kind: "i2c",
    decoders: "i2c:scl=SCL:sda=SDA",
    annotations: "i2c=data-read",
    query: "data-read",
    firstPage: 9,
  },
};

export function signalRequest(artifact, path, selection) {
  const descriptor = SIGNAL_ARTIFACTS[artifact];
  if (!descriptor) throw new Error("Unknown fixed signal question");
  return {
    path,
    decoders: descriptor.decoders,
    input_format: null,
    annotations: selection === "baseline" ? null : descriptor.annotations,
    line_offset: 0,
    line_limit: selection === "pages" ? descriptor.firstPage : null,
  };
}

export function signalDataRows(kind, text) {
  const pattern =
    kind === "uart"
      ? /^(\d+)-(\d+) uart-1: ([0-9A-F]{2})$/
      : /^(\d+)-(\d+) i2c-1: Data read: ([0-9A-F]{2})$/;
  const rows = [];
  for (const line of text.split("\n")) {
    const match = pattern.exec(line);
    if (!match) continue;
    const start = Number(match[1]),
      end = Number(match[2]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end
    )
      throw new Error("Unsupported decoded sample interval");
    rows.push({ start, end, byte: Number.parseInt(match[3], 16) });
  }
  return rows;
}

export function signalFacts(kind, rows) {
  if (kind === "uart") return { kind, bytes: rows.map((row) => row.byte) };
  if (kind !== "i2c" || rows.length !== 18)
    throw new Error(
      "The fixed I2C question requires three complete six-byte reads",
    );
  return {
    kind,
    reads: [0, 6, 12].map((offset) =>
      rows.slice(offset, offset + 6).map((row) => row.byte),
    ),
  };
}

export function verifySignalOracleIdentity(artifact, oracle) {
  const pinned = corpus.artifacts.find((entry) => entry.id === artifact);
  if (
    !pinned ||
    oracle.kind !== SIGNAL_ARTIFACTS[artifact]?.kind ||
    oracle.sha256 !== pinned.sha256
  )
    throw new Error(
      "Independent oracle does not identify the pinned signal corpus",
    );
}

export function verifySignalRows(kind, rows, oracle, digest) {
  const expected =
    kind === "uart"
      ? oracle.rows
      : oracle.reads.flatMap((read) =>
          read.bytes.slice(1).map((byte, index) => ({
            ...byte,
            after_previous: read.bytes[index].last_clock,
            before_next: read.bytes[index + 2]?.first_clock ?? read.stop,
          })),
        );
  if (
    oracle.kind !== kind ||
    oracle.sha256 !== digest ||
    rows.length !== expected.length
  )
    throw new Error(
      "Signal observations differ from independent sample identity/coverage",
    );
  for (let index = 0; index < rows.length; index++) {
    const observed = rows[index],
      raw = expected[index];
    if (
      observed.byte !== raw.byte ||
      observed.start < 0 ||
      observed.end >= oracle.total_samples
    )
      throw new Error("Decoded data differs from independent sample bits");
    if (
      kind === "uart"
        ? !Number.isSafeInteger(raw.first_data_sample) ||
          !Number.isSafeInteger(raw.last_data_sample) ||
          observed.start < raw.start ||
          observed.end >= raw.end_exclusive ||
          observed.start > raw.first_data_sample ||
          observed.end < raw.last_data_sample
        : !Number.isSafeInteger(raw.after_previous) ||
          !Number.isSafeInteger(raw.before_next) ||
          observed.start <= raw.after_previous ||
          observed.end >= raw.before_next ||
          observed.start > raw.first_clock ||
          observed.end < raw.last_clock
    )
      throw new Error(
        "Decoded interval does not identify the independently read byte",
      );
  }
}

export async function measureSignalEntry({
  values,
  call,
  inputSha,
  catalogDefinitions,
}) {
  const descriptor = SIGNAL_ARTIFACTS[values.artifact];
  const runtime = (file) =>
    pathToFileURL(resolve(values["runtime-root"], file)).href;
  const { parseEvidence } = await import(runtime("dist/domain/evidence.js"));
  const { decodeSignalRecordingInputSchema, signalRecordingSchema } =
    await import(runtime("dist/domain/signals/signalRecording.js"));
  const { inspectSignalDecodersInputSchema, signalDecodersSchema } =
    await import(runtime("dist/domain/signals/signalDecoders.js"));
  const observations = [];
  const checked = (evidence, operation, input, schema) => {
    parseEvidence(evidence);
    const report = schema.parse(evidence.normalized_result);
    if (
      evidence.operation !== operation ||
      !isDeepStrictEqual(evidence.parameters, input) ||
      !isDeepStrictEqual(report.selection, input)
    )
      throw new Error(
        "Signal Evidence differs from the actual requested operation or choices",
      );
    if (
      operation === "decode_signal_recording"
        ? evidence.subject?.local_path !== values.path ||
          evidence.subject?.digest?.sha256 !== inputSha ||
          report.artifact.path !== values.path ||
          report.artifact.sha256 !== inputSha
        : evidence.subject?.local_path !== report.tool.path ||
          evidence.subject?.digest?.sha256 !== report.tool.sha256
    )
      throw new Error(
        "Signal Evidence identifies different recording/tool bytes",
      );
    observations.push({
      evidence_id: evidence.evidence_id,
      operation,
      selection: report.selection,
      output_window: report.output_window,
      limitations: evidence.limitations,
    });
    return report;
  };
  const selection = values["signal-selection"];
  for (const name of [
    "decode_signal_recording",
    ...(selection === "discovery" ? ["inspect_signal_decoders"] : []),
  ])
    if (!catalogDefinitions.has(name))
      throw new Error(`Missing live signal contract ${name}`);
  if (selection === "discovery") {
    const input = inspectSignalDecodersInputSchema.parse({
      decoder: descriptor.kind,
      query: descriptor.query,
      limit: 5,
    });
    const report = checked(
      await call("inspect_signal_decoders", input),
      "inspect_signal_decoders",
      input,
      signalDecodersSchema,
    );
    if (!report.help_lines.some((line) => line.text.includes(descriptor.query)))
      throw new Error(
        "Installed decoder help does not establish the selected annotation class",
      );
  }
  const input = decodeSignalRecordingInputSchema.parse(
    signalRequest(values.artifact, values.path, selection),
  );
  const first = checked(
    await call("decode_signal_recording", input),
    "decode_signal_recording",
    input,
    signalRecordingSchema,
  );
  let rows = signalDataRows(descriptor.kind, first.annotations_text);
  if (selection === "pages") {
    const nextInput = decodeSignalRecordingInputSchema.parse({
      ...input,
      line_offset: descriptor.firstPage,
      line_limit: null,
    });
    const next = checked(
      await call("decode_signal_recording", nextInput),
      "decode_signal_recording",
      nextInput,
      signalRecordingSchema,
    );
    const repeated = checked(
      await call("decode_signal_recording", input),
      "decode_signal_recording",
      input,
      signalRecordingSchema,
    );
    if (
      first.annotations_text !== repeated.annotations_text ||
      !isDeepStrictEqual(first.output_window, repeated.output_window) ||
      first.output_window.total_lines !== next.output_window.total_lines
    )
      throw new Error("Repeated/next display pages changed observation scope");
    rows = [...rows, ...signalDataRows(descriptor.kind, next.annotations_text)];
  }
  const { stdout } = await promisify(execFile)(
    "python3",
    [
      fileURLToPath(new URL("./signal-oracle.py", import.meta.url)),
      descriptor.kind,
      values.path,
      ...(descriptor.kind === "uart" ? ["--invert"] : []),
    ],
    { timeout: 30_000, maxBuffer: 256 * 1024 },
  );
  const oracle = JSON.parse(stdout);
  verifySignalOracleIdentity(values.artifact, oracle);
  verifySignalRows(descriptor.kind, rows, oracle, inputSha);
  return {
    artifact_sha256: inputSha,
    facts: signalFacts(descriptor.kind, rows),
    delivery_observations: observations,
    evidence_ids: [...new Set(observations.map((item) => item.evidence_id))],
  };
}

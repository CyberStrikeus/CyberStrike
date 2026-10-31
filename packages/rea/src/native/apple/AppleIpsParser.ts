import {
  APPLE_IPS_IMAGE_SOURCE_MEANING,
  APPLE_IPS_IMAGE_SOURCES,
  type AppleIps,
  type AppleIpsFrame,
  type AppleIpsImage,
  type AppleIpsImageSource,
  type AppleIpsThread,
  type InspectAppleIpsInput,
} from "../../domain/native/appleIps.js";
import { AppleIpsFormatFailure } from "./AppleIps.errors.js";
import { classify } from "./AppleIpsClassification.js";
import { FieldReader } from "./AppleIpsFieldReader.js";
import {
  consumeJson,
  ipsBodyShape,
  IPS_METADATA_SHAPE,
} from "./AppleIpsJsonShape.js";
import type { LosslessJson } from "./losslessJson.js";

type Artifact = AppleIps["artifact"];

const ZERO_UUID = "00000000000000000000000000000000";
const recordedUuidPattern =
  /^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/u;
const IPS_LIMITATIONS = [
  "Rows reproduce the selected .ips JSON; they do not establish that the process still exists or that a live kernel agrees with the recorded state.",
  "Opened Mach-O and dSYM UUID joins remain unobserved.",
  "Symbol names printed inside the report are recorded claims and are not verified.",
];

const utf8 = new TextDecoder("utf-8", { fatal: true });

const canonicalUuid = (
  raw: string | null,
): { uuid: string | null; unknown: boolean; malformed: boolean } => {
  if (raw === null) return { uuid: null, unknown: true, malformed: false };
  if (!recordedUuidPattern.test(raw))
    return { uuid: null, unknown: true, malformed: true };
  const hex = raw.replaceAll("-", "").toUpperCase();
  if (hex === ZERO_UUID) return { uuid: null, unknown: true, malformed: false };
  return {
    uuid: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    unknown: false,
    malformed: false,
  };
};

const sourceMeaning = (source: string | null): string | null => {
  if (source === null) return null;
  return (APPLE_IPS_IMAGE_SOURCES as readonly string[]).includes(source)
    ? APPLE_IPS_IMAGE_SOURCE_MEANING[source as AppleIpsImageSource]
    : null;
};

const exceptionOf = (
  value: LosslessJson | undefined,
  read: FieldReader,
): AppleIps["exception"] => {
  const object = read.object(value, "body.exception");
  if (object === null) return null;
  const { members } = object;
  return {
    type: read.text(members.type, "body.exception.type"),
    signal: read.text(members.signal, "body.exception.signal"),
    subtype: read.text(members.subtype, "body.exception.subtype"),
    codes: read.text(members.codes, "body.exception.codes"),
    message: read.text(members.message, "body.exception.message"),
    unlisted_keys: [...object.unlisted],
  };
};

const terminationOf = (
  value: LosslessJson | undefined,
  read: FieldReader,
): AppleIps["termination"] => {
  const object = read.object(value, "body.termination");
  if (object === null) return null;
  const { members } = object;
  const reasonItems = read.array(
    members.reasons,
    "body.termination.reasons",
    false,
  );
  return {
    namespace: read.text(members.namespace, "body.termination.namespace"),
    code: read.integer(members.code, "body.termination.code"),
    indicator: read.text(members.indicator, "body.termination.indicator"),
    flags: read.integer(members.flags, "body.termination.flags"),
    by_pid: read.integer(members.byPid, "body.termination.byPid"),
    by_proc: read.text(members.byProc, "body.termination.byProc"),
    reasons:
      reasonItems === null
        ? null
        : reasonItems.flatMap((item, index) => {
            const reason = read.text(
              item,
              `body.termination.reasons[${String(index)}]`,
            );
            return reason === null ? [] : [reason];
          }),
    unlisted_keys: [...object.unlisted],
  };
};

const osVersionOf = (
  value: LosslessJson | undefined,
  read: FieldReader,
): AppleIps["process"]["os_version"] => {
  if (value === undefined || value.kind === "null") return null;
  if (value.kind === "string") return { form: "text", text: value.value };
  if (value.kind !== "object") {
    read.mismatch("body.osVersion", "string or object", value);
    return null;
  }
  const { members } = value;
  return {
    form: "structured",
    train: read.text(members.train, "body.osVersion.train"),
    build: read.text(members.build, "body.osVersion.build"),
    release_type: read.text(members.releaseType, "body.osVersion.releaseType"),
    is_embedded: read.boolean(members.isEmbedded, "body.osVersion.isEmbedded"),
    unlisted_keys: [...value.unlisted],
  };
};

const registerValue = (
  name: string,
  value: LosslessJson,
  path: string,
  read: FieldReader,
): AppleIpsThread["registers"][number] | null => {
  if (value.kind === "null") return null;
  if (value.kind === "integer")
    return {
      name,
      value: read.recordedInteger(value.decimal),
      description: null,
    };
  if (value.kind !== "object") {
    read.mismatch(path, "integer or object with integer value", value);
    return null;
  }
  const integer = read.integer(value.members.value, `${path}.value`);
  if (integer === null) {
    if (value.members.value === undefined)
      read.mismatch(`${path}.value`, "integer", undefined);
    return null;
  }
  return {
    name,
    value: integer,
    description: read.text(value.members.description, `${path}.description`),
  };
};

const threadStateOf = (
  value: LosslessJson | undefined,
  path: string,
  read: FieldReader,
): Pick<AppleIpsThread, "state_flavor" | "registers"> => {
  const object = read.object(value, path);
  if (object === null) return { state_flavor: null, registers: [] };
  const { members } = object;
  const registers: AppleIpsThread["registers"] = [];
  const vector = read.array(members.x, `${path}.x`, false);
  vector?.forEach((entry, index) => {
    const register = registerValue(
      `x${String(index)}`,
      entry,
      `${path}.x[${String(index)}]`,
      read,
    );
    if (register !== null) registers.push(register);
  });
  for (const [key, entry] of Object.entries(members)) {
    if (key === "x" || key === "flavor") continue;
    if (key === "rosetta") {
      // A translated process records Rosetta's registers as a nested state.
      const rosetta = read.object(entry, `${path}.rosetta`);
      for (const [name, nested] of Object.entries(rosetta?.members ?? {})) {
        const register = registerValue(
          `rosetta.${name}`,
          nested,
          `${path}.rosetta.${name}`,
          read,
        );
        if (register !== null) registers.push(register);
      }
      continue;
    }
    const register = registerValue(key, entry, `${path}.${key}`, read);
    if (register !== null) registers.push(register);
  }
  return {
    state_flavor: read.text(members.flavor, `${path}.flavor`),
    registers,
  };
};

const imagesOf = (
  rows: readonly LosslessJson[],
  read: FieldReader,
): AppleIpsImage[] =>
  rows.map((row, index) => {
    const path = `body.usedImages[${String(index)}]`;
    const members = read.row(row, path);
    const source = read.text(members.source, `${path}.source`);
    const recordedUuid = read.text(members.uuid, `${path}.uuid`);
    const uuid = canonicalUuid(recordedUuid);
    if (uuid.malformed && recordedUuid !== null)
      read.mismatches.push({
        path: `${path}.uuid`,
        expected: "32 hexadecimal UUID digits with optional canonical hyphens",
        observed: "malformed UUID string",
        recorded_value: recordedUuid,
      });
    const arch = read.text(members.arch, `${path}.arch`);
    return {
      index,
      source,
      source_meaning: sourceMeaning(source),
      arch,
      base: read.integer(members.base, `${path}.base`),
      size: read.integer(members.size, `${path}.size`),
      uuid: uuid.uuid,
      uuid_unknown: uuid.unknown || arch === null || arch === "",
      name: read.text(members.name, `${path}.name`),
      path: read.text(members.path, `${path}.path`),
    };
  });

/**
 * Frame 0 is the thread's sampled program counter; later frames are unwound
 * return addresses. Keep each row's own recorded address, including inline
 * rows: the inline flag does not establish a replacement address or row index.
 */
const frameRole = (
  frameIndex: number,
  threadIndex: number,
  faultingThread: number | null,
): AppleIpsFrame["role"] => {
  if (frameIndex > 0) return "return_address";
  if (faultingThread === null) return "unknown";
  return threadIndex === faultingThread
    ? "faulting_instruction"
    : "current_instruction";
};

const threadsOf = (
  rows: readonly LosslessJson[],
  imageRows: readonly LosslessJson[],
  images: readonly AppleIpsImage[],
  faultingThread: number | null,
  read: FieldReader,
): AppleIpsThread[] =>
  rows.map((row, threadIndex) => {
    const path = `body.threads[${String(threadIndex)}]`;
    const members = read.row(row, path);
    const frames = (
      read.array(members.frames, `${path}.frames`, false) ?? []
    ).map((frame, frameIndex): AppleIpsFrame => {
      const framePath = `${path}.frames[${String(frameIndex)}]`;
      const frameMembers = read.row(frame, framePath);
      const imageIndex = read.index(
        frameMembers.imageIndex,
        `${framePath}.imageIndex`,
      );
      const resolvedImage = read.resolveIndex(
        imageIndex,
        imageRows,
        `${framePath}.imageIndex`,
      );
      const image = resolvedImage === null ? undefined : images[resolvedImage];
      const imageOffset = read.integer(
        frameMembers.imageOffset,
        `${framePath}.imageOffset`,
      );
      const inline = read.boolean(frameMembers.inline, `${framePath}.inline`);
      const role = frameRole(frameIndex, threadIndex, faultingThread);
      return {
        thread_index: threadIndex,
        frame_index: frameIndex,
        image_index: imageIndex,
        image_offset: imageOffset,
        runtime_address: read.add(image?.base ?? null, imageOffset),
        role,
        inline,
        recorded_symbol: read.text(frameMembers.symbol, `${framePath}.symbol`),
        symbol_location: read.integer(
          frameMembers.symbolLocation,
          `${framePath}.symbolLocation`,
        ),
      };
    });
    return {
      index: threadIndex,
      id: read.integer(members.id, `${path}.id`),
      triggered: read.boolean(members.triggered, `${path}.triggered`),
      name: read.text(members.name, `${path}.name`),
      queue: read.text(members.queue, `${path}.queue`),
      frames,
      ...threadStateOf(members.threadState, `${path}.threadState`, read),
    };
  });

/** Split the UTF-8 text into the first-line metadata object and the crash body. */
const crashText = (bytes: Buffer): { metadata: string; body: string } => {
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    throw new AppleIpsFormatFailure(
      "malformed",
      "IPS crash reports are UTF-8 JSON text; the selected bytes are not valid UTF-8",
    );
  }
  if (text.includes("\u0000"))
    throw new AppleIpsFormatFailure(
      "malformed",
      "IPS crash reports are UTF-8 JSON text and cannot contain NUL",
    );
  const newline = text.search(/\r\n|\n|\r/u);
  if (newline <= 0)
    throw new AppleIpsFormatFailure(
      "malformed",
      "IPS crash report must start with a metadata JSON object on the first line",
    );
  const lineEnd = text.startsWith("\r\n", newline) ? newline + 2 : newline + 1;
  return { metadata: text.slice(0, newline), body: text.slice(lineEnd) };
};

const metadataOf = (text: string, read: FieldReader): AppleIps["metadata"] => {
  const json = consumeJson(text, "IPS metadata", IPS_METADATA_SHAPE);
  if (json.kind !== "object")
    throw new AppleIpsFormatFailure(
      "malformed",
      "IPS metadata is not a JSON object",
    );
  const { members } = json;
  const bugType = members.bug_type;
  if (bugType?.kind !== "string" || bugType.value.length === 0)
    throw new AppleIpsFormatFailure(
      "malformed",
      "IPS metadata bug_type is missing or not a string",
    );
  if (bugType.value !== "309")
    throw new AppleIpsFormatFailure(
      "unsupported",
      `IPS bug_type ${JSON.stringify(bugType.value)} is not a crash report (309); this operation does not decode other DiagnosticReports types`,
    );
  return {
    bug_type: bugType.value,
    timestamp: read.text(members.timestamp, "metadata.timestamp"),
    os_version: read.text(members.os_version, "metadata.os_version"),
    bundle_id: read.text(members.bundleID, "metadata.bundleID"),
    incident_id: read.text(members.incident_id, "metadata.incident_id"),
    name: read.text(members.name, "metadata.name"),
    build_version: read.text(members.build_version, "metadata.build_version"),
    platform: read.integer(members.platform, "metadata.platform"),
    unlisted_keys: [...json.unlisted],
  };
};

const coverageOf = (
  threads: readonly AppleIpsThread[],
  images: readonly AppleIpsImage[],
  mismatches: AppleIps["coverage"]["type_mismatches"],
): AppleIps["coverage"] => {
  let frames = 0;
  let registers = 0;
  for (const thread of threads) {
    frames += thread.frames.length;
    registers += thread.registers.length;
  }
  return {
    status: mismatches.length === 0 ? "complete" : "partial",
    reason:
      mismatches.length === 0
        ? null
        : `${String(mismatches.length)} recorded value(s) did not satisfy the documented type, format or reference and were not interpreted; see type_mismatches`,
    threads: threads.length,
    frames,
    images: images.length,
    registers,
    type_mismatches: mismatches,
  };
};

/** Read one Apple .ips crash report without executing a target. */
export const parseAppleIps = (
  bytes: Buffer,
  artifact: Artifact,
  input: InspectAppleIpsInput,
): AppleIps => {
  const text = crashText(bytes);
  const read = new FieldReader(input.max_integer_text_bytes);
  const metadata = metadataOf(text.metadata, read);
  if (text.body.length === 0)
    throw new AppleIpsFormatFailure(
      "malformed",
      "IPS crash report body is missing after metadata line",
    );
  const bodyJson = consumeJson(
    text.body,
    "IPS crash body",
    ipsBodyShape(input),
  );
  if (bodyJson.kind !== "object")
    throw new AppleIpsFormatFailure(
      "malformed",
      "IPS crash body is not a JSON object",
    );
  const body = bodyJson.members;
  const imageRows = read.array(body.usedImages, "body.usedImages", true) ?? [];
  const images = imagesOf(imageRows, read);
  const threadRows = read.array(body.threads, "body.threads", true) ?? [];
  const faultingThread = read.index(body.faultingThread, "body.faultingThread");
  const resolvedFaultingThread = read.resolveIndex(
    faultingThread,
    threadRows,
    "body.faultingThread",
  );
  const threads = threadsOf(
    threadRows,
    imageRows,
    images,
    resolvedFaultingThread,
    read,
  );
  const exception = exceptionOf(body.exception, read);
  const termination = terminationOf(body.termination, read);
  return {
    artifact,
    metadata,
    process: {
      name: read.text(body.procName, "body.procName"),
      path: read.text(body.procPath, "body.procPath"),
      pid: read.integer(body.pid, "body.pid"),
      parent: read.text(body.parentProc, "body.parentProc"),
      parent_pid: read.integer(body.parentPid, "body.parentPid"),
      cpu_type: read.text(body.cpuType, "body.cpuType"),
      translated: read.boolean(body.translated, "body.translated"),
      os_version: osVersionOf(body.osVersion, read),
    },
    exception,
    termination,
    faulting_thread: faultingThread,
    threads,
    images,
    classification: classify(exception, termination),
    coverage: coverageOf(threads, images, read.mismatches),
    unlisted_body_keys: [...bodyJson.unlisted],
    limitations: IPS_LIMITATIONS,
  };
};

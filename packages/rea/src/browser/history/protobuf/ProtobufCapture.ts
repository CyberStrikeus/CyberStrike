import { isAbsolute } from "node:path";
import { CaptureFormatError } from "../CaptureFormatError.js";
import {
  CaptureRedaction,
  isCaptureCredentialHeaderBytes,
} from "../CaptureRedaction.js";
import { createHash } from "node:crypto";
import { readStableArtifact } from "../../../artifacts/readStableArtifact.js";
import { completedStableArtifactObservation } from "../../../artifacts/StableArtifactObservation.js";
import {
  historicalCaptureFailure,
  withCaptureReaderCleanup,
} from "../CaptureFailures.js";
import type { ArtifactResourceScope } from "../../../artifacts/ArtifactResourceScope.js";
import {
  AnalysisInputError,
  AnalysisCapabilityUnavailableError,
} from "../../../domain/analysisErrorCore.js";
import { redactExplicitText } from "../../../domain/explicitSensitiveValues.js";
import {
  WEB_NETWORK_CAPTURE_LIMITS,
  type InspectWebNetworkCaptureInput,
  type WebNetworkCapture,
  type WebNetworkCaptureRecord,
} from "../../../domain/webNetworkCapture.js";
import type { JsonValue } from "../../../domain/jsonValue.js";
import { err, ok, type Result } from "../../../domain/result.js";
import { ProtobufBudget } from "./ProtobufWire.js";
import type { ProtobufSchema } from "./ProtobufSchema.js";
import {
  PROTOBUF_FRAMING,
  PROTOBUF_LIMITATIONS,
  decodeProtobufBody,
} from "./ProtobufBody.js";
import {
  prepareProtobufBody,
  type PreparedProtobufBody,
} from "./ProtobufFraming.js";
import type { ProtobufDecoding } from "../../../domain/protobufWire.js";

const object = (
  value: JsonValue | undefined,
): Readonly<Record<string, JsonValue>> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;

/** Exclude the original encoded representation as well as its decoding sidecar. */
const excludeBody = (
  record: WebNetworkCaptureRecord,
  pointer: string,
  reason: "explicit-sensitive-value" | "transport-credential",
) => {
  record.binary_fields = record.binary_fields.map((field) =>
    field.pointer !== pointer
      ? field
      : {
          pointer: field.pointer,
          representation: field.representation,
          state: "redacted",
          content_base64: null,
          bytes: null,
          sha256: null,
        },
  );
  const parts = pointer
    .split("/")
    .slice(1)
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  let parent: JsonValue | undefined = record.reported;
  for (const part of parts.slice(0, -1)) {
    if (
      parent === null ||
      typeof parent !== "object" ||
      !Object.hasOwn(parent, part)
    ) {
      parent = undefined;
      break;
    }
    parent = Array.isArray(parent) ? parent[Number(part)] : parent[part];
  }
  const key = parts.at(-1);
  if (
    parent !== null &&
    typeof parent === "object" &&
    key !== undefined &&
    Object.hasOwn(parent, key)
  )
    Object.defineProperty(parent, key, {
      value: null,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  record.redactions.push({ pointer, reason });
};

type ProtobufMimeAdmission = Result<
  {
    readonly framing: ProtobufDecoding["framing"] | undefined;
    readonly key: string | undefined;
  },
  {
    readonly _tag: "InvalidProtobufMime";
    readonly issue: string;
    readonly declaredFraming: ProtobufDecoding["framing"] | undefined;
  }
>;
const mediaType =
  /^[\t ]*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\/([!#$%&'*+.^_`|~0-9A-Za-z-]+)/;
// RFC 9110 token / quoted-string, including quoted-pair and obs-text.
const mimeParameter =
  /([!#$%&'*+.^_`|~0-9A-Za-z-]+)=([!#$%&'*+.^_`|~0-9A-Za-z-]+|"(?:[\t \x21\x23-\x5b\x5d-\x7e\x80-\xff]|\\[\t \x21-\x7e\x80-\xff])*")/y;

/** Strict admission keeps malformed/duplicate parameters visible instead of repairing them. */
const protobufMediaType = (
  value: string | undefined,
): ProtobufMimeAdmission => {
  if (value === undefined) return ok({ framing: undefined, key: undefined });
  const type = mediaType.exec(value);
  const essence =
    type === null
      ? undefined
      : `${type[1]!.toLowerCase()}/${type[2]!.toLowerCase()}`;
  const framing =
    essence !== undefined && Object.hasOwn(PROTOBUF_FRAMING, essence)
      ? PROTOBUF_FRAMING[essence as keyof typeof PROTOBUF_FRAMING]
      : undefined;
  const invalid = (reason: string): ProtobufMimeAdmission =>
    err({
      _tag: "InvalidProtobufMime",
      issue: `Selected body has an invalid MIME declaration (${reason}); automatic protobuf applicability is unknown.`,
      declaredFraming: framing,
    });
  if (type === null) return invalid("malformed media type");
  const parameters = new Map<string, string>();
  let at = type[0].length;
  while (at < value.length) {
    while (value[at] === " " || value[at] === "\t") at++;
    if (at === value.length) break;
    if (value[at++] !== ";") return invalid("malformed media-type parameters");
    while (value[at] === " " || value[at] === "\t") at++;
    // RFC 9110 permits empty parameter slots.
    if (at === value.length || value[at] === ";") continue;
    mimeParameter.lastIndex = at;
    const match = mimeParameter.exec(value);
    if (match === null) return invalid("malformed media-type parameters");
    at = mimeParameter.lastIndex;
    const name = match[1]!.toLowerCase();
    if (!["encoding", "charset", "version"].includes(name)) continue;
    const raw = match[2]!;
    const decoded = raw.startsWith('"')
      ? raw.slice(1, -1).replace(/\\([\s\S])/g, "$1")
      : raw;
    if (parameters.has(name) && parameters.get(name) !== decoded)
      return invalid(`conflicting ${name} parameters`);
    parameters.set(name, decoded);
  }
  const encoding = parameters.get("encoding");
  const charset = parameters.get("charset");
  const version = parameters.get("version");
  if (
    framing === "raw" &&
    ((encoding !== undefined && encoding !== "binary") ||
      charset !== undefined ||
      version !== undefined)
  )
    return err({
      _tag: "InvalidProtobufMime",
      issue:
        "Selected binary Protobuf MIME profile has an illegal encoding, charset or reserved version parameter; retained bytes were not automatically interpreted. Select explicit framing to interpret the bytes independently of that declaration.",
      declaredFraming: framing,
    });
  return ok({
    framing,
    key: JSON.stringify([
      essence,
      framing === "raw" ? (encoding ?? "binary") : (encoding ?? null),
      charset ?? null,
      version ?? null,
    ]),
  });
};

/** Format-aware owner of body metadata; callers never reinterpret producer JSON. */
const bodyMetadata = (
  record: WebNetworkCaptureRecord,
  pointer: string,
  format: string,
  binaryByPointer: ReadonlyMap<
    string,
    WebNetworkCaptureRecord["binary_fields"][number]
  >,
) => {
  const side = /^\/(request|response)\//.exec(pointer)?.[1];
  if (
    side === undefined ||
    ![
      "/request/postData/text",
      "/response/content/text",
      "/request/body",
      "/response/body",
      "/request/content",
      "/response/content",
    ].includes(pointer)
  )
    return undefined;
  const message = object(object(record.reported)?.[side]);
  if (message === undefined) return undefined;
  const headers = new Map<string, string | undefined>();
  let headerProfile = protobufMediaType(undefined);
  let headerDeclaredFraming: ProtobufDecoding["framing"] | undefined;
  let headerNamesKnown = Array.isArray(message.headers);
  if (Array.isArray(message.headers)) {
    for (const [index, item] of message.headers.entries()) {
      const pair = object(item);
      const text = (
        value: JsonValue | undefined,
        coordinate: string,
      ): string | undefined => {
        const binary = binaryByPointer.get(coordinate);
        if (binary !== undefined)
          return binary.state === "retained"
            ? Buffer.from(binary.content_base64, "base64").toString("latin1")
            : undefined;
        return typeof value === "string" ? value : undefined;
      };
      const name = Array.isArray(item)
        ? text(item[0], `/${side}/headers/${index}/0`)
        : pair?.name;
      const value = Array.isArray(item)
        ? text(item[1], `/${side}/headers/${index}/1`)
        : pair?.value;
      if (typeof name === "string") {
        const key = name.toLowerCase();
        const knownValue = typeof value === "string" ? value : undefined;
        const previous = headers.get(key);
        if (key === "content-type") {
          const nextProfile = protobufMediaType(knownValue);
          const nextDeclaredFraming = nextProfile.ok
            ? nextProfile.value.framing
            : nextProfile.error.declaredFraming;
          const agrees =
            previous !== undefined &&
            knownValue !== undefined &&
            headerProfile.ok &&
            nextProfile.ok &&
            headerProfile.value.key === nextProfile.value.key;
          const first = !headers.has(key);
          headerDeclaredFraming =
            first || headerDeclaredFraming === nextDeclaredFraming
              ? nextDeclaredFraming
              : undefined;
          headers.set(key, first ? knownValue : agrees ? previous : undefined);
          headerProfile = first
            ? nextProfile
            : agrees
              ? headerProfile
              : protobufMediaType(undefined);
          continue;
        }
        // Other repeated declarations agree only when known and equal.
        headers.set(
          key,
          !headers.has(key)
            ? knownValue
            : previous !== undefined &&
                knownValue !== undefined &&
                previous === knownValue
              ? previous
              : undefined,
        );
      } else headerNamesKnown = false;
    }
  }
  // A visible declaration selects framing. Absence is established only when every header
  // name is known; excluded or conflicting values leave framing applicability unknown.
  const header = headers.get("content-type");
  if (format === "har") {
    if (
      pointer !== `/${side}/${side === "request" ? "postData" : "content"}/text`
    )
      return undefined;
    // HAR requires a string mimeType; any other value is an excluded declaration.
    const mimeType = object(
      message[side === "request" ? "postData" : "content"],
    )?.mimeType;
    const contentType = typeof mimeType === "string" ? mimeType : undefined;
    const profile = protobufMediaType(contentType);
    // An independent header still identifies transport sanitization, not the
    // excluded producer MIME field's automatic interpretation.
    return {
      contentType,
      mimeProfile: profile,
      declaredFraming:
        contentType === undefined
          ? headerDeclaredFraming
          : profile.ok
            ? profile.value.framing
            : profile.error.declaredFraming,
      contentTypeKnown: contentType !== undefined,
      httpIdentityKnown: true,
      httpCodingKnown: true,
    };
  }
  if (pointer !== `/${side}/body` && pointer !== `/${side}/content`)
    return undefined;
  return {
    contentType: header,
    mimeProfile: headerProfile,
    declaredFraming: headerDeclaredFraming,
    contentTypeKnown:
      header !== undefined ||
      (headerNamesKnown && !headers.has("content-type")),
    httpCodingKnown:
      headerNamesKnown &&
      ["content-encoding", "transfer-encoding"].every(
        (name) => !headers.has(name) || headers.get(name) !== undefined,
      ),
    httpIdentityKnown:
      headerNamesKnown &&
      ["content-encoding", "transfer-encoding"].every(
        (name) =>
          // HTTP OWS is SP/HTAB; require the entire identity token, including EOF.
          !headers.has(name) ||
          /^[ \t]*identity[ \t]*(?![\s\S])/i.test(headers.get(name) ?? ""),
      ),
  };
};

type RetainedBody = Extract<
  WebNetworkCaptureRecord["binary_fields"][number],
  { state: "retained" }
>;
interface PreparedBody {
  readonly field: RetainedBody;
  readonly body: Buffer;
  readonly contentType: string | undefined;
  readonly framing: ProtobufDecoding["framing"];
  readonly prepared: PreparedProtobufBody;
}
export interface PreparedProtobufCapture {
  readonly records: readonly {
    record: WebNetworkCaptureRecord;
    bodies: readonly PreparedBody[];
  }[];
  readonly incomplete: boolean;
}

/** Sanitize every selected body before any schema acquisition or field-expansion failure.
 * Until this stage completes, the caller must not publish the original source as partial Evidence.
 */
export const prepareCaptureProtobuf = async (
  capture: WebNetworkCapture,
  input: InspectWebNetworkCaptureInput,
  signal?: AbortSignal,
): Promise<PreparedProtobufCapture | undefined> => {
  if (input.record_ordinals === undefined) return undefined;
  capture.protobuf_coverage = {
    status: "partial",
    selected_records: input.record_ordinals.length,
    inspected_records: 0,
  };
  capture.limitations.push(...PROTOBUF_LIMITATIONS);
  let incomplete = false;
  const records: { record: WebNetworkCaptureRecord; bodies: PreparedBody[] }[] =
    [];
  const options = input.protobuf;
  const pointers =
    options?.body_pointers === undefined
      ? undefined
      : new Set(options.body_pointers);
  const redactions = new CaptureRedaction(input.sensitive_values);
  const work = new ProtobufBudget(signal);
  for (const ordinal of input.record_ordinals) {
    await work.checkpoint();
    const record = capture.records[ordinal];
    if (record === undefined) continue;
    const bodies: PreparedBody[] = [];
    records.push({ record, bodies });
    const binaryByPointer = new Map(
      record.binary_fields.map((field) => [field.pointer, field]),
    );
    for (const field of record.binary_fields) {
      await work.checkpoint();
      if (pointers !== undefined && !pointers.has(field.pointer)) continue;
      const metadata = bodyMetadata(
        record,
        field.pointer,
        input.format,
        binaryByPointer,
      );
      // Framing overrides interpret bodies; header and extension bytes remain their own facts.
      if (metadata === undefined) continue;
      if (field.state !== "retained") {
        incomplete = true;
        continue;
      }
      const { contentType, mimeProfile, declaredFraming } = metadata;
      const automatic = mimeProfile.ok ? mimeProfile.value.framing : undefined;
      const automaticSelected =
        options?.framing === undefined || options.framing === "auto";
      if (!mimeProfile.ok) {
        if (automaticSelected) incomplete = true;
        record.limitations.push(mimeProfile.error.issue);
      }
      if (automaticSelected && !metadata.contentTypeKnown && field.bytes > 0) {
        incomplete = true;
        record.limitations.push(
          "Selected body's MIME metadata is excluded, conflicting or unavailable, so automatic protobuf framing applicability is unknown; its retained bytes were not interpreted. Select explicit framing to decode them.",
        );
      }
      const framing =
        options?.framing === undefined || options.framing === "auto"
          ? (automatic ?? declaredFraming)
          : options.framing;
      if (framing === undefined) {
        continue;
      }
      if (
        field.bytes > WEB_NETWORK_CAPTURE_LIMITS.inputBytes ||
        field.content_base64.length >
          Math.ceil(WEB_NETWORK_CAPTURE_LIMITS.inputBytes / 3) * 4
      )
        throw new CaptureFormatError(
          "limit",
          "Protobuf body exceeds the admitted 32 MiB source bound",
        );
      const body = Buffer.from(field.content_base64, "base64");
      if (
        body.length !== field.bytes ||
        createHash("sha256").update(body).digest("hex") !== field.sha256
      )
        throw new AnalysisInputError("inspect_web_network_capture", undefined, [
          {
            path: ["capture_path"],
            reason: "invalid_format",
            message:
              "Retained protobuf bytes contradict their source descriptor",
          },
        ]);
      const exclusions = {
        decoded: (data: Uint8Array) =>
          redactions.sensitiveBytes(
            Buffer.from(data.buffer, data.byteOffset, data.byteLength),
          ),
        header: isCaptureCredentialHeaderBytes,
      };
      const prepared = await prepareProtobufBody(
        body,
        framing,
        exclusions,
        signal,
      );
      // Caller overrides do not turn off exclusions for the transport declared by the source.
      const declared =
        prepared.excluded === undefined &&
        declaredFraming !== undefined &&
        declaredFraming !== framing
          ? await prepareProtobufBody(body, declaredFraming, exclusions, signal)
          : prepared;
      const excluded = prepared.excluded ?? declared.excluded;
      if (excluded !== undefined) {
        excludeBody(record, field.pointer, excluded);
        binaryByPointer.delete(field.pointer);
        incomplete = true;
        continue;
      }
      // Analysis eligibility never bypasses the independent source exclusions.
      if (
        !metadata.httpCodingKnown &&
        (!prepared.credentialsChecked || !declared.credentialsChecked)
      )
        throw new AnalysisCapabilityUnavailableError(
          input.format,
          "inspect_web_network_capture",
          "Credential inspection could not complete while HTTP coding metadata was unavailable; unchecked capture bodies were withheld.",
          {
            diagnostics: { body_pointer: field.pointer },
            userMessage:
              "Use a capture with available HTTP coding metadata, or select records whose transport can be inspected. Unchecked source bytes were not published.",
          },
        );
      if (!metadata.httpIdentityKnown) {
        incomplete = true;
        record.limitations.push(
          "Selected protobuf body's HTTP content/transfer coding is encoded or unknown, so identity is not established; its exact stored bytes remain opaque.",
        );
        continue;
      }
      if (automaticSelected && (!mimeProfile.ok || !metadata.contentTypeKnown))
        continue;
      bodies.push({ field, body, contentType, framing, prepared });
    }
  }
  return { records, incomplete };
};

/** Interpret the sanitized source once, inside the capture adapter's owned operation. */
export const decodeCaptureProtobuf = async (
  capture: WebNetworkCapture,
  input: InspectWebNetworkCaptureInput,
  resources: ArtifactResourceScope,
  prepared: PreparedProtobufCapture | undefined,
  signal?: AbortSignal,
  encodedSourceBytes = 0,
): Promise<void> => {
  if (prepared === undefined || capture.protobuf_coverage === undefined) return;
  let incomplete = prepared.incomplete;
  const budget = new ProtobufBudget(signal);
  budget.charge(
    encodedSourceBytes +
      256 +
      Buffer.byteLength(JSON.stringify(PROTOBUF_LIMITATIONS)),
  );
  for (const entry of prepared.records)
    for (const item of entry.bodies)
      budget.charge(
        item.body.length +
          (item.prepared.data === item.body
            ? 0
            : (item.prepared.data?.length ?? 0)),
      );
  const redact = (text: string) => {
    if (input.sensitive_values.length === 0) return text;
    if (input.sensitive_values.some((literal) => text.includes(literal)))
      budget.charge(text.length * 60);
    return redactExplicitText(text, input.sensitive_values);
  };
  const options = input.protobuf;
  let schema: ProtobufSchema | undefined;
  let schemaSource: ProtobufDecoding["schema"];
  if (options?.schema !== undefined) {
    const path = options.schema.descriptor_set_path;
    if (!isAbsolute(path))
      throw new AnalysisInputError("inspect_web_network_capture", undefined, [
        {
          path: ["protobuf", "schema", "descriptor_set_path"],
          reason: "invalid_format",
          message: "Expected an absolute descriptor-set path",
        },
      ]);
    const snapshot = await readStableArtifact(
      path,
      WEB_NETWORK_CAPTURE_LIMITS.inputBytes,
      signal,
      undefined,
      resources,
    ).catch((cause: unknown) => {
      const failure = withCaptureReaderCleanup(
        historicalCaptureFailure(
          input,
          cause,
          "descriptor-read",
          signal === undefined ? undefined : { signal },
        ),
        cause,
      );
      const snapshot = completedStableArtifactObservation(cause, path);
      // The caller retains the sanitized capture as its partial observation.
      if (snapshot !== undefined)
        failure.retainDiagnostics({ descriptor_set_snapshot: snapshot });
      throw failure;
    });
    const { ProtobufSchema } = await import("./ProtobufSchema.js");
    const admitted = await ProtobufSchema.read(
      snapshot.bytes,
      options.schema.message_type,
      budget,
      redact,
    );
    if (!admitted.ok)
      throw new AnalysisInputError("inspect_web_network_capture", undefined, [
        {
          path: ["protobuf", "schema", admitted.error.field],
          reason:
            admitted.error.kind === "missing-message"
              ? "invalid_value"
              : "invalid_format",
          message: redact(admitted.error.message),
        },
      ]);
    schema = admitted.value;
    schemaSource = {
      decoder: "protobuf-es-2.16.0",
      descriptor_set_path: redact(path),
      descriptor_set_sha256: snapshot.sha256,
      descriptor_set_bytes: snapshot.bytes.length,
      message_type: redact(options.schema.message_type),
    };
  }
  for (const { record, bodies } of prepared.records) {
    const decoded: ProtobufDecoding[] = [];
    for (const {
      field,
      body,
      contentType,
      framing,
      prepared: bodySource,
    } of bodies) {
      await budget.checkpoint();
      if (
        input.sensitive_values.some(
          (value) =>
            field.pointer.includes(value) ||
            field.sha256.includes(value) ||
            schemaSource?.descriptor_set_sha256.includes(value),
        )
      ) {
        incomplete = true;
        continue;
      }
      budget.charge(
        2048 +
          8 *
            (field.pointer.length +
              (contentType?.length ?? 0) +
              (schemaSource?.descriptor_set_path.length ?? 0) +
              (schemaSource?.message_type.length ?? 0)),
      );
      schema?.reset();
      const result = await decodeProtobufBody(
        body,
        framing,
        {
          pointer: field.pointer,
          content_type: contentType ?? null,
          body_sha256: field.sha256,
        },
        redact,
        budget,
        schema,
        bodySource,
      );
      if (schemaSource !== undefined) result.schema = schemaSource;
      if (
        result.status !== "complete" ||
        result.fields.some(
          (field) =>
            field.schema_status !== undefined &&
            field.schema_status !== "decoded",
        )
      )
        incomplete = true;
      decoded.push(result);
    }
    if (decoded.length > 0) record.protobuf = decoded;
    capture.protobuf_coverage.inspected_records++;
  }
  if (
    !incomplete &&
    capture.protobuf_coverage.inspected_records ===
      capture.protobuf_coverage.selected_records
  )
    capture.protobuf_coverage.status = "complete";
};

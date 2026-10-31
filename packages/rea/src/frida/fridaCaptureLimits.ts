/** Fixed Frida capture caps. This release has no runtime override. */
export const MAX_SESSION_CAPTURE_BYTES = 16 * 1024 * 1024;
export const MAX_MESSAGE_METADATA_BYTES = 128 * 1024;
export const MAX_MESSAGE_TYPE_BYTES = 4 * 1024;
export const MAX_MESSAGE_TEXT_BYTES = 32 * 1024;
/** Bound the in-memory object graph as well as its serialized JSON byte size. */
export const MAX_CAPTURE_JSON_NODES = 250_000;
export const MAX_JSON_DEPTH = 64;
export const MAX_BINARY_MESSAGE_BYTES = Math.floor(
  ((MAX_SESSION_CAPTURE_BYTES - 1024 * 1024) * 3) / 4,
);

/** Why a payload or binary field was shortened. Caller payloads cannot set these. */
export const FRIDA_OWNED_CAPTURE_LIMITS = [
  "session_bytes",
  "message_type",
  "message_text",
  "payload_bytes",
  "json_nodes",
  "json_depth",
  "binary_bytes",
  "unrepresentable",
] as const;

export type FridaOwnedCaptureLimit =
  (typeof FRIDA_OWNED_CAPTURE_LIMITS)[number];

const OWNED_CAPTURE_LIMITS = new Set<string>(FRIDA_OWNED_CAPTURE_LIMITS);

const namedLimit = (value: unknown): FridaOwnedCaptureLimit | undefined =>
  typeof value === "string" && OWNED_CAPTURE_LIMITS.has(value)
    ? (value as FridaOwnedCaptureLimit)
    : undefined;

const noOverride = "This release has no runtime override.";

const limitationFor = (limit: FridaOwnedCaptureLimit): string => {
  switch (limit) {
    case "session_bytes":
      return `Frida session message capture reached its ${String(MAX_SESSION_CAPTURE_BYTES)} byte budget. ${noOverride}`;
    case "message_type":
      return `A Frida message type reached its ${String(MAX_MESSAGE_TYPE_BYTES)} byte cap. ${noOverride}`;
    case "message_text":
      return `A Frida message text field reached its ${String(MAX_MESSAGE_TEXT_BYTES)} byte cap. ${noOverride}`;
    case "payload_bytes":
      return `A Frida message payload reached its ${String(MAX_SESSION_CAPTURE_BYTES - MAX_MESSAGE_METADATA_BYTES)} byte cap. ${noOverride}`;
    case "json_nodes":
      return `A Frida message payload reached its ${String(MAX_CAPTURE_JSON_NODES)} JSON node cap. ${noOverride}`;
    case "json_depth":
      return `A Frida message payload reached its ${String(MAX_JSON_DEPTH)} level nesting cap. ${noOverride}`;
    case "binary_bytes":
      return `A Frida binary message reached its ${String(MAX_BINARY_MESSAGE_BYTES)} byte cap. ${noOverride}`;
    case "unrepresentable":
      return `A Frida message value could not be retained in full. ${noOverride}`;
  }
};

/**
 * Read capture caps from REA-owned observation fields. `payload` is caller
 * data, so flags inside it are not REA dropping bytes.
 */
const collectOwnedCaps = (
  value: unknown,
  caps: Set<FridaOwnedCaptureLimit>,
): void => {
  if (typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectOwnedCaps(item, caps);
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.messages_truncated === true) caps.add("session_bytes");
  if (record.type_truncated === true) caps.add("message_type");
  if (
    record.description_truncated === true ||
    record.stack_truncated === true ||
    record.file_name_truncated === true
  )
    caps.add("message_text");
  if (record.payload_truncated === true)
    caps.add(namedLimit(record.payload_capture_limit) ?? "payload_bytes");
  if (record.data_truncated === true)
    caps.add(namedLimit(record.data_capture_limit) ?? "binary_bytes");
  for (const [key, child] of Object.entries(record)) {
    if (key === "payload") continue;
    collectOwnedCaps(child, caps);
  }
};

/** Name only the caps that REA itself recorded while dropping data. */
export const fridaCaptureLimitations = (result: unknown): readonly string[] => {
  const caps = new Set<FridaOwnedCaptureLimit>();
  collectOwnedCaps(result, caps);
  return FRIDA_OWNED_CAPTURE_LIMITS.flatMap((limit) =>
    caps.has(limit) ? [limitationFor(limit)] : [],
  );
};

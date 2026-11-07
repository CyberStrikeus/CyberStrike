import { createHash } from "node:crypto";

/**
 * Streaming SHA-256 over canonical JSON. Hashing owner (avoids assembling
 * aggregate strings); `comparisonSemantics.canonicalJson` (canonicalize lib)
 * is the string-comparison owner. JSON object keys follow RFC 8785's UTF-16
 * code-unit order in both; entity-list ordering is a separate concern.
 */
export const digestCanonicalValue = (
  value: unknown,
  context = "Comparison",
): string => {
  const hash = createHash("sha256");
  // Batch small emitted parts to cut hash.update crossings. A large part is
  // hashed as is: appending it to the buffer would hold a second copy of it
  // while the concatenation flattens. Flush cuts only at part boundaries, so
  // the hashed byte stream is unchanged.
  let buffered = "";
  const flush = (): void => {
    if (buffered.length === 0) return;
    hash.update(buffered);
    buffered = "";
  };
  const emit = (part: string): void => {
    if (part.length >= 8192) {
      flush();
      hash.update(part);
      return;
    }
    buffered += part;
    if (buffered.length >= 8192) flush();
  };
  const encoded = emitCanonical(value, emit, new Set());
  if (!encoded) throw new TypeError(`${context} could not canonicalize data`);
  flush();
  return hash.digest("hex");
};

type Emit = (part: string) => void;

/** Canonical-JSON refusal. The code is the stable identity. */
export class CanonicalDigestError extends Error {
  readonly _tag = "CanonicalDigestError";

  constructor(readonly code: "nan" | "infinity" | "circular") {
    super(code);
    this.name = "CanonicalDigestError";
  }
}

const emitCanonical = (
  value: unknown,
  emit: Emit,
  ancestors: Set<object>,
): boolean => {
  if (typeof value === "number" && !Number.isFinite(value))
    throw new CanonicalDigestError(Number.isNaN(value) ? "nan" : "infinity");
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) return false;
    emit(encoded);
    return true;
  }
  if (ancestors.has(value)) throw new CanonicalDigestError("circular");
  ancestors.add(value);
  try {
    if ("toJSON" in value && typeof value.toJSON === "function") {
      const normalized: unknown = value.toJSON();
      return emitCanonical(normalized, emit, ancestors);
    }
    if (Array.isArray(value)) {
      emit("[");
      const length = value.length;
      for (let index = 0; index < length; index += 1) {
        if (index > 0) emit(",");
        // Preserve canonicalize's sparse-array and unsupported-value behavior.
        if (!(index in value)) continue;
        const item: unknown = value[index];
        emitCanonical(
          item === undefined || typeof item === "symbol" ? null : item,
          emit,
          ancestors,
        );
      }
      emit("]");
    } else {
      emit("{");
      let first = true;
      // Match canonicalize/RFC 8785, including supplementary-plane keys.
      for (const key of Object.keys(value).sort()) {
        if (
          Reflect.get(value, key) === undefined ||
          typeof Reflect.get(value, key) === "symbol"
        )
          continue;
        const item: unknown = Reflect.get(value, key);
        if (!first) emit(",");
        first = false;
        emit(JSON.stringify(key));
        emit(":");
        if (!emitCanonical(item, emit, ancestors)) emit("undefined");
      }
      emit("}");
    }
    return true;
  } finally {
    ancestors.delete(value);
  }
};

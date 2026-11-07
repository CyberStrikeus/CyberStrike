/** Producing constraint for a model capacity refusal. Recovery uses this, not message text. */
export const MODEL_CAPACITY_LIMITS = [
  "header-bytes",
  "report-bytes",
  "representation-bytes",
  "exact-offset",
  "metadata-nesting",
  "json-nesting",
] as const;

/** Which fixed model allowance refused the request. */
export type ModelCapacityLimit = (typeof MODEL_CAPACITY_LIMITS)[number];

/** Format failures stay separate from filesystem, capacity and cancellation failures. */
export class ModelFormatFailure extends Error {
  /** Set only for `kind: "capacity"`. */
  readonly limit: ModelCapacityLimit | undefined;
  constructor(kind: "format" | "unsupported", message: string);
  constructor(kind: "capacity", message: string, limit: ModelCapacityLimit);
  constructor(
    readonly kind: "format" | "unsupported" | "capacity",
    message: string,
    limit?: ModelCapacityLimit,
  ) {
    super(message);
    this.name = "ModelFormatFailure";
    if (kind === "capacity" && limit === undefined)
      throw new TypeError("Model capacity failures require a limit kind");
    if (kind !== "capacity" && limit !== undefined)
      throw new TypeError("Only model capacity failures carry a limit kind");
    this.limit = limit;
  }
}

export function rejectModel(message: string): never {
  throw new ModelFormatFailure("format", message);
}

export function rejectPickle(): never {
  throw new ModelFormatFailure(
    "unsupported",
    "PyTorch pickle/ZIP model deserialization is unsupported; supply GGUF or safetensors instead",
  );
}

// Shared header ceiling for GGUF and Safetensors. Safetensors counts declared
// JSON bytes after the eight-byte length prefix; GGUF counts the complete
// header. Retained rows and the serialized report have separate allowances.
export const MODEL_HEADER_BYTES = 100_000_000;
export const MODEL_REPORT_BYTES = 32 * 1024 * 1024;
export const MODEL_ARRAY_PREVIEW = 8;
export const MODEL_METADATA_NESTING = 32;
export const MODEL_JSON_NESTING = 32;

const fixedModelLimit = (allowance: string): string =>
  `${allowance}. This release has no runtime override. Additional host memory does not raise it. Repeating the unchanged request fails the same way.`;

/** Recovery for the allowance that actually refused the model. Host memory does not raise it. */
export const modelCapacityRemediation = (limit: ModelCapacityLimit): string => {
  switch (limit) {
    case "header-bytes":
      return fixedModelLimit("The model header allowance is 100,000,000 bytes");
    case "report-bytes":
      return fixedModelLimit(
        `The retained model report allowance is ${String(MODEL_REPORT_BYTES)} bytes`,
      );
    case "representation-bytes":
      return fixedModelLimit(
        `The retained model representation allowance is ${String(MODEL_REPORT_BYTES)} bytes`,
      );
    case "exact-offset":
      return fixedModelLimit(
        `Exact host offset precision stops at ${String(Number.MAX_SAFE_INTEGER)}`,
      );
    case "metadata-nesting":
      return fixedModelLimit(
        `GGUF metadata nesting is limited to ${String(MODEL_METADATA_NESTING)} array frames`,
      );
    case "json-nesting":
      return fixedModelLimit(
        `Safetensors JSON nesting is limited to ${String(MODEL_JSON_NESTING)} levels`,
      );
  }
};

/** Limits that belong to the producing constraint, without unrelated ceilings. */
export const modelCapacityReportedLimits = (
  limit: ModelCapacityLimit,
): Readonly<Record<string, number>> => {
  switch (limit) {
    case "header-bytes":
      return { maximum_header_bytes: MODEL_HEADER_BYTES };
    case "report-bytes":
      return { maximum_report_bytes: MODEL_REPORT_BYTES };
    case "representation-bytes":
      return { maximum_representation_bytes: MODEL_REPORT_BYTES };
    case "exact-offset":
      return { maximum_exact_offset: Number.MAX_SAFE_INTEGER };
    case "metadata-nesting":
      return { maximum_array_frames: MODEL_METADATA_NESTING };
    case "json-nesting":
      return { maximum_json_depth: MODEL_JSON_NESTING };
  }
};

/** Charge representation growth before retaining rows or decoding long strings. */
export class ModelReportBudget {
  #remaining = MODEL_REPORT_BYTES;
  charge(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.#remaining)
      throw new ModelFormatFailure(
        "capacity",
        "Model facts exceed the 32 MiB retained representation budget. This release has no runtime override.",
        "representation-bytes",
      );
    this.#remaining -= bytes;
  }
}

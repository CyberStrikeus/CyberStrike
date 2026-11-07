import { EvmAdmissionError } from "./EvmAdmissionError.js";
import { decode, Tokenizer, Type, type Token } from "cborg";
import type {
  SolidityMetadata,
  SolidityMetadataScalar,
} from "../domain/evm/solidityMetadata.js";

const PROFILE = "terminal-cbor-scalars-v1";
const MAX_DEPTH = 64;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const decodeOptions = {
  useMaps: true,
  allowBigInt: true,
  allowIndefinite: false,
  allowUndefined: false,
  allowInfinity: false,
  allowNaN: false,
  rejectDuplicateMapKeys: false,
  retainStringBytes: true,
} as const;

/** Bound recursive decoder entry before collection interpretation/allocation. */
class BoundedMetadataTokenizer extends Tokenizer {
  readonly remaining: number[] = [];
  readonly #mapKeys: Array<Set<string> | undefined> = [];
  constructor(bytes: Uint8Array) {
    super(bytes, decodeOptions);
  }

  override next(): Token {
    while (this.remaining.at(-1) === 0) {
      this.remaining.pop();
      this.#mapKeys.pop();
    }
    const token = super.next();
    if (
      Type.equals(token.type, Type.tag) ||
      Type.equals(token.type, Type.float)
    )
      throw new EvmAdmissionError("tag_or_float");
    if (Type.equals(token.type, Type.string)) {
      if (token.byteValue !== undefined)
        token.value = utf8.decode(token.byteValue);
      // cborg answers the shortest-form empty text (0x60) with a shared token that has no
      // bytes; it can only mean "", which is already its value.
      else if (token.value !== "" || token.encodedLength !== 1)
        throw new EvmAdmissionError("text_bytes_unavailable");
    }
    const parent = this.remaining.length - 1;
    const mapKeys = parent >= 0 ? this.#mapKeys[parent] : undefined;
    const onKey =
      mapKeys !== undefined && parent >= 0 && this.remaining[parent]! % 2 === 0;
    if (parent >= 0) this.remaining[parent]!--;
    if (
      onKey &&
      mapKeys !== undefined &&
      !Type.equals(token.type, Type.map) &&
      !Type.equals(token.type, Type.array)
    ) {
      const identity = keyIdentity(token.value);
      if (mapKeys.has(identity)) throw repeatedMapKey(identity);
      mapKeys.add(identity);
    }
    if (
      Type.equals(token.type, Type.map) ||
      Type.equals(token.type, Type.array)
    ) {
      const count: unknown = token.value;
      const children =
        typeof count === "number"
          ? count * (Type.equals(token.type, Type.map) ? 2 : 1)
          : NaN;
      if (
        !Number.isSafeInteger(children) ||
        children < 0 ||
        children > this.data.length
      )
        throw new EvmAdmissionError("collection_exceeds_bound");
      if (this.remaining.length >= MAX_DEPTH)
        throw new EvmAdmissionError("nesting_exceeds_profile", {
          max_depth: MAX_DEPTH,
        });
      this.#mapKeys.push(
        Type.equals(token.type, Type.map) ? new Set() : undefined,
      );
      this.remaining.push(children);
    }
    return token;
  }
}

const scalar = (value: unknown): SolidityMetadataScalar => {
  if (typeof value === "string") return { kind: "text", value };
  if (typeof value === "bigint")
    return { kind: "integer", value: value.toString() };
  if (typeof value === "number" && Number.isSafeInteger(value))
    return { kind: "integer", value: String(value) };
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (value === null) return { kind: "null" };
  if (value instanceof Uint8Array)
    return { kind: "bytes", value: Buffer.from(value).toString("hex") };
  if (value instanceof Map) return { kind: "uninterpreted", container: "map" };
  if (Array.isArray(value))
    return { kind: "uninterpreted", container: "array" };
  throw new EvmAdmissionError("value_outside_profile");
};

/** Value identity for duplicate-key checks; map entry order is not significant. */
const keyIdentity = (value: unknown): string => {
  if (value instanceof Map)
    return `{${[...value]
      .map(([key, item]) => `${keyIdentity(key)}:${keyIdentity(item)}`)
      .sort()
      .join(",")}}`;
  if (Array.isArray(value)) return `[${value.map(keyIdentity).join(",")}]`;
  return JSON.stringify(scalar(value));
};

const repeatedMapKey = (identity: string): EvmAdmissionError =>
  new EvmAdmissionError(
    "repeated_map_key",
    identity.length <= 128
      ? { key: identity }
      : { key_length: identity.length },
  );

/** Check every map boundary, even when nested values remain uninterpreted. */
const validateMapKeys = (value: unknown): void => {
  if (value instanceof Map) {
    const seen = new Set<string>();
    for (const [key, item] of value) {
      const identity = keyIdentity(key);
      if (seen.has(identity)) throw repeatedMapKey(identity);
      seen.add(identity);
      validateMapKeys(key);
      validateMapKeys(item);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) validateMapKeys(item);
  }
};

/** Keep the typed code and its detail; map only the decoder's duplicate-key throw. */
const solidityFailure = (
  cause: unknown,
): {
  readonly diagnostic: string;
  readonly admission?: {
    readonly code: string;
    readonly detail?: Readonly<Record<string, string | number>>;
  };
} => {
  if (cause instanceof EvmAdmissionError)
    return {
      diagnostic: cause.code,
      admission: {
        code: cause.code,
        ...(cause.detail === undefined ? {} : { detail: cause.detail }),
      },
    };
  return {
    diagnostic: (cause instanceof Error ? cause.message : String(cause)).slice(
      0,
      512,
    ),
  };
};

/** Parse only a plausible terminal root-map candidate; never establish absence. */
export const inspectSolidityMetadata = (
  bytes: Uint8Array,
): SolidityMetadata => {
  const empty: SolidityMetadata = {
    profile: PROFILE,
    status: "unavailable",
    bytecode_offset: null,
    cbor_bytes: null,
    entries: [],
    compiler_version: null,
    diagnostic:
      "No plausible terminal CBOR map was identified; Solidity origin and metadata absence remain unknown.",
  };
  if (bytes.length < 3) return empty;
  const length = bytes[bytes.length - 2]! * 256 + bytes[bytes.length - 1]!;
  const offset = bytes.length - 2 - length;
  if (length === 0 || offset < 0 || bytes[offset]! >> 5 !== 5) return empty;
  const selected = bytes.subarray(offset, bytes.length - 2);
  const result: SolidityMetadata = {
    ...empty,
    status: "not-decoded",
    bytecode_offset: offset,
    cbor_bytes: length,
  };
  try {
    const raw: unknown = decode(selected, {
      ...decodeOptions,
      tokenizer: new BoundedMetadataTokenizer(selected),
    });
    if (!(raw instanceof Map)) throw new EvmAdmissionError("root_not_map");
    validateMapKeys(raw);
    // cborg compares Map keys by identity, so repeated byte-string or container
    // keys (each its own object) pass its duplicate check; compare by value at
    // every map boundary before projecting any entries.
    for (const [key, value] of raw as Map<unknown, unknown>) {
      result.entries.push({ key: scalar(key), value: scalar(value) });
    }
    result.status = result.entries.some(
      ({ key, value }) =>
        key.kind === "uninterpreted" || value.kind === "uninterpreted",
    )
      ? "partial"
      : "decoded";
    result.diagnostic =
      result.status === "partial"
        ? "Nested containers are uninterpreted; their exact bytes remain at the recorded range in original bytecode."
        : null;
    const version: unknown = raw.get("solc");
    if (version instanceof Uint8Array && version.length === 3)
      result.compiler_version = {
        representation: "release-bytes",
        value: [...version].join("."),
      };
    else if (typeof version === "string" && version.length > 0)
      result.compiler_version = {
        representation: "prerelease-text",
        value: version,
      };
    return result;
  } catch (cause: unknown) {
    return {
      ...result,
      status: "not-decoded",
      entries: [],
      compiler_version: null,
      ...solidityFailure(cause),
    };
  }
};

import { visit } from "jsonc-parser";
import { LosslessNumber } from "lossless-json";
import { WEB_NETWORK_CAPTURE_LIMITS } from "../../domain/webNetworkCapture.js";
import { CaptureFormatError } from "./CaptureFormatError.js";
import { TextDecoder } from "node:util";

type Frame =
  | {
      kind: "object";
      pointer: string;
      members: Map<string, unknown>;
      pendingKey?: string;
    }
  | { kind: "array"; pointer: string; items: unknown[] };

/** Materialize upstream JSON events without duplicate folding, prototype setters or numeric rounding. */
export const parseCaptureJson = (
  text: string,
  format: "HAR" | "qlog",
): unknown => {
  const frames: Frame[] = [];
  let result: unknown;
  const valuePointer = (): string => {
    const parent = frames.at(-1);
    if (parent === undefined) return "";
    if (parent.kind === "array")
      return `${parent.pointer}/${parent.items.length}`;
    return parent.pendingKey === undefined
      ? parent.pointer
      : `${parent.pointer}/${parent.pendingKey.replaceAll("~", "~0").replaceAll("/", "~1")}`;
  };
  // The document root is container level 1. Admit a container only while
  // its own level stays within the budget; values inside an admitted
  // container add no level, so empty and scalar-bearing containers agree.
  const admitContainer = (): void => {
    if (frames.length >= WEB_NETWORK_CAPTURE_LIMITS.depth)
      throw new CaptureFormatError(
        "input-limit",
        `${format} exceeds the 64-level complete-evidence nesting budget. This release has no runtime override.`,
        valuePointer(),
      );
  };
  const append = (value: unknown): void => {
    const parent = frames.at(-1);
    if (parent === undefined) result = value;
    else if (parent.kind === "array") parent.items.push(value);
    else {
      if (parent.pendingKey === undefined)
        throw new TypeError(
          "JSON visitor omitted an object property identity.",
        );
      parent.members.set(parent.pendingKey, value);
      delete parent.pendingKey;
    }
  };
  visit(
    text,
    {
      onObjectBegin: () => {
        admitContainer();
        frames.push({
          kind: "object",
          pointer: valuePointer(),
          members: new Map(),
        });
      },
      onObjectProperty: (key) => {
        // Prototype-named members are kept as ordinary own properties: the
        // members map keys them without prototype setters, and
        // Object.fromEntries materializes them as own data properties.
        const frame = frames.at(-1);
        if (frame?.kind !== "object")
          throw new TypeError(
            "JSON visitor emitted a property outside an object.",
          );
        if (frame.members.has(key))
          throw new CaptureFormatError(
            "format",
            `${format} JSON contains duplicate object members.`,
          );
        frame.pendingKey = key;
      },
      onObjectEnd: () => {
        const frame = frames.pop();
        if (frame?.kind !== "object")
          throw new TypeError("JSON visitor ended an unexpected object.");
        append(Object.fromEntries(frame.members));
      },
      onArrayBegin: () => {
        admitContainer();
        frames.push({ kind: "array", pointer: valuePointer(), items: [] });
      },
      onArrayEnd: () => {
        const frame = frames.pop();
        if (frame?.kind !== "array")
          throw new TypeError("JSON visitor ended an unexpected array.");
        append(frame.items);
      },
      onLiteralValue: (value: unknown, offset, length) => {
        if (typeof value === "number")
          append(new LosslessNumber(text.slice(offset, offset + length)));
        else if (
          value === null ||
          typeof value === "boolean" ||
          typeof value === "string"
        )
          append(value);
        else
          throw new TypeError("JSON visitor emitted an unsupported literal.");
      },
      onError: () => {
        throw new CaptureFormatError("format", `${format} is malformed JSON.`);
      },
    },
    {
      disallowComments: true,
      allowTrailingComma: false,
      allowEmptyContent: false,
    },
  );
  return result;
};

/** UTF-8 JSON decoding skips one permitted BOM and rejects malformed bytes. */
export const decodeCaptureText = (
  bytes: Uint8Array,
  format: "HAR" | "qlog",
): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CaptureFormatError(
      "format",
      `${format} is not valid UTF-8 JSON.`,
    );
  }
};

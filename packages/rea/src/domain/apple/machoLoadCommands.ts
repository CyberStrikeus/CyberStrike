import { err, ok, type Result } from "../result.js";
import {
  machoLoadCommandAlignment,
  readMachoHeaderPrefixFacts,
} from "./machoContainer.js";

/** Header commitments needed to walk commands without retaining their payloads. */
export interface MachoLoadCommandTableHeader {
  readonly headerSize: 28 | 32;
  readonly wide: boolean;
  readonly littleEndian: boolean;
  readonly commandCount: number;
  readonly commandBytes: number;
}

export interface MachoHeaderDeclarations extends MachoLoadCommandTableHeader {
  readonly fileType: number;
  readonly identity: { readonly cpuType: number; readonly cpuSubtype: number };
}

/** Decode the common 28-byte header without requiring the 64-bit reserved word. */
export const readMachoHeaderDeclarations = (
  bytes: Uint8Array,
  fileSize: number,
): Result<MachoHeaderDeclarations | null, string> => {
  const prefix = readMachoHeaderPrefixFacts(bytes);
  if (prefix.format === null) return ok(null);
  const { wide, headerSize, littleEndian } = prefix.format;
  if (bytes.byteLength < 28 || prefix.identity === null)
    return err(
      `truncated Mach-O header: a ${wide ? 64 : 32}-bit header needs ${headerSize} bytes; the file has ${fileSize}`,
    );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const commandBytes = view.getUint32(20, littleEndian);
  return ok({
    headerSize,
    wide,
    littleEndian,
    commandCount: view.getUint32(16, littleEndian),
    commandBytes,
    fileType: view.getUint32(12, littleEndian),
    identity: prefix.identity,
  });
};

/** Require the full declared 28/32-byte thin header, without admitting its command table. */
export const readMachoLoadCommandDeclarations = (
  bytes: Uint8Array,
  fileSize: number,
): Result<MachoHeaderDeclarations | null, string> => {
  const parsed = readMachoHeaderDeclarations(bytes, fileSize);
  if (!parsed.ok || parsed.value === null) return parsed;
  const { wide, headerSize } = parsed.value;
  if (bytes.byteLength < headerSize)
    return err(
      `truncated Mach-O header: a ${wide ? 64 : 32}-bit header needs ${headerSize} bytes; the file has ${fileSize}`,
    );
  return parsed;
};

/** Admit the declared command table within the complete file's extent. */
export const readMachoLoadCommandTableHeader = (
  bytes: Uint8Array,
  fileSize: number,
): Result<MachoHeaderDeclarations | null, string> => {
  const parsed = readMachoLoadCommandDeclarations(bytes, fileSize);
  if (!parsed.ok || parsed.value === null) return parsed;
  const { commandBytes, headerSize } = parsed.value;
  if (commandBytes > fileSize - headerSize)
    return err(
      `truncated Mach-O load commands: the header declares ${commandBytes} bytes after its ${headerSize}-byte header; the file has ${fileSize}`,
    );
  return parsed;
};

/** One owner's count, alignment and extent proof for a sequential command walk. */
export class MachoLoadCommandCursor {
  #index = 0;
  #offset = 0;

  constructor(
    private readonly table: Pick<
      MachoLoadCommandTableHeader,
      "wide" | "littleEndian" | "commandCount" | "commandBytes"
    >,
  ) {}

  /** Offset relative to the command table; null when every declared row was read. */
  get nextOffset(): number | null {
    return this.#index < this.table.commandCount ? this.#offset : null;
  }

  /** Consume exactly one command's eight-byte header, leaving its payload to callers. */
  read(bytes: Uint8Array): Result<
    {
      readonly index: number;
      readonly offset: number;
      readonly command: number;
      readonly size: number;
    },
    string
  > {
    const { commandBytes, littleEndian, wide } = this.table;
    if (this.#offset + 8 > commandBytes || bytes.byteLength < 8)
      return err(`load command ${this.#index} starts beyond sizeofcmds`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = view.getUint32(4, littleEndian);
    if (
      size < 8 ||
      size % machoLoadCommandAlignment(wide) !== 0 ||
      size > commandBytes - this.#offset
    )
      return err(
        `load command ${this.#index} at offset ${this.#offset} has invalid cmdsize ${size}`,
      );
    const frame = {
      index: this.#index,
      offset: this.#offset,
      command: view.getUint32(0, littleEndian),
      size,
    };
    this.#index += 1;
    this.#offset += size;
    return ok(frame);
  }

  /** A successful walk must exhaust both ncmds and sizeofcmds. */
  finish(): Result<null, string> {
    return this.#index === this.table.commandCount &&
      this.#offset === this.table.commandBytes
      ? ok(null)
      : err(
          `load commands declare ${this.table.commandCount} commands but sizeofcmds holds ${this.table.commandBytes} bytes`,
        );
  }
}

export type MachoCommandStringFailure =
  | {
      readonly _tag: "InvalidMachoCommandString";
      readonly reason: "truncated-offset" | "unterminated";
    }
  | {
      readonly _tag: "InvalidMachoCommandString";
      readonly reason: "invalid-offset";
      readonly offset: number;
    };

/** Locate an lc_str payload within one admitted command; callers own text interpretation. */
export const readMachoCommandStringBytes = (
  body: Uint8Array,
  minimumOffset: number,
  littleEndian: boolean,
): Result<
  { readonly offset: number; readonly bytes: Uint8Array },
  MachoCommandStringFailure
> => {
  if (body.byteLength < 12)
    return err({
      _tag: "InvalidMachoCommandString",
      reason: "truncated-offset",
    });
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const offset = view.getUint32(8, littleEndian);
  if (offset < minimumOffset || offset >= body.byteLength)
    return err({
      _tag: "InvalidMachoCommandString",
      reason: "invalid-offset",
      offset,
    });
  const end = body.indexOf(0, offset);
  if (end < 0)
    return err({ _tag: "InvalidMachoCommandString", reason: "unterminated" });
  return ok({ offset, bytes: body.subarray(offset, end) });
};

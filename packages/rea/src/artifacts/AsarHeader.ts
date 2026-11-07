import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { readFileHandleRange } from "../filesystem/readFileHandleRange.js";

import { assertArtifactReadActive } from "./ArtifactFileOperation.js";
import { ArtifactReaderFailure } from "./ArtifactReader.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  ASAR_HEADER_ADMISSION_SETTING,
  DEFAULT_ASAR_HEADER_ADMISSION,
  parseAsarHeaderAdmission,
  type AsarHeaderAdmission,
} from "../config/asarHeaderAdmission.js";
import {
  DEFAULT_ASAR_MAX_HEADER_BYTES,
  MAXIMUM_ASAR_MAX_HEADER_BYTES,
} from "../domain/analysisResourceLimits.js";

/**
 * Resolve the admission from a composition root's selected environment; an
 * invalid setting is refused, not ignored. Callers without an environment use
 * the default.
 */
export const resolveAsarHeaderAdmission = (
  environment: Readonly<Record<string, string | undefined>>,
): AsarHeaderAdmission => {
  const parsed = parseAsarHeaderAdmission(
    environment[ASAR_HEADER_ADMISSION_SETTING],
  );
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

const MEBIBYTE = 1024 * 1024;

const byteAllowance = (bytes: number): string => {
  const mebibytes = bytes / MEBIBYTE;
  return Number.isInteger(mebibytes)
    ? `${String(mebibytes)} MiB / ${String(bytes)} bytes`
    : `${String(bytes)} bytes`;
};

/** User-visible recovery for the effective ASAR header/index admission budget. */
export const asarHeaderAdmissionRecovery = (
  admission: AsarHeaderAdmission,
): string =>
  [
    `ASAR header/index admission is limited to ${byteAllowance(admission.maximumBytes)}${admission.source === "setting" ? ` by ${ASAR_HEADER_ADMISSION_SETTING}` : ""}.`,
    `On MCP, call update_analysis_settings with setting asar.max_header_bytes, action set, and a value in bytes up to ${byteAllowance(MAXIMUM_ASAR_MAX_HEADER_BYTES)} (default ${byteAllowance(DEFAULT_ASAR_MAX_HEADER_BYTES)}), then retry the original request. It applies to the next operation without restarting REA. For CLI or future REA processes, set ${ASAR_HEADER_ADMISSION_SETTING} in the launch environment.`,
    "Selecting fewer sources or narrowing an internal path does not bypass header admission, because the archive index is read before any member can be selected.",
    "Raising max_heap_mb or available host memory does not raise it.",
    "Alternatively, analyze an extracted application directory, which does not admit an ASAR header.",
    "Repeating the unchanged request fails the same way.",
  ].join(" ");

/** Refuse an ASAR whose header/index exceeds the effective admission budget. */
export const asarHeaderAdmissionFailure = (
  admission: AsarHeaderAdmission,
  requiredBytes?: number,
): ArtifactReaderFailure =>
  new ArtifactReaderFailure("limit", asarHeaderAdmissionRecovery(admission), {
    admission: {
      kind: "asar-header",
      ...admission,
      ...(requiredBytes === undefined ? {} : { requiredBytes }),
    },
  });

/** Absolute archive prefix required to inspect a header under this admission. */
const asarHeaderProbeBytes = (admission: AsarHeaderAdmission): number =>
  admission.maximumBytes + 8;

export interface AsarHeaderExtents {
  readonly archiveBytes: number;
  readonly headerBytes: number;
  readonly jsonBytes: number;
}

export type AsarHeaderProbeExtents = Pick<
  AsarHeaderExtents,
  "headerBytes" | "jsonBytes"
> & { readonly archiveBytes?: number };

export type AsarHeaderProbeObservation =
  | {
      readonly state: "pending";
      readonly extents?: AsarHeaderProbeExtents;
      readonly scannedJsonBytes: number;
    }
  | {
      /** The declared JSON begins with an object token; this does not validate JSON. */
      readonly state: "matched";
      readonly extents: AsarHeaderProbeExtents;
      readonly signatureOffset: number;
      readonly scannedJsonBytes: number;
    }
  | {
      readonly state: "rejected";
      readonly reason:
        | "invalid-pickle-extents"
        | "archive-too-short"
        | "json-not-object";
      readonly extents?: AsarHeaderProbeExtents;
      readonly scannedJsonBytes: number;
    }
  | {
      readonly state: "limit";
      readonly extents?: AsarHeaderProbeExtents;
      readonly scannedJsonBytes: number;
      readonly limitBytes: number;
      readonly admission: AsarHeaderAdmission;
    };

export type FinalAsarHeaderProbeObservation = Exclude<
  AsarHeaderProbeObservation,
  { readonly state: "pending" }
>;

/**
 * Parse the fixed two-Pickle prefix and optionally check it against the actual
 * observed archive size. This establishes byte extents only; JSON validity and
 * the ASAR header schema belong to the decoder at the interpretation boundary.
 */
const parseAsarHeaderExtents = (
  prefix: Uint8Array,
  archiveBytes?: number,
): Result<Omit<AsarHeaderExtents, "archiveBytes">, ArtifactReaderFailure> => {
  if (prefix.byteLength < 16)
    return err(
      new ArtifactReaderFailure(
        "format",
        "Truncated ASAR Pickle extent prefix",
      ),
    );
  const bytes = Buffer.from(prefix.buffer, prefix.byteOffset, 16);
  const headerBytes = bytes.readUInt32LE(4);
  const payloadBytes = bytes.readUInt32LE(8);
  const jsonBytes = bytes.readUInt32LE(12);
  if (
    bytes.readUInt32LE(0) !== 4 ||
    headerBytes < 8 ||
    payloadBytes !== headerBytes - 4 ||
    jsonBytes > payloadBytes - 4
  )
    return err(
      new ArtifactReaderFailure(
        "format",
        "ASAR header has invalid Pickle extents",
      ),
    );
  if (
    archiveBytes !== undefined &&
    (!Number.isSafeInteger(archiveBytes) ||
      archiveBytes < 8 ||
      headerBytes > archiveBytes - 8)
  )
    return err(
      new ArtifactReaderFailure(
        "format",
        "ASAR header leaves its observed container",
      ),
    );
  return ok({ headerBytes, jsonBytes });
};

/**
 * Bounded ASAR signature probe. It retains only the 16-byte fixed prefix and
 * scans the declared JSON bytes until the first non-JSON-whitespace byte.
 */
export interface AsarHeaderSignatureProbe {
  readonly admission: AsarHeaderAdmission;
  readonly limit: number;
  readonly observation: AsarHeaderProbeObservation;
  write(input: Uint8Array): AsarHeaderProbeObservation;
  finish(archiveBytes: number): FinalAsarHeaderProbeObservation;
}

class AsarHeaderSignatureProbeImpl implements AsarHeaderSignatureProbe {
  readonly limit: number;
  readonly #fixed = Buffer.alloc(16);
  #fixedBytes = 0;
  #scannedJsonBytes = 0;
  #extents: Omit<AsarHeaderExtents, "archiveBytes"> | undefined;
  #stop: ProbeStop = { state: "pending" };

  constructor(readonly admission: AsarHeaderAdmission) {
    this.limit = asarHeaderProbeBytes(admission);
  }

  get observation(): AsarHeaderProbeObservation {
    return this.#observation();
  }

  /** Consume sequential archive bytes without retaining JSON or member data. */
  write(input: Uint8Array): AsarHeaderProbeObservation {
    if (this.#stop.state === "finalized") return this.#stop.observation;
    const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    let offset = 0;
    while (offset < bytes.length && !this.#isTerminal()) {
      if (this.#fixedBytes < this.#fixed.length) {
        const count = Math.min(
          this.#fixed.length - this.#fixedBytes,
          bytes.length - offset,
        );
        bytes.copy(this.#fixed, this.#fixedBytes, offset, offset + count);
        this.#fixedBytes += count;
        offset += count;
        if (this.#fixedBytes === this.#fixed.length) this.#parseFixed();
        continue;
      }
      const extents = this.#extents;
      if (extents === undefined || this.#stop.state === "matched") break;
      const jsonRemaining = extents.jsonBytes - this.#scannedJsonBytes;
      if (jsonRemaining <= 0) {
        this.#stop = { state: "rejected", reason: "json-not-object" };
        break;
      }
      const archiveBytesScanned = 16 + this.#scannedJsonBytes;
      if (archiveBytesScanned >= this.limit) {
        this.#stop = { state: "limit" };
        break;
      }
      const count = Math.min(
        bytes.length - offset,
        jsonRemaining,
        this.limit - archiveBytesScanned,
      );
      for (let index = 0; index < count; index += 1) {
        const value = bytes[offset + index]!;
        if (!isJsonWhitespace(value)) {
          if (value === 0x7b)
            this.#stop = {
              state: "matched",
              signatureOffset: 16 + this.#scannedJsonBytes,
              extents,
            };
          else this.#stop = { state: "rejected", reason: "json-not-object" };
          break;
        }
        this.#scannedJsonBytes += 1;
      }
      offset += count;
      if (this.#stop.state !== "pending") break;
      if (this.#scannedJsonBytes >= extents.jsonBytes) {
        this.#stop = { state: "rejected", reason: "json-not-object" };
        break;
      }
      if (16 + this.#scannedJsonBytes >= this.limit)
        this.#stop = { state: "limit" };
    }
    return this.#observation();
  }

  /** Finalize against the actual byte count; a signature alone is not validity. */
  finish(archiveBytes: number): FinalAsarHeaderProbeObservation {
    if (this.#stop.state === "finalized") return this.#stop.observation;
    if (this.#fixedBytes < this.#fixed.length) {
      this.#stop = { state: "rejected", reason: "invalid-pickle-extents" };
    } else if (this.#extents !== undefined) {
      if (
        !Number.isSafeInteger(archiveBytes) ||
        archiveBytes < 8 ||
        this.#extents.headerBytes > archiveBytes - 8
      ) {
        this.#stop = { state: "rejected", reason: "archive-too-short" };
      } else if (
        this.#extents.headerBytes > this.admission.maximumBytes &&
        this.#stop.state === "matched"
      ) {
        this.#stop = { state: "limit" };
      }
    }
    const observation = this.#observation(archiveBytes);
    this.#stop = { state: "finalized", observation };
    return observation;
  }

  #parseFixed(): void {
    const result = parseAsarHeaderExtents(this.#fixed);
    if (!result.ok) {
      this.#stop = { state: "rejected", reason: "invalid-pickle-extents" };
      return;
    }
    this.#extents = result.value;
    if (this.#extents.jsonBytes === 0)
      this.#stop = { state: "rejected", reason: "json-not-object" };
  }

  #isTerminal(): boolean {
    return this.#stop.state !== "pending";
  }

  #observation(): AsarHeaderProbeObservation;
  #observation(archiveBytes: number): FinalAsarHeaderProbeObservation;
  #observation(
    archiveBytes?: number,
  ): AsarHeaderProbeObservation | FinalAsarHeaderProbeObservation {
    if (this.#stop.state === "finalized") return this.#stop.observation;
    const extents: AsarHeaderProbeExtents | undefined =
      this.#extents === undefined
        ? undefined
        : archiveBytes === undefined
          ? this.#extents
          : { archiveBytes, ...this.#extents };
    switch (this.#stop.state) {
      case "rejected":
        return {
          state: "rejected",
          reason: this.#stop.reason,
          ...(extents === undefined ? {} : { extents }),
          scannedJsonBytes: this.#scannedJsonBytes,
        };
      case "limit":
        return {
          state: "limit",
          ...(extents === undefined ? {} : { extents }),
          scannedJsonBytes: this.#scannedJsonBytes,
          limitBytes: this.limit,
          admission: this.admission,
        };
      case "matched":
        return {
          state: "matched",
          extents:
            archiveBytes === undefined
              ? this.#stop.extents
              : { archiveBytes, ...this.#stop.extents },
          signatureOffset: this.#stop.signatureOffset,
          scannedJsonBytes: this.#scannedJsonBytes,
        };
      case "pending":
        if (archiveBytes !== undefined && this.#extents !== undefined) {
          const finalizedExtents = {
            archiveBytes,
            ...this.#extents,
          };
          if (this.#scannedJsonBytes >= this.#extents.jsonBytes)
            return {
              state: "rejected",
              reason: "json-not-object",
              extents: finalizedExtents,
              scannedJsonBytes: this.#scannedJsonBytes,
            };
          return {
            state: "limit",
            extents: finalizedExtents,
            scannedJsonBytes: this.#scannedJsonBytes,
            limitBytes: this.limit,
            admission: this.admission,
          };
        }
        return {
          state: "pending",
          ...(extents === undefined ? {} : { extents }),
          scannedJsonBytes: this.#scannedJsonBytes,
        };
    }
  }
}

type ProbeStop =
  | { readonly state: "pending" }
  | {
      readonly state: "matched";
      readonly signatureOffset: number;
      readonly extents: Omit<AsarHeaderExtents, "archiveBytes">;
    }
  | {
      readonly state: "rejected";
      readonly reason:
        | "invalid-pickle-extents"
        | "archive-too-short"
        | "json-not-object";
    }
  | { readonly state: "limit" }
  | {
      readonly state: "finalized";
      readonly observation: FinalAsarHeaderProbeObservation;
    };

const isJsonWhitespace = (value: number): boolean =>
  value === 0x20 || value === 0x09 || value === 0x0a || value === 0x0d;

/** Admit Pickle extents before an upstream decoder allocates them. */
export const admitAsarHeader = async (
  handle: Pick<FileHandle, "read"> & { stat(): Promise<Stats> },
  signal?: AbortSignal,
  admission: AsarHeaderAdmission = DEFAULT_ASAR_HEADER_ADMISSION,
): Promise<AsarHeaderExtents> => {
  assertArtifactReadActive(signal);
  const observed = await handle.stat();
  assertArtifactReadActive(signal);
  if (!observed.isFile())
    throw new ArtifactReaderFailure(
      "format",
      "ASAR container is not a regular file",
    );
  const prefix = await readFileHandleRange(handle, 0, 16, () =>
    assertArtifactReadActive(signal),
  );
  assertArtifactReadActive(signal);
  if (prefix.length !== 16)
    throw new ArtifactReaderFailure("format", "Truncated ASAR size pickle");
  const parsed = parseAsarHeaderExtents(prefix, observed.size);
  if (!parsed.ok) throw parsed.error;
  if (parsed.value.headerBytes > admission.maximumBytes)
    throw asarHeaderAdmissionFailure(admission, parsed.value.headerBytes);
  return {
    archiveBytes: observed.size,
    ...parsed.value,
  };
};

export const createAsarHeaderSignatureProbe = (
  admission: AsarHeaderAdmission = DEFAULT_ASAR_HEADER_ADMISSION,
): AsarHeaderSignatureProbe => new AsarHeaderSignatureProbeImpl(admission);

/** Decode only admitted JSON bytes from the same owned descriptor as its extents. */
export const readAsarHeader = async (
  handle: Pick<FileHandle, "read">,
  extents: AsarHeaderExtents,
  signal?: AbortSignal,
): Promise<unknown> => {
  const bytes = await readFileHandleRange(handle, 16, extents.jsonBytes, () =>
    assertArtifactReadActive(signal),
  );
  assertArtifactReadActive(signal);
  if (bytes.length !== extents.jsonBytes)
    throw new ArtifactReaderFailure("format", "Truncated ASAR JSON header");
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch (cause: unknown) {
    throw new ArtifactReaderFailure(
      "format",
      "ASAR JSON header is not valid UTF-8",
      { cause },
    );
  }
  return JSON.parse(json) as unknown;
};

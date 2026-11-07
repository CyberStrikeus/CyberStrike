import { createHash, type Hash } from "node:crypto";

import { err, ok, type Result } from "../result.js";
import {
  deriveEspImage,
  type EspImage,
  type ObservedSegmentHeader,
} from "./espImageFacts.js";
import {
  ESP_APP_DESC_BYTES,
  ESP_FLASH_SECTOR_BYTES,
  ESP_IMAGE_DIGEST_BYTES,
  ESP_IMAGE_SEGMENT_HEADER_BYTES,
  firstUnerased,
  offsetText,
  u32,
} from "./espImageStructures.js";

/*
 * Layout facts from ESP-IDF v6.1 (`esp_app_format.h`, `esp_image_format.c`
 * and `docs/en/security/secure-boot-v2.rst`) and esptool v5.6.0
 * (`bin_image.py`, `cmds.py`, `loader.py`, `targets/esp8266.py`).
 */
export const ESP_IMAGE_MAGIC = 0xe9;
export const ESP_IMAGE_HEADER_BYTES = 24;
export const ESP_IMAGE_MAX_SEGMENTS = 16;
const CHECKSUM_SEED = 0xef;
/** `esp_image_spi_freq_t` values; every esptool target uses only these. */
const SPI_SPEEDS = new Set([0x0, 0x1, 0x2, 0xf]);
/** The last `esp_image_spi_mode_t` value, `ESP_IMAGE_SPI_MODE_SLOW_READ`. */
const LAST_SPI_MODE = 5;
/**
 * Where an ESP8266 image's first segment loads: DRAM and IRAM from esptool
 * `ESP8266ROM.MEMORY_MAP`, IRAM extended through the cache area Arduino's
 * eboot links at 0x4010F000, and esptool's IROM window
 * (`IROM_MAP_START`-`IROM_MAP_END`), where v3 and Arduino images begin.
 */
const ESP8266_LOAD_REGIONS = [
  [0x3ffe_8000, 0x4000_0000],
  [0x4010_0000, 0x4011_0000],
  [0x4020_0000, 0x4030_0000],
] as const;

export const ESP8266_REFUSAL =
  "ESP8266 firmware images are not supported: they share the 0xE9 magic but have an 8-byte header without the ESP32 extended header";

export type EspImageRecognition = "esp-image" | "esp8266";

/** A whole-image refusal; no partial facts accompany it. */
export interface EspImageFailure {
  readonly kind: "format" | "unsupported";
  readonly message: string;
}

export interface EspImageDecoder {
  /** Consume the next file bytes in order; chunks may split any field. */
  write(chunk: Uint8Array): void;
  /** True once later bytes can no longer change the result. */
  readonly satisfied: boolean;
  /** Decode after `satisfied` or after the last byte of the file. */
  finish(): Result<EspImage, EspImageFailure>;
}

const alignUp = (value: number, alignment: number): number =>
  Math.ceil(value / alignment) * alignment;

/**
 * Header-level recognition. An ESP8266 v1 or v3 image has its first segment
 * header at offset 8, loading into ESP8266 memory; an ESP32-family header
 * holds `wp_pin` and drive settings there, which esptool and ESP-IDF write
 * as 0xEE and zeros.
 */
const recognizeHeader = (
  prefix: Uint8Array,
  fileSize: number,
): EspImageRecognition | undefined => {
  if (!Number.isSafeInteger(fileSize) || prefix[0] !== ESP_IMAGE_MAGIC)
    return undefined;
  const count = prefix[1] ?? 0;
  if (count > ESP_IMAGE_MAX_SEGMENTS) return undefined;
  if (count > 0 && prefix.length >= 16 && fileSize >= 16) {
    const firstLoad = u32(prefix, 8);
    if (
      ESP8266_LOAD_REGIONS.some(
        ([low, high]) => firstLoad >= low && firstLoad < high,
      ) &&
      u32(prefix, 12) % 4 === 0
    )
      return "esp8266";
  }
  if (
    fileSize < ESP_IMAGE_HEADER_BYTES ||
    prefix.length < ESP_IMAGE_HEADER_BYTES
  )
    return undefined;
  // Values outside ESP-IDF's enums, and a hash_appended byte esptool refuses.
  return (prefix[2] ?? 0) > LAST_SPI_MODE ||
    !SPI_SPEEDS.has((prefix[3] ?? 0) & 0x0f) ||
    (prefix[23] ?? 0) > 1
    ? undefined
    : "esp-image";
};

/**
 * Recognize an image by its leading bytes and size, never by name: the
 * header checks, at least one segment, and a word-aligned first segment
 * length when the file holds that header. A zero count is valid but loads
 * nothing and would admit x86 programs that begin `E9 00`. Later segments,
 * the checksum and the digest are integrity facts, so truncation after the
 * first segment header leaves the image recognized.
 */
export const recognizeEspImage = (
  prefix: Uint8Array,
  fileSize: number,
): EspImageRecognition | undefined => {
  const recognized = recognizeHeader(prefix, fileSize);
  const firstHeaderEnd =
    ESP_IMAGE_HEADER_BYTES + ESP_IMAGE_SEGMENT_HEADER_BYTES;
  if (recognized !== "esp-image") return recognized;
  if (prefix[1] === 0) return undefined;
  if (fileSize < firstHeaderEnd) return recognized;
  if (prefix.length < firstHeaderEnd) return undefined;
  return u32(prefix, 28) % 4 === 0 ? "esp-image" : undefined;
};

/** Start a decoder that reads each byte once and retains bounded state. */
export const createEspImageDecoder = (fileSize: number): EspImageDecoder =>
  new StreamingEspImageDecoder(fileSize);

/** File regions in order; each ends where the next begins. */
type Stage =
  | "header"
  | "segment-header"
  | "segment-data"
  | "padding"
  | "checksum"
  | "digest"
  | "gap"
  | "sector"
  | "rest";

class StreamingEspImageDecoder implements EspImageDecoder {
  readonly #fileSize: number;
  readonly #header = new Uint8Array(ESP_IMAGE_HEADER_BYTES);
  readonly #segmentHeader = new Uint8Array(ESP_IMAGE_SEGMENT_HEADER_BYTES);
  readonly #segments: ObservedSegmentHeader[] = [];
  readonly #descriptor = new Uint8Array(ESP_APP_DESC_BYTES);
  readonly #digest = new Uint8Array(ESP_IMAGE_DIGEST_BYTES);
  readonly #sector = new Uint8Array(ESP_FLASH_SECTOR_BYTES);
  /** Hash every byte before the sector; signatures cover all of them. */
  readonly #sha256: Hash = createHash("sha256");
  readonly #sha384: Hash = createHash("sha384");
  #stage: Stage = "header";
  #position = 0;
  #regionStart = 0;
  #regionEnd = ESP_IMAGE_HEADER_BYTES;
  #segmentCount = 0;
  #checksum = CHECKSUM_SEED;
  #descriptorBytes = 0;
  #checksumOffset: number | undefined;
  #storedChecksum: number | undefined;
  #imageSha256: string | undefined;
  #imageEnd: number | undefined;
  #sectorOffset: number | undefined;
  #gapFirstUnerased: number | undefined;
  #restFirstUnerased: number | undefined;
  #contentSha256: string | undefined;
  #contentSha384: string | undefined;
  #failure: EspImageFailure | undefined;

  constructor(fileSize: number) {
    this.#fileSize = fileSize;
  }

  /** Reading stops at the first byte after the sector that is not erased. */
  get satisfied(): boolean {
    return (
      this.#failure !== undefined ||
      (this.#stage === "rest" && this.#restFirstUnerased !== undefined)
    );
  }

  write(chunk: Uint8Array): void {
    let index = 0;
    for (;;) {
      // Zero-length regions, such as an empty segment, end immediately.
      while (!this.satisfied && this.#position >= this.#regionEnd)
        this.#advance();
      if (this.satisfied || index >= chunk.length) return;
      const length = Math.min(
        chunk.length - index,
        this.#regionEnd - this.#position,
      );
      this.#consume(chunk.subarray(index, index + length));
      index += length;
    }
  }

  finish(): Result<EspImage, EspImageFailure> {
    if (this.#failure !== undefined) return err(this.#failure);
    if (!this.satisfied && this.#position !== this.#fileSize)
      return err({
        kind: "format",
        message: `ESP image input ended at offset ${offsetText(this.#position)}, before the admitted size ${offsetText(this.#fileSize)}`,
      });
    if (this.#stage === "header")
      return err({
        kind: "format",
        message: `ESP image header needs ${String(ESP_IMAGE_HEADER_BYTES)} bytes; the file holds ${String(this.#position)}`,
      });
    return ok(
      deriveEspImage({
        fileSize: this.#fileSize,
        observedEnd: this.#position,
        header: this.#header,
        segments: this.#segments,
        descriptorBytes: this.#descriptor.subarray(0, this.#descriptorBytes),
        checksum: this.#checksum,
        checksumOffset: this.#checksumOffset,
        storedChecksum: this.#storedChecksum,
        imageSha256: this.#imageSha256,
        storedDigest: this.#digest,
        imageEnd: this.#imageEnd,
        sectorOffset: this.#sectorOffset,
        gapFirstUnerased: this.#gapFirstUnerased,
        sector: this.#sector,
        restFirstUnerased: this.#restFirstUnerased,
        signedContent: {
          sha256: this.#contentSha256,
          sha384: this.#contentSha384,
        },
      }),
    );
  }

  #consume(bytes: Uint8Array): void {
    const within = this.#position - this.#regionStart;
    switch (this.#stage) {
      case "header":
        this.#header.set(bytes, this.#position);
        break;
      case "segment-header":
        this.#segmentHeader.set(bytes, within);
        break;
      case "segment-data": {
        let checksum = this.#checksum;
        for (let index = 0; index < bytes.length; index += 1)
          checksum ^= bytes[index] ?? 0;
        this.#checksum = checksum;
        if (
          this.#segments.length === 1 &&
          this.#descriptorBytes < ESP_APP_DESC_BYTES
        ) {
          const captured = bytes.subarray(
            0,
            ESP_APP_DESC_BYTES - this.#descriptorBytes,
          );
          this.#descriptor.set(captured, this.#descriptorBytes);
          this.#descriptorBytes += captured.length;
        }
        break;
      }
      case "checksum":
        this.#storedChecksum = bytes[0];
        break;
      case "digest":
        this.#digest.set(bytes, within);
        break;
      case "gap":
        this.#gapFirstUnerased ??= firstUnerased(bytes, this.#position);
        break;
      case "sector":
        this.#sector.set(bytes, within);
        break;
      case "rest":
        this.#restFirstUnerased ??= firstUnerased(bytes, this.#position);
        break;
      case "padding":
        break;
    }
    // Regions never span the sector boundary, so this is exact.
    if (
      this.#sectorOffset === undefined ||
      this.#position < this.#sectorOffset
    ) {
      this.#sha256.update(bytes);
      this.#sha384.update(bytes);
    }
    this.#position += bytes.length;
  }

  /** Enter the next region once the current one is complete. */
  #advance(): void {
    switch (this.#stage) {
      case "header": {
        const recognized = recognizeHeader(this.#header, this.#fileSize);
        if (recognized !== "esp-image") {
          this.#failure =
            recognized === "esp8266"
              ? { kind: "unsupported", message: ESP8266_REFUSAL }
              : {
                  kind: "format",
                  message:
                    "ESP image header is not recognized: it needs magic 0xe9, at most 16 segments, ESP-IDF flash mode and speed codes, and a hash_appended byte of 0 or 1",
                };
          return;
        }
        this.#segmentCount = this.#header[1] ?? 0;
        this.#nextSegment();
        return;
      }
      case "segment-header": {
        const length = u32(this.#segmentHeader, 4);
        this.#segments.push({
          index: this.#segments.length,
          headerOffset: this.#regionStart,
          loadAddress: u32(this.#segmentHeader, 0),
          length,
        });
        this.#enter("segment-data", length);
        return;
      }
      case "segment-data":
        this.#nextSegment();
        return;
      case "padding":
        this.#enter("checksum", 1);
        return;
      case "checksum":
        // The appended digest covers every byte through the checksum.
        this.#imageSha256 = this.#sha256.copy().digest("hex");
        if (this.#header[23] === 1)
          this.#enter("digest", ESP_IMAGE_DIGEST_BYTES);
        else this.#endImage();
        return;
      case "digest":
        this.#endImage();
        return;
      case "gap":
        this.#contentSha256 = this.#sha256.digest("hex");
        this.#contentSha384 = this.#sha384.digest("hex");
        this.#enter("sector", ESP_FLASH_SECTOR_BYTES);
        return;
      case "sector":
        this.#enter("rest", Number.POSITIVE_INFINITY);
        return;
      case "rest":
        return;
    }
  }

  #enter(stage: Stage, length: number): void {
    this.#stage = stage;
    this.#regionStart = this.#position;
    this.#regionEnd = this.#position + length;
  }

  /** Read the next declared segment, or the checksum after the last one. */
  #nextSegment(): void {
    if (this.#segments.length < this.#segmentCount) {
      this.#enter("segment-header", ESP_IMAGE_SEGMENT_HEADER_BYTES);
      return;
    }
    // The checksum is the last byte of the next 16-byte block.
    this.#checksumOffset = alignUp(this.#position + 1, 16) - 1;
    this.#enter("padding", this.#checksumOffset - this.#position);
  }

  #endImage(): void {
    this.#imageEnd = this.#position;
    // A signature sector begins at the next 4 KiB flash sector boundary.
    this.#sectorOffset = alignUp(this.#position, ESP_FLASH_SECTOR_BYTES);
    this.#enter("gap", this.#sectorOffset - this.#position);
  }
}

import { readElfSectionHeader } from "../domain/elfSectionHeader.js";
import { readElfProgramHeader } from "../domain/elfProgramHeader.js";
import { MAX_FLUTTER_BUILD_ID_BYTES } from "../domain/flutter/flutterBuildAnalysis.js";
import type { FileHandle } from "node:fs/promises";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import {
  elfNoteAlignment,
  elfNoteLayout,
  readElfNoteHeader,
} from "../domain/native/elfNoteLayout.js";
import {
  readElfHeader,
  ELF_HEADER_MAX_BYTES,
  type ElfParseFailure,
} from "./DartElf.js";

const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const MAX_BUILD_IDS = 64;
// Range bookkeeping and separate positional reads need a budget independent
// of payload bytes: tiny/overlapping declarations can otherwise fan out I/O.
const MAX_NOTE_RANGES = 1024;

export interface ElfBuildIds {
  readonly candidates: readonly string[];
  readonly failures: readonly ElfParseFailure[];
}

/** Read only ELF-declared PT_NOTE/SHT_NOTE ranges from one owned engine image. */
export const readElfBuildIds = async (
  file: FileHandle,
  totalBytes: number,
  signal: AbortSignal | undefined,
): Promise<ElfBuildIds> => {
  const candidates = new Set<string>();
  const failures: ElfParseFailure[] = [];
  const failure = (reason: string): ElfBuildIds => ({
    candidates: [...candidates],
    failures: [...failures, { reason }],
  });
  let examined = 0;
  const read = async (offset: number, size: number): Promise<Buffer | null> => {
    signal?.throwIfAborted();
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(size) ||
      offset < 0 ||
      size < 0 ||
      size > totalBytes - offset ||
      size > MAX_METADATA_BYTES - examined
    )
      return null;
    examined += size;
    const bytes = Buffer.alloc(size);
    let copied = 0;
    while (copied < size) {
      const result = await file.read(
        bytes,
        copied,
        size - copied,
        offset + copied,
      );
      signal?.throwIfAborted();
      if (result.bytesRead === 0) return null;
      copied += result.bytesRead;
    }
    return bytes;
  };
  const prefix = await read(0, Math.min(totalBytes, ELF_HEADER_MAX_BYTES));
  if (prefix === null) return failure("ELF header could not be read");
  const parsed = readElfHeader(prefix, totalBytes);
  if (parsed.failure !== undefined) return failure(parsed.failure.reason);
  const h = parsed.header;
  const ranges = new Map<
    string,
    { offset: number; size: number; alignment: number }
  >();
  let compressedNotes = false;
  tables: for (const table of [
    {
      offset: h.e_phoff,
      width: h.e_phentsize,
      count: h.e_phnum,
      program: true,
    },
    {
      offset: h.e_shoff,
      width: h.e_shentsize,
      count: h.e_shnum,
      program: false,
    },
  ]) {
    const bytes = await read(table.offset, table.width * table.count);
    if (bytes === null)
      return failure(
        "ELF note tables exceed the 8 MiB metadata budget or are truncated",
      );
    for (let index = 0; index < table.count; index += 1) {
      if (index % 4096 === 0) {
        await yieldToEventLoop();
        signal?.throwIfAborted();
      }
      const base = index * table.width;
      const parsedRecord = table.program
        ? readElfProgramHeader(
            bytes.subarray(base, base + table.width),
            h.is64 ? 64 : 32,
            true,
          )
        : readElfSectionHeader(
            bytes.subarray(base, base + table.width),
            h.is64 ? 64 : 32,
            true,
          );
      if (!parsedRecord.ok) return failure(parsedRecord.error.message);
      const record = parsedRecord.value;
      if (record.type !== (table.program ? 4 : 7)) continue;
      const offset = Number(record.offset);
      const size = Number("fileSize" in record ? record.fileSize : record.size);
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(size) ||
        size > totalBytes - offset
      )
        return failure("ELF note range is not file-backed");
      if ("size" in record) {
        if ((record.flags & 0x800n) !== 0n) {
          if (!compressedNotes) {
            failures.push({
              reason: "Compressed ELF note sections are unsupported",
            });
            compressedNotes = true;
          }
          continue;
        }
      }
      if (size === 0) continue;
      const alignment = elfNoteAlignment(record.alignment);
      const key = `${offset}:${size}:${alignment}`;
      if (ranges.has(key)) continue;
      if (ranges.size === MAX_NOTE_RANGES) {
        failures.push({
          reason:
            "ELF notes exceed the 1024-range note-range inventory/read budget",
        });
        break tables;
      }
      ranges.set(key, { offset, size, alignment });
    }
  }
  for (const range of ranges.values()) {
    const notes = await read(range.offset, range.size);
    if (notes === null)
      return failure(
        "ELF notes exceed the 8 MiB metadata budget or are truncated",
      );
    let yieldedAt = 0;
    for (let at = 0; at < notes.length;) {
      if (at - yieldedAt >= 64 * 1024) {
        await yieldToEventLoop();
        signal?.throwIfAborted();
        yieldedAt = at;
      }
      if (notes.length - at < 12) {
        if (notes.subarray(at).some((byte) => byte !== 0))
          return failure("ELF note header is truncated");
        break;
      }
      const parsedHeader = readElfNoteHeader(notes.subarray(at, at + 12), true);
      if (!parsedHeader.ok) return failure(parsedHeader.error.message);
      const { namesz, descsz, type } = parsedHeader.value;
      const layout = elfNoteLayout(namesz, descsz, range.alignment);
      const descriptor = at + layout.descriptor;
      const end = descriptor + descsz;
      if (end > notes.length)
        return failure("ELF note descriptor exceeds its declared note range");
      if (
        namesz === 4 &&
        type === 3 &&
        notes.subarray(at + 12, at + 16).equals(Buffer.from("GNU\0"))
      ) {
        if (descsz < 1 || descsz > MAX_FLUTTER_BUILD_ID_BYTES)
          return failure(
            `GNU build-id descriptor is outside the 1–${MAX_FLUTTER_BUILD_ID_BYTES} byte projection`,
          );
        const candidate = notes.subarray(descriptor, end).toString("hex");
        if (!candidates.has(candidate) && candidates.size === MAX_BUILD_IDS)
          return failure(
            "ELF build-id candidates exceed the 64-value evidence budget",
          );
        candidates.add(candidate);
      }
      at += layout.next;
    }
  }
  signal?.throwIfAborted();
  return { candidates: [...candidates], failures };
};

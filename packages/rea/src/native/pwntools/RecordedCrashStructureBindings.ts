import { readElfHeaderFacts } from "../../domain/elfFixedHeader.js";
import { readElfNoteHeader } from "../../domain/native/elfNoteLayout.js";
import { readElfSectionHeader } from "../../domain/elfSectionHeader.js";
import { readElfProgramHeader } from "../../domain/elfProgramHeader.js";
import { readElfRawTableDeclarations } from "../../domain/elfRawTableDeclarations.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import {
  RECORDED_LINUX_CORE_PROFILES,
  type RecordedCrash,
  type RecordedCrashArchitecture,
} from "../../domain/native/recordedCrash.js";

// Pinned pyelftools 0.33 display projections depend on the machine. Validate
// them separately from the original numeric p_type identity bound below.
const baseSegmentKinds = new Map([
  [0, "PT_NULL"],
  [1, "PT_LOAD"],
  [2, "PT_DYNAMIC"],
  [3, "PT_INTERP"],
  [4, "PT_NOTE"],
  [5, "PT_SHLIB"],
  [6, "PT_PHDR"],
  [7, "PT_TLS"],
  [0x60000000, "PT_LOOS"],
  [0x6fffffff, "PT_HIOS"],
  [0x6474e550, "PT_GNU_EH_FRAME"],
  [0x6474e551, "PT_GNU_STACK"],
  [0x6474e552, "PT_GNU_RELRO"],
  [0x6474e553, "PT_GNU_PROPERTY"],
]);
const segmentKinds: Readonly<
  Record<RecordedCrashArchitecture, ReadonlyMap<number, string>>
> = {
  "x86_64-little-endian": baseSegmentKinds,
  "aarch64-little-endian": new Map([
    ...baseSegmentKinds,
    [0x70000000, "PT_AARCH64_ARCHEXT"],
    [0x70000001, "PT_AARCH64_UNWIND"],
  ]),
};
const matchesKind = (
  raw: number,
  reported: string | number,
  kinds: ReadonlyMap<number, string>,
): boolean => {
  const known = kinds.get(raw);
  return typeof reported === "string"
    ? reported === known
    : known === undefined && reported === raw;
};

const segmentMatches = (
  segment: RecordedCrash["segments"][number],
  raw: Buffer,
  kinds: ReadonlyMap<number, string>,
): boolean => {
  const parsed = readElfProgramHeader(raw, 64, true);
  if (!parsed.ok) return false;
  const program = parsed.value;
  const { type } = program;
  return (
    type === segment.type_id &&
    matchesKind(type, segment.type, kinds) &&
    BigInt(segment.flags) === BigInt(program.flags) &&
    segment.file_backing ===
      (type === 0 || program.fileSize === 0n ? "none" : "file") &&
    (
      [
        [segment.offset, program.offset],
        [segment.virtual_address, program.virtualAddress],
        [segment.physical_address, program.physicalAddress],
        [segment.file_size, program.fileSize],
        [segment.memory_size, program.memorySize],
        [segment.alignment, program.alignment],
      ] as const
    ).every(([field, value]) => BigInt(field) === value)
  );
};

/** Bind coverage-bearing ELF and note headers to the same snapshot as their payloads. */
export function validateRecordedCrashStructure(
  report: RecordedCrash,
  snapshot: Buffer,
  diagnostics: RecordedCrash["decoder_diagnostics"],
): void {
  const fail = () => {
    throw new AnalysisOutputError(
      "inspect_recorded_crash",
      "Reported core structure differs from its original ELF/note headers.",
      { capturedOutput: diagnostics },
    );
  };
  const bytesAt = (offset: bigint, bytes: number): Buffer => {
    if (offset < 0n || offset > BigInt(snapshot.length - bytes)) return fail();
    return snapshot.subarray(Number(offset), Number(offset) + bytes);
  };
  const header = bytesAt(0n, 64);
  const expectedMachine =
    RECORDED_LINUX_CORE_PROFILES[report.architecture].machine;
  const parsedHeader = readElfHeaderFacts(header);
  if (!parsedHeader.ok) return fail();
  const facts = parsedHeader.value;
  if (
    facts.elfClass !== 64 ||
    facts.byteOrder !== "little" ||
    facts.version !== 1 ||
    ![0, 3].includes(facts.osAbi) ||
    facts.abiVersion !== 0 ||
    facts.type !== 4 ||
    facts.machine !== expectedMachine
  )
    fail();
  const rawTables = readElfRawTableDeclarations(header, {
    elfClass: 64,
    byteOrder: "little",
  });
  if (!rawTables.ok) return fail();
  const { programs, sections } = rawTables.value;
  const table = programs.offset;
  const entryBytes = programs.width;
  let count = programs.count;
  if (count === 0xffff) {
    if (sections.width < 64) return fail();
    const zero = readElfSectionHeader(bytesAt(sections.offset, 64), 64, true);
    if (!zero.ok) return fail();
    count = zero.value.info;
  }
  if (count !== report.segments.length || (count > 0 && entryBytes < 56))
    fail();
  for (const segment of report.segments) {
    const offset = table + BigInt(segment.index) * BigInt(entryBytes);
    if (
      BigInt(segment.header_location.offset) !== offset ||
      BigInt(segment.header_location.bytes) !== BigInt(entryBytes)
    )
      fail();
    const raw = bytesAt(offset, entryBytes);
    if (!segmentMatches(segment, raw, segmentKinds[report.architecture]))
      fail();
  }
  for (const note of report.notes) {
    const raw = bytesAt(BigInt(note.location.offset), 12);
    const parsedNote = readElfNoteHeader(raw, true);
    if (!parsedNote.ok) return fail();
    const { namesz, descsz, type } = parsedNote.value;
    if (
      BigInt(note.owner_location.bytes) !== BigInt(namesz) ||
      BigInt(note.descriptor_location.bytes) !== BigInt(descsz) ||
      type !== note.type_id
    )
      fail();
  }
}

import {
  RECORDED_LINUX_CORE_PROFILES,
  type RecordedCrash,
  type RecordedCrashArchitecture,
} from "../../../src/domain/native/recordedCrash.js";

// One note is a 12-byte header, the "CORE\0" owner padded to 8 bytes, then the
// descriptor. The first note starts at the end of the owned header and phdr.
const NOTE_START = 0x80;
const OWNER_START = NOTE_START + 12;
const DESCRIPTOR_START = OWNER_START + 8;
const NOTE_HEADER_BYTES = 20;

const hex = (value: number): string => `0x${value.toString(16)}`;

/** Source-owned observation seam; these bytes do not simulate a verified ELF engine. */
export const recordedCrashFixture = (
  path = "/artifacts/source-owned.core",
  architecture: RecordedCrashArchitecture = "x86_64-little-endian",
): RecordedCrash => {
  const profile = RECORDED_LINUX_CORE_PROFILES[architecture];
  const noteBytes = NOTE_HEADER_BYTES + profile.prstatusBytes;
  const descriptor = Buffer.alloc(profile.prstatusBytes);
  descriptor.writeInt32LE(123, 32);
  descriptor.writeInt16LE(11, 12);
  // One distinguishable register carries a full uint64 so retention is asserted.
  descriptor.writeBigUInt64LE(
    0x1122334455667788n,
    profile.registerOffset + 14 * profile.registerBytes,
  );
  return {
    artifact: {
      path,
      sha256: "a".repeat(64),
      bytes: Math.max(512, DESCRIPTOR_START + profile.prstatusBytes),
    },
    format: "elf-core",
    architecture,
    target_execution: "not-performed",
    live_process_identity: "unknown",
    segments: [
      {
        index: 0,
        type: "PT_NOTE",
        type_id: 4,
        header_location: { offset: "0x40", bytes: "0x38" },
        offset: "0x80",
        file_size: hex(noteBytes),
        memory_size: "0x0",
        virtual_address: "0x0",
        physical_address: "0x0",
        alignment: "0x4",
        flags: "0x0",
        file_backing: "file",
      },
    ],
    notes: [
      {
        index: 0,
        segment_index: 0,
        type: "NT_PRSTATUS",
        type_id: 1,
        location: { offset: hex(NOTE_START), bytes: hex(noteBytes) },
        owner_location: { offset: hex(OWNER_START), bytes: "0x5" },
        owner_bytes_base64: Buffer.from("CORE\0").toString("base64"),
        owner_display: "CORE",
        descriptor_location: {
          offset: hex(DESCRIPTOR_START),
          bytes: hex(profile.prstatusBytes),
        },
        descriptor_bytes_base64: descriptor.toString("base64"),
      },
    ],
    note_padding: [],
    threads: [
      {
        note_index: 0,
        historical_pid: 123,
        recorded_current_signal: 11,
        registers: profile.registers.map((name, index) => ({
          name,
          value: index === 14 ? "0x1122334455667788" : "0x0",
          location: {
            offset: hex(
              DESCRIPTOR_START +
                profile.registerOffset +
                index * profile.registerBytes,
            ),
            bytes: hex(profile.registerBytes),
          },
        })),
      },
    ],
    signals: [],
    debugger: { status: "not-requested" },
    note_interpretation_completeness: "unknown",
    decoder_diagnostics: {
      stdout: "decoder diagnostic",
      stderr: "",
      truncated: false,
    },
    diagnostics: { stdout: "decoder diagnostic", stderr: "", truncated: false },
    limitations: ["Historical PID is recorded metadata."],
  };
};

/** Source-owned SIGSEGV descriptor for scalar/source binding regressions. */
export const recordedCrashSignalFixture = (
  path?: string,
  architecture: RecordedCrashArchitecture = "x86_64-little-endian",
): RecordedCrash => {
  const value = recordedCrashFixture(path, architecture);
  const profile = RECORDED_LINUX_CORE_PROFILES[architecture];
  const descriptor = Buffer.alloc(32);
  descriptor.writeInt32LE(11, 0);
  descriptor.writeInt32LE(-2, 4);
  descriptor.writeInt32LE(1, 8);
  descriptor.writeBigUInt64LE(0x1122334455667788n, 16);
  const prstatusNoteBytes = NOTE_HEADER_BYTES + profile.prstatusBytes;
  const signalNoteStart = NOTE_START + prstatusNoteBytes;
  const signalDescriptorStart = signalNoteStart + NOTE_HEADER_BYTES;
  const signalNoteBytes = NOTE_HEADER_BYTES + 32;
  value.artifact.bytes = Math.max(640, signalDescriptorStart + 32);
  value.segments = value.segments.map((segment) => ({
    ...segment,
    file_size: hex(prstatusNoteBytes + signalNoteBytes),
  }));
  value.notes.push({
    index: 1,
    segment_index: 0,
    type: "NT_SIGINFO",
    type_id: 0x53494749,
    location: { offset: hex(signalNoteStart), bytes: hex(signalNoteBytes) },
    owner_location: { offset: hex(signalNoteStart + 12), bytes: "0x5" },
    owner_bytes_base64: Buffer.from("CORE\0").toString("base64"),
    owner_display: "CORE",
    descriptor_location: {
      offset: hex(signalDescriptorStart),
      bytes: "0x20",
    },
    descriptor_bytes_base64: descriptor.toString("base64"),
  });
  value.signals.push({
    note_index: 1,
    number: 11,
    code: 1,
    errno: -2,
    fault_address: "0x1122334455667788",
    fault_address_meaning: "recorded-sigsegv-address",
    thread_association: "unknown",
  });
  return value;
};

/** Source-owned ELF64 NT_FILE descriptor with exact pathname bytes. */
export const recordedCrashFileMappingFixture = (
  paths: readonly Buffer[],
  path?: string,
): RecordedCrash => {
  const value = recordedCrashFixture(path);
  const header = Buffer.alloc(16);
  header.writeBigUInt64LE(BigInt(paths.length));
  header.writeBigUInt64LE(4096n, 8);
  const descriptor = Buffer.concat([
    header,
    Buffer.alloc(paths.length * 24),
    ...paths.flatMap((name) => [name, Buffer.from([0])]),
  ]);
  const note = value.notes[0];
  if (note === undefined) throw new Error("Expected a source-owned note");
  const bytes = NOTE_HEADER_BYTES + Math.ceil(descriptor.length / 4) * 4;
  value.notes = [
    {
      ...note,
      type: "NT_FILE",
      type_id: 0x46494c45,
      location: { offset: hex(NOTE_START), bytes: hex(bytes) },
      descriptor_location: {
        offset: hex(DESCRIPTOR_START),
        bytes: hex(descriptor.length),
      },
      descriptor_bytes_base64: descriptor.toString("base64"),
    },
  ];
  value.segments = value.segments.map((segment) => ({
    ...segment,
    file_size: hex(bytes),
  }));
  value.artifact.bytes = Math.max(512, NOTE_START + bytes);
  value.threads = [];
  return value;
};

/** Construct only the original byte ranges consumed by the provider protocol tests. */
export const recordedCrashFixtureBytes = (value: RecordedCrash): Buffer => {
  const bytes = Buffer.alloc(value.artifact.bytes);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  bytes.writeUInt32LE(1, 20);
  bytes.writeUInt16LE(4, 16);
  bytes.writeUInt16LE(
    RECORDED_LINUX_CORE_PROFILES[value.architecture].machine,
    18,
  );
  bytes.writeBigUInt64LE(64n, 32);
  bytes.writeUInt16LE(56, 54);
  bytes.writeUInt16LE(value.segments.length, 56);
  for (const segment of value.segments) {
    const start = Number(BigInt(segment.header_location.offset));
    bytes.writeUInt32LE(segment.type_id, start);
    bytes.writeUInt32LE(Number(BigInt(segment.flags)), start + 4);
    for (const [field, offset] of [
      [segment.offset, 8],
      [segment.virtual_address, 16],
      [segment.physical_address, 24],
      [segment.file_size, 32],
      [segment.memory_size, 40],
      [segment.alignment, 48],
    ] as const)
      bytes.writeBigUInt64LE(BigInt(field), start + offset);
  }
  for (const note of value.notes) {
    const start = Number(BigInt(note.location.offset));
    bytes.writeUInt32LE(Number(BigInt(note.owner_location.bytes)), start);
    bytes.writeUInt32LE(
      Number(BigInt(note.descriptor_location.bytes)),
      start + 4,
    );
    bytes.writeUInt32LE(note.type_id, start + 8);
    Buffer.from(note.owner_bytes_base64, "base64").copy(
      bytes,
      Number(BigInt(note.owner_location.offset)),
    );
    Buffer.from(note.descriptor_bytes_base64, "base64").copy(
      bytes,
      Number(BigInt(note.descriptor_location.offset)),
    );
  }
  return bytes;
};

export const RECORDED_CRASH_TEST_PROVIDER = {
  id: "fixture-recorded-core",
  name: "Source-owned recorded-core seam",
  version: "1",
} as const;

/** Source-owned debugger representation with deliberately unreported permission flags. */
export const recordedCrashDebuggerFixture = (): Extract<
  RecordedCrash["debugger"],
  { status: "available" }
> => ({
  status: "available",
  gdb_version: "source seam",
  pwndbg_version: "source seam",
  connection: "core",
  executable: null,
  historical_pid: 123,
  reported_limits: {
    address_space_bytes: 3221225472,
    cpu_seconds: 30,
    file_size_bytes: 67108864,
  },
  maps: [
    {
      start: "0x1000",
      end: "0x2000",
      offset: "0x0",
      reported_flags: 0,
      permissions: null,
      pathname_display: "recorded/path",
      current_file_identity: "unknown",
    },
  ],
  confidence: "derived",
  completeness: "unknown",
  diagnostics: { stdout: "", stderr: "", truncated: false },
});
